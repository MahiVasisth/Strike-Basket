import { Decimal } from "decimal.js";
import type { Store } from "../db/db.js";
import { StrikeError } from "../strike/client.js";
import type { AccountRaw, BatchOrderResponse, BookTickerRaw, CreateOrder, MarkPriceRaw } from "../strike/types.js";
import type { Venue } from "./executor.js";

// Paper exchange: stands in for the Strike vault when there is no vault (no mainnet funds).
// The engine sends its plan through the same Executor it uses for the real vault; only the
// venue differs. Fills are deliberately not flattering:
//   - market orders fill at the book side (ask for buys, bid for sells), not at the mark
//   - Strike's tier-0 taker fee (0.050%) is charged on every fill
//   - funding accrues on open positions from Strike's live rate (8h basis, applied per hour)
//   - an order whose book price is beyond the slippage cap is rejected, as Strike would

interface PaperPosition {
  size: string;
  entry: string;
}

interface PaperOrder {
  status: "FILLED" | "REJECTED";
  order_id: string;
  symbol: string;
  side: string;
  filled_size: string;
  avg_price: string;
  fee: string;
  error?: string;
}

interface PaperState {
  startEquity: string;
  realized: string;
  fees: string;
  funding: string; // positive = paid by us
  lastFundingAt: number | null;
  nextOrderId: number;
  positions: Record<string, PaperPosition>;
  orders: Record<string, PaperOrder>;
}

const KEY = "paper_exchange";
const MAX_ORDERS_KEPT = 500;

export class PaperExchange implements Venue {
  private books = new Map<string, BookTickerRaw>();
  private marks = new Map<string, MarkPriceRaw>();

  constructor(
    private store: Store,
    private startEquity: number,
    private takerFeeBps: number,
  ) {}

  private load(): PaperState {
    const raw = this.store.getKv(KEY);
    if (raw) return JSON.parse(raw) as PaperState;
    return {
      startEquity: String(this.startEquity),
      realized: "0",
      fees: "0",
      funding: "0",
      lastFundingAt: null,
      nextOrderId: 1,
      positions: {},
      orders: {},
    };
  }

  private save(s: PaperState) {
    const ids = Object.keys(s.orders);
    if (ids.length > MAX_ORDERS_KEPT) for (const id of ids.slice(0, ids.length - MAX_ORDERS_KEPT)) delete s.orders[id];
    this.store.setKv(KEY, JSON.stringify(s));
  }

  /** Feed the latest Strike market data; accrues funding for the time since the last call. */
  setMarket(books: Map<string, BookTickerRaw>, marks: Map<string, MarkPriceRaw>, nowMs: number) {
    this.books = books;
    this.marks = marks;
    const s = this.load();
    if (s.lastFundingAt !== null) {
      const hours = new Decimal(nowMs - s.lastFundingAt).div(3_600_000);
      let funding = new Decimal(s.funding);
      for (const [sym, p] of Object.entries(s.positions)) {
        const m = marks.get(sym);
        if (!m) continue;
        // rate is per 8h; longs pay when positive
        funding = funding.plus(new Decimal(p.size).mul(m.p).mul(m.r).div(8).mul(hours));
      }
      s.funding = funding.toString();
    }
    s.lastFundingAt = nowMs;
    this.save(s);
  }

  positions(): Array<{ symbol: string; size: string }> {
    return Object.entries(this.load().positions).map(([symbol, p]) => ({ symbol, size: p.size }));
  }

  equity(marks: Record<string, string>): string {
    const s = this.load();
    let eq = new Decimal(s.startEquity).plus(s.realized).minus(s.fees).minus(s.funding);
    for (const [sym, p] of Object.entries(s.positions)) {
      const mark = marks[sym];
      if (mark) eq = eq.plus(new Decimal(p.size).mul(new Decimal(mark).minus(p.entry)));
    }
    return eq.toFixed(4);
  }

