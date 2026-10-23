#!/bin/sh
# Testnet engine with personal mode (Builder Connect). Port 8788.
# Runs `pnpm start`; set WATCH=yes for the reloading dev watcher.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
# The personal-mode secret is created once and reused: changing it disconnects every user.
[ -f data/personal-secret.txt ] || openssl rand -hex 32 > data/personal-secret.txt
# Admin token: set ADMIN_TOKEN, or one is created once in data/admin-token.txt and reused.
[ -n "$ADMIN_TOKEN" ] || { [ -f data/admin-token.txt ] || openssl rand -hex 24 > data/admin-token.txt; ADMIN_TOKEN="$(cat data/admin-token.txt)"; }
STRIKE_ENV=testnet BASKET_ID=crypto-majors MAX_SPREAD_BPS=300 CYCLE_SECONDS="${CYCLE_SECONDS:-60}" \
PERSONAL_MODE=yes BUILDER_CODE=StrikeBasket BUILDER_FEE_BPS=10 PERSONAL_SECRET="$(cat data/personal-secret.txt)" \
DB_PATH=data/testnet.db PORT=8788 ADMIN_TOKEN="$ADMIN_TOKEN" \
exec pnpm "$([ "$WATCH" = yes ] && echo dev || echo start)"
