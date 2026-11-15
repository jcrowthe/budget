#!/usr/bin/env bash
# Idempotent Cloudflare Access setup for budget.doxen.dev. Sourced by scripts/deploy.sh after cf.sh.
# Sets: ACCESS_AUD_VALUE, ACCESS_TEAM, SERVICE_TOKEN_NAME, ACCESS_SHAPE.

APP_DOMAIN="budget.doxen.dev"

upsert_policy() { # name json -> id
  local name="$1" json="$2" id
  id=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/policies?per_page=100" | jq -r --arg n "$name" '.result[]? | select(.name == $n) | .id' | head -n1)
  if [ -n "$id" ]; then
    cf_api PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/policies/$id" "$json" >/dev/null
  else
    id=$(cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/policies" "$json" | jq -r '.result.id // empty')
  fi
  req_id "$id" "policy $name"
}

upsert_app() { # name json -> prints the app json (.result)
  local name="$1" json="$2" id
  id=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps?name=$name&per_page=100" | jq -r --arg n "$name" '.result[]? | select(.name == $n) | .id' | head -n1)
  if [ -n "$id" ]; then
    cf_api PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps/$id" "$json" | jq -c '.result'
  else
    cf_api POST "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/apps" "$json" | jq -c '.result'
  fi
}

ensure_access() {
  ACCESS_TEAM="${CF_ACCESS_TEAM_DOMAIN#https://}"
  ACCESS_TEAM="${ACCESS_TEAM%/}"

  local tok tok_uuid
  tok=$(cf_api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/access/service_tokens?per_page=100" | jq -c --arg c "$CF_ACCESS_CLIENT_ID" '[.result[]? | select(.client_id == $c)][0] // empty')
  if [ -z "$tok" ] && ! is_dry; then die "No Access service token has the client id in CF_ACCESS_CLIENT_ID"; fi
  tok_uuid=$(jq -r '.id // "dry-run-id"' <<<"${tok:-{\}}")
  SERVICE_TOKEN_NAME=$(jq -r '.name // "service"' <<<"${tok:-{\}}")

  local allow_json svc_json allow_id svc_id
  allow_json=$(jq -nc --arg e "$ACCESS_ALLOWED_EMAIL" \
    '{name:"budget-allow-owner", decision:"allow", include:[{email:{email:$e}}]}')
  svc_json=$(jq -nc --arg t "$tok_uuid" \
    '{name:"budget-service-auth", decision:"non_identity", include:[{service_token:{token_id:$t}}]}')
  allow_id=$(upsert_policy budget-allow-owner "$allow_json")
  svc_id=$(upsert_policy budget-service-auth "$svc_json")

  local oauth='{"enabled":true,"dynamic_client_registration":{"enabled":true,"allow_any_on_localhost":true,"allow_any_on_loopback":true}}'
  app_body() { # name uri oauth(json|"") policies(json)
    jq -nc --arg name "$1" --arg uri "$2" --argjson oauth "${3:-null}" --argjson pol "$4" \
      '{name:$name, type:"self_hosted", domain:$uri, destinations:[{type:"public",uri:$uri}],
        session_duration:"24h", app_launcher_visible:false, service_auth_401_redirect:true, policies:$pol}
       + (if $oauth == null then {} else {oauth_configuration:$oauth} end)'
  }
  local both main app mcp_app
  both=$(jq -nc --arg a "$allow_id" --arg s "$svc_id" '[{id:$a,precedence:1},{id:$s,precedence:2}]')

  ACCESS_SHAPE=combined
  if [ "${ACCESS_MCP_SEPARATE_APP:-}" = "1" ]; then
    ACCESS_SHAPE=separate
  elif ! app=$(upsert_app budget "$(app_body budget "$APP_DOMAIN" "$oauth" "$both")"); then
    echo "NOTE: Access rejected Managed OAuth together with the Service Auth policy; using a separate /mcp application." >&2
    ACCESS_SHAPE=separate
  fi
  if [ "$ACCESS_SHAPE" = separate ]; then
    app=$(upsert_app budget "$(app_body budget "$APP_DOMAIN" "" "$both")") || die "Could not create the Access application"
    local only_allow
    only_allow=$(jq -nc --arg a "$allow_id" '[{id:$a,precedence:1}]')
    mcp_app=$(upsert_app budget-mcp "$(app_body budget-mcp "$APP_DOMAIN/mcp" "$oauth" "$only_allow")") \
      || die "Could not create the Access application for /mcp"
  fi
  ACCESS_AUD_VALUE=$(jq -r '.aud // empty' <<<"$app")
  ACCESS_AUD_VALUE=$(req_id "$ACCESS_AUD_VALUE" "Access audience tag")
  if [ "$ACCESS_SHAPE" = separate ]; then
    # /mcp tokens carry the budget-mcp audience; the Worker accepts a comma-separated list.
    mcp_aud=$(req_id "$(jq -r '.aud // empty' <<<"$mcp_app")" "Access audience tag of the /mcp app")
    ACCESS_AUD_VALUE="$ACCESS_AUD_VALUE,$mcp_aud"
  fi
  say "Access ready (shape: $ACCESS_SHAPE)"
}
