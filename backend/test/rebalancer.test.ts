import { describe, expect, it } from "vitest";
import { planRebalance, roundToStep, type PlanInput } from "../src/core/rebalancer.js";
import { Decimal } from "decimal.js";

// Real mainnet filters/marks for the Pre-IPO basket (2026-10-22).
const filters = {
  "SPCX-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "10", marketMaxQty: "5000" },
  "ZHIPU-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "5", marketMaxQty: "2000" },
  "UNITREE-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "5", marketMaxQty: "2000" },
  "MINIMAX-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "5", marketMaxQty: "12000" },
  "WTI-USD": { stepSize: "0.01", minQty: "0.01", minNotional: "10", marketMaxQty: "500" },
};
const marks = { "SPCX-USD": "155.04", "ZHIPU-USD": "58.52", "UNITREE-USD": "77.00", "MINIMAX-USD": "20.56", "WTI-USD": "97" };
const targets = ["SPCX-USD", "ZHIPU-USD", "UNITREE-USD", "MINIMAX-USD"].map((symbol) => ({ symbol, weight: 0.25 }));
const params = { grossExposure: 0.9, driftThresholdBps: 500, minNotionalBuffer: 1.2, maxLegNotional: 2000, maxRunNotional: 5000 };

const base = (over: Partial<PlanInput> = {}): PlanInput => ({ targets, equity: "1000", positions: [], marks, filters, params, ...over });

describe("roundToStep", () => {
  it("rounds toward zero for both signs", () => {
    expect(roundToStep(new Decimal("1.239"), "0.01").toString()).toBe("1.23");
    expect(roundToStep(new Decimal("-1.239"), "0.01").toString()).toBe("-1.23");
    expect(roundToStep(new Decimal("7"), "1").toString()).toBe("7");
  });
});

describe("planRebalance", () => {
  it("allocates an empty vault to target weights (initial)", () => {
    const p = planRebalance(base());
    expect(p.trigger).toBe("initial");
    expect(p.bookNotional).toBe("900.00");
    expect(p.legs).toHaveLength(4);
    for (const leg of p.legs) {
      expect(leg.side).toBe("buy");
      expect(leg.reduceOnly).toBe(false);
      expect(Number(leg.notional)).toBeLessThanOrEqual(225);
      expect(Number(leg.notional)).toBeGreaterThan(220);
    }
    // SPCX 225 / 155.04 = 1.4512 -> 1.45
    expect(p.legs.find((l) => l.symbol === "SPCX-USD")!.qty).toBe("1.45");
  });

  it("does nothing when drift is under the threshold", () => {
    const positions = [
      { symbol: "SPCX-USD", size: "1.45" },
      { symbol: "ZHIPU-USD", size: "3.84" },
      { symbol: "UNITREE-USD", size: "2.92" },
      { symbol: "MINIMAX-USD", size: "10.94" },
    ];
    const p = planRebalance(base({ positions }));
    expect(p.trigger).toBeNull();
    expect(p.legs).toHaveLength(0);
    expect(p.maxDriftBps).toBeLessThan(500);
  });

  it("trims the winner and tops up the others on drift, reductions first", () => {
    const positions = [
      { symbol: "SPCX-USD", size: "2.2" }, // ~341 notional, way over 225
      { symbol: "ZHIPU-USD", size: "3.84" },
      { symbol: "UNITREE-USD", size: "2.92" },
      { symbol: "MINIMAX-USD", size: "10.94" },
    ];
    const p = planRebalance(base({ positions }));
    expect(p.trigger).toBe("drift");
    expect(p.legs[0]).toMatchObject({ symbol: "SPCX-USD", side: "sell", reduceOnly: true });
    // The others are within a few dollars of target -> below min notional, skipped not sent.
    expect(p.skipped.every((s) => s.reason === "BELOW_MIN_NOTIONAL")).toBe(true);
  });

  it("closes positions outside the basket", () => {
    const positions = [
      { symbol: "SPCX-USD", size: "1.45" },
      { symbol: "ZHIPU-USD", size: "3.84" },
      { symbol: "UNITREE-USD", size: "2.92" },
      { symbol: "MINIMAX-USD", size: "10.94" },
      { symbol: "WTI-USD", size: "-0.5" },
    ];
    const p = planRebalance(base({ positions }));
    expect(p.trigger).toBe("stray");
    expect(p.legs).toContainEqual(expect.objectContaining({ symbol: "WTI-USD", side: "buy", qty: "0.50", reduceOnly: true, reason: "close_stray" }));
  });

  it("caps legs and scales the run", () => {
    const p = planRebalance(base({ equity: "100000", params: { ...params, maxLegNotional: 1000, maxRunNotional: 3000 } }));
    expect(p.warnings).toContain("RUN_SCALED_TO_3PCT");
    const total = p.legs.reduce((s, l) => s + Number(l.notional), 0);
    expect(total).toBeLessThanOrEqual(3000);
  });

  it("warns when the drift threshold can't produce a tradable leg", () => {
    const p = planRebalance(base({ equity: "100", params: { ...params, driftThresholdBps: 200 } }));
    // book 90, SPCX min leg 12 -> 1334 bps
    expect(p.warnings.some((w) => w.startsWith("THRESHOLD_BELOW_MIN_ORDER_SPCX-USD"))).toBe(true);
  });

  it("force triggers even inside the band", () => {
    const p = planRebalance(base({ positions: [{ symbol: "SPCX-USD", size: "1.45" }], params: { ...params, force: true } }));
    expect(p.trigger).toBe("force");
  });

  it("never sizes the book above equity * grossExposure", () => {
    const p = planRebalance(base({ equity: "5000" }));
    const total = p.legs.reduce((s, l) => s + Number(l.notional), 0);
    expect(total).toBeLessThanOrEqual(4500);
  });
});
