# The browser suite under load: implementation spec (EXF-807, EXF-727, EXF-747, EXF-783, EXF-631 item 2)

Read `docs/e2e-load-design.md` first (the table, the causes, the decisions, the acceptance). Commit after each
task, in this order. Open nothing in the source app; no product file changes.

## Running things in this box

- One run: `bash scripts/e2e-load.sh <label> <on|off> [playwright args]`. Output in
  `/workspace/scratch/e2e-load/<label>/` (`summary.md` = the table line and every failed test; `run.log`,
  `report.json`, `cgroup.tsv`, `test-results/`). Labels used so far: `A1`…`A4`, `T1`…`T4`, so pick new ones
  (`I1-loaded`, …).
- **A full run takes 9 to 10+ minutes; the shell stops a command at 10 minutes.** For a full run use
  `bash scripts/e2e-load-bg.sh start <label> <on|off>`, then `bash scripts/e2e-load-bg.sh wait <label>` in the
  foreground (it blocks up to 540 s; exit 3 = still running: call `wait` again; exit 0/1 = finished, prints
  the summary). `stop <label>` kills the run's process group (its busy loops included). Never start two runs at
  once (both serve on :4173). Targeted runs (under 10 minutes) can use `e2e-load.sh` directly with
  `timeout 590`.
- The `summary.md` table line is what goes in your report; add the failing lines with the cause from the
  design or "not explained". For a failure, look in `run.log` for server answers of 5,000 ms or more near its
  time and at `cgroup.tsv` (`wd_state` `D`, `mem_mib` near 5,006, `mem_max_events` rising).
- Full runs left: **5** for the Implementer (3 loaded + 1 quiet on the final head, 1 alternative if needed),
  **1** for the Tester. Say how many you used.

## Task 1 (done, Architect): the measurement helper

`scripts/e2e-load.sh`, `e2e-load-bg.sh`, `e2e-load-report.mjs`, `e2e-load-sample.sh`, `e2e-load-stamp.mjs`.
Do not change their output format; fixes are fine (say what).

## Task 2 (done, Architect): runs and causes

In the design. Do not repeat them.

## Task 3: worker count from the box's quotas

**New `e2e/support/e2e-load-workers.ts`** (no Playwright import; Node built-ins only):

```ts
export type WorkerInputs = {
  cpuMax: string | null;      // contents of /sys/fs/cgroup/cpu.max, null when unreadable
  memoryMax: string | null;   // contents of /sys/fs/cgroup/memory.max, null when unreadable
  cpus: number;               // os.cpus().length (os.availableParallelism() is fine too)
  override: string | undefined; // process.env.E2E_WORKERS
};
/** The suite's worker count, or undefined for Playwright's default. Pure. */
export function workersFor(i: WorkerInputs): number | undefined;
/** Reads the two cgroup files (try/catch → null), os and E2E_WORKERS, then calls workersFor. */
export function suiteWorkers(): number | undefined;
```

