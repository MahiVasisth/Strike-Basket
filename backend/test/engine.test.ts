import { buildServer } from "../src/api/server.js";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { parseBasket } from "../src/core/basket.js";
import { Store } from "../src/db/db.js";
import { BasketEngine } from "../src/engine/engine.js";
import { EventBus } from "../src/engine/events.js";
import { Executor, parseOrderState } from "../src/engine/executor.js";
import type { StrikeClient } from "../src/strike/client.js";

const basket = parseBasket({
  id: "t",
  version: 1,
  name: "T",
  tagline: "",
  status: "live",
  constituents: [
    { symbol: "AAA-USD", name: "A", weight: 0.5 },
    { symbol: "BBB-USD", name: "B", weight: 0.5 },
  ],
});

const filt = (symbol: string) => ({ symbol, status: "trading", tickSize: "0.01", stepSize: "0.01", minQty: "0.01", maxQty: "1000", marketMaxQty: "1000", minNotional: "5" });

/** In-memory Strike: market orders fill instantly at mark. */
function fakeStrike(opts: { spreadBad?: boolean } = {}) {
  const marks: Record<string, string> = { "AAA-USD": "100", "BBB-USD": "50" };
  const positions = new Map<string, number>();
  const orders = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const client = {
    hasAuth: true,
    syncClock: async () => 0,
    now: () => Date.now(),
    exchangeFilters: async () => new Map(Object.keys(marks).map((s) => [s, filt(s)])),
    markPrices: async () => new Map(Object.entries(marks).map(([s, p]) => [s, { e: "", E: 0, s, p, i: p, r: "0", T: 0 }])),
    bookTickers: async () =>
      new Map(
        Object.entries(marks).map(([s, p]) => {
          const w = opts.spreadBad ? 0.05 : 0.0002;
          return [s, { symbol: s, bidPrice: String(+p * (1 - w)), askPrice: String(+p * (1 + w)), bidQty: "1", askQty: "1", time: Date.now() }];
        }),
      ),
    // Mirrors Strike: GET /v2/vault/{id} reports depositors: 0, the portfolio endpoint has the real count.
    vault: async () => ({ vault_id: "v1", name: "Strike Baskets · Test", status: "active", share_price: "1.00", equity: "1000", total_shares: "1000", depositors: 0, min_deposit: "100", lockup_days: 1, leader_commission_bps: 1000 }),
    vaultPortfolio: async () => ({ depositors: 4 }),
    account: async () => ({ margin_balance: "1000", symbol_settings: {} }),
    positions: async () => [...positions].map(([symbol, size]) => ({ symbol, size: String(size) })),
    setMarginMode: async (s: string) => calls.push(`margin ${s}`),
    setLeverage: async (s: string) => calls.push(`lev ${s}`),
    batchOrders: async (os: any[]) => {
      calls.push(`batch ${os.length}`);
      for (const o of os) {
        positions.set(o.symbol, (positions.get(o.symbol) ?? 0) + (o.side === "buy" ? 1 : -1) * Number(o.size));
        orders.set(o.client_order_id, { status: "FILLED", order_id: `oid-${orders.size + 1}`, filled_size: o.size, avg_price: marks[o.symbol] });
      }
      return { successful: os.map((o) => ({ client_order_id: o.client_order_id })), failed: [] };
    },
    getOrder: async (_s: string, coid: string) => orders.get(coid)!,
  };
  return { client: client as unknown as StrikeClient, calls, positions, marks };
}

function setup(over: Record<string, string> = {}, fake = fakeStrike()) {
  const cfg = loadConfig({
    STRIKE_ENV: "testnet",
    EXECUTION_MODE: "live",
    STRIKE_API_PUBLIC_KEY: "a".repeat(64),
    STRIKE_API_PRIVATE_KEY: "b".repeat(64),
    STRIKE_VAULT_ID: "v1",
    REBALANCE_COOLDOWN_MIN: "0",
    ...over,
  });
  const store = new Store(":memory:");
  const engine = new BasketEngine(cfg, fake.client, store, new EventBus(store), basket);
  return { engine, store, ...fake };
}

