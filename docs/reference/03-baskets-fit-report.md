# Hackathon Fit Report: Strike Baskets @ Strike Hackathon (no tracks; top 3 overall)

**Mode:** normal (team doc dated 20 Oct with criteria, lanes and checks), except for time left ⚠
**Run date:** 2026-10-22   **Modules:** M0 → M1 → M2 → M3 → M4 (claims in the doc) → M5
**Inputs:** Baskets idea doc (@mahi, 20 Oct), `M0-THESIS.md`, `CONTEXT.md`; live Strike API on 2026-10-22: `GET /price/v2/exchangeInfo` (mainnet and testnet), `/price/v2/ticker/24hr`, `/price/v2/depth` for 16 basket markets, `GET /v2/vaults` (mainnet and testnet); grid/TWAP docs from earlier today

⚠ Assumption: less than 24 h left (submission 23 Oct 10:00 EST). I don't know whether Baskets or Sentinel is the build in progress.

## Verdict
**This is the strongest of the three ideas checked today, and it fits the event about as well as Sentinel.** It brings deposits rather than just trades, it shows off markets only Strike has (pre-IPO perps), and the leader-commission model is real. The doc gets the criteria right. The liquidity worry is overstated: the books are deep enough.

**One fact breaks the plan: testnet has none of the basket markets.** Testnet lists only `ADA-USD, SOL-USD, BTC-USD, ETH-USD`. "Run on testnet first" can't test a stock or pre-IPO basket. The demo basket has to run on **mainnet with real money**, or the testnet demo has to use a crypto basket.

The three changes that matter most:
1. **Split the environments.** Test the rebalancer on testnet with a crypto basket (BTC/ETH/SOL/ADA). Run the real "AI Memory" or "Pre-IPO" basket on **mainnet** with a small vault: 100 USDC fee + about $100–200 seed, 1x leverage. Decide today.
2. **Fix two lane claims before a judge does.** "Nobody on Strike uses vaults" is false: mainnet has 3 user vaults, and **MARKET WIZARDS** already advertises "systematic positional trading within the stock market… commodities and crypto". Say instead: "**the first themed, rules-based basket vault**: fixed published weights, no discretion".
3. **Use Strike's own TWAP for rebalances.** `POST /v2/algo/twap` takes `vault_id`. Rebalancing through Strike's algo engine instead of our own market orders adds a second Strike product and answers the slippage question.

---

## Claims audit of the team doc (M4)
| Doc claim | Check (2026-10-22) | Status |
|---|---|---|
| 31 perps incl. MU, SKHYNIX, SNDK, DRAM, CXMT, SPCX, ZHIPU, UNITREE, MINIMAX, XAU, XAG, WTI, NVDA, TSLA, GOOGL, COIN | Mainnet `exchangeInfo` lists **32**, and all 16 basket symbols are there | ✅ (count is 32) |
| "Run on testnet first" (risk table) | **Testnet has only ADA, SOL, BTC, ETH** | ❌ Contradicted for every themed basket |
| "Vault setup fails on testnet → fallback" | 47 user vaults exist on testnet, so creation works there | ✅ for crypto only |
| "Nobody on Strike uses vaults" / "a Strike feature no other project uses" | Mainnet `/v2/vaults` count is 4: MARKET WIZARDS (systematic stocks/commodities/crypto), Strike V.I.S.I.O.N., Glacier Arc Digital (market making) and SLP | ❌ Overclaim. Say "first themed basket vault" |
| "Thin pre-IPO markets may mean slippage" | Spread about 6 bps on every basket market. ±1% depth is about $55k per side on CXMT, ZHIPU, UNITREE and MINIMAX, and about $110–140k on the rest. A $100–1,000 rebalance is negligible | ✅ Risk is overstated (the books look market-made; recheck at demo time) |
| 24h volume | ZHIPU about $593k, MINIMAX $363k, UNITREE $273k, CXMT $110k, SKHYNIX $116k, SNDK $116k, MU $24k, **DRAM $1.9k**, **XAG $0.7k**, NVDA $6.6k | ⚠ Depth is there but organic flow is thin on DRAM, XAG and NVDA. Prefer the **Pre-IPO** basket for the demo: it has the best volume and is the most distinctive |
| "User deposits USDC into that basket's Strike vault" from our web app | No vault-deposit (or vault-creation) endpoint is documented (`CONTEXT.md` §10.3) | ⚠ The app must **link out to the Strike vault page** for deposit and withdrawal. Don't show an in-app deposit button that isn't one |
| "One-click themed **index funds**" | — | ⚠ Wording. These are leveraged perps in a pooled vault, not a fund. Use "basket vault" and keep "fund" out of the pitch and UI |
| "Our fee on any profit" / 10% commission | Leader commission 0–50%, default 10%, charged on profitable withdrawals only (`CONTEXT.md` §10.3) | ✅ |
| "$500K basket → $5k/yr" | Strike TVL is about $15m in total, and the largest user vaults are small | ⚠ It's a sound formula, but give the pitch a smaller first milestone ($50k → $500/yr), or judges will discount it |

