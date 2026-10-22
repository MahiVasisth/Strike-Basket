import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch now, then every `intervalMs` (0 = once). `deps` restarts it. */
export function usePoll<T>(fn: (() => Promise<T>) | null, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    const f = fnRef.current;
    if (!f) return;
    try {
      const d = await f();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fnRef.current) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refresh();
    if (!intervalMs) return;
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refresh, ...deps]);

  return { data, error, loading, refresh, setData };
}

export interface StreamEvent<P = Record<string, unknown>> {
  id: number;
  ts: number;
  type: string;
  payload: P;
}

const STREAM_EVENTS = ["snapshot", "run.planned", "run.gated", "run.executing", "leg.updated", "run.finished", "paused", "resumed", "error"];

/** Subscribe to the backend's SSE stream. Returns whether it's connected. */
export function useStream(url: string | null, onEvent: (e: StreamEvent) => void) {
  const [connected, setConnected] = useState(false);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const handler = (ev: MessageEvent) => {
      try {
        cb.current(JSON.parse(ev.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    for (const name of STREAM_EVENTS) es.addEventListener(name, handler);
    return () => es.close();
  }, [url]);

  return connected;
}

/** Re-render every `ms` so relative times ("42s ago") stay fresh. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 1400);
  }, []);
  return { copied, copy };
}

export function safeStorage(kind: "local" | "session") {
  const get = (k: string) => {
    try {
      return (kind === "local" ? localStorage : sessionStorage).getItem(k);
    } catch {
      return null;
    }
  };
  const set = (k: string, v: string | null) => {
    try {
      const s = kind === "local" ? localStorage : sessionStorage;
      if (v === null) s.removeItem(k);
      else s.setItem(k, v);
    } catch {
      /* storage blocked */
    }
  };
  return { get, set };
}