describe("BasketEngine (live, fake Strike)", () => {
  it("allocates, confirms fills with order IDs, then idles inside the band", async () => {
    const { engine, store, calls, positions } = setup();
    const r1 = await engine.tick();
    expect(r1.status).toBe("done");
    expect(calls).toEqual(["margin AAA-USD", "lev AAA-USD", "margin BBB-USD", "lev BBB-USD", "batch 2"]);
    expect(positions.get("AAA-USD")).toBe(4.5); // 1000 * 0.9 * 0.5 / 100
    expect(positions.get("BBB-USD")).toBe(9);
    const legs = store.legsForRun(r1.runId);
    expect(legs.map((l) => l.status)).toEqual(["filled", "filled"]);
    expect(legs[0]!.strike_order_id).toMatch(/^oid-/);

    const r2 = await engine.tick();
    expect(r2.status).toBe("noop");
  });

  it("rebalances after a price move: reduce-only sell first", async () => {
    const { engine, marks } = setup();
    await engine.tick();
    marks["AAA-USD"] = "140"; // AAA weight rises well past 5 pts
    const r = await engine.tick();
    expect(r.plan.trigger).toBe("drift");
    expect(r.status).toBe("done");
    expect(r.plan.legs[0]).toMatchObject({ symbol: "AAA-USD", side: "sell", reduceOnly: true });
  });

  it("pause blocks execution but still records the plan", async () => {
    const { engine, store, calls } = setup();
    store.setPaused(true);
    const r = await engine.tick();
    expect(r.status).toBe("paused");
    expect(calls.filter((c) => c.startsWith("batch"))).toHaveLength(0);
  });

  it("bad books gate the run", async () => {
    const { engine, calls } = setup({}, fakeStrike({ spreadBad: true }));
    const r = await engine.tick();
    expect(r.status).toBe("gated");
    expect(calls.filter((c) => c.startsWith("batch"))).toHaveLength(0);
  });

  it("flatten closes everything, only while paused", async () => {
    const { engine, store, positions } = setup();
    await engine.tick();
    await expect(engine.tick({ flatten: true })).rejects.toThrow(/paused/);
    store.setPaused(true);
    const r = await engine.tick({ flatten: true });
    expect(r.status).toBe("done");
    expect(positions.get("AAA-USD")).toBe(0);
    expect(positions.get("BBB-USD")).toBe(0);
  });

  it("shadow mode never sends orders", async () => {
    const { engine, calls } = setup({ EXECUTION_MODE: "shadow" });
    const r = await engine.tick();
    expect(r.status).toBe("shadow");
    expect(calls).toHaveLength(0);
  });
});

describe("vault info for the Invest card", () => {
  it("serves Strike's vault record, with depositors from the portfolio endpoint", async () => {
    const { engine, store } = setup();
    await engine.tick();
    expect(engine.lastSnapshot!.depositors).toBe(4);
    const app = await buildServer(engine, new EventBus(store));
    const { vault } = (await app.inject({ url: "/api/basket" })).json();
    expect(vault).toEqual({
      id: "v1",
      url: "https://testnet.strikefinance.org/vaults/v1?ref=strikebaskets",
      listUrl: "https://testnet.strikefinance.org/vaults",
      name: "Strike Baskets · Test",
      status: "active",
      minDepositUsd: "100",
      lockupDays: 1,
      leaderCommissionBps: 1000,
      depositors: 4,
      sharePrice: "1.00",
      equity: "1000",
    });
  });

  it("paper mode has no vault, so every field is null except the vault list link", async () => {
    const cfg = loadConfig({ STRIKE_ENV: "mainnet", SHADOW_EQUITY_USD: "1000" });
    const store = new Store(":memory:");
    const engine = new BasketEngine(cfg, fakeStrike().client, store, new EventBus(store), basket);
    const { vault } = (await (await buildServer(engine, new EventBus(store))).inject({ url: "/api/basket" })).json();
    expect(vault).toMatchObject({ id: null, url: null, name: null, listUrl: "https://app.strikefinance.org/vaults" });
  });
});

