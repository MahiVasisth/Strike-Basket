import { describe, expect, it } from "vitest";
import { Store } from "../src/db/db.js";
import { PaperExchange } from "../src/engine/paper.js";
import type { BookTickerRaw, MarkPriceRaw } from "../src/strike/types.js";

const book = (symbol: string, bid: string, ask: string): BookTickerRaw => ({ symbol, bidPrice: bid, askPrice: ask, bidQty: "1", askQty: "1", time: 0 });
const mark = (s: string, p: string, r = "0"): MarkPriceRaw => ({ e: "", E: 0, s, p, i: p, r, T: 0 });

function ex(fundingRate = "0") {
  const px = new PaperExchange(new Store(":memory:"), 1000, 5);
  px.setMarket(new Map([["X-USD", book("X-USD", "99.9", "100.1")]]), new Map([["X-USD", mark("X-USD", "100", fundingRate)]]), 0);
  return px;
}

describe("PaperExchange", () => {
  it("fills buys at the ask and charges the taker fee", async () => {
    const px = ex();
    const r = await px.batchOrders([{ symbol: "X-USD", side: "buy", type: "market", size: "2", client_order_id: "a" }]);
    expect(r.successful).toHaveLength(1);
    const o = await px.getOrder("X-USD", "a");
    expect(o).toMatchObject({ status: "FILLED", avg_price: "100.1", filled_size: "2" });
    expect(px.costs().fees).toBe("0.1001"); // 200.2 * 5 bps
    // marked at 100: -0.2 spread cost, -0.1001 fee
    expect(px.equity({ "X-USD": "100" })).toBe("999.6999");
  });

  it("sells at the bid and realizes PnL", async () => {
    const px = ex();
    await px.batchOrders([{ symbol: "X-USD", side: "buy", type: "market", size: "1", client_order_id: "a" }]);
    await px.batchOrders([{ symbol: "X-USD", side: "sell", type: "market", size: "1", reduce_only: true, client_order_id: "b" }]);
    expect(px.positions()).toEqual([]);
    // round trip loses the spread (0.2) and two fees
    expect(Number(px.equity({}))).toBeCloseTo(1000 - 0.2 - 0.1001 * 0.5 - 0.0999 * 0.5, 4);
  });

  it("rejects beyond the slippage cap and bad reduce-only", async () => {
    const px = ex();
    const r = await px.batchOrders([
      { symbol: "X-USD", side: "buy", type: "market", size: "1", slippage: "0.0005", client_order_id: "a" },
      { symbol: "X-USD", side: "sell", type: "market", size: "1", reduce_only: true, client_order_id: "b" },
      { symbol: "NOPE-USD", side: "buy", type: "market", size: "1", client_order_id: "c" },
    ]);
    expect(r.failed?.map((f) => f.index)).toEqual([0, 1, 2]);
    expect((await px.getOrder("X-USD", "a")).status).toBe("REJECTED");
  });

  it("accrues funding hourly from the 8h rate (longs pay when positive)", async () => {
    const px = ex("0.0008");
    await px.batchOrders([{ symbol: "X-USD", side: "buy", type: "market", size: "10", client_order_id: "a" }]);
    px.setMarket(new Map([["X-USD", book("X-USD", "99.9", "100.1")]]), new Map([["X-USD", mark("X-USD", "100", "0.0008")]]), 2 * 3_600_000);
    // 1000 notional * 0.0008 / 8 per hour * 2h = 0.2
    expect(px.costs().funding).toBe("0.2000");
  });
});
