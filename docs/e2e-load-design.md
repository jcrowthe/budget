# The browser suite under load: design (EXF-807 with EXF-727, EXF-747, EXF-783 and item 2 of EXF-631)

This Build changes how the browser suite runs, not what the app does. No screen changes. It holds
`playwright.config.ts` and runs alone. Every claim below is grounded in a measured run (table below) or a file
read; scratch evidence (logs, JSON reports, cgroup samples, traces) is under `/workspace/scratch/e2e-load/<run>/`
in the Architect's box.

## The source app in this Build

**Nothing in the source app is opened, read, measured or captured by any step of this Build: no page, no style
rule, no script file, no probe element, no sidebar text.** Reason: this Build changes how the clone's tests run;
it has no screen and nothing to compare. The Clerk's tab exists only because the platform's check asks for it;
it stays as the Clerk left it. If a step believes it needs the source, it says why in its answer and does not
open it.

**Each step states in its report that it opened nothing in the source app.** (Architect: I opened nothing in
the source app and did not call the live app.)

## The box (read in this box, 18 Nov 2026)

- `nproc` 16; `/sys/fs/cgroup/cpu.max` `500000 100000` (5 CPUs); `memory.max` `5249171456` (5,006 MiB);
  `memory.swap.max` 0. Playwright's default (no `workers` in the config) is half the visible CPUs: **8 workers**.
- The test server is one `workerd` process (vite preview with the Cloudflare plugin) whose local D1 is SQLite in
  `.e2e-state/` on the box's overlay disk (`/dev/sda1` ext4, shared by the host). The only tmpfs is
  `/dev/shm`, 64 MB; the state reached 168 MiB in a full run (A4), so it cannot move to memory.
- **The host is not quiet.** With this box idle (29 processes, 0.16 s of CPU in 10 s) the host's load average
  was 6 to 14 and host-wide IO pressure (`/proc/pressure/io`) averaged ~10% over 5 minutes. The brief's premise
  ("whatever load you measure under, you make yourself") does not hold: neighbours' disk use reaches us (T4).
- The agent shell stops any command at **10 minutes**; a loaded full run takes 9 to 10+ minutes (A4 was cut at
  600 s). `scripts/e2e-load-bg.sh` runs the helper detached and waits in bounded foreground steps.

## The measurement helper (committed first)

`bash scripts/e2e-load.sh <label> <on|off> [playwright args]` (or `scripts/e2e-load-bg.sh start|wait|stop`):
the made load (`on`: four `while :; do :; done` loops, pids kept, killed and checked after), list + JSON
reporters, every output line time-stamped (`e2e-load-stamp.mjs`), the test server's own request log
(`DEBUG=pw:webserver`: `GET /api/... 200 OK (12ms)` per request), a per-second cgroup sample
(`e2e-load-sample.sh`: memory, `memory.events max`, PSI cpu/memory/io, `cpu.stat` throttling, the server's
state/CPU/RSS, the database size), failed traces kept, and `summary.md` with the table line and every failed
test (`e2e-load-report.mjs`). Output: `/workspace/scratch/e2e-load/<label>/`.

## Measured runs

All on main's app and specs (`1979d9d`; the commits listed only add `scripts/e2e-load*`). Load = the made load
of the brief (four busy loops). Throttled = `cpu.stat` `nr_throttled` / `throttled_usec` deltas. Server =
the test server's own log over the run.

| run | commit | workers | load | wall s | passed/total, failed | loadavg before → after | throttled (periods, s) | server 409 / 5xx | server p95 / max ms, answers > 1 s | memory peak, `memory.max` hits |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 full | ec208e6 | 8 | off | 409 | 605/610, 4 (1 skipped) | 3.54 → 13.25 | +3,137, 1,269 | 2 / 0 | 209 / 10,703, 8 | not sampled |
| A2 full | ec208e6 | 8 | on | 548 | 607/610, 2 | 12.34 → 17.51 | +5,446, 3,141 | 2 / 0 | 267 / 6,559, 6 | not sampled |
| A3 full | ec208e6 | 8 | on | 527 | 609/610, 0 | 7.74 → 13.05 | +5,261, 3,108 | 2 / 0 | 227 / 1,786, 2 | not sampled |
| A4 full, sampled | f437018 | 8 | on | 600 (cut) | 580 of 588 finished, 8 | 3.27 → 20.83 | +5,282, 1,928 | 2 / 0 | 295 / 8,316, 68 | 5,005 MiB, +6,019 |
| T1 20 tests ×5 | 3dc67f5 | 8 | on | 193 | 130/130, 0 | 2.79 → 14.84 | +1,930, 1,127 | 0 / 0 | 203 / 490, 0 | not sampled |
| T2 20 tests ×5 | 70f813a | 8 | on | 179 | 130/130, 0 | 3.88 → 1.55 | +1,782, 1,042 | 0 / 0 | 194 / 387, 0 | 5,004 MiB, +337 |
| T3 16 named ×10 | 75b6588 | 8 | on | 304 | 209/210, 1 | 1.92 → 23.75 | +3,028, 1,886 | 0 / 0 | 199 / 509, 0 | 5,005 MiB, +566 |
| T4 16 named ×10 | f437018 | 4 | on | 586 | 183/210, 27 | 13.01 → 15.80 | +3,576, 1,119 | 0 / 0 | 433 / 4,949, 152 | 3,807 MiB, 0 |

