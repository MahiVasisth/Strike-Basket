import { Decimal } from "decimal.js";

// Market-quality gates checked before any rebalance. Pure: callers pass in observed data.
//
// Why not "mark age": Strike stamps every mark with the server time, so it always looks fresh.
// Off-hours stock and pre-IPO marks go bad in other ways: the book widens, the mark drifts from
// the book, or the index stops moving. Those are what we check.

export interface GateInput {
  symbol: string;
  mark: string;
  bid?: string;
  ask?: string;
  bookTimeMs?: number;
  nowMs: number;
  /** ms since the index price last changed, as tracked across cycles; undefined if unknown. */
  indexUnchangedForMs?: number;
}

export interface GateLimits {
  maxSpreadBps: number;
  maxMarkMidDeviationBps: number;
  maxBookAgeSec: number;
  indexFrozenMin: number;
  blockOnFrozenIndex: boolean;
}

export interface GateResult {
  symbol: string;
  ok: boolean;
  spreadBps: number | null;
  markMidDeviationBps: number | null;
  bookAgeSec: number | null;
  failures: string[];
  warnings: string[];
}

export function checkGate(g: GateInput, lim: GateLimits): GateResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  let spreadBps: number | null = null;
  let devBps: number | null = null;
  let bookAgeSec: number | null = null;

  if (!g.bid || !g.ask || new Decimal(g.bid).lte(0) || new Decimal(g.ask).lte(0)) {
    failures.push("NO_BOOK");
  } else {
    const bid = new Decimal(g.bid);
    const ask = new Decimal(g.ask);
    if (ask.lte(bid)) failures.push("CROSSED_BOOK");
    const mid = bid.plus(ask).div(2);
    spreadBps = ask.minus(bid).div(mid).mul(10_000).toNumber();
    devBps = new Decimal(g.mark).minus(mid).abs().div(mid).mul(10_000).toNumber();
    if (spreadBps > lim.maxSpreadBps) failures.push(`SPREAD_${Math.round(spreadBps)}BPS`);
    if (devBps > lim.maxMarkMidDeviationBps) failures.push(`MARK_OFF_BOOK_${Math.round(devBps)}BPS`);
  }

  if (g.bookTimeMs !== undefined) {
    bookAgeSec = (g.nowMs - g.bookTimeMs) / 1000;
    if (bookAgeSec > lim.maxBookAgeSec) failures.push(`BOOK_STALE_${Math.round(bookAgeSec)}S`);
  }

  if (g.indexUnchangedForMs !== undefined && g.indexUnchangedForMs > lim.indexFrozenMin * 60_000) {
    const tag = `INDEX_FROZEN_${Math.round(g.indexUnchangedForMs / 60_000)}MIN`;
    (lim.blockOnFrozenIndex ? failures : warnings).push(tag);
  }

  return { symbol: g.symbol, ok: failures.length === 0, spreadBps, markMidDeviationBps: devBps, bookAgeSec, failures, warnings };
}

/** Tracks when each symbol's index price last changed, across cycles. */
export class IndexWatch {
  private last = new Map<string, { index: string; changedAt: number }>();

  /** Returns ms the index has been unchanged, or undefined on the first observation. */
  observe(symbol: string, index: string, nowMs: number): number | undefined {
    const prev = this.last.get(symbol);
    if (!prev || prev.index !== index) {
      this.last.set(symbol, { index, changedAt: nowMs });
      return prev ? 0 : undefined;
    }
    return nowMs - prev.changedAt;
  }
}
