#!/usr/bin/env bash
# Restores a nightly D1 backup (docs/backup-design.md, "Restore runbook").
#   restore-backup.sh fetch <id> --out <dir>   (--local --persist-to <abs> | --remote --confirm-remote-production)
#   restore-backup.sh restore --from <dir>     (--local --persist-to <abs> | --remote --database <name> --confirm-remote-production)
# Every guard runs here, in bash, before any wrangler call. A production restore needs the owner's approval.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

refuse() {
  echo "restore-backup: $1" >&2
  echo "restore-backup: a production restore needs the owner's explicit approval; see docs/backup-design.md" >&2
  exit 2
}

[ $# -ge 1 ] || refuse "usage: restore-backup.sh fetch <id> --out <dir> | restore --from <dir> (--local --persist-to <abs> | --remote --confirm-remote-production)"
cmd="$1"
shift
case "$cmd" in fetch | restore) ;; *) refuse "unknown command '$cmd'" ;; esac

local_t=0 remote_t=0 confirm=0 persist="" id="" out="" from="" database=""
while [ $# -gt 0 ]; do
  case "$1" in
    --local) local_t=1 ;;
    --remote) remote_t=1 ;;
    --confirm-remote-production) confirm=1 ;;
    --persist-to) persist="${2:-}"; shift ;;
    --out) out="${2:-}"; shift ;;
    --from) from="${2:-}"; shift ;;
    --database) database="${2:-}"; shift ;;
    --*) refuse "unknown flag '$1'" ;;
    *)
      if [ "$cmd" = fetch ] && [ -z "$id" ]; then id="$1"; else refuse "unexpected argument '$1'"; fi
      ;;
  esac
  [ $# -gt 0 ] && shift
done

if [ "$local_t" = 1 ] && [ "$remote_t" = 1 ]; then refuse "give --local or --remote, not both"; fi
if [ "$local_t" = 0 ] && [ "$remote_t" = 0 ]; then refuse "no target: give --local --persist-to <abs> or --remote --confirm-remote-production"; fi
if [ "$remote_t" = 1 ] && [ "$confirm" = 0 ]; then refuse "--remote needs --confirm-remote-production"; fi
if [ "$local_t" = 1 ]; then
  case "$persist" in /*) ;; *) refuse "--local needs an absolute --persist-to (never the dev's default state)" ;; esac
fi
if [ "$cmd" = fetch ]; then
  case "$id" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) refuse "fetch needs a backup id like 2026-11-25" ;; esac
  [ -n "$out" ] || refuse "fetch needs --out <dir>"
else
  [ -n "$from" ] || refuse "restore needs --from <dir>"
  if [ "$remote_t" = 1 ] && [ -z "$database" ]; then refuse "a remote restore needs --database <name> of a new, empty database"; fi
fi

cd "$root"
if [ "$remote_t" = 1 ]; then target=remote; else target=local; fi
exec node --experimental-strip-types --no-warnings "$root/scripts/restore-backup.ts" \
  "$cmd" --target "$target" --root "$root" --persist-to "$persist" --id "$id" --out "$out" --from "$from" \
  --database "${database:-budget-db}"
