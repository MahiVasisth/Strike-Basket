import { Decimal } from "decimal.js";

// Pure rebalancer: target weights + current positions + marks + exchange filters -> order plan.
// No I/O. Every number that crosses this boundary is a decimal string.

export interface Target {
  symbol: string;
  weight: number;
}

export interface Filters {
  stepSize: string;
  minQty: string;
  minNotional: string;
  marketMaxQty: string;
}

export interface PlanParams {
  /** Target sum of |notional| / equity. Capped at 1 (no leverage) by config. */
  grossExposure: number;
  /** Rebalance when any |current - target| weight exceeds this many bps of the book. */
  driftThresholdBps: number;
  /** Legs must clear minNotional * buffer, so fees and mark moves don't push them under. */
  minNotionalBuffer: number;
  maxLegNotional: number;
  maxRunNotional: number;
  force?: boolean;
}

export interface PlanInput {
  targets: Target[];
  equity: string;
  positions: Array<{ symbol: string; size: string }>;
  marks: Record<string, string>;
  filters: Record<string, Filters>;
  params: PlanParams;
}

export type Trigger = "initial" | "drift" | "stray" | "force";

export interface Row {
  symbol: string;
  inBasket: boolean;
  targetWeight: number;
  currentWeight: number;
  driftBps: number;
  mark: string;
  currentQty: string;
  currentNotional: string;
  targetQty: string;
  targetNotional: string;
}

export interface Leg {
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  notional: string;
  mark: string;
  reduceOnly: boolean;
  reason: "rebalance" | "close_stray";
}

export interface Skipped {
  symbol: string;
  deltaQty: string;
  deltaNotional: string;
  reason: string;
}

export interface Plan {
  equity: string;
  bookNotional: string;
  rows: Row[];
  maxDriftBps: number;
  trigger: Trigger | null;
  legs: Leg[];
  skipped: Skipped[];
  warnings: string[];
}

const ZERO = new Decimal(0);

/** Round toward zero to a multiple of step. */
export function roundToStep(qty: Decimal, step: string): Decimal {
  const s = new Decimal(step);
  return qty.div(s).trunc().mul(s);
}

function fmt(d: Decimal, step?: string): string {
  if (step) return d.toFixed(new Decimal(step).decimalPlaces());
  return d.toFixed(2);
}

