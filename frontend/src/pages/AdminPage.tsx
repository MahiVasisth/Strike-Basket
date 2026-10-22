import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createApi, heroApi, testnetApi, type PlanResult } from "../lib/api";
import { colorsFor } from "../lib/colors";
import { qty, skipText, ticker, usd, warningText } from "../lib/format";
import { safeStorage } from "../lib/hooks";
import { Button, CardTitle, Chip, EnvPill, ErrorNote, Glass, GlowDot, Page, StatusChip } from "../components/ui";

const store = safeStorage("session");

/** Hidden operator panel. Each backend has its own token and pause state. */
export function AdminPage() {
  const qc = useQueryClient();
  const [which, setWhich] = useState<"hero" | "testnet">("hero");
  const base = which === "hero" ? heroApi : testnetApi ?? heroApi;
  const key = `sb.admin.${which}`;
  const [token, setToken] = useState(() => store.get("sb.admin.hero") ?? "");
  const api = createApi(base.base, token || undefined);
  const health = useQuery({ queryKey: [base.base, "health"], queryFn: base.health, refetchInterval: 5000 });
  const basket = useQuery({ queryKey: [base.base, "basket"], queryFn: base.basket });
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<(PlanResult & { dry: boolean }) | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const switchTo = (w: "hero" | "testnet") => {
    setWhich(w);
    setToken(store.get(`sb.admin.${w}`) ?? "");
    setResult(null);
    setErr(null);
  };

  const act = async (name: string, fn: () => Promise<unknown>, dry = false) => {
    setBusy(name);
    setErr(null);
    try {
      const r = await fn();
      if (r && typeof r === "object" && "legs" in r) setResult({ ...(r as PlanResult), dry });
      qc.invalidateQueries({ queryKey: [base.base] });
    } catch (e) {
      setErr(`${name} failed: ${(e as Error).message}. ${/unauthorized/i.test((e as Error).message) ? "Check the admin token." : ""}`);
    } finally {
      setBusy(null);
    }
  };

  const paused = health.data?.paused;
  const color = basket.data ? colorsFor(basket.data.constituents) : () => "#8A90A2";

  return (
    <Page className="max-w-3xl space-y-4 pt-10">
      <h1 className="font-display text-[40px] font-medium" style={{ letterSpacing: "-0.04em" }}>Admin</h1>

      <Glass className="p-6">
        <CardTitle right={basket.data && <EnvPill basket={basket.data} />}>Instance</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant={which === "hero" ? "plasma" : "secondary"} onClick={() => switchTo("hero")}>Pre-IPO</Button>
          {testnetApi && <Button variant={which === "testnet" ? "plasma" : "secondary"} onClick={() => switchTo("testnet")}>Testnet</Button>}
        </div>
        <label className="mt-5 block">
          <span className="text-[12.5px] text-dim">Admin token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value); store.set(key, e.target.value || null); }}
            className="num mt-1.5 w-full rounded-2xl border border-edge bg-black px-4 py-3 text-[14px] outline-none focus:border-violet"
            placeholder="ADMIN_TOKEN"
          />
        </label>
        <p className="mt-2 text-[12.5px] text-dim">Kept in this tab's session storage. Sent as a Bearer token to <span className="num">{base.base}</span>.</p>
      </Glass>

      <Glass className="p-6">
        <CardTitle right={health.data && <Chip tone={paused ? "grey" : "ok"}>{paused ? "paused" : "running"}</Chip>}>Controls</CardTitle>
        <div className="flex flex-wrap gap-2">
          {paused ? (
            <Button variant="plasma" disabled={!!busy} onClick={() => act("Resume", () => api.post("/api/admin/resume"))}>Resume</Button>
          ) : (
            <Button disabled={!!busy} onClick={() => act("Pause", () => api.post("/api/admin/pause"))}>Pause</Button>
          )}
          <Button disabled={!!busy} onClick={() => act("Dry run", () => api.post("/api/admin/rebalance", { force: true, dryRun: true }), true)}>Dry run</Button>
          <Button disabled={!!busy} onClick={() => act("Rebalance now", () => api.post("/api/admin/rebalance", { force: true }))}>Rebalance now</Button>
          <Button
            variant="danger"
            disabled={!!busy || !paused}
            title={paused ? undefined : "Pause first"}
            onClick={() => window.confirm("Flatten closes every basket position. Continue?") && act("Flatten", () => api.post("/api/admin/flatten"))}
          >
            Flatten
          </Button>
        </div>
        {!paused && <p className="mt-3 text-[12.5px] text-dim">Flatten is available only while paused.</p>}
        {busy && <p className="mt-3 text-[13px] text-dim">{busy}…</p>}
        {err && <div className="mt-4"><ErrorNote>{err}</ErrorNote></div>}
      </Glass>

      {result && (
        <Glass className="p-6">
          <CardTitle right={<StatusChip status={result.status} />}>{result.dry ? "Dry run result (nothing sent)" : "Result"}</CardTitle>
          {result.legs.length === 0 ? (
            <p className="text-[13.5px] text-dim">No orders planned.</p>
          ) : (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-edge text-left text-[12px] text-dim">
                  <th className="pb-2.5 font-normal">Market</th><th className="pb-2.5 font-normal">Side</th>
                  <th className="pb-2.5 text-right font-normal">Qty</th><th className="pb-2.5 text-right font-normal">Notional</th>
                </tr>
              </thead>
              <tbody>
                {result.legs.map((l, i) => (
                  <tr key={i} className="border-b border-edge last:border-0">
                    <td className="py-2.5"><span className="flex items-center gap-2"><GlowDot color={color(l.symbol)} />{ticker(l.symbol)}</span></td>
                    <td className={`py-2.5 ${l.side === "buy" ? "text-ok" : "text-bad"}`}>{l.side}</td>
                    <td className="num py-2.5 text-right">{qty(l.qty)}</td>
                    <td className="num py-2.5 text-right text-dim">{usd(l.notional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result.skipped?.map((s) => <p key={s.symbol} className="mt-2 text-[13px] text-dim">Skipped {ticker(s.symbol)}: {(skipText[s.reason] ?? s.reason).toLowerCase()}.</p>)}
          {result.warnings?.map((w) => <p key={w} className="mt-2 text-[13px] text-warn">{warningText(w)}.</p>)}
        </Glass>
      )}
    </Page>
  );
}
