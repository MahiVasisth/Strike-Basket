import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, heroApi, testnetApi, type PersonalUser } from "../lib/api";
import { connectLace, hasLace, signWithLace, type LaceSession } from "../lib/cardano";
import { shortAddr } from "../lib/format";
import { useInstances } from "../lib/instances";
import { ethereum as eth, releaseWallet, setSession } from "../lib/session";
import { Button, ErrorNote, Glass, LinkButton } from "./ui";

type Pending = { connectId: string; messageToSign: string; expiresAt: number };

/**
 * Personal mode onboarding (docs/PERSONAL-MODE.md): pick → wallet → sign. MetaMask (Ethereum) or Lace (Cardano Preprod).
 * Used by the /connect page and by the header's connect modal; `onConnected` runs once the session is stored.
 */
export function ConnectFlow({ layout, onConnected }: { layout: "page" | "modal"; onConnected: () => void }) {
  const { personal, ready } = useInstances();
  const modal = layout === "modal";
  const hero = useQuery({ queryKey: [heroApi.base, "baskets"], queryFn: heroApi.baskets });
  const [basketId, setBasketId] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [wallet, setWallet] = useState<"metamask" | "lace" | null>(null);
  const laceRef = useRef<LaceSession | null>(null);
  const chain = wallet === "lace" ? "cardano" : "ethereum";
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = personal?.baskets ?? [];
  const soon = new Set(hero.data?.filter((b) => b.status === "coming_soon").map((b) => b.id));
  const chosen = options.find((b) => b.id === basketId);
  const min = chosen?.minBudgetUsd ?? 0;
  const amount = Number(budget);
  const budgetOk = !!chosen?.available && Number.isFinite(amount) && amount >= min;
  const feePct = ((personal?.builderFeeBps ?? 10) / 100).toFixed(2);
  const step = !budgetOk ? 1 : !address ? 2 : 3;

  useEffect(() => {
    if (basketId) return;
    const first = options.find((b) => b.available);
    if (first) {
      setBasketId(first.id);
      setBudget(String(Math.max(500, Math.ceil((first.minBudgetUsd ?? 0) / 50) * 50)));
    }
  }, [options, basketId]);

  const request = async () => {
    const r = await testnetApi!.post<Pending>("/api/personal/connect/request", { address, chain, basketId, budgetUsd: amount });
    setPending(r);
    return r;
  };

  // A changed choice invalidates the challenge; fetch a fresh one once step 3 opens.
  useEffect(() => setPending(null), [basketId, budget, address, chain]);
  useEffect(() => {
    if (step !== 3 || pending || busy) return;
    const t = setTimeout(() => request().catch((x) => setErr(`Couldn't prepare the message: ${(x as Error).message}`)), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pending, busy]);

  const connectMetaMask = async () => {
    setErr(null);
    const e = eth();
    if (!e) return setErr("No Ethereum wallet found. Install MetaMask, then reload this page.");
    try {
      const accts = (await e.request({ method: "eth_requestAccounts" })) as string[];
      laceRef.current = null;
      setWallet(accts[0] ? "metamask" : null);
      setAddress(accts[0] ?? null);
    } catch (x) {
      setErr(`MetaMask didn't connect: ${(x as Error).message}`);
    }
  };

  // Lace connects on Preprod only: Strike testnet verifies Preprod signatures (lib/cardano.ts).
  const connectLaceWallet = async () => {
    setErr(null);
    try {
      const s = await connectLace();
      laceRef.current = s;
      setWallet("lace");
      setAddress(s.address);
    } catch (x) {
      setErr(`Lace didn't connect: ${(x as Error).message}`);
    }
  };

  // Before signing nothing is stored server-side: forget the address here and release the wallet.
  const disconnectWallet = async () => {
    const was = wallet;
    setAddress(null);
    setWallet(null);
    laceRef.current = null;
    setPending(null);
    setErr(null);
    if (was === "metamask") await releaseWallet(); // CIP-30 has no "disconnect"; Lace just forgets on reload
  };

  const sign = async () => {
    setBusy(true);
    setErr(null);
    const confirm = async (p: Pending) => {
      const signature =
        wallet === "lace"
          ? await signWithLace(laceRef.current!, p.messageToSign)
          : ((await eth()!.request({ method: "personal_sign", params: [p.messageToSign, address] })) as string);
      return testnetApi!.post<{ token: string; user: PersonalUser }>("/api/personal/connect/confirm", { connectId: p.connectId, signature });
    };
    try {
      let p = pending && pending.expiresAt > Date.now() + 15_000 ? pending : await request();
      let res;
      try {
        res = await confirm(p);
      } catch (x) {
        if (!(x instanceof ApiError && x.status === 410)) throw x;
        p = await request(); // expired: restart once with a fresh challenge
        res = await confirm(p);
      }
      setSession(res.token, res.user.address);
      onConnected();
    } catch (x) {
      if (x instanceof ApiError && x.status === 410) setErr("Signature expired after 5 minutes. Sign again.");
      else if (x instanceof ApiError) setErr(`Strike didn't accept the connection: ${x.message}. Check the budget and sign again.`);
      else setErr(`Signing was cancelled or failed: ${(x as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (ready && !personal)
    return <ErrorNote>Personal mode is offline right now (the testnet engine isn't reachable). Try again in a minute.</ErrorNote>;

  return (
    <>
      <div className={`${modal ? "grid gap-3" : "grid gap-4 lg:grid-cols-3"} [&>*]:min-w-0`}>
        <Step compact={modal} n={1} title="Pick a basket" state={step === 1 ? "current" : "done"}>
          <div className="space-y-2">
            {options.map((b) => (
              <button
                key={b.id}
                disabled={!b.available}
                onClick={() => setBasketId(b.id)}
                className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                  b.id === basketId ? "border-blue bg-blue/10 shadow-[0_0_24px_rgba(77,124,255,.3)]" : "border-edge hover:border-white/20"
                } disabled:cursor-not-allowed disabled:opacity-45`}
              >
                <div className="text-[14px] font-medium">{b.name}</div>
                <div className="mt-0.5 text-[12.5px] text-dim">
                  {b.available ? `From $${b.minBudgetUsd}` : soon.has(b.id) ? "Coming soon" : "Mainnet only for now"}
                </div>
              </button>
            ))}
          </div>
          <label className="mt-5 block">
            <span className="text-[12.5px] text-dim">Budget</span>
            <div className="mt-1.5 flex items-center rounded-2xl border border-edge bg-black px-4 focus-within:border-violet">
              <span className="num text-[24px] text-dim">$</span>
              <input
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                className="num w-full bg-transparent px-2 py-3 text-[26px] text-text outline-none"
                aria-label="Budget in USD"
              />
            </div>
          </label>
          {chosen && budget !== "" && !budgetOk && <p className="mt-2 text-[13px] text-warn">The minimum for {chosen.name} is ${min}. Raise the budget to continue.</p>}
          <p className="mt-3 text-[13px] leading-relaxed text-dim">We charge {feePct}% per trade (Strike Builder Code). No fee on deposits or profits.</p>
        </Step>

        <Step compact={modal} n={2} title="Connect your wallet" state={step < 2 ? "todo" : step === 2 ? "current" : "done"}>
          <WalletOption
            name="MetaMask"
            hint="Ethereum"
            connected={wallet === "metamask" ? address : null}
            disabled={step < 2}
            onClick={connectMetaMask}
          />
          {hasLace() ? (
            <WalletOption
              name="Lace"
              hint="Cardano · Preprod"
              connected={wallet === "lace" ? address : null}
              disabled={step < 2}
              onClick={connectLaceWallet}
              className="mt-2"
            />
          ) : (
            <a
              href="https://www.lace.io"
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex items-center justify-between rounded-2xl border border-edge px-4 py-3.5 transition hover:border-white/20"
            >
              <span>
                <span className="block text-[14px] font-medium">Lace</span>
                <span className="mt-0.5 block text-[12.5px] text-dim">Cardano · not installed</span>
              </span>
              <span className="text-[12.5px] text-violet">Install ↗</span>
            </a>
          )}
          <div className="mt-2 flex items-center justify-between rounded-2xl border border-edge px-4 py-3.5 opacity-45">
            <span className="text-[14px]">Phantom</span>
            <span className="text-[12.5px] text-dim">Coming soon</span>
          </div>
          {wallet === "lace" && <p className="mt-3 text-[12.5px] text-dim">Lace must be on Preprod. Fund your Strike testnet account with test ADA from the Cardano Preprod faucet.</p>}
          {address && (
            <div className="mt-3 flex gap-4 text-[13px]">
              <button onClick={wallet === "lace" ? connectLaceWallet : connectMetaMask} className="text-dim hover:text-text">Use a different account</button>
              <button onClick={disconnectWallet} className="text-dim hover:text-bad">Disconnect wallet</button>
            </div>
          )}
        </Step>

        <Step compact={modal} n={3} title="Sign to connect" state={step === 3 ? "current" : "todo"}>
          <div className="num max-h-56 min-h-[120px] overflow-auto whitespace-pre-wrap break-all rounded-2xl border border-dashed border-white/25 bg-black p-4 text-[12px] leading-relaxed text-dim">
            {pending ? pending.messageToSign : step === 3 ? "Preparing Strike's message…" : "Strike's message appears here. Your wallet shows the same text."}
          </div>
          <Button variant="plasma" disabled={step !== 3 || busy || !pending} onClick={sign} className="mt-4 w-full !py-3">
            {busy ? `Waiting for ${wallet === "lace" ? "Lace" : "MetaMask"}…` : `Sign in ${wallet === "lace" ? "Lace" : "MetaMask"}`}
          </Button>
          <ul className="mt-4 space-y-1.5 text-[13px]">
            {["A signature, not a transaction", "No gas, no funds move", "Trades only, can never withdraw"].map((t) => (
              <li key={t} className="flex items-center gap-2"><span className="text-ok">✓</span><span className="text-text/90">{t}</span></li>
            ))}
          </ul>
        </Step>
      </div>

      {err && <div className={modal ? "mt-4" : "mx-auto mt-6 max-w-2xl"}><ErrorNote>{err}</ErrorNote></div>}
      <div className={modal ? "mt-4 text-center" : "mt-8 text-center"}>
        <LinkButton href="https://testnet.strikefinance.org" variant="ghost">No testnet balance yet? Fund your Strike account ↗</LinkButton>
      </div>
    </>
  );
}

