import type { Config } from "../config.js";
import type { LegRow, Store } from "../db/db.js";
import type { Leg } from "../core/rebalancer.js";
import { sleep, StrikeError, type StrikeClient } from "../strike/client.js";

/** Where orders go: the real Strike client (vault) or the paper exchange. */
export type Venue = Pick<StrikeClient, "account" | "setMarginMode" | "setLeverage" | "batchOrders" | "createTwap" | "getTwap" | "getOrder">;
import type { CreateOrder } from "../strike/types.js";
import type { EventBus } from "./events.js";

// Idempotency rule: we never re-send an order automatically. Every cycle re-plans from Strike's
// actual positions, so a lost or unconfirmed leg is corrected by the next plan, not by a retry.
// Unconfirmed legs are reconciled by client_order_id.

const FINAL = new Set(["filled", "canceled", "cancelled", "rejected", "expired", "completed", "failed"]);

export interface OrderState {
  status: string; // lower-case
  orderId?: string;
  filledQty?: string;
  avgPrice?: string;
}

/** GET /v2/order's response shape is undocumented; read the common field spellings.
 *  Live testnet returns PascalCase: { ID, Status, Filled, Price } (Price = fill price for market orders). */
export function parseOrderState(raw: Record<string, unknown> | null | undefined): OrderState | null {
  if (!raw) return null;
  const o = (raw.order as Record<string, unknown>) ?? raw;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return String(o[k]);
    return undefined;
  };
  const status = pick("status", "order_status", "Status", "X");
  if (!status) return null;
  return {
    status: status.toLowerCase(),
    orderId: pick("order_id", "orderId", "id", "ID", "i"),
    filledQty: pick("filled_size", "executed_qty", "executedQty", "filled_qty", "cum_qty", "Filled", "z"),
    avgPrice: pick("avg_price", "average_price", "avgPrice", "ap", "Price"),
  };
}

export class Executor {
  private configured = new Set<string>();
  /** The paper exchange doesn't simulate TWAP, so it always uses batch. */
  useTwap = false;

  constructor(
    private cfg: Config,
    private client: Venue,
    /** undefined = trade the client's own account (personal mode). */
    private vaultId: string | undefined,
    private store: Store,
    private bus: EventBus,
  ) {}

  /** Vaults default to isolated 10x. Set our margin mode and leverage once per symbol. */
  async ensureSymbolSettings(symbols: string[], openSymbols: Set<string>) {
    const todo = symbols.filter((s) => !this.configured.has(s));
    if (!todo.length) return;
    const acct = await this.client.account(this.vaultId);
    for (const symbol of todo) {
      const cur = acct.symbol_settings?.[symbol];
      if (cur?.margin_mode !== this.cfg.MARGIN_MODE && !openSymbols.has(symbol)) {
        await this.client.setMarginMode(symbol, this.cfg.MARGIN_MODE, this.vaultId);
      }
      if (cur?.leverage !== this.cfg.SYMBOL_LEVERAGE) {
        await this.client.setLeverage(symbol, this.cfg.SYMBOL_LEVERAGE, this.vaultId);
      }
      this.configured.add(symbol);
    }
  }

  async execute(runId: string, legs: Leg[]): Promise<"done" | "partial" | "failed"> {
    const rows = legs.map((leg, idx) => {
      const method: "batch" | "twap" =
        this.useTwap && Number(leg.notional) >= this.cfg.TWAP_MIN_NOTIONAL_USD ? "twap" : "batch";
      const row = {
        run_id: runId,
        idx,
        symbol: leg.symbol,
        side: leg.side,
        qty: leg.qty,
        notional_est: leg.notional,
        mark: leg.mark,
        reduce_only: leg.reduceOnly ? 1 : 0,
        method,
        client_order_id: `bk-${runId}-${idx}`,
        status: "pending",
      };
      this.store.insertLeg(row);
      return row;
    });

    const batch = rows.filter((r) => r.method === "batch");
    const twaps = rows.filter((r) => r.method === "twap");

    if (batch.length) await this.sendBatch(batch);
    for (const r of twaps) await this.sendTwap(r);

    await this.confirm(runId, this.cfg.ORDER_CONFIRM_TIMEOUT_SEC * 1000);
    return this.summarize(runId);
  }