  costs(): { fees: string; funding: string } {
    const s = this.load();
    return { fees: new Decimal(s.fees).toFixed(4), funding: new Decimal(s.funding).toFixed(4) };
  }

  reset() {
    this.store.db.prepare("DELETE FROM kv WHERE key = ?").run(KEY);
  }

  // ---------- Venue ----------

  async account(): Promise<AccountRaw> {
    const marks: Record<string, string> = {};
    for (const [s, m] of this.marks) marks[s] = m.p;
    const eq = this.equity(marks);
    return { account_id: "paper", wallet_balance: eq, available_balance: eq, unrealized_pnl: "0", margin_balance: eq };
  }

  async setMarginMode() {
    return {};
  }

  async setLeverage() {
    return {};
  }

  async batchOrders(orders: CreateOrder[]): Promise<BatchOrderResponse> {
    const s = this.load();
    const res: Required<BatchOrderResponse> = { successful: [], failed: [] };
    orders.forEach((o, index) => {
      const coid = o.client_order_id ?? `paper-anon-${s.nextOrderId}`;
      const book = this.books.get(o.symbol);
      const mark = this.marks.get(o.symbol)?.p;
      const pxStr = o.side === "buy" ? book?.askPrice : book?.bidPrice;
      const reject = (error: string) => {
        s.orders[coid] = { status: "REJECTED", order_id: `paper-${s.nextOrderId++}`, symbol: o.symbol, side: o.side, filled_size: "0", avg_price: "0", fee: "0", error };
        res.failed.push({ index, error });
      };
      if (!pxStr || !mark || new Decimal(pxStr).lte(0)) return reject("no book");
      const px = new Decimal(pxStr);
      if (o.slippage && px.minus(mark).abs().div(mark).gt(o.slippage)) return reject("price beyond slippage cap");

      const q = new Decimal(o.size).mul(o.side === "buy" ? 1 : -1);
      const cur = s.positions[o.symbol] ?? { size: "0", entry: "0" };
      const size = new Decimal(cur.size);
      if (o.reduce_only && (size.isZero() || size.s === q.s || q.abs().gt(size.abs()))) return reject("reduce-only would increase position");

      const entry = new Decimal(cur.entry);
      const next = size.plus(q);
      if (size.isZero() || size.s === q.s) {
        const newEntry = size.abs().mul(entry).plus(q.abs().mul(px)).div(next.abs());
        s.positions[o.symbol] = { size: next.toString(), entry: newEntry.toString() };
      } else {
        const closed = Decimal.min(q.abs(), size.abs());
        s.realized = new Decimal(s.realized).plus(closed.mul(px.minus(entry)).mul(size.s)).toString();
        if (next.isZero()) delete s.positions[o.symbol];
        else s.positions[o.symbol] = { size: next.toString(), entry: next.s === size.s ? entry.toString() : px.toString() };
      }
      const fee = q.abs().mul(px).mul(this.takerFeeBps).div(10_000);
      s.fees = new Decimal(s.fees).plus(fee).toString();
      s.orders[coid] = {
        status: "FILLED",
        order_id: `paper-${s.nextOrderId++}`,
        symbol: o.symbol,
        side: o.side,
        filled_size: o.size,
        avg_price: px.toString(),
        fee: fee.toFixed(6),
      };
      res.successful.push({ client_order_id: coid });
    });
    this.save(s);
    return res;
  }

  async getOrder(_symbol: string, clientOrderId: string): Promise<Record<string, unknown>> {
    const o = this.load().orders[clientOrderId];
    if (!o) throw new StrikeError("paper order not found", 404, null, "/paper/order");
    return { ...o };
  }

  async createTwap(): Promise<Record<string, unknown>> {
    throw new StrikeError("TWAP is not simulated in paper mode", 400, null, "/paper/twap");
  }

  async getTwap(): Promise<Record<string, unknown>> {
    throw new StrikeError("TWAP is not simulated in paper mode", 404, null, "/paper/twap");
  }
}
