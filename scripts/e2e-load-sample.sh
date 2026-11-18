#!/usr/bin/env bash
# Writes one line per second of the box's cgroup counters to <file> until killed (for scripts/e2e-load.sh).
# Columns: time, memory.current MiB, memory.events max, sock_throttled, memory.pressure full total ms,
# cpu.pressure full total ms, cpu.stat nr_throttled, throttled ms, load average (1 min), io.pressure full total
# ms, anonymous memory MiB, page cache MiB.
out="${1:?usage: e2e-load-sample.sh <file>}"
cg=/sys/fs/cgroup
ev() { awk -v k="$1" '$1 == k { print $2 }' "$cg/memory.events" 2>/dev/null; }
full() { awk '/^full/ { sub("total=", "", $5); print int($5 / 1000) }' "$cg/$1" 2>/dev/null; }
ms() { awk -v k="$1" '$1 == k { print int($2 / 1048576) }' "$cg/memory.stat" 2>/dev/null; }
st() { awk -v k="$1" '$1 == k { print $2 }' "$cg/cpu.stat" 2>/dev/null; }
echo "time mem_mib mem_max_events sock_throttled mem_full_ms cpu_full_ms nr_throttled throttled_ms load1 io_full_ms anon_mib file_mib" >"$out"
while :; do
  echo "$(date -u +%H:%M:%S) $(($(cat $cg/memory.current 2>/dev/null || echo 0) / 1048576)) $(ev max) \
$(ev sock_throttled) $(full memory.pressure) $(full cpu.pressure) $(st nr_throttled) \
$(($(st throttled_usec) / 1000)) $(cut -d' ' -f1 /proc/loadavg) $(full io.pressure) $(ms anon) $(ms file)" >>"$out"
  sleep 1
done
