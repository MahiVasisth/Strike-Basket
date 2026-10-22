# Strike Baskets

**One deposit, a whole theme.** Strike Baskets is a themed, rules-based basket vault on [Strike Finance](https://strikefinance.org). You deposit once into a Strike user vault. Our bot holds every market in the theme at published weights and keeps them on target. The live basket is **Pre-IPO: SpaceX, Zhipu, Unitree and MiniMax**, markets that exist only on Strike.

- Fixed, published weights. No discretion, no leverage (positions ≤ 0.9× equity).
- Money stays in Strike's vault. The bot holds a trade-only API key and cannot withdraw.
- **Or run it in your own Strike account**: connect a wallet (Strike Builder Connect), pick a budget, and the same engine keeps the basket on target there. You can pause or disconnect any time; the key trades but can't withdraw.
- Every rebalance is logged with its order IDs: Strike order IDs on the testnet vault, `paper-N` IDs for simulated fills.

> Built for the Strike Hackathon (21–23 Oct 2026). Planning happened before the window; all code was written during it.

## Proof
| | |
|---|---|
| Testnet vault (live orders) | _TODO: vault ID, run IDs, order IDs_ |
| Pre-IPO basket on mainnet prices (paper) | _TODO: running since, run IDs of rebalances_ |

The Pre-IPO basket runs on live mainnet prices with simulated fills (bid/ask, Strike's 0.05% taker fee, live funding): we didn't put real money in for the hackathon. Its orders go through the same executor that trades our testnet vault; only the venue differs. Vault orders on the pre-IPO markets themselves are untested until a mainnet vault is funded.

## How it works
```
 Strike market data ──┐
 Strike vault state ──┼─► gates ─► rebalancer (pure) ─► executor ─► Strike orders (vault_id)
   (positions, equity)│    spread, mark-vs-book,          batch / TWAP, idempotent client IDs,
                      │    book age                        reconcile by client_order_id
                      └─────────────────────────────► snapshots, runs, legs ─► API + SSE ─► web app
```
Every cycle (default 5 min):
1. Read the vault's equity and positions from Strike, the source of truth.
2. Check market quality for each constituent. Off-hours stock and pre-IPO books are the main live risk.
3. Compute target positions. If any weight is ≥ 5 pts off target (or the vault holds something outside the basket), plan the trades. Legs below Strike's minimum order size are skipped with a reason.
4. Send the plan as one batch of vault orders, reductions first. Confirm each leg by `client_order_id`.
5. Record the run and stream it to the page.

The bot never re-sends an order. It replans from Strike's actual positions on the next cycle, so a crash or timeout can't double-trade.

## Strike integration
| Strike capability | Where |
|---|---|
| API wallet auth (Ed25519) | [backend/src/strike/sign.ts](backend/src/strike/sign.ts) |
| Vault leader orders, batch orders, `vault_id` | [backend/src/engine/executor.ts](backend/src/engine/executor.ts), [backend/src/strike/client.ts](backend/src/strike/client.ts) |
| TWAP (`/v2/algo/twap`) for large legs | [executor.ts](backend/src/engine/executor.ts) |
| Leverage and margin mode per symbol | `Executor.ensureSymbolSettings` |
| Public vault data (share price, equity, positions) | [backend/src/engine/engine.ts](backend/src/engine/engine.ts) |
| Market data (exchangeInfo filters, mark, book ticker) | [client.ts](backend/src/strike/client.ts), [backend/src/core/gates.ts](backend/src/core/gates.ts) |
| Stock and pre-IPO perps | [backend/baskets/](backend/baskets/) |
| Builder Codes: Builder Connect (wallet-signature onboarding) + `X-Builder-Fee-Bps` | [backend/src/personal/manager.ts](backend/src/personal/manager.ts), [client.ts](backend/src/strike/client.ts) |

## Safety rules
| Rule | Default |
|---|---|
| Gross exposure | 0.9× equity (config refuses > 1) |
| Margin | cross, 2x setting per symbol |
| Max per leg / per run | $2,000 / $5,000 |
| Drift threshold | 5 pts; cooldown 30 min between drift rebalances |
| Market gates | spread ≤ 50 bps, mark within 100 bps of book mid, book ≤ 60 s old |
| Pause switch | `POST /api/admin/pause`; state shown publicly |
| Flatten | `POST /api/admin/flatten` (only while paused) |
| Mainnet writes | blocked inside the HTTP client unless `ALLOW_MAINNET_WRITES=yes` (unset: mainnet is read-only) |

## Run it
```bash
cd backend
pnpm install
cp .env.example .env         # paper mode on testnet data works with no keys
pnpm test                    # rebalancer, gates, signing, engine
pnpm plan --basket preipo --env mainnet --equity 500   # plan only, live mainnet prices
pnpm probe                   # go/no-go checks (see docs/PLAN.md)
pnpm dev                     # engine + API on :8787
```

## Business model
Two revenue lines, both native to Strike: the **vault leader commission** (0–50%, default 10%, on profitable withdrawals only) and the **builder fee** on personal-mode fills (we charge 0.10%; Strike allows up to 1%). First milestone: $50k in basket vaults → about $500/yr at 10% commission on a 10% gain. Next: more themes, then baskets from other strategists running on the same engine.

## What we don't claim
No performance claims: the vault is days old. It's a basket vault of perpetual futures, not an index fund. Strike already has user vaults; this is the first **themed, rules-based basket** vault.

## Docs
- [docs/HANDOFF.md](docs/HANDOFF.md): **start here.** Current state, decisions, next steps
- [docs/PLAN.md](docs/PLAN.md): runbook, go/no-go, decisions
- [docs/reference/](docs/reference/): source docs (brief, idea doc, fit and decision reports, event rules)
- [docs/FRONTEND.md](docs/FRONTEND.md): web app requirements and API contract
- [docs/PERSONAL-MODE.md](docs/PERSONAL-MODE.md): personal mode (Builder Connect)
- [docs/STRIKE-API-NOTES.md](docs/STRIKE-API-NOTES.md): verified API facts
