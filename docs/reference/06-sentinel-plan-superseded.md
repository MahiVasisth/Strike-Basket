# Strike Sentinel: Protocol Context

> **AI-run, risk-bounded trading vaults on Strike Finance.**
> Deposit into a vault managed by an AI agent with hard risk limits. Every decision, risk check and order is visible live, and every trade brings volume to Strike.

**Event:** Strike Hackathon (first edition): build 21 Oct 10:00 EST → submit 23 Oct 10:00 EST; winners announced 26 Oct.
**Team:** 3 full-stack developers, about 10 hours a day each for 2 days (~60 hours).
**Status:** design. Nothing may be built before 21 Oct; this document is the plan.
**Decisions (2026-10-19):** name "Strike Sentinel" confirmed. **Personal Agent mode through Builder Connect is in scope (MVP).**
**Self-contained:** every external fact this project depends on is copied into §10, so it can be read without access to outside links.

---

## 1. Why this project fits this event
| What Strike asks for | How Sentinel answers it |
|---|---|
| "your project must build on top of Strike in some meaningful way" | Strike *is* the execution venue, account system and vault product. Without Strike there is nothing to trade. |
| Example categories: Automation ("trading bots, automated strategies… execution systems") and Social ("trader discovery") | An automated strategy that runs a public vault people can follow and deposit into |
| Criteria: Innovation, Integration, Utility, Technical Execution, Future Potential | See §11 for the mapping per criterion |
| Strike's own investments: Vault Leader API, Builder Codes, AI-agent skills (Claude Code / Codex / Cursor skills and a Hermes Agent skill) | Uses all three: the agent trades through the Vault Leader API, users connect through Builder Codes, and the build uses Strike's agent skills |
| "direct investment from Strike and our partners" | Built-in revenue: the vault leader commission plus builder fees (§9) |

**Not duplicating:** Strike Copilot (copy trading), Hizz (perps dashboard), Bolt (copy-trading memecoin). Sentinel is a *strategy executor with enforced risk limits*, not a copier or a dashboard.

---

## 2. Problem
1. **Perps are hard to trade well.** Most retail traders lose money to leverage, missing stops and emotional decisions.
2. **AI trading bots are black boxes.** Users can't see why a bot traded or what stops it from losing everything.
3. **Strike vaults need good leaders.** Vaults let anyone deposit into a strategy, but depositors need trust: a visible track record, reasoning and risk controls.

## 3. Solution
A vault on Strike run by an **AI strategist** whose every proposal must pass a **deterministic risk engine** before it reaches Strike:

```
market data ─► AI strategist (proposes) ─► Risk engine (enforces, in code) ─► Strike order with TP/SL
                     │                              │                               │
                     └──────────── decision log (reasoning + checks + order id) ◄───┘ ─► public live feed
```

- **The AI suggests; the code decides.** The model never sends an order directly, and every rule is enforced outside it.
- **Every trade has a stop:** orders are placed as Strike bracket (TP/SL) strategy orders.
- **Kill switch:** if drawdown passes a limit, the agent pauses itself and closes risk.
- **Transparency:** a public page shows each decision with its reasoning, the result of each risk check, the Strike order ID, and the vault's PnL and share price.

## 4. Users
| User | What they do | Why they care |
|---|---|---|
| **Depositor** | Browses the Sentinel vault page, sees the live decision log and track record, deposits USDC into the Strike vault | Hands-off strategy with visible, enforced risk |
| **Active trader (Personal Agent mode)** | Connects a wallet through Builder Codes and lets the agent manage *their own* Strike account with their chosen limits | Same agent, own account, own risk settings |
| **Strike** | Gets volume, vault TVL, and a showcase for agents trading on Strike | Matches its builder and agent strategy |

---

## 5. Scope
### MVP (must ship by the deadline)
1. **Strike client:** Ed25519 request signing; orders, bracket orders, leverage, positions, balances; market and user WebSocket streams; works on **testnet and mainnet** by config.
2. **One strategy on one market** (BTC-USD): trend and momentum signals plus funding-rate awareness (§7.3).
3. **AI strategist:** turns market features into a structured trade proposal and explanation (JSON schema, §7.4).
4. **Risk engine:** deterministic checks (§7.5), plus a kill switch and a circuit breaker.
5. **Execution engine:** bracket orders tagged with `vault_id`, idempotent `client_order_id`, reconciliation against the user stream.
6. **Decision log:** a durable record of every cycle (proposal, checks, result, order ID).
7. **Public web app:**
   - vault overview: equity, share price, PnL chart, open position;
   - live decision feed;
   - risk settings (read-only);
   - "How it works";
   - deposit button (links to the Strike vault page).
