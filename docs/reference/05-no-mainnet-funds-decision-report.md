# Hackathon Fit Report: Strike Baskets, "no mainnet funds" decision @ Strike Hackathon (no tracks; top 3 overall)

**Mode:** normal   **Stage:** mid-build (backend built, 28 tests green, frontend not started)   **Time left:** ~25 h (deadline 23 Oct 10:00 ET, most likely 19:30 IST)   **Run date:** 2026-10-22
**Modules:** M0 (brief) → M1 → M2 → M3 → M4 → M5, comparing the alternatives
**Inputs:** `M0-THESIS.md` (verbatim rules), `BASKETS-FIT-REPORT.md`, `_judge/strike-baskets/pass3,4`, repo `/home/webexpert/strike` (README, docs/PLAN.md, `backend/src/**`)

## Verdict
**Given zero mainnet funds, the decision is right, and it's the best of the feasible options.** But it moves the project's weight onto one dependency. With the Pre-IPO basket on paper, **the testnet vault is now the only place where Strike integration does real work** (vault-leader orders, `vault_id`, fills). Without it, Baskets reads as a well-engineered dashboard over Strike prices, and the event rules count that as weak integration ("A dashboard that just links to Strike won't count", `M0-THESIS.md:48`).

The three changes that matter most:
1. **Treat testnet funds as the critical path, not a stretch goal.** This reverses `docs/PLAN.md` P1 ("don't block on this").
2. **Route paper mode through the real executor** with a paper exchange. Then the "one config change to mainnet" claim is true in code, and paper fills stop being flattering (at mark, no fees).
3. **Demo "deposit → bot allocates" on the testnet vault.** It recovers the Utility story ("brings deposits") that paper mode loses.

## Context Sheet (confirmed)
```
Strike Hackathon (first edition), build 21 Oct 10:00 EST → submit 23 Oct 10:00 EST; no tracks; 1st/2nd/3rd = 3,000/2,000/1,000 STRIKE
Judging (verbatim, unweighted): Innovation & Creativity; Integration With Strike; Utility & Impact; Technical Execution; Future Potential
Rule (verbatim): "your project must build on top of Strike in some meaningful way"
Deliverables: working prototype/MVP; documentation incl. how it interacts with Strike; video or live demo; GitHub repo
Upside: "direct investment from Strike and our partners"
Team: user owns frontend + ops; Claude owns backend. Constraint (22 Oct): NO mainnet funds, mainnet write-locked in code.
Testnet: BTC/ETH/SOL/ADA only; SOL/ADA books unusable (17–26% off mark); BTC min order $100
Past winners: none (first edition)
```

## 0. Event thesis (M0, brief)
Thesis (from `M0-THESIS.md`, medium-high confidence): *Strike rewards products that bring traders, volume and deposits to Strike through its API.* Re-scored for this decision:

| Axis | Mainnet vault (original) | **Decision as taken** | Why it moved |
|---|---|---|---|
| Sector match | 2 | 2 | Unchanged: automation + new application |
| Lane advantage | 1 | 1 | Unchanged |
| Format fit | 1 | **2** | No real-money risk in a live demo; everything is buildable in 25 h |
| Sponsor weight | 2 | **1** | Vault-leader trading only on testnet crypto; the Strike-only markets are read-only |
| Post-event credibility | 2 | **1–2** | Story intact, but there is no live vault, deposits or commission to point at |
| **Total** | 8 | **7–8** | Holds only if the testnet vault runs; paper-only drops to ~6 |

## Alternatives weighed
Scores use the prior judge model's scale (`_judge/strike-baskets/pass3`, baseline 58 for the mainnet plan). They are **rough estimates, low confidence**.

