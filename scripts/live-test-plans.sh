#!/usr/bin/env bash
# Manage test plans on the live clone.
# Usage:
#   bash scripts/live-test-plans.sh list          - print id and name of every prefixed plan
#   bash scripts/live-test-plans.sh create '<name>' - create a plan (name must start with prefix)
#   bash scripts/live-test-plans.sh delete <id>   - delete a plan (must have prefixed name)
#   bash scripts/live-test-plans.sh purge         - delete all prefixed plans
#   bash scripts/live-test-plans.sh delete_import - print not applicable message
#   bash scripts/live-test-plans.sh routes        - describe the route map
#
# Environment:
#   BASE_URL: override the live URL (default from profile: https://budget.doxen.dev)
#   CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET: service token headers (required for live clone)
#
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

# Load profile to get the test prefix
if [ ! -f clone.profile.json ]; then
  echo "ERROR: clone.profile.json not found" >&2
  exit 1
fi

TEST_PREFIX=$(jq -r '.live.test_prefix // empty' clone.profile.json)
if [ -z "$TEST_PREFIX" ]; then
  echo "ERROR: live.test_prefix not found in clone.profile.json" >&2
  exit 1
fi

# Determine base URL
if [ -z "${BASE_URL:-}" ]; then
  BASE_URL=$(jq -r '.live.url // empty' clone.profile.json)
  if [ -z "$BASE_URL" ]; then
    echo "ERROR: live.url not found in clone.profile.json and BASE_URL not set" >&2
    exit 1
  fi
fi

# Helper to make authenticated requests to the live clone
api_call() {
  local method="$1"
  local path="$2"
  local data="${3:-}"

  # Use curl with config for credentials (never argv)
  local curl_opts=(-sS -X "$method" "$BASE_URL$path" -H "Content-Type: application/json")

  # Only add auth headers if credentials are provided
  if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
    curl_opts+=(
      -K <(printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET")
    )
  fi

  if [ -n "$data" ]; then
    curl "${curl_opts[@]}" --data-binary "$data"
  else
    curl "${curl_opts[@]}"
  fi
}

cmd="${1:-}"

case "$cmd" in
  list)
    # List all plans that start with the test prefix
    response=$(api_call GET /api/v1/budgets)
    # Extract plans that start with TEST_PREFIX (filter by name starting with prefix)
    echo "$response" | jq -r '.data[]? | select(.name | startswith("'"$TEST_PREFIX"'")) | "\(.id) \(.name)"'
    ;;

  create)
    name="${2:-}"
    if [ -z "$name" ]; then
      echo "ERROR: create requires a name argument" >&2
      exit 1
    fi

    # Check that name starts with prefix
    if [[ ! "$name" =~ ^"$TEST_PREFIX" ]]; then
      echo "ERROR: plan name must start with $TEST_PREFIX" >&2
      exit 1
    fi

    # Create the plan
    data=$(jq -nc --arg name "$name" '{name: $name}')
    response=$(api_call POST /api/v1/budgets "$data")
    # Print the id only
    echo "$response" | jq -r '.data?.id // empty'
    ;;

  delete)
    id="${2:-}"
    if [ -z "$id" ]; then
      echo "ERROR: delete requires an id argument" >&2
      exit 1
    fi

    # Get the plan to check its name
    response=$(api_call GET /api/v1/budgets/"$id")
    name=$(echo "$response" | jq -r '.data?.name // empty')

    # Check that name starts with prefix
    if [ -z "$name" ]; then
      echo "ERROR: plan not found" >&2
      exit 1
    fi
    if [[ ! "$name" =~ ^"$TEST_PREFIX" ]]; then
      echo "ERROR: will not delete plan not prefixed with $TEST_PREFIX" >&2
      exit 1
    fi

    # Delete the plan
    api_call DELETE /api/v1/budgets/"$id" >/dev/null
    echo "deleted $id"
    ;;

  purge)
    # Get all plans
    response=$(api_call GET /api/v1/budgets)

    # Extract plans that start with TEST_PREFIX
    plans=$(echo "$response" | jq -r '.data[]? | select(.name | startswith("'"$TEST_PREFIX"'")) | .id')

    count=0
    if [ -z "$plans" ]; then
      echo "deleted 0 remaining 0"
      exit 0
    fi

    # Check if more than 50 match
    plan_count=$(echo "$plans" | wc -l)
    if [ "$plan_count" -gt 50 ]; then
      echo "ERROR: more than 50 prefixed plans found, refusing to delete" >&2
      exit 1
    fi

    # Delete each plan
    while read -r id; do
      api_call DELETE /api/v1/budgets/"$id" >/dev/null
      ((count++))
    done <<< "$plans"

    # Count remaining prefixed plans
    response=$(api_call GET /api/v1/budgets)
    remaining=$(echo "$response" | jq -r '[.data[]? | select(.name | startswith("'"$TEST_PREFIX"'"))] | length')

    echo "deleted $count remaining $remaining"

    # Exit 0 only if 0 remain
    [ "$remaining" -eq 0 ] || exit 1
    ;;

  delete_import)
    echo "Not applicable yet: the app has no imports."
    ;;

  routes)
    echo "/ and non-API paths: single-page app; /api/v1/budgets: REST (read budgets, create/update plan, read plan, update plan, delete plan); /api/v1 other routes: REST (read only); /mcp: MCP endpoint; test plans managed only through scripts/live-test-plans.sh"
    ;;

  *)
    echo "ERROR: unknown command: $cmd" >&2
    echo "usage: bash scripts/live-test-plans.sh <list|create|delete|purge|delete_import|routes>" >&2
    exit 1
    ;;
esac
