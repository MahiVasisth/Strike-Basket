import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectFlow } from "./ConnectFlow";

/** The /connect flow in a dialog, opened from the header's "Connect wallet" so users don't lose their page. */
export function ConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="connect-title" className="w-full min-w-0 max-w-lg rounded-3xl border border-edge bg-[#0b0b0f] p-5 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="connect-title" className="font-display text-[22px] font-medium leading-tight">Connect your Strike account</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-dim">Your money stays in your Strike account. We can trade, never withdraw.</p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full p-1.5 text-dim hover:bg-white/[0.08] hover:text-text" aria-label="Close">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>
        <ConnectFlow
          layout="modal"
          onConnected={() => {
            onClose();
            nav("/me");
          }}
        />
      </div>
    </div>
  );
}