8. **Personal Agent mode through Builder Connect:** the user signs once with an Ethereum, Solana or Cardano wallet, receives a trade-only API wallet linked to our builder code, chooses limits within the risk engine's caps, and the agent trades their own account with `X-Builder-Fee-Bps`. They can pause or revoke at any time.
9. **Run the agent on testnet for as long as possible before the deadline** to build a real track record.

### Stretch (only if everything above is done)
- Telegram or Discord alerts for each decision and for kill-switch events.

### Out of scope (cut list)
- More than one market or strategy.
- Custom Cardano or EVM smart contracts (not needed; Strike provides custody, vaults and settlement).
- Backtesting UI, model fine-tuning, a token of our own.
- Mobile app.

---

## 6. Architecture

```
┌──────────────────────────── Sentinel backend (Node.js / TypeScript) ─────────────────────────────┐
│                                                                                                    │
│  MarketFeed (WS: markprice, kline_1h/5m, depth/bookTicker, funding)                                │
│        │                                                                                           │
│        ▼                                                                                           │
│  FeatureBuilder ── indicators (EMA, ATR, RSI, returns), funding, spread, OI                        │
│        │                                                                                           │
│        ▼                                                                                           │
│  Strategist (LLM, structured output) ──► Proposal {action, side, size_pct, sl, tp, rationale}       │
│        │                                                                                           │
│        ▼                                                                                           │
│  RiskEngine (pure functions) ──► Approved order │ Rejected (reasons) │ Clamped (adjusted size)       │
│        │                                                                                           │
│        ▼                                                                                           │
│  Executor ── StrikeClient (signed REST: /v2/order/strategy, /v2/leverage, /v2/order/cancel…)        │
│        │                         ▲                                                                 │
│        ▼                         │                                                                 │
│  Reconciler ◄── UserStream (WS userstream + vault_id: orders, fills, positions, balances)          │
│        │                                                                                           │
│        ▼                                                                                           │
│  DecisionLog (SQLite/Postgres) ── Guardian (drawdown, staleness, error rate → kill switch)          │
│        │                                                                                           │
│        ▼                                                                                           │
│  Public API (REST + SSE/WS) ───────────────────────────────────────────────────────────────────────┼──► Web app (React/Vite)
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components
| Component | Responsibility | Owner |
|---|---|---|
| `strike-client` | Signing (§10.2), REST wrappers, retries with a fresh nonce, testnet/mainnet config, WS clients with reconnect | Dev A |
| `market-feed` / `feature-builder` | Subscribe to market streams; keep a candle buffer; compute features each cycle | Dev B |
| `strategist` | Prompt plus JSON-schema output; timeout and fallback to `HOLD` | Dev B |
| `risk-engine` | Pure, unit-tested rule functions (§7.5) | Dev A |
| `executor` / `reconciler` | Place bracket orders with `vault_id`; confirm through the user stream; repair drift | Dev A |
| `guardian` | Kill switch, circuit breaker, heartbeat | Dev A |
| `decision-log` + public API | Persist cycles; serve the feed and stats | Dev B |
| `web` | Vault page, live feed, PnL chart, risk panel, Builder Connect + personal-mode settings | Dev C |

---

## 7. Technical design

### 7.1 Decision cycle (every 5 minutes, plus on significant events)
```
1. snapshot   = MarketFeed.latest(BTC-USD)            // mark, candles, funding, spread
2. state      = Strike: positions/balances/openOrders (?vault_id=…)  // source of truth
3. if Guardian.halted → log(SKIP, reason); return
4. features   = FeatureBuilder(snapshot, state)
5. proposal   = Strategist(features, state)            // LLM, ≤ 20 s, JSON-schema validated; failure → HOLD
6. verdict    = RiskEngine(proposal, state, limits)    // APPROVE | CLAMP | REJECT + reasons[]
7. if verdict ∈ {APPROVE, CLAMP}:
       Executor.place(bracketOrder(verdict.order), client_order_id = cycleId)
       await Reconciler.confirm(client_order_id, timeout 30 s)
