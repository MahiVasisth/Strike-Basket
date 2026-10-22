import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Basket } from "../lib/api";
import { envBadge } from "../lib/format";
import { useCopy } from "../lib/hooks";

export type ChipTone = "ok" | "warn" | "bad" | "blue" | "grey" | "sim";

/** Run/leg status → chip tone. Colour is always repeated in the text. */
export function statusChipTone(s: string): ChipTone {
  switch (s) {
    case "done": case "filled": case "passed": return "ok";
    case "partial": case "executing": case "sent": case "pending": return "warn";
    case "failed": case "gated": case "rejected": return "bad";
    case "shadow": return "blue";
    default: return "grey";
  }
}

const chipCls: Record<ChipTone, string> = {
  ok: "text-ok border-ok/30 bg-ok/10",
  warn: "text-warn border-warn/30 bg-warn/10",
  bad: "text-bad border-bad/30 bg-bad/10",
  blue: "text-blue border-blue/35 bg-blue/10",
  grey: "text-dim border-edge bg-white/[0.04]",
  sim: "text-dim border-dashed border-white/25 bg-transparent",
};
const dotColor: Record<ChipTone, string> = { ok: "#18E2A0", warn: "#FFB020", bad: "#FF4D5E", blue: "#4D7CFF", grey: "#8A90A2", sim: "#8A90A2" };

export function Chip({ tone = "grey", children }: { tone?: ChipTone; children: ReactNode }) {
  return (
    <span className={`num inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] ${chipCls[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor[tone], boxShadow: `0 0 8px ${dotColor[tone]}` }} />
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <Chip tone={statusChipTone(status)}>{status.replace(/_/g, " ")}</Chip>;
}

export function GlowDot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color, boxShadow: `0 0 10px ${color}` }} />;
}

export function Glass({ children, className = "", proof = false, as: Tag = "section" }: { children: ReactNode; className?: string; proof?: boolean; as?: "section" | "div" | "article" }) {
  return <Tag className={`${proof ? "proof-glow" : "glass"} ${className}`}>{children}</Tag>;
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[13.5px] font-medium text-dim">{children}</h2>
      {right}
    </div>
  );
}

/** Environment pill. The environment word is the only uppercase text on the site. */
export function EnvPill({ basket }: { basket: Pick<Basket, "env" | "mode" | "source"> }) {
  const b = envBadge(basket);
  const amber = b.tone === "paper";
  const color = amber ? "#FFB020" : b.tone === "live" ? "#18E2A0" : "#4D7CFF";
  return (
    <span
      className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[12px]"
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
    >
      <GlowDot color={color} size={6} />
      <span className="font-semibold tracking-wider">{b.label.split(" ")[0]}</span>
      <span className="hidden text-[11.5px] opacity-85 xl:inline">{b.detail}</span>
    </span>
  );
}

type Variant = "plasma" | "secondary" | "white" | "danger" | "ghost";
const variantCls: Record<Variant, string> = {
  plasma: "btn-plasma",
  secondary: "glass !rounded-full text-text hover:bg-white/[0.08]",
  white: "bg-white text-black hover:bg-white/90",
  danger: "border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20",
  ghost: "text-dim hover:text-text",
};
const base = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-[14px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

export function Button({ variant = "secondary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={`${base} ${variantCls[variant]} ${className}`} />;
}

export function LinkButton({ to, href, variant = "secondary", className = "", children }: { to?: string; href?: string; variant?: Variant; className?: string; children: ReactNode }) {
  const cls = `${base} ${variantCls[variant]} ${className}`;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>{children}</a>
  ) : (
    <Link to={to!} className={cls}>{children}</Link>
  );
}

/** Strike order ID in a blue glass chip with a copy action. */
export function OrderIdChip({ id, simulated = false }: { id: string; simulated?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <span
      className={`num inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${
        simulated ? "border-dashed border-white/25 text-dim" : "border-blue/45 bg-blue/10 text-text"
      }`}
    >
      <span className="truncate" title={id}>{id}</span>
      <button type="button" onClick={() => copy(id)} className="shrink-0 text-[11px] text-dim transition hover:text-text" aria-label={`Copy ${id}`}>
        {copied === id ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`shimmer ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9" />)}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-white/15 px-4 py-8 text-center text-[13.5px] text-dim">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-bad/35 bg-bad/10 px-4 py-3 text-[13.5px] text-bad">{children}</div>;
}

export function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-edge bg-white/[0.03] px-3.5 py-3">
      <div className="text-[12px] text-dim">{label}</div>
      <div className="num mt-1 truncate text-[17px] text-text">{value}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-dim">{sub}</div>}
    </div>
  );
}

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}
