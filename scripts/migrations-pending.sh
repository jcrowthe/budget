#!/usr/bin/env bash
# List which D1 migrations are not yet applied to the remote database.
# Output: one pending migration file name per line, nothing when none are pending.
# Exit: 0 on success, non-zero with a message on stderr when it cannot tell.
# When the database does not exist yet, every local migration is pending.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

migrations_dir="apps/worker/migrations"
db_name="budget-db"

# Check if migrations directory exists and has migrations
if [ ! -d "$migrations_dir" ]; then
  echo "ERROR: migrations directory not found at $migrations_dir" >&2
  exit 1
fi

# Get list of local migrations
local_migrations=$(find "$migrations_dir" -maxdepth 1 -name "*.sql" -type f | sort)
if [ -z "$local_migrations" ]; then
  # No migrations, nothing is pending
  exit 0
fi

# Try to get list of applied migrations from remote database
applied_migrations=$(pnpm --filter @budget/worker exec wrangler d1 migrations list "$db_name" --remote 2>/dev/null | grep -E '^\s+\[' | awk '{print $2}' | tr -d '[]' || echo "")

# If database doesn't exist or no applied migrations found, all locals are pending
if [ -z "$applied_migrations" ]; then
  basename -a $local_migrations
  exit 0
fi

# Print only migrations that are not in the applied list
for migration in $local_migrations; do
  filename=$(basename "$migration")
  # Extract the migration name from applied list (format: [20261115000000_budgets_change_log.sql])
  if ! echo "$applied_migrations" | grep -q "^$filename$"; then
    echo "$filename"
  fi
done

exit 0
