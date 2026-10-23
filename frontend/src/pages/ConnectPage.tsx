import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ConnectFlow } from "../components/ConnectFlow";
import { Page } from "../components/ui";
import { takeNotice } from "../lib/session";

/** /connect: personal-mode onboarding as a full page. The header opens the same flow in a modal (ConnectModal). */
export function ConnectPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [notice, setNotice] = useState<string | null>(() => takeNotice() ?? (loc.state as { notice?: string } | null)?.notice ?? null);

  return (
    <Page className="pt-12">
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="gradient-text font-display text-[36px] font-bold leading-[1.02] sm:text-[54px]" style={{ letterSpacing: "-0.05em" }}>
          Run a basket in your own Strike account
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-[16px] leading-relaxed text-dim">
          Your money stays in your Strike account. One signature lets the engine keep the basket on target there. Pause or disconnect any time; we can trade, never withdraw.
        </p>
      </div>

      {notice && (
        <div role="status" className="mx-auto mt-6 flex max-w-2xl items-start justify-between gap-4 rounded-2xl border border-ok/40 bg-ok/10 px-4 py-3 text-[13.5px] text-text">
          <span><span className="font-medium text-ok">Disconnected.</span> {notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-dim hover:text-text" aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="mt-12">
        <ConnectFlow layout="page" onConnected={() => nav("/me")} />
      </div>
    </Page>
  );
}
