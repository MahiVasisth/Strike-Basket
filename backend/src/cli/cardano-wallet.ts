// A minimal stand-in for a CIP-30 Cardano wallet (Lace, Eternl…), for testing Builder Connect with
// chain "cardano" without a browser extension. It signs exactly the way CIP-30 `signData` does
// (CIP-8 COSE_Sign1 + COSE_Key), so Strike verifies it like a real Lace signature.
//
// Dev tooling only: the app never holds a user's Cardano key.

import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2b";

// ---------- tiny CBOR encoder (just the types COSE needs) ----------

type Cbor = number | string | Uint8Array | boolean | Cbor[] | Map<Cbor, Cbor>;

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n]);
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}

export function cbor(v: Cbor): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "boolean") return Buffer.from([v ? 0xf5 : 0xf4]);
  if (typeof v === "string") return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

// ---------- bech32 (BIP-173), no length limit: Cardano addresses exceed 90 chars ----------

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= G[i]!;
  }
  return chk;
}
export function bech32(hrp: string, bytes: Uint8Array): string {
  const words: number[] = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) words.push((acc >> (bits -= 5)) & 31);
  }
  if (bits) words.push((acc << (5 - bits)) & 31);
  const hrpExp = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat(0, [...hrp].map((c) => c.charCodeAt(0) & 31));
  const mod = polymod([...hrpExp, ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join("")}`;
}

// ---------- the wallet ----------

const SPKI_PREFIX_LEN = 12;
const rawPub = (k: KeyObject) => new Uint8Array(k.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX_LEN));

export class TestCardanoWallet {
  private paymentKey: KeyObject;
  readonly paymentPub: Uint8Array;
  /** Base address on testnet (header 0x00: payment key hash + stake key hash, network 0), like Lace. */
  readonly addressBytes: Uint8Array;

  constructor() {
    const payment = generateKeyPairSync("ed25519");
    const stake = generateKeyPairSync("ed25519");
    this.paymentKey = payment.privateKey;
    this.paymentPub = rawPub(payment.publicKey);
    const paymentHash = blake2b(this.paymentPub, { dkLen: 28 });
    const stakeHash = blake2b(rawPub(stake.publicKey), { dkLen: 28 });
    this.addressBytes = new Uint8Array([0x00, ...paymentHash, ...stakeHash]);
  }

  get address(): string {
    return bech32("addr_test", this.addressBytes);
  }

  get addressHex(): string {
    return Buffer.from(this.addressBytes).toString("hex");
  }

  /** CIP-30 signData(address, hex(payload)) → "{coseSign1Hex}:{coseKeyHex}", the format Strike expects. */
  signData(message: string): string {
    const payload = new Uint8Array(Buffer.from(message, "utf8"));
    const protectedHeader = cbor(new Map<Cbor, Cbor>([[1, -8], ["address", this.addressBytes]]));
    const sigStructure = cbor(["Signature1", new Uint8Array(protectedHeader), new Uint8Array(0), payload]);
    const signature = new Uint8Array(sign(null, sigStructure, this.paymentKey));
    const coseSign1 = cbor([new Uint8Array(protectedHeader), new Map<Cbor, Cbor>([["hashed", false]]), payload, signature]);
    const coseKey = cbor(new Map<Cbor, Cbor>([[1, 1], [3, -8], [-1, 6], [-2, this.paymentPub]]));
    return `${coseSign1.toString("hex")}:${coseKey.toString("hex")}`;
  }
}
