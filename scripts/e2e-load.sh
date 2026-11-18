#!/usr/bin/env bash
# Runs the browser suite (or part of it) once and keeps the evidence for the e2e-load Build (EXF-807).
#   bash scripts/e2e-load.sh <label> <on|off> [playwright args...]
# on  = the made load: four busy loops started just before the run and killed just after.
# Writes under ${E2E_LOAD_DIR:-/workspace/scratch/e2e-load}/<label>/: run.log (list reporter and the test
# server's output), report.json (JSON reporter), summary.md (the table line and every failed test).
set -uo pipefail
label="${1:?usage: e2e-load.sh <label> <on|off> [playwright args...]}"
load="${2:?usage: e2e-load.sh <label> <on|off> [playwright args...]}"
shift 2
case "$load" in on | off) ;; *) echo "load must be on or off" >&2; exit 2 ;; esac
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${E2E_LOAD_DIR:-/workspace/scratch/e2e-load}/$label"
mkdir -p "$out"
rm -f "$out/exit"
cd "$root"

stat_of() { awk -v k="$1" '$1 == k { print $2 }' /sys/fs/cgroup/cpu.stat 2>/dev/null || echo "?"; }
loadavg() { cut -d' ' -f1-3 /proc/loadavg; }

commit="$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . || echo '+dirty')"
la_before="$(loadavg)"
thr_before="$(stat_of nr_throttled)"
usec_before="$(stat_of throttled_usec)"

pids=()
if [ "$load" = on ]; then
  for _ in 1 2 3 4; do
    (while :; do :; done) &
    pids+=("$!")
  done
fi

bash scripts/e2e-load-sample.sh "$out/cgroup.tsv" &
sampler=$!
trap 'kill "$sampler" "${pids[@]}" 2>/dev/null' EXIT
start=$(date +%s)
# DEBUG=pw:webserver prints the test server's stdout too (its stderr is printed anyway), so 500s are counted.
# Every line gets the wall time it was printed at (stamp.mjs), so a slow answer can be set beside a test.
DEBUG=pw:webserver PLAYWRIGHT_JSON_OUTPUT_NAME="$out/report.json" \
  pnpm exec playwright test --reporter=list,json "$@" 2>&1 | node scripts/e2e-load-stamp.mjs >"$out/run.log"
status=${PIPESTATUS[0]}
end=$(date +%s)
# Playwright empties test-results at the next run: keep this run's traces of failed tests.
rm -rf "$out/test-results"
[ -d test-results ] && cp -r test-results "$out/test-results"

kill "$sampler" 2>/dev/null
for p in "${pids[@]}"; do kill "$p" 2>/dev/null; done
for p in "${pids[@]}"; do wait "$p" 2>/dev/null; done
left=0
for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && left=$((left + 1)); done

la_after="$(loadavg)"
thr_after="$(stat_of nr_throttled)"
usec_after="$(stat_of throttled_usec)"

node scripts/e2e-load-report.mjs "$out" \
  "$label" "$commit" "$load" "$((end - start))" "$la_before" "$la_after" \
  "$thr_before" "$thr_after" "$usec_before" "$usec_after" | tee "$out/summary.md"
echo "busy loops started: ${#pids[@]}, still alive: $left; playwright exit $status"
echo "$status" >"$out/exit"
exit "$status"