| Option | Integration | Tech. Exec. | Utility | Est. overall | Cost / risk | Verdict |
|---|---|---|---|---|---|---|
| **A. Mainnet Pre-IPO vault** (original) | 3 | 3 | 2 | ~65–70 if one real rebalance ships | ~$420 (100 fee sunk + ~$320 seed, recoverable after 1-day lockup) | Not available. **The only reversal worth reconsidering** (see action 2) |
| **B. Decision as taken:** paper Pre-IPO on mainnet prices + live testnet vault (BTC/ETH) | 2 | 2–3 | 1–2 | **~52–57** | Depends on testnet USDC arriving | ✅ **Best feasible** |
| C. Paper-only (testnet funds never arrive) | 1 | 1–2 | 1 | ~42–48 | None | ⚠ Fallback only; reads as a dashboard |
| D. Testnet crypto basket as the hero | 2 | 2–3 | 1 | ~45–50 | Same as B | ❌ Drops the Strike-only markets, the Innovation core |
| E. Pivot to Sentinel (AI agent, testnet BTC) | 2 | 1–2 (rebuild in 25 h) | 1–2 | ~45–55, high variance | Throws away working code | ❌ Same testnet dependency, plus a rewrite |

**Why B beats D and E:** the Pre-IPO theme is the only thing no other team can show, and it stays fully visible in B. The testnet vault supplies proof that Strike integration works. The two halves cover each other's weaknesses, as long as the **same code** runs both (action 3).

## 1. Requirements (M1)
| # | Requirement (verbatim, `M0-THESIS.md`) | HARD/SOFT | Status under B | Evidence / gap | Fix |
|---|---|---|---|---|---|
| 1 | "must build on top of Strike in some meaningful way" | HARD | **Partial → Met with testnet vault** | Market data and public vault reads work; orders are proven only against a fake exchange (`test/engine.test.ts`) | Testnet vault run (S, blocked on funds) |
| 2 | "working prototype/MVP" | HARD | Met | Engine and API run; `pnpm plan` on live mainnet data | — |
| 3 | Documentation incl. "how it interacts with Strike" | HARD | Partial | `README.md` integration table; Proof section is TODO | `/api/proof` + IDs (S) |
| 4 | Video or live demo | HARD | Missing | — | Script below (M) |
| 5 | GitHub repo | HARD | Partial | Local git, nothing committed or pushed | Commit + push (S) |
| 6 | "original work developed… during the hackathon" | HARD | Met | All code written 22 Oct; planning docs pre-date the window (allowed) | Say so in the README |

## 2. Sponsor centrality (M2), under decision B
| Component | Class | Evidence |
|---|---|---|
| Vault-leader orders / batch with `vault_id` | **Load-bearing on testnet only**; on mainnet it's design-only | `executor.ts`; mainnet blocked by `client.ts` `MainnetWriteBlocked` |
| Stock and pre-IPO perps | **Read-only** (prices, books, filters) | `engine.ts` paper source |
| Public vault data (share price, depositors) | Testnet only; null on the Pre-IPO page | `server.ts` `/api/state` `sharePrice` |
| Market gates on Strike books | Load-bearing and visible | Caught testnet SOL/ADA; mainnet books pass at 5–6 bps |
| User vault deposits / commission | **Absent** from the hero demo | No mainnet vault, so no "Deposit on Strike" link |

**Flagship gap:** the hero basket can't take a deposit. **Highest-leverage change:** show the deposit loop on the testnet vault (deposit in the Strike UI → equity rises → weights fall below target → the engine allocates, with order IDs).

## 3. Judge lens (M3)
| Criterion | Visible in 3 min | Built but invisible | 0–3 | Cheapest lift |
|---|---|---|---|---|
| Innovation | Pre-IPO basket on live prices | — | 2 | Open on "SpaceX, Zhipu, Unitree, MiniMax in one deposit" |
| Integration | Testnet vault orders (if run) | Signing, `vault_id`, symbol settings | 1 → **2** with testnet | Testnet order IDs, clickable on Strike |
| Utility | Rules panel, safety | — | 1 | Testnet deposit → auto-allocate clip |
| Tech. Exec. | Gate refusing a broken book; pause | 28 tests, crash-safe reconcile | 2 | Show `gated` run and restart-without-duplicates |
| Future Potential | Commission model | — | 2 | Mainnet = config change (true once action 3 lands) |

**Where an impatient judge stops:** at the "PAPER" badge on the hero page, asking "so does it actually trade on Strike?" The answer has to sit **one click away**: a "Live on testnet vault →" panel with order IDs.

