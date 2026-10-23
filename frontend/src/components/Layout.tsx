import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { heroApi, testnetApi } from "../lib/api";
import { shortAddr } from "../lib/format";
import { useInstances } from "../lib/instances";
import { useLive } from "../lib/live";
import { disconnect, useSession } from "../lib/session";
import { ConnectModal } from "./ConnectModal";
import { EnvPill, LinkButton, Page } from "./ui";

export function Logo() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Strike Baskets home">
      <span
        className="relative h-7 w-7 rounded-full"
        style={{ background: "conic-gradient(#4D7CFF 0 25%, #FFB020 0 50%, #18E2A0 0 75%, #FF3D8B 0)", boxShadow: "0 0 18px rgba(77,124,255,.45)" }}
      >
        <span className="absolute inset-[6px] rounded-full bg-black" />
      </span>
      <span className="font-display text-[15px] font-medium">Strike Baskets</span>
    </Link>
  );
}

export function Layout() {
  const { testnetUp, personal } = useInstances();
  const { executing, toasts } = useLive();
  const loc = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  // The pill and deposit button follow the instance the current page shows.
  const onTestnet = testnetUp && /^\/(testnet|connect|me)/.test(loc.pathname);
  const api = onTestnet ? testnetApi! : heroApi;
  const basket = useQuery({ queryKey: [api.base, "basket"], queryFn: api.basket, refetchInterval: 60_000 });
  const b = basket.data;
  const { token, address } = useSession();
  const [connecting, setConnecting] = useState(false);
  const nav = useNavigate();
  const signOut = async () => {
    if (!window.confirm("Disconnect your wallet? The bot stops trading your account and we delete our key. Your positions stay in your Strike account.")) return;
    try {
      const note = await disconnect();
      nav("/connect", { state: { notice: note } });
    } catch (e) {
      window.alert(`Disconnect didn't work: ${(e as Error).message}. Try again.`);
    }
  };

  const links: [string, string][] = [
    ["/", "Pre-IPO"],
    ...(testnetUp ? ([["/testnet", "Testnet vault"]] as [string, string][]) : []),
    ["/how", "How it works"],
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <ConnectModal open={connecting} onClose={() => setConnecting(false)} />
      <header className="sticky top-0 z-40 border-b border-edge bg-black/70 backdrop-blur-xl">
        <Page className="flex h-[68px] items-center justify-between gap-4">
          <Logo />
          <nav className="glass hidden items-center gap-1 !rounded-full p-1 md:flex" aria-label="Main">
            {links.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) => `rounded-full px-4 py-1.5 text-[13.5px] transition ${isActive ? "bg-white/[0.12] text-text" : "text-dim hover:text-text"}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {b && <span className="hidden md:inline-flex"><EnvPill basket={b} /></span>}
            {personal && (
              <span className="hidden sm:inline-flex">
                {token ? (
                  <WalletMenu address={address} onDisconnect={signOut} />
                ) : (
                  <button onClick={() => setConnecting(true)} className="glass inline-flex items-center !rounded-full px-4 py-2 text-[13.5px] font-medium text-text transition hover:bg-white/[0.08]">
                    Connect wallet
                  </button>
                )}
              </span>
            )}
            {b?.vault.url && <LinkButton href={b.vault.url} variant="white" className="!py-2 !text-[13.5px]">Deposit on Strike ↗</LinkButton>}
            <button className="rounded-full p-2 text-dim hover:text-text md:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor"><path d="M3 5h14v1.5H3zM3 9.25h14v1.5H3zM3 13.5h14V15H3z" /></svg>
            </button>
          </div>
        </Page>
        {menu && (
          <nav className="border-t border-edge md:hidden" aria-label="Mobile">
            <Page className="flex flex-col py-2">
              {links.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `rounded-xl px-3 py-2.5 text-[15px] ${isActive ? "text-text" : "text-dim"}`}>
                  {label}
                </NavLink>
              ))}
              {personal && token && (
                <Link to="/me" className="rounded-xl px-3 py-2.5 text-[15px] text-violet">
                  <WalletLabel token={token} address={address} />
                </Link>
              )}
              {personal && !token && (
                <button onClick={() => { setMenu(false); setConnecting(true); }} className="rounded-xl px-3 py-2.5 text-left text-[15px] text-violet">
                  Connect wallet
                </button>
              )}
              {personal && token && (
                <button onClick={signOut} className="rounded-xl px-3 py-2.5 text-left text-[15px] text-dim hover:text-bad">
                  Disconnect wallet
                </button>
              )}
            </Page>
          </nav>
        )}
        {/* Below md the header has no room: the environment badge gets its own line so it's always visible. */}
        {b && (
          <div className="border-t border-edge md:hidden">
            <Page className="flex justify-center py-2"><EnvPill basket={b} full /></Page>
          </div>
        )}
        {executing && (
          <div className="relative h-[3px] overflow-hidden bg-white/[0.04]" role="status">
            <div className="progress-line absolute inset-y-0 w-2/5 bg-gradient-to-r from-transparent via-[#9D7BFF] to-transparent" />
            <span className="sr-only">Rebalancing…</span>
          </div>
        )}
      </header>
      {executing && (
        <div className="pointer-events-none fixed left-1/2 top-[80px] z-40 -translate-x-1/2 rounded-full border border-violet/40 bg-black/80 px-3.5 py-1 text-[12.5px] text-violet backdrop-blur">
          Rebalancing…
        </div>
      )}

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mt-24 border-t border-edge">
        <Page className="flex flex-col gap-6 py-10 text-[13px] text-dim md:flex-row md:items-start md:justify-between">
          <div className="max-w-md space-y-3">
            <Logo />
            <p>The first themed, rules-based basket vault on Strike. Positions ≤ 0.9× equity. No leverage. Deposits and withdrawals happen on Strike.</p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <Link to="/how" className="hover:text-text">How it works</Link>
            <a href="https://github.com/MahiVasisth/Strike-Basket" target="_blank" rel="noreferrer" className="hover:text-text">Source on GitHub ↗</a>
            <span>Built for the Strike Hackathon, October 2026</span>
          </div>
        </Page>
      </footer>

      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass rise pointer-events-auto flex max-w-sm items-start gap-2.5 !rounded-2xl px-4 py-3 text-[13.5px]">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: t.tone === "ok" ? "#18E2A0" : t.tone === "warn" ? "#FFB020" : "#FF4D5E" }} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Connected wallet in the header: opens a small menu with "My basket" and "Disconnect". */
function WalletMenu({ address, onDisconnect }: { address: string | null; onDisconnect: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="glass inline-flex items-center gap-2 !rounded-full px-4 py-2 text-[13.5px] text-text transition hover:bg-white/[0.08]"
      >
        <WalletLabel token="x" address={address} />
        <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 text-dim transition ${open ? "rotate-180" : ""}`} fill="currentColor" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-[calc(100%+8px)] z-50 w-56 !rounded-2xl p-1.5 shadow-2xl">
          {address && <p className="num truncate px-3 pb-1.5 pt-1 text-[12px] text-dim" title={address}>{address}</p>}
          <Link role="menuitem" to="/me" className="block rounded-xl px-3 py-2 text-[13.5px] text-text hover:bg-white/[0.08]">
            My basket
          </Link>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDisconnect();
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-[13.5px] text-bad hover:bg-bad/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function WalletLabel({ token, address }: { token: string | null; address: string | null }) {
  if (!token) return <>Connect wallet</>;
  return (
    <span className="inline-flex items-center gap-2" title="My basket">
      <span className="h-2 w-2 rounded-full bg-ok shadow-[0_0_8px_#18E2A0]" />
      <span className={address ? "num" : ""}>{address ? shortAddr(address) : "My basket"}</span>
    </span>
  );
}
