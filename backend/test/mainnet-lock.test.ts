import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MainnetWriteBlocked, StrikeClient } from "../src/strike/client.js";
import { generateApiWallet } from "../src/strike/sign.js";

const w = generateApiWallet();
const keys = { STRIKE_API_PUBLIC_KEY: w.publicKeyHex, STRIKE_API_PRIVATE_KEY: w.privateKeyHex };

function clientFor(env: Record<string, string>) {
  const sent: string[] = [];
  const fetchSpy = (async (url: string, init: RequestInit) => {
    sent.push(`${init.method} ${url}`);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new StrikeClient(loadConfig({ ...keys, ...env }), fetchSpy), sent };
}

describe("mainnet write lock", () => {
  it("refuses every write on mainnet before any network call", async () => {
    const { client, sent } = clientFor({ STRIKE_ENV: "mainnet" });
    const order = { symbol: "SPCX-USD", side: "buy" as const, type: "market" as const, size: "1" };
    await expect(client.createOrder(order, "v")).rejects.toBeInstanceOf(MainnetWriteBlocked);
    await expect(client.batchOrders([order], "v")).rejects.toBeInstanceOf(MainnetWriteBlocked);
    await expect(client.setLeverage("SPCX-USD", 2, "v")).rejects.toBeInstanceOf(MainnetWriteBlocked);
    await expect(client.setMarginMode("SPCX-USD", "cross", "v")).rejects.toBeInstanceOf(MainnetWriteBlocked);
    await expect(client.cancelAll("SPCX-USD", "v")).rejects.toBeInstanceOf(MainnetWriteBlocked);
    await expect(client.createTwap({ symbol: "SPCX-USD", side: "BUY", total_size: "1", duration_sec: 300 })).rejects.toBeInstanceOf(MainnetWriteBlocked);
    expect(sent).toEqual([]);
  });

  it("still allows mainnet reads", async () => {
    const { client, sent } = clientFor({ STRIKE_ENV: "mainnet" });
    await client.vault("v");
    expect(sent).toEqual(["GET https://api.strikefinance.org/v2/vault/v"]);
  });

  it("refuses to start live on mainnet without the flag", () => {
    expect(() => loadConfig({ ...keys, STRIKE_ENV: "mainnet", EXECUTION_MODE: "live", STRIKE_VAULT_ID: "v" })).toThrow(/read-only/);
  });

  it("testnet writes are allowed", async () => {
    const { client, sent } = clientFor({ STRIKE_ENV: "testnet" });
    await client.setLeverage("BTC-USD", 2, "v");
    expect(sent).toEqual(["POST https://api-v2-testnet.strikefinance.org/v2/leverage"]);
  });
});
