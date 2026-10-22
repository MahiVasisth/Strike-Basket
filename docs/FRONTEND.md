# Frontend requirements: Strike Baskets

The backend is done and serves everything below. The frontend is a read-mostly single page plus a small admin panel. Suggested stack: React + Vite + Tailwind, `lightweight-charts` for the share-price line. Any stack works.

**Two backend instances, one API.** Both serve the identical API described below; only the data differs.
| Env var | Instance | What it shows |
|---|---|---|
| `VITE_API_URL` (default `http://localhost:8787`) | **Pre-IPO basket**: mainnet prices, paper fills | The hero page (`/`) |
| `VITE_TESTNET_API_URL` (optional, e.g. `http://localhost:8788`) | **Crypto basket on a real testnet vault**: live Strike orders | The testnet panel and `/testnet` (section 1.5) |

If `VITE_TESTNET_API_URL` is unset or its `/api/health` fails, hide everything testnet-related; the site must work with the hero instance alone. Build one API client that takes a base URL, and reuse every component for both instances.

All responses are JSON; numbers that are money or quantities arrive as **strings** (parse them for display only).

**Judge path to optimise for:** hero page → "Live on a Strike vault" panel → a rebalance with real Strike order IDs. **≤ 2 clicks.** The paper hero answers "what is it?"; the testnet panel answers "does it really trade on Strike?"

## 1. Pages and what each must show

### 1.1 Basket page (`/`), the demo hero
| Block | Data | Notes |
|---|---|---|
| **Environment badge** | `GET /api/basket` → `env`, `mode`, `source` | Always visible, top of page. Text rules below. |
| **Header** | `name`, `tagline` | "One deposit, a whole theme." |
| **Composition** | `constituents[]` (symbol, name, weight) | Donut or bars. Targets come from here. |
| **Live weights vs targets** | `GET /api/state` → `weights[]` | Table: symbol, mark, target %, current %, drift (bps, coloured), qty. Highlight a row when `abs(driftBps) >= driftThresholdBps`. |
| **Drift meter** | `state.maxDriftBps` vs `state.driftThresholdBps` | "Max drift 3.1% / rebalance at 5.0%". |
| **Share price + equity** | `state.sharePrice`, `state.equity`, `state.depositors` | `sharePrice` is null in paper mode: show equity only. |
| **Costs paid** (paper) | `state.costs` → `{fees, funding}` | "Fees $2.50 · Funding $0.00". Shows the paper results include real trading costs. Null for a vault. |
| **Share-price chart** | `GET /api/snapshots?since=` → `[{ts, share_price, equity}]` | Short history only. **No returns %, APR or "performance" claims.** |
| **Rebalance log** | `GET /api/rebalances` | One row per action: time, trigger, status, legs. Click → detail. |
| **Market gates** | `state.gates[]` | Per symbol: spread bps, mark-vs-book bps, `failures[]`, `warnings[]`. Green/red dot. |
| **Status strip** | `GET /api/health` | "Engine alive · last check 42s ago · next in 4m". Warn if `now - lastTickAt > 2 × cycleSeconds`. Show **Paused** prominently when `paused`. |
| **Rules panel** | `basket.rules` | Gross exposure (e.g. "0.9× equity, no leverage"), drift threshold, margin mode, leverage, caps, gates. This answers "is it safe?" |
| **Deposit on Strike** | `basket.vault.url` | A **link out** to the Strike vault page. Do **not** build an in-app deposit button; Strike has no vault-deposit API. Hide it if `url` is null. |
| **Coming soon** | `GET /api/baskets` → entries with `status: "coming_soon"` | Greyed cards: AI Memory, Hard Assets. |
| **"Live on a Strike vault" panel** | Testnet instance, see 1.5 | Place it high, right after the weights table. It is the proof the paper hero can't give. |