Rules of `workersFor`, in order:
1. `override` matches `/^[1-9]\d*$/` → `Number(override)`. Anything else is ignored.
2. `cap = max(1, floor(cpus / 2))` (Playwright's default today).
3. CPU limit: `cpuMax` is `"<quota> <period>"` with both integers → `max(1, floor(quota / period) − 1)`; `"max …"`,
   `null` or anything else → none.
4. Memory limit: `memoryMax` (trimmed) is an integer of bytes →
   `max(1, floor((bytes − 2 * 1024 ** 3) / (512 * 1024 ** 2)))`; `"max"`, `null` or other → none.
5. No limit at all → `undefined`. Otherwise `min(cap, every limit there is)`.

A short comment above `workersFor` names the evidence: "8 workers on a 5-CPU, 5 GiB box reached the memory cap
and stalled the test server (docs/e2e-load-design.md)".

**`playwright.config.ts`**: `import { suiteWorkers } from "./e2e/support/e2e-load-workers";` and
`workers: suiteWorkers(),` next to `fullyParallel: true`. Nothing else in the config changes (`retries` stays
unset = 0; no `expect.timeout`, no `timeout`).

**New `e2e/e2e-load-workers.spec.ts`**: no page, no request; imports `test`, `expect` from `./fixtures` and
`workersFor`. One `test` per case of design acceptance 3 (`"500000 100000\n"` with `"max\n"`, 16 → 4;
`"max 100000"` → undefined; both null → undefined; `"150000 100000"` → 1; `"1600000 100000"`, 16 → 8;
`"max 100000"` with `"5249171456\n"`, 16 → 5; override `"2"` → 2; override `"0"` and `"abc"` with
`"500000 100000"` → 4). Names exact and descriptive (for example
`"a 5-CPU quota gives 4 workers"`).

Verify:
- `pnpm exec playwright test e2e/e2e-load-workers.spec.ts` passes; run it once against a deliberately wrong
  `workersFor` (for example without the `− 1`) to see it fail, and quote the failing line (brief: a test for a
  fault runs once against the code before the fix).
- `pnpm exec playwright test --list | tail -1` counts 610 + the new tests.
- A targeted run prints `using 4 workers`; `E2E_WORKERS=2 bash scripts/e2e-load.sh … ` prints 2.
- Commit. In the commit message: workers 8 → 4 and why (one line).

## Task 4: EXF-783, the spec waits for the add row to close

`e2e/scheduled-transactions.spec.ts`, test "Repeat Monthly shows a repeat icon with the tooltip `Repeats
monthly` (497 AC3)" (line 151): right after `await addRow(page, {...})`, add

```ts
  // The add row closes after the plan's queries refetch, moving the rows up; hover once it has closed (EXF-783).
  await expect(page.locator(".entry-body")).toHaveCount(0);
```

Nothing else in the file. Not in `addRow` (other tests do not hover).

Verify:
- **Before** (on the code without the line): `--repeat-each=20` of `e2e/scheduled-transactions.spec.ts:151`
  under load (`e2e-load.sh <label> on e2e/scheduled-transactions.spec.ts:151 --repeat-each=20`); quote any
  failing line. It may pass: T3's failure was 1 in 10 at 8 workers (`:167`, tooltip not found); quote that and
  your result.
- **After**: the same command, 20 of 20. Commit with both results in the message.

## Task 5: the two work-arounds (EXF-631 item 2)

1. `e2e/support/register-seed.ts` `call()`: remove the retry loop and its comment; one `request.fetch`, then
   the same `expect(res.ok(), \`${method} ${path} -> ${res.status()}\`).toBe(true)` and
   `return (await res.json()).data`. Signature unchanged.
2. `e2e/auto-assign.spec.ts` lines 154-163: keep the loop; replace its two comment lines with the confirmed
   cause: vite preview serves through `http.createServer` (`resolveHttpServer` in
   `node_modules/vite/dist/node/chunks/node.js`), so Node's default `server.keepAliveTimeout` of 5000 ms closes
   an idle socket, while Playwright's request context keeps sockets alive (`http.Agent({ keepAlive: true })`); a
   request sent as that socket closes gets `ECONNRESET`. Setting an absolute amount is safe to repeat. Keep it
   to three comment lines.

Verify: the specs that use `call()` pass in a targeted run (`grep -l "register-seed" e2e/*.spec.ts`; run those
files once with load on, under 10 minutes, or split them); `e2e/auto-assign.spec.ts` passes. Commit.

## Task 6: final runs and conventions

1. `--repeat-each=20` under load for `e2e/reconcile.spec.ts:102` and `e2e/month-nav.spec.ts:127` (4 workers).
   Report results; quote any failure with its time and the server's answers and `cgroup.tsv` row at that time.
   If `month-nav.spec.ts:127` fails outside a stall (no answer ≥ 5 s and no `D` near it), keep the trace and say
   so: that is new evidence for EXF-727; do not change the spec or the app on a guess.
2. Three loaded full runs (`bg.sh start I<n>-loaded on`) and one quiet full run (`off`) on the final head.
   Table lines; every failed test with its line, kind, cause from the design ("server stall" only with the
   evidence named in design acceptance 7) or "not explained", and its ticket.
3. Wall time before and after (design decision 2), and the gate costs in minutes measured (Build: 3 full runs;
   Deploy: 1 after `pnpm check`).
4. `docs/conventions.md`: a section `## Browser suite: workers and load` (after `## Commands`' block, before
   `## Plaid` is fine), at most ~10 lines: the count comes from `e2e/support/e2e-load-workers.ts` (cgroup CPU quota
   − 1, a memory limit of (memory − 2 GiB) / 512 MiB, never above Playwright's default; `E2E_WORKERS` overrides;
   `--workers` wins); why (one sentence, link to the design); how to measure under the made load
   (`scripts/e2e-load.sh <label> on`, `scripts/e2e-load-bg.sh` past 10 minutes) and where the summary is.
5. `pnpm check`. Commit.

## Out of bounds (brief note 10)

Every file of `paths.always_overlap` except `playwright.config.ts`; `scripts/deploy.sh`; `e2e/mcp.spec.ts` and
the other never-edited tests; `apps/**`, `packages/**`; migrations. No dependency; no `test.skip`; no retry; no
`waitForTimeout` as a fix; no change to any expectation. The only edited waits are Task 4's one line and Task
5's removal of the seeding retry: list both in your report as edited waits, with their reasons.