  private async sendBatch(rows: Array<Pick<LegRow, "symbol" | "side" | "qty" | "reduce_only" | "client_order_id">>) {
    const orders: CreateOrder[] = rows.map((r) => ({
      symbol: r.symbol,
      side: r.side as "buy" | "sell",
      type: "market",
      size: r.qty,
      slippage: String(this.cfg.MAX_SLIPPAGE),
      reduce_only: r.reduce_only === 1 || undefined,
      client_order_id: r.client_order_id,
    }));
    try {
      const res = await this.client.batchOrders(orders, this.vaultId);
      for (const ok of res.successful ?? []) {
        const coid = ok.client_order_id ? String(ok.client_order_id) : undefined;
        if (coid) this.legUpdate(coid, { status: "sent", raw_json: JSON.stringify(ok) });
      }
      for (const f of res.failed ?? []) {
        const r = rows[f.index];
        if (r) this.legUpdate(r.client_order_id, { status: "rejected", error: f.error });
      }
      // Anything neither listed as successful nor failed: find out during confirm().
      for (const r of rows) {
        const listed = (res.successful ?? []).some((s) => s.client_order_id === r.client_order_id);
        const failed = (res.failed ?? []).some((f) => rows[f.index]?.client_order_id === r.client_order_id);
        if (!listed && !failed) this.legUpdate(r.client_order_id, { status: "unknown" });
      }
    } catch (err) {
      // A 4xx means the whole batch was refused; a network error or 5xx means we don't know.
      const definite = err instanceof StrikeError && err.status < 500;
      for (const r of rows) this.legUpdate(r.client_order_id, { status: definite ? "rejected" : "unknown", error: String(err) });
    }
  }

  private async sendTwap(r: Pick<LegRow, "symbol" | "side" | "qty" | "reduce_only" | "client_order_id">) {
    try {
      const res = await this.client.createTwap({
        symbol: r.symbol,
        side: r.side === "buy" ? "BUY" : "SELL",
        total_size: r.qty,
        duration_sec: this.cfg.TWAP_DURATION_SEC,
        reduce_only: r.reduce_only === 1,
        randomize: true,
        vault_id: this.vaultId,
      });
      const id = String(res.strategy_id ?? res.id ?? res.twap_id ?? "");
      this.legUpdate(r.client_order_id, { status: "sent", twap_id: id || null, raw_json: JSON.stringify(res) });
    } catch (err) {
      const definite = err instanceof StrikeError && err.status < 500;
      this.legUpdate(r.client_order_id, { status: definite ? "rejected" : "unknown", error: String(err) });
    }
  }

  /** Poll until every leg is final or the timeout passes. TWAP legs are left to later reconciles. */
  async confirm(runId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    const openLegs = () => this.store.legsForRun(runId).filter((l) => !FINAL.has(l.status) && l.method !== "twap");
    while (openLegs().length && Date.now() < deadline) {
      await this.reconcileLegs(openLegs());
      if (openLegs().length) await sleep(2000);
    }
    // TWAPs run for minutes; record their current state and let later cycles settle them.
    await this.reconcileLegs(this.store.legsForRun(runId).filter((l) => l.method === "twap" && !FINAL.has(l.status)));
  }

  async reconcileLegs(legs: LegRow[]) {
    for (const l of legs) {
      try {
        if (l.method === "twap") {
          if (!l.twap_id) continue;
          const t = await this.client.getTwap(l.twap_id);
          const st = String(t.status ?? "").toLowerCase();
          this.legUpdate(l.client_order_id, {
            status: st === "completed" ? "filled" : FINAL.has(st) ? st : "sent",
            filled_qty: t.filled_size ? String(t.filled_size) : null,
            raw_json: JSON.stringify(t),
          });
          continue;
        }
        const s = parseOrderState(await this.client.getOrder(l.symbol, l.client_order_id, this.vaultId));
        if (!s) continue;
        const status = s.status === "partially_filled" ? "partial" : s.status === "cancelled" ? "canceled" : s.status;
        this.legUpdate(l.client_order_id, {
          status,
          strike_order_id: s.orderId ?? null,
          filled_qty: s.filledQty ?? null,
          avg_price: s.avgPrice ?? null,
        });
      } catch (err) {
        if (err instanceof StrikeError && err.status === 404) {
          // Strike has no record: it was never accepted.
          this.legUpdate(l.client_order_id, { status: l.status === "pending" ? "failed" : "rejected", error: "not found on Strike" });
        }
      }
    }
  }

  summarize(runId: string): "done" | "partial" | "failed" {
    const legs = this.store.legsForRun(runId);
    const filled = legs.filter((l) => l.status === "filled").length;
    if (filled === legs.length) return "done";
    if (filled > 0 || legs.some((l) => l.status === "partial" || l.status === "sent")) return "partial";
    return "failed";
  }

  private legUpdate(coid: string, patch: Parameters<Store["updateLeg"]>[1]) {
    this.store.updateLeg(coid, patch);
    this.bus.emit("leg.updated", { clientOrderId: coid, ...patch, raw_json: undefined });
  }
}
