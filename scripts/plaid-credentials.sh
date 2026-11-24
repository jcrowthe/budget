#!/usr/bin/env bash
# Pushes the Plaid credentials from the environment to the clone (encrypted there, write-only):
#   Sandbox    when PLAID_CLIENT_ID and PLAID_SANDBOX_SECRET are set
#   Production when PLAID_CLIENT_ID and PLAID_PRODUCTION_SECRET are set (live mode only)
# An environment whose variables are missing is skipped. Prints only
#   plaid credentials: sandbox set|skipped|failed, production set|skipped|failed
# Local mode (PLAID_CREDENTIALS_BASE_URL) pushes Sandbox only and prints "production skipped (local)";
# PLAID_CREDENTIALS_LOCAL_PRODUCTION set is refused (exit 2): a production secret never reaches a local server.
# Exit: 0 ok (skipped is fine), 1 an environment failed, 2 usage/configuration refused.
# Live mode needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (sent through a curl config on a pipe).
# Local testing: PLAID_CREDENTIALS_BASE_URL=http://127.0.0.1:<port> (pnpm dev signs requests itself);
# add PLAID_CREDENTIALS_LOCAL_JWT=1 for the e2e server.
# Never prints a value; the secret reaches curl on stdin (from jq reading the environment), never argv.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

fail() { echo "$1" >&2; exit "${2:-1}"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ -n "${PLAID_CREDENTIALS_BASE_URL:-}" ]; then
  [[ "$PLAID_CREDENTIALS_BASE_URL" =~ ^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$ ]] \
    || fail "ERROR: PLAID_CREDENTIALS_BASE_URL must be http://localhost[:port] or http://127.0.0.1[:port]" 2
  BASE="$PLAID_CREDENTIALS_BASE_URL"
  MODE=local
  [ -z "${PLAID_CREDENTIALS_LOCAL_PRODUCTION:-}" ] \
    || fail "ERROR: production credentials are never pushed to a local server (unset PLAID_CREDENTIALS_LOCAL_PRODUCTION)" 2
  if [ "${PLAID_CREDENTIALS_LOCAL_JWT:-}" = 1 ]; then
    node scripts/local-jwt.mjs --out "$tmp/jwt" >/dev/null || fail "ERROR: cannot sign a local token (run node scripts/dev-vars.mjs)"
  fi
else
  [ -z "${PLAID_CREDENTIALS_LOCAL_JWT:-}" ] || fail "ERROR: PLAID_CREDENTIALS_LOCAL_JWT is only valid with PLAID_CREDENTIALS_BASE_URL" 2
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

# push ENVIRONMENT: prints set|skipped|failed. The body is built by jq from the environment on a pipe.
push() {
  local e="$1" var
  if [ "$MODE" = local ] && [ "$e" = production ]; then echo "skipped (local)"; return 0; fi
  case "$e" in sandbox) var=PLAID_SANDBOX_SECRET ;; production) var=PLAID_PRODUCTION_SECRET ;; esac
  if [ -z "${PLAID_CLIENT_ID:-}" ] || [ -z "${!var:-}" ]; then echo skipped; return 0; fi
  local code
  code=$(PLAID_ENV="$e" PLAID_SECRET_VALUE="${!var}" jq -n '{environment: $ENV.PLAID_ENV, client_id: $ENV.PLAID_CLIENT_ID, secret: $ENV.PLAID_SECRET_VALUE}' \
    | curl -sS --max-time 30 -o "$tmp/body" -w '%{http_code}' -X PUT -K <(auth_config) -H 'Content-Type: application/json' -H 'Accept: application/json' --data-binary @- "$BASE/api/v1/plaid/credentials" 2>/dev/null) || code=000
  if [ "$code" = 200 ]; then echo set; else echo failed; fi
}

sandbox=$(push sandbox)
production=$(push production)
echo "plaid credentials: sandbox $sandbox, production $production"
[ "$sandbox" != failed ] && [ "$production" != failed ]
