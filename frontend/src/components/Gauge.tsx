import { bpsAsPct } from "../lib/format";

/** Semicircle gauge: worst drift vs the rebalance threshold. The scale runs to 1.5× the threshold. */
export function DriftGauge({ driftBps, thresholdBps }: { driftBps: number | null; thresholdBps: number }) {
  const W = 240, H = 132, cx = 120, cy = 120, r = 100, sw = 14;
  const max = thresholdBps * 1.5;
  const v = driftBps === null ? 0 : Math.min(1, Math.abs(driftBps) / max);
  const pt = (f: number, rr = r) => [cx - rr * Math.cos(f * Math.PI), cy - rr * Math.sin(f * Math.PI)] as const;
  const [sx, sy] = pt(0), [ex, ey] = pt(1);
  const track = `M${sx} ${sy} A${r} ${r} 0 0 1 ${ex} ${ey}`;
  const len = Math.PI * r;
  const thr = thresholdBps / max;
  const [t1x, t1y] = pt(thr, r - sw / 2 - 6), [t2x, t2y] = pt(thr, r + sw / 2 + 6);
  const over = driftBps !== null && Math.abs(driftBps) >= thresholdBps;
  const near = !over && driftBps !== null && Math.abs(driftBps) >= thresholdBps * 0.6;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[260px]" role="img" aria-label={`Max drift ${driftBps === null ? "unknown" : bpsAsPct(Math.abs(driftBps))}; rebalances at ${bpsAsPct(thresholdBps)}`}>
        <defs>
          <linearGradient id="gauge-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#18E2A0" />
            <stop offset="55%" stopColor="#FFB020" />
            <stop offset="100%" stopColor="#FF4D5E" />
          </linearGradient>
          <filter id="gauge-glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d={track} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={sw} strokeLinecap="round" />
        <path
          d={track}
          fill="none"
          stroke="url(#gauge-grad)"
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${len * v} ${len}`}
          filter="url(#gauge-glow)"
          style={{ transition: "stroke-dasharray 600ms ease-out" }}
        />
        <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke="#fff" strokeWidth={2} strokeDasharray="3 2" />
      </svg>
      <div className={`num -mt-9 text-[28px] ${over ? "text-bad" : near ? "text-warn" : "text-text"}`}>
        {driftBps === null ? "—" : bpsAsPct(Math.abs(driftBps), 2)}
      </div>
      <div className="mt-1 text-[13px] text-dim">rebalances at {bpsAsPct(thresholdBps)}</div>
      <p className="mt-3 text-center text-[12.5px] leading-relaxed text-dim">
        {over
          ? "Over the line: the bot rebalances on its next check, unless it's cooling down."
          : "How far the furthest market is from its target. Under the line, the bot doesn't trade."}
      </p>
    </div>
  );
}