function Step({ n, title, state, compact = false, children }: { n: number; title: string; state: "done" | "current" | "todo"; compact?: boolean; children: ReactNode }) {
  return (
    <Glass proof={state === "current"} className={`${compact ? "p-5" : "p-6"} ${state === "todo" ? "opacity-60" : ""}`}>
      <div className="mb-5 flex items-center gap-3">
        <span
          className={`num flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium ${
            state === "done" ? "bg-white text-black" : state === "current" ? "btn-plasma" : "border border-edge text-dim"
          }`}
        >
          {state === "done" ? "✓" : n}
        </span>
        <h2 className="font-display text-[16px] font-medium">{title}</h2>
      </div>
      {children}
    </Glass>
  );
}

function WalletOption({ name, hint, connected, disabled, onClick, className = "" }: { name: string; hint: string; connected: string | null; disabled: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition disabled:opacity-45 ${
        connected ? "border-blue bg-blue/10 shadow-[0_0_24px_rgba(77,124,255,.3)]" : "border-edge hover:border-white/20"
      } ${className}`}
    >
      <span className="min-w-0">
        <span className="block text-[14px] font-medium">{name}</span>
        <span className="num mt-0.5 block truncate text-[12.5px] text-dim">{connected ? shortAddr(connected) : `${hint} · click to connect`}</span>
      </span>
      {connected && <span className="shrink-0 text-[12.5px] text-ok">✓ connected</span>}
    </button>
  );
}
