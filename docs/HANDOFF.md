# Strike Baskets: handoff and current state

**As of:** Thu 22 Oct 2026, 20:45 IST
**Deadline:** Fri 23 Oct, 10:00 "EST". US clocks are on EDT until 1 Nov, so this is most likely **10:00 EDT = 14:00 UTC = 19:30 IST**. Confirm on the submission page. That leaves **~23 hours**.
**Read this first.** It's the single source of truth for where things stand. Everything else is linked from §14.

---

## 1. TL;DR
- **What we're building:** Strike Baskets, themed, rules-based baskets of Strike perpetuals (headline: **Pre-IPO: SpaceX, Zhipu, Unitree, MiniMax**) kept at fixed weights by a bot. There are two ways to hold one:
  1. **Vault mode:** deposit into our Strike vault, and the bot trades the vault.
  2. **Personal mode:** connect your own Strike account with a wallet signature (Strike Builder Connect), and the bot runs the basket there. We earn a builder fee.
- **Backend: done and tested.** 44 tests pass. It runs against the live Strike API.
- **Verified on real Strike:**
  - market data and public vault reads (mainnet + testnet)
  - the market-quality checks
  - the paper engine on live mainnet prices
  - **Builder Connect round-trip on testnet** with our registered builder code `StrikeBasket`
- **Not yet done:**
  - any real order on Strike (needs testnet funds)
  - the frontend
  - the demo video, README proof section and submission
  - **the repo isn't committed or pushed yet**
- **Hard constraint:** **no mainnet funds.** Mainnet is read-only, enforced in code. Everything that moves money happens on **testnet**.

---

## 2. The product in one page

**Pitch:** "One deposit, a whole theme. SpaceX, Zhipu, Unitree and MiniMax trade only on Strike. Baskets holds them at published weights and keeps them on target."

**How the engine works** (every 5 min, `CYCLE_SECONDS`):
1. **Read state from Strike**, the source of truth: equity and positions (vault, user account, or the paper book).
2. **Market checks** per symbol: spread ≤ 50 bps, mark within 100 bps of book mid, book ≤ 60 s old (plus a warn-only "index frozen" check). Off-hours stock and pre-IPO books are the main live risk.
3. **Plan** (pure function): target notional = equity × 0.9 × weight.
   - Rebalance triggers: a weight drifts ≥ 5 points, or it's the first allocation, or there's a stray position (vault only), or a forced run.
   - Legs below Strike's minimum order size are skipped with a reason.
   - Reduce-only legs go first.
4. **Execute:** one batch of market orders (1% slippage cap) with idempotent `client_order_id`s, each confirmed by looking up its client ID.
5. **Record:** runs, legs and snapshots go to SQLite → public API + SSE → the web app.

**Safety rules:**
- Gross exposure ≤ 0.9× equity (config refuses anything above 1×).
- Cross margin at 2x per symbol (Strike vaults default to isolated 10x, so the bot changes this).
- $2k per leg, $5k per run.
- 30-min cooldown between drift rebalances.
- Pause switch and flatten (flatten only while paused).
- **Mainnet write lock:** the HTTP client refuses every non-GET request to mainnet unless `ALLOW_MAINNET_WRITES=yes`.

**Business model** (both native to Strike):
- **vault leader commission:** 0–50%, default 10%, on profitable withdrawals only
- **builder fee:** on personal-mode fills; we charge 10 bps, Strike allows up to 100

---

## 3. What the demo will show (the decided shape)
| | Runs on | Proves | UI label |
|---|---|---|---|
| **Main page: Pre-IPO basket** | **Mainnet prices, paper fills** | The real product on Strike-only markets. Paper fills go through the same executor; fills at bid/ask, 0.05% taker fee, live funding | "PAPER · live mainnet prices, simulated fills" |
| **Personal mode** | **Testnet**, the user's own Strike account | Builder Codes integration; "use it yourself" | `/connect`, `/me` |
| **Testnet vault** (if testnet funds arrive) | Testnet, our vault, BTC/ETH | Vault-leader orders with `vault_id`, real Strike order IDs | "TESTNET · live Strike vault (BTC/ETH)" |

**Honest line for judges:** "The engine trades real Strike accounts on testnet, our vault and users' own accounts through Builder Connect. The Pre-IPO basket runs on live mainnet prices with simulated fills, because we didn't put real money in for the hackathon."

---