8. DecisionLog.write({cycleId, ts, features, proposal, verdict, orderIds, fills, equity})
9. Public API emits the cycle to the live feed
```

### 7.2 State and idempotency
- **Strike is the source of truth** for positions and balances. The local store is a cache plus the decision log.
- `client_order_id = sentinel-{cycleId}` makes retries safe. Before re-sending, check `GET /v2/order` by client ID.
- At startup the Reconciler loads open orders and positions and rebuilds local state before the first cycle.

### 7.3 Strategy v1 (simple and explainable on purpose)
- **Market:** BTC-USD. **Timeframes:** 1h for trend, 5m for entry timing.
- **Features:**
  - EMA(20/50) on 1h, for trend;
  - RSI(14) on 5m;
  - ATR(14) on 1h, for stop distance;
  - the current hourly funding rate;
  - spread and top-of-book depth;
  - the current position.
- **Baseline rule** (gives the LLM a sane anchor and a deterministic fallback):
  - long bias if EMA20 > EMA50; short bias otherwise;
  - avoid entries when funding strongly opposes the side;
  - stop at 1.5×ATR; take-profit at 2.5×ATR.
- **The LLM's role:** choose between `OPEN_LONG / OPEN_SHORT / CLOSE / HOLD / ADJUST_STOP`, size within limits, and explain in plain language. It can't exceed limits; the risk engine clamps or rejects.
- **Honesty:** the demo shows a short testnet track record, not proof of profitability.

### 7.4 Strategist output contract
```json
{
  "action": "OPEN_LONG | OPEN_SHORT | CLOSE | HOLD | ADJUST_STOP",
  "size_pct_equity": 0.0,
  "leverage": 1,
  "stop_loss_price": 0,
  "take_profit_price": 0,
  "confidence": 0.0,
  "rationale": "≤ 400 chars, plain language",
  "signals_used": ["ema_trend", "funding", "rsi"]
}
```
Validated with a JSON schema. Anything invalid, late or missing becomes `HOLD` with reason `STRATEGIST_FAILURE`.

### 7.5 Risk engine (deterministic, unit-tested)
| Rule | Default | On violation |
|---|---|---|
| Max leverage | 3× | Clamp |
| Max position notional | 30% of equity × leverage | Clamp |
| Max risk per trade (entry→stop × size) | 1% of equity | Clamp size |
| Stop-loss required, on the correct side, ≥ 0.5×ATR away | always | Reject |
| TP/SL reward:risk | ≥ 1.2 | Reject |
| Max open positions | 1 | Reject |
| Cooldown after a stopped-out trade | 30 min | Reject |
| Daily loss limit | 3% of start-of-day equity | Halt for the day |
| Max drawdown from peak (kill switch) | 8% | Close all, cancel all, pause |
| Stale market data | > 30 s | Skip cycle |
| Funding opposing the side | > configured threshold | Reject entry |
| Estimated liquidation price | ≥ 3×ATR beyond the stop | Reject |
| Order rate | ≤ 6 per hour | Reject |

Liquidation price and margin use Strike's formulas (calculations skill and reference app math).

### 7.6 Guardian (safety)
- **Kill switch:** `cancel-all` + reduce-only close + pause. It fires on max drawdown, a manual admin command, or error rate above N in 10 minutes.
- **Circuit breaker:** 3 consecutive execution errors → stop placing orders and alert.
- **Heartbeat:** the public page shows "agent alive / last cycle"; a stale heartbeat shows a warning.
- **Startup:** the agent won't trade until reconciliation succeeds.

### 7.7 Failure handling
| Failure | Handling |
|---|---|
| HTTP 5xx / timeout | Retry ×3 with a new nonce and timestamp; same `client_order_id` |
| Signature or timestamp rejected | Resync with `GET` server time; re-sign |
| Order rejected (margin, price, size) | Log the reason; no retry with the same parameters; feed it back to the strategist next cycle |
| WebSocket disconnect | Exponential reconnect; REST snapshot before resuming; skip cycles while stale |
| LLM error or invalid JSON | `HOLD` |
| Partial fill | Reconciler resizes the TP/SL to the filled size |

### 7.8 Security
- **API wallet keys:**
  - Strike API wallets **can trade but cannot withdraw**, so a leaked key can't drain funds.
  - Keys are kept in server env/secret storage only; never in the repo or the frontend.
- **Personal mode:** per-user API wallet secrets encrypted at rest (AES-GCM with a server key); users can revoke at any time; limits are set by the user and enforced by the risk engine.
- **Prompt injection:** the strategist sees only numeric features and our own text. No user or web content enters the prompt.
- **Admin:** the kill switch and pause sit behind an admin token; actions are logged.
- **Repo hygiene:** `.env.example` only; secret scanning before submission.

### 7.9 Data model
```
cycles(id, ts, market, features_json, proposal_json, verdict, reasons_json, created_at)
orders(id, cycle_id, client_order_id, strike_order_id, side, size, price, sl, tp, status, raw_json)
fills(id, order_id, strike_fill_id, price, size, fee, ts)
equity_snapshots(ts, equity, share_price, unrealized_pnl, drawdown_pct)
guardian_events(ts, type, detail_json)
users(id, address, chain, api_pubkey, api_secret_enc, limits_json, status)   -- Personal mode
cycles/orders/fills also carry account_scope = 'vault' | user_id
```

### 7.10 Public API (our backend)
| Method | Path | Returns |
|---|---|---|
| GET | `/api/vault` | Vault ID, equity, share price, depositors, PnL, drawdown (from Strike + cache) |
| GET | `/api/decisions?limit=50` | Recent cycles with proposal, verdict, reasons, order IDs |
| GET | `/api/stream` | SSE live feed of cycles and guardian events |
| GET | `/api/risk` | Active limits and current utilisation |
| GET | `/api/health` | Heartbeat, last cycle, feed staleness |
| POST | `/api/admin/kill` | Kill switch (admin token) |
| POST | `/api/connect/request` · `/api/connect/confirm` | Builder Connect (challenge → user signature → store encrypted API wallet) |
| PUT | `/api/me/limits` · POST `/api/me/pause` · DELETE `/api/me` | Personal mode: set limits, pause, revoke |

### 7.11 Stack
- **Backend:** Node.js 20 + TypeScript, `@noble/ed25519` (or tweetnacl) for signing, `ws`, Zod for schemas, SQLite (Postgres optional), Fastify.
- **AI:** one LLM with structured output; temperature 0.
- **Frontend:** React + Vite + Tailwind; lightweight-charts for PnL; reuses the auth and math modules from Strike's builder reference app (credited in the README).
- **Dev tooling:** `npx strike-finance-skills install` gives our coding agents Strike's official API skills.
- **Deploy:** backend on a small VPS or Fly.io (must run continuously for the track record); frontend on Vercel.

### 7.12 Repo layout
```
/apps/agent      # cycle loop, strategist, risk, executor, guardian
/apps/api        # public REST + SSE
/apps/web        # React app
/packages/strike-client   # signing, REST, WS (testnet/mainnet)
/packages/risk            # pure rules + tests
/docs            # architecture, Strike file map, risk policy
```

---

## 8. Strike integration map (what judges should see)
| Strike capability | Where we use it | Why it matters |
|---|---|---|
| API wallet auth (Ed25519) | `packages/strike-client/sign.ts` | All trading and account calls |
| Vault Leader (`vault_id` on orders, data and WS) | `apps/agent/executor.ts`, `reconciler.ts` | The agent trades the **vault's** account |
| Bracket strategy orders (`/v2/order/strategy`) | `executor.ts` | Every entry has an exchange-side TP/SL |
| Leverage / margin mode | `executor.ts` | Enforced from the risk engine |
| Cancel-all / reduce-only | `guardian.ts` | Kill switch |
| Market WebSocket (markprice, kline, depth/bookTicker) | `market-feed.ts` | Features and staleness checks |
| User stream WebSocket with `vault_id` | `reconciler.ts` | Fills, positions, balances |
| Funding rates | `feature-builder.ts` | Strategy filter |
| Vault public data (`/v2/vault/{id}`, `/portfolio`) | `apps/api/vault.ts` | Public stats |
| Builder Codes / Builder Connect | `apps/web/connect`, `apps/api/connect` | Personal mode + builder fee revenue |
| Strike agent skills | Development | Uses Strike's own tooling |

The README will contain this table with file links, plus testnet order IDs and the vault ID.

---

## 9. Business model and future potential
- **Vault mode → leader commission:** Strike user vaults allow 0–50% of depositor profits (default 10%), charged only on profitable withdrawals.
- **Personal mode → builder fees:** up to 1% (100 bps) on fills from users running the agent on their own account (builder fees apply only to Builder Connect accounts, not vault-leader orders).
- **Growth path:**
  1. one strategy, one vault;
  2. several risk profiles (conservative, balanced);
  3. a strategy marketplace, where third-party strategies run under the same risk engine;
  4. alerts and social sharing of decisions.
- **Why Strike benefits:** more volume, vault TVL, and a public showcase of safe agent trading on Strike.

---

## 10. External facts this design depends on (copied from Strike docs, 2026-10-19)
### 10.1 Environments (from the docs' OpenAPI servers and WS pages; checked live 2026-10-19)
| | Mainnet | Testnet |
|---|---|---|
| REST (trading, account, vaults) | `https://api.strikefinance.org` | `https://api-v2-testnet.strikefinance.org` |
| Market data REST | `https://api.strikefinance.org/price` | `https://api-v2-testnet.strikefinance.org/price` |
| Stats REST | `https://api.strikefinance.org/stat` | `https://api-v2-testnet.strikefinance.org/stat` |
| Market WS | `wss://api.strikefinance.org/ws/price` | `wss://api-v2-testnet.strikefinance.org/ws/price` |
| User WS | `wss://api-v2.strikefinance.org/ws/user-api` | `wss://api-v2-testnet.strikefinance.org/ws/user-api` |
| L3 WS | `wss://api.strikefinance.org/ws/l3` | `wss://api-v2-testnet.strikefinance.org/ws/l3` |

