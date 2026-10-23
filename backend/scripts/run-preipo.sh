#!/bin/sh
# Pre-IPO basket on live mainnet prices, simulated fills (no keys needed). Port 8787.
# Runs `pnpm start`; set WATCH=yes for the reloading dev watcher.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
# Admin token: set ADMIN_TOKEN, or one is created once in data/admin-token.txt and reused.
[ -n "$ADMIN_TOKEN" ] || { [ -f data/admin-token.txt ] || openssl rand -hex 24 > data/admin-token.txt; ADMIN_TOKEN="$(cat data/admin-token.txt)"; }
STRIKE_ENV=mainnet BASKET_ID=preipo SHADOW_EQUITY_USD=5000 CYCLE_SECONDS="${CYCLE_SECONDS:-60}" \
DB_PATH=data/mainnet-paper.db PORT=8787 ADMIN_TOKEN="$ADMIN_TOKEN" \
exec pnpm "$([ "$WATCH" = yes ] && echo dev || echo start)"