Full runs used: **4 of 10** (A1 to A4; A4 counts though the shell cut it). Left: Implementer 5 (3 loaded, 1
quiet, 1 alternative), Tester 1. T1/T2: the sixteen named tests plus the four other A1 failures.

**Server 409 and 5xx.** Every full run: exactly two 409s, `POST …/accounts` and `PATCH …/accounts/:id`, the
`name_taken` answers that `e2e/accounts.spec.ts:154` and `e2e/edit-account.spec.ts:89` assert. No 5xx and no
`internal_error` line in any run (~93,000 requests). No failure was a 409 or 5xx.

### Every failed test (spec:line → failing line: first error line — kind)

A1 (quiet):
- `register-entry.spec.ts:309` → `:319`: `expect(locator('.entry-body')).toHaveCount(0)`, received 1 — wait ran out (the row editor still open 5 s after Save)
- `register-entry.spec.ts:466` → `:476`: `toHaveCount(1)` for the "dup" row, received 0 — wait ran out (the saved row)
- `targets-form.spec.ts:332` → `:346`: `getByRole('button', { name: 'Create Target' })` not visible — wait ran out (the target's DELETE answer)
- `transfers.spec.ts:37` → `:45`: `locator('.register-table tbody tr')` `toHaveCount(3)`, received 0 — wait ran out (the page's first data)

A2 (loaded):
- `splits.spec.ts:32` [1600x900] → `:114`: `expect.poll(… transactions.length).toBe(4)`, received 3 — wait ran out (the save's answer)
- `target-snooze.spec.ts:55` [1440x900] → `:85`: switch `aria-checked` expected "false", received "true" — wait ran out (its `PUT …/target-snooze`, answered after 6,425 ms)

A4 (loaded, sampled):
- `splits.spec.ts:123` → `:129` (helper `:19`): rows `toHaveCount(3)`, received 0 — wait ran out (page data)
- `splits.spec.ts:32` [1600x900] and [1024x700] → `:114`: poll expected 4, received 3 — wait ran out (the save's answer)
- `spending-trends.spec.ts:257` → `:260` and `:296` → `:303`: button "Previous Period" not visible — wait ran out (the report's data)
- `target-snooze.spec.ts:55` [1440x900] → `:67`: `aria-checked` expected "true", received "false" — wait ran out (the PUT's answer)
- `target-snooze.spec.ts:90` and `:120` [1440x900] → `e2e/plan-panel.fixtures.ts:93`: `.category-row` not visible — wait ran out (page data)

T3: `scheduled-transactions.spec.ts:151` → `:167`: `getByRole('tooltip')` `toHaveText("Repeats monthly")`, element not found — wait ran out (the tooltip; see EXF-783 below).

T4 (4 workers; all 27 between 04:04:29 and 04:09:38, none after 04:09:48): `month-nav.spec.ts:127` → `:157` ×3
(`dialog` `toHaveCount(0)`); `reconcile.spec.ts:102` → `:161` ×2 (Finish Reconciliation not enabled) and one
30 s test timeout; `register-range.spec.ts:184` → `:231` ×2 (poll) and 2 timeouts; `register-view.spec.ts:254`
3 timeouts; `scheduled-transactions.spec.ts:151` → `:163` (rows `toHaveCount(1)`) and `:53` (Add Transaction
visible); `spending-trends.spec.ts:257`, `:296` 4 timeouts; `splits.spec.ts:32` → `:114`, `:45` and 4
timeouts; `splits.spec.ts:123` → `:148`; `target-snooze.spec.ts:90` → `:116`. All "wait ran out".

## Causes, from the evidence

**1. The test server stops answering for 6 to 11 s (13 of the 15 failures on main; all of T4).** One
`workerd` thread serves every request and runs the local D1 SQLite on the overlay disk. When it waits on the
disk, nothing is answered; every expectation that spans the stall (5 s limit) fails.
- A4 (sampled): 04:01:43 to 04:01:51 the server logged almost nothing; at 04:01:51.3 about 30 requests were
  answered together after 5,909 to 8,316 ms. In those seconds `workerd` was in state `D` (disk wait) and gained
  0.27 s of CPU in 13 s; the box's memory stood at its cap (5,005 of 5,006 MiB; anonymous 4.4 GiB; page cache
  squeezed to ~350 MiB; `memory.max` hit 6,019 times over the run; io stall +7.7 s). All eight A4 failures
  ended between 04:01:43 and 04:01:52.
- A1, A2 (not sampled, same signature): A1 four requests of `transfers.spec.ts:37`'s page answered after
  10,698 to 10,703 ms, and every test running 03:14:44 to 03:14:58 took ~10 s longer; the two
  `register-entry` failures sit in another cluster (every test started 03:13:02 to 03:13:07 ended 03:13:15 to
  03:13:18). A2: four requests answered after 6,303 to 6,559 ms, among them `target-snooze.spec.ts:55`'s PUT.
- Two triggers seen. (a) **Memory at the box's cap with 8 workers** (A4; T2/T3 also peak at 5,004 to 5,005 MiB
  with hundreds of `memory.max` hits). The server's own RSS grows from ~195 to ~960 MiB over a full run. (b)
  **The host's disk busy with neighbours** (T4): memory far below the cap (peak 3,807 MiB, 0 hits) yet the
  server sat in `D` from 04:04 to 04:09:48 with io stall +8.7 s, while the host's load average was 13 before
  the run began; once it cleared, the same tests passed at 2 to 3 s each.
- The CPU quota adds a steady cost: with 8 workers the cgroup is throttled in most periods and "all tasks
  stalled on CPU" (PSI full) is 42% of T3's wall time (129 s of 304 s); at 4 workers 16% (91 s of 586 s).

**2. A spec that acts too early: EXF-783.** `scheduled-transactions.spec.ts:151` hovers the repeat icon while the
add row is still open. The trace (T3): the tooltip is in the DOM right after the hover; 7 ms later it is gone,
and between the two snapshots the add row's `tbody.entry-body` above the scheduled rows was removed, moving
the row up from under the mouse (mouseleave closes `apps/web/src/account/Tooltip.tsx`). Read in the code: the
add row closes in `onSaved`, which runs only after `useCreateScheduled`'s `onSuccess` has awaited the
invalidation of every query of the plan (`apps/web/src/api/scheduledTransactions.ts:35-50`,
`apps/web/src/register/EntryRow.tsx:250-251`), so the new scheduled row shows ~0.3 s before the editor closes.
Cause in one sentence: **the spec hovers before the add row has closed, and the closing moves the icon away from
the mouse.** Not an app fault a person would notice (a tooltip closes when its row moves).

**3. EXF-747** (`reconcile.spec.ts:102`, reproduced 3× only in T4's disk stall): at `:161` "Finish
Reconciliation" stays disabled while the two clears are in flight (EXF-724, by design); their answers came after
the 5 s limit. Cause in one sentence: **the server stall (cause 1) held the two clears' answers past 5 s;**
the spec already waits on the right state.

**4. EXF-727** (`month-nav.spec.ts:127`, reproduced 3× only in T4's disk stall) → `:157`: the picker was open
(`aria-expanded` true) when `page.mouse.click(1000, 500)` came 50 to 75 ms after the opening click, and it
stayed open 5 s. The press lands on an Inspector auto-assign option whose data had just arrived (835 to
2,116 ms answers). `useDismiss` (`apps/web/src/plan/useDismiss.ts`) adds its `mousedown` listener in a
`useEffect`; a probe (not committed) logging listener adds and presses, with the page's CPU throttled 30× (8 of 8
passes), showed the listener added before the press. So "the listener comes too late" is ruled out and **the
cause is not explained**. It is listed as remaining (EXF-727) unless the Implementer's repeats show more.

**Not reproduced:** `register-view.spec.ts:225`, `:302`, `register-view-narrow.spec.ts:117`, `rta.spec.ts:181`
(0 failures in 4 full runs and T1 to T4). The seven register specs' failures of the 18 Nov gate match cause 1,
not the row editor's change: here they failed on main, in stall windows, with their data not yet arrived.

## Decisions

1. **Worker count from the box's quotas** (`playwright.config.ts` `workers: suiteWorkers()`, the function in
   `e2e/support/e2e-load-workers.ts`). CPU: `floor(quota / period) − 1` (one CPU's room for the server).
   Memory: `floor((memory.max − 2 GiB) / 512 MiB)` (2 GiB for the server, the platform's browser and page cache;
   ~390 MiB measured per worker: anonymous 4.4 GiB at 8 workers vs 2.9 GiB at 4). Result: the smaller of the
   two, at least 1, never above Playwright's default (half the visible CPUs); `max` or a missing file drops
   that limit; neither → Playwright's default. `E2E_WORKERS=<n>` (integer ≥ 1) overrides; a CLI `--workers`
   still wins. This box: CPU 4, memory 5 → **4 workers (was 8)**. Evidence: at 8 the memory cap is reached
   (cause 1a) and CPU stall is 42%; at 4, 0 cap hits and 16%. It does not cure cause 1b (host disk).
2. **Wall time.** Before: quiet 409 s (A1), loaded 527 to 548 s (A2, A3), >600 s (A4). After: in undisturbed
   stretches 4 workers finished 0.70 tests/s against 0.75 at 8 (T4 after 04:09:48 vs T3), so a quiet full run is
   expected near 440 s (+~7%). The Implementer's quiet run gives the measured figure; the design's estimate for
   a Build's gate (3 full runs) is ~22 min and a Deploy's gate (1 run, after `pnpm check`) ~7.5 min, both to be
   replaced by the measured figure.
3. **Limits stay**: `retries` 0, expectation 5 s, test 30 s. A longer limit would only hide cause 1; no spec
   gains a retry.
4. **EXF-783** fixed in the spec: test `:151` waits for `.entry-body` to have count 0 (the add row closed) before
   the hover. One line in that test only.
5. **Seeding retry** (`e2e/support/register-seed.ts:16`, 409/5xx up to 4 more times): **removed**. Its stated cause
   ("a busy server … may answer 409 or 5xx") is not real: no seeding 409 or 5xx in ~93,000 answers; the only
   409s are the two asserted ones; slowness is a stall, not an error. The server's 409s come from
   `Conflict`/`LinkRefused` in `auto-assign`, `account-links`, `bank-connections` and the idempotency middleware,
   none of which `call()` hits (it sends no `Idempotency-Key`).
6. **`ECONNRESET` retry** (`e2e/auto-assign.spec.ts:154-163`): **kept, with the confirmed cause in its comment**.
   vite preview serves through `http.createServer(app)` (`node_modules/vite/dist/node/chunks/node.js`,
   `resolveHttpServer`), so Node's default `keepAliveTimeout` of 5000 ms applies (Node v22.14.0, read); Playwright's
   request context reuses sockets (`new http.Agent({ keepAlive: true })`, `playwright-core/lib/coreBundle.js`).
   A request sent as the server closes a socket idle for 5 s gets `ECONNRESET`. Removing it at the root would mean
   changing the vite configuration, out of bounds. The live Worker is not concerned (no Node server in front).
7. **No app change.** No race a person could meet was found (EXF-783 is the spec, EXF-747 is the server,
   EXF-727 is not explained).

## Order of the work

1. The measurement helper (the made load, the report, the table line), committed first so that every later run
   uses the same one.
2. The Architect's three runs and the design's table and causes.
3. The suite's setting (worker count from the quota, if the evidence supports it), with its before and after.
4. Each spec or app fix, one commit each, with its failing line before and its repeats after.
5. The two work-arounds of note 6.
6. The three loaded runs and the quiet run on the final head; the conventions' section.

## Acceptance

1. `pnpm check` passes. (Seen once in this box: `test/credit-call-count.test.ts:170` timed out at 5 s under the
   host's load and passed 4 of 4 alone; vitest is out of bounds here. If it recurs, report it, do not edit it.)
2. `pnpm exec playwright test --list` lists 610 tests or more (610 on main, 1 of them skipped), plus the new
   no-page tests of `e2e/e2e-load-workers.spec.ts`. The only `test.skip` remain `e2e/payee-picker.spec.ts:34`
   and `e2e/bank-connections-sandbox.spec.ts:10`; `retries` is 0; no spec gains a retry.
3. `e2e/e2e-load-workers.spec.ts` passes and covers: `"500000 100000"` with `"max"` memory and 16 CPUs → 4;
   `"max 100000"` and no file → `undefined`; `"150000 100000"` → 1; 16-CPU quota on 16 CPUs → 8 (the
   default cap); memory `5249171456` with `"max"` CPU on 16 CPUs → 5; `E2E_WORKERS=2` → 2;
   `E2E_WORKERS=0` or `abc` → ignored.
4. In this box a full run prints `Running … tests using 4 workers`; with `E2E_WORKERS=2` it prints 2 workers.
5. EXF-783: `scheduled-transactions.spec.ts:151` run once under load **before** the fix (T3's failing line
   `:167` quoted; the Implementer adds its own run's result) and **20 times under load after** with
   `--repeat-each=20`: 20 of 20.
6. EXF-747 and EXF-727: `reconcile.spec.ts:102` and `month-nav.spec.ts:127` `--repeat-each=20` under load at 4
   workers: results reported; a failure is quoted with its line, its time and the server's answers ≥ 5 s and
   cgroup sample at that time.
7. **Three loaded full runs** (helper, load on) and **one quiet full run** on the final head, each with its table
   line: none of the sixteen named tests fails, or every remaining failure is listed with its line, its kind,
   its ticket and the stall evidence (server answers ≥ 5 s in the run's log; the server's `D` state in
   `cgroup.tsv`). The quiet run passes.
8. The table of all runs in the Implementer's report gives the wall time before (A1 409 s quiet, A2/A3 ~540 s
   loaded) and after, and the gate costs in minutes.
9. `docs/conventions.md` has a short section "Browser suite: workers and load" (how the count is chosen,
   `E2E_WORKERS`, how to run under the made load with `scripts/e2e-load.sh`/`-bg.sh`).
10. Looking (below). 11. The Tester's own loaded run (note 8 of the brief).

### Looking

There is no screen in this Build, so there is no list of states to look at. The Designer's complete and
acceptable answer is "nothing to compare: no screen changed" (if a fix under note 6 does change a screen, the
Designer compares that screen inside the clone only, at 1440×900 and 1024×700). **The Tester's main work is note
8: one full run under the made load, by its own hand, with its table line.**

## Found, not fixed

1. **The test server stalls on disk waits** (cause 1b): local D1 SQLite on a disk the host shares; no tmpfs is
   large enough in the box. Platform matter (a memory-backed or quieter disk for `.e2e-state`). Not met by a
   person: the live Worker uses D1, not a local file.
2. **The server's RSS grows ~195 → ~960 MiB over a full run** (A4 `cgroup.tsv`); not investigated (miniflare's
   local runtime or the app's isolate).
3. **The host is busy while "nothing else runs"**: gates here measure neighbours too (EXF-576's concern).
4. **The agent shell's 10-minute limit** makes "foreground, 30-minute timeout" impossible for a full run: steps use
   `scripts/e2e-load-bg.sh start`, then `wait` (blocks up to 540 s, repeat until it exits 0 or 1).

## Out of scope

The gate's handling of flakes (EXF-576); EXF-631 items 1 and 3; vitest and vite configuration; any product
file; `scripts/deploy.sh` (its gate runs `pnpm e2e`, so it follows the config by itself).

## Manifest

touches: [playwright.config.ts, scripts/e2e-load.sh, scripts/e2e-load-bg.sh, scripts/e2e-load-report.mjs, scripts/e2e-load-sample.sh, scripts/e2e-load-stamp.mjs, e2e/support/e2e-load-workers.ts, e2e/e2e-load-workers.spec.ts, e2e/scheduled-transactions.spec.ts, e2e/support/register-seed.ts, e2e/auto-assign.spec.ts, docs/e2e-load-design.md, docs/e2e-load-spec.md, docs/README.md, docs/conventions.md]
shared: []
migrations: 0

## Implementer's runs (final head `fac72a0`, 4 workers; full runs used by the Implementer: 4 of 5; 8 of 10 overall)

| run | load | wall s | passed/total (1 skipped) | failed | server answers ≥ 1 s, max ms |
|---|---|---|---|---|---|
| I1 | on | 614 | 616/617 | 0 | 1, 1,161 |
| I2 | on | 663 | 615/617 | 1: `month-nav.spec.ts:127` → `:157` (EXF-727) | 5, 1,627 |
| I3 | on | 649 | 616/617 | 0 | 1, 1,507 |
| I4 | off | 403 | 616/617 | 0 | 0, 838 |

Quiet wall time: 409 s at 8 workers, 403 s at 4. Loaded: 527 to 548 s at 8, 614 to 663 s at 4 (slower, but no
stall-induced failure). A Build's gate (3 runs) costs about 20 min quiet; a Deploy's gate about 7 min.
EXF-783 (`scheduled-transactions.spec.ts:151`): 20/20 before and 20/20 after under load (not reproduced at 4
workers). EXF-727 reproduced without a stall: targeted run `I-rec` 3 of 20 failed (`:157`, slowest answer 953
ms), and I2; the cause remains unexplained (traces under `/workspace/scratch/e2e-load/I-rec/test-results/`).
EXF-747 (`reconcile.spec.ts:102`): 20/20 under load.