- User streams require authentication, **except vault streams** (per the user WS docs).
- **Rate limits** (live `GET /price/v2/exchangeInfo`, same on both networks): `REQUEST_WEIGHT` 2,400 per minute and `ORDERS` 1,200 per minute. Sentinel uses far less.
- **Markets:** testnet has ADA-USD, SOL-USD, **BTC-USD**, ETH-USD. Mainnet has 31, including BTC/ETH/SOL and stocks/commodities (XAU, SP500, NAS100, TSLA, NVDA…).
- **Vaults:** mainnet lists **4 public vaults** (3 user and 1 protocol, SLP), so there is little competition for depositor capital. Testnet lists **47 user vaults**, which means **user vaults can be created on testnet**.

### 10.2 Authentication
- Ed25519 API wallet. Public key: 64 hex chars (raw). Private key: 64 or 128 hex chars.
- Headers: `X-API-Wallet-Public-Key`, `X-API-Wallet-Signature`, `X-API-Wallet-Timestamp` (seconds), `X-API-Wallet-Nonce` (UUID v4).
- Signed message: `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}`, where PATH includes the query string and BODY_HASH is SHA-256 of the exact JSON body (the hash of an empty string for GET). Serialize the body once and send exactly what you signed.
- API wallets **can trade but cannot withdraw**.

