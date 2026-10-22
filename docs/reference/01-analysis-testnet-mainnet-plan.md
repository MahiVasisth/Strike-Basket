# Analysis and testnet/mainnet plan for Strike Baskets

> Shared by the team on 22 Oct 2026 as the starting brief, kept verbatim. **Later decisions supersede parts of it**: there are no mainnet funds (so no mainnet vault), the testnet basket is BTC/ETH only, and Personal mode was added. See `../HANDOFF.md`.

Baskets is a strong idea for this hackathon, and the testnet/mainnet problem is solvable if you split the work into two tracks. I couldn't re-check the live Strike API from here, so the market facts below come from your fit report's 22 Oct checks.

## Where the idea stands

**Strengths**

- It brings deposits, not just trades, which is what Strike says it wants.
- The pre-IPO perps (SPCX, ZHIPU, UNITREE, MINIMAX) exist only on Strike, so the removal test passes.
- The business model is real: a leader commission of 0–50%, charged only on profitable withdrawals.
- The pitch is one line: "one deposit, a whole theme."

**Two corrections to the team doc**

- "Nobody on Strike uses vaults" is false. Mainnet has 3 user vaults, and MARKET WIZARDS already advertises systematic stock trading. Say "the first themed, rules-based basket vault" instead.
- "Index fund" overpromises, since these are leveraged perps in a pooled vault. Use "basket vault."

Liquidity is less of a worry than the doc says. Spreads are about 6 bps, and depth within ±1% is $55k–140k per side. A $100–1,000 rebalance won't move these books.

## The testnet/mainnet problem

Testnet lists only BTC, ETH, SOL and ADA, so you can't test any stock or pre-IPO basket there. "Run on testnet first" only works for a crypto basket.

The way through is to build one codebase and run it in two environments. Put the base URL, API keys, symbol map and basket definition in config, so the rebalancer and executor don't change between environments.

| | Testnet | Mainnet |
|---|---|---|
| Purpose | Prove the machinery is correct | Prove the real product exists |
| Basket | Crypto (BTC/ETH/SOL/ADA, 25% each) | Pre-IPO (SPCX, ZHIPU, UNITREE, MINIMAX) |
| Money | Free | About 100 USDC vault fee plus a $100–200 seed, 1x leverage |
| What you validate | Vault creation, vault_id orders, batch orders, TWAP, drift logic, pause switch, idempotency | One real allocation and one real rebalance, with order IDs |

You also need a shadow mode, which needs no money and no testnet. The rebalancer is a pure function, so you can feed it live mainnet marks and positions for the stock and pre-IPO baskets and have it print the rebalance plan without sending orders. Even if the mainnet vault slips, the demo still shows the real baskets being computed from real market data. Label it honestly as "plan only."

## Do this tonight: the go/no-go check

The biggest unknown isn't liquidity. It's whether a vault-led order actually works on a pre-IPO market. Test it early, in this order:

1. Create the testnet vault and place one tiny order with vault_id on BTC. If this fails, switch to the paper-trading fallback from your doc.
2. Fund mainnet, create the vault, and place one minimal vault_id order on a pre-IPO market. Record the minimum order size for each of the four markets.
3. Check each market's MIN_NOTIONAL and filters in exchangeInfo. Set the drift threshold so no rebalance leg falls below the minimum.
4. Confirm /v2/algo/twap accepts vault_id. If it doesn't, use batch orders.

If step 2 fails on the pre-IPO markets, make the mainnet basket a mix of whichever markets pass. Prefer ZHIPU, MINIMAX, UNITREE and CXMT, which have the best volume. Avoid DRAM, XAG and NVDA, whose 24h volume is under about $7k.

## Time budget

About 26 hours remain. The deadline is 23 Oct 10:00 EST, which is about 20:30 IST, or 19:30 if it's actually EDT. Confirm the timezone on the submission page.

| Block | Work |
|---|---|
| Next 2h | Go/no-go checks above, and fund mainnet |
| 3–4h | Pure rebalancer (weights → positions → order list) with unit tests |
| 4h | Executor with idempotent client IDs, then a full testnet crypto run |
| 3h | Mainnet allocation, then force one real rebalance by nudging a weight |
| 4h | Web page, README with vault ID and order IDs, mark-freshness and spread gate |
| 4h+ | Demo recording and submission buffer, with sleep before it |

## What the web page needs

- **Weights.** Basket composition, with live weights next to targets.
- **Share price.** The vault's current share price.
- **Rebalance log.** Rebalance history with order IDs that match Strike.
- **Environment badge.** A clear "TESTNET: crypto basket" or "MAINNET: Pre-IPO basket" label.
- **Deposit link.** A "Deposit on Strike" link out to the vault page. No vault-deposit endpoint is documented, so an in-app deposit button would be fake.
- **Pause switch.** Visible on the page.

## Risks to handle

- **Off-hours marks.** Stale or thin marks on stock and pre-IPO perps are the likeliest live bug. Gate every rebalance on mark freshness and spread.
- **Account limits.** One vault per account, and the leader must keep at least 5% of shares. Don't start a Sentinel vault on the same account.
- **Other people's money.** Use only your own funds in the demo and don't solicit deposits. Cap leverage at 1x, set per-market size limits, and publish the weights. Judges will check this.
- **No track record.** Claim no performance. The honest line is: "here's the vault, here are the rebalances, here's the code."

## What I'd cut

Leave out extra live baskets (show them as "coming soon"), user-voted baskets, auto-weighting, Telegram, and any performance chart beyond the real short history. Also soften the "$500K basket → $5k/yr" pitch to a first milestone of $50k → $500/yr.
