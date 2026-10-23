// End-to-end check that the web app and both engines are wired together correctly.
// Opens the real site in headless Chrome, walks every page, and compares what's on screen
// with what the backend API returns. Also verifies admin actions reach the backend and that
// live (SSE) events reach the page.
//
// Usage: pnpm e2e   (needs `pnpm preipo`, `pnpm testnet` and the frontend dev server running)
// Env:   FRONTEND_URL (auto: :5173 then :5174), HERO_URL, TESTNET_URL, ADMIN_TOKEN, CHROME_PATH

import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const HERO = process.env.HERO_URL ?? "http://localhost:8787";
const TESTNET = process.env.TESTNET_URL ?? "http://localhost:8788";
const TOKEN = process.env.ADMIN_TOKEN ?? readFileSync(new URL("../../backend/data/admin-token.txt", import.meta.url), "utf8").trim();
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let pass = 0, fail = 0;
const ok = (n, d = "") => { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ""}`); };
const bad = (n, d = "") => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${n}  ${d}`); };
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

const api = async (base, path, init = {}) => {
  const res = await fetch(base + path, init);
  return { status: res.status, json: await res.json().catch(() => null) };
};
const admin = (base, path, body) =>
  api(base, path, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

async function findFrontend() {
  const candidates = process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : ["http://localhost:5173", "http://localhost:5174"];
  for (const u of candidates) {
    try {
      const r = await fetch(u);
      if (r.ok && (await r.text()).includes('id="root"')) return u;
    } catch { /* try the next one */ }
  }
  return null;
}

const FRONT = await findFrontend();
if (!FRONT) {
  console.log("\x1b[31mCan't find the frontend on :5173 or :5174. Start it with `pnpm dev` in frontend/, or set FRONTEND_URL.\x1b[0m");
  process.exit(1);
}
for (const [name, base] of [["Pre-IPO engine", HERO], ["Testnet engine", TESTNET]]) {
  const h = await api(base, "/api/health").catch(() => null);
  if (!h) { console.log(`\x1b[31m${name} isn't reachable at ${base}. Start it first.\x1b[0m`); process.exit(1); }
}

console.log(`Strike Baskets end-to-end check\n  frontend ${FRONT}\n  pre-IPO  ${HERO}\n  testnet  ${TESTNET}`);

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Record every backend call the page makes, and every console error.
const calls = [];
const consoleErrors = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.startsWith(HERO) || u.startsWith(TESTNET)) calls.push({ url: u.replace(/^https?:\/\/[^/]+/, ""), host: u.startsWith(HERO) ? "pre-ipo" : "testnet", status: r.status() });
});
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const text = () => page.locator("main").innerText();
const has = async (s, timeout = 8000) => page.getByText(s, { exact: false }).first().waitFor({ timeout }).then(() => true, () => false);
let wePaused = false;
const callsTo = (host, prefix) => calls.filter((c) => c.host === host && c.url.startsWith(prefix));

