// Reads a run of scripts/e2e-load.sh (report.json, run.log) and prints its table line and every failed test.
import { existsSync, readFileSync } from "node:fs";

const [dir, label, commit, load, secs, laBefore, laAfter, thrB, thrA, usecB, usecA] =
  process.argv.slice(2);
const log = existsSync(`${dir}/run.log`) ? readFileSync(`${dir}/run.log`, "utf8") : "";
const workers = log.match(/using (\d+) workers?/)?.[1] ?? "?";
const report = existsSync(`${dir}/report.json`)
  ? JSON.parse(readFileSync(`${dir}/report.json`, "utf8"))
  : { suites: [], stats: {} };

const failed = [];
let passed = 0;
let total = 0;
let skipped = 0;
const statuses = { 409: 0, "5xx": 0 };
const walk = (suite) => {
  for (const s of suite.suites ?? []) walk(s);
  for (const spec of suite.specs ?? [])
    for (const t of spec.tests ?? [])
      for (const r of t.results ?? []) {
        total++;
        if (r.status === "passed") passed++;
        else if (r.status === "skipped") skipped++;
        else {
          const msg = (r.error?.message ?? r.errors?.[0]?.message ?? "").replace(
            new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
            "",
          );
          const first = msg.split("\n").find((l) => l.trim()) ?? "";
          const all = msg;
          const kind = /-> (409)\b/.test(all)
            ? "server 409"
            : /-> 5\d\d\b/.test(all)
              ? "server 5xx"
              : /Timeout|timed out|Timed out/i.test(all)
                ? "wait ran out"
                : /Expected|Received/.test(all)
                  ? "wrong value"
                  : "other";
          const loc = r.error?.location ?? r.errors?.[0]?.location;
          failed.push({
            where: `${spec.file}:${spec.line}`,
            title: spec.title,
            status: r.status,
            failingLine: loc ? `${loc.file.replace(/.*\/e2e\//, "e2e/")}:${loc.line}` : "?",
            first: first.trim().slice(0, 200),
            kind,
          });
        }
      }
};
for (const s of report.suites ?? []) walk(s);
for (const m of log.matchAll(/-> (\d{3})\b/g)) {
  if (m[1] === "409") statuses[409]++;
  else if (m[1].startsWith("5")) statuses["5xx"]++;
}
const internal = (log.match(/internal_error/g) ?? []).length;
// The test server logs every request: "[WebServer] GET /api/v1/... 200 OK (12ms)".
const served = [
  ...log.matchAll(/\[WebServer\] (GET|POST|PUT|PATCH|DELETE) (\S+) (\d{3})[^(\n]*\((\d+)ms\)/g),
];
const ms = served.map((m) => Number(m[4])).sort((a, b) => a - b);
const pct = (q) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : 0);
const server409 = served.filter((m) => m[3] === "409");
const server5xx = served.filter((m) => m[3].startsWith("5"));

console.log(
  "| run | commit | workers | load | wall s | passed/total | failed | skipped | loadavg before | loadavg after | nr_throttled before→after | throttled_usec before→after | server 409 | server 5xx | requests, p50/p95/max ms, over 1 s | 409/5xx in failed tests |",
);
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
console.log(
  `| ${label} | ${commit} | ${workers} | ${load} | ${secs} | ${passed}/${total} | ${failed.length} | ${skipped} | ${laBefore} | ${laAfter} | ${thrB}→${thrA} | ${usecB}→${usecA} | ${server409.length} | ${server5xx.length} (internal_error ${internal}) | ${ms.length}, ${pct(0.5)}/${pct(0.95)}/${ms.at(-1) ?? 0}, ${ms.filter((x) => x > 1000).length} | ${statuses[409]}/${statuses["5xx"]} |`,
);
for (const m of [...server409, ...server5xx])
  console.log(
    `- server answered ${m[3]}: ${m[1]} ${m[2].replace(/[0-9a-f-]{36}/g, ":id")} (${m[4]}ms)`,
  );
// The box's cgroup over the run (scripts/e2e-load-sample.sh): memory at its limit, socket throttling, stalls.
if (existsSync(`${dir}/cgroup.tsv`)) {
  const rows = readFileSync(`${dir}/cgroup.tsv`, "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(" "));
  if (rows.length > 1) {
    const [a, b] = [rows[0], rows.at(-1)];
    const d = (i) => Number(b[i]) - Number(a[i]);
    const peak = Math.max(...rows.map((r) => Number(r[1])));
    console.log(
      `cgroup: memory peak ${peak} MiB; memory.max hits +${d(2)}; sock_throttled +${d(3)}; memory stall (full) +${d(4)} ms; cpu stall (full) +${d(5)} ms`,
    );
    const hits = rows.filter((r, i) => i > 0 && Number(r[2]) > Number(rows[i - 1][2]));
    if (hits.length)
      console.log(
        `seconds with memory.max hits: ${hits.map((r) => r[0]).join(" ")}`.slice(0, 2000),
      );
  }
}
console.log("");
for (const f of failed)
  console.log(
    `- ${f.where} "${f.title}" (${f.status}) failing line ${f.failingLine}: \`${f.first}\` — ${f.kind}`,
  );
