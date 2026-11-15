#!/usr/bin/env bash
# Gate, then release. Prints the live URL and DEPLOY_SHA=<sha> on success.
# DEPLOY_DRY_RUN=1 runs every step without calling Cloudflare or running the gate (mutations print "DRY: ...").
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
ROOT="$PWD"
# shellcheck source=lib/cf.sh
. scripts/lib/cf.sh
# shellcheck source=lib/access.sh
. scripts/lib/access.sh

HOST="budget.doxen.dev"
ZONE_NAME="doxen.dev"

TMPFILES=()
WT=""
cleanup() {
  local f
  for f in "${TMPFILES[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done
  if [ -n "$WT" ] && [ -d "$WT" ]; then git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

# 0. Preconditions: nothing ships, and no gate runs, before every key is present.
need CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID CF_ACCESS_TEAM_DOMAIN ACCESS_ALLOWED_EMAIL \
  CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET SECRETS_ENCRYPTION_KEY
for tool in pnpm jq curl git; do command -v "$tool" >/dev/null || die "$tool is required"; done
export CLOUDFLARE_ACCOUNT_ID
DEPLOY_SHA=$(git rev-parse HEAD)
[ -z "$(git status --porcelain)" ] || echo "WARNING: the working tree is dirty; only the committed $DEPLOY_SHA is shipped." >&2

# Gate
say "Gate: pnpm check, then the local Playwright run"
if is_dry; then echo "DRY: gate"; else pnpm check && pnpm e2e; fi

# Build the committed sha in a separate worktree (the main HEAD is untouched).
say "Build $DEPLOY_SHA"
if is_dry; then
  echo "DRY: build"
  WTBUILD="$ROOT/apps/web/dist/budget/wrangler.json"
else
  WT=$(mktemp -d)
  git worktree add --detach "$WT" "$DEPLOY_SHA" >/dev/null
  (cd "$WT" && pnpm install --frozen-lockfile \
    && CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false pnpm --filter @budget/web exec vite build)
  WTBUILD="$WT/apps/web/dist/budget/wrangler.json"
  [ -f "$WTBUILD" ] || die "Build did not produce apps/web/dist/budget/wrangler.json"
fi
WORKDIR="${WT:-$ROOT}"

# 1. Release step 1 (the preconditions above) is done. Step 2: resources.
say "Resources: D1 budget-db, R2 budget-files"
DB_EXISTED=1
D1_ID=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database?name=budget-db&per_page=100" | jq -r '.result[]? | select(.name == "budget-db") | .uuid' | head -n1)
if [ -z "$D1_ID" ]; then
  DB_EXISTED=0
  D1_ID=$(cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" '{"name":"budget-db"}' | jq -r '.result.uuid // empty')
  D1_ID=$(req_id "$D1_ID" "D1 database budget-db")
fi
if ! cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets?per_page=100" | jq -e '[.result | (if type == "object" then .buckets else [] end)[]? | select(.name == "budget-files")] | length > 0' >/dev/null; then
  cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets" '{"name":"budget-files"}' >/dev/null
fi

# 3. Time Travel bookmark (only meaningful when the database already holds data).
say "D1 Time Travel bookmark"
if [ "$DB_EXISTED" = 1 ]; then
  BOOKMARK=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$D1_ID/time_travel/bookmark" | jq -r '.result.bookmark // empty')
  if [ -n "$BOOKMARK" ]; then
    echo "D1 bookmark before migrations: $BOOKMARK"
    echo "Roll back with: pnpm --filter @budget/worker exec wrangler d1 time-travel restore budget-db --bookmark=$BOOKMARK"
  else
    is_dry || die "Could not read a D1 Time Travel bookmark"
    echo "DRY: bookmark"
  fi
else
  echo "New database: no bookmark needed."
fi

# 4/6. Access (before the deploy, so the audience tag can go into the Worker's variables).
say "Cloudflare Access"
ensure_access

# 5. DNS: a stale A record to a private address blocks the custom domain; remove only that one.
say "DNS for $HOST"
ZONE_ID=$(cf_api GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id // empty')
ZONE_ID=$(req_id "$ZONE_ID" "zone $ZONE_NAME")
ATTACHED=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains?hostname=$HOST&service=budget" | jq -r '[.result[]? | select(.hostname == "'"$HOST"'")] | length')
RECORDS=$(cf_api GET "/zones/$ZONE_ID/dns_records?name=$HOST")
while IFS=$'\t' read -r rid rtype rcontent; do
  [ -n "$rid" ] || continue
  if [ "$rtype" = A ] && [[ "$rcontent" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then
    say "Removing the A record that points at a private address"
    cf_api DELETE "/zones/$ZONE_ID/dns_records/$rid" >/dev/null
  elif [ "$ATTACHED" -gt 0 ]; then
    echo "Keeping the $rtype record: it belongs to the Worker's custom domain."
  else
    die "Unexpected $rtype record for $HOST; refusing to touch it. Remove it or resolve it manually."
  fi
done < <(jq -r '.result[]? | [.id, .type, .content] | @tsv' <<<"$RECORDS")

# 7. Remote migrations, then deploy.
say "Migrations (remote) and deploy"
if is_dry; then
  echo "DRY: wrangler d1 migrations apply"
else
  (cd "$WORKDIR" && run_wrangler d1 migrations apply budget-db --remote -c "$WORKDIR/apps/worker/wrangler.jsonc")
fi
SVC_HASH=$(printf '%s' "$CF_ACCESS_CLIENT_ID" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1)
SVC_MAP=$(jq -nc --arg h "$SVC_HASH" --arg n "$SERVICE_TOKEN_NAME" '{($h): $n}')
if is_dry; then
  echo "DRY: wrangler deploy"
else
  BUILT_JSON=$(mktemp); TMPFILES+=("$BUILT_JSON")
  jq --arg id "$D1_ID" '.d1_databases[0].database_id = $id' "$WTBUILD" > "$BUILT_JSON"
  # wrangler resolves "main" and "assets.directory" relative to the config file: keep it beside the build.
  BUILT_BESIDE="$(dirname "$WTBUILD")/wrangler.deploy.json"; TMPFILES+=("$BUILT_BESIDE")
  cp "$BUILT_JSON" "$BUILT_BESIDE"
  SECRETS_FILE=$(mktemp); TMPFILES+=("$SECRETS_FILE")
  jq -nc --arg k "$SECRETS_ENCRYPTION_KEY" '{SECRETS_ENCRYPTION_KEY: $k}' > "$SECRETS_FILE"
  (cd "$WORKDIR" && run_wrangler deploy -c "$BUILT_BESIDE" --secrets-file "$SECRETS_FILE" \
    --var "ENVIRONMENT:production" --var "DEPLOY_SHA:$DEPLOY_SHA" --var "ACCESS_AUD:$ACCESS_AUD_VALUE" \
    --var "ACCESS_TEAM_DOMAIN:$ACCESS_TEAM" --var "ACCESS_SERVICE_TOKENS:$SVC_MAP")
fi

# 8. Smoke test.
say "Smoke test"
if is_dry; then
  echo "DRY: smoke test (health with service token; unauthenticated /, /api/v1/health, /mcp refused)"
else
  smoke_ok=0
  deadline=$((SECONDS + 120))
  while [ "$SECONDS" -lt "$deadline" ]; do
    body=$(curl -sS --max-time 15 "https://$HOST/api/v1/health" \
      -K <(printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET") 2>/dev/null || true)
    if [ "$(jq -r '.deploy_sha // empty' <<<"$body" 2>/dev/null)" = "$DEPLOY_SHA" ]; then smoke_ok=1; break; fi
    sleep 5
  done
  refused_ok=1
  if [ "$smoke_ok" = 1 ]; then
    for p in / /api/v1/health /mcp; do
      code=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code} %{redirect_url}' "https://$HOST$p" || echo "000 ")
      status=${code%% *}; loc=${code#* }
      case "$status" in
        401|403) ;;
        302) [[ "$loc" == *cloudflareaccess.com* ]] || { echo "SMOKE: $p redirected somewhere other than Access" >&2; refused_ok=0; } ;;
        *) echo "SMOKE: $p answered $status without credentials (expected a refusal)" >&2; refused_ok=0 ;;
      esac
    done
  fi
  if [ "$smoke_ok" != 1 ] || [ "$refused_ok" != 1 ]; then
    echo "SMOKE TEST FAILED (health with the service token: $smoke_ok, unauthenticated paths refused: $refused_ok)" >&2
    [ -z "${BOOKMARK:-}" ] || echo "Roll back the database: wrangler d1 time-travel restore budget-db --bookmark=$BOOKMARK" >&2
    echo "Roll back the Worker: pnpm --filter @budget/worker exec wrangler rollback" >&2
    exit 1
  fi
fi

echo "Live: https://$HOST"
echo "DEPLOY_SHA=$DEPLOY_SHA"
