import { describe, expect, it } from "vitest";
import { minAmountFor, previewOrders, type PreviewInput } from "../src/core/preview.js";

// Real mainnet filters for the Pre-IPO basket; books ~6 bps wide like on 22 Oct.
const filters = {
  "SPCX-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "10", marketMaxQty: "5000", status: "trading" },
  "ZHIPU-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "5", marketMaxQty: "2000", status: "trading" },
  "UNITREE-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "5", marketMaxQty: "2000", status: "trading" },
  "MINIMAX-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "5", marketMaxQty: "12000", status: "trading" },
};
const marks = { "SPCX-USD": "155.04", "ZHIPU-USD": "58.52", "UNITREE-USD": "77.00", "MINIMAX-USD": "20.56" };
const now = 1_800_000_000_000;
const books = Object.fromEntries(Object.entries(marks).map(([s, m]) => [s, { bid: (+m * 0.9997).toFixed(4), ask: (+m * 1.0003).toFixed(4), timeMs: now - 1000 }]));
const targets = [
  { symbol: "SPCX-USD", name: "SpaceX", weight: 0.25 },
  { symbol: "ZHIPU-USD", name: "Zhipu AI", weight: 0.25 },
  { symbol: "UNITREE-USD", name: "Unitree Robotics", weight: 0.25 },
  { symbol: "MINIMAX-USD", name: "MiniMax", weight: 0.25 },
];
const base = (amountUsd: number, over: Partial<PreviewInput> = {}): PreviewInput => ({
  targets, amountUsd, marks, books, filters, takerFeeBps: 5, nowMs: now,
  params: { grossExposure: 0.9, minNotionalBuffer: 1.2, maxLegNotional: 2000, maxRunNotional: 5000 },
  gateLimits: { maxSpreadBps: 50, maxMarkMidDeviationBps: 100, maxBookAgeSec: 60, indexFrozenMin: 30, blockOnFrozenIndex: false },
  ...over,
});

describe("previewOrders", () => {
  it("prices a $500 basket at the ask, with Strike's taker fee", () => {
    const p = previewOrders(base(500));
    expect(p.bookUsd).toBe("450.00");
    expect(p.legs.map((l) => l.symbol)).toEqual(targets.map((t) => t.symbol));
    const spcx = p.legs[0]!;
    expect(spcx).toMatchObject({ name: "SpaceX", qty: "0.72", price: books["SPCX-USD"]!.ask });
    expect(Number(spcx.feeUsd)).toBeCloseTo(Number(spcx.notionalUsd) * 0.0005, 2);
    const total = p.legs.reduce((s, l) => s + Number(l.notionalUsd), 0);
    expect(Number(p.totals.notionalUsd)).toBeCloseTo(total, 2);
    expect(total).toBeLessThanOrEqual(450.5);
    expect(p.allChecksOk).toBe(true);
  });

  it("explains amounts too small for Strike's minimum order", () => {
    const p = previewOrders(base(40));
    expect(p.minAmountUsd).toBe(54); // SPCX $10 min × 1.2 / (0.9 × 25%)
    expect(p.legs.find((l) => l.symbol === "SPCX-USD")).toBeUndefined();
    expect(p.skipped).toContainEqual(expect.objectContaining({ symbol: "SPCX-USD", reason: "BELOW_MIN_NOTIONAL" }));
  });

  it("applies the per-run cap the engine trades with", () => {
    const p = previewOrders(base(100_000));
    expect(Number(p.totals.notionalUsd)).toBeLessThanOrEqual(5000 * 1.001);
    expect(p.warnings.some((w) => w.startsWith("RUN_SCALED"))).toBe(true);
  });

  it("flags a wide book in the market checks", () => {
    const wide = { ...books, "UNITREE-USD": { bid: "70", ask: "84", timeMs: now } };
    const p = previewOrders(base(500, { books: wide }));
    expect(p.allChecksOk).toBe(false);
    expect(p.gates.find((g) => g.symbol === "UNITREE-USD")!.ok).toBe(false);
  });

  it("minAmountFor matches personal mode's minimum for the testnet basket", () => {
    const f = { "BTC-USD": { stepSize: "0.00001", minQty: "0.00001", minNotional: "100", marketMaxQty: "120" }, "ETH-USD": { stepSize: "0.001", minQty: "0.001", minNotional: "10", marketMaxQty: "2000" } };
    expect(minAmountFor([{ symbol: "BTC-USD", weight: 0.5 }, { symbol: "ETH-USD", weight: 0.5 }], f, 0.9, 1.2)).toBe(267);
  });
});
