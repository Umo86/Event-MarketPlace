#!/usr/bin/env bash
# Starts Event MarketPlace for browser tests on a fresh, seeded local database.
#   scripts/e2e-server.sh                      (against the production build: run `npm run build` first)
#   E2E_MODE=dev scripts/e2e-server.sh         (development server)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${E2E_PORT:-3200}"
export PGLITE_DIR=".data/pglite-e2e"
export LOCAL_STORAGE_DIR=".data/files-e2e"
export SEED_TOTP_SECRET="${E2E_TOTP_SECRET:-JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP}"
export SEED_PASSWORD="local demo password"
export APP_URL="http://localhost:$PORT"
rm -rf "$PGLITE_DIR" "$LOCAL_STORAGE_DIR"
npx tsx --conditions=react-server scripts/seed.ts > /dev/null
if [ "${E2E_MODE:-production}" = "dev" ]; then
  exec npx next dev -p "$PORT"
else
  # Vercel's functions can't require() ES modules, so neither can this server.
  export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--no-experimental-require-module"
  export MARKETPLACE_ALLOW_LOCAL_PRODUCTION=true
  exec npx next start -p "$PORT"
fi