### 10.3 Vaults
- Leader trading uses the same API key. Add `vault_id` to the body of `/v2/order`, `/v2/orders/batch`, `/v2/order/cancel`, `/v2/order/cancel-all`, `/v2/order/replace`, `/v2/order/replace-batch`, `/v2/order/strategy`, `/v2/leverage`, `/v2/marginMode` and `/v2/isoMargin`.
- Data: add `?vault_id=` to `/v2/account`, `/v2/balances`, `/v2/portfolio`, `/v2/positions`, `/v2/closedPositions`, `/v2/openOrders`, `/v2/order`, `/v2/trades` and `/v2/history/*`.
- WS: `{"method":"subscribe","channel":"userstream","vault_id":"…","id":1}`.
- Find the vault: `GET /v2/vaults?leader_account_id=…`. Public: `/v2/vault/{id}`, `/v2/vault/{id}/portfolio`, `/v2/vault/{id}/depositors`, `/v2/vault/{id}/history`.
- User vaults:
  - 100 USDC creation fee; leader commission default 10% (0–50%);
  - the leader must keep ≥ 5% of shares;
  - one active user vault per user; minimum deposit default $100;
  - withdrawal lockup default 1 day; share price = equity / shares, starting at $1.00.
  - States: Active / Paused.
- **The docs list no vault-creation or vault-deposit endpoint;** these appear to be done in the Strike app.

### 10.4 Orders and trading
- Create, batch, cancel, cancel-all, replace, replace-batch, strategy (bracket TP/SL) orders, TWAP, grid.
- Order fields seen: `symbol`, `side`, `type`, `size`, `price`, `client_order_id`, `reduce_only`, `time_in_force`, `slippage`, `take_profit`, `take_profit_limit`, `tp_order`, `sl_order`.
- Leverage, margin mode (cross/isolated), isolated margin adjustment.

### 10.5 Funding
- Paid every hour on the hour (UTC); rates are on an 8-hour basis, with 1/8 applied each hour.
- Positive funding: longs pay shorts; negative: shorts pay longs. No platform fee.

