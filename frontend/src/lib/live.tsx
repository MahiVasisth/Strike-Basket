import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { ApiError, type Api } from "./api";
import { useStream, type StreamEvent } from "./hooks";

// ---------- app-wide live state: the "Rebalancing…" line and toasts ----------

interface Toast { id: number; tone: "ok" | "warn" | "bad"; text: string }
interface Live {
  executing: boolean;
  setExecuting: (v: boolean) => void;
  toasts: Toast[];
  toast: (tone: Toast["tone"], text: string) => void;
}
const LiveCtx = createContext<Live>({ executing: false, setExecuting: () => {}, toasts: [], toast: () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [executing, setExecuting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return <LiveCtx.Provider value={{ executing, setExecuting, toasts, toast }}>{children}</LiveCtx.Provider>;
}
export const useLive = () => useContext(LiveCtx);

// ---------- per-instance queries ----------

const is503 = (e: unknown) => e instanceof ApiError && e.status === 503;

export function useInstanceData(api: Api, { streaming = false }: { streaming?: boolean } = {}) {
  const k = api.base;
  const basket = useQuery({ queryKey: [k, "basket"], queryFn: api.basket, refetchInterval: 60_000 });
  const health = useQuery({ queryKey: [k, "health"], queryFn: api.health, refetchInterval: 10_000 });
  // /api/state is 503 until the first cycle completes: keep retrying quietly.
  const state = useQuery({
    queryKey: [k, "state"],
    queryFn: api.state,
    refetchInterval: streaming ? 60_000 : 15_000,
    retry: (n, e) => is503(e) || n < 2,
    retryDelay: 3000,
  });
  const snapshots = useQuery({ queryKey: [k, "snapshots"], queryFn: () => api.snapshots(Date.now() - 7 * 86_400_000), refetchInterval: 60_000 });
  const runs = useQuery({ queryKey: [k, "runs"], queryFn: () => api.rebalances(25), refetchInterval: 30_000 });
  return { basket, health, state, snapshots, runs, warming: is503(state.error) };
}

/** Subscribe to /api/stream and turn events into cache invalidations, the progress line and toasts. */
export function useLiveStream(api: Api | null) {
  const qc = useQueryClient();
  const { setExecuting, toast } = useLive();
  const onEvent = useCallback(
    (e: StreamEvent) => {
      if (!api) return;
      const k = api.base;
      const inv = (...keys: string[]) => keys.forEach((key) => qc.invalidateQueries({ queryKey: [k, key] }));
      const p = e.payload as { status?: string; error?: string; runId?: string };
      switch (e.type) {
        case "snapshot":
          inv("state", "snapshots", "health");
          break;
        case "run.executing":
          setExecuting(true);
          break;
        case "run.finished":
          setExecuting(false);
          inv("runs", "run", "state");
          if (p.status === "done") toast("ok", "Rebalance finished. All orders filled.");
          else if (p.status) toast(p.status === "failed" ? "bad" : "warn", `Rebalance ${p.status}. Open the log for details.`);
          break;
        case "run.planned":
        case "run.gated":
          inv("runs");
          break;
        case "leg.updated":
          inv("run");
          break;
        case "paused":
        case "resumed":
          inv("health", "state");
          toast(e.type === "paused" ? "warn" : "ok", e.type === "paused" ? "Engine paused. No orders until it resumes." : "Engine resumed.");
          break;
        case "error":
          inv("health");
          toast("bad", `Engine error: ${p.error ?? "unknown"}. It retries next cycle.`);
          break;
      }
    },
    [api, qc, setExecuting, toast],
  );
  return useStream(api ? api.streamUrl() : null, onEvent);
}
