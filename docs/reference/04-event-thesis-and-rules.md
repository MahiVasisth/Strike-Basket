# Phase 0 (M0 Event Thesis): Strike Hackathon (Strike Finance)

**Run date:** 2026-10-19   **Stage:** ideation (build starts Wed 21 Oct)   **Team:** TBD (user is a blockchain engineer)   **Mode:** normal
**Source:** Strike Finance Medium post (pasted by the user). Protocol background comes from a web search (DeFiLlama, CoinGecko and Cardano listings, snapshot figures only).

## Context Sheet
```
Strike Hackathon — host Strike Finance (perpetuals protocol; "full support for all major Cardano, Ethereum, and Solana
  wallets and all major stablecoins"; "The open source derivatives protocol that Cardano deserves")
Build window: Wed 21 Oct 10:00 EST → Fri 23 Oct 10:00 EST (48 hours). Winners Mon 26 Oct.
Prizes: 6,000 STRIKE total — 1st 3,000 / 2nd 2,000 / 3rd 1,000 (post title says "$3,000 in Prizes" → ~$0.50/STRIKE, will float)
  + "Successful projects might even have the opportunity to get a direct investment from Strike and our partners."
Tracks: none. Examples (not categories): Trading tools; Automation (bots, strategies, market-making, execution);
  Social trading (copy trading, leaderboards, trader discovery); Data & analytics; New applications
Rule (verbatim): "your project must build on top of Strike in some meaningful way" — "use, integrate with, or extend
  Strike's infrastructure, functionality, token, or ecosystem"
Deliverables: working prototype/MVP; documentation incl. "how it interacts with Strike"; video or live demo; GitHub repo
Originality: "original work developed or substantially advanced during the hackathon. Existing projects may participate
  if they introduce meaningful new functionality."
Judging (5, unweighted): Innovation & Creativity; Integration With Strike; Utility & Impact; Technical Execution; Future Potential
Judges: "will be announced soon". Submission form: "Coming Soon". Dev resources: "provided through Strike's official channels"
Existing ecosystem projects named: Bolt (memecoin that copy-trades and buys STRIKE); Strike Copilot (global copy
  trading); Hizz (perps dashboard and activity tracker)
Protocol size (snapshots, unverified): TVL ~$15m; ~$27.5m 30-day perp volume; ~31 pairs
```

## 1. Money
- **A small prize, paid in the host's own token.** 6,000 STRIKE, worth about $3k at the post's implied price. The value will move with STRIKE.
- **The real upside is "direct investment from Strike and our partners".** That's a signal that **future potential** and **attracting users or volume** matter.
- **No reserved slots or bonuses.** There are three places.

## 2. Host's own words
- **Named:** "infrastructure for the next generation of trading", "a behemoth of traders and builders", "improve trading", "attract users", and **"token"** listed among the things you can integrate.
- **The three projects the host showcased** all bring traders or volume, or create demand for STRIKE:
  - Bolt: copy-trading, and it buys STRIKE;
  - Copilot: copy trading;
  - Hizz: a dashboard and activity tracker.
- **Missing:** privacy, ZK, new smart contracts, cross-chain. Your ZK/FHE edge isn't asked for.

### Tagline nouns turned into checks
| Phrase | Check |
|---|---|
| "traders" | Does it bring traders to Strike or keep them there? |
| "builders" / "infrastructure" | Does it make Strike easier to build on (SDK, API, bot framework)? |
| "token" | Does it create a reason to hold, use or buy STRIKE? (optional, but valued) |

## 3. Sponsor weight
Strike is the only sponsor and the only judge. "Integration With Strike" is one of the 5 criteria and a hard eligibility rule. The integration must do real work: placing trades, reading positions, or making a strategy run. A dashboard that just links to Strike won't count.

## 4. Competitive format
- **48 hours,** first edition, small community (the Medium account has 38 followers). The field will probably be small, mostly Strike community members and Cardano builders.
- **Existing ecosystem projects can enter** with new features. Copilot and Hizz may compete in copy trading and dashboards, so **don't duplicate them**.
- **Planning before the window is fine;** building should happen in the window. Use the 2 days before Oct 21 to read docs and settle the plan.

## 5. Previous editions
None. This is the "first-ever Strike Hackathon". Confidence: **medium**.