## 0. Event fit (M0)
| Axis | Doc | Revised | Why |
|---|---|---|---|
| Sector match | 2 | 2 | Automation and new applications. It brings deposits and volume |
| Lane advantage | 2 | **1** | Themed baskets are new, but stock-trading vaults exist (MARKET WIZARDS) |
| Format fit | 1 | 1 | No testnet stock markets, so the themed demo is mainnet-only |
| Sponsor weight | 2 | 2 | Vaults, the Vault Leader API, batch orders, TWAP and unique markets are all load-bearing |
| Post-event credibility | 2 | 2 | Leader commission, more baskets, a strategist marketplace |
| **Total** | 9 | **8/10** | Comparable to Sentinel's 9. Baskets is more distinctive; Sentinel is easier to show live |

## 1. Requirements (M1)
Every HARD rule can be met. The one at risk is "**working prototype**": a two-day-old basket must visibly *do* something. Show a real mainnet vault ID, the initial allocation orders, and at least one real rebalance (force a small one by nudging a weight or the drift threshold) with its order IDs.

## 2. Sponsor centrality (M2)
| Component | Class |
|---|---|
| User vault (shares, lockup, commission) | Load-bearing |
| Vault Leader orders and batch orders with `vault_id` | Load-bearing |
| Stock and pre-IPO perps | Load-bearing. Exists nowhere else on Cardano or Strike |
| `/v2/algo/twap` with `vault_id` for rebalances | **Add.** It's a second Strike engine and fixes slippage |
| User and market WS, vault public endpoints | Load-bearing / convenience |
| Builder Codes | Not applicable: vault-leader orders don't carry builder fees, and the revenue is the commission. Say so plainly |

Removal test: passes. Without Strike there are no vaults and no pre-IPO perps.

## 3. Judge lens (expected 0–3)
| Criterion | Score | Cheapest lift |
|---|---|---|
| Innovation | 2–3 | Lead with the Pre-IPO basket: "SpaceX, Zhipu, Unitree, MiniMax in one deposit" |
| Integration | 3 | Vault + batch + TWAP + WS; a README file map with the vault ID and order IDs |
| Utility & Impact | 2 | Frame it as deposits that stay. One number: "mainnet has 3 user vaults today" |
| Technical Execution | 2 | Show drift → rebalance plan → TWAP/batch → confirmed fills, plus the pause switch |
| Future Potential | 2–3 | Strategist marketplace on the same engine; a realistic first-milestone fee |

## 4. Risks the doc doesn't list
- **Off-hours pricing.** How are stock and pre-IPO perps marked when US/Asian markets are closed, and how are pre-IPO names marked at all (no spot reference)? Rebalancing against a stale or thin mark is the most likely live bug. Gate rebalances on mark freshness and on spread being under a threshold.
- **Funding drag.** A long-only basket usually pays funding. Show "funding paid" on the dashboard, as the doc already plans.
- **One active user vault per account.** If Sentinel also needs a vault, it needs a separate account.
- **Rebalance thresholds vs minimum notional.** XAU has a `MIN_NOTIONAL` of 10 USD. Check each basket market's filters in `exchangeInfo` so small drifts don't produce rejected orders.

## 5. Scope (⚠)
**Must (in this order):**
1. A deterministic rebalancer: target weights → current positions (`/v2/positions?vault_id=`) → order list. It's pure and unit-tested.
2. Executor: batch orders, or TWAP for large legs, with `vault_id` and idempotent client IDs.
3. Testnet crypto-basket run, then a mainnet Pre-IPO vault.
4. Web page: basket composition, live weights vs targets, share price, rebalance log with order IDs, and a "Deposit on Strike" link.
5. Pause switch and mark-freshness gate.

**Cut:** additional live baskets (show them as "coming soon", which the doc already does), user-voted baskets, auto-weighting, Telegram, any performance chart beyond the actual short history.

## Action plan
| # | Action | Effort | Criterion |
|---|---|---|---|
| 1 | Decide mainnet for the themed demo; fund the vault (100 USDC fee + seed) today | S | Working prototype |
| 2 | Develop and test the rebalancer on a testnet BTC/ETH/SOL/ADA vault | M | Technical Execution |
| 3 | Rebalance through `/v2/algo/twap` with `vault_id` (fall back to batch) | S–M | Integration |
| 4 | Change the lane wording to "first themed, rules-based basket vault" and drop "fund" | S | Claims safety, Innovation |
| 5 | Make the Pre-IPO basket the hero; drop DRAM, XAG and NVDA from demo baskets (low volume) | S | Innovation, Utility |
| 6 | Add the mark-freshness and spread gate before any rebalance | S | Technical Execution |
| 7 | Force one real rebalance before recording, with its order IDs in the README | S | Technical Execution |
| 8 | Deposit and withdraw link out to Strike (no fake in-app button) | S | Claims safety |

## Pitch skeleton (M6)
1. "One deposit, a whole theme: SpaceX, Zhipu, Unitree, MiniMax, only on Strike."
2. Live: basket page → vault on Strike → a rebalance log line → the same order on Strike.
3. Safety: 1x leverage, published weights, pause switch, no discretion.
4. Business: leader commission on profits only; next, baskets from other strategists on the same engine.
