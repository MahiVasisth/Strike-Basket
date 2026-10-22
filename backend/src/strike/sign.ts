import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, KeyObject } from "node:crypto";

// PKCS#8 / SPKI DER prefixes for a raw 32-byte Ed25519 key, so we can use Node's built-in crypto.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export interface ApiWallet {
  publicKeyHex: string;
  privateKey: KeyObject;
}

/** Accepts a 64-hex seed or a 128-hex seed+public key (Strike allows both). */
export function loadApiWallet(publicKeyHex: string, privateKeyHex: string): ApiWallet {
  const seed = Buffer.from(privateKeyHex.slice(0, 64), "hex");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const derived = publicKeyHexOf(privateKey);
  if (derived !== publicKeyHex.toLowerCase()) {
    throw new Error(`STRIKE_API_PRIVATE_KEY does not match STRIKE_API_PUBLIC_KEY (derived ${derived})`);
  }
  return { publicKeyHex: derived, privateKey };
}

export function publicKeyHexOf(privateKey: KeyObject): string {
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return Buffer.from(spki.subarray(SPKI_PREFIX.length)).toString("hex");
}

export function generateApiWallet(): { publicKeyHex: string; privateKeyHex: string } {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  return {
    publicKeyHex: publicKeyHexOf(privateKey),
    privateKeyHex: Buffer.from(pkcs8.subarray(PKCS8_PREFIX.length)).toString("hex"),
  };
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function signatureMessage(method: string, path: string, timestamp: string, nonce: string, body: string): string {
  return `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${sha256Hex(body)}`;
}

/** REST auth headers. `body` must be the exact string that is sent. */
export function authHeaders(
  wallet: ApiWallet,
  method: string,
  path: string,
  body: string,
  nowMs: number,
): Record<string, string> {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const nonce = randomUUID();
  const message = signatureMessage(method, path, timestamp, nonce, body);
  const signature = sign(null, Buffer.from(message), wallet.privateKey).toString("hex");
  return {
    "X-API-Wallet-Public-Key": wallet.publicKeyHex,
    "X-API-Wallet-Signature": signature,
    "X-API-Wallet-Timestamp": timestamp,
    "X-API-Wallet-Nonce": nonce,
  };
}

/** User-stream WS logon payload (different scheme from REST: ms timestamp, no nonce). */
export function wsLogonParams(wallet: ApiWallet, nowMs: number) {
  const timestamp = Math.floor(nowMs);
  const payload = `apiKey=${wallet.publicKeyHex}&timestamp=${timestamp}`;
  return {
    apiKey: wallet.publicKeyHex,
    signature: sign(null, Buffer.from(payload), wallet.privateKey).toString("hex"),
    timestamp,
  };
}
