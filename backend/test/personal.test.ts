import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/api/server.js";
import { loadConfig } from "../src/config.js";
import { loadAllBaskets, loadBasket } from "../src/core/basket.js";
import { Store } from "../src/db/db.js";
import { BasketEngine } from "../src/engine/engine.js";
import { EventBus } from "../src/engine/events.js";
import { PersonalManager } from "../src/personal/manager.js";
import { decryptSecret, encryptSecret } from "../src/personal/secrets.js";
import { StrikeClient } from "../src/strike/client.js";

const SECRET = "11".repeat(32);
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** A fake Strike testnet over fetch. Verifies real Ed25519 request signatures for the linked key. */
function fakeStrike() {
  const marks: Record<string, string> = { "BTC-USD": "80000", "ETH-USD": "2400", "XRP-USD": "0.5" };
  const positions = new Map<string, number>([["XRP-USD", 500]]); // the user's own, non-basket position
  const orders = new Map<string, unknown>();
  const batches: Array<{ headers: Record<string, string>; body: any }> = [];
  let linkedKey: string | null = null;
  let pendingKey: string | null = null;

  const filters = (symbol: string, step: string) => ({
    symbol,
    status: "trading",
    filters: [
      { filterType: "PRICE_FILTER", tickSize: "0.01" },
      { filterType: "LOT_SIZE", stepSize: step, minQty: step, maxQty: "100000" },
      { filterType: "MARKET_LOT_SIZE", stepSize: step, minQty: step, maxQty: "100000" },
      { filterType: "MIN_NOTIONAL", notional: symbol === "BTC-USD" ? "100" : "10" },
    ],
  });

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const path = url.pathname;
    const method = init.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}));
    const bodyStr = (init.body as string) ?? "";
    const body = bodyStr ? JSON.parse(bodyStr) : null;

    if (headers["X-API-Wallet-Public-Key"]) {
      const pub = headers["X-API-Wallet-Public-Key"]!;
      if (pub !== linkedKey) return json(401, { error: "unknown api wallet" });
      const msg = `${method}:${path}${url.search}:${headers["X-API-Wallet-Timestamp"]}:${headers["X-API-Wallet-Nonce"]}:${createHash("sha256").update(bodyStr).digest("hex")}`;
      const key = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(pub, "hex")]), format: "der", type: "spki" });
      if (!verify(null, Buffer.from(msg), key, Buffer.from(headers["X-API-Wallet-Signature"]!, "hex"))) return json(401, { error: "bad signature" });
    }

    switch (`${method} ${path}`) {
      case "GET /price/v2/exchangeInfo":
        return json(200, { symbols: [filters("BTC-USD", "0.00001"), filters("ETH-USD", "0.001"), filters("XRP-USD", "0.1")] });
      case "GET /price/v2/markPrice":
        return json(200, Object.entries(marks).map(([s, p]) => ({ e: "markPriceUpdate", E: Date.now(), s, p, i: p, r: "0", T: 0 })));
      case "GET /price/v2/ticker/bookTicker":
        return json(200, Object.entries(marks).map(([symbol, p]) => ({ symbol, bidPrice: String(+p * 0.9999), askPrice: String(+p * 1.0001), bidQty: "9", askQty: "9", time: Date.now() })));
      case "POST /auth/builder/request-signature":
        if (body.code !== "mycode") return json(404, { error: "builder code not found" });
        pendingKey = body.public_key;
        return json(200, { nonce: "n-1", message_to_sign: `Sign to connect via ${body.code}` });
      case "POST /auth/builder/verify-signature":
        if (body.nonce !== "n-1" || body.wallet_signature !== "0xvalid-signature") return json(400, { error: "invalid signature" });
        linkedKey = pendingKey;
        return json(200, { account_id: "acc-1", builder_code: "mycode", fee_share_bps: 10, api_wallet_id: 7, api_wallet_public_key: linkedKey });
      case "GET /v2/account":
        return json(200, { account_id: "acc-1", margin_balance: "1000", wallet_balance: "1000", available_balance: "1000", unrealized_pnl: "0", symbol_settings: {} });
      case "GET /v2/positions":
        return json(200, { positions: [...positions].filter(([, n]) => n !== 0).map(([symbol, n]) => ({ symbol, size: String(n) })) });
      case "POST /v2/leverage":
      case "POST /v2/marginMode":
        return json(200, {});
      case "POST /v2/orders/batch": {
        batches.push({ headers, body });
        for (const o of body.orders) {
          positions.set(o.symbol, Math.round(((positions.get(o.symbol) ?? 0) + (o.side === "buy" ? 1 : -1) * Number(o.size)) * 1e8) / 1e8);
          orders.set(o.client_order_id, { status: "FILLED", order_id: `oid-${orders.size + 1}`, filled_size: o.size });
        }
        return json(200, { successful: body.orders.map((o: any) => ({ client_order_id: o.client_order_id })), failed: [] });
      }
      case "GET /v2/order":
        return json(200, orders.get(url.searchParams.get("client_order_id")!) ?? {});
    }
    return json(404, { error: `fake: no route ${method} ${path}` });
  }) as unknown as typeof fetch;

  return { fetchImpl, positions, batches };
}

