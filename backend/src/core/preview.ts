import { Decimal } from "decimal.js";
import { checkGate, type GateLimits, type GateResult } from "./gates.js";
import { planRebalance, type Filters, type PlanParams, type Target } from "./rebalancer.js";

// Order preview: "if you put $X into this basket right now, these are the orders the bot would place".
// The same planRebalance the engine trades with, on an empty book, priced at the live ask with Strike's
// taker fee. Pure and read-only: nothing is sent anywhere.

export interface PreviewBook {
  bid?: string;
  ask?: string;
  timeMs?: number;
}

export interface PreviewInput {
  targets: Array<Target & { name: string }>;
  amountUsd: number;
  marks: Record<string, string>;
  books: Record<string, PreviewBook>;
  filters: Record<string, Filters & { status?: string }>;
  params: Omit<PlanParams, "driftThresholdBps" | "force">;
  takerFeeBps: number;
  gateLimits: GateLimits;
  nowMs: number;
}

export interface PreviewLeg {
  symbol: string;
  name: string;
  weight: number;
  qty: string;
  mark: string;
  /** Estimated fill: the live ask (market buys take the ask). */
  price: string;
  notionalUsd: string;
  feeUsd: string;
}

export interface Preview {
  amountUsd: number;
  /** amount × gross exposure: what actually gets invested; the rest stays as margin headroom. */
  bookUsd: string;
  legs: PreviewLeg[];
  skipped: Array<{ symbol: string; reason: string; notionalUsd: string }>;
  totals: { notionalUsd: string; feeUsd: string; uninvestedUsd: string };
  /** Smallest amount at which every leg clears Strike's minimum order size. */
  minAmountUsd: number;
  gates: GateResult[];
  allChecksOk: boolean;
  warnings: string[];
}

export function minAmountFor(targets: Target[], filters: Record<string, Filters>, grossExposure: number, buffer: number): number {
  const mins = targets.map((t) => {
    const f = filters[t.symbol];
    return f ? new Decimal(f.minNotional).mul(buffer).div(grossExposure * t.weight).toNumber() : Infinity;
  });
  return Math.ceil(Math.max(...mins));
}

export function previewOrders(input: PreviewInput): Preview {
  const { targets, amountUsd, params } = input;
  const plan = planRebalance({
    targets,
    equity: String(amountUsd),
    positions: [],
    marks: input.marks,
    filters: input.filters,
    params: { ...params, driftThresholdBps: 1, force: true },
  });

  const names = new Map(targets.map((t) => [t.symbol, t]));
  const legs: PreviewLeg[] = plan.legs.map((l) => {
    const t = names.get(l.symbol)!;
    const ask = input.books[l.symbol]?.ask;
    const price = ask && Number(ask) > 0 ? new Decimal(ask) : new Decimal(l.mark);
    const notional = price.mul(l.qty);
    return {
      symbol: l.symbol,
      name: t.name,
      weight: t.weight,
      qty: l.qty,
      mark: l.mark,
      price: price.toString(),
      notionalUsd: notional.toFixed(2),
      feeUsd: notional.mul(input.takerFeeBps).div(10_000).toFixed(2),
    };
  });

  const notional = legs.reduce((s, l) => s.plus(l.notionalUsd), new Decimal(0));
  const fees = legs.reduce((s, l) => s.plus(l.feeUsd), new Decimal(0));
  const gates = targets.map((t) => {
    const b = input.books[t.symbol];
    const g = checkGate({ symbol: t.symbol, mark: input.marks[t.symbol] ?? "0", bid: b?.bid, ask: b?.ask, bookTimeMs: b?.timeMs, nowMs: input.nowMs }, input.gateLimits);
    if (input.filters[t.symbol]?.status && input.filters[t.symbol]!.status !== "trading") {
      g.ok = false;
      g.failures.push("NOT_TRADING");
    }
    return g;
  });

  return {
    amountUsd,
    bookUsd: plan.bookNotional,
    legs,
    skipped: plan.skipped.map((s) => ({ symbol: s.symbol, reason: s.reason, notionalUsd: s.deltaNotional })),
    totals: {
      notionalUsd: notional.toFixed(2),
      feeUsd: fees.toFixed(2),
      uninvestedUsd: new Decimal(amountUsd).minus(notional).minus(fees).toFixed(2),
    },
    minAmountUsd: minAmountFor(targets, input.filters, params.grossExposure, params.minNotionalBuffer),
    gates,
    allChecksOk: gates.every((g) => g.ok),
    warnings: plan.warnings.filter((w) => !w.startsWith("THRESHOLD_BELOW_MIN_ORDER")),
  };
}