## 4. Claims audit (M4), what the decision makes false or shaky
| Claim (source) | Status | Fix / honest rewrite |
|---|---|---|
| "Moving it to a mainnet vault is a config change" (`README.md` Proof) | **True-in-design-only**: paper mode bypasses the executor, and vault orders on pre-IPO markets were never tested (the original go/no-go item) | Route paper through the executor (action 3). Say: "Same engine trades our testnet vault; vault orders on pre-IPO markets are untested until we fund mainnet." |
| Integration table: "Vault leader orders, batch orders, `vault_id`" (`README.md`) | Overstated unless labelled | Add "(testnet vault: \<id\>)" |
| Paper equity / share price | Overstated: fills at mark, no fees, no funding | Fill at bid/ask, charge fee, accrue funding (action 3) |
| "Every rebalance is logged with its Strike order IDs" (`README.md`) | False for paper runs | "…with Strike order IDs (testnet) or simulated fills (paper)" |
| "Deposit once into a Strike user vault" (README opener) | Not demonstrable on the hero basket | Keep as the product description; demonstrate on testnet |

**Core-promise verdict:** "a bot that keeps a Strike vault on target weights" **holds on testnet once run; holds in design only on the Pre-IPO basket.** Minimal fix: testnet run + paper through the same executor.

## 5. Action plan
| # | Action | Moves | Effort | Owner | Done when |
|---|---|---|---|---|---|
| 1 | **Testnet funds + vault tonight.** Check the testnet app for a faucet or credit button first (testnet vaults like "Audit Credit Route 0208" hold exactly $100, which hints at a credit flow; an inference, not verified). Then Strike Discord. | Integration, TE, req. 1 | S (waiting) | You | `pnpm probe --order BTC-USD` passes on a testnet vault |
| 2 | **One Discord ask to Strike:** builder mainnet credit or a vault-fee waiver for hackathon teams. If granted, option A comes back with zero personal spend. | All five (+10–15 est.) | S | You | Answer received, yes or no |
| 3 | **Paper exchange adapter:** paper mode runs through `Executor` (same batch/confirm/legs path); fills at book side + taker fee + hourly funding. Absorbs PLAN P3. | TE, claims | M | Me | Paper runs show legs with `paper-` order IDs, fees and funding in `/api/state` |
| 4 | Start the mainnet paper engine (PLAN P0); restart it after #3 lands | Innovation, demo history | S | You | Running ≥ 18 h before recording |
| 5 | **Testnet deposit → auto-allocate** clip + full PLAN P2 checklist | Utility, Integration | M | Both | Order IDs and run IDs in the README |
| 6 | Claims rewrite (table above) in README, UI badges, pitch | Claims safety | S | Me | No unlabelled "vault" claim on paper data |
| 7 | Frontend: hero Pre-IPO page + "Live on testnet vault" panel (second API base) | Visibility of Integration | M–L | You | Judge reaches a Strike order ID in ≤ 2 clicks |
| 8 | `/api/proof` + README Proof section | Req. 3 | S | Me | Vault ID, run IDs, order IDs listed |
| 9 | Commit + push the repo, secret scan | Req. 5 | S | Both | Public URL |
| 10 | Video (script below) | Req. 4 | M | You | ≤ 4 min, uploaded |

## 6. Cut list
Sentinel pivot; any mainnet write; TWAP unless `probe --twap` passes first try; extra live baskets; vault userstream WS (keep REST polling); performance charts beyond real history.

## 7. Pitch skeleton (M6)
- **Title:** Strike Baskets: one deposit, a whole theme
- **Opening:** "SpaceX, Zhipu, Unitree and MiniMax trade only on Strike. Baskets holds them at published weights inside a Strike vault and keeps them on target."
- **How it works:** 1) read vault state from Strike → 2) gate on book quality → 3) plan to target weights → 4) vault orders with `vault_id` → 5) public rebalance log.
- **Proof:** testnet vault ID + order IDs; Pre-IPO basket running on live mainnet prices since \<time\>; 28+ tests.
- **Honesty line:** "We didn't put real money in for the hackathon. The Pre-IPO basket runs paper fills on live mainnet prices through the same engine that trades our testnet vault."
- **Video shots:** Pre-IPO page live (0:00–0:40) → rules + gates (0:40–1:10) → testnet: deposit in the Strike UI → engine allocates → same order on Strike (1:10–2:30) → gate refusing testnet SOL's book + pause switch (2:30–3:10) → commission model + strategist marketplace (3:10–3:40).