## 4. Decision log (why things are the way they are)
| Date (22 Oct) | Decision | Why |
|---|---|---|
| Morning | **Baskets** chosen over Sentinel, FeeSight and RangeKit | Brings deposits; uses Strike-only markets; real business model. See `reference/03`. |
| Afternoon | Testnet basket = **BTC/ETH only** (no SOL/ADA) | Live check: testnet SOL and ADA books sit **17–26% away from mark**, so they're unusable. The market check correctly refuses them, which makes a nice demo moment. |
| Afternoon | Market check uses spread, mark vs book and book age, **not mark age** | Strike stamps every mark with the server time, so mark age is always ~0 s. |
| Afternoon | Cross margin, 2x setting, 0.9× gross | Effective leverage ≤ 0.9×; no single-leg liquidation |
| Afternoon | **Never auto-retry an order**; replan from Strike's state each cycle | Safe after crashes and timeouts; duplicates are impossible |
| Evening | **No mainnet funds → mainnet read-only**, enforced in `StrikeClient` | User decision. Nothing asset-related on mainnet. |
| Evening | Pre-IPO main page runs on **paper through the real executor** | Keeps the distinctive product visible. "Same engine, different venue" is true in code. |
| Evening | Testnet vault becomes the **critical path** for Integration evidence | The strategist report (`reference/05`) says that without real orders the project reads as a dashboard |
| Evening | **Personal mode (Builder Connect)** added | User request. Strongest product story; uses Builder Codes, a Strike flagship; a second revenue line. |
| Evening | Builder code **`StrikeBasket`** registered on testnet (max 100 bps; we charge 10) | Needed for personal mode. Connect round-trip verified. |
| — | Terms: say **"basket vault"**, never "fund"/"index fund"; "**first themed, rules-based basket vault**", not "first vault" | Mainnet already has 3 user vaults, including MARKET WIZARDS trading stocks |

---

## 5. Status
| Area | State | Evidence |
|---|---|---|
| Strike client (signing, REST, vault, orders, batch, TWAP, leverage/margin, Builder Connect) | ✅ | `src/strike/*`; signing tests; live public calls |
| Mainnet write lock | ✅ | `test/mainnet-lock.test.ts` (no network call on any write) |
| Rebalancer (pure) | ✅ | `test/rebalancer.test.ts`, real mainnet filters |
| Market checks | ✅ live | Caught testnet SOL/ADA; mainnet Pre-IPO books pass at 5–6 bps |
| Engine (cycle, pause, cooldown, flatten, TWAP-busy guard, post-trade refresh) | ✅ | `test/engine.test.ts` |
| Paper exchange (bid/ask, fees, funding, rejects) | ✅ live | Ran on mainnet prices: SPCX mark 154.13 → filled at 154.23 |
| Public API + SSE + admin | ✅ | smoke-tested; `test/personal.test.ts` uses the real routes |
| **Personal mode** | ✅ backend; ✅ **real testnet connect** | `pnpm connect-test` with a throwaway wallet: Strike linked our key, and authenticated calls work |
| Real order on Strike (vault or personal) | ⏳ | Needs testnet funds in an account |
| TWAP with `vault_id` | ❓ unknown | Not in Strike's docs; `pnpm probe --twap` tests it. The default executor is batch, so this isn't blocking. |
| Frontend | ⏳ not started | Spec in `FRONTEND.md` |
| README proof, video, submission | ⏳ | — |
| Git | ⚠ **not committed, not pushed** | Do this first (§10, step 0) |

---

