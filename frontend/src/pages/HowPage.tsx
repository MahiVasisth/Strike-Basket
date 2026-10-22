import { useQuery } from "@tanstack/react-query";
import { heroApi } from "../lib/api";
import { useInstances } from "../lib/instances";
import { RulesCard } from "../components/sections";
import { CardTitle, Glass, LinkButton, Page } from "../components/ui";

const steps = [
  ["Deposit on Strike", "Deposit into the basket's Strike user vault, on Strike itself. Or connect your own Strike account and keep the money there."],
  ["The bot keeps weights on target", "Each check it reads positions from Strike, tests every market's book, and when a weight drifts 5 points it sends one batch of orders tagged with the vault_id."],
  ["Withdraw on Strike", "Withdraw on Strike whenever you like after the vault's 1-day lockup. The bot's key can trade but can never withdraw."],
];

const integration: [string, string][] = [
  ["API wallet auth", "Ed25519-signed requests from a trade-only key"],
  ["Vault leader orders", "Batch orders with vault_id; TWAP for large legs"],
  ["Per-symbol settings", "Cross margin at a 2x setting on every market"],
  ["Market data", "exchangeInfo filters, mark prices, book tickers"],
  ["Public vault data", "Share price, equity, depositors, positions"],
  ["Builder Codes", "Builder Connect wallet-signature onboarding and a builder fee on personal-mode fills"],
  ["Strike-only markets", "Pre-IPO perps: SpaceX, Zhipu, Unitree, MiniMax"],
];

export function HowPage() {
  const { personal } = useInstances();
  const basket = useQuery({ queryKey: [heroApi.base, "basket"], queryFn: heroApi.basket });
  return (
    <Page className="pt-12">
      <h1 className="gradient-text max-w-4xl font-display text-[38px] font-bold leading-[1.02] sm:text-[54px]" style={{ letterSpacing: "-0.05em" }}>
        A basket vault that rebalances itself, by published rules
      </h1>
      <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-dim">
        The first themed, rules-based basket vault on Strike. Fixed weights, no discretion. Positions ≤ 0.9× equity. No leverage.
      </p>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map(([t, d], i) => (
          <Glass key={t} className="p-6">
            <span className="num btn-plasma flex h-9 w-9 items-center justify-center rounded-full text-[14px]">{i + 1}</span>
            <h2 className="mt-5 font-display text-[19px] font-medium">{t}</h2>
            <p className="mt-2.5 text-[14px] leading-relaxed text-dim">{d}</p>
          </Glass>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Glass className="p-6 lg:col-span-7">
          <CardTitle>How it uses Strike</CardTitle>
          <dl className="divide-y divide-edge">
            {integration.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 py-3 text-[14px] sm:flex-row sm:gap-6">
                <dt className="w-44 shrink-0 text-text">{k}</dt>
                <dd className="text-dim">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13.5px] leading-relaxed text-dim">
            The bot never re-sends an order. It replans from Strike's real positions on the next check, so a crash or timeout can't double-trade.
          </p>
        </Glass>
        {basket.data && <RulesCard basket={basket.data} className="lg:col-span-5" />}
      </div>

      <Glass className="mt-4 p-6">
        <CardTitle>What we don't claim</CardTitle>
        <p className="max-w-3xl text-[14px] leading-relaxed text-text/90">
          No performance claims. It's a basket vault of perpetual futures, not an index fund. The Pre-IPO basket runs on live mainnet prices with simulated fills,
          because we didn't put real money in for the hackathon; its orders go through the same executor that trades our testnet vault. Vault orders on the pre-IPO
          markets are untested until a mainnet vault is funded.
        </p>
      </Glass>

      <div className="mt-10 flex flex-wrap gap-3">
        <LinkButton to="/" variant="plasma">See the live basket</LinkButton>
        {personal && <LinkButton to="/connect">Connect wallet</LinkButton>}
      </div>
    </Page>
  );
}
