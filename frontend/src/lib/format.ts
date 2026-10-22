import type { Basket, Health, RunStatus } from "./api";

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? NaN : Number(v));

export function usd(v: string | number | null | undefined, digits = 2) {
  const x = n(v);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function price(v: string | number | null | undefined) {
  const x = n(v);
  if (!Number.isFinite(x)) return "—";
  const digits = x >= 1000 ? 2 : x >= 1 ? 3 : 5;
  return x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

export function qty(v: string | number | null | undefined) {
  const x = n(v);
  if (!Number.isFinite(x)) return "—";
  return x.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export const pct = (w: number, digits = 1) => `${(w * 100).toFixed(digits)}%`;
export const bpsAsPct = (bps: number, digits = 1) => `${(bps / 100).toFixed(digits)}%`;
export const signedBps = (bps: number) => `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${Math.abs(bps / 100).toFixed(2)}%`;

export function ago(ts: number | null | undefined, now = Date.now()) {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function until(ts: number | null | undefined, now = Date.now()) {
  if (!ts) return "—";
  const s = Math.round((ts - now) / 1000);
  if (s <= 0) return "now";
  if (s < 60) return `in ${s}s`;
  return `in ${Math.floor(s / 60)}m ${s % 60}s`;
}

export function dateTime(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const shortId = (id: string, keep = 6) => (id.length <= keep * 2 + 1 ? id : `${id.slice(0, keep)}…${id.slice(-4)}`);
export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const ticker = (symbol: string) => symbol.replace(/-USD$/, "");

/** Environment badge text, per docs/FRONTEND.md §1.1. */
export function envBadge(b: Pick<Basket, "env" | "mode" | "source">): { label: string; detail: string; tone: "paper" | "testnet" | "live" | "shadow" } {
  if (b.source === "paper" && b.env === "testnet") return { label: "TESTNET · PAPER", detail: "testnet prices, simulated fills", tone: "testnet" };
  if (b.source === "paper") return { label: "PAPER", detail: "live mainnet prices, simulated fills", tone: "paper" };
  if (b.env === "testnet" && b.mode === "live") return { label: "TESTNET", detail: "live Strike vault", tone: "testnet" };
  if (b.env === "mainnet" && b.mode === "live") return { label: "MAINNET", detail: "live vault", tone: "live" };
  return { label: "MAINNET", detail: "plan only (no orders sent)", tone: "shadow" };
}

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export function statusTone(s: RunStatus | string): Tone {
  switch (s) {
    case "done": case "filled": return "good";
    case "partial": case "executing": case "sent": case "pending": return "warn";
    case "failed": case "gated": case "rejected": return "bad";
    case "shadow": return "info";
    default: return "muted";
  }
}

export const triggerLabel: Record<string, string> = {
  initial: "First allocation",
  drift: "Drift rebalance",
  stray: "Stray position",
  force: "Manual",
  flatten: "Flatten",
};

/** "Engine alive" unless the last tick is more than two cycles old. */
export function engineStale(h: Health, now = Date.now()) {
  return !h.lastTickAt || now - h.lastTickAt > 2 * h.cycleSeconds * 1000;
}

/** Human text for the rebalancer's warning codes. */
export function warningText(code: string) {
  let m;
  if ((m = code.match(/^RUN_SCALED_TO_(\d+)PCT$/))) return `Run scaled to ${m[1]}% to stay inside the per-run cap`;
  if ((m = code.match(/^LEG_CAPPED_(.+)$/))) return `${ticker(m[1])} leg capped at the per-leg limit`;
  if ((m = code.match(/^NO_MARK_(.+)$/))) return `No mark price for ${ticker(m[1])}`;
  if ((m = code.match(/^THRESHOLD_BELOW_MIN_ORDER_(.+)_(\d+)BPS$/))) return `${ticker(m[1])}: Strike's minimum order is ${bpsAsPct(Number(m[2]))} of this basket, above the drift threshold`;
  if ((m = code.match(/^ACCOUNT_EQUITY_BELOW_BUDGET_(\d+)USD$/))) return `Your Strike account holds $${m[1]}, below your budget`;
  return code.replace(/_/g, " ").toLowerCase();
}

export function gateFailureText(code: string) {
  let m;
  if (code === "NO_BOOK") return "No order book";
  if (code === "CROSSED_BOOK") return "Crossed book";
  if ((m = code.match(/^SPREAD_(\d+)BPS$/))) return `Spread ${bpsAsPct(Number(m[1]), 2)}`;
  if ((m = code.match(/^MARK_OFF_BOOK_(\d+)BPS$/))) return `Mark ${bpsAsPct(Number(m[1]), 1)} off the book`;
  if ((m = code.match(/^BOOK_STALE_(\d+)S$/))) return `Book ${m[1]}s old`;
  return code.replace(/_/g, " ").toLowerCase();
}

export const skipText: Record<string, string> = {
  BELOW_MIN_NOTIONAL: "Below Strike's minimum order size",
  BELOW_MIN_QTY: "Below Strike's minimum quantity",
  STRAY_DUST: "Leftover position too small to close",
  NO_FILTERS: "No order-size filters from Strike",
};
