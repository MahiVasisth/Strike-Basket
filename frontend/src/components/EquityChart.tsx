import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

/** Equity (or share price) line. No returns, APR or performance figures anywhere. */
export function EquityChart({ points, decimals = 2 }: { points: { ts: number; v: number }[]; decimals?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8A90A2", fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,.05)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,.25)", labelBackgroundColor: "#1a1d2b" },
        horzLine: { color: "rgba(255,255,255,.25)", labelBackgroundColor: "#1a1d2b" },
      },
      handleScroll: false,
      handleScale: false,
      localization: { priceFormatter: (p: number) => `$${p.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` },
    });
    series.current = c.addSeries(AreaSeries, {
      lineColor: "#4D7CFF",
      lineWidth: 2,
      topColor: "rgba(77,124,255,.28)",
      bottomColor: "rgba(77,124,255,0)",
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [decimals]);

  useEffect(() => {
    if (!series.current) return;
    // lightweight-charts needs strictly increasing seconds.
    const seen = new Set<number>();
    const data = points
      .map((p) => ({ time: Math.floor(p.ts / 1000) as UTCTimestamp, value: p.v }))
      .filter((d) => (seen.has(d.time) ? false : (seen.add(d.time), true)))
      .sort((a, b) => a.time - b.time);
    series.current.setData(data);
    chart.current?.timeScale().fitContent();
  }, [points]);

  return (
    <div className="relative h-[260px] w-full">
      <div ref={el} className="absolute inset-0" />
      {points.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border border-dashed border-white/15 text-[13.5px] text-dim">
          History builds up as the engine runs. Check back after a few cycles.
        </div>
      )}
    </div>
  );
}
