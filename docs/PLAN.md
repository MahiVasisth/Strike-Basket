# Build plan and runbook

**Deadline:** 23 Oct 10:00 "EST". US clocks are on EDT until 1 Nov, so this is most likely **10:00 EDT = 14:00 UTC = 19:30 IST**. Check the submission page.

## Constraint: no mainnet funds (decided 22 Oct)
We have **no mainnet funds and will do nothing asset-related on mainnet.** The code enforces this:
- `StrikeClient` refuses every non-GET request to mainnet (orders, batch, leverage, margin mode, TWAP, cancels) **before it reaches the network**, unless `ALLOW_MAINNET_WRITES=yes`. It is unset everywhere and stays unset. Covered by `test/mainnet-lock.test.ts`.
- `EXECUTION_MODE=live` on mainnet refuses to start without that flag.
- Mainnet is used **read-only**: live Pre-IPO prices, books, filters and funding, all public endpoints that need no keys.

### What the demo becomes
| | Environment | What it proves | Label in the UI |
|---|---|---|---|
| **Hero: Pre-IPO basket** | mainnet prices, **paper book** (`source=paper`) | The real product: SPCX/ZHIPU/UNITREE/MINIMAX weights, drift, gates and rebalances computed from live Strike data, running for ~24 h | "PAPER · live mainnet prices, simulated fills" |
| **Machinery: Crypto basket** | testnet, **real vault**, live orders | Vault-leader orders with `vault_id`, batch, confirmation by client ID, pause, flatten, real Strike order IDs | "TESTNET · live vault" |

The honest one-liner for judges: *"The engine trades a real Strike vault on testnet. The Pre-IPO basket runs on live mainnet prices in paper mode, because we didn't put real money in for the hackathon. Switching it to a mainnet vault is one config change."*

## Priorities

