import { Link } from "react-router-dom";
import type { Api } from "../lib/api";
import { colorsFor } from "../lib/colors";
import { pct, usd } from "../lib/format";
import { useInstances } from "../lib/instances";
import { useInstanceData, useLiveStream } from "../lib/live";
import { EquityChart } from "../components/EquityChart";
import { DriftGauge } from "../components/Gauge";
import { OrbitRing } from "../components/OrbitRing";
import { ComingSoonRow, HoldingsTable, InvestCard, LogList, OrderPreview, ProofCard, RulesCard, StatusLine, TickerStrip } from "../components/sections";
import { CardTitle, ErrorNote, Glass, LinkButton, Page, Skeleton } from "../components/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

export function BasketPage({ api, variant }: { api: Api; variant: "hero" | "testnet" }) {
  const hero = variant === "hero";
  const { testnetUp, personal } = useInstances();
  const streaming = useLiveStream(api);
  const { basket, health, state, snapshots, runs, warming } = useInstanceData(api, { streaming });
  const listings = useQuery({ queryKey: [api.base, "baskets"], queryFn: api.baskets, enabled: hero });

  const b = basket.data;
  const s = state.data;
  // Pre-IPO on mainnet is plan-only: no paper book on the page, an order preview instead (execution is shown on testnet).
  const planOnly = hero && b?.source === "paper";
  const [amount, setAmount] = useState("500");
  const linkBase = hero ? "/rebalances" : "/testnet/rebalances";

  if (basket.error && !b)
    return (
      <Page className="py-20">
        <ErrorNote>
          Can't reach the basket engine at <code className="num">{api.base}</code>. Start the backend, then reload this page. ({(basket.error as Error).message})
        </ErrorNote>
      </Page>
    );

  const color = b ? colorsFor(b.constituents) : () => "#8A90A2";
  const segments = (b?.constituents ?? []).map((c) => {
    const w = s?.weights.find((x) => x.symbol === c.symbol);
    return planOnly
      ? { symbol: c.symbol, name: c.name, color: color(c.symbol), current: c.weight, target: c.weight, driftBps: 0 }
      : { symbol: c.symbol, name: c.name, color: color(c.symbol), current: w?.currentWeight ?? 0, target: c.weight, driftBps: w?.driftBps ?? 0 };
  });
  const gatesOk = s ? s.gates.filter((g) => b?.constituents.some((c) => c.symbol === g.symbol) && g.ok).length : 0;
  const spreads = (s?.gates ?? []).map((g) => g.spreadBps).filter((x): x is number => x !== null).sort((x, y) => x - y);
  const medianSpread = spreads.length ? spreads[Math.floor(spreads.length / 2)] : null;
  const usesSharePrice = !!snapshots.data?.some((p) => p.share_price);
  const points = (snapshots.data ?? []).map((p) => ({ ts: p.ts, v: Number(p.share_price ?? p.equity) })).filter((p) => Number.isFinite(p.v));
  const threshold = s?.driftThresholdBps ?? b?.rules.driftThresholdBps ?? 500;
  const showProof = hero && testnetUp;
  const nameSize = (b?.name.length ?? 0) > 12 ? "text-[44px] sm:text-[60px] lg:text-[68px]" : "text-[58px] sm:text-[80px] lg:text-[96px]";

  return (
    <div>
      {/* ---------- hero ---------- */}
      <Page className="grid items-center gap-6 pt-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:pt-14">
        <div className="rise min-w-0">
          <StatusLine health={health.data} />
          <h1 className={`gradient-text mt-6 font-display font-bold leading-[0.95] ${nameSize}`} style={{ letterSpacing: "-0.05em" }}>
            {b?.name ?? <Skeleton className="h-20 w-72" />}
          </h1>
          {hero && <p className="mt-4 font-display text-[20px] font-light text-text sm:text-[24px]" style={{ letterSpacing: "-0.03em" }}>One deposit, a whole theme.</p>}
          <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-text/90">{b?.tagline}</p>
          {hero && <p className="mt-2 text-[14px] text-dim">The first themed, rules-based basket vault on Strike. Positions ≤ 0.9× equity. No leverage.</p>}

          <dl className="mt-8 grid max-w-lg grid-cols-3 gap-5">
            {s && planOnly ? (
              <>
                <HeroStat k="Markets" v={String(b?.constituents.length ?? "—")} />
                <HeroStat k="Checks passing" v={`${gatesOk}/${b?.constituents.length ?? 0}`} />
                <HeroStat k="Median spread" v={medianSpread !== null ? `${medianSpread.toFixed(1)} bps` : "—"} />
              </>
            ) : s ? (
              s.costs ? (
                <>
                  <HeroStat k="Fees paid" v={usd(s.costs.fees)} />
                  <HeroStat k="Funding" v={usd(s.costs.funding)} />
                </>
              ) : (
                <>
                  <HeroStat k="Share price" v={s.sharePrice ? usd(s.sharePrice, 4) : "—"} />
                  <HeroStat k="Depositors" v={String(s.depositors ?? "—")} />
                </>
              )
            ) : (
              <>
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </>
            )}
            {planOnly ? null : s ? <HeroStat k="Positions vs equity" v={pct(Number(s.bookNotional) / Math.max(1, Number(s.equity)), 0)} /> : <Skeleton className="h-12" />}
          </dl>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            {personal && (
              <LinkButton to="/connect" variant="plasma" className="!py-3">
                {planOnly ? "Try it in your Strike account (testnet)" : "Run this basket in your Strike account"}
              </LinkButton>
            )}
            {!hero && b?.vault.url && <LinkButton href={b.vault.url} variant="white" className="!py-3">Deposit on Strike ↗</LinkButton>}
            <LinkButton to="/how" className="!py-3">How it works</LinkButton>
          </div>
        </div>

        <div className="min-w-0">
          <OrbitRing
            segments={segments}
            equity={planOnly ? amount || "0" : s?.sharePrice ?? s?.equity ?? null}
            centerLabel={planOnly ? "Preview amount" : s?.sharePrice ? "Share price" : "Basket equity"}
            maxDriftBps={planOnly ? null : s ? s.maxDriftBps : null}
            thresholdBps={threshold}
            loading={!s}
          />
          {warming && <p className="mt-2 text-center text-[13px] text-dim">Engine warming up: the first check completes within one cycle.</p>}
        </div>
      </Page>

      <Page className="mt-6 space-y-4">
        {b && <TickerStrip basket={b} weights={s?.weights} gates={s?.gates} />}
        {b && (planOnly ? <OrderPreview api={api} basket={b} amount={amount} onAmount={setAmount} /> : <InvestCard basket={b} />)}

        {/* ---------- bento ---------- */}
        <div className="grid gap-4 lg:grid-cols-12 [&>*]:min-w-0">
          {showProof && <ProofCard className="lg:col-span-5" />}
          {!planOnly && (
            <Glass className={`p-6 ${showProof ? "lg:col-span-3" : "lg:col-span-5"}`}>
              <CardTitle>Drift</CardTitle>
              <DriftGauge driftBps={s ? s.maxDriftBps : null} thresholdBps={threshold} />
            </Glass>
          )}
          {b ? (
            <RulesCard basket={b} className={planOnly ? (showProof ? "lg:col-span-7" : "lg:col-span-12") : showProof ? "lg:col-span-4" : "lg:col-span-7"} />
          ) : (
            <Glass className="p-6 lg:col-span-4"><Skeleton className="h-64" /></Glass>
          )}

          {!planOnly && (
            <>
          <Glass className="p-6 lg:col-span-8">
            <CardTitle right={s?.pendingTrigger ? <span className="text-[12.5px] text-warn">Rebalance pending: {s.pendingTrigger}</span> : undefined}>
              Holdings against targets
            </CardTitle>
            {b && <HoldingsTable basket={b} rows={s?.weights} thresholdBps={threshold} />}
          </Glass>
          <Glass className="p-6 lg:col-span-4">
            <CardTitle right={<Link to={linkBase} className="text-[13px] text-violet hover:underline">See all</Link>}>Rebalance log</CardTitle>
            <LogList runs={runs.data} linkBase={linkBase} limit={6} />
          </Glass>
            </>
          )}
        </div>

{!planOnly && (
        <Glass className="p-6">
          <CardTitle right={<span className="num text-[12px] text-dim">{points.length} snapshots</span>}>
            {usesSharePrice ? "Share price" : "Basket equity"} over time
          </CardTitle>
          <EquityChart points={points} decimals={usesSharePrice ? 4 : 2} />
          <p className="mt-3 text-[12.5px] text-dim">Recorded by the engine each cycle{s?.source === "paper" ? " on a simulated book at live Strike prices" : ""}.</p>
        </Glass>
        )}

        {hero && listings.data && <div className="pt-10"><ComingSoonRow baskets={listings.data} /></div>}
      </Page>
    </div>
  );
}

function HeroStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-dim">{k}</dt>
      <dd className="num mt-1 truncate text-[20px] text-text">{v}</dd>
    </div>
  );
}