export function planRebalance(input: PlanInput): Plan {
  const { targets, params } = input;
  const warnings: string[] = [];
  const equity = new Decimal(input.equity);
  const book = Decimal.max(equity, 0).mul(params.grossExposure);

  const posBySymbol = new Map<string, Decimal>();
  for (const p of input.positions) {
    const size = new Decimal(p.size);
    if (!size.isZero()) posBySymbol.set(p.symbol, (posBySymbol.get(p.symbol) ?? ZERO).plus(size));
  }

  const targetBySymbol = new Map(targets.map((t) => [t.symbol, t.weight]));
  const symbols = [...targets.map((t) => t.symbol), ...[...posBySymbol.keys()].filter((s) => !targetBySymbol.has(s))];

  const rows: Row[] = [];
  const deltas: Array<{ symbol: string; delta: Decimal; current: Decimal; mark: Decimal; inBasket: boolean }> = [];

  for (const symbol of symbols) {
    const markStr = input.marks[symbol];
    if (!markStr || new Decimal(markStr).lte(0)) {
      warnings.push(`NO_MARK_${symbol}`);
      continue;
    }
    const mark = new Decimal(markStr);
    const inBasket = targetBySymbol.has(symbol);
    const tw = targetBySymbol.get(symbol) ?? 0;
    const current = posBySymbol.get(symbol) ?? ZERO;
    const curNotional = current.mul(mark);
    const tgtNotional = book.mul(tw);
    const tgtQty = tgtNotional.div(mark);
    const cw = book.gt(0) ? curNotional.div(book).toNumber() : 0;
    const step = input.filters[symbol]?.stepSize;

    rows.push({
      symbol,
      inBasket,
      targetWeight: tw,
      currentWeight: cw,
      driftBps: Math.round((cw - tw) * 10_000),
      mark: markStr,
      currentQty: current.toString(),
      currentNotional: fmt(curNotional),
      targetQty: fmt(tgtQty, step),
      targetNotional: fmt(tgtNotional),
    });
    deltas.push({ symbol, delta: tgtQty.minus(current), current, mark, inBasket });
  }

  const maxDriftBps = rows.reduce((m, r) => Math.max(m, Math.abs(r.driftBps)), 0);
  const hasStray = rows.some((r) => !r.inBasket && !new Decimal(r.currentQty).isZero());
  const isEmpty = [...posBySymbol.keys()].length === 0;

  let trigger: Trigger | null = null;
  if (params.force) trigger = "force";
  else if (isEmpty && book.gt(0)) trigger = "initial";
  else if (hasStray) trigger = "stray";
  else if (maxDriftBps >= params.driftThresholdBps) trigger = "drift";

  // Advisory: a drift threshold smaller than the smallest tradable leg can never execute cleanly.
  for (const t of targets) {
    const f = input.filters[t.symbol];
    if (!f || book.lte(0)) continue;
    const minLegBps = new Decimal(f.minNotional).mul(params.minNotionalBuffer).div(book).mul(10_000).toNumber();
    if (minLegBps > params.driftThresholdBps) {
      warnings.push(`THRESHOLD_BELOW_MIN_ORDER_${t.symbol}_${Math.ceil(minLegBps)}BPS`);
    }
  }

  const legs: Leg[] = [];
  const skipped: Skipped[] = [];
  if (!trigger) return { equity: equity.toString(), bookNotional: fmt(book), rows, maxDriftBps, trigger, legs, skipped, warnings };

  const gross = deltas.reduce((s, d) => s.plus(d.delta.abs().mul(d.mark)), ZERO);
  const scale = gross.gt(params.maxRunNotional) ? new Decimal(params.maxRunNotional).div(gross) : new Decimal(1);
  if (scale.lt(1)) warnings.push(`RUN_SCALED_TO_${scale.mul(100).toFixed(0)}PCT`);

  for (const d of deltas) {
    const f = input.filters[d.symbol];
    if (!f) {
      skipped.push({ symbol: d.symbol, deltaQty: d.delta.toString(), deltaNotional: fmt(d.delta.mul(d.mark)), reason: "NO_FILTERS" });
      continue;
    }
    let qty = d.delta.mul(scale);
    const legCapQty = new Decimal(params.maxLegNotional).div(d.mark);
    const capQty = Decimal.min(legCapQty, new Decimal(f.marketMaxQty));
    if (qty.abs().gt(capQty)) {
      warnings.push(`LEG_CAPPED_${d.symbol}`);
      qty = capQty.mul(qty.s);
    }
    qty = roundToStep(qty, f.stepSize);
    const notional = qty.abs().mul(d.mark);
    const minLeg = new Decimal(f.minNotional).mul(params.minNotionalBuffer);

    const skip = (reason: string) =>
      skipped.push({ symbol: d.symbol, deltaQty: fmt(qty, f.stepSize), deltaNotional: fmt(notional), reason });

    if (qty.isZero()) continue;
    if (qty.abs().lt(f.minQty)) {
      skip("BELOW_MIN_QTY");
      continue;
    }
    if (notional.lt(minLeg)) {
      skip(d.inBasket ? "BELOW_MIN_NOTIONAL" : "STRAY_DUST");
      continue;
    }
    const reduceOnly = !d.current.isZero() && qty.s !== d.current.s && qty.abs().lte(d.current.abs());
    legs.push({
      symbol: d.symbol,
      side: qty.gt(0) ? "buy" : "sell",
      qty: fmt(qty.abs(), f.stepSize),
      notional: fmt(notional),
      mark: d.mark.toString(),
      reduceOnly,
      reason: d.inBasket ? "rebalance" : "close_stray",
    });
  }

  // Reductions first, so they free margin before the buys.
  legs.sort((a, b) => Number(b.reduceOnly) - Number(a.reduceOnly));

  return { equity: equity.toString(), bookNotional: fmt(book), rows, maxDriftBps, trigger, legs, skipped, warnings };
}
