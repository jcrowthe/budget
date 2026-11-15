#!/usr/bin/env bash
# Helpers for scripts/deploy.sh. Never prints a value of an environment variable.
# With DEPLOY_DRY_RUN=1, mutating calls print "DRY: ..." and return a fake success; GETs return empty results.

CF_API="https://api.cloudflare.com/client/v4"
export CF_API

die() { echo "ERROR: $*" >&2; exit 1; }
say() { echo "==> $*"; }
is_dry() { [ "${DEPLOY_DRY_RUN:-}" = "1" ]; }

# need VAR...: names every missing variable, then exits 2.
need() {
  local missing=0 v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      echo "Missing required environment variable: $v" >&2
      missing=1
    fi
  done
  [ "$missing" = 0 ] || exit 2
}

# cf_api METHOD PATH [JSON]: prints the response; fails with the API's error messages if .success is not true.
# The token goes through a curl config on a pipe, never argv. The body goes through stdin.
cf_api() {
  local method="$1" path="$2" body="${3:-}" out
  if is_dry; then
    if [ "$method" = GET ]; then
      echo '{"success":true,"result":[]}'
    else
      echo "DRY: $method ${path//$CLOUDFLARE_ACCOUNT_ID/<account>}" >&2
      echo '{"success":true,"result":{}}'
    fi
    return 0
  fi
  if [ -n "$body" ]; then
    out=$(curl -sS -X "$method" "$CF_API$path" \
      -K <(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN") \
      -H "Content-Type: application/json" --data-binary @- <<<"$body") || { echo "curl failed: $method ${path//$CLOUDFLARE_ACCOUNT_ID/<account>}" >&2; return 1; }
  else
    out=$(curl -sS -X "$method" "$CF_API$path" \
      -K <(printf 'header = "Authorization: Bearer %s"\n' "$CLOUDFLARE_API_TOKEN")) || { echo "curl failed: $method ${path//$CLOUDFLARE_ACCOUNT_ID/<account>}" >&2; return 1; }
  fi
  if [ "$(jq -r '.success // false' <<<"$out" 2>/dev/null)" != "true" ]; then
    echo "Cloudflare API $method ${path//$CLOUDFLARE_ACCOUNT_ID/<account>} failed: $(jq -r '[.errors[]?.message] | join("; ")' <<<"$out" 2>/dev/null)" >&2
    return 1
  fi
  printf '%s' "$out"
}

# req_id VALUE WHAT: VALUE, or a placeholder in a dry run, or a fatal error.
req_id() {
  if [ -n "$1" ]; then printf '%s' "$1"; elif is_dry; then printf 'dry-run-id'; else die "$2 not found"; fi
}

run_wrangler() { pnpm --filter @budget/worker exec wrangler "$@"; }

# wr_mut SUBCOMMAND...: a mutating wrangler call (dry run prints only the subcommand).
wr_mut() {
  if is_dry; then echo "DRY: wrangler $1 $2"; return 0; fi
  run_wrangler "$@"
}
