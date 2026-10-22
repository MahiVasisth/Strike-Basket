// Smoke test against running engines: every public, admin and personal-mode route.
// Usage: pnpm smoke            (expects `pnpm preipo` on :8787 and `pnpm testnet` on :8788)
// Env:   HERO_URL, TESTNET_URL, ADMIN_TOKEN (default mytesttoken12345)
// Safe to run any time: admin actions are a dry run plus a pause that is resumed straight away.

const HERO = process.env.HERO_URL ?? "http://localhost:8787";
const TESTNET = process.env.TESTNET_URL ?? "http://localhost:8788";
const TOKEN = process.env.ADMIN_TOKEN ?? "mytesttoken12345";

let pass = 0, fail = 0;
const ok = (name, detail = "") => { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? `  \x1b[2m${detail}\x1b[0m` : ""}`); };
const bad = (name, detail = "") => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}  ${detail}`); };

async function call(base, path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: null, error: e.cause?.code ?? e.message };
  }
}

async function check(name, base, path, opts, expect) {
  const r = await call(base, path, opts);
  if (r.status === 0) return bad(name, `can't reach ${base} (${r.error}). Is the engine running?`), r;
  const msg = expect(r);
  if (msg === true || msg === undefined) ok(name);
  else if (typeof msg === "string" && msg.startsWith("ok:")) ok(name, msg.slice(3));
  else bad(name, `${msg} (HTTP ${r.status}${r.json?.error ? `: ${r.json.error}` : ""})`);
  return r;
}

/** /api/state is 503 until the first cycle completes: wait up to 90 s. */
async function waitForState(base) {
  for (let i = 0; i < 45; i++) {
    const r = await call(base, "/api/state");
    if (r.status === 200) return r;
    if (r.status === 0) return r;
    await new Promise((res) => setTimeout(res, 2000));
  }
  return call(base, "/api/state");
}

