// Go/no-go checks against the configured Strike environment.
//
//   pnpm probe                         public checks + auth + vault lookup (read-only)
//   pnpm probe --settings              also set margin mode / leverage on the vault for basket symbols
//   pnpm probe --order BTC-USD         also place a min-size vault market buy, then close it (reduce-only)
//   pnpm probe --twap BTC-USD          also create a min-size vault TWAP, then cancel it
//
// Mainnet is read-only unless ALLOW_MAINNET_WRITES=yes (enforced in the client). Results are written to probe-report-<env>.json.

import { writeFileSync } from "node:fs";
import { Decimal } from "decimal.js";
import { loadConfig } from "../config.js";
import { loadBasket } from "../core/basket.js";
import { parseOrderState } from "../engine/executor.js";
import { sleep, StrikeClient, StrikeError } from "../strike/client.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const cfg = loadConfig({ ...process.env, EXECUTION_MODE: "shadow" });
const basket = loadBasket(opt("basket") ?? cfg.BASKET_ID);
const client = new StrikeClient(cfg);
const report: Record<string, unknown> = { env: cfg.STRIKE_ENV, basket: basket.id, at: new Date().toISOString(), steps: [] as unknown[] };
const steps = report.steps as Array<{ step: string; ok: boolean; detail: unknown }>;

function record(step: string, ok: boolean, detail: unknown) {
  steps.push({ step, ok, detail });
  const tag = ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`${tag}  ${step}`);
  if (detail !== undefined) console.log("      " + (typeof detail === "string" ? detail : JSON.stringify(detail, null, 2).replace(/\n/g, "\n      ")));
}

async function step<T>(name: string, fn: () => Promise<T>, show: (r: T) => unknown = (r) => r): Promise<T | undefined> {
  try {
    const r = await fn();
    record(name, true, show(r));
    return r;
  } catch (err) {
    record(name, false, err instanceof StrikeError ? { status: err.status, body: err.body } : String(err));
    return undefined;
  }
}

function minOrderQty(mark: string, stepSize: string, minQty: string, minNotional: string): string {
  const step = new Decimal(stepSize);
  const raw = new Decimal(minNotional).mul(1.15).div(mark);
  const q = Decimal.max(raw.div(step).ceil().mul(step), minQty);
  return q.toFixed(step.decimalPlaces());
}

const confirmed = cfg.STRIKE_ENV === "testnet" || cfg.ALLOW_MAINNET_WRITES;
console.log(`\nStrike Baskets probe: ${cfg.STRIKE_ENV}, basket ${basket.id}, vault ${cfg.STRIKE_VAULT_ID ?? "(none)"}\n`);

// ---------- 1. public ----------
await step("server time", async () => {
  const off = await client.syncClock();
  return `clock offset ${off} ms`;
});

const filters = await step("exchangeInfo", () => client.exchangeFilters(), (m) => `${m.size} symbols`);
const marks = await step("markPrice (all)", () => client.markPrices(), (m) => `${m.size} marks`);
const books = await step("bookTicker (all)", () => client.bookTickers(), (m) => `${m.size} books`);

let equityForAdvice = new Decimal(cfg.SHADOW_EQUITY_USD);
if (cfg.STRIKE_VAULT_ID) {
  const v = await step("vault (public)", () => client.vault(cfg.STRIKE_VAULT_ID!), (v) => ({
    name: v.name,
    status: v.status,
    equity: v.equity,
    share_price: v.share_price,
    leader_account_id: v.leader_account_id,
    commission_bps: v.leader_commission_bps,
  }));
  if (v) equityForAdvice = new Decimal(v.equity);
  await step("vault positions (public)", () => client.positions(cfg.STRIKE_VAULT_ID!), (p) => p.map((x) => `${x.symbol} ${x.size}`));
}

const book = equityForAdvice.mul(cfg.GROSS_EXPOSURE);
const markets: unknown[] = [];
let worstMinLegBps = 0;
for (const c of basket.constituents) {
  const f = filters?.get(c.symbol);
  const m = marks?.get(c.symbol);
  const b = books?.get(c.symbol);
  if (!f || !m) {
    record(`market ${c.symbol}`, false, "not listed on this environment");
    continue;
  }
  const t24 = await client.ticker24h(c.symbol).catch(() => ({}) as Record<string, string>);
  const bid = b ? new Decimal(b.bidPrice) : null;
  const ask = b ? new Decimal(b.askPrice) : null;
  const spreadBps = bid && ask && bid.gt(0) ? ask.minus(bid).div(ask.plus(bid).div(2)).mul(10_000).toFixed(1) : "n/a";
  const minLegBps = book.gt(0) ? new Decimal(f.minNotional).mul(cfg.MIN_NOTIONAL_BUFFER).div(book).mul(10_000).toNumber() : Infinity;
  worstMinLegBps = Math.max(worstMinLegBps, minLegBps);
  const row = {
    symbol: c.symbol,
    status: f.status,
    mark: m.p,
    spreadBps,
    vol24hUsd: t24.quoteVolume ? Number(t24.quoteVolume).toFixed(0) : "n/a",
    minNotional: f.minNotional,
    stepSize: f.stepSize,
    minOrderQty: minOrderQty(m.p, f.stepSize, f.minQty, f.minNotional),
    targetUsd: book.mul(c.weight).toFixed(2),
    minLegAsDriftBps: Math.ceil(minLegBps),
  };
  markets.push(row);
  record(`market ${c.symbol}`, f.status === "trading", row);
}
report.markets = markets;
const advice = `book $${book.toFixed(0)} → smallest tradable leg is ${Math.ceil(worstMinLegBps)} bps of book; DRIFT_THRESHOLD_BPS=${cfg.DRIFT_THRESHOLD_BPS}`;
record("drift threshold vs min order", cfg.DRIFT_THRESHOLD_BPS >= worstMinLegBps, advice);

