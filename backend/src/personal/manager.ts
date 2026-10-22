import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { Config } from "../config.js";
import type { Basket } from "../core/basket.js";
import { UserStore, type Store, type UserRow } from "../db/db.js";
import { BasketEngine } from "../engine/engine.js";
import { SilentBus } from "../engine/events.js";
import type { StrikeClient } from "../strike/client.js";
import { generateApiWallet, loadApiWallet } from "../strike/sign.js";
import type { SymbolFilters } from "../strike/types.js";
import { decryptSecret, encryptSecret, hashToken, newSessionToken } from "./secrets.js";

// Personal mode: a user connects their own Strike account through Builder Connect and the
// engine keeps a basket on target inside that account, sized to the budget they chose.
//
//   request:  we generate an Ed25519 API wallet → Strike returns a challenge for the user's wallet
//   confirm:  the user's wallet signature → Strike creates a builder-linked API wallet for our key
//   run:      the same BasketEngine/Executor as the vault, on the user's account, with
//             X-Builder-Fee-Bps on order requests. Only basket markets are touched.

export const CHAINS = ["ethereum", "solana", "cardano"] as const;
export type Chain = (typeof CHAINS)[number];

const CONNECT_TTL_MS = 5 * 60_000; // Strike's challenge nonce expires after 5 minutes
const FILTERS_TTL_MS = 10 * 60_000;

export class PersonalError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface PendingConnect {
  address: string;
  chain: Chain;
  basketId: string;
  budgetUsd: number;
  publicKeyHex: string;
  secretEnc: string;
  nonce: string;
  expiresAt: number;
}

export interface BasketEligibility {
  id: string;
  name: string;
  available: boolean;
  minBudgetUsd: number | null;
  reason?: string;
}