## 6. Architecture and repo map
```
Strike REST/WS ─► StrikeClient ─► BasketEngine (one per account) ─► Executor ─► Venue
                    │  sign, lock     │  state → gates → plan → decide        │   ├ StrikeClient (vault: vault_id)
                    │                 │                                        │   ├ StrikeClient (personal: user key + builder fee)
                    │                 └► Store (SQLite) ─► Fastify API + SSE   │   └ PaperExchange (no vault)
                    └► PersonalManager (users, connect, per-user engines)
```
| Path | What it is |
|---|---|
| `backend/src/config.ts` | All config (zod-validated), env URLs, safety refusals (gross > 1, live mainnet without the flag, personal mode without code/secret) |
| `backend/src/strike/sign.ts` | Ed25519 via Node's built-in crypto: REST headers, WS logon, keygen |
| `backend/src/strike/client.ts` | REST client: retries GETs, **mainnet write lock**, builder-fee header, Builder Connect, `forWallet()` |
| `backend/src/strike/types.ts` | **Live** response shapes (several differ from the docs; see STRIKE-API-NOTES) |
| `backend/src/core/rebalancer.ts` | **Pure** plan function. The heart of the project. |
| `backend/src/core/gates.ts` | Market-quality checks + index watch |
| `backend/src/core/basket.ts` | Basket JSON loader/validator (`backend/baskets/*.json`) |
| `backend/src/engine/engine.ts` | `BasketEngine`: one cycle per account; vault, paper or personal |
| `backend/src/engine/executor.ts` | Sends batch/TWAP and confirms by client ID; `Venue` interface |
| `backend/src/engine/paper.ts` | `PaperExchange`: a simulated Strike for paper mode |
| `backend/src/engine/events.ts` | Event bus (persisted + SSE); `SilentBus` for private personal accounts |
| `backend/src/personal/manager.ts` | Personal mode: eligibility, connect, per-user engines, controls |
| `backend/src/personal/secrets.ts` | AES-256-GCM for user keys; hashed session tokens |
| `backend/src/db/db.ts` | SQLite (`node:sqlite`): runs (with `scope`), legs, snapshots, events, kv, users; idempotent migrations |
| `backend/src/api/server.ts` | Public API, admin routes, personal routes |
| `backend/src/cli/*.ts` | `keygen`, `probe` (go/no-go), `plan` (dry run on live data), `connect-test` |
| `backend/baskets/` | `preipo` (main), `crypto-majors` (testnet: BTC 50/ETH 50), `ai-memory` and `hard-assets` (coming soon) |

**Invariants. Don't break these:**
1. Mainnet stays write-locked unless the team explicitly decides otherwise (`ALLOW_MAINNET_WRITES`).
2. The executor never re-sends an order; correction happens by replanning.
3. Personal runs are private: `scope = <userId>`, never in `/api/rebalances`, `/api/events` or `/api/stream`.
4. Personal mode only manages the basket's markets in a user's account.
5. Changing basket weights means editing the JSON **and bumping `version`** (runs record it).

---

## 7. Running it
Requires Node ≥ 22.13 (for `node:sqlite`) and pnpm.
```bash
cd backend && pnpm install
pnpm test          # 44 tests
pnpm typecheck
```

**Three instances** (one codebase; each needs its own `DB_PATH` and `PORT`):
```bash
# A. Main page: Pre-IPO on mainnet prices, paper fills. No keys. Start this ASAP and keep it running (history can't be backfilled).
STRIKE_ENV=mainnet BASKET_ID=preipo SHADOW_EQUITY_USD=5000 CYCLE_SECONDS=300 \
DB_PATH=data/mainnet-paper.db PORT=8787 ADMIN_TOKEN=<16+ chars> pnpm start

# B. Testnet: personal mode (+ testnet vault when it exists; paper until then)
STRIKE_ENV=testnet BASKET_ID=crypto-majors MAX_SPREAD_BPS=300 \
PERSONAL_MODE=yes BUILDER_CODE=StrikeBasket BUILDER_FEE_BPS=10 PERSONAL_SECRET=<openssl rand -hex 32, keep it> \
DB_PATH=data/testnet.db PORT=8788 ADMIN_TOKEN=<16+ chars> pnpm start
#   → once the testnet vault exists, add:
#   STRIKE_API_PUBLIC_KEY=… STRIKE_API_PRIVATE_KEY=… STRIKE_VAULT_ID=… EXECUTION_MODE=live
```
- `MAX_SPREAD_BPS=300` on testnet: its books are wide. Mainnet keeps the 50 default.
- `SHADOW_EQUITY_USD=5000` keeps the first allocation inside the $5k per-run cap. At $10k it gets scaled down; that's not a bug.
- Deploy A and B on an always-on box (VPS + `pm2`/`systemd`). A laptop that sleeps loses history.

**Useful commands:**
```bash
pnpm plan --basket preipo --env mainnet --equity 500          # dry-run plan on live prices
STRIKE_ENV=testnet pnpm probe                                  # go/no-go: public, auth, vault lookup
pnpm probe --settings --order BTC-USD                          # testnet vault: real min-size order, then close
pnpm probe --twap ETH-USD                                      # does TWAP accept vault_id?
BUILDER_CODE=StrikeBasket PERSONAL_SECRET=<hex> pnpm connect-test   # Builder Connect round-trip (throwaway wallet)
pnpm keygen                                                    # Ed25519 API wallet key pair
```
All settings are documented in `backend/.env.example`.

