import type { Config } from "../config.js";
import type { Basket } from "../core/basket.js";
import { checkGate, IndexWatch, type GateResult } from "../core/gates.js";
import { planRebalance, type Filters, type Plan, type Target } from "../core/rebalancer.js";
import type { Store } from "../db/db.js";
import type { StrikeClient } from "../strike/client.js";
import type { SymbolFilters, VaultRaw } from "../strike/types.js";
import type { EventBus } from "./events.js";
import { Executor } from "./executor.js";
import { PaperExchange } from "./paper.js";

export type RunStatus =
  | "noop" // inside the band, nothing to do
  | "paused"
  | "gated" // market-quality gate failed
  | "cooldown"
  | "busy" // a TWAP from an earlier run is still working
  | "nothing_tradable" // triggered, but every leg is below minimums
  | "shadow" // plan only (read-only vault, or dryRun)
  | "executing"
  | "done"
  | "partial"
  | "failed";

export interface TickOptions {
  force?: boolean;
  /** Close everything: plan against zero weights. Only allowed while paused. */
  flatten?: boolean;
  /** Plan and record, but don't execute even in live mode. */
  dryRun?: boolean;
}

export interface TickResult {
  runId: string;
  status: RunStatus;
  plan: Plan;
  gates: GateResult[];
}

/** Personal mode: a user's own Strike account, connected through Builder Connect. */
export interface PersonalAccount {
  /** User id; runs are stored under this scope and never shown in the public log. */
  scope: string;
  /** Client signed with the user's builder-linked API wallet, sending X-Builder-Fee-Bps. */
  client: StrikeClient;
  /** USD the user allocated to the basket. Positions are sized against min(budget, account equity). */
  budgetUsd: () => number;
  isPaused: () => boolean;
}

export interface Snapshot {
  ts: number;
  source: "vault" | "paper" | "personal";
  equity: string;
  /** Paper only: taker fees and funding paid since the paper book started (positive = cost). */
  costs: { fees: string; funding: string } | null;
  sharePrice: string | null;
  totalShares: string | null;
  depositors: number | null;
  plan: Plan;
  gates: GateResult[];
}

const FILTERS_TTL_MS = 10 * 60_000;
const POST_TRADE_REFRESH_MS = 5_000;

export class BasketEngine {
  readonly executor: Executor;
  readonly paper: PaperExchange;
  private indexWatch = new IndexWatch();
  private filters: { at: number; map: Map<string, SymbolFilters> } | null = null;
  private running: Promise<TickResult> | null = null;
  private timer: NodeJS.Timeout | null = null;
  lastSnapshot: Snapshot | null = null;
  /** Strike's public record of our vault (name, terms, share price), refreshed every cycle. */
  lastVault: VaultRaw | null = null;
  lastTickAt: number | null = null;
  lastError: string | null = null;
  nextTickAt: number | null = null;

  constructor(
    readonly cfg: Config,
    readonly client: StrikeClient,
    readonly store: Store,
    readonly bus: EventBus,
    readonly basket: Basket,
    readonly personal?: PersonalAccount,
  ) {
    this.scope = personal?.scope ?? "main";
    this.paper = new PaperExchange(store, cfg.SHADOW_EQUITY_USD, cfg.PAPER_TAKER_FEE_BPS);
    // Same executor in every mode; only the venue differs.
    if (personal) this.executor = new Executor(cfg, personal.client, undefined, store, bus);
    else if (cfg.STRIKE_VAULT_ID) this.executor = new Executor(cfg, client, cfg.STRIKE_VAULT_ID, store, bus);
    else this.executor = new Executor(cfg, this.paper, "paper", store, bus);
    this.executor.useTwap = !personal && !!cfg.STRIKE_VAULT_ID && cfg.EXECUTOR === "twap";
  }

  readonly scope: string;

  get source(): "vault" | "paper" | "personal" {
    if (this.personal) return "personal";
    return this.cfg.STRIKE_VAULT_ID ? "vault" : "paper";
  }

  get isLive(): boolean {
    return !!this.personal || this.cfg.EXECUTION_MODE === "live";
  }

  private isPaused(): boolean {
    return this.personal ? this.personal.isPaused() : this.store.isPaused();
  }

  /** A crash mid-execution leaves runs in 'executing': settle them before trading again. */
  async recover() {
    const executor = this.executor;
    for (const run of this.store.unfinishedLiveRuns(this.scope)) {
      await executor.reconcileLegs(this.store.legsForRun(run.id));
      this.store.finishRun(run.id, executor.summarize(run.id), "reconciled at startup");
    }
  }