describe("GET /api/preview", () => {
  it("returns the orders for an amount, priced at the ask, without trading", async () => {
    const { engine, store, calls } = setup();
    const app = await buildServer(engine, new EventBus(store));
    const r = (await app.inject({ url: "/api/preview?amount=1000" })).json();
    expect(r).toMatchObject({ basketId: "t", amountUsd: 1000, bookUsd: "900.00", allChecksOk: true });
    expect(r.legs.map((l: { symbol: string }) => l.symbol)).toEqual(["AAA-USD", "BBB-USD"]);
    expect(Number(r.legs[0].price)).toBeGreaterThan(100); // the ask, above the 100 mark
    expect(calls.filter((c) => c.startsWith("batch"))).toHaveLength(0); // nothing sent
  });

  it("rejects bad amounts and baskets not listed on this network", async () => {
    const { engine, store } = setup();
    const app = await buildServer(engine, new EventBus(store));
    expect((await app.inject({ url: "/api/preview?amount=-5" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/preview?amount=500&basket=preipo" })).json().error).toMatch(/not listed/);
    expect((await app.inject({ url: "/api/preview?amount=500&basket=nope" })).statusCode).toBe(404);
  });
});

describe("BasketEngine (paper exchange, no vault)", () => {
  it("runs the plan through the executor with paper order IDs and real costs", async () => {
    const fake = fakeStrike();
    const cfg = loadConfig({ STRIKE_ENV: "mainnet", EXECUTION_MODE: "shadow", SHADOW_EQUITY_USD: "1000", REBALANCE_COOLDOWN_MIN: "0" });
    const store = new Store(":memory:");
    const engine = new BasketEngine(cfg, fake.client, store, new EventBus(store), basket);
    const r = await engine.tick();
    expect(r.status).toBe("done");
    expect(store.getRun(r.runId)!.mode).toBe("paper");
    const legs = store.legsForRun(r.runId);
    expect(legs.every((l) => l.status === "filled" && l.strike_order_id!.startsWith("paper-"))).toBe(true);
    expect(Number(legs[0]!.avg_price)).toBeGreaterThan(100); // filled at the ask, not the mark
    expect(fake.calls).toEqual([]); // nothing sent to Strike
    expect((await engine.tick()).status).toBe("noop");
    expect(Number(engine.lastSnapshot!.costs!.fees)).toBeGreaterThan(0);
    expect(engine.lastSnapshot!.plan.maxDriftBps).toBeLessThan(100);
  });

  it("dry run plans without filling", async () => {
    const cfg = loadConfig({ STRIKE_ENV: "testnet", SHADOW_EQUITY_USD: "1000" });
    const store = new Store(":memory:");
    const engine = new BasketEngine(cfg, fakeStrike().client, store, new EventBus(store), basket);
    const r = await engine.tick({ dryRun: true });
    expect(r.status).toBe("shadow");
    expect(engine.paper.positions()).toEqual([]);
  });
});

describe("parseOrderState", () => {
  it("reads common field spellings", () => {
    expect(parseOrderState({ status: "FILLED", order_id: 7, filled_size: "1" })).toEqual({ status: "filled", orderId: "7", filledQty: "1", avgPrice: undefined });
    expect(parseOrderState({ order: { X: "PARTIALLY_FILLED", i: 9, z: "0.5" } })?.status).toBe("partially_filled");
    expect(parseOrderState({})).toBeNull();
  });
  it("reads the live testnet PascalCase shape", () => {
    const live = { ID: 243163077, ClientOrderID: "bk-probe-mvkjtow8", Status: "filled", Type: "market", Size: "0.00141", Filled: "0.00141", Price: "81803.2812", StopPrice: "0" };
    expect(parseOrderState(live)).toEqual({ status: "filled", orderId: "243163077", filledQty: "0.00141", avgPrice: "81803.2812" });
  });
});

describe("Executor.summarize", () => {
  const summarize = (legs: { status: string; filled_qty: string | null }[]) =>
    new Executor({} as never, {} as never, undefined, { legsForRun: () => legs } as never, {} as never).summarize("r");
  it("counts a leg canceled at the slippage cap after a partial fill as partial, not failed", () => {
    // Live testnet: ETH 0.318 ordered, 0.216 filled, rest canceled.
    expect(summarize([{ status: "canceled", filled_qty: "0.216" }, { status: "canceled", filled_qty: "0.00854" }])).toBe("partial");
    expect(summarize([{ status: "canceled", filled_qty: null }, { status: "rejected", filled_qty: "0" }])).toBe("failed");
    expect(summarize([{ status: "filled", filled_qty: "1" }])).toBe("done");
  });
});
