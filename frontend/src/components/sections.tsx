import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { Basket, BasketListing, Gate, Health, Leg, RunDetail, RunSummary, WeightRow } from "../lib/api";
import { testnetApi } from "../lib/api";
import { colorsFor, marketColor } from "../lib/colors";
import { ago, bpsAsPct, engineStale, gateFailureText, price, qty, skipText, ticker, triggerLabel, usd, pct, warningText } from "../lib/format";
import { useNow } from "../lib/hooks";
import { MiniRing } from "./OrbitRing";
import { CardTitle, Chip, Empty, Glass, GlowDot, LinkButton, OrderIdChip, SkeletonRows, StatTile, StatusChip } from "./ui";

// ---------- status line ----------

export function StatusLine({ health }: { health?: Health }) {
  const now = useNow();
  if (!health) return <div className="h-5 w-72 shimmer" />;
  const stale = engineStale(health, now);
  const color = stale || health.lastError ? "#FFB020" : "#18E2A0";
  const mins = (ms: number | null) => {
    if (!ms) return "—";
    const s = Math.max(0, Math.round((ms - now) / 1000));
    return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] text-dim">
      <GlowDot color={color} />
      <span>
        <span className="text-text">{stale ? "Engine late." : "Engine alive."}</span> Checked <span className="num text-text">{ago(health.lastTickAt, now)}</span>
        {health.nextTickAt && <>, next check in <span className="num text-text">{mins(health.nextTickAt)}</span></>}.
      </span>
      {health.paused && <Chip tone="bad">Paused</Chip>}
      {health.lastError && <span className="text-warn">Last error: {health.lastError}</span>}
    </div>
  );
}

// ---------- ticker strip ----------