  async start() {
    if (this.client.hasAuth) await this.client.syncClock();
    await this.recover();
    const loop = async () => {
      await this.tick().catch(() => undefined);
      this.nextTickAt = Date.now() + this.cfg.CYCLE_SECONDS * 1000;
      this.timer = setTimeout(loop, this.cfg.CYCLE_SECONDS * 1000);
    };
    await loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** One cycle. Serialized: concurrent callers share the in-flight run. */
  tick(opts: TickOptions = {}): Promise<TickResult> {
    if (this.running) return this.running;
    this.running = this.doTick(opts).finally(() => (this.running = null));
    return this.running;
  }

  private async exchangeFilters() {
    if (!this.filters || Date.now() - this.filters.at > FILTERS_TTL_MS) {
      this.filters = { at: Date.now(), map: await this.client.exchangeFilters() };
    }
    return this.filters.map;
  }

  private async doTick(opts: TickOptions): Promise<TickResult> {
    // Unique across accounts: client order IDs are derived from it.
    const runId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      const result = await this.cycle(runId, opts);
      this.lastError = null;
      // The snapshot was taken before trading; refresh it shortly so the page shows post-trade weights.
      if (["done", "partial"].includes(result.status)) {
        setTimeout(() => this.tick().catch(() => undefined), POST_TRADE_REFRESH_MS).unref();
      }
      return result;
    } catch (err) {
      this.lastError = String(err);
      this.bus.emit("error", { runId, error: this.lastError });
      throw err;
    } finally {
      this.lastTickAt = Date.now();
    }
  }

  private async cycle(runId: string, opts: TickOptions): Promise<TickResult> {
    const cfg = this.cfg;
    const vaultId = cfg.STRIKE_VAULT_ID;

    // Settle TWAPs from earlier runs first; while one is still working, positions are in flux.
    const twaps = this.store.activeTwapLegs(this.scope);
    if (twaps.length) {
      await this.executor.reconcileLegs(twaps);
      for (const id of new Set(twaps.map((l) => l.run_id))) this.store.finishRun(id, this.executor.summarize(id));
    }
    const twapBusy = this.store.activeTwapLegs(this.scope).length > 0;

    const [filterMap, marks, books] = await Promise.all([this.exchangeFilters(), this.client.markPrices(), this.client.bookTickers()]);

    const markBySymbol: Record<string, string> = {};
    for (const [s, m] of marks) markBySymbol[s] = m.p;

    // ----- state: Strike vault (source of truth) or the paper book -----
    let equity: string;
    let positions: Array<{ symbol: string; size: string }>;
    let vault: VaultRaw | null = null;
    const basketSymbols = new Set(this.basket.constituents.map((c) => c.symbol));
    const personalWarnings: string[] = [];
    if (this.personal) {
      const [acct, pos] = await Promise.all([this.personal.client.account(), this.personal.client.positions()]);
      // Only basket markets are ours to manage; the user's other positions are never touched.
      positions = pos.filter((p) => basketSymbols.has(p.symbol)).map((p) => ({ symbol: p.symbol, size: p.size }));
      const budget = this.personal.budgetUsd();
      const accountEquity = Number(acct.margin_balance);
      if (accountEquity < budget) personalWarnings.push(`ACCOUNT_EQUITY_BELOW_BUDGET_${Math.floor(accountEquity)}USD`);
      equity = String(Math.max(0, Math.min(budget, accountEquity)));
    } else if (vaultId) {
      const [v, acct, pos, portfolio] = await Promise.all([
        this.client.vault(vaultId),
        this.client.account(vaultId),
        this.client.positions(vaultId),
        this.client.vaultPortfolio(vaultId).catch(() => null),
      ]);
      // GET /v2/vault/{id} reports depositors: 0; the portfolio endpoint has the real count.
      vault = { ...v, depositors: portfolio?.depositors ?? v.depositors };
      this.lastVault = vault;
      equity = acct.margin_balance ?? v.equity;
      positions = pos.map((p) => ({ symbol: p.symbol, size: p.size }));
    } else {
      this.paper.setMarket(books, marks, Date.now());
      positions = this.paper.positions();
      equity = this.paper.equity(markBySymbol);
    }

    // ----- gates -----
    const now = this.client.now();
    const gateSymbols = new Set([...this.basket.constituents.map((c) => c.symbol), ...positions.map((p) => p.symbol)]);
    const gates: GateResult[] = [...gateSymbols].map((symbol) => {
      const m = marks.get(symbol);
      const b = books.get(symbol);
      const unchanged = m ? this.indexWatch.observe(symbol, m.i, now) : undefined;
      return checkGate(
        { symbol, mark: m?.p ?? "0", bid: b?.bidPrice, ask: b?.askPrice, bookTimeMs: b?.time, nowMs: now, indexUnchangedForMs: unchanged },
        {
          maxSpreadBps: cfg.MAX_SPREAD_BPS,
          maxMarkMidDeviationBps: cfg.MAX_MARK_MID_DEVIATION_BPS,
          maxBookAgeSec: cfg.MAX_BOOK_AGE_SEC,
          indexFrozenMin: cfg.INDEX_FROZEN_MIN,
          blockOnFrozenIndex: cfg.BLOCK_ON_FROZEN_INDEX,
        },
      );
    });
    for (const c of this.basket.constituents) {
      if (filterMap.get(c.symbol)?.status !== "trading") {
        const g = gates.find((x) => x.symbol === c.symbol)!;
        g.ok = false;
        g.failures.push("NOT_TRADING");
      }
    }

    // ----- plan -----
    const targets: Target[] = this.basket.constituents.map((c) => ({ symbol: c.symbol, weight: opts.flatten ? 0 : c.weight }));
    const filters: Record<string, Filters> = {};
    for (const s of gateSymbols) {
      const f = filterMap.get(s);
      if (f) filters[s] = f;
    }
    const plan = planRebalance({
      targets,
      equity,
      positions,
      marks: markBySymbol,
      filters,
      params: {
        grossExposure: cfg.GROSS_EXPOSURE,
        driftThresholdBps: cfg.DRIFT_THRESHOLD_BPS,
        minNotionalBuffer: cfg.MIN_NOTIONAL_BUFFER,
        maxLegNotional: cfg.MAX_LEG_NOTIONAL_USD,
        maxRunNotional: cfg.MAX_RUN_NOTIONAL_USD,
        force: opts.force || opts.flatten,
      },
    });
    plan.warnings.push(...personalWarnings);

    const snapshot: Snapshot = {
      ts: Date.now(),
      source: this.source,
      equity,
      costs: this.source === "paper" ? this.paper.costs() : null,
      sharePrice: vault?.share_price ?? null,
      totalShares: vault?.total_shares ?? null,
      depositors: vault?.depositors ?? null,
      plan,
      gates,
    };
    this.lastSnapshot = snapshot;
    if (this.scope === "main") this.store.insertSnapshot({
      ts: snapshot.ts,
      equity,
      share_price: snapshot.sharePrice,
      total_shares: snapshot.totalShares,
      depositors: snapshot.depositors,
      max_drift_bps: plan.maxDriftBps,
      weights_json: JSON.stringify(plan.rows),
    });
    this.bus.emit("snapshot", snapshot);

    // ----- decide -----
    const status = this.decide(plan, gates, opts, twapBusy);
    this.store.insertRun({
      id: runId,
      scope: this.scope,
      created_at: Date.now(),
      finished_at: null,
      env: cfg.STRIKE_ENV,
      mode: this.runMode(opts),
      basket_id: this.basket.id,
      basket_version: this.basket.version,
      trigger: plan.trigger,
      status: status === "execute" ? "executing" : status,
      equity,
      max_drift_bps: plan.maxDriftBps,
      plan_json: JSON.stringify(plan),
      gates_json: JSON.stringify(gates),
      error: null,
    });

    if (status !== "execute") {
      this.store.finishRun(runId, status);
      if (plan.trigger) this.bus.emit(status === "gated" ? "run.gated" : "run.planned", { runId, status, trigger: plan.trigger, legs: plan.legs });
      return { runId, status, plan, gates };
    }

    // ----- execute (live vault, or paper exchange) -----
    this.bus.emit("run.executing", { runId, trigger: plan.trigger, legs: plan.legs });
    try {
      const open = new Set(positions.filter((p) => Number(p.size) !== 0).map((p) => p.symbol));
      await this.executor.ensureSymbolSettings(this.basket.constituents.map((c) => c.symbol), open);
      const final = await this.executor.execute(runId, plan.legs);
      this.store.finishRun(runId, final);
      this.bus.emit("run.finished", { runId, status: final, legs: this.store.legsForRun(runId) });
      return { runId, status: final, plan, gates };
    } catch (err) {
      this.store.finishRun(runId, "failed", String(err));
      this.bus.emit("run.finished", { runId, status: "failed", error: String(err) });
      return { runId, status: "failed", plan, gates };
    }
  }

