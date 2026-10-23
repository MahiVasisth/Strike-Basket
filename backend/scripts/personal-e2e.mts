// Personal mode, end to end in headless Chrome: the real web app → the running testnet engine → real Strike testnet.
// Two throwaway wallets (no funds), each: connect → sign → /me → header menu → Disconnect → session revoked.
//   - MetaMask: an EIP-191 test account behind a window.ethereum shim, through the /connect page
//   - Lace:     a CIP-30 window.cardano.lace shim signing with TestCardanoWallet (CIP-8, as Lace does),
//               through the header's "Connect wallet" modal, starting on the home page
// The shims stand in for the browser extensions only; Strike verifies every signature for real.
//
// Usage: pnpm e2e:personal   (needs `pnpm testnet` and the frontend dev server running)
// Env:   FRONTEND_URL (default :5173), TESTNET_URL (default :8788), CHROME_PATH (default /usr/bin/google-chrome)

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { TestCardanoWallet } from "../src/cli/cardano-wallet.ts";
// playwright-core is a frontend dev dependency
const { chromium } = await import("../../frontend/node_modules/playwright-core/index.mjs");

const WEB = process.env.FRONTEND_URL ?? "http://localhost:5173";
const API = process.env.TESTNET_URL ?? "http://localhost:8788";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d = "") => { ok ? pass++ : fail++; console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${n}${d ? `  \x1b[2m${d}\x1b[0m` : ""}`); };

interface Wallet { name: string; button: RegExp; chain: string; address: string; via: "page" | "modal"; shim: string; sign: (payload: string) => unknown }

const mm = privateKeyToAccount(generatePrivateKey());
const lace = new TestCardanoWallet();
// Shims are plain JS strings: tsx would inject helpers into functions that don't exist in the page.
const wallets: Wallet[] = [
  {
    name: "MetaMask", button: /^MetaMask/, chain: "ethereum", address: mm.address, via: "page",
    shim: `window.ethereum = { request: async ({ method, params }) => {
      if (method === "eth_requestAccounts") return ["${mm.address}"];
      if (method === "personal_sign") return window.__walletSign(params[0]);
      if (method === "wallet_revokePermissions") return null;
      throw new Error("unsupported " + method);
    } };`,
    sign: (message) => mm.signMessage({ message: message as string }),
  },
  {
    name: "Lace", button: /^Lace/, chain: "cardano", address: lace.address, via: "modal",
    shim: `window.cardano = { lace: { name: "lace", enable: async () => ({
      getNetworkId: async () => 0,
      getChangeAddress: async () => "${lace.addressHex}",
      signData: (a, p) => window.__walletSign(a, p),
    }) } };`,
    sign: (addrHex, payloadHex?: unknown) => {
      if (addrHex !== lace.addressHex) throw new Error("signData called with the wrong address");
      const [signature, key] = lace.signData(Buffer.from(payloadHex as string, "hex").toString("utf8")).split(":");
      return { signature, key };
    },
  },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
for (const w of wallets) {
  console.log(`\n\x1b[1m${w.name} (${w.chain}, via ${w.via === "page" ? "/connect page" : "header modal"})\x1b[0m  ${w.address}`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.exposeFunction("__walletSign", (a: unknown, b?: unknown) => w.sign(a as string, b));
  await ctx.addInitScript(w.shim);
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on("pageerror", (e: Error) => errors.push(String(e)));
  p.on("dialog", (d: { accept: () => void }) => d.accept());

  let scope: typeof p = p;
  if (w.via === "page") {
    await p.goto(`${WEB}/connect`, { waitUntil: "networkidle" });
  } else {
    await p.goto(`${WEB}/`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Connect wallet" }).first().click();
    scope = p.getByRole("dialog") as unknown as typeof p;
    check("header Connect wallet opens the modal", await (scope as unknown as { isVisible(): Promise<boolean> }).isVisible());
  }
  await scope.getByRole("button", { name: w.button }).click();
  await scope.getByText("✓ connected").waitFor({ timeout: 10_000 });
  await scope.getByText(`Chain: ${w.chain}`, { exact: false }).waitFor({ timeout: 15_000 });
  check("Strike's challenge shown", true);
  await scope.getByRole("button", { name: `Sign in ${w.name}` }).click();
  await p.waitForFunction(() => location.pathname === "/me", null, { timeout: 30_000 });
  const token = await p.evaluate(() => localStorage.getItem("sb.personalToken"));
  const me = await (await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  if (w.via === "modal") check("modal closed after connecting", (await p.getByRole("dialog").count()) === 0);
  check("signed → /me, backend has this wallet", me.user?.chain === w.chain && me.user?.address === w.address, me.user?.accountId);
  const header = p.getByRole("button", { name: new RegExp(w.address.slice(0, 6)) });
  check("header shows the wallet", await header.isVisible());
  await header.click();
  await p.getByRole("menuitem", { name: "Disconnect" }).click();
  await p.waitForFunction(() => location.pathname === "/connect", null, { timeout: 15_000 });
  check("Disconnect → /connect with notice", await p.getByText("Disconnected.", { exact: false }).first().isVisible());
  check("session cleared, header back to Connect wallet", (await p.evaluate(() => localStorage.getItem("sb.personalToken"))) === null && (await p.getByRole("button", { name: "Connect wallet" }).first().isVisible()));
  check("backend revoked it (401)", (await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).status === 401);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}
await browser.close();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);
