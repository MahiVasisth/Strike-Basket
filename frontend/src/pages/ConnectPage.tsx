import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, heroApi, testnetApi, type PersonalUser } from "../lib/api";
import { shortAddr } from "../lib/format";
import { safeStorage } from "../lib/hooks";
import { useInstances } from "../lib/instances";
import { ADDRESS_KEY, TOKEN_KEY } from "../components/Layout";
import { Button, ErrorNote, Glass, LinkButton, Page } from "../components/ui";

interface Eth { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> }
const eth = () => (window as unknown as { ethereum?: Eth }).ethereum;
const local = safeStorage("local");
type Pending = { connectId: string; messageToSign: string; expiresAt: number };

/** Personal mode onboarding (docs/PERSONAL-MODE.md): pick → wallet → sign. MetaMask only for now. */
export function ConnectPage() {
  const { personal, ready } = useInstances();
  const nav = useNavigate();
  const hero = useQuery({ queryKey: [heroApi.base, "baskets"], queryFn: heroApi.baskets });
  const [basketId, setBasketId] = useState<string | null>(null);
  const [budget, setBudget] = useState("");
  const [address, setAddress] = useState<string | null>(null);
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
    const r = await testnetApi!.post<Pending>("/api/personal/connect/request", { address, chain: "ethereum", basketId, budgetUsd: amount });
    setPending(r);
    return r;
  };

  // A changed choice invalidates the challenge; fetch a fresh one once step 3 opens.
  useEffect(() => setPending(null), [basketId, budget, address]);
  useEffect(() => {
    if (step !== 3 || pending || busy) return;
    const t = setTimeout(() => request().catch((x) => setErr(`Couldn't prepare the message: ${(x as Error).message}`)), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pending, busy]);

  const connectWallet = async () => {
    setErr(null);
    const e = eth();
    if (!e) return setErr("No Ethereum wallet found. Install MetaMask, then reload this page.");
    try {
      const accts = (await e.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accts[0] ?? null);
    } catch (x) {
      setErr(`MetaMask didn't connect: ${(x as Error).message}`);
    }
  };

  const sign = async () => {
    setBusy(true);
    setErr(null);
    const confirm = async (p: Pending) => {
      const signature = (await eth()!.request({ method: "personal_sign", params: [p.messageToSign, address] })) as string;
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
      local.set(TOKEN_KEY, res.token);
      local.set(ADDRESS_KEY, res.user.address);
      nav("/me");
    } catch (x) {
      if (x instanceof ApiError && x.status === 410) setErr("Signature expired after 5 minutes. Sign again.");
      else if (x instanceof ApiError) setErr(`Strike didn't accept the connection: ${x.message}. Check the budget and sign again.`);
      else setErr(`Signing was cancelled or failed: ${(x as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (ready && !personal)
    return (
      <Page className="max-w-2xl py-20">
        <ErrorNote>Personal mode is offline right now (the testnet engine isn't reachable). Try again in a minute.</ErrorNote>
      </Page>
    );

  return (
    <Page className="pt-12">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="gradient-text font-display text-[36px] font-bold leading-[1.02] sm:text-[54px]" style={{ letterSpacing: "-0.05em" }}>
          Run a basket in your own Strike account
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-dim">
          Your money stays in your Strike account. One signature lets the engine keep the basket on target there. Pause or disconnect any time; we can trade, never withdraw.
        </p>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <Step n={1} title="Pick a basket" state={step === 1 ? "current" : "done"}>
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

        <Step n={2} title="Connect your wallet" state={step < 2 ? "todo" : step === 2 ? "current" : "done"}>
          <button
            onClick={connectWallet}
            disabled={step < 2}
            className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition disabled:opacity-45 ${
              address ? "border-blue bg-blue/10 shadow-[0_0_24px_rgba(77,124,255,.3)]" : "border-edge hover:border-white/20"
            }`}
          >
            <span>
              <span className="block text-[14px] font-medium">MetaMask</span>
              <span className="num mt-0.5 block text-[12.5px] text-dim">{address ? shortAddr(address) : "Ethereum · click to connect"}</span>
            </span>
            {address && <span className="text-[12.5px] text-ok">✓ connected</span>}
          </button>
          {["Phantom", "Lace"].map((w) => (
            <div key={w} className="mt-2 flex items-center justify-between rounded-2xl border border-edge px-4 py-3.5 opacity-45">
              <span className="text-[14px]">{w}</span>
              <span className="text-[12.5px] text-dim">Coming soon</span>
            </div>
          ))}
          {address && <button onClick={connectWallet} className="mt-3 text-[13px] text-dim hover:text-text">Use a different account</button>}
        </Step>

        <Step n={3} title="Sign to connect" state={step === 3 ? "current" : "todo"}>
          <div className="num max-h-56 min-h-[120px] overflow-auto whitespace-pre-wrap rounded-2xl border border-dashed border-white/25 bg-black p-4 text-[12px] leading-relaxed text-dim">
            {pending ? pending.messageToSign : step === 3 ? "Preparing Strike's message…" : "Strike's message appears here. Your wallet shows the same text."}
          </div>
          <Button variant="plasma" disabled={step !== 3 || busy || !pending} onClick={sign} className="mt-4 w-full !py-3">
            {busy ? "Waiting for MetaMask…" : "Sign in MetaMask"}
          </Button>
          <ul className="mt-4 space-y-1.5 text-[13px]">
            {["A signature, not a transaction", "No gas, no funds move", "Trades only, can never withdraw"].map((t) => (
              <li key={t} className="flex items-center gap-2"><span className="text-ok">✓</span><span className="text-text/90">{t}</span></li>
            ))}
          </ul>
        </Step>
      </div>

      {err && <div className="mx-auto mt-6 max-w-2xl"><ErrorNote>{err}</ErrorNote></div>}
      <div className="mt-8 text-center">
        <LinkButton href="https://testnet.strikefinance.org" variant="ghost">No testnet balance yet? Fund your Strike account ↗</LinkButton>
      </div>
    </Page>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "current" | "todo"; children: ReactNode }) {
  return (
    <Glass proof={state === "current"} className={`p-6 ${state === "todo" ? "opacity-60" : ""}`}>
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
