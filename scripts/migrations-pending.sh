#!/usr/bin/env bash
# Read-only: prints the D1 migrations (file names, one per line) not yet applied to the remote budget-db.
# Prints nothing when none are pending. When budget-db does not exist yet, every local migration is pending.
# Exit 0 on a clear answer, 1 when it cannot tell (message on stderr), 2 when a variable is missing.
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Never prints a value of either.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=lib/cf.sh
. scripts/lib/cf.sh
unset DEPLOY_DRY_RUN # read-only script: never use cf_api's fake answers
need CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
for tool in jq curl; do command -v "$tool" >/dev/null || die "$tool is required"; done

dir=$(jq -r '.paths.migrations.dir' clone.profile.json)
local_list=$(find "$dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | LC_ALL=C sort)
[ -n "$local_list" ] || exit 0

list=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database?name=budget-db&per_page=100") \
  || { echo "ERROR: cannot list D1 databases" >&2; exit 1; }
db_id=$(jq -r '[.result[]? | select(.name == "budget-db") | .uuid][0] // empty' <<<"$list")
if [ -z "$db_id" ]; then
  printf '%s\n' "$local_list"
  exit 0
fi

err=$(mktemp)
trap 'rm -f "$err"' EXIT
if out=$(cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$db_id/query" \
  '{"sql":"SELECT name FROM d1_migrations ORDER BY id"}' 2>"$err"); then
  applied=$(jq -r '.result[0].results[]?.name' <<<"$out")
elif grep -q 'no such table' "$err"; then
  applied=""
else
  cat "$err" >&2
  echo "ERROR: cannot read applied migrations of budget-db" >&2
  exit 1
fi

while IFS= read -r name; do
  printf '%s\n' "$applied" | grep -Fxq -- "$name" || printf '%s\n' "$name"
done <<<"$local_list"
exit 0