**Environment badge text**
- `env=testnet, mode=live` → "TESTNET · live Strike vault (BTC/ETH)"
- `env=testnet, source=paper` → "TESTNET · paper"
- `env=mainnet, mode=live` → "MAINNET · live vault"
- `mode=shadow, source=vault` → "MAINNET · plan only (no orders sent)"
- `source=paper` → "PAPER · live mainnet prices, simulated fills" (fills at bid/ask with Strike's 0.05% taker fee and live funding)

### 1.2 Rebalance detail (`/rebalances/:id`)
`GET /api/rebalances/:id`
- Header: time, trigger (`initial` / `drift` / `stray` / `force`), status, equity at the time, basket version.
- **Before → target table** from `plan.rows` (current vs target weight per symbol).
- **Legs table** from `legs[]` (paper runs have `paper-N` order IDs: label them "simulated", don't link them to Strike): side, qty, est. notional, reduce-only, method (batch/twap), status, filled qty, avg price, **Strike order ID** (`strikeOrderId`, fall back to `clientOrderId`). This is the judge's proof, so make IDs copyable.
- `plan.skipped[]` with reasons (e.g. `BELOW_MIN_NOTIONAL`), and `plan.warnings[]`.
- `gates[]` at the time of the run.

### 1.3 How it works (`/how`)
Static. Three steps: deposit into the Strike vault → bot keeps weights on target (drift → plan → orders tagged `vault_id`) → withdraw on Strike after the 1-day lockup. Then the Strike-integration list (vault leader orders, batch/TWAP, market data, public vault endpoints) and the risk rules. Say "basket vault", never "fund" or "index fund".

### 1.4 Admin (`/admin`, hidden route)
Token input (kept in `sessionStorage`), sent as `Authorization: Bearer <token>`. Add an instance switch (Pre-IPO / testnet), since each backend has its own pause state and token.
- **Pause / Resume** → `POST /api/admin/pause` / `resume`. The current state is visible to everyone on the basket page.
- **Rebalance now** → `POST /api/admin/rebalance` `{ "force": true }`; also a **Dry run** button with `{ "force": true, "dryRun": true }`. Show the returned legs/skipped/warnings.
- **Flatten** → `POST /api/admin/flatten` (409 unless paused). Confirm dialog.

### 1.5 Testnet vault: panel on `/` and page at `/testnet`
Everything here reads from `VITE_TESTNET_API_URL`.

**Panel on the hero page** (a compact card):
| Field | Data | Notes |
|---|---|---|
| Title | — | "Same engine, live on a Strike vault (testnet)" |
| Vault | `GET /api/basket` → `vault.id`, `vault.url` | Short ID + "View on Strike ↗" (`vault.url`, opens testnet.strikefinance.org) |
| Share price · equity | `GET /api/state` → `sharePrice`, `equity`, `depositors` | Real vault numbers from Strike |
| Last executed rebalance | `GET /api/rebalances?limit=20` → first run with `mode === "live"` and `status` in `done`/`partial` | Time, trigger, "2/2 legs filled" |
| Order IDs | `GET /api/rebalances/:id` → `legs[].strikeOrderId` | Show 1–2 IDs inline, copyable. **This is the judge's proof.** |
| Links | — | "Open rebalance →" (`/testnet/rebalances/:id`) · "Full testnet view →" (`/testnet`) |

If there's no live run yet, show "Vault connected, waiting for first rebalance" with the vault link. Don't hide the panel.

**`/testnet` page:** the same components as the hero page (1.1), pointed at the testnet instance, with the TESTNET badge. Skip "Coming soon". Keep "Deposit on Strike" (`vault.url`): on testnet it's a real deposit flow, and the demo shows *deposit on Strike → engine allocates*.

**`/testnet/rebalances/:id`:** the rebalance detail page (1.2) against the testnet instance. Here `strikeOrderId` values are real Strike order IDs: label them "Strike order ID", unlike the "simulated" `paper-N` IDs.

**Wording:** the panel says the testnet basket is BTC/ETH because testnet lists only crypto, and the hero runs on mainnet prices with paper fills. One line, no apology: "Testnet lists only crypto, so the live-vault proof runs on BTC/ETH."

### 1.6 Personal mode: `/connect` and `/me` (testnet instance)
Full backend contract: [PERSONAL-MODE.md](PERSONAL-MODE.md). The user keeps money in their own Strike account; we rebalance the basket there and earn a builder fee. **This is the main "use it yourself" path**, so link it from the hero page as **"Run this basket in your own Strike account →"**. All calls go to `VITE_TESTNET_API_URL`. Hide the entry point if `GET /api/personal/baskets` returns 404 (personal mode off).

**`/connect`: three steps on one page**
1. **Pick.** `GET /api/personal/baskets`. Show available baskets (on testnet: Crypto Majors). Show unavailable ones greyed out with `reason` (e.g. "Pre-IPO: mainnet only"). Budget input, min `minBudgetUsd`. Below it, the fee in plain words: "We charge 0.10% per trade (Strike Builder Code). No fee on deposits or profits."
2. **Connect wallet.** **MetaMask / Ethereum only for the hackathon** (`eth_requestAccounts`). Phantom and Lace are "coming soon": the backend supports them, but each needs its own signing code.
3. **Sign.** `POST /api/personal/connect/request {address, chain: "ethereum", basketId, budgetUsd}` → show `messageToSign` → `personal_sign(messageToSign, address)` → `POST /api/personal/connect/confirm {connectId, signature}` → store `token` in `localStorage` → go to `/me`.
   - Copy next to the sign button: "This is a signature, not a transaction. No gas, no funds move. It lets Strike Baskets trade, never withdraw, in your Strike account."
   - On 410 (expired after 5 min), restart from step 3 silently. On 400, show `error` (e.g. a bad signature or budget).
   - If the user has no Strike testnet balance, the first run shows the warning `ACCOUNT_EQUITY_BELOW_BUDGET_…`. Show "Fund your Strike account ↗" (testnet.strikefinance.org).

**`/me`: "My basket"** (`Authorization: Bearer <token>`; poll `GET /api/me` every 15 s, as there's no SSE for private data)
| Block | Data |
|---|---|
| Header | `user.address` (short), chain, basket name, budget, status chip (active/paused) |
| Weights vs targets | `state.weights`, same table component as the hero |
| Drift meter, gates, warnings | `state.maxDriftBps`, `state.gates`, `state.warnings` |
| My rebalances | `GET /api/me/rebalances` → detail `GET /api/me/rebalances/:id` (Strike order IDs are real: label "Strike order ID") |
| Controls | Edit budget (`PUT /api/me`), Pause/Resume, Rebalance now (`POST /api/me/rebalance {force:true}`), Flatten (only when paused, confirm dialog), **Disconnect** (`DELETE /api/me`; show the returned `note`, clear the token) |
| Empty state | `state === null`: "Connected. First check runs within a few seconds." |
| 401 | Token gone or revoked: clear it and send the user to `/connect` |

**Wording:** "your Strike account", "you can pause or disconnect any time", "we can trade, never withdraw". Not "deposit with us".

## 2. Live updates
`GET /api/stream` is Server-Sent Events. Use `new EventSource(url)` and listen per event name:

| event | payload | UI action |
|---|---|---|
| `snapshot` | full snapshot (`equity`, `sharePrice`, `plan.rows`, `gates`) | Replace weights/gates; append chart point |
| `run.planned` / `run.gated` | `{runId, status, trigger, legs}` | Prepend to the log |
| `run.executing` | `{runId, trigger, legs}` | Show "Rebalancing…" banner |
| `leg.updated` | `{clientOrderId, status, strike_order_id, ...}` | Update the detail page if open |
| `run.finished` | `{runId, status, legs}` | Clear the banner, refresh the log |
| `paused` / `resumed` | `{by}` | Toggle the paused state |
| `error` | `{runId, error}` | Small toast; status strip turns amber |

Each message's `data` is `{id, ts, type, payload}`. Fall back to polling `/api/state` every 15 s if SSE drops.

## 3. API reference (shapes)

```ts
GET /api/health → { ok, env, mode: "shadow"|"live", source: "vault"|"paper", paused, lastTickAt, nextTickAt, cycleSeconds, lastError }

GET /api/basket → {
  id, version, name, tagline, env, mode, source,
  constituents: { symbol, name, weight }[],
  vault: { id: string|null, url: string|null },
  rules: { grossExposure, driftThresholdBps, marginMode, symbolLeverage, maxLegNotionalUsd, maxRunNotionalUsd, cooldownMin, cycleSeconds,
           gates: { maxSpreadBps, maxMarkMidDeviationBps, maxBookAgeSec } }
}

GET /api/baskets → { id, name, tagline, status: "live"|"coming_soon", constituents }[]

GET /api/state → {
  ts, source, equity, costs: {fees, funding}|null, sharePrice|null, totalShares|null, depositors|null, bookNotional,
  maxDriftBps, driftThresholdBps, pendingTrigger: null|"initial"|"drift"|"stray"|"force", paused, warnings: string[],
  weights: { symbol, inBasket, targetWeight, currentWeight, driftBps, mark, currentQty, currentNotional, targetQty, targetNotional }[],
  gates: { symbol, ok, spreadBps, markMidDeviationBps, bookAgeSec, failures: string[], warnings: string[] }[]
}   // 503 until the first cycle completes

GET /api/snapshots?since=<ms>&limit=<n> → { ts, equity, share_price, total_shares, depositors, max_drift_bps }[]

GET /api/rebalances?limit=50&all=false → RunSummary[]   // all=true includes no-action checks
RunSummary = { id, createdAt, finishedAt, env, mode: "live"|"paper"|"shadow", basketId, basketVersion, trigger, status, equity, maxDriftBps, legCount, error }
status ∈ noop | paused | gated | cooldown | busy | nothing_tradable | shadow | executing | done | partial | failed

GET /api/rebalances/:id → RunSummary & {
  plan: { equity, bookNotional, rows, maxDriftBps, trigger, legs, skipped: {symbol, deltaQty, deltaNotional, reason}[], warnings },
  gates,
  legs: { idx, symbol, side, qty, notionalEst, mark, reduceOnly, method, clientOrderId, strikeOrderId, twapId, status, filledQty, avgPrice, error, updatedAt }[]
}

GET /api/events?limit=100 → { id, ts, type, payload }[]
```

Status colours: `done` green · `partial` amber · `failed`/`gated` red · `shadow` blue · `paused`/`cooldown`/`busy`/`nothing_tradable` grey.

## 4. Copy rules (judges will check these)
- "Basket vault", never "fund" or "index fund".
- "The first themed, rules-based basket vault on Strike", not "the first vault".
- No performance claims. Allowed: "here's the vault, here are the rebalances, here's the code."
- Show the leverage rule plainly: "Positions ≤ 0.9× equity. No leverage."
- Deposits and withdrawals happen on Strike; we link out.

## 5. Running against the backend locally
```bash
cd backend && pnpm install

# Hero instance: Pre-IPO on mainnet prices, paper fills (no keys needed) → :8787
STRIKE_ENV=mainnet BASKET_ID=preipo SHADOW_EQUITY_USD=5000 DB_PATH=data/mainnet-paper.db \
PORT=8787 ADMIN_TOKEN=<16+ chars> pnpm dev

# Testnet instance → :8788. Until the testnet vault exists, leave STRIKE_VAULT_ID empty:
# it then runs as testnet paper, which is enough to build the panel against.
STRIKE_ENV=testnet BASKET_ID=crypto-majors MAX_SPREAD_BPS=300 DB_PATH=data/testnet.db \
PORT=8788 ADMIN_TOKEN=<16+ chars> pnpm dev
```
The testnet instance switches to the real vault later (keys + `STRIKE_VAULT_ID` + `EXECUTION_MODE=live`) with no frontend change. Until then its runs have `mode: "paper"`; the panel's "last executed rebalance" filter (`mode === "live"`) will correctly show "waiting for first rebalance".