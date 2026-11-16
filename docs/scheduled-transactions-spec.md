# Scheduled transactions spec (EXF-497, EXF-499)

Implementation tasks for [scheduled-transactions-design.md](scheduled-transactions-design.md). Do them in order.
After each task, `pnpm check` must pass. Delete `.e2e-state` after adding the migration. Follow
`docs/conventions.md`; the design's rules are the contract.

Never edit:
- `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`, `mcp-descriptions.test.ts`,
  `e2e/mcp.spec.ts`;
- `e2e/support/real-click.ts`, `bulk-call-count.test.ts`;
- anything in note 10: `packages/core/**`, the accounts, categories, months and targets
  services/repositories/routes, `apps/web/src/{plan,shell,shortcuts,menu-actions,reflect}/**`,
  `apps/web/src/api/accounts.ts`, `wrangler.jsonc`, `env.ts`, `app.ts`, and every `paths.always_overlap` file.

## 1. Recurrence: `packages/schema/src/recurrence.ts` (+ `packages/schema/test/recurrence.test.ts`)

```ts
export const FREQUENCIES = ["never","daily","weekly","everyOtherWeek","twiceAMonth","every4Weeks","monthly",
  "everyOtherMonth","every3Months","every4Months","twiceAYear","yearly","everyOtherYear"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const FREQUENCY_LABELS: Record<Frequency, string>;   // "Never" … "Every other year" (design, case 1)
export function repeatTooltip(f: Frequency): string | null;  // "Repeats monthly"; null for never
export function occurrenceAfter(anchor: string, f: Frequency, after: string): string | null;
export function nextDate(anchor: string, f: Frequency, current: string): string | null; // = occurrenceAfter
export function savesAsScheduled(date: string, f: Frequency, today: string): boolean;   // date > today || f !== "never"
export type Placement =
  | { kind: "schedule"; dateNext: string }
  | { kind: "enterAndSchedule"; enterDate: string; dateNext: string }
  | { kind: "notScheduled" };
export function placeSchedule(date: string, f: Frequency, today: string): Placement;
/** Due entry: null when dateNext > day; else the date to enter and the new date_next (null = remove). */
export function dueStep(anchor: string, f: Frequency, dateNext: string, day: string):
  { enterDate: string; dateNext: string | null } | null;
export function dayBefore(iso: string): string;   // for the cron
```

- Use UTC `Date` arithmetic on `YYYY-MM-DD`, with no time zone.
- Compute k directly: `floor(diffDays / n) + 1` for day steps, and the month difference for month steps. Never
  loop over every day.
- Month steps: `addMonthsClamped(anchor, k·m)` keeps the anchor's day and clamps it to the month's end.
- Twice a month (design): d > 15 gives the days {d−15, d}; d ≤ 15 gives {d, d+15}. Both are clamped, and only
  dates on or after the anchor count.

Tests (one `it` per line, ISO dates):
- weekly: 2026-11-15 → 11-22;
- monthly from 2026-12-31: 2027-01-31, 02-28, 03-31, 04-30;
- monthly from 2028-01-31: 2028-02-29;
- twice a month:
  - from 2026-11-20: 12-05, 12-20, 2027-01-05, 01-20;
  - from 2026-12-10: 12-25, 2027-01-10;
  - from 2027-01-31: 02-16, 02-28, 03-16, 03-31;
- yearly from 2028-02-29: 2029-02-28, 2030-02-28, 2031-02-28, 2032-02-29;
- every other year from 2028-02-29: 2030-02-28, 2032-02-29;
- daily, every other week, every 4 weeks, every other month, every 3 months, every 4 months, twice a year: one
  step each;
- `occurrenceAfter("2026-11-01","weekly","2026-11-15")` = 2026-11-22;
- an anchor after `after` returns the anchor;
- never: the anchor or null;
- `placeSchedule`: all three kinds, with today on the last day of a month (2026-11-30) and of a year
  (2026-12-31);
- `dueStep`: a missed run (anchor 2026-10-01 weekly, day 2026-11-15) enters 10-01 and moves to 11-19;
- a daily anchor ten years back is computed with no loop: assert the result only.

## 2. API shapes: `packages/schema/src/scheduled-transactions.ts` (+ test)

Import `z` from `@hono/zod-openapi`; check dates with `IsoDate` and `isCalendarDate` (from `transactions.ts`).
Define its own `Today` (a real date). Do **not** import it from `targets.ts`, which belongs to another Build.

- `Frequency = z.enum(FREQUENCIES)`.
- `ScheduledTransaction`:
  - `id`, `account_id`, `account_name`;
  - `date_first`, `date_next`, `frequency`, `amount: Milliunits`;
  - `payee_id`, `payee_name`;
  - `category_id`, `category_name`, `category_group_name` (each nullable);
  - `inflow_to_ready_to_assign: boolean`, `memo` (nullable), `flag_color: FlagColor` (nullable);
  - `deleted: boolean`, `created_at`, `updated_at`.
- `ScheduledTransactionCreate` (`.strict()`, so `date_next`, `transfer_account_id` and `subtransactions` are
  refused with 422):
  - `account_id`, `date_first` (a real date), `frequency` (default `never`), `amount`;
  - optionally `payee_id` or `payee_name`;
  - optionally `category_id` (nullable), `inflow_to_ready_to_assign`, `memo` (nullable), `flag_color` (nullable).
- `ScheduledTransactionUpdate`: the same fields, every one optional, at least one present, strict.
- `ScheduledBulkRequest`: `{ op: "enter_now" | "delete", ids: z.array(z.string().min(1)).min(1).max(100) }`.
- `TodayQuery`: `{ today?: Today }`.
- Responses, each wrapped in `dataEnvelope`:
  - `ScheduledTransactionResponse`: `{ scheduled_transaction }`;
  - `ScheduledTransactionListResponse`: `{ scheduled_transactions }`;
  - `ScheduledCreateResponse`: `{ scheduled_transaction, transaction: TransactionDetail | null }`;
  - `ScheduledEnterResponse`: `{ transaction: TransactionDetail, scheduled_transaction }`;
  - `ScheduledBulkResponse`: `{ op, results: [{ id, transaction: TransactionDetail | null, scheduled_transaction }], skipped: [{ id, reason: "changed" }] }`;
  - `EnterDueResponse`: `{ day, entered: [{ scheduled_transaction_id, transaction_id, date }], has_more }`.
- Constants:
  - `SCHEDULED_BULK_MAX = 100`;
  - `SCHEDULER_MAX_PER_RUN = 100`;
  - `SCHEDULER_CRON_CALLS = 3`;
  - `SCHEDULER_ACTOR = "service:scheduler"`;
  - `CREATE_NOT_SCHEDULED = "A transaction dated today or earlier that does not repeat is not scheduled: create a transaction instead"`;
  - `EDIT_NOT_SCHEDULED = "A scheduled transaction needs a date after today or a repeat: use Enter Now to record it today"`.

Test: the strict refusals, an unknown frequency, and `2026-02-30`.

## 3. Migration and table

`apps/worker/migrations/20261116101200_scheduled_transactions.sql`, with the columns of the design's Tables
section:
- `budget_id TEXT NOT NULL REFERENCES budgets(id)`;
- `account_id TEXT NOT NULL REFERENCES accounts(id)`;
- `payee_id TEXT REFERENCES payees(id)`, `category_id TEXT REFERENCES categories(id)`;
- `inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0`;
- `write_token TEXT NOT NULL`;
- the three indexes, with a one-line comment above each.

Drizzle: `apps/worker/src/db/schema/scheduled-transactions.ts` (`scheduledTransactions`, with `frequency`
`{ enum: FREQUENCIES }` and `flagColor` `{ enum: FLAG_COLORS }`). Verify with `schema-drift.test.ts`.

## 4. Repository: `apps/worker/src/repositories/scheduled-transactions.ts`

Reads are set queries. They join `accounts` (`deleted_at IS NULL AND closed = 0`), `budgets` (not deleted),
`payees` (for the name), and `categories` with `category_groups` (both not deleted, for the names; a deleted
category reads as null).
- `listForPlan(db, budgetId, { accountId? })` → `ScheduledRow[]`, ordered by `date_next, id`.
- `findMany(db, budgetId, ids, { includeDeleted? })` → `Map<id, ScheduledRow>`. It has no closed filter, and each row
  carries `accountClosed` and `accountOnBudget`, so bulk can answer 422 and not 404.
- `listDue(db, { budgetIds: string[] | "all", day, limit })` → at most `limit + 1` rows, ordered by `date_next, id`.
- `insertStmt(db, row)`.
- `updateIfStmt(db, id, set, read: { dateNext, writeToken })`: the gate (design). It always sets a new
  `write_token` and `updated_at`.
- `softDeleteIfStmt(db, id, at, token, read)`.
- `writtenWith(db, id, token)` → the `EXISTS` guard for `changeLogInsertIf` and `txRepo.insertIfStmt`.

## 5. The transactions service: one exported helper (`services/transactions.ts`)

```ts
/** A plain transaction from a schedule: its insert and its create log row, both written only while `guard` holds. */
export function enteredTransactionWrites(db: Db, actor: string, row: txRepo.TransactionRow,
  names: { categoryName: string | null; groupName: string | null }, guard: SQLWrapper): unknown[];
```

It returns `[txRepo.insertIfStmt(db, row, guard), changeLogInsertIf(db, { …create, after: logShape({ ...row, ...names }) }, guard)]`.
Also export `MAX_ATTEMPTS`, or copy it locally. Make no other change in this file: its existing tests must pass
unchanged.

## 6. Service: `apps/worker/src/services/scheduled-transactions.ts`

Signature `(env, actor, budgetId, …)`. Errors: `TransactionRefused` and `NotFound`. `today` defaults to the
server's UTC date.

- `listScheduled(env, budgetId, { accountId? })` and `getScheduled(env, budgetId, id)`. GET answers 404 for a
  schedule that is deleted or whose account is closed or deleted.
- `createScheduled(env, actor, budgetId, input, today)`:
  - Checks: the plan is active; the account is found (else 422 "Account not found in this plan"); the account is
    not closed (else `account_closed` with `CLOSED_NO_NEW`); the tracking, category and RTA rules hold; the
    category is active; `resolvePayee` succeeds (with the retry loop on a unique violation).
  - `placeSchedule`: `notScheduled` → 422 `CREATE_NOT_SCHEDULED`.
  - One batch: the payee insert and its log, the schedule insert and its `create` log, and for `enterAndSchedule`
    `enteredTransactionWrites` with `approved false`, `cleared uncleared`, the date `enterDate` and a guard
    `writtenWith(id, token)`.
  - Returns `{ scheduled_transaction, transaction }`, read back.
- `updateScheduled(env, actor, budgetId, id, patch, today)`:
  - It merges the patch and re-checks the rules.
  - The anchor is `patch.date_first`; or, when only `frequency` changed, `before.date_next`; otherwise it is
    unchanged and `date_next` is kept.
  - When the anchor or the frequency changed, it runs `placeSchedule(anchor, f, today)`: `notScheduled` → 422
    `EDIT_NOT_SCHEDULED`; `enterAndSchedule` enters one unapproved row, as create does.
  - One guarded batch: `updateIfStmt`, then the `update` log and any entered row under `writtenWith`. When the
    gate fails, answer 409 `conflict` "The scheduled transaction changed; reload it".
- `deleteScheduled`: a guarded soft delete plus a `delete` log. It answers `{ scheduled_transaction }` with
  `deleted: true`.
- `bulkScheduled(env, actor, budgetId, { op, ids }, today)`:
  - It reads the plan (1 call) and `findMany` (1 call). An unknown id → 404 for the whole request; a closed account
    → 422 `account_closed`.
  - `enter_now`:
    - the row: `{ id: uuid, date: today, approved: true, cleared: "uncleared" }`;
    - `date_next = nextDate(date_first, f, date_next)`, or a soft delete when that is null (never);
    - four statements per schedule, as the design says.
  - `delete`: two per schedule (the gate as a soft delete, then the log under `writtenWith`).
  - One batch, then one `txRepo.findDetailMany` and one `findMany` (including deleted rows) for the response.
  - A schedule whose gate wrote nothing is listed under `skipped: [{ id, reason: "changed" }]`.
  - D1 calls: **5 for `enter_now` and 3 for `delete`, whatever the number of ids**.
- `enterScheduledNow(…, id, today)` = `bulkScheduled` with `[id]`. It throws 409 `conflict` if the schedule was
  skipped, and returns `{ transaction, scheduled_transaction }`.
- `enterDue(env, { budgetIds, day, actor, limit = SCHEDULER_MAX_PER_RUN })`:
  - `listDue` (1 call), with no plan check here (the route checks the plan);
  - `dueStep` for each row, and an entered row with `date: enterDate`, `approved: false`, `cleared: "uncleared"`;
  - one batch, when there is anything to write;
  - it returns `{ day, entered, has_more }`, where `entered` holds only the schedules whose gate wrote. To know
    which did, read the batch's `meta.changes` of each gate statement.
- No D1 call inside a per-row loop.

## 7. Routes: `apps/worker/src/routes/scheduled-transactions.ts`

- Copy the transactions route's `defaultHook`, its `errors` and its `refusals` wrapper.
- Params: `budget_id`, `scheduled_transaction_id`.
- Register the static paths (`/bulk`, `/enter-due`) **before** `/{scheduled_transaction_id}`.
- Status codes: 201 for create, `enter` and `bulk` `enter_now`; 200 for the rest.
- `enter-due`: check the plan (404), then `enterDue({ budgetIds: [budget_id], day: today, actor: SCHEDULER_ACTOR })`.
  Both callers log `service:scheduler` (note 6); the REST and MCP caller's own actor is not used here.

Test (`apps/worker/test/scheduled-transactions.test.ts`):
- REST for cases 2, 4, 5, 9–16, 18;
- the change_log rows and their actors;
- 404s for another plan's id;
- atomicity: a failing batch leaves no row and no log;
- `expect(await apiPaths()).toEqual(expect.arrayContaining([...the 6 paths]))`.

## 8. MCP tools: `apps/worker/src/mcp/tools/scheduled-transactions.ts`

The seven tools of the design.

Inputs:
- every tool takes `budget_id: Id`;
- `id: Id` where there is one;
- `today: IsoDate.optional()` on create, update, enter and enter-due;
- create and update take the body's fields;
- the `frequency` enum is `FREQUENCIES`.

Each description:
- starts with what the tool does;
- says "Scheduled splits and scheduled transfers are not supported";
- carries `MONEY`, the `dates("date_first", "date_next", "today")` (enter: plus `"date"`) and
  `timestamps(["created_at", "updated_at"])`;
- ends with `Returns { … }` and its main fields.

The other texts:
- `enter_due_scheduled_transactions` says it uses `today`, or else the server's UTC date, and that it enters at
  most 100 per call (call again while `has_more`).
- `enter_scheduled_transaction_now` says the row is dated today and approved.

Coverage: `apps/worker/test/mcp-coverage/scheduled-transactions.ts`, with the 8 operations. Its `/bulk` line:

```ts
{ tool: ["enter_scheduled_transaction_now", "delete_scheduled_transaction"],
  note: "the register's selection; the tools take one id per call" }
```

`mcp-timestamps.test.ts`:
- seed `sched` and `sched2` (two Monthly series, dated in the future, through REST) in `seed()`;
- add one `CALLS` entry per tool, with delete and enter last and on separate schedules.

Test: `listedToolNames()` contains the seven tools, and the MCP actor is `mcp:…` in the change_log.

## 9. Cron and the shared budget

- `plaid-sync.ts`: `syncDueConnections(env, now, run, opts: { maxRuns?: number } = {})`. The runs cap is
  `opts.maxRuns ?? SCHEDULED_MAX_RUNS`; nothing else changes.
- `scheduled.ts`:

```ts
export async function cronRun(env: Env, now: Date = new Date(), run = requestSync): Promise<void> {
  try { await enterDue(env, { budgetIds: "all", day: dayBefore(now.toISOString().slice(0, 10)), actor: SCHEDULER_ACTOR }); }
  catch { console.error("scheduler failed"); }
  await syncDueConnections(env, now, run, { maxRuns: SCHEDULED_MAX_RUNS - SCHEDULER_CRON_CALLS });
}
```

`scheduled()` calls `cronRun(env)` under `ctx.waitUntil`. Remove the TODO's mention of this Build, and keep the
backup part of the TODO.

