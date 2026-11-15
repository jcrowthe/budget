#!/usr/bin/env bash
# Applies migrations to the local D1 in <absolute stateDir>. The plugin and wrangler resolve relative
# paths differently, so the path must be absolute.
set -euo pipefail
state="${1:?usage: db-migrate-local.sh <absolute stateDir>}"
case "$state" in /*) ;; *) echo "stateDir must be an absolute path" >&2; exit 2 ;; esac
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mkdir -p "$state"
pnpm --filter @budget/worker exec wrangler d1 migrations apply budget-db --local \
  -c "$root/apps/worker/wrangler.jsonc" --persist-to "$state"
