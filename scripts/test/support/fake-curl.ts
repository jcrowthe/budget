import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fake `curl` for tests. Env FAKE_CURL_LOG: file that receives argv (one line) and, per -K config,
// the header names. A route {seq: [{status, body}, ...]} answers its calls in order (the last repeats). Env FAKE_CURL_ROUTES: JSON {"<substring of 'METHOD URL'>": {status, body}}, first match wins.
const SCRIPT = `#!/usr/bin/env bash
method=GET; url=""; out=""; wfmt=""; stdin=0
args=("$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  a="\${args[$i]}"
  case "$a" in
    -X) method="\${args[$((i + 1))]}" ;;
    -o) out="\${args[$((i + 1))]}" ;;
    -w) wfmt="\${args[$((i + 1))]}" ;;
    -K) cfg="\${args[$((i + 1))]}"; names=$(sed -n 's/^header = "\\([^:]*\\):.*/\\1/p' "$cfg" | tr '\\n' ' '); echo "CONFIG: $names" >> "$FAKE_CURL_LOG" ;;
    --data-binary) [ "\${args[$((i + 1))]}" = "@-" ] && stdin=1 ;;
    http*) url="$a" ;;
  esac
done
echo "curl $*" >> "$FAKE_CURL_LOG"
[ "$stdin" = 1 ] && cat >/dev/null
resp=$(jq -c --arg k "$method $url" '[to_entries[] | select(.key as $s | $k | contains($s))][0].value // empty' <<<"$FAKE_CURL_ROUTES")
[ -n "$resp" ] || exit 7
if [ "$(jq 'has("seq")' <<<"$resp")" = true ]; then
  cf="$FAKE_CURL_LOG.n.$(printf '%s' "$method $url" | md5sum | cut -c1-8)"
  n=$(cat "$cf" 2>/dev/null || echo 0); echo $((n + 1)) > "$cf"
  resp=$(jq -c --argjson n "$n" '.seq | .[if $n < length then $n else length - 1 end]' <<<"$resp")
fi
status=$(jq -r '.status' <<<"$resp"); body=$(jq -c '.body' <<<"$resp")
if [ -n "$out" ]; then printf '%s' "$body" > "$out"; else printf '%s' "$body"; fi
[ -z "$wfmt" ] || printf '%s' "$status"
exit 0
`;

export function makeFakeCurl() {
  const dir = mkdtempSync(join(tmpdir(), "fake-curl-"));
  writeFileSync(join(dir, "curl"), SCRIPT);
  chmodSync(join(dir, "curl"), 0o755);
  return {
    bin: dir,
    log: join(dir, "log"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
