import { useEffect, useRef, useState } from "react";
import { bpsAsPct, usd } from "../lib/format";

export interface RingSegment { symbol: string; name: string; color: string; current: number; target: number; driftBps: number }

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function useMedia(q: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}

/**
 * Tween `values` toward `target`. The first run draws in from zero (900ms, 120ms stagger);
 * later updates tween over 600ms. Reduced motion jumps straight to the target.
 */
function useTween(target: number[], firstStagger = 120) {
  const [vals, setVals] = useState<number[]>(() => target.map(() => 0));
  const from = useRef<number[]>(target.map(() => 0));
  const first = useRef(true);
  const key = target.map((v) => v.toFixed(5)).join(",");

  useEffect(() => {
    if (reduced()) {
      setVals(target);
      from.current = target;
      first.current = false;
      return;
    }
    const start = performance.now();
    const isFirst = first.current;
    const dur = isFirst ? 900 : 600;
    const src = target.map((_, i) => from.current[i] ?? 0);
    let raf = 0;
    const tick = (now: number) => {
      let done = true;
      const next = target.map((t, i) => {
        const delay = isFirst ? i * firstStagger : 0;
        const p = Math.min(1, Math.max(0, (now - start - delay) / dur));
        if (p < 1) done = false;
        const e = 1 - Math.pow(1 - p, 3);
        return src[i] + (t - src[i]) * e;
      });
      setVals(next);
      if (!done) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    first.current = false;
    return () => {
      cancelAnimationFrame(raf);
      from.current = target;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // The target list can grow before the effect runs (e.g. the basket just loaded).
  return target.map((_, i) => (Number.isFinite(vals[i]) ? vals[i] : 0));
}

const polar = (cx: number, cy: number, r: number, frac: number) => {
  const a = frac * Math.PI * 2 - Math.PI / 2; // clockwise from 12 o'clock
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};

function arc(cx: number, cy: number, r: number, f0: number, f1: number) {
  const [x0, y0] = polar(cx, cy, r, f0);
  const [x1, y1] = polar(cx, cy, r, f1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${f1 - f0 > 0.5 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function OrbitRing({
  segments, equity, maxDriftBps, thresholdBps, centerLabel = "Basket equity", loading = false,
}: {
  segments: RingSegment[]; equity: string | null; maxDriftBps: number | null; thresholdBps: number; centerLabel?: string; loading?: boolean;
}) {
  const wide = useMedia("(min-width: 640px)");
  const R = 200, SW = 30;
  const W = wide ? 760 : 480, H = wide ? 600 : 480;
  const cx = W / 2, cy = H / 2;

  const weights = useTween(segments.map((s) => Math.max(0, s.current)));
  const total = weights.reduce((a, b) => a + b, 0);
  const scale = total > 1 ? 1 / total : 1;

  // Count-up for the centre number on first load.
  const eq = Number(equity ?? NaN);
  const [shown] = useTween([Number.isFinite(eq) ? eq : 0], 0);

  const capFrac = SW / 2 / (2 * Math.PI * R); // round caps poke out by half the stroke
  const gapFrac = 0.006;

  let acc = 0;
  const arcs = segments.map((s, i) => {
    const w = weights[i] * scale;
    const f0 = acc, f1 = acc + w;
    acc = f1;
    return { s, f0, f1, w };
  });

  let tacc = 0;
  const ticks = segments.map((s) => {
    const f = tacc;
    tacc += s.target;
    return f;
  });

  const over = maxDriftBps !== null && Math.abs(maxDriftBps) >= thresholdBps;

  return (
    <div className="relative mx-auto w-full" style={{ maxWidth: W }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Basket ring: each arc is a market's current weight; dashed ticks mark the targets">
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="9" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* faint orbits */}
        <circle cx={cx} cy={cy} r={R + 52} fill="none" stroke="rgba(255,255,255,.14)" strokeDasharray="1 7" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={R - 52} fill="none" stroke="rgba(255,255,255,.07)" />
        {/* track */}
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="rgba(255,255,255,.05)" strokeWidth={SW} />

        {/* arcs = current weights */}
        <g filter="url(#ring-glow)">
          {arcs.map(({ s, f0, f1, w }) => {
            const a0 = f0 + capFrac + gapFrac / 2, a1 = f1 - capFrac - gapFrac / 2;
            if (w <= 0.0005) return null;
            if (a1 <= a0) {
              const [x, y] = polar(cx, cy, R, (f0 + f1) / 2);
              return <circle key={s.symbol} cx={x} cy={y} r={SW / 2} fill={s.color} />;
            }
            return <path key={s.symbol} d={arc(cx, cy, R, a0, a1)} fill="none" stroke={s.color} strokeWidth={SW} strokeLinecap="round" />;
          })}
        </g>
        {arcs.map(({ s, f1, w }) => {
          if (w <= 0.0005) return null;
          const [x, y] = polar(cx, cy, R, f1 - capFrac - gapFrac / 2);
          return <circle key={`dot-${s.symbol}`} cx={x} cy={y} r={3.5} fill="#fff" />;
        })}

        {/* target ticks */}
        {ticks.map((f, i) => {
          const [xi, yi] = polar(cx, cy, R - SW / 2 - 9, f);
          const [xo, yo] = polar(cx, cy, R + SW / 2 + 9, f);
          const [lx, ly] = polar(cx, cy, R + SW / 2 + 26, f);
          return (
            <g key={`tick-${i}`}>
              <line x1={xi} y1={yi} x2={xo} y2={yo} stroke="#fff" strokeOpacity={0.85} strokeWidth={1.5} strokeDasharray="3 3" />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={wide ? 11 : 12} fill="#8A90A2" fontFamily="JetBrains Mono, monospace">
                {Math.round(f * 100)}%
              </text>
            </g>
          );
        })}

        {/* market labels (desktop only; the holdings table carries them on mobile) */}
        {wide &&
          arcs.map(({ s }, i) => {
            const mid = ticks[i] + s.target / 2;
            const [x, y] = polar(cx, cy, R + 78, mid);
            const anchor = Math.abs(x - cx) < 30 ? "middle" : x > cx ? "start" : "end";
            const sign = s.driftBps > 0 ? "+" : s.driftBps < 0 ? "−" : "";
            return (
              <g key={`lbl-${s.symbol}`}>
                <text x={x} y={y - 9} textAnchor={anchor} fontSize={15} fontWeight={500} fill={s.color} fontFamily="Unbounded, sans-serif">
                  {s.name}
                </text>
                <text x={x} y={y + 12} textAnchor={anchor} fontSize={12} fill="#C9CEDA" fontFamily="JetBrains Mono, monospace">
                  {(s.current * 100).toFixed(1)}% · {sign}{Math.abs(Math.round(s.driftBps))} bps
                </text>
              </g>
            );
          })}
      </svg>

      {/* centre readout */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-[12.5px] text-dim">{centerLabel}</div>
        <div className="num mt-1 text-[28px] text-text sm:text-[38px]">
          {loading || !Number.isFinite(eq) ? <span className="text-dim">—</span> : usd(shown)}
        </div>
        {maxDriftBps !== null && (
          <span
            className={`num mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${
              over ? "border-bad/40 bg-bad/10 text-bad" : "border-warn/40 bg-warn/10 text-warn"
            }`}
          >
            Max drift {bpsAsPct(Math.abs(maxDriftBps))} of {bpsAsPct(thresholdBps)}
          </span>
        )}
      </div>
    </div>
  );
}

/** Small static ring of target weights, for "coming soon" cards. */
export function MiniRing({ parts, size = 64 }: { parts: { color: string; weight: number }[]; size?: number }) {
  const r = 24, sw = 7, c = 32;
  let acc = 0;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={sw} />
      {parts.map((p, i) => {
        const f0 = acc + 0.012, f1 = acc + p.weight - 0.012;
        acc += p.weight;
        return <path key={i} d={arc(c, c, r, f0, f1)} fill="none" stroke={p.color} strokeWidth={sw} strokeLinecap="butt" opacity={0.75} />;
      })}
    </svg>
  );
}