---

## 8. Accounts, credentials and where they live
| Thing | Where | Status |
|---|---|---|
| Builder code **`StrikeBasket`** | testnet.strikefinance.org/builder-codes (registered by the team owner) | ✅ Active, max 100 bps, $0 volume so far |
| Testnet API wallet (for the vault) | testnet.strikefinance.org/api-keys; generate with `pnpm keygen` | ⏳ not created |
| Testnet vault | testnet.strikefinance.org/vaults | ⏳ not created (needs funds) |
| Testnet funds | Faucets: see §9 | ⏳ |
| `PERSONAL_SECRET` | Server env only | Generate once and **never change it** (changing it disconnects every user) |
| `ADMIN_TOKEN` | Server env only | Enables `/api/admin/*` |
| Mainnet | Read-only. **No funds.** | By decision |

**No secrets are in the repo.** `.env` and `.env.*` are gitignored; only `.env.example` is committed. Check again before pushing.

---

## 9. Getting testnet funds
Strike testnet has **no faucet of its own**. You deposit coins from blockchain test networks, and Strike credits USD at the quote rate. The testnet app needs wallets on **Cardano Preprod, Ethereum Sepolia, Solana devnet**, BSC testnet or Base.
| Source | Gives | Notes |
|---|---|---|
| **Cardano Preprod faucet** (docs.cardano.org → Testnets → Faucet) | tADA | **Best option:** the largest drop (roughly $2k at testnet ADA marks; check the current limit). Set Lace/Eternl to Preprod. |
| Circle faucet (faucet.circle.com → Ethereum Sepolia) | test USDC | Small, rate-limited. The testnet app uses Circle's Sepolia USDC. |
| Solana devnet faucet (faucet.solana.com) | devnet SOL | Small, rate-limited |
| Strike Discord | Ask for testnet credit and for **mainnet credit or a vault-fee waiver** for hackathon teams | A yes to mainnet credit would bring back the original mainnet-vault plan |

Steps: claim faucet coins → testnet.strikefinance.org → connect → Deposit → (vault) create at `/vaults`, with **~$1,500–2,000** being enough.

---

