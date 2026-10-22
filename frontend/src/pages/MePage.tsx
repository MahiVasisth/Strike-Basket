import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, createApi, testnetApi, type MeView, type RunSummary } from "../lib/api";
import { colorsFor } from "../lib/colors";
import { ago, shortAddr, usd, warningText } from "../lib/format";
import { safeStorage, useNow } from "../lib/hooks";
import { DriftGauge } from "../components/Gauge";
import { ADDRESS_KEY, TOKEN_KEY } from "../components/Layout";
import { OrbitRing } from "../components/OrbitRing";
import { HoldingsTable, LogList } from "../components/sections";
import { Button, CardTitle, Chip, ErrorNote, Glass, LinkButton, Page, Skeleton } from "../components/ui";

const local = safeStorage("local");
export const meApi = () => createApi(testnetApi!.base, local.get(TOKEN_KEY) ?? undefined);

/** "My basket" (FRONTEND.md §1.6). Private data has no SSE, so it polls every 15 s. */
export function MePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const now = useNow(5000);
  const api = useMemo(meApi, []);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<MeView>("/api/me"), refetchInterval: 15_000, retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2 });
  const runs = useQuery({ queryKey: ["me", "runs"], queryFn: () => api.get<RunSummary[]>("/api/me/rebalances?limit=25"), refetchInterval: 15_000 });
  const listings = useQuery({ queryKey: [testnetApi!.base, "baskets"], queryFn: testnetApi!.baskets });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);

  const unauthorized = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (!unauthorized) return;
    local.set(TOKEN_KEY, null);
    local.set(ADDRESS_KEY, null);
    nav("/connect", { replace: true });
  }, [unauthorized, nav]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      setErr(`${name} didn't work: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect? Trading stops and our key is deleted. Your positions stay in your Strike account.")) return;
    try {
      const r = await api.del<{ note: string }>("/api/me");
      local.set(TOKEN_KEY, null);
      local.set(ADDRESS_KEY, null);
      setNote(r.note);
    } catch (e) {
      setErr(`Disconnect didn't work: ${(e as Error).message}. Try again.`);
    }
  };

  if (note)
    return (
      <Page className="max-w-2xl py-20">
        <Glass className="p-8">
          <Chip tone="ok">disconnected</Chip>
          <p className="mt-4 text-[15px] leading-relaxed text-text/90">{note}</p>
          <div className="mt-6"><LinkButton to="/" variant="plasma">Back to the basket</LinkButton></div>
        </Glass>
      </Page>
    );

  const v = me.data, u = v?.user, s = v?.state;
  if (u && local.get(ADDRESS_KEY) !== u.address) local.set(ADDRESS_KEY, u.address);
  const listing = listings.data?.find((b) => b.id === u?.basketId);
  const constituents = listing?.constituents ?? [];
  const color = colorsFor(constituents);
  const paused = u?.status === "paused";
  const lowEquity = s?.warnings.find((w) => w.startsWith("ACCOUNT_EQUITY_BELOW_BUDGET"));
  const threshold = s?.driftThresholdBps ?? 500;

  return (
    <Page className="space-y-4 pt-8">
      <Glass className="flex flex-wrap items-center justify-between gap-5 p-6">
        <div>
          <div className="text-[13px] text-dim">My basket · Strike testnet</div>
          <h1 className="gradient-text mt-1 font-display text-[34px] font-bold sm:text-[44px]" style={{ letterSpacing: "-0.05em" }}>{listing?.name ?? (u ? u.basketId : "…")}</h1>
          {u && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-dim">
              <Chip tone={paused ? "grey" : "ok"}>{paused ? "paused" : "active"}</Chip>
              <span className="num text-text">{shortAddr(u.address)}</span>
              <span>· budget <span className="num text-text">{usd(u.budgetUsd, 0)}</span></span>
              <span>· checked {ago(v?.health.lastTickAt, now)}</span>
            </div>
          )}
        </div>
        <p className="max-w-xs text-[13px] text-dim">Your Strike account. You can pause or disconnect any time. We can trade, never withdraw.</p>
      </Glass>

      {me.error && !unauthorized && <ErrorNote>Couldn't load your basket: {(me.error as Error).message}. It retries every 15 seconds.</ErrorNote>}
      {err && <ErrorNote>{err}</ErrorNote>}
      {lowEquity && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-[13.5px] text-warn">
          <span>{warningText(lowEquity)}. Fund it so the bot can build your basket.</span>
          <LinkButton href="https://testnet.strikefinance.org" variant="white" className="!py-2">Fund your Strike account ↗</LinkButton>
        </div>
      )}

      {!v ? (
        <Glass className="p-6"><Skeleton className="h-60" /></Glass>
      ) : !s ? (
        <Glass className="p-6 text-[14.5px] text-dim">Connected. First check runs within a few seconds.</Glass>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12 [&>*]:min-w-0">
          <Glass className="p-4 lg:col-span-7">
            <OrbitRing
              segments={constituents.map((c) => {
                const w = s.weights.find((x) => x.symbol === c.symbol);
                return { symbol: c.symbol, name: c.name, color: color(c.symbol), current: w?.currentWeight ?? 0, target: c.weight, driftBps: w?.driftBps ?? 0 };
              })}
              equity={s.basketEquity}
              maxDriftBps={s.maxDriftBps}
              thresholdBps={threshold}
            />
          </Glass>
          <Glass className="p-6 lg:col-span-5">
            <CardTitle>Drift</CardTitle>
            <DriftGauge driftBps={s.maxDriftBps} thresholdBps={threshold} />
          </Glass>
          <Glass className="p-6 lg:col-span-8">
            <CardTitle>Holdings against targets</CardTitle>
            <HoldingsTable basket={{ constituents }} rows={s.weights} thresholdBps={threshold} />
          </Glass>
          <Glass className="p-6 lg:col-span-4">
            <CardTitle>My rebalances</CardTitle>
            <LogList runs={runs.data} linkBase="/me/rebalances" limit={8} />
          </Glass>
        </div>
      )}

      {u && (
        <Glass className="p-6">
          <CardTitle>Controls</CardTitle>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center rounded-full border border-edge bg-black pl-4">
              <span className="num text-dim">$</span>
              <input
                inputMode="decimal"
                value={budget ?? String(u.budgetUsd)}
                onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                className="num w-24 bg-transparent px-2 py-2.5 text-[14px] outline-none"
                aria-label="Budget in USD"
              />
              <Button
                className="!py-2"
                disabled={!!busy || budget === null || Number(budget) === u.budgetUsd || !(Number(budget) > 0)}
                onClick={() => act("Edit budget", async () => { await api.put("/api/me", { budgetUsd: Number(budget) }); setBudget(null); })}
              >
                Edit budget
              </Button>
            </div>
            {paused ? (
              <Button variant="plasma" disabled={!!busy} onClick={() => act("Resume", () => api.post("/api/me/resume"))}>Resume</Button>
            ) : (
              <Button disabled={!!busy} onClick={() => act("Pause", () => api.post("/api/me/pause"))}>Pause</Button>
            )}
            <Button disabled={!!busy || paused} onClick={() => act("Rebalance now", () => api.post("/api/me/rebalance", { force: true }))}>Rebalance now</Button>
            <Button
              variant="danger"
              disabled={!!busy || !paused}
              title={paused ? undefined : "Pause first"}
              onClick={() => window.confirm("Close every basket position in your Strike account?") && act("Flatten", () => api.post("/api/me/flatten"))}
            >
              Flatten
            </Button>
            <Button variant="ghost" onClick={disconnect} className="sm:ml-auto">Disconnect</Button>
          </div>
          {!paused && <p className="mt-3 text-[12.5px] text-dim">Flatten is available after you pause.</p>}
          {busy && <p className="mt-3 text-[13px] text-dim">{busy}…</p>}
        </Glass>
      )}
    </Page>
  );
}