// ---------- 2. auth ----------
if (!client.hasAuth) {
  console.log("\nNo API keys configured: skipping authenticated checks. Run `pnpm keygen`.\n");
} else {
  const acct = await step("auth: GET /v2/account", () => client.account(), (a) => ({ account_id: a.account_id, margin_balance: a.margin_balance }));
  if (cfg.STRIKE_VAULT_ID) {
    await step("auth + query signing: GET /v2/openOrders?vault_id=", () => client.openOrders(cfg.STRIKE_VAULT_ID), () => "ok");
  }
  if (acct) {
    await step("find my vault: GET /v2/vaults?leader_account_id=", () => client.vaults({ leader_account_id: acct.account_id }), (r) =>
      r.vaults.map((v) => ({ vault_id: v.vault_id, name: v.name, status: v.status, equity: v.equity })),
    );
  }

  // ---------- 3. vault leader writes ----------
  const vaultId = cfg.STRIKE_VAULT_ID;
  if ((flag("settings") || opt("order") || opt("twap")) && !vaultId) {
    record("vault writes", false, "STRIKE_VAULT_ID not set");
  } else if (vaultId) {
    if (flag("settings") && !confirmed) {
      record("vault settings", false, "mainnet is read-only (ALLOW_MAINNET_WRITES not set)");
    } else if (flag("settings")) {
      for (const c of basket.constituents) {
        await step(`margin mode ${cfg.MARGIN_MODE} ${c.symbol}`, () => client.setMarginMode(c.symbol, cfg.MARGIN_MODE, vaultId));
        await step(`leverage ${cfg.SYMBOL_LEVERAGE}x ${c.symbol}`, () => client.setLeverage(c.symbol, cfg.SYMBOL_LEVERAGE, vaultId));
      }
    }

    const orderSym = opt("order");
    if (orderSym) {
      if (!confirmed) record(`vault order ${orderSym}`, false, "mainnet is read-only (ALLOW_MAINNET_WRITES not set)");
      else {
        const f = filters?.get(orderSym);
        const m = marks?.get(orderSym);
        if (!f || !m) record(`vault order ${orderSym}`, false, "symbol not listed");
        else {
          const qty = minOrderQty(m.p, f.stepSize, f.minQty, f.minNotional);
          const coid = `bk-probe-${Date.now().toString(36)}`;
          const placed = await step(`vault market BUY ${qty} ${orderSym} (~$${new Decimal(qty).mul(m.p).toFixed(2)})`, () =>
            client.createOrder({ symbol: orderSym, side: "buy", type: "market", size: qty, slippage: String(cfg.MAX_SLIPPAGE), client_order_id: coid }, vaultId),
          );
          if (placed) {
            await sleep(2000);
            await step("lookup by client_order_id", () => client.getOrder(orderSym, coid, vaultId), (o) => ({ parsed: parseOrderState(o), raw: o }));
            await step("vault positions after buy", () => client.positions(vaultId), (p) => p.map((x) => `${x.symbol} ${x.size}`));
            await step(`vault reduce-only SELL ${qty} ${orderSym}`, () =>
              client.createOrder({ symbol: orderSym, side: "sell", type: "market", size: qty, reduce_only: true, slippage: String(cfg.MAX_SLIPPAGE), client_order_id: `${coid}-x` }, vaultId),
            );
          }
        }
      }
    }

    const twapSym = opt("twap");
    if (twapSym) {
      if (!confirmed) record(`vault TWAP ${twapSym}`, false, "mainnet is read-only (ALLOW_MAINNET_WRITES not set)");
      else {
        const f = filters?.get(twapSym);
        const m = marks?.get(twapSym);
        if (f && m) {
          // A TWAP is sliced, so each slice must clear min notional: size it at ~5 slices' worth.
          const qty = new Decimal(minOrderQty(m.p, f.stepSize, f.minQty, f.minNotional)).mul(5).toFixed(new Decimal(f.stepSize).decimalPlaces());
          const t = await step(`vault TWAP BUY ${qty} ${twapSym} over 300s (with vault_id)`, () =>
            client.createTwap({ symbol: twapSym, side: "BUY", total_size: qty, duration_sec: 300, vault_id: vaultId }),
          );
          const id = t ? String(t.strategy_id ?? t.id ?? t.twap_id ?? "") : "";
          if (id) {
            await step("TWAP status", () => client.getTwap(id));
            await step("cancel TWAP", () => client.cancelTwap(id));
            console.log("      NOTE: if any slices filled, the vault holds a small position; the engine's next plan will absorb it.");
          }
        }
      }
    }
  }
}

const file = `probe-report-${cfg.STRIKE_ENV}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));
const fails = steps.filter((s) => !s.ok).length;
console.log(`\n${steps.length - fails}/${steps.length} passed. Report: ${file}\n`);
process.exit(fails ? 1 : 0);
