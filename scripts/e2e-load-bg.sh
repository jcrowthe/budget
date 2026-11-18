#!/usr/bin/env bash
# Runs scripts/e2e-load.sh detached, for runs longer than the agent shell's 10-minute limit, and waits for it in
# bounded foreground steps (each step blocks; it does not return early).
#   bash scripts/e2e-load-bg.sh start <label> <on|off> [playwright args...]   prints the process group id
#   bash scripts/e2e-load-bg.sh wait <label> [seconds, default 540]           exit 0/1 = the run's result, 3 = still running
#   bash scripts/e2e-load-bg.sh stop <label>                                  kills the run's process group
set -uo pipefail
cmd="${1:?usage: e2e-load-bg.sh start|wait|stop <label> ...}"
label="${2:?usage: e2e-load-bg.sh start|wait|stop <label> ...}"
shift 2
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${E2E_LOAD_DIR:-/workspace/scratch/e2e-load}/$label"
alive() { [ -f "$out/pgid" ] && kill -0 -- "-$(cat "$out/pgid")" 2>/dev/null; }

case "$cmd" in
start)
  if alive; then echo "already running: $label (pgid $(cat "$out/pgid"))" >&2; exit 2; fi
  mkdir -p "$out"
  rm -f "$out/exit" "$out/pgid"
  cd "$root"
  # setsid: the run gets its own session and process group, so stop can kill it and its busy loops at once.
  setsid bash -c 'echo $$ >"$1/pgid"; shift; exec bash scripts/e2e-load.sh "$@"' _ "$out" "$label" "$@" \
    >"$out/helper.log" 2>&1 </dev/null &
  for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$out/pgid" ] && break; sleep 0.5; done
  echo "started $label, pgid $(cat "$out/pgid")"
  ;;
wait)
  limit="${1:-540}"
  for ((t = 0; t < limit; t += 5)); do
    if [ -f "$out/exit" ]; then
      cat "$out/summary.md"
      tail -1 "$out/helper.log"
      exit "$(cat "$out/exit")"
    fi
    alive || { echo "the run of $label is gone without a result; see $out/helper.log" >&2; exit 4; }
    sleep 5
  done
  echo "still running: $label, $(grep -cE '^[0-9:.]+ +(✓|✘) ' "$out/run.log" 2>/dev/null || echo 0) tests finished"
  exit 3
  ;;
stop)
  alive && kill -- "-$(cat "$out/pgid")"
  sleep 3
  alive && kill -9 -- "-$(cat "$out/pgid")"
  echo "stopped $label"
  ;;
*)
  echo "usage: e2e-load-bg.sh start|wait|stop <label> ..." >&2
  exit 2
  ;;
esac