## 10. Call counts and races: `apps/worker/test/scheduled-transactions-calls.test.ts`

Copy the `counting()` wrapper from `bulk-call-count.test.ts`.

Counting:
- `enter-due` (the service through a counting env) for 10 and for 100 due schedules: equal counts, ≤ 3.
- `bulkScheduled enter_now` and `delete` for 10 and for 100 ids: equal counts, ≤ 5 and ≤ 3.
- create ≤ 7, update ≤ 8, list ≤ 2.
- `cronRun`:
  - `now = 2026-11-17T03:00:00Z`;
  - 150 due schedules over 3 plans (one due 2026-11-17, which must **not** be entered);
  - 45 due `bank_connections` rows inserted by SQL;
  - a stub `run` that counts.
  - Assert: D1 calls + runs ≤ 41; runs ≤ 37; the scheduler's calls ≤ 3; 100 entered with actor
    `service:scheduler`; `has_more` left for the next run.
- Log one line of figures: `scheduled-calls: enter-due 10=x 100=y; bulk 10=… 100=…; cron d1=… runs=…`.

Races (case 19):
- `Promise.all` of two `enterScheduledNow` on one schedule → one transaction, `date_next` one step, and the other
  call's 409;
- `Promise.all` of two `enterDue` over 5 due schedules → 5 transactions.
- Also a unit test that a gate whose token changed between the read and the batch writes nothing: change it in a
  `beforeWrite` hook, as `bulkTransactions` does.

## 11. Web API: `apps/web/src/api/scheduledTransactions.ts`

- `useScheduledTransactions(budgetId, accountId?)`: key `["scheduled-transactions", budgetId, accountId ?? "all"]`,
  `placeholderData: keepPreviousInPlan(budgetId)`.
- `useCreateScheduled`, `useUpdateScheduled`, `useScheduledBulk`: each sends `?today=${localToday()}` and, on
  success, invalidates every query whose key includes `budgetId` (as `api/transactions.ts` does).
- `useEnterDueOnOpen(budgetId)`: the design's rules.
  - A module-level `Map<string, string>`.
  - Triggers: mount, `focus`, `visibilitychange` and a 60 s interval.
  - At most 5 calls while `has_more`.
  - It invalidates when `entered.length > 0`.

Call `useEnterDueOnOpen(budgetId)` in `pages/account.tsx` and `pages/accounts.tsx`.

## 12. Register

