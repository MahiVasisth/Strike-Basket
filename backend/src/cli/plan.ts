// Shadow plan: compute the rebalance plan for a basket from live Strike data, send nothing.
//
//   pnpm plan                                   configured basket / env / vault
//   pnpm plan --basket preipo --env mainnet --equity 500
//   pnpm plan --force                           plan even inside the drift band

import { loadConfig } from "../config.js";
import { loadBasket } from "../core/basket.js";
import { Store } from "../db/db.js";
import { BasketEngine } from "../engine/engine.js";
import { EventBus } from "../engine/events.js";
import { StrikeClient } from "../strike/client.js";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const env: NodeJS.ProcessEnv = { ...process.env, EXECUTION_MODE: "shadow" };
if (opt("env")) env.STRIKE_ENV = opt("env");
if (opt("basket")) env.BASKET_ID = opt("basket");
if (opt("equity")) {
  env.SHADOW_EQUITY_USD = opt("equity");
  delete env.STRIKE_VAULT_ID; // explicit equity means a paper book
}
if (opt("vault")) env.STRIKE_VAULT_ID = opt("vault");

const cfg = loadConfig(env);
const basket = loadBasket(cfg.BASKET_ID);
const store = new Store(":memory:");
const engine = new BasketEngine(cfg, new StrikeClient(cfg), store, new EventBus(store), basket);
const r = await engine.tick({ force: args.includes("--force"), dryRun: true });
const s = engine.lastSnapshot!;

console.log(`\n${basket.name} (${cfg.STRIKE_ENV}, ${engine.source}) equity $${Number(s.equity).toFixed(2)}, book $${r.plan.bookNotional}\n`);
console.table(
  r.plan.rows.map((x) => ({
    symbol: x.symbol,
    mark: x.mark,
    target: `${(x.targetWeight * 100).toFixed(1)}%`,
    current: `${(x.currentWeight * 100).toFixed(1)}%`,
    driftBps: x.driftBps,
    qty: x.currentQty,
    targetQty: x.targetQty,
  })),
);
console.table(r.gates.map((g) => ({ symbol: g.symbol, ok: g.ok, spreadBps: g.spreadBps?.toFixed(1), markMidBps: g.markMidDeviationBps?.toFixed(1), issues: [...g.failures, ...g.warnings].join(" ") })));
console.log(`trigger: ${r.plan.trigger ?? "none"}   status: ${r.status}   max drift: ${r.plan.maxDriftBps} bps (threshold ${cfg.DRIFT_THRESHOLD_BPS})`);
if (r.plan.legs.length) console.table(r.plan.legs);
if (r.plan.skipped.length) console.table(r.plan.skipped);
if (r.plan.warnings.length) console.log("warnings:", r.plan.warnings.join(", "));
console.log("\nPLAN ONLY: no orders were sent.\n");
