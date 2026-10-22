#!/bin/sh
# Pre-IPO basket on live mainnet prices, simulated fills (no keys needed). Port 8787.
cd "$(dirname "$0")/.." || exit 1
mkdir -p data
STRIKE_ENV=mainnet BASKET_ID=preipo SHADOW_EQUITY_USD=5000 CYCLE_SECONDS="${CYCLE_SECONDS:-60}" \
DB_PATH=data/mainnet-paper.db PORT=8787 ADMIN_TOKEN="${ADMIN_TOKEN:-mytesttoken12345}" \
exec pnpm dev
