import { useSyncExternalStore } from "react";
import { ApiError, createApi, testnetApi } from "./api";
import { safeStorage } from "./hooks";

// Personal-mode session in this browser: the bearer token from /api/personal/connect/confirm and the
// wallet address it belongs to. One store so the header, /connect and /me always agree, including
// across tabs (the `storage` event).

export const TOKEN_KEY = "sb.personalToken";
/** Wallet address saved at connect time, shown in the header once connected. */
export const ADDRESS_KEY = "sb.personalAddress";
const CHANGED = "sb:session";

export interface Session {
  token: string | null;
  address: string | null;
}

const local = safeStorage("local");
const read = (): Session => {
  const token = local.get(TOKEN_KEY);
  return { token, address: token ? local.get(ADDRESS_KEY) : null };
};
let current = read();

function subscribe(onChange: () => void) {
  const handler = () => {
    const next = read();
    if (next.token !== current.token || next.address !== current.address) current = next;
    onChange();
  };
  window.addEventListener(CHANGED, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGED, handler);
    window.removeEventListener("storage", handler);
  };
}

export const useSession = (): Session => useSyncExternalStore(subscribe, () => current);
export const sessionToken = () => current.token;

export function setSession(token: string | null, address: string | null) {
  local.set(TOKEN_KEY, token);
  local.set(ADDRESS_KEY, token ? address : null);
  window.dispatchEvent(new Event(CHANGED));
}

export const clearSession = () => setSession(null, null);

// The "Disconnected" note for /connect. Kept here rather than in router state: clearing the session makes
// /me's guard redirect immediately, which can win the race against the caller's own navigate().
let notice: string | null = null;
/** Returns the pending disconnect note once, then forgets it. */
export function takeNotice(): string | null {
  const n = notice;
  notice = null;
  return n;
}

interface Eth {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
}
export const ethereum = () => (window as unknown as { ethereum?: Eth }).ethereum;

/** Ask the wallet to forget this site (EIP-2255). MetaMask supports it; elsewhere it's a no-op. */
export async function releaseWallet() {
  try {
    await ethereum()?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* unsupported or declined: the session is already cleared, which is what matters */
  }
}

/**
 * Full disconnect: the engine stops trading and the backend deletes our key (DELETE /api/me), this
 * browser forgets the session, and the wallet releases the site. Positions stay in the user's Strike
 * account. Resolves with the backend's note for the user.
 */
export async function disconnect(): Promise<string> {
  let note = "Disconnected. Your positions stay in your Strike account.";
  const token = current.token;
  if (token && testnetApi) {
    try {
      note = (await createApi(testnetApi.base, token).del<{ note: string }>("/api/me")).note;
    } catch (e) {
      // 401: the backend already forgot this session (revoked elsewhere). Clearing locally is enough.
      if (!(e instanceof ApiError && e.status === 401)) throw e;
    }
  }
  notice = note; // set before clearing: the redirect it triggers lands on /connect, which reads it
  clearSession();
  await releaseWallet();
  return note;
}