export class PersonalManager {
  readonly users: UserStore;
  private pending = new Map<string, PendingConnect>();
  private engines = new Map<string, BasketEngine>();
  private filters: { at: number; map: Map<string, SymbolFilters> } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private cfg: Config,
    private client: StrikeClient,
    private store: Store,
    private baskets: Map<string, Basket>,
  ) {
    this.users = new UserStore(store);
  }

  get enabled(): boolean {
    return this.cfg.PERSONAL_MODE;
  }

  get builderFeeBps(): number {
    return this.cfg.BUILDER_FEE_BPS;
  }

  private get secret(): string {
    return this.cfg.PERSONAL_SECRET!;
  }

  // ---------- lifecycle ----------

  async start() {
    if (!this.enabled) return;
    await this.client.syncClock(); // user clients copy this offset when they're created
    for (const u of this.users.running()) {
      const engine = this.engineFor(u);
      await engine.recover().catch(() => undefined);
    }
    const loop = async () => {
      await this.tickAll();
      this.timer = setTimeout(loop, this.cfg.CYCLE_SECONDS * 1000);
    };
    await loop();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  /** One cycle for every connected account, sequentially (keeps request weight low). */
  async tickAll() {
    for (const engine of this.engines.values()) await engine.tick().catch(() => undefined);
  }

  private engineFor(u: UserRow): BasketEngine {
    const existing = this.engines.get(u.id);
    if (existing) return existing;
    const basket = this.baskets.get(u.basket_id);
    if (!basket) throw new PersonalError(500, `basket ${u.basket_id} no longer exists`);
    if (!u.api_secret_enc) throw new PersonalError(409, "account is revoked");
    const wallet = loadApiWallet(u.api_pubkey, decryptSecret(u.api_secret_enc, this.secret));
    const userClient = this.client.forWallet(wallet, u.fee_bps);
    const engine = new BasketEngine(this.cfg, this.client, this.store, new SilentBus(this.store), basket, {
      scope: u.id,
      client: userClient,
      budgetUsd: () => this.users.get(u.id)?.budget_usd ?? 0,
      isPaused: () => this.users.get(u.id)?.status !== "active",
    });
    this.engines.set(u.id, engine);
    return engine;
  }

  // ---------- eligibility ----------

  private async exchangeFilters() {
    if (!this.filters || Date.now() - this.filters.at > FILTERS_TTL_MS) {
      this.filters = { at: Date.now(), map: await this.client.exchangeFilters() };
    }
    return this.filters.map;
  }

  /** Which baskets can run on this environment, and the smallest budget whose every leg clears Strike's minimum order. */
  async eligibility(): Promise<BasketEligibility[]> {
    const filters = await this.exchangeFilters();
    return [...this.baskets.values()].map((b) => {
      const missing = b.constituents.filter((c) => filters.get(c.symbol)?.status !== "trading").map((c) => c.symbol);
      if (missing.length) {
        return { id: b.id, name: b.name, available: false, minBudgetUsd: null, reason: `not listed on ${this.cfg.STRIKE_ENV}: ${missing.join(", ")}` };
      }
      const min = Math.max(
        ...b.constituents.map((c) =>
          new Decimal(filters.get(c.symbol)!.minNotional).mul(this.cfg.MIN_NOTIONAL_BUFFER).div(this.cfg.GROSS_EXPOSURE * c.weight).toNumber(),
        ),
      );
      return { id: b.id, name: b.name, available: true, minBudgetUsd: Math.ceil(min) };
    });
  }

  private async validateChoice(basketId: string, budgetUsd: number) {
    const e = (await this.eligibility()).find((x) => x.id === basketId);
    if (!e) throw new PersonalError(400, `unknown basket ${basketId}`);
    if (!e.available) throw new PersonalError(400, `basket ${basketId} is unavailable: ${e.reason}`);
    if (budgetUsd < e.minBudgetUsd!) throw new PersonalError(400, `budget must be at least $${e.minBudgetUsd} for ${e.name} (Strike minimum order sizes)`);
    if (budgetUsd > this.cfg.PERSONAL_MAX_BUDGET_USD) throw new PersonalError(400, `budget is capped at $${this.cfg.PERSONAL_MAX_BUDGET_USD} during the beta`);
  }

  // ---------- connect ----------

  async requestConnect(input: { address: string; chain: Chain; basketId: string; budgetUsd: number }) {
    if (!this.enabled) throw new PersonalError(404, "personal mode is disabled");
    if (this.users.countActive() >= this.cfg.PERSONAL_MAX_USERS) throw new PersonalError(503, "beta is full");
    await this.validateChoice(input.basketId, input.budgetUsd);

    const { publicKeyHex, privateKeyHex } = generateApiWallet();
    const challenge = await this.client.builderRequestSignature({
      address: input.address,
      chain: input.chain,
      code: this.cfg.BUILDER_CODE!,
      fee_share_bps: this.cfg.BUILDER_FEE_BPS,
      public_key: publicKeyHex,
    });
    const connectId = randomUUID();
    const expiresAt = Date.now() + CONNECT_TTL_MS;
    this.pending.set(connectId, {
      ...input,
      publicKeyHex,
      secretEnc: encryptSecret(privateKeyHex, this.secret),
      nonce: challenge.nonce,
      expiresAt,
    });
    for (const [id, p] of this.pending) if (p.expiresAt < Date.now()) this.pending.delete(id);
    return { connectId, messageToSign: challenge.message_to_sign, expiresAt, feeBps: this.cfg.BUILDER_FEE_BPS };
  }

  async confirmConnect(input: { connectId: string; signature: string }) {
    const p = this.pending.get(input.connectId);
    if (!p || p.expiresAt < Date.now()) throw new PersonalError(410, "connect request expired; start again");
    this.pending.delete(input.connectId); // Strike's nonce is single-use too

    const res = await this.client.builderVerifySignature({ address: p.address, chain: p.chain, nonce: p.nonce, wallet_signature: input.signature });
    if (res.api_wallet_public_key?.toLowerCase() !== p.publicKeyHex) {
      throw new PersonalError(502, "Strike linked a different API wallet than the one we generated");
    }

    // Reconnecting the same wallet replaces the old connection (Strike already revoked its API wallet).
    const prev = this.users.activeByAddress(p.chain, p.address);
    if (prev) this.revoke(prev);

    const { token, hash } = newSessionToken();
    const now = Date.now();
    const user: UserRow = {
      id: randomUUID(),
      session_hash: hash,
      address: p.address,
      chain: p.chain,
      account_id: res.account_id,
      api_pubkey: p.publicKeyHex,
      api_secret_enc: p.secretEnc,
      basket_id: p.basketId,
      budget_usd: p.budgetUsd,
      fee_bps: Math.min(this.cfg.BUILDER_FEE_BPS, res.fee_share_bps ?? this.cfg.BUILDER_FEE_BPS),
      status: "active",
      created_at: now,
      updated_at: now,
    };
    this.users.insert(user);
    const engine = this.engineFor(user);
    void engine.tick().catch(() => undefined); // first look right away, don't make the request wait
    return { token, user: this.publicUser(user) };
  }

  // ---------- per-user actions ----------

  authenticate(token: string | undefined): UserRow {
    const u = token ? this.users.bySession(hashToken(token)) : undefined;
    if (!u) throw new PersonalError(401, "not connected");
    return u;
  }

  publicUser(u: UserRow) {
    return {
      address: u.address,
      chain: u.chain,
      accountId: u.account_id,
      basketId: u.basket_id,
      budgetUsd: u.budget_usd,
      builderFeeBps: u.fee_bps,
      status: u.status,
      connectedAt: u.created_at,
    };
  }

  view(u: UserRow) {
    const engine = this.engines.get(u.id);
    const s = engine?.lastSnapshot ?? null;
    return {
      user: this.publicUser(u),
      health: { lastTickAt: engine?.lastTickAt ?? null, lastError: engine?.lastError ?? null, cycleSeconds: this.cfg.CYCLE_SECONDS },
      state: s && {
        ts: s.ts,
        basketEquity: s.equity,
        bookNotional: s.plan.bookNotional,
        maxDriftBps: s.plan.maxDriftBps,
        driftThresholdBps: this.cfg.DRIFT_THRESHOLD_BPS,
        pendingTrigger: s.plan.trigger,
        weights: s.plan.rows,
        gates: s.gates,
        warnings: s.plan.warnings,
      },
    };
  }

  async update(u: UserRow, patch: { basketId?: string; budgetUsd?: number }) {
    const basketId = patch.basketId ?? u.basket_id;
    const budgetUsd = patch.budgetUsd ?? u.budget_usd;
    await this.validateChoice(basketId, budgetUsd);
    if (basketId !== u.basket_id) {
      // Positions in the old basket would be orphaned (we only manage basket markets).
      const open = this.engines.get(u.id)?.lastSnapshot?.plan.rows.some((r) => Number(r.currentQty) !== 0);
      if (open) throw new PersonalError(409, "pause and flatten the current basket before switching");
      this.engines.get(u.id)?.stop();
      this.engines.delete(u.id);
    }
    this.users.update(u.id, { basket_id: basketId, budget_usd: budgetUsd });
    this.engineFor(this.users.get(u.id)!);
    return this.publicUser(this.users.get(u.id)!);
  }

  setPaused(u: UserRow, paused: boolean) {
    this.users.update(u.id, { status: paused ? "paused" : "active" });
    return this.publicUser(this.users.get(u.id)!);
  }

  async rebalance(u: UserRow, opts: { force?: boolean; dryRun?: boolean }) {
    return this.engineFor(u).tick(opts);
  }

  async flatten(u: UserRow) {
    if (u.status !== "paused") throw new PersonalError(409, "pause first");
    return this.engineFor(u).tick({ flatten: true });
  }

  /** Stop trading and destroy our copy of the key. Positions stay in the user's Strike account. */
  revoke(u: UserRow) {
    this.engines.get(u.id)?.stop();
    this.engines.delete(u.id);
    this.users.update(u.id, { status: "revoked", api_secret_enc: null });
  }

  runs(u: UserRow, limit: number) {
    return this.store.listRuns({ limit, actionsOnly: true, scope: u.id });
  }
}
