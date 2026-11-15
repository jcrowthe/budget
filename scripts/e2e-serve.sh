#!/usr/bin/env bash
# Builds the production bundle and serves it with `vite preview` on :4173 with a fresh local D1.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .e2e-state
node scripts/dev-vars.mjs
bash scripts/db-migrate-local.sh "$PWD/.e2e-state"
export BUDGET_STATE_DIR="$PWD/.e2e-state"
pnpm --filter @budget/web exec vite build
exec pnpm --filter @budget/web exec vite preview --port 4173 --strictPort