## 6. Thesis
```
EVENT THESIS (confidence: medium — first edition, judges unknown, dev resources not yet published)
Money: 3 places in STRIKE (~$3k) + possible direct investment
Host language: traders, trading infrastructure, builders, token; examples = tools/automation/social/data
Sponsor weight: Strike only; "meaningful" integration is a gate
Format: 48h; small first-edition field; existing ecosystem projects may enter
Past editions: none; host's showcased projects = copy trading ×2 + perps dashboard, one buys STRIKE
→ "Strike rewards tools that bring traders and volume to Strike perps (automation, copy/social trading, analytics),
   ideally with a reason to hold STRIKE, that could grow into an ecosystem product."
```

### What each axis needs for a 2 (score ideas against this in Phase 1)
| Axis | 2 means |
|---|---|
| Sector match | Trading automation, social trading or analytics that drives volume on Strike |
| Lane advantage | Not duplicating Copilot, Hizz or Bolt; a gap the host hasn't seen |
| Format fit | Buildable in 48 hours on Strike's API, with no new Cardano contracts needed |
| Sponsor weight | Places or manages real trades on Strike, or reads live Strike data; optionally uses STRIKE |
| Post-event credibility | Could attract real traders and plausibly earn investment |

## 7. Your angle
- **Plays to your strengths:** automation and agents. For example, an AI-agent trading assistant for Strike, or agents that sell signals and are paid per call, like your x402 work. Execution and risk tooling (stop/TP managers, funding-rate monitors) also fits.
- **Avoid:** writing Plutus/Aiken contracts in 48 hours (new stack), and plain copy-trading or dashboards (already exist).
- **Gaps to explore:**
  - strategy automation such as funding-rate and basis bots;
  - a risk or liquidation-alert bot (Telegram or Discord);
  - "trade from chat" (Telegram/Discord bot);
  - a trader leaderboard with vaults that pay STRIKE rewards;
  - an agent-readable Strike data API.

## Developer surface (verified 2026-10-19 from docs.strikefinance.org and github.com/strike-finance)
- **Full REST and WebSocket API** (`https://api.strikefinance.org`), with a **testnet** at `https://api-v2-testnet.strikefinance.org`. It covers:
  - market data (order book, trades, klines, open interest, funding)
  - user account, positions and history
  - trading: orders, batch, TP/SL brackets, TWAP, grid, leverage/margin
  - vaults, copy trading (public discovery and stats), leaderboard and platform stats, L3 data
- **Authentication:** an Ed25519 "API wallet" that **can trade but cannot withdraw**. No Cardano contract work is needed.
- **Builder Codes:** a dApp onboards users through wallet sign-in (**Ethereum, Solana or Cardano**) and earns up to **1% (100 bps)** on its users' fills (`X-Builder-Fee-Bps` header). Reference app: `strike-builder-reference` (React + TypeScript), which covers connect, deposit, withdraw, orders and WebSocket.
- **Vault Leader API:** run a vault's trading with the same API key plus `vault_id`. A natural fit for algorithmic or agent strategies with depositors.
- **Strike already ships AI-agent tooling:**
  - `strike-finance-skills` (`npx strike-finance-skills install`) for Claude Code, Codex, Cursor and others;
  - an official **Hermes Agent skill** for market data, trading and copy-trading via the leaderboard.
  - The repos also include a fork of **hummingbot** and an Android app.
- **Signal:** Strike is investing in (1) **builders who bring users and earn builder fees** and (2) **AI agents trading on Strike**. Both are cheap to integrate in 48 hours. A project that combines them, such as an agent product onboarded through builder codes, aims straight at the host's own roadmap.

**Updated thesis:** "Strike rewards products that bring traders and volume to Strike through its API, especially AI-agent or automated trading and builder-code front ends, that could become a lasting ecosystem business (builder fees, vaults)." Confidence: medium-high.

**Format fit is now strong:** TypeScript plus a REST API plus the testnet, so 48 hours is realistic for a solid MVP.

## Gate resolved
The API exists, trading is programmatic, and there is a testnet. **Still to check on Oct 21:** whether a testnet API wallet and test funds are easy to get, and the API rate limits and any bot rules.

## Context still needed from the user
2. Any developer resources posted in Discord (API, SDK, testnet, rate limits, ToS on bots).
3. Team: solo or with teammates, and their skills; your hours available Oct 21–23.
4. Links to Bolt, Strike Copilot and Hizz, so we can avoid overlapping with them.
5. The judges, once announced.
