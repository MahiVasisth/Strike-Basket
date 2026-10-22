# Personal mode (Builder Connect)

**What:** a user keeps their money in **their own Strike account**, connects their wallet once, picks a basket and a budget, and our engine keeps that basket on target inside their account. We earn a **builder fee** on each fill through Strike's Builder Codes.

| | Vault mode | Personal mode |
|---|---|---|
| Where the money is | Our Strike vault (pooled) | The user's own Strike account |
| Deposit step | Deposit into the vault on Strike | None. Trades from the user's existing balance |
| Exit | Withdraw after the 1-day lockup | Pause or revoke at any time; positions stay theirs |
| Our revenue | Leader commission on profits (0–50%) | Builder fee per fill (`BUILDER_FEE_BPS`, default 10 = 0.10%; Strike max 100) |
| Strike feature shown | Vaults, vault-leader API | **Builder Codes / Builder Connect** |

## Flow
1. **Choose.** `GET /api/personal/baskets` lists baskets whose markets exist on this network, with the minimum budget at which every leg clears Strike's minimum order (testnet Crypto Majors: **$267**). Budgets are capped at `PERSONAL_MAX_BUDGET_USD` ($5k).
2. **Request.** `POST /api/personal/connect/request {address, chain, basketId, budgetUsd}`. The backend generates an Ed25519 key pair and calls Strike `POST /auth/builder/request-signature {address, chain, code, fee_share_bps, public_key}`, then returns `{connectId, messageToSign, expiresAt, feeBps}`. The challenge expires in 5 min.
3. **Sign.** The user signs `messageToSign` in their wallet. It's a message signature: no transaction, no gas, no funds move.
   - Ethereum: EIP-191 `personal_sign` (hex)
   - Solana: Ed25519 over the message bytes (base58)
   - Cardano: CIP-30 `signData` → `"{coseSign1Hex}:{coseKeyHex}"`
4. **Confirm.** `POST /api/personal/connect/confirm {connectId, signature}`. The backend calls Strike `verify-signature`. Strike creates the account if needed, approves our builder code, revokes older API wallets for this builder, and links **our generated public key** as the account's API wallet. We check that the linked key is ours, store the private key **AES-256-GCM encrypted**, and return a **session token** (stored server-side only as a SHA-256 hash).
5. **Run.** The same `BasketEngine` + `Executor` as the vault, on the user's account:
   - size = **min(budget, account equity) × 0.9**, split by basket weights
   - **only basket markets are managed**: other positions are filtered out before planning, never closed
   - orders carry `X-Builder-Fee-Bps`; no `vault_id`
   - same market gates, caps, cooldown and reconcile-by-client-ID
   - the first allocation starts right after confirm, then every `CYCLE_SECONDS`
6. **Control** (Bearer session token): view, change budget or basket, pause/resume, rebalance now, flatten (only while paused), revoke.

## API
```ts
GET  /api/personal/baskets → { builderFeeBps, baskets: { id, name, available, minBudgetUsd|null, reason? }[] }
POST /api/personal/connect/request { address, chain: "ethereum"|"solana"|"cardano", basketId, budgetUsd }
     → { connectId, messageToSign, expiresAt, feeBps }
POST /api/personal/connect/confirm { connectId, signature } → { token, user }

// Authorization: Bearer <token>
GET    /api/me → {
  user: { address, chain, accountId, basketId, budgetUsd, builderFeeBps, status: "active"|"paused", connectedAt },
  health: { lastTickAt, lastError, cycleSeconds },
  state: null | { ts, basketEquity, bookNotional, maxDriftBps, driftThresholdBps, pendingTrigger, weights, gates, warnings }
}
PUT    /api/me { basketId?, budgetUsd? }      → user   (switching basket needs pause + flatten first: 409)
POST   /api/me/pause | /api/me/resume         → user
POST   /api/me/rebalance { force?, dryRun? }  → { runId, status, trigger, legs, skipped, warnings }
POST   /api/me/flatten                         → { runId, status, legs }   (409 unless paused)
DELETE /api/me                                 → { revoked: true, note }
GET    /api/me/rebalances?limit=               → RunSummary[]   (same shape as the public log)
GET    /api/me/rebalances/:id                  → run detail with legs and Strike order IDs
```
Errors are `{ error }` with 400 (validation, or Strike rejected the signature/builder code), 401 (no or invalid token), 403 (mainnet write lock), 409 (state conflict), 410 (connect expired: start again).

## What the user signs (Strike's text, verbatim from testnet)
```
Connect to Strike via builder "StrikeBasket".
This authorizes the builder to collect up to 0.1% fee on your trades.
Referral attribution: none.
By signing, you are entrusting your API wallet private key to this builder. You trust the builder to store and use this key responsibly.
Wallet: 0x… / Chain: ethereum / API Key: … / Nonce: … / Timestamp: …
```
Show it unchanged on `/connect`; it's what the user's wallet will display.

## Safety and privacy
- **No withdrawals.** Strike's docs: a builder can't withdraw or redirect funds without the user's wallet signature. Our key trades only.
- **Keys encrypted at rest** under `PERSONAL_SECRET`. Lose that secret and every user must reconnect.
- **Private.** Personal runs are stored under the user's ID. They never appear in `/api/rebalances`, `/api/events` or `/api/stream`, and the public run-detail route 404s them.
- **Revoke** stops the engine and deletes our encrypted key. Positions stay in the user's account; they can also remove the API wallet in Strike's settings.
- **Reconnect** with the same wallet replaces the old connection (Strike revokes the old API wallet itself).
- **Testnet only** for now: Builder Connect is a POST, so the mainnet write lock refuses it (403).

## Configuration
```
PERSONAL_MODE=yes
BUILDER_CODE=StrikeBasket       # registered on testnet, max fee 100 bps
BUILDER_FEE_BPS=10              # must be ≤ the fee share configured on the builder code
PERSONAL_SECRET=<openssl rand -hex 32>
PERSONAL_MAX_USERS=50
PERSONAL_MAX_BUDGET_USD=5000
```
Run it on the **testnet instance** (`:8788`), next to the testnet vault or testnet paper engine.

## Verified / not yet verified
| | Status |
|---|---|
| Builder Connect endpoints exist on testnet | ✅ fake code → `{"error":"builder code not found"}` |
| Request field is `fee_share_bps` (skill package says `max_fee_bps`) | ✅ from docs.strikefinance.org |
| Full flow, signing, fee header, basket-only management, privacy, revoke | ✅ end-to-end tests against a fake Strike (`test/personal.test.ts`) |
| A real wallet connect on testnet | ✅ 22 Oct: builder code `StrikeBasket`, throwaway EVM wallet → Strike verified the EIP-191 signature, linked our key, and authenticated calls work (`pnpm connect-test`) |
| A real trade in a connected account | ⏳ needs a connected wallet with testnet funds |
| Builder fee actually credited on testnet fills | ⏳ check the builder dashboard after the first real run |

## Limits (say these plainly)
- Testnet only, so the usable basket is Crypto Majors (BTC/ETH). Pre-IPO personal mode arrives with mainnet.
- The engine assumes it owns the basket markets in the user's account. If the user trades BTC/ETH by hand, the next cycle rebalances it back.
- Deposits into the user's Strike account happen on Strike (we link out). Builder deposit endpoints exist (quote → build-tx → confirm) but are out of scope for the hackathon.
