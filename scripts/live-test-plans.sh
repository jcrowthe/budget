#!/usr/bin/env bash
# Manage test plans (names starting with live.test_prefix) on the live clone, and nothing else.
#   list                 <id><TAB><name> for every prefixed plan
#   create '<name>'      creates a plan, prints its id (name must start with the prefix)
#   delete <id>          re-reads the plan, deletes it only if prefixed; prints "deleted <id>"
#   purge                deletes every prefixed plan (max 50); prints "deleted <n> remaining <m>"
# Exit: 0 ok, 1 runtime/HTTP error or plans left, 2 usage refused, 3 target refused.
# Live mode needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET. Local testing:
#   LIVE_TEST_PLANS_BASE_URL=http://127.0.0.1:<port> (pnpm dev signs requests itself);
#   add LIVE_TEST_PLANS_LOCAL_JWT=1 for the e2e (vite preview) server.
# Never prints a secret, or the name of a plan without the prefix.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "usage: live-test-plans.sh list | create '<name>' | delete <id> | purge" >&2; exit 2; }
fail() { echo "$1" >&2; exit "${2:-1}"; }

PREFIX=$(jq -r '.live.test_prefix // empty' clone.profile.json)
[ -n "$PREFIX" ] || fail "ERROR: live.test_prefix missing in clone.profile.json"

CMD="${1:-}"
UUID_RE='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
case "$CMD" in
  list | purge) [ $# -eq 1 ] || usage ;;
  create)
    [ $# -eq 2 ] || usage
    [[ "$2" == "$PREFIX"* ]] || fail "REFUSED: the name must start with $PREFIX" 2
    ;;
  delete)
    [ $# -eq 2 ] || usage
    [[ "$2" =~ $UUID_RE ]] || fail "ERROR: delete needs a plan id (uuid)" 2
    ;;
  *) usage ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -n "${LIVE_TEST_PLANS_BASE_URL:-}" ]; then
  [[ "$LIVE_TEST_PLANS_BASE_URL" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]] \
    || fail "ERROR: LIVE_TEST_PLANS_BASE_URL must be http://localhost[:port] or http://127.0.0.1[:port]" 2
  BASE="$LIVE_TEST_PLANS_BASE_URL"
  MODE=local
  if [ "${LIVE_TEST_PLANS_LOCAL_JWT:-}" = 1 ]; then
    node scripts/local-jwt.mjs --out "$tmp/jwt" >/dev/null || fail "ERROR: cannot sign a local token (run node scripts/dev-vars.mjs)"
  fi
else
  [ -z "${LIVE_TEST_PLANS_LOCAL_JWT:-}" ] || fail "ERROR: LIVE_TEST_PLANS_LOCAL_JWT is only valid with LIVE_TEST_PLANS_BASE_URL" 2
  BASE=$(jq -r '.live.url // empty' clone.profile.json)
  [ -n "$BASE" ] || fail "ERROR: live.url missing in clone.profile.json"
  missing=0
  for v in CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET; do
    if [ -z "${!v:-}" ]; then echo "Missing required environment variable: $v" >&2; missing=1; fi
  done
  [ "$missing" = 0 ] || exit 2
  MODE=live
fi

auth_config() {
  if [ "$MODE" = live ]; then
    printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET"
  elif [ -f "$tmp/jwt" ]; then
    printf 'header = "Cf-Access-Jwt-Assertion: %s"\n' "$(cat "$tmp/jwt")"
  fi
}

# api METHOD PATH [BODY]: sets STATUS; the body is in $tmp/body (never printed).
# The credentials go through a curl config on a pipe, built per request, never argv.
api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sS --max-time 30 -o "$tmp/body" -w '%{http_code}' -X "$method" -H 'Accept: application/json')
  if [ -n "$body" ]; then
    STATUS=$(curl "${args[@]}" -K <(auth_config) -H 'Content-Type: application/json' --data-binary @- "$BASE$path" <<<"$body") || fail "ERROR: cannot reach the clone"
  else
    STATUS=$(curl "${args[@]}" -K <(auth_config) "$BASE$path") || fail "ERROR: cannot reach the clone"
  fi
}
expect() { # expect METHOD PATH STATUS...
  local method="$1" path="$2" s
  shift 2
  for s in "$@"; do [ "$STATUS" = "$s" ] && return 0; done
  fail "ERROR: $method $path answered $STATUS"
}

list_ids() { # prints the ids of prefixed plans
  api GET /api/v1/budgets
  expect GET /api/v1/budgets 200
  jq -r --arg p "$PREFIX" '.data.budgets[] | select(.name | startswith($p)) | .id' "$tmp/body"
}

case "$CMD" in
  list)
    api GET /api/v1/budgets
    expect GET /api/v1/budgets 200
    jq -r --arg p "$PREFIX" '.data.budgets[] | select(.name | startswith($p)) | [.id, .name] | @tsv' "$tmp/body"
    ;;
  create)
    api POST /api/v1/budgets "$(jq -nc --arg n "$2" '{name: $n}')"
    expect POST /api/v1/budgets 201
    jq -er '.data.budget.id // empty' "$tmp/body" || fail "ERROR: create answered without a plan id"
    ;;
  delete)
    id="$2"
    api GET "/api/v1/budgets/$id"
    [ "$STATUS" != 404 ] || fail "ERROR: no plan $id"
    expect GET "/api/v1/budgets/$id" 200
    jq -e --arg p "$PREFIX" '.data.budget.name | startswith($p)' "$tmp/body" >/dev/null \
      || fail "REFUSED: plan $id is not a test plan" 3
    api DELETE "/api/v1/budgets/$id"
    expect DELETE "/api/v1/budgets/$id" 200
    echo "deleted $id"
    ;;
  purge)
    ids=$(list_ids)
    k=$(printf '%s' "$ids" | grep -c . || true)
    [ "$k" -le 50 ] || fail "REFUSED: $k test plans match (limit 50); nothing deleted" 3
    n=0
    for id in $ids; do
      api GET "/api/v1/budgets/$id"
      [ "$STATUS" != 404 ] && expect GET "/api/v1/budgets/$id" 200 || continue
      jq -e --arg p "$PREFIX" '.data.budget.name | startswith($p)' "$tmp/body" >/dev/null || continue
      api DELETE "/api/v1/budgets/$id"
      expect DELETE "/api/v1/budgets/$id" 200
      n=$((n + 1))
    done
    left=$(list_ids) # its own step: a failed re-list must stop the script, not read as "0 remaining"
    m=$(printf '%s' "$left" | grep -c . || true)
    echo "deleted $n remaining $m"
    [ "$m" -eq 0 ]
    ;;
esac
