// Guided visual check: triggers each backend feature one at a time and tells you what to
// look for in the browser. Runs against the Pre-IPO engine (simulated fills, no real money).
// Usage: pnpm tour   (keep the site open at the main page while it runs)
// Env:   HERO_URL (default :8787), ADMIN_TOKEN (default mytesttoken12345), FRONTEND_URL

import { createInterface } from "node:readline/promises";

const HERO = process.env.HERO_URL ?? "http://localhost:8787";
const TOKEN = process.env.ADMIN_TOKEN ?? "mytesttoken12345";
const rl = createInterface({ input: process.stdin, output: process.stdout });

const B = (s) => `\x1b[1m${s}\x1b[0m`, G = (s) => `\x1b[32m${s}\x1b[0m`, Y = (s) => `\x1b[33m${s}\x1b[0m`, D = (s) => `\x1b[2m${s}\x1b[0m`;

const get = async (p) => (await fetch(HERO + p)).json();
const admin = async (p, body) => {
  const r = await fetch(HERO + p, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("wrong ADMIN_TOKEN: start the engine with `pnpm preipo` or set ADMIN_TOKEN");
  return { status: r.status, ...j };
};

let n = 0;
async function step(title, action, lookFor) {
  n++;
  console.log(`\n${B(`Step ${n}: ${title}`)}`);
  const result = await action();
  if (result) console.log(D(`  backend: ${result}`));
  console.log(Y("  Look at the browser, you should see:"));
  for (const l of lookFor) console.log(`   • ${l}`);
  const a = (await rl.question(`  ${G("Did you see it?")} [Enter = yes, n = no] `)).trim().toLowerCase();
  if (a === "n" || a === "no") failures.push(`Step ${n}: ${title}`);
}
const failures = [];

// ---------------------------------------------------------------------------

let health;
try {
  health = await get("/api/health");
} catch {
  console.log(`\x1b[31mThe Pre-IPO engine isn't reachable at ${HERO}. Start it with \`pnpm preipo\`.\x1b[0m`);
  process.exit(1);
}
const front = process.env.FRONTEND_URL ?? "http://localhost:5174";
console.log(B("Strike Baskets: visual check"));
console.log(`Open ${B(front)} (the main Pre-IPO page) next to this terminal, then press Enter.`);
console.log(D("Everything here uses the Pre-IPO basket's simulated fills. No real orders, no real money."));
await rl.question("");
if (health.paused) await admin("/api/admin/resume");

await step(
  "Live data is flowing",
  async () => {
    const s = await get("/api/state");
    return `equity $${Number(s.equity).toFixed(2)} · max drift ${(Math.abs(s.maxDriftBps) / 100).toFixed(2)}%`;
  },
  [
    "Status line: green dot, \"Engine alive. Checked …s ago, next check in …\"; the seconds count",
    "The ring's centre shows about the same equity as above",
    "Ticker strip: 4 markets, each with a price and \"passes\"",
  ],
);

await step(
  "Pause the engine",
  async () => `paused=${(await admin("/api/admin/pause")).paused}`,
  [
    "A notice in the bottom-right corner: \"Engine paused. No orders until it resumes.\"",
    "A red \"Paused\" pill next to the status line (no page refresh needed)",
  ],
);

await step(
  "Flatten: close every position (only allowed while paused)",
  async () => {
    const r = await admin("/api/admin/flatten");
    return `status=${r.status} · ${r.legs?.length ?? 0} sell orders`;
  },
  [
    "The \"Rebalancing…\" line flashes under the top bar, then a notice \"Rebalance finished\"",
    "Within about a minute, the ring's coloured arcs shrink away (positions are now 0%)",
    "Holdings: every current weight goes to 0.0%; drift turns red",
    "Rebalance log: a new \"Manual · 4 orders\" entry at the top (that's the flatten: 4 sells)",
  ],
);

await step(
  "Resume: the bot rebuilds the basket",
  async () => `paused=${(await admin("/api/admin/resume")).paused} · next check within ${health.cycleSeconds}s`,
  [
    "Notice: \"Engine resumed.\" and the Paused pill disappears",
    `Within ${health.cycleSeconds}s: "Rebalancing…", then the ring's four arcs grow back to about 25% each`,
    "Rebalance log: a new \"First allocation\" entry with 4 orders, status done",
  ],
);

await step(
  "Open the new rebalance",
  async () => {
    const runs = await get("/api/rebalances?limit=5");
    const r = runs.find((x) => x.trigger === "initial") ?? runs[0];
    return r ? `latest: ${r.trigger} → ${r.status} (${r.id})` : "no runs yet";
  },
  [
    "Click the \"First allocation\" row in the Rebalance log",
    "Title \"First allocation, filled\"; before bar empty, target bar in 4 colours",
    "Orders table: 4 buys, method batch, filled qty @ price, \"simulated\", IDs like paper-N",
    "Click Copy on an ID: it turns into \"Copied\"",
  ],
);

await step(
  "Manual rebalance (already on target, so nothing to trade)",
  async () => {
    const r = await admin("/api/admin/rebalance", { force: true });
    return `status=${r.status} · ${r.legs?.length ?? 0} orders`;
  },
  [
    "Go back to the main page",
    "Rebalance log: a new \"Manual\" entry (usually \"nothing tradable\" or \"done\")",
  ],
);

await step(
  "Pages that read the other engine",
  async () => "",
  [
    "Testnet vault (top nav): name \"Crypto Majors (testnet)\", blue TESTNET badge, BTC/ETH ring",
    "Connect wallet (top right): 3 steps, Crypto Majors \"From $267\", fee \"0.10% per trade\"",
    "How it works: 3 numbered cards, \"How it uses Strike\", rules",
    "Admin (/admin): enter token, Dry run shows a result card",
  ],
);

console.log();
if (failures.length === 0) console.log(G(B("Everything you checked appeared in the UI.")));
else {
  console.log(`\x1b[31m${B("Not seen:")}\x1b[0m`);
  for (const f of failures) console.log(`  • ${f}`);
  console.log(D("Tip: refresh the page; check both engine terminals for lines that aren't statusCode 200."));
}
rl.close();