/** Open the SSE stream and wait for its first frame. */
async function checkStream(name, base) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(base + "/api/stream", { signal: ctrl.signal });
    const type = res.headers.get("content-type") ?? "";
    const reader = res.body.getReader();
    const { value } = await reader.read();
    const first = new TextDecoder().decode(value ?? new Uint8Array());
    ctrl.abort();
    if (type.includes("text/event-stream") && first.includes("retry:")) ok(name, "event-stream open");
    else bad(name, `unexpected stream start: ${type} ${first.slice(0, 40)}`);
  } catch (e) {
    if (e.name === "AbortError") bad(name, "no data within 5 s");
    else bad(name, e.cause?.code ?? e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function instance(label, base, { personal }) {
  console.log(`\n\x1b[1m${label}\x1b[0m  ${base}`);

  const h = await check("health", base, "/api/health", {}, (r) => r.status === 200 && r.json?.ok !== undefined
    ? `ok:env=${r.json.env} mode=${r.json.mode} source=${r.json.source} paused=${r.json.paused}${r.json.lastError ? ` lastError=${r.json.lastError}` : ""}`
    : "expected 200 with ok/env/mode");
  if (h.status === 0) return;

  const b = await check("basket", base, "/api/basket", {}, (r) => r.status === 200 && r.json?.constituents?.length
    ? `ok:${r.json.name} v${r.json.version}: ${r.json.constituents.map((c) => c.symbol).join(", ")}`
    : "expected constituents");
  await check("rules", base, "/api/basket", {}, (r) => r.json?.rules?.grossExposure <= 1
    ? `ok:gross ${r.json.rules.grossExposure}× · drift ${r.json.rules.driftThresholdBps} bps · spread ≤ ${r.json.rules.gates.maxSpreadBps} bps`
    : "gross exposure must be ≤ 1");
  await check("baskets list", base, "/api/baskets", {}, (r) => Array.isArray(r.json) && r.json.some((x) => x.status === "live")
    ? `ok:${r.json.map((x) => `${x.id}(${x.status})`).join(", ")}` : "expected one live basket");

  const s = await waitForState(base);
  if (s.status !== 200) bad("state", `HTTP ${s.status} after waiting 90 s`);
  else {
    const st = s.json;
    const sum = st.weights.reduce((a, w) => a + w.targetWeight, 0);
    ok("state", `equity ${st.equity} · max drift ${st.maxDriftBps} bps · ${st.weights.length} markets`);
    Math.abs(sum - 1) < 1e-6 ? ok("target weights sum to 100%") : bad("target weights sum to 100%", `got ${sum}`);
    const failing = st.gates.filter((g) => !g.ok);
    failing.length === 0
      ? ok("market checks", st.gates.map((g) => `${g.symbol} ${g.spreadBps?.toFixed(1)}bps`).join(" · "))
      : ok("market checks (some blocked, engine will hold)", failing.map((g) => `${g.symbol}: ${g.failures.join(",")}`).join(" · "));
  }

  await check("snapshots", base, `/api/snapshots?since=${Date.now() - 86_400_000}`, {}, (r) => Array.isArray(r.json) ? `ok:${r.json.length} in the last 24 h` : "expected array");
  const runs = await check("rebalance log", base, "/api/rebalances?limit=20", {}, (r) => Array.isArray(r.json)
    ? `ok:${r.json.length} runs${r.json[0] ? `, latest: ${r.json[0].trigger} → ${r.json[0].status}` : ""}` : "expected array");
  // A run that actually sent orders (dry runs and gated runs plan legs but send none).
  const withLegs = runs.json?.find((x) => x.legCount > 0 && ["done", "partial", "failed"].includes(x.status));
  if (withLegs) {
    await check("rebalance detail", base, `/api/rebalances/${withLegs.id}`, {}, (r) => r.json?.legs?.length
      ? `ok:${r.json.legs.length} legs · ids ${r.json.legs.map((l) => l.strikeOrderId ?? l.clientOrderId).join(", ")}` : "expected legs");
  } else ok("rebalance detail", "skipped: no run with orders yet");
  await check("unknown rebalance → 404", base, "/api/rebalances/does-not-exist", {}, (r) => r.status === 404 || "expected 404");
  await check("events", base, "/api/events?limit=5", {}, (r) => Array.isArray(r.json) || "expected array");
  await checkStream("live stream (SSE)", base);

  // ---- admin ----
  await check("admin without token → 401", base, "/api/admin/pause", { method: "POST" }, (r) => r.status === 401 || "expected 401");
  await check("admin wrong token → 401", base, "/api/admin/pause", { method: "POST", token: "wrong-token-123456" }, (r) => r.status === 401 || "expected 401");
  const dry = await check("admin dry run", base, "/api/admin/rebalance", { method: "POST", token: TOKEN, body: { force: true, dryRun: true } },
    (r) => r.status === 200 ? `ok:status=${r.json.status} · ${r.json.legs.length} legs planned · ${r.json.skipped?.length ?? 0} skipped` : "expected 200 (check ADMIN_TOKEN)");
  if (dry.status === 200) {
    const wasPaused = h.json.paused;
    if (!wasPaused) {
      await check("flatten refused while running → 409", base, "/api/admin/flatten", { method: "POST", token: TOKEN }, (r) => r.status === 409 || "expected 409");
      await check("pause", base, "/api/admin/pause", { method: "POST", token: TOKEN }, (r) => r.json?.paused === true || "expected paused:true");
      await check("health shows paused", base, "/api/health", {}, (r) => r.json?.paused === true || "expected paused:true");
      await check("resume", base, "/api/admin/resume", { method: "POST", token: TOKEN }, (r) => r.json?.paused === false || "expected paused:false");
    } else ok("pause/resume", "skipped: engine is paused on purpose, left as is");
  }

  // ---- personal mode ----
  if (!personal) return;
  const p = await check("personal baskets", base, "/api/personal/baskets", {}, (r) => r.status === 200
    ? `ok:fee ${r.json.builderFeeBps} bps · ${r.json.baskets.map((x) => `${x.id}${x.available ? ` (min $${x.minBudgetUsd})` : " (n/a)"}`).join(", ")}`
    : "personal mode is off: start this engine with `pnpm testnet`");
  if (p.status !== 200) return;
  const avail = p.json.baskets.find((x) => x.available);
  if (avail) {
    await check("budget below minimum → 400", base, "/api/personal/connect/request", {
      method: "POST", body: { address: "0x0000000000000000000000000000000000000001", chain: "ethereum", basketId: avail.id, budgetUsd: 1 },
    }, (r) => r.status === 400 || "expected 400");
  }
  await check("bad request → 400", base, "/api/personal/connect/request", { method: "POST", body: { address: "x" } }, (r) => r.status === 400 || "expected 400");
  await check("my basket without token → 401", base, "/api/me", {}, (r) => r.status === 401 || "expected 401");
  await check("my basket bad token → 401", base, "/api/me", { token: "not-a-real-token" }, (r) => r.status === 401 || "expected 401");
}

console.log("Strike Baskets smoke test");
await instance("Pre-IPO engine", HERO, { personal: false });
await instance("Testnet engine", TESTNET, { personal: true });
console.log(`\n${fail === 0 ? "\x1b[32m" : "\x1b[31m"}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