### P0 — start the mainnet paper engine now (30 min) ⚠ time-critical
History can't be backfilled. Every hour it isn't running is an hour missing from the demo chart and rebalance log.
```bash
cd backend
STRIKE_ENV=mainnet BASKET_ID=preipo EXECUTION_MODE=shadow SHADOW_EQUITY_USD=5000 \
CYCLE_SECONDS=300 DB_PATH=data/mainnet-paper.db PORT=8787 ADMIN_TOKEN=<16+ chars> pnpm start
```
- Run it on an always-on box (VPS, or a machine that won't sleep) under `pm2`/`systemd`/`tmux`.
- No keys needed. It can't trade: it has no keys, it's in shadow mode, and mainnet is write-locked.
- $5k paper equity keeps every leg well above minimums and the whole allocation inside the $5k per-run cap.
- Paper fills go through the same executor as the vault: fill at bid/ask, 0.05% taker fee, live hourly funding. Orders get `paper-N` IDs.

### P1 — testnet access (1 h, mostly waiting on others)
1. `pnpm keygen` → register the public key as an API wallet in the **testnet** app.
2. Fund the testnet account with faucet coins (see "Testnet funds" below) and create a vault at testnet.strikefinance.org/vaults. **~$1,500–2,000 is enough**: the demo's rebalances come from weight changes (e.g. 50/50 → 70/30 moves ~$270 per leg), well above testnet BTC's $100 minimum.
3. `STRIKE_ENV=testnet pnpm probe` → auth + query signing + vault lookup.
4. `pnpm probe --settings --order BTC-USD` → **the go/no-go**: a real vault order, then closed.
5. `pnpm probe --twap ETH-USD` → does TWAP take `vault_id`?

**This is the critical path, not a stretch goal** (see `hackathon-assessment/strike-hackathon/BASKETS-DECISION-REPORT.md`). With the Pre-IPO basket on paper, the testnet vault is the only place Strike integration does real work. Check the testnet app for a faucet or credit flow before waiting on Discord. In the same Discord message, ask whether Strike offers hackathon teams mainnet credit or a vault-fee waiver.
If funds still haven't arrived by ~02:00 IST, fall back to paper-only and say plainly in the pitch: "execution path tested against a simulated exchange; not yet run on a vault".

### P2 — testnet live run (2 h, after P1 passes)
```bash
STRIKE_ENV=testnet BASKET_ID=crypto-majors EXECUTION_MODE=live MAX_SPREAD_BPS=300 \
CYCLE_SECONDS=60 DB_PATH=data/testnet-live.db PORT=8788 pnpm start
```
Checklist, collecting order IDs for the README as you go:
- [ ] `initial` run → both legs `filled` with Strike order IDs
- [ ] Kill mid-run, restart → run reconciles, no duplicate orders
- [ ] Pause → next trigger logged `paused`, nothing sent → resume
- [ ] Change weights to 70/30, bump `version`, restart → `drift` run, reduce-only sell first
- [ ] Pause → `POST /api/admin/flatten` → vault flat

### P3 — make the paper book honest ✅ done
Paper mode now runs through the same `Executor` as the vault, against a paper exchange: fills at bid/ask, Strike's tier-0 taker fee (0.050%), hourly funding from the live rate, slippage-cap and reduce-only rejections. `/api/state.costs` has `{fees, funding}`.

### P3b — personal mode (Builder Connect) ✅ backend done, ⏳ needs a builder code
Users connect their own Strike account (testnet), and the engine rebalances the basket there with `X-Builder-Fee-Bps`. See `docs/PERSONAL-MODE.md`. Tested end to end against a simulated Strike, and the connect round-trip passed on real testnet. **Not yet traded in a funded account.**
- [x] Builder code `StrikeBasket` registered (testnet, max 100 bps)
- [x] Real Builder Connect round-trip on testnet (`pnpm connect-test`, throwaway wallet)
- [ ] Testnet instance: `PERSONAL_MODE=yes BUILDER_CODE=… PERSONAL_SECRET=$(openssl rand -hex 32)`
- [ ] One real connect with MetaMask on a funded testnet account → first run with Strike order IDs
- [ ] Check the builder dashboard shows the fee from that run

### P4 — frontend (you, start now in parallel)
Per `docs/FRONTEND.md`. Point it at the P0 instance (it has real data immediately). Personal mode adds `/connect` (MetaMask `personal_sign`) and `/me` (section 1.6), about 2–3 h more. If time runs short, cut the `/testnet` full page before cutting `/connect`. If P2 happens, the page takes a second API base URL for the testnet instance and shows both with their badges.

### P5 — submission (3–4 h, leave a buffer)
- `/api/proof` endpoint + README Proof section: testnet vault ID, order IDs, paper run IDs (me)
- README: integration map, safety rules, the honest one-liner above
- Demo video, 3–4 min: Pre-IPO page live → a rebalance with its plan → the gate refusing testnet SOL's broken book → testnet vault order with its ID on Strike → pause switch → business model
- Secret scan (`.env` is gitignored; double-check), push, submit

### Cut
Mainnet vault, mainnet orders, mainnet probes, TWAP on mainnet, extra live baskets, user-voted baskets, Telegram.

## Testnet funds
Strike testnet has no faucet of its own. You deposit **test-network coins** and Strike credits USD at the quote rate. The testnet app needs wallets on these test networks: Cardano **Preprod**, Ethereum **Sepolia**, Solana **devnet**, BSC testnet, Base.
| Source | What | Roughly |
|---|---|---|
| Cardano Preprod faucet (docs.cardano.org → Testnets → Faucet) | tADA, deposited as ADA | Largest single drip (around 10k tADA ≈ $2k at testnet ADA marks); limited per day |
| Circle faucet (faucet.circle.com → Ethereum Sepolia) | test USDC; the testnet app maps Sepolia USDC to `0x1c7D…7238`, which is Circle's | Small amounts per request; rate-limited |
| Solana devnet faucet (faucet.solana.com) | devnet SOL | Small; rate-limited |
| Strike Discord | Ask for testnet credit, and mainnet credit or a vault-fee waiver for hackathon teams | Unknown |
Steps: set Lace/Eternl to **Preprod** → claim tADA → testnet.strikefinance.org → connect → Deposit ADA → create vault at `/vaults` → API key at `/api-keys`.

## Timeline (IST)
| When | Backend (me) | You |
|---|---|---|
| Now → 19:00 | — | **P0 deploy**, P1 Discord ask + keygen |
| 19:00 → 23:00 | P3 paper realism, `/api/proof` | Frontend skeleton on the P0 API |
| 23:00 → 02:00 | Support P1/P2 probes, fix what breaks | P2 testnet run when funds land |
| 02:00 → 09:00 | **sleep** — P0 keeps running | **sleep** |
| 09:00 → 15:00 | README, fixes | Frontend polish |
| 15:00 → 18:30 | Freeze | Demo video, submit |
| 18:30 → 19:30 | Buffer | Buffer |

## Decisions taken in this build
| Decision | Why |
|---|---|
| Mainnet write lock in the HTTP client | No mainnet funds; it can't be bypassed by a stray CLI flag or config typo |
| Cross margin, 2x per-symbol setting, 0.9 gross exposure | Effective leverage ≤ 0.9×; vaults default to isolated 10x, so the bot sets this first (testnet only for now) |
| Never auto-retry an order; re-plan from Strike state each cycle | Crash- and timeout-safe without duplicates |
| Gate on spread, mark-vs-book and book age, not mark age | Strike stamps marks with the server time, so mark age is always ~0 s |
| Basket weight changes are versioned files | Every run records the basket version it traded |
| SQLite via `node:sqlite` | No native build, no external DB |
