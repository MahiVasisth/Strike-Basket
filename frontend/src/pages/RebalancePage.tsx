import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { Api, Basket, RunDetail } from "../lib/api";
import { dateTime, usd } from "../lib/format";
import { useLiveStream } from "../lib/live";
import { BeforeAfter, GatesList, LogList, OrdersTable, PlanNotes, isSimulated, runTitle } from "../components/sections";
import { CardTitle, Chip, ErrorNote, Glass, OrderIdChip, Page, Skeleton, StatTile, StatusChip } from "../components/ui";

/** Rebalance detail. `load` lets /me reuse it for private runs. */
export function RebalancePage({
  api, back, backLabel, load, live = true,
}: {
  api: Api; back: string; backLabel: string; load?: (id: string) => Promise<RunDetail>; live?: boolean;
}) {
  const { id = "" } = useParams();
  useLiveStream(live ? api : null);
  const run = useQuery({ queryKey: load ? ["me", "run", id] : [api.base, "run", id], queryFn: () => (load ? load(id) : api.rebalance(id)), refetchInterval: (q) => (q.state.data?.status === "executing" ? 3000 : false) });
  const basket = useQuery({ queryKey: [api.base, "basket"], queryFn: api.basket });
  const r = run.data;
  const b: Pick<Basket, "constituents"> | undefined = basket.data;

  if (run.error)
    return (
      <Page className="py-16">
        <ErrorNote>Couldn't load this rebalance: {(run.error as Error).message}. Check the link, or go back to the log.</ErrorNote>
        <Link to={back} className="mt-4 inline-block text-[14px] text-violet">← {backLabel}</Link>
      </Page>
    );

  const real = r ? r.legs.filter((l) => !isSimulated(l)).length : 0;

  return (
    <Page className="space-y-4 pt-8">
      <nav className="flex items-center gap-2 text-[13.5px] text-dim" aria-label="Breadcrumb">
        <Link to={back} className="hover:text-text">{backLabel}</Link>
        <span>/</span>
        <span className="num text-text">{r ? r.id : id}</span>
      </nav>

      {!r || !b ? (
        <Glass className="p-6"><Skeleton className="h-40" /></Glass>
      ) : (
        <>
          <div className="grid items-end gap-6 pb-4 lg:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap gap-2">
                <StatusChip status={r.status} />
                {r.mode === "paper" ? <Chip tone="sim">simulated fills</Chip> : r.mode === "live" ? <Chip tone="blue">live on Strike {r.env}</Chip> : <Chip tone="blue">plan only</Chip>}
              </div>
              <h1 className="gradient-text mt-4 font-display text-[34px] font-medium leading-tight sm:text-[50px]" style={{ letterSpacing: "-0.04em" }}>
                {runTitle(r)}
              </h1>
              {r.error && <p className="mt-3 text-[14px] text-bad">{r.error}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:w-[560px]">
              <StatTile label="Started" value={new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} sub={dateTime(r.createdAt).split(",")[0]} />
              <StatTile label="Status" value={r.status.replace(/_/g, " ")} />
              <StatTile label="Equity then" value={usd(r.equity, 0)} />
              <StatTile label="Basket version" value={`${r.basketId} v${r.basketVersion}`} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Glass className="p-6">
              <CardTitle>Before and after</CardTitle>
              <BeforeAfter basket={b} rows={r.plan.rows} />
            </Glass>
            <div className="space-y-4">
              <Glass className="p-6">
                <CardTitle>Market checks at the time</CardTitle>
                <GatesList basket={b} gates={r.gates} />
              </Glass>
              <Glass className="p-6">
                <CardTitle>Notes from the plan</CardTitle>
                <PlanNotes plan={r.plan} />
              </Glass>
            </div>
          </div>

          <Glass proof className="p-6">
            <CardTitle right={<span className="num text-[12px] text-dim">run <OrderIdChip id={r.id} simulated /></span>}>
              {r.mode === "paper" ? "Orders (simulated fills on live Strike prices)" : "Orders sent to Strike"}
            </CardTitle>
            {real > 0 && <p className="mb-4 text-[13.5px] text-ok">{real} real Strike order{real > 1 ? "s" : ""}. Copy an ID and find it in the vault's order history on Strike.</p>}
            {r.mode === "paper" && r.legs.length > 0 && (
              <p className="mb-4 text-[13.5px] text-dim">These went through the same executor that trades the testnet vault, filled at Strike's bid/ask with the 0.05% taker fee. IDs are simulated and don't exist on Strike.</p>
            )}
            <OrdersTable basket={b} legs={r.legs} />
          </Glass>
        </>
      )}
    </Page>
  );
}

/** Full rebalance log ("See all"). */
export function RunsPage({ api, linkBase, back, backLabel }: { api: Api; linkBase: string; back: string; backLabel: string }) {
  const runs = useQuery({ queryKey: [api.base, "runs", "all"], queryFn: () => api.rebalances(100), refetchInterval: 30_000 });
  return (
    <Page className="max-w-3xl pt-8">
      <Link to={back} className="text-[13.5px] text-dim hover:text-text">← {backLabel}</Link>
      <h1 className="gradient-text mt-4 font-display text-[44px] font-medium" style={{ letterSpacing: "-0.04em" }}>Rebalance log</h1>
      <p className="mt-2 text-[14.5px] text-dim">Every action the bot took. Open one for its orders and IDs.</p>
      <Glass className="mt-8 p-6"><LogList runs={runs.data} linkBase={linkBase} /></Glass>
    </Page>
  );
}
