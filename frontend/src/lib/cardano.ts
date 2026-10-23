// Lace (and any CIP-30 Cardano wallet) for Builder Connect, matching Strike's own app:
//   address = the wallet's change address, bech32 (addr_test1… on Preprod)
//   network must be Preprod (network id 0): Strike testnet verifies Preprod signatures
//   signature = CIP-30 signData(addressHex, hex(message)) → "{coseSign1Hex}:{coseKeyHex}"
// The backend already accepts chain "cardano"; this is the browser half.

interface Cip30Api {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  signData(addr: string, payloadHex: string): Promise<{ signature: string; key: string }>;
}
interface Cip30Wallet {
  name?: string;
  enable(): Promise<Cip30Api>;
}

const lace = () => (window as unknown as { cardano?: { lace?: Cip30Wallet } }).cardano?.lace;
export const hasLace = () => !!lace();

export interface LaceSession {
  api: Cip30Api;
  address: string; // bech32, what Strike gets
  addressHex: string; // raw bytes, what signData gets
}

export async function connectLace(): Promise<LaceSession> {
  const wallet = lace();
  if (!wallet) throw new Error("Lace isn't installed. Get it at lace.io, then reload this page.");
  const api = await wallet.enable();
  const network = await api.getNetworkId();
  if (network !== 0) throw new Error("Lace is on mainnet. Switch it to Preprod (Lace → Settings → Network), then connect again.");
  let addressHex: string;
  try {
    addressHex = await api.getChangeAddress();
  } catch (e) {
    // Lace throws "No addresses available" until a new or freshly switched account has synced.
    throw new Error(
      /no address/i.test((e as Error)?.message ?? String(e))
        ? "Lace is still syncing this account. Wait until Lace → Receive shows an addr_test1… address, then connect again."
        : (e as Error)?.message ?? String(e),
    );
  }
  return { api, addressHex, address: bech32(network === 0 ? "addr_test" : "addr", hexToBytes(addressHex)) };
}

export async function signWithLace(s: LaceSession, message: string): Promise<string> {
  const payloadHex = bytesToHex(new TextEncoder().encode(message));
  const { signature, key } = await s.api.signData(s.addressHex, payloadHex);
  return `${signature}:${key}`;
}

// ---------- encoding ----------

const hexToBytes = (h: string) => new Uint8Array((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** BIP-173 bech32 without the 90-char limit (Cardano base addresses are ~108 chars). */
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= G[i];
  }
  return chk;
}
export function bech32(hrp: string, bytes: Uint8Array): string {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
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