  private decide(
    plan: Plan,
    gates: GateResult[],
    opts: TickOptions,
    twapBusy: boolean,
  ): Exclude<RunStatus, "executing" | "done" | "partial" | "failed"> | "execute" {
    if (!plan.trigger) return "noop";
    if (this.isPaused() && !opts.flatten) return "paused";
    if (opts.flatten && !this.isPaused()) throw new Error("flatten requires the engine to be paused first");
    if (twapBusy && !opts.dryRun) return "busy";
    // Flatten ignores gates: getting out matters more than a good price.
    if (!opts.flatten && gates.some((g) => !g.ok)) return "gated";
    const last = this.store.lastExecutedRunAt(this.scope);
    const coolingDown = last !== null && Date.now() - last < this.cfg.REBALANCE_COOLDOWN_MIN * 60_000;
    if (coolingDown && plan.trigger === "drift") return "cooldown";
    if (!plan.legs.length) return "nothing_tradable";
    if (opts.dryRun) return "shadow";
    if (this.source === "paper" || this.source === "personal") return "execute";
    if (!this.isLive) return "shadow";
    return "execute";
  }

  private runMode(opts: TickOptions): "live" | "paper" | "shadow" {
    if (opts.dryRun) return "shadow";
    if (this.source === "paper") return "paper";
    if (this.source === "personal") return "live";
    return this.isLive ? "live" : "shadow";
  }
}