### 10.6 Builder Codes (Personal mode)
- Register for a builder code; fee share up to 100 bps.
- Builder Connect: `POST /auth/builder/request-signature` with `{address, chain: ethereum|solana|cardano, code, fee_share_bps, public_key}` returns `message_to_sign`. The user signs, and Strike returns builder-linked API wallet credentials.
- Orders carry the `X-Builder-Fee-Bps` header.
- Deposit flow: quote → build-tx → confirm. Withdraw: quote → sign → confirm.

---

## 11. Mapping to the judging criteria
| Criterion | Evidence we will show |
|---|---|
| Innovation and Creativity | An AI vault leader whose reasoning is public and whose limits are enforced in code. Explainable, bounded autonomy, new on Strike. |
| Integration With Strike | Eight or more Strike capabilities that each do real work (§8): vault trading, bracket orders, user/market WS, funding, vault data, Builder Codes |
| Utility and Impact | Depositors get a transparent, risk-capped strategy; Strike gets volume and TVL; Personal mode brings new users through Builder Connect |
| Technical Execution | Signed client, idempotent execution, reconciliation, kill switch, unit-tested risk engine, hours of live testnet cycles |
| Future Potential | Leader commission plus builder fees; roadmap to multi-strategy and a marketplace |

---

## 12. Demo plan (video 3–4 minutes)
1. **0:00–0:20:** problem: black-box bots and retail losses on perps.
2. **0:20–0:45:** Sentinel in one line, with the architecture diagram.
3. **0:45–2:15:** live:
   - the vault page and its decision feed (hours of cycles);
   - one cycle in detail: features → AI proposal → risk checks (one CLAMP and one REJECT shown) → bracket order → Strike order ID visible in Strike;
4. **2:15–2:45:** kill switch: trigger it on testnet; the agent cancels, closes and pauses.
5. **2:45–3:15:** Personal mode: connect a wallet with Builder Connect, choose limits, watch the agent's first decision on that account.
6. **3:15–3:45:** business model and what's next.

---

## 13. Timeline (48 hours, 3 developers)
| When | Dev A: engine | Dev B: agent and data | Dev C: frontend |
|---|---|---|---|
| Before 21 Oct (planning only) | Read the docs, create testnet accounts and API wallets, request testnet funds | Write strategy and prompt specs | Run the builder reference app locally; UI wireframes |
| Day 1 AM | Signing + REST client + server-time sync | Market WS + feature builder | App shell, vault page with mock data |
| Day 1 PM | Bracket orders with `vault_id`, user stream, reconciler | Strategist + JSON schema + decision log | Live feed (SSE), PnL chart |
| Day 1 night | Risk engine + tests; **start the agent on testnet** | Public API | Hook to the real API; Builder Connect flow against testnet |
| Day 2 AM | Guardian / kill switch, failure handling; per-user agent loop for Personal mode | Strategy tuning while the agent runs | Personal-mode settings (limits, pause, revoke) |
| Day 2 PM | README + Strike file map + order IDs | Video script + recording | Deploy; final check against the requirements |
| 23 Oct before 10:00 EST | Submit | | |

---

## 14. Open questions
**Answered from the docs and the live API (2026-10-19):**
- ✅ **Testnet vaults:** creatable (47 user vaults exist on testnet), and BTC-USD trades on testnet.
- ✅ **WS URLs:** see the §10.1 table. The reference app's `v2.strikefinance.org` URLs aren't used.
- ✅ **Rate limits:** 2,400 request weight per minute and 1,200 orders per minute. Not a constraint.
- ✅ **Builder fee on vault orders:** most likely **no**. The docs say `X-Builder-Fee-Bps` "must be <= the user's approved `fee_share_bps` from onboarding", so it only applies to accounts onboarded through Builder Connect. **Revenue model:** vault mode earns the leader commission (on profits); Personal mode earns builder fees. *(Inference from the docs; confirm with one testnet order if convenient.)*

**Still open (not in the docs):**
1. **Testnet USDC:** how to fund a testnet account. There's no faucet in the docs. Check the testnet app, or ask in Discord.
2. **Submission form and judges:** Strike says "coming soon".

## 15. Claims rules (for README and pitch)
- Say "testnet track record of N cycles / M trades", never "profitable" unless it is, and then state the period.
- Say "the AI proposes, deterministic code enforces limits".
- Credit Strike's builder reference app and agent skills where they are reused.
- Planning happened before 21 Oct; all code is written in the hackathon window. Say so.
