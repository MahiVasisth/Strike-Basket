import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { parseBasket } from "../src/core/basket.js";
import { Store } from "../src/db/db.js";
import { BasketEngine } from "../src/engine/engine.js";
import { EventBus } from "../src/engine/events.js";
import { parseOrderState } from "../src/engine/executor.js";
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
    vault: async () => ({ vault_id: "v1", share_price: "1.00", equity: "1000", total_shares: "1000", depositors: 1 }),
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
});