## 10. Next steps (prioritised, with "done when")
| # | Task | Owner | Done when |
|---|---|---|---|
| **0** | **Commit and push the repo** (it's untracked right now). Secret-scan first. | anyone | Public GitHub URL exists |
| **1** | **Start instance A** (Pre-IPO paper) on an always-on box | ops | `/api/health` ok; snapshots accumulating overnight |
| **2** | **Testnet funds**: Preprod faucet + Discord ask | ops | Funds visible in a testnet Strike account |
| **3** | **Real personal-mode trade**: connect a funded wallet (frontend `/connect`, or a CLI that prints the challenge for MetaMask) | frontend + backend | A personal run with real Strike order IDs; the builder dashboard shows volume/fees |
| **4** | Testnet vault + `pnpm probe --settings --order BTC-USD` → run instance B with `EXECUTION_MODE=live` | ops + backend | A vault run with Strike order IDs. Checklist: initial → kill and restart (no duplicates) → pause → weights 70/30 + bump version → drift run → flatten |
| **5** | **Frontend** per `FRONTEND.md` | frontend | Main page, rebalance detail, `/connect`, `/me`, admin. Judge path ≤ 2 clicks to a real Strike order ID |
| 6 | `/api/proof` endpoint + README "Proof" section (vault ID, run IDs, order IDs, builder code) | backend | README filled |
| 7 | Demo video (3–4 min; script in §12) | team | Uploaded |
| 8 | Submission form | team | Submitted before **~18:30 IST**, keeping an hour of buffer |

**If time runs short, cut in this order:** the full `/testnet` page → TWAP → the testnet vault (keep personal mode, which also produces real orders) → the share-price chart. **Never cut:** the main Pre-IPO page, `/connect` + `/me`, a real Strike order ID, the README proof.

**Suggested timeline (IST):** now–00:00 tasks 0–2 and the frontend skeleton · 00:00–02:00 tasks 3–4 · 02:00–09:00 sleep (instance A keeps running) · 09:00–15:00 frontend polish, task 6 · 15:00–18:30 video and submission · 18:30–19:30 buffer.

---

## 11. Frontend in brief (full spec: `FRONTEND.md`)
- **Why it exists:** it's the basket's fact sheet and proof window. What you hold, the rules, live weights vs targets, why each trade happened, and a market check refusing bad prices. Strike's vault page can't show any of that. It's also how judges see every criterion.
- **Two API base URLs:** `VITE_API_URL` (instance A: main page) and `VITE_TESTNET_API_URL` (instance B: testnet vault panel, `/connect`, `/me`).
- **Pages:**
  - `/`: the Pre-IPO main page. Weights, drift, costs, chart, rebalance log, checks, rules, coming soon, a "Live on a Strike vault" panel, and **"Run this basket in your own Strike account →"**.
  - `/rebalances/:id`
  - `/connect`: MetaMask `personal_sign` only for now.
  - `/me`: my basket, controls, disconnect.
  - `/testnet`: optional.
  - `/how`
  - `/admin`
- **Copy rules:** "basket vault", no performance claims, "≤ 0.9× equity, no leverage", deposits and withdrawals happen on Strike. The text Strike makes users sign mentions "up to 0.1% fee" and "entrusting your API wallet private key": show it unchanged.

---

## 12. Demo video (3–4 min)
1. **0:00–0:30:** Problem → "one deposit, a whole theme". The Pre-IPO main page, live.
2. **0:30–1:00:** Rules + market checks (point at a check result; the testnet SOL refusal makes a good shot).
3. **1:00–2:00:** **Personal mode:** `/connect` → MetaMask signature → `/me` → first allocation → the same order ID on Strike testnet.
4. **2:00–2:40:** A rebalance in detail (before → target, legs, order IDs). Pause switch.
5. **2:40–3:10:** The testnet vault panel (if done).
6. **3:10–3:40:** Business model (leader commission + builder fee) → roadmap: Pre-IPO on mainnet, strategist marketplace on the same engine.

**Claims rules:** no performance claims; "paper" and "testnet" labelled everywhere they apply; "vault orders on the pre-IPO markets are untested until a mainnet vault is funded"; credit Strike's builder reference and skills where used; planning happened before 21 Oct and all code was written in the window.

---

## 13. Risks and open questions
| Risk / question | Status / mitigation |
|---|---|
| Testnet funds don't arrive | Personal mode needs funds too. Ask in Discord early. Fallback: paper only + a real connect (already verified) + the honest line. |
| TWAP with `vault_id` | Unknown; batch is the default; probe before relying on it |
| `GET /v2/order` response shape is undocumented | Parsed leniently (`parseOrderState`). Check against the first real order and fix if statuses come back `unknown`. |
| Whether signing includes the query string | Assumed yes (`SIGN_PATH_WITH_QUERY`). The probe's `openOrders?vault_id=` step verifies it. |
| Off-hours pre-IPO marks | The checks will show `gated` runs; that's correct behaviour. Explain it in the demo. |
| Builder fee credited on testnet? | Check the dashboard after the first personal trade |
| User trades basket markets by hand in personal mode | The next cycle rebalances them back. Documented limit. |
| Deadline timezone | Confirm EST vs EDT on the submission page |

---

## 14. Document index
| Doc | Use |
|---|---|
| `HANDOFF.md` (this) | Current state, decisions, next steps |
| `../README.md` | Judge-facing overview; **Proof section to fill** |
| `PLAN.md` | Runbook with the P0–P5 checklists |
| `FRONTEND.md` | Full frontend spec + API contract |
| `PERSONAL-MODE.md` | Personal mode flow, API, safety, verification |
| `STRIKE-API-NOTES.md` | Verified Strike facts; where the live API differs from the docs |
| `reference/01-analysis-testnet-mainnet-plan.md` | Team's starting brief (partly superseded) |
| `reference/02-idea-a-strike-baskets-team-doc.pdf` | Original idea doc (@mahi, 20 Oct) |
| `reference/03-baskets-fit-report.md` | Fit report: claims audit, judge lens, scope |
| `reference/04-event-thesis-and-rules.md` | Event rules (verbatim), judging criteria, thesis |
| `reference/05-no-mainnet-funds-decision-report.md` | Strategist evaluation of the no-mainnet-funds decision and alternatives |
| `reference/06-sentinel-plan-superseded.md` | The earlier Sentinel plan. Superseded, but its §10 has useful Strike API facts. |