- **`icons.tsx`:** `RepeatIcon` and `CalendarIcon` (Budget's own SVGs, `currentColor`).
- **`register.css`:**
  - the two custom properties;
  - `.scheduled-header` (the button fills the cell: 14px, weight 600, `--register-scheduled-header-bg`);
  - `.scheduled-row td { color: var(--register-scheduled-label) }`;
  - `.scheduled-spacer` (8px);
  - `.col-date { width: 112px }`;
  - `.calendar-repeat` (a flex row: the label, then a select at 100% width, `--font-size-sm`).
- **`Calendar.tsx`:**
  - New optional props `frequency?: Frequency` and `onFrequency?: (f) => void`.
  - When `onFrequency` is given, render `<label>Repeat:</label><select aria-label="Repeat">` with
    `FREQUENCY_LABELS`.
- **`DateField.tsx`:**
  - Pass the two props through.
  - `onBlur`: if `e.relatedTarget` is inside the calendar (a ref on the Dropdown's root), keep it open.
  - The select's `onChange` sets the frequency and then refocuses the input; `Escape` in the select closes it
    only.
- **`entryDraft.ts`:**
  - `Draft.frequency` (`"never"` by default).
  - `draftFromScheduled(s)`.
  - `draftToScheduledCreate(d, accountId, today)`.
  - `draftToScheduledPatch(before, d, today)`: send `date_first` when the date differs from `date_next` or the
    frequency changed; otherwise send only the changed fields.
- **`entryDraft.ts`, `Open`:** add `{ mode: "editScheduled"; id: string; focus: Field }`.
- **`EntryRow.tsx`:** a `scheduled?: ScheduledTransaction` prop and the `editScheduled` mode.
  - Show the Repeat select in add and `editScheduled` modes.
  - Saving in add mode with `savesAsScheduled`: if it is a split or a transfer, show the design's message and
    stop; otherwise call `useCreateScheduled`.
  - `editScheduled`:
    - no cleared toggle;
    - payee `transfers={false}`;
    - split disabled with the title "Scheduled splits are not available yet";
    - a date on or before today with Never shows `EDIT_NOT_SCHEDULED` and does not save;
    - otherwise PATCH.
- **New `ScheduledSection.tsx`:**
  - the header row, the rows (sorted with `sortTransactions` over `{ ...s, date: s.date_next }` with the table's
    sort) and the spacer;
  - the collapse flag in `sessionStorage`;
  - an edit row in place when `open.mode === "editScheduled"`;
  - row clicks as the design says;
  - the `Tooltip` from `../account/Tooltip` on the repeat icon (`aria-label` = the tooltip text);
  - the flag shown with `FlagFilledIcon` and its colour class, with no button.
- **`RegisterTable.tsx`:**
  - Render `<ScheduledSection>` after the add row.
  - "No transactions" shows only when there are no real and no scheduled rows.
  - Selecting a real row calls `setScheduled([])` (via `set`).
- **`selection.tsx`:**
  - Add `scheduled`, `setScheduled`, `toggleScheduled`, `scheduledRows` and `setScheduledRows`.
  - `set` and `toggle` clear `scheduled`; `setScheduled` and `toggleScheduled` clear `selected`.
  - `clear` clears both.
- **`ActionBar.tsx`:**
  - When `scheduled.size > 0`, render the scheduled bar: the count label, Enter Now (Tip key `E`), Categorize and
    Flag `disabled`, and More.
  - The More menu passes `scheduled` to `MoreMenu`, which then marks Duplicate, Memo..., Move to Account and
    Export disabled (`{ ticket: "later", title: "Not available for scheduled transactions yet" }`) and drops
    Approve, Reject, Mark as cleared and Make Repeating.
  - Delete calls `useScheduledBulk({ op: "delete" })` with no dialog.
  - Enter Now calls `useScheduledBulk({ op: "enter_now" })` and then clears the selection.
  - If the request fails, show its message in the bar's existing error place.
- **`useRegisterKeys.ts`:** an optional `enterNow`, bound to `e` (no shift). When the selection is scheduled,
  pass only `enterNow`, `del`, `clearSelection` and `selectAll`.

## 13. Specs: `e2e/scheduled-transactions.spec.ts` (+ `e2e/support/scheduled-seed.ts`)

- Each test makes its own plan and accounts through the API (as `register-seed.ts` does) and sets
  `page.clock.setFixedTime`.
- Every click in the register uses `realClick` from `e2e/support/real-click.ts`.
- Use exact names, wait on requests with `expect.poll`, and pick the Repeat value with `selectOption`.
- Cases 1–3, 6–9, 12–16, 20–22. Run cases 2, 12 and 14 under each of three clocks: 2026-11-15, 2026-11-30 and
  2026-12-31 (local noon).
- Case 21 at `page.setViewportSize({ width: 1024, height: 700 })`: measure `scrollWidth ≤ clientWidth` for the
  select showing "Every other month", the tooltip "Repeats every other month", the date cell of a repeating row,
  and the header.
- Case 20 samples the DOM in a `page.evaluate` loop of `requestAnimationFrame` for 2 s after the click.
- Existing register specs: change one only when it asserts what changed (the `col-date` width, "No transactions"),
  and list each change in the report.

## Verify

- `pnpm check`.
- `pnpm e2e e2e/scheduled-transactions.spec.ts e2e/register.spec.ts e2e/register-entry.spec.ts e2e/register-bulk.spec.ts e2e/all-accounts.spec.ts --repeat-each=2`.
- Report the counting test's line, and confirm `git diff --stat origin/main` touches no file of note 10.

## Carry-over (this Build)

The code is written and accepted; see the design's "Carry-over". Run `pnpm check` and the spec list there once, with
no `--repeat-each`. Change code only for a failure caused by the merge or for a Reviewer or Tester finding; never edit
`apps/web/src/shortcuts/**`, `apps/web/src/shell/**`, `e2e/support/real-click.ts` or a file of the Lead's
out-of-bounds list. Report counts per command and `git diff --name-only origin/main...HEAD` against the manifest.
