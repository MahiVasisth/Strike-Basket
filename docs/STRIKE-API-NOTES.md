# Strike API: verified notes (22 Oct 2026)

> We use mainnet **read-only** (no funds). All mainnet facts below come from public endpoints.

Checked against the live API and `strike-finance-skills@0.0.3`. **Where the live API and the skill docs disagree, the code follows the live API.**

## Environments
| | REST | Price REST | Market WS | User WS |
|---|---|---|---|---|
| mainnet | `https://api.strikefinance.org` | `…/price` | `wss://api.strikefinance.org/ws/price` | `wss://api.strikefinance.org/ws/user-api` |
| testnet | `https://api-v2-testnet.strikefinance.org` | `…/price` | `wss://api-v2-testnet.strikefinance.org/ws/price` | `wss://api-v2-testnet.strikefinance.org/ws/user-api` |

Server time: `GET /v2/time` → `{serverTime}` (REST base, not `/price`). Rate limits: 2,400 weight/min, 1,200 orders/min.

## Auth
- Headers `X-API-Wallet-Public-Key | -Signature | -Timestamp (s) | -Nonce (uuid v4)`.
- Message `METHOD:PATH:TIMESTAMP:NONCE:sha256hex(body)`; GET uses sha256 of `""`.
- Whether PATH includes the query string: assumed **yes** (`SIGN_PATH_WITH_QUERY`); `pnpm probe` verifies it.
- WS logon is different: `session.logon` signing `apiKey=<pub>&timestamp=<ms>`. Vault streams need no auth.

## Live shapes that differ from the docs
| Endpoint | Docs say | Live returns |
|---|---|---|
| `GET /price/v2/markPrice` (no symbol) | `{symbol, markPrice, indexPrice, time…}` | WS-style `[{e, E, s, p, i, r, T}]` |
| `GET /v2/positions?vault_id=` | `{Side, Size, EntryPrice…}` | `{symbol, size (signed), entry_price, margin_mode, leverage, upnl, accumulated_funding_fees, liquidation_price}` |
| Mark timestamp `E` | event time | Always ≈ now (server-stamped), so **useless for staleness** |
| `POST /v2/algo/twap` | no `vault_id` listed | unknown → `pnpm probe --twap` |
| `GET /v2/order` response | undocumented | parsed leniently (`status`/`X`, `order_id`, `filled_size`…) |

## Vaults
- Public: `GET /v2/vaults`, `/v2/vault/{id}`, `/v2/vault/{id}/portfolio`, `/history`, `/depositors`. Account, positions and history accept `?vault_id=` **without auth**.
- `/v2/vault/{id}` returns `share_price, equity, total_shares, depositors, leader_commission_bps, min_deposit, lockup_days, status`.
- **Vault accounts default to `isolated`, 10x** (`default_margin_mode`, `default_leverage`).
- Mainnet: 4 vaults (3 user + SLP). MARKET WIZARDS already trades stocks systematically, so say "first **themed basket** vault".
- No vault-creation or deposit endpoint: do these in the Strike app, and link out from ours.
- 100 USDC creation fee; leader keeps ≥ 5% of shares; one active user vault per account; 1-day lockup; min deposit $50–100.

## Market filters that matter
| Symbol | env | minNotional | step | note |
|---|---|---|---|---|
| SPCX-USD | main | **10** | 0.01 | sets the mainnet minimum leg |
| ZHIPU / UNITREE / MINIMAX | main | 5 | 0.01 | |
| CXMT-USD | main | 5 | 0.1 | backup Pre-IPO name |
| BTC-USD | **test** | **100** | 0.00001 | mainnet is 10 |
| ETH-USD | test | 10 | 0.001 | |
| SOL / ADA | test | 10 / 5 | | **books 17–26% off mark: unusable**, so they're excluded from the testnet basket |

Mainnet Pre-IPO books on 22 Oct: spreads 5–6 bps, mark within 1–6 bps of mid.