async function setup(env: Record<string, string> = {}) {
  const fake = fakeStrike();
  const cfg = loadConfig({
    STRIKE_ENV: "testnet",
    PERSONAL_MODE: "yes",
    BUILDER_CODE: "mycode",
    BUILDER_FEE_BPS: "10",
    PERSONAL_SECRET: SECRET,
    REBALANCE_COOLDOWN_MIN: "0",
    LOG_LEVEL: "silent",
    ...env,
  });
  const store = new Store(":memory:");
  const client = new StrikeClient(cfg, fake.fetchImpl);
  const bus = new EventBus(store);
  const engine = new BasketEngine(cfg, client, store, bus, loadBasket("crypto-majors"));
  const pm = new PersonalManager(cfg, client, store, new Map(loadAllBaskets().map((b) => [b.id, b])));
  const app = await buildServer(engine, bus, pm);
  return { app, pm, store, ...fake };
}

/** Confirming a connect starts the first allocation in the background; wait for it to land. */
async function firstRun(app: Awaited<ReturnType<typeof setup>>["app"], auth: Record<string, string>) {
  for (let i = 0; i < 100; i++) {
    const runs = (await app.inject({ url: "/api/me/rebalances", headers: auth })).json();
    if (runs.length && runs[0].status !== "executing") return runs[0];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("first allocation never ran");
}

async function connect(app: Awaited<ReturnType<typeof setup>>["app"], budgetUsd = 500) {
  const req = await app.inject({ method: "POST", url: "/api/personal/connect/request", payload: { address: "0x1234567890abcdef1234567890abcdef12345678", chain: "ethereum", basketId: "crypto-majors", budgetUsd } });
  expect(req.statusCode).toBe(200);
  const { connectId, messageToSign } = req.json();
  expect(messageToSign).toContain("mycode");
  const conf = await app.inject({ method: "POST", url: "/api/personal/connect/confirm", payload: { connectId, signature: "0xvalid-signature" } });
  expect(conf.statusCode).toBe(200);
  return conf.json().token as string;
}

describe("personal mode (Builder Connect, fake Strike testnet)", () => {
  it("lists only baskets whose markets exist, with a minimum budget", async () => {
    const { app } = await setup();
    const r = (await app.inject({ url: "/api/personal/baskets" })).json();
    const crypto = r.baskets.find((b: any) => b.id === "crypto-majors");
    expect(crypto).toMatchObject({ available: true, minBudgetUsd: 267 }); // BTC $100 min × 1.2 / (0.9 × 0.5)
    expect(r.baskets.find((b: any) => b.id === "preipo").available).toBe(false);
  });

  it("rejects a budget below Strike's minimum order sizes", async () => {
    const { app } = await setup();
    const r = await app.inject({ method: "POST", url: "/api/personal/connect/request", payload: { address: "0x1234567890abcdef1234567890abcdef12345678", chain: "ethereum", basketId: "crypto-majors", budgetUsd: 100 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/at least \$267/);
  });

  it("connects, then trades the user's own account with signed requests and the builder fee", async () => {
    const { app, positions, batches } = await setup();
    const token = await connect(app);
    const auth = { authorization: `Bearer ${token}` };

    const r = await firstRun(app, auth);
    expect(r).toMatchObject({ status: "done", trigger: "initial", mode: "live" });
    expect(batches).toHaveLength(1);
    expect(batches[0]!.headers["X-Builder-Fee-Bps"]).toBe("10");
    expect(batches[0]!.body.vault_id).toBeUndefined();
    // budget 500 × 0.9 × 50% = $225 per leg
    expect(positions.get("BTC-USD")).toBeCloseTo(225 / 80000, 4);
    expect(positions.get("ETH-USD")).toBeCloseTo(225 / 2400, 2);
    expect(positions.get("XRP-USD")).toBe(500); // the user's own position is untouched

    // Already on target: an explicit rebalance finds nothing to do.
    expect((await app.inject({ method: "POST", url: "/api/me/rebalance", headers: auth, payload: {} })).json().status).toBe("noop");
    const me = (await app.inject({ url: "/api/me", headers: auth })).json();
    expect(me.user).toMatchObject({ basketId: "crypto-majors", budgetUsd: 500, builderFeeBps: 10, status: "active" });
    expect(me.state.weights.map((w: any) => w.symbol)).toEqual(["BTC-USD", "ETH-USD"]);
  });

  it("keeps personal runs private", async () => {
    const { app } = await setup();
    const auth = { authorization: `Bearer ${await connect(app)}` };
    const run = await firstRun(app, auth);
    expect((await app.inject({ url: "/api/rebalances" })).json()).toEqual([]);
    expect((await app.inject({ url: `/api/rebalances/${run.id}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/me/rebalances/${run.id}`, headers: auth })).json().legs).toHaveLength(2);
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
  });

  it("pause blocks trading; flatten closes only basket positions", async () => {
    const { app, positions } = await setup();
    const auth = { authorization: `Bearer ${await connect(app)}` };
    await firstRun(app, auth);
    expect((await app.inject({ method: "POST", url: "/api/me/flatten", headers: auth })).statusCode).toBe(409);
    await app.inject({ method: "POST", url: "/api/me/pause", headers: auth });
    expect((await app.inject({ method: "POST", url: "/api/me/rebalance", headers: auth, payload: { force: true } })).json().status).toBe("paused");
    expect((await app.inject({ method: "POST", url: "/api/me/flatten", headers: auth })).json().status).toBe("done");
    expect(positions.get("BTC-USD")).toBe(0);
    expect(positions.get("ETH-USD")).toBe(0);
    expect(positions.get("XRP-USD")).toBe(500);
  });

  it("revoke stops trading and destroys the stored key", async () => {
    const { app, store } = await setup();
    const auth = { authorization: `Bearer ${await connect(app)}` };
    expect((await app.inject({ method: "DELETE", url: "/api/me", headers: auth })).json().revoked).toBe(true);
    expect((await app.inject({ url: "/api/me", headers: auth })).statusCode).toBe(401);
    const row = store.db.prepare("SELECT status, api_secret_enc FROM users").get() as { status: string; api_secret_enc: string | null };
    expect(row).toEqual({ status: "revoked", api_secret_enc: null });
  });

  it("passes Strike's rejection through and expires single-use connects", async () => {
    const { app } = await setup();
    const req = (await app.inject({ method: "POST", url: "/api/personal/connect/request", payload: { address: "0x1234567890abcdef1234567890abcdef12345678", chain: "ethereum", basketId: "crypto-majors", budgetUsd: 500 } })).json();
    const bad = await app.inject({ method: "POST", url: "/api/personal/connect/confirm", payload: { connectId: req.connectId, signature: "0xforged-signature" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/invalid signature/);
    const again = await app.inject({ method: "POST", url: "/api/personal/connect/confirm", payload: { connectId: req.connectId, signature: "0xvalid-signature" } });
    expect(again.statusCode).toBe(410);
  });

  it("unknown builder code surfaces as a 400", async () => {
    const { app } = await setup({ BUILDER_CODE: "wrong" });
    const r = await app.inject({ method: "POST", url: "/api/personal/connect/request", payload: { address: "0x1234567890abcdef1234567890abcdef12345678", chain: "ethereum", basketId: "crypto-majors", budgetUsd: 500 } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/builder code not found/);
  });

  it("is blocked on mainnet by the write lock", async () => {
    const { app } = await setup({ STRIKE_ENV: "mainnet" });
    const r = await app.inject({ method: "POST", url: "/api/personal/connect/request", payload: { address: "0x1234567890abcdef1234567890abcdef12345678", chain: "ethereum", basketId: "crypto-majors", budgetUsd: 500 } });
    expect(r.statusCode).toBe(403);
  });

  it("encrypts secrets with AES-GCM and detects tampering", () => {
    const blob = encryptSecret("deadbeef", SECRET);
    expect(blob).not.toContain("deadbeef");
    expect(decryptSecret(blob, SECRET)).toBe("deadbeef");
    const tampered = Buffer.from(blob, "base64");
    tampered[tampered.length - 1]! ^= 1;
    expect(() => decryptSecret(tampered.toString("base64"), SECRET)).toThrow();
  });
});
