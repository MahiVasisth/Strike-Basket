import { describe, expect, it } from "vitest";
import { createPublicKey, verify } from "node:crypto";
import { checkGate, IndexWatch } from "../src/core/gates.js";
import { authHeaders, generateApiWallet, loadApiWallet, signatureMessage, sha256Hex } from "../src/strike/sign.js";

const lim = { maxSpreadBps: 50, maxMarkMidDeviationBps: 100, maxBookAgeSec: 60, indexFrozenMin: 30, blockOnFrozenIndex: false };
const now = 1_800_000_000_000;

describe("checkGate", () => {
  it("passes a tight, fresh book", () => {
    const r = checkGate({ symbol: "SPCX-USD", mark: "155.04", bid: "155.00", ask: "155.09", bookTimeMs: now - 1000, nowMs: now }, lim);
    expect(r.ok).toBe(true);
    expect(r.spreadBps!).toBeLessThan(10);
  });

  it("fails a wide or off-book market", () => {
    const r = checkGate({ symbol: "X", mark: "110", bid: "99", ask: "101", bookTimeMs: now, nowMs: now }, lim);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.startsWith("SPREAD_"))).toBe(true);
    expect(r.failures.some((f) => f.startsWith("MARK_OFF_BOOK_"))).toBe(true);
  });

  it("fails an empty or stale book", () => {
    expect(checkGate({ symbol: "X", mark: "1", nowMs: now }, lim).failures).toContain("NO_BOOK");
    const stale = checkGate({ symbol: "X", mark: "100", bid: "99.99", ask: "100.01", bookTimeMs: now - 120_000, nowMs: now }, lim);
    expect(stale.failures).toContain("BOOK_STALE_120S");
  });

  it("frozen index warns by default and blocks when configured", () => {
    const g = { symbol: "X", mark: "100", bid: "99.99", ask: "100.01", bookTimeMs: now, nowMs: now, indexUnchangedForMs: 45 * 60_000 };
    expect(checkGate(g, lim)).toMatchObject({ ok: true, warnings: ["INDEX_FROZEN_45MIN"] });
    expect(checkGate(g, { ...lim, blockOnFrozenIndex: true }).ok).toBe(false);
  });

  it("IndexWatch measures time since last change", () => {
    const w = new IndexWatch();
    expect(w.observe("X", "1", 0)).toBeUndefined();
    expect(w.observe("X", "1", 5000)).toBe(5000);
    expect(w.observe("X", "2", 6000)).toBe(0);
  });
});

describe("signing", () => {
  it("round-trips a generated wallet and produces verifiable signatures", () => {
    const { publicKeyHex, privateKeyHex } = generateApiWallet();
    expect(publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    const w = loadApiWallet(publicKeyHex, privateKeyHex);
    // 128-hex (seed + pub) form is accepted too
    expect(loadApiWallet(publicKeyHex, privateKeyHex + publicKeyHex).publicKeyHex).toBe(publicKeyHex);

    const body = JSON.stringify({ symbol: "BTC-USD" });
    const h = authHeaders(w, "post", "/v2/order", body, now);
    expect(h["X-API-Wallet-Timestamp"]).toBe(String(now / 1000));
    const msg = signatureMessage("POST", "/v2/order", h["X-API-Wallet-Timestamp"]!, h["X-API-Wallet-Nonce"]!, body);
    expect(msg.endsWith(sha256Hex(body))).toBe(true);
    const ok = verify(null, Buffer.from(msg), createPublicKey(w.privateKey), Buffer.from(h["X-API-Wallet-Signature"]!, "hex"));
    expect(ok).toBe(true);
  });

  it("rejects a mismatched key pair", () => {
    const a = generateApiWallet();
    const b = generateApiWallet();
    expect(() => loadApiWallet(a.publicKeyHex, b.privateKeyHex)).toThrow(/does not match/);
  });

  it("GET body hash is sha256 of the empty string", () => {
    expect(signatureMessage("GET", "/v2/account", "1", "n", "")).toBe(
      "GET:/v2/account:1:n:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