try {
  // ---------------- main page ----------------
  section("Main page  /");
  const basket = (await api(HERO, "/api/basket")).json;
  const state = (await api(HERO, "/api/state")).json;
  const runs = (await api(HERO, "/api/rebalances?limit=25")).json;
  await page.goto(FRONT + "/");
  await page.waitForTimeout(4500);

  (await has(basket.name)) ? ok("basket name from /api/basket", basket.name) : bad("basket name", `"${basket.name}" not on page`);
  (await has(basket.tagline)) ? ok("tagline from /api/basket") : bad("tagline", "not on page");
  // Mainnet without a vault is plan-only: an order preview instead of a paper book.
  const planOnly = basket.source === "paper" && basket.env === "mainnet";
  const badge = planOnly ? "plan only" : basket.source === "paper" ? "PAPER" : basket.env === "testnet" ? "TESTNET" : "MAINNET";
  (await has(badge)) ? ok("environment badge", badge) : bad("environment badge", `${badge} missing`);

  const body = await text();
  for (const c of basket.constituents) {
    const t = c.symbol.replace(/-USD$/, "");
    body.includes(t) ? ok(`ticker strip: ${t}`) : bad(`ticker strip: ${t}`, "missing");
  }
  if (planOnly) {
    const preview = (await api(HERO, "/api/preview?amount=500")).json;
    const card = await page.locator("section", { has: page.getByText("Order preview") }).first().innerText().catch(() => "");
    card ? ok("order preview card shown") : bad("order preview card", "missing");
    for (const l of preview.legs) {
      card.includes(l.name) && card.includes(l.qty.replace(/0+$/, "").replace(/\.$/, "")) ? ok(`preview order: ${l.name}`, `${l.qty} @ ${l.price}`) : bad(`preview order: ${l.name}`, "not on page");
    }
    card.includes("Nothing is traded") ? ok("preview says nothing is traded") : bad("plan-only wording", "missing");
    (await has("Preview amount")) && body.includes("$500.00") ? ok("ring centre shows the preview amount") : bad("ring centre", "no preview amount");
    !body.includes("Rebalance log") && !body.includes("Holdings against targets") ? ok("no paper book on the page") : bad("paper sections", "still shown");
  } else {
  // The ring's centre readout sits right after its "Basket equity" / "Share price" label.
  const centre = await page.getByText(/^(Basket equity|Share price)$/).first().locator("..").innerText().catch(() => "");
  const eqShown = (centre.match(/\$([\d,]+\.\d{2,4})/) ?? [])[1];
  const eqApi = Number(state.equity);
  if (eqShown && Math.abs(Number(eqShown.replace(/,/g, "")) - eqApi) / eqApi < 0.02) ok("equity matches /api/state", `page $${eqShown} · api $${eqApi.toFixed(2)}`);
  else bad("equity matches /api/state", `page ${eqShown ?? "none"} vs api ${eqApi}`);
  const driftPct = `${(Math.abs(state.maxDriftBps) / 100).toFixed(1)}%`;
  body.includes(`Max drift`) ? ok("drift pill from /api/state", `api max drift ${driftPct}`) : bad("drift pill", "missing");
  for (const w of state.weights) {
    const name = basket.constituents.find((c) => c.symbol === w.symbol)?.name ?? w.symbol;
    body.includes(name) ? ok(`holdings row: ${name}`, `${(w.currentWeight * 100).toFixed(1)}%`) : bad(`holdings row: ${name}`, "missing");
  }
  if (runs.length) {
    const logRows = await page.locator('a[href^="/rebalances/"]').count();
    logRows >= Math.min(runs.length, 1) ? ok("rebalance log from /api/rebalances", `${logRows} rows shown · ${runs.length} in api`) : bad("rebalance log", "no rows");
  }
  }
  (await has("Withdrawals")) ? ok("rules card from basket.rules") : bad("rules card", "missing");

  for (const p of ["/api/basket", "/api/health", "/api/state", "/api/snapshots", "/api/rebalances", "/api/stream"]) {
    const c = callsTo("pre-ipo", p);
    c.length && c.every((x) => x.status < 400) ? ok(`page called ${p}`, `HTTP ${c[0].status}`) : bad(`page called ${p}`, c.length ? `HTTP ${c.map((x) => x.status).join(",")}` : "never called");
  }
  const tn = callsTo("testnet", "/api/health");
  tn.length ? ok("page checked the testnet engine", "proof card + personal mode") : bad("testnet engine", "never called");
  (await has("Same engine, real orders")) ? ok("testnet proof card shown") : bad("testnet proof card", "missing");
  (await has("Connect wallet")) ? ok("Connect wallet shown (personal mode on)") : bad("Connect wallet", "missing: is the testnet engine running with personal mode?");

  // ---------------- live events (SSE) ----------------
  section("Live updates (backend → page)");
  const wasPaused = (await api(HERO, "/api/health")).json.paused;
  if (!wasPaused) {
    await admin(HERO, "/api/admin/pause");
    wePaused = true;
    (await has("Engine paused", 6000)) ? ok("pause on backend → notice on page", "via /api/stream") : bad("pause notice", "page didn't react within 6 s");
    (await has("Paused", 6000)) ? ok("Paused pill appears") : bad("Paused pill", "missing");
    await admin(HERO, "/api/admin/resume");
    (await has("Engine resumed", 6000)) ? ok("resume on backend → notice on page") : bad("resume notice", "missing");
  } else ok("live pause/resume", "skipped: engine was already paused");

  // ---------------- rebalance detail ----------------
  section("Rebalance detail  /rebalances/:id");
  // A run that actually sent orders (dry runs and gated runs plan legs but send none).
  const withLegs = runs.find((r) => r.legCount > 0 && ["done", "partial", "failed"].includes(r.status));
  if (withLegs) {
    const detail = (await api(HERO, `/api/rebalances/${withLegs.id}`)).json;
    await page.goto(`${FRONT}/rebalances/${withLegs.id}`);
    await page.waitForTimeout(2500);
    const t = await text();
    t.includes(withLegs.id) ? ok("run id shown", withLegs.id) : bad("run id", "missing");
    for (const l of detail.legs) {
      const id = l.strikeOrderId ?? l.clientOrderId;
      t.includes(id) ? ok(`order ${l.symbol} ${l.side}`, `id ${id} · ${l.status}`) : bad(`order ${l.symbol}`, `id ${id} not on page`);
    }
    const sim = detail.legs.some((l) => !l.strikeOrderId || l.strikeOrderId.startsWith("paper-"));
    if (sim) (t.includes("simulated") ? ok("paper orders labelled simulated") : bad("simulated label", "missing"));
    else (t.includes("Strike order ID") ? ok("real orders labelled Strike order ID") : bad("Strike order ID label", "missing"));
  } else ok("rebalance detail", "skipped: no run with orders yet");

  // ---------------- other pages ----------------
  section("Other pages");
  const tBasket = (await api(TESTNET, "/api/basket")).json;
  await page.goto(FRONT + "/testnet");
  (await has(tBasket.name)) ? ok("/testnet shows the testnet basket", tBasket.name) : bad("/testnet", `"${tBasket.name}" missing`);
  (await has("TESTNET")) ? ok("/testnet badge") : bad("/testnet badge", "missing");
  callsTo("testnet", "/api/state").length ? ok("/testnet reads the testnet engine") : bad("/testnet", "no call to testnet /api/state");

  await page.goto(FRONT + "/how");
  (await has("How it uses Strike")) ? ok("/how renders") : bad("/how", "missing content");

  const personal = (await api(TESTNET, "/api/personal/baskets")).json;
  await page.goto(FRONT + "/connect");
  const avail = personal.baskets.find((b) => b.available);
  if (avail) (await has(`From $${avail.minBudgetUsd}`)) ? ok("/connect shows minimum budget from backend", `${avail.name}: $${avail.minBudgetUsd}`) : bad("/connect minimum", "missing");
  (await has(`${(personal.builderFeeBps / 100).toFixed(2)}% per trade`)) ? ok("/connect fee from backend", `${personal.builderFeeBps} bps`) : bad("/connect fee", "missing");

  await page.goto(FRONT + "/me");
  await page.waitForTimeout(1000);
  page.url().endsWith("/connect") ? ok("/me without a wallet → /connect") : bad("/me redirect", page.url());

  // ---------------- admin page → backend ----------------
  section("Admin page  /admin  (page → backend)");
  await page.goto(FRONT + "/admin");
  await page.fill('input[type="password"]', TOKEN);
  await page.getByRole("button", { name: "Dry run" }).click();
  (await has("Dry run result")) ? ok("Dry run button → /api/admin/rebalance") : bad("Dry run", "no result shown (wrong ADMIN_TOKEN?)");
  if (!(await api(HERO, "/api/health")).json.paused) {
    wePaused = true;
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(800);
    (await api(HERO, "/api/health")).json.paused ? ok("Pause button → backend paused") : bad("Pause button", "backend not paused");
    await page.getByRole("button", { name: "Resume" }).click();
    await page.waitForTimeout(800);
    (await api(HERO, "/api/health")).json.paused ? bad("Resume button", "backend still paused") : ok("Resume button → backend running");
  }

  // ---------------- summary of traffic ----------------
  section("Network and console");
  const failed = calls.filter((c) => c.status >= 400 && !(c.url.startsWith("/api/me") && c.status === 401));
  failed.length === 0 ? ok("every backend call succeeded", `${calls.length} calls`) : bad("backend calls with errors", failed.map((c) => `${c.host} ${c.url} → ${c.status}`).slice(0, 5).join("; "));
  consoleErrors.length === 0 ? ok("no browser console errors") : bad("browser console errors", consoleErrors.slice(0, 3).join(" | "));
} catch (e) {
  bad("unexpected error", e.message);
} finally {
  // Never leave the engine paused because of this script (but don't resume a pause we didn't make).
  const h = await api(HERO, "/api/health").catch(() => null);
  if (wePaused && h?.json?.paused) await admin(HERO, "/api/admin/resume");
  await browser.close();
}

console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