export function TickerStrip({ basket, weights, gates }: { basket: Basket; weights?: WeightRow[]; gates?: Gate[] }) {
  const color = colorsFor(basket.constituents);
  return (
    <div className="grid gap-px overflow-hidden rounded-[22px] border border-edge bg-white/[0.09] sm:grid-cols-2 lg:grid-cols-4">
      {basket.constituents.map((c) => {
        const w = weights?.find((x) => x.symbol === c.symbol);
        const g = gates?.find((x) => x.symbol === c.symbol);
        const tone = !g ? "text-dim" : !g.ok ? "text-bad" : g.warnings.length ? "text-warn" : "text-ok";
        const label = !g ? "" : !g.ok ? "blocked" : g.warnings.length ? "warning" : "passes";
        return (
          <div key={c.symbol} className="bg-[#07080d]/95 px-5 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <GlowDot color={color(c.symbol)} />
                <span className="num text-[13.5px] font-medium text-text">{ticker(c.symbol)}</span>
                <span className="num text-[13.5px] text-dim">{w ? price(w.mark) : "—"}</span>
              </div>
              <span className={`num text-[12px] ${tone}`}>{g ? `● ${label}` : "—"}</span>
            </div>
            <div className="num mt-1.5 flex justify-between gap-3 text-[11.5px] text-dim">
              <span>spread {g?.spreadBps != null ? `${g.spreadBps.toFixed(1)} bps` : "—"}</span>
              <span>mark vs book {g?.markMidDeviationBps != null ? `${g.markMidDeviationBps.toFixed(1)} bps` : "—"}</span>
            </div>
            {g && (g.failures.length > 0 || g.warnings.length > 0) && (
              <div className={`mt-1.5 text-[12px] ${g.failures.length ? "text-bad" : "text-warn"}`}>
                {[...g.failures.map(gateFailureText), ...g.warnings.map(warningText)].join(" · ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- proof card: same engine, real orders on testnet ----------

export const isSimulated = (l: Pick<Leg, "strikeOrderId">) => !l.strikeOrderId || l.strikeOrderId.startsWith("paper-");

export function ProofCard({ className = "" }: { className?: string }) {
  const api = testnetApi!;
  const k = api.base;
  const basket = useQuery({ queryKey: [k, "basket"], queryFn: api.basket, refetchInterval: 60_000 });
  const state = useQuery({ queryKey: [k, "state"], queryFn: api.state, refetchInterval: 15_000 });
  const live = useQuery({
    queryKey: [k, "run", "last-live"],
    queryFn: async (): Promise<RunDetail | null> => {
      const runs = await api.rebalances(20);
      const r = runs.find((x) => x.mode === "live" && (x.status === "done" || x.status === "partial"));
      return r ? api.rebalance(r.id) : null;
    },
    refetchInterval: 30_000,
  });
  const b = basket.data, s = state.data, run = live.data;
  const ids = (run?.legs ?? []).filter((l) => !isSimulated(l)).slice(0, 2);
  const filled = run?.legs.filter((l) => l.status === "filled").length ?? 0;

  return (
    <Glass proof className={`flex flex-col p-6 ${className}`}>
      <CardTitle right={run ? <StatusChip status={run.status} /> : <Chip tone="grey">waiting</Chip>}>Proof · live Strike vault on testnet</CardTitle>
      <h3 className="font-display text-[26px] font-medium leading-tight">Same engine, real orders</h3>
      <p className="mt-2 text-[13.5px] leading-relaxed text-dim">Testnet lists only crypto, so the live-vault proof runs on BTC/ETH.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-dim">
        <span>Vault</span>
        {b?.vault.id ? <OrderIdChip id={b.vault.id} /> : <span className="num">not created yet</span>}
        {b?.vault.url && <a href={b.vault.url} target="_blank" rel="noreferrer" className="text-violet hover:underline">View on Strike ↗</a>}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2.5">
        <StatTile label="Share price" value={s?.sharePrice ? usd(s.sharePrice, 4) : "—"} />
        <StatTile label="Equity" value={s ? usd(s.equity, 0) : "—"} />
        <StatTile label="Depositors" value={s?.depositors ?? "—"} />
      </div>
      <div className="mt-5 flex-1 text-[13.5px] text-dim">
        {run ? (
          <>
            <p>
              <span className="text-text">{triggerLabel[run.trigger] ?? run.trigger}</span> {ago(run.createdAt)}: {filled} of {run.legs.length} orders filled on Strike.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {ids.map((l) => (
                <div key={l.idx} className="flex min-w-0 items-center gap-2">
                  <span className="num w-10 shrink-0 text-[12px] text-dim">{ticker(l.symbol)}</span>
                  <OrderIdChip id={l.strikeOrderId!} />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p>{b?.vault.id ? "Vault connected, waiting for first rebalance." : "Testnet engine running. Live vault orders appear here once the vault is funded."}</p>
        )}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {run && <LinkButton to={`/testnet/rebalances/${run.id}`} variant="plasma">Open rebalance</LinkButton>}
        <LinkButton to="/testnet" variant={run ? "secondary" : "plasma"}>Full testnet view →</LinkButton>
      </div>
    </Glass>
  );
}

// ---------- rules ----------

export function RulesCard({ basket, className = "" }: { basket: Basket; className?: string }) {
  const r = basket.rules;
  const rows: [string, string][] = [
    ["Exposure", `Positions ≤ ${r.grossExposure}× equity. No leverage.`],
    ["Rebalances at", `${bpsAsPct(r.driftThresholdBps)} drift`],
    ["Cooldown", `${r.cooldownMin} min between drift rebalances`],
    ["Margin", `${r.marginMode}, ${r.symbolLeverage}x setting`],
    ["Order caps", `${usd(r.maxLegNotionalUsd, 0)} per order, ${usd(r.maxRunNotionalUsd, 0)} per run`],
    ["Market checks", `spread ≤ ${bpsAsPct(r.gates.maxSpreadBps, 2)}, book ≤ ${r.gates.maxBookAgeSec}s old`],
    ["Checks every", `${Math.max(1, Math.round(r.cycleSeconds / 60))} min`],
  ];
  return (
    <Glass className={`p-6 ${className}`}>
      <CardTitle>Rules the bot follows</CardTitle>
      <dl className="divide-y divide-edge">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2.5 text-[13px]">
            <dt className="text-dim">{k}</dt>
            <dd className="text-right text-text">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 pt-3 text-[13px]">
          <dt className="text-dim">Withdrawals</dt>
          <dd className="text-right font-medium text-ok">Bot can't. Only you, on Strike.</dd>
        </div>
      </dl>
    </Glass>
  );
}

// ---------- holdings against targets ----------

function driftTone(bps: number, thr: number) {
  const a = Math.abs(bps);
  return a >= thr ? "text-bad" : a >= thr * 0.6 ? "text-warn" : "text-ok";
}

export function HoldingsTable({ basket, rows, thresholdBps }: { basket: Pick<Basket, "constituents">; rows?: WeightRow[]; thresholdBps: number }) {
  const color = colorsFor(basket.constituents);
  const nameOf = (s: string) => basket.constituents.find((c) => c.symbol === s)?.name ?? `${ticker(s)} (outside basket)`;
  if (!rows) return <SkeletonRows rows={basket.constituents.length || 4} />;
  if (!rows.length) return <Empty>No positions yet. The first allocation happens on the engine's first check.</Empty>;
  const th = "pb-3 text-left text-[12px] font-normal text-dim";
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-[13.5px] sm:min-w-[580px]">
        <thead>
          <tr className="border-b border-edge">
            <th className={`${th} pl-1`}>Market</th>
            <th className={`${th} hidden text-right sm:table-cell`}>Mark</th>
            <th className={`${th} w-[26%] pl-3 sm:pl-5`}><span className="hidden sm:inline">Weight vs target</span></th>
            <th className={`${th} text-right`}>Current</th>
            <th className={`${th} hidden text-right sm:table-cell`}>Target</th>
            <th className={`${th} text-right`}>Drift</th>
            <th className={`${th} hidden pr-1 text-right sm:table-cell`}>Qty</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = color(r.symbol);
            const max = Math.max(0.5, r.targetWeight * 1.6, r.currentWeight);
            return (
              <tr key={r.symbol} className={`border-b border-edge last:border-0 ${Math.abs(r.driftBps) >= thresholdBps ? "bg-bad/[0.08]" : ""}`}>
                <td className="py-3 pl-1">
                  <span className="flex items-center gap-2.5"><GlowDot color={c} /><span className="text-text">{nameOf(r.symbol)}</span></span>
                </td>
                <td className="num hidden py-3 text-right text-dim sm:table-cell">{price(r.mark)}</td>
                <td className="py-3 pl-3 sm:pl-5">
                  <div className="relative h-1.5 rounded-full bg-white/[0.07]">
                    <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${(r.currentWeight / max) * 100}%`, background: c, boxShadow: `0 0 10px ${c}` }} />
                    <div className="absolute -top-1 -bottom-1 w-0.5 rounded bg-white" style={{ left: `${(r.targetWeight / max) * 100}%` }} title={`Target ${pct(r.targetWeight)}`} />
                  </div>
                </td>
                <td className="num py-3 text-right text-text">{pct(r.currentWeight)}</td>
                <td className="num hidden py-3 text-right text-dim sm:table-cell">{pct(r.targetWeight)}</td>
                <td className={`num py-3 text-right ${driftTone(r.driftBps, thresholdBps)}`}>
                  {r.driftBps > 0 ? "+" : r.driftBps < 0 ? "−" : ""}{Math.abs(Math.round(r.driftBps))} bps
                </td>
                <td className="num hidden py-3 pr-1 text-right text-dim sm:table-cell">{qty(r.currentQty)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- rebalance log ----------

export function LogList({ runs, linkBase, limit }: { runs?: RunSummary[]; linkBase: string; limit?: number }) {
  if (!runs) return <SkeletonRows rows={4} />;
  if (!runs.length) return <Empty>No rebalances yet. The first allocation runs on the engine's first check.</Empty>;
  return (
    <ul className="divide-y divide-edge">
      {(limit ? runs.slice(0, limit) : runs).map((r) => (
        <li key={r.id}>
          <Link to={`${linkBase}/${r.id}`} className="flex items-center gap-3 rounded-lg py-3 transition hover:bg-white/[0.03]">
            <span className="num w-[86px] shrink-0 text-[12px] text-dim">{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-text">
              {triggerLabel[r.trigger] ?? r.trigger}
              {r.legCount > 0 && <span className="text-dim"> · {r.legCount} orders</span>}
            </span>
            <StatusChip status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------- coming soon ----------

export function ComingSoonRow({ baskets }: { baskets: BasketListing[] }) {
  const soon = baskets.filter((b) => b.status === "coming_soon" && !/testnet/i.test(b.name));
  if (!soon.length) return null;
  return (
    <div>
      <h2 className="font-display text-[22px] font-medium">Coming soon</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {soon.map((b) => (
          <Glass key={b.id} as="article" className="flex items-center gap-5 p-5 opacity-70">
            <MiniRing parts={b.constituents.map((c, i) => ({ color: marketColor(c.symbol, i), weight: c.weight }))} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-[17px] font-medium">{b.name}</span>
                <Chip tone="grey">coming soon</Chip>
              </div>
              <p className="mt-1 text-[13px] text-dim">{b.tagline}</p>
              <p className="num mt-2 text-[12px] text-dim">{b.constituents.map((c) => `${ticker(c.symbol)} ${pct(c.weight, 0)}`).join(" · ")}</p>
            </div>
          </Glass>
        ))}
      </div>
    </div>
  );
}

// ---------- rebalance detail pieces ----------

export function BeforeAfter({ basket, rows }: { basket: Pick<Basket, "constituents">; rows: WeightRow[] }) {
  const color = colorsFor(basket.constituents);
  const bar = (key: "currentWeight" | "targetWeight", dim: boolean) => {
    const total = rows.reduce((a, r) => a + r[key], 0) || 1;
    return (
      <div className="flex h-4 w-full gap-[3px] overflow-hidden rounded-full bg-white/[0.05]">
        {rows.map((r) =>
          r[key] > 0 ? (
            <div
              key={r.symbol}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ width: `${(r[key] / total) * 100}%`, background: color(r.symbol), opacity: dim ? 0.4 : 1, boxShadow: dim ? undefined : `0 0 12px ${color(r.symbol)}` }}
            />
          ) : null,
        )}
      </div>
    );
  };
  const empty = rows.every((r) => r.currentWeight === 0);
  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-3"><span className="w-14 text-[12.5px] text-dim">Before</span>{empty ? <div className="h-4 flex-1 rounded-full border border-dashed border-white/20" /> : bar("currentWeight", false)}</div>
        <div className="flex items-center gap-3"><span className="w-14 text-[12.5px] text-dim">Target</span>{bar("targetWeight", true)}</div>
      </div>
      <table className="mt-5 w-full text-[13.5px]">
        <thead>
          <tr className="border-b border-edge text-left text-[12px] text-dim">
            <th className="pb-2.5 font-normal">Market</th>
            <th className="pb-2.5 text-right font-normal">Before</th>
            <th className="pb-2.5 text-right font-normal">Target</th>
            <th className="pb-2.5 text-right font-normal">Drift</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-edge last:border-0">
              <td className="py-2.5"><span className="flex items-center gap-2"><GlowDot color={color(r.symbol)} />{ticker(r.symbol)}</span></td>
              <td className="num py-2.5 text-right text-dim">{pct(r.currentWeight)}</td>
              <td className="num py-2.5 text-right text-text">{pct(r.targetWeight)}</td>
              <td className="num py-2.5 text-right text-dim">{r.driftBps > 0 ? "+" : r.driftBps < 0 ? "−" : ""}{Math.abs(Math.round(r.driftBps))} bps</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function GatesList({ basket, gates }: { basket: Pick<Basket, "constituents">; gates: Gate[] }) {
  const color = colorsFor(basket.constituents);
  if (!gates.length) return <Empty>No market checks were recorded for this run.</Empty>;
  return (
    <ul className="space-y-2">
      {gates.map((g) => (
        <li key={g.symbol} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-white/[0.02] px-3.5 py-2.5 text-[13px]">
          <span className="flex items-center gap-2"><GlowDot color={color(g.symbol)} />{ticker(g.symbol)}</span>
          <span className="num text-[12px] text-dim">
            spread {g.spreadBps != null ? `${g.spreadBps.toFixed(1)} bps` : "—"} · mark vs book {g.markMidDeviationBps != null ? `${g.markMidDeviationBps.toFixed(1)} bps` : "—"}
          </span>
          {g.ok ? <Chip tone="ok">passed</Chip> : <Chip tone="bad">{g.failures.map(gateFailureText).join(", ") || "failed"}</Chip>}
        </li>
      ))}
    </ul>
  );
}

export function PlanNotes({ plan }: { plan: RunDetail["plan"] }) {
  if (!plan.skipped.length && !plan.warnings.length) return <p className="text-[13.5px] text-dim">Nothing skipped. Every planned order was sent.</p>;
  return (
    <ul className="space-y-2 text-[13.5px]">
      {plan.skipped.map((s) => (
        <li key={s.symbol + s.reason} className="text-dim">
          <span className="text-text">Skipped {ticker(s.symbol)}</span> ({usd(s.deltaNotional)}): {(skipText[s.reason] ?? s.reason).toLowerCase()}.
        </li>
      ))}
      {plan.warnings.map((w) => <li key={w} className="text-warn">{warningText(w)}.</li>)}
    </ul>
  );
}

export function OrdersTable({ basket, legs }: { basket: Pick<Basket, "constituents">; legs: Leg[] }) {
  const color = colorsFor(basket.constituents);
  if (!legs.length) return <Empty>No orders were sent in this run.</Empty>;
  const th = "pb-3 text-left text-[12px] font-normal text-dim whitespace-nowrap";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-[13.5px]">
        <thead>
          <tr className="border-b border-edge">
            <th className={th}>Market</th>
            <th className={th}>Side</th>
            <th className={`${th} text-right`}>Qty</th>
            <th className={`${th} text-right`}>Est. notional</th>
            <th className={`${th} pl-5`}>Method</th>
            <th className={`${th} text-right`}>Filled</th>
            <th className={`${th} pl-5`}>Status</th>
            <th className={th}>{legs.some((l) => !isSimulated(l)) ? "Strike order ID" : "Order ID"}</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((l) => {
            const sim = isSimulated(l);
            return (
              <tr key={l.idx} className="border-b border-edge last:border-0">
                <td className="py-3"><span className="flex items-center gap-2"><GlowDot color={color(l.symbol)} />{ticker(l.symbol)}</span></td>
                <td className="py-3">
                  <span className={`num rounded-full border px-2.5 py-0.5 text-[11.5px] ${l.side === "buy" ? "border-ok/40 bg-ok/10 text-ok" : "border-bad/40 bg-bad/10 text-bad"}`}>
                    {l.side}{l.reduceOnly ? " · reduce" : ""}
                  </span>
                </td>
                <td className="num py-3 text-right">{qty(l.qty)}</td>
                <td className="num py-3 text-right text-dim">{usd(l.notionalEst)}</td>
                <td className="num py-3 pl-5 text-dim">{l.method}{l.twapId ? " ↻" : ""}</td>
                <td className="num py-3 text-right text-dim">{l.filledQty ? `${qty(l.filledQty)} @ ${price(l.avgPrice)}` : "—"}</td>
                <td className="py-3 pl-5">
                  <div className="flex items-center gap-1.5"><StatusChip status={l.status} />{sim && <Chip tone="sim">simulated</Chip>}</div>
                  {l.error && <div className="mt-1 max-w-[220px] text-[12px] text-bad">{l.error}</div>}
                </td>
                <td className="py-3"><OrderIdChip id={l.strikeOrderId ?? l.clientOrderId} simulated={sim} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const runTitle = (r: Pick<RunSummary, "trigger" | "status">) => {
  const what = triggerLabel[r.trigger] ?? "Rebalance";
  const how: Record<string, string> = { done: "filled", partial: "partly filled", failed: "failed", gated: "held by a market check", executing: "in progress", paused: "paused", shadow: "planned only", cooldown: "cooling down", nothing_tradable: "nothing to trade", noop: "no change" };
  return `${what}, ${how[r.status] ?? r.status}`;
};
