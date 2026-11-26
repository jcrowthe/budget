# Scheduled transactions design (EXF-497, EXF-499)

Future and repeating transactions (EXF-497) and how a schedule becomes a real transaction: Enter Now, and
entering what is due (EXF-499). One feature, one pull request. Spec:
[scheduled-transactions-spec.md](scheduled-transactions-spec.md). "Note *n*" means the Lead's scope notes in
this Build's brief; they override the tickets where they differ.

## Source

Notes: `/workspace/scratch/source/scheduled-transactions/notes.md` (one capture, `00-register-top.png`).
**Nothing of this feature could be compared.** The test plan has no scheduled transactions, and its Add
Transaction button is disabled (only closed accounts), so the calendar and Repeat select are out of reach.
Read from ordinary rows: 36px high, 14px/500 text, 1px bottom border; columns checkbox, flag, image, Account,
Date, Payee, Category, Memo, Outflow, Inflow, cleared. All else comes from the tickets and is **not compared**.

This step, through a sub-agent, in this Thread's tab only:
- It moved the tab once, from `/budget` to the test plan's `/accounts`.
- It made one click on the disabled Add Transaction button, which never fired.
- It pressed no key.
- It took one capture with `page.screenshot()` and no options, after `bringToFront()`. The tab was 1600×813
  before and after. The capture was cropped to drop the sidebar, and the raw file was deleted.

It saved and entered nothing, and left nothing selected and no add row open. It wrote nothing into the page and
changed neither the theme nor the tab's size. It opened no plan menu, Bank Connections, Add Account or other plan.

## Tables

**One table is added: `scheduled_transactions`** (migration `20261116101200_scheduled_transactions.sql`,
additive). Schedules never live in `transactions`. So no query that sums or counts `transactions` changes, and
these all ignore schedules: balances, sidebar totals, the Plan (activity, Ready to Assign), reports and Age of
Money (note 8).

Columns:
- `id` PK; `budget_id`, `account_id`;
- `date_first`, the anchor every occurrence is computed from; `date_next`, the next occurrence not yet entered;
- `frequency`; `amount` in milliunits;
- `payee_id`, `category_id` (both nullable); `inflow_to_ready_to_assign` 0/1;
- `memo`, `flag_color`;
- `write_token`, a new uuid on every write: the race guard, never in the API;
- `created_at`, `updated_at`, `deleted_at`.

Indexes: `(budget_id, date_next)`, `(date_next) WHERE deleted_at IS NULL`, `(account_id)`. There are no transfer
or split columns (note 1, EXF-501).

## Recurrence (pure, `packages/schema/src/recurrence.ts`, unit-tested)

The values are the ticket's 13, spelled as the ticket spells them (`never` … `everyOtherYear`), with the labels
of acceptance case 1. The tooltip is `Repeats ` plus the label in lower case.

The occurrences of a series anchored at `date_first`:
- **Day steps** are `date_first + k·n` days: daily n=1, weekly 7, every other week 14, every 4 weeks 28.
- **Month steps** are `date_first + k·m` months: monthly m=1, every other month 2, every 3 months 3, every 4
  months 4, twice a year 6, yearly 12, every other year 24. Each occurrence is clamped to the month's end, and
  the **anchor's day is kept**: from 12/31 the dates are 01/31, 02/28, 03/31, 04/30. A Yearly series from
  2028-02-29 gives 2029-02-28 and then 2032-02-29.
- **Twice a month:** let d be the anchor's day.
  - d > 15: the days are d−15 and d. From the 20th: 12/05, 12/20, 01/05, 01/20 (the ticket's example).
  - d ≤ 15: the days are d and d+15. From the 10th: the 10th and the 25th (**decided by the Lead; not compared**).
  - From the 31st: the 16th and the month's end (02/16, 02/28, 03/16, 03/31). This is the d > 15 rule with the
    clamp. **Decided here; not compared.**
  - Every day is clamped to the month's end, and only days on or after `date_first` count.
- **Never** has one occurrence, `date_first`.

Functions:
- `occurrenceAfter(anchor, f, after)` gives the first occurrence strictly after `after`, or null. It is computed
  directly, with no loop over the days or months in between.
- `nextDate(anchor, f, current)` is one step: `occurrenceAfter(anchor, f, current)`.
- `placeSchedule(date, f, today)` gives the create and edit rule below.
- `savesAsScheduled(date, f, today)` is `date > today || f !== "never"`.

## The rules (Worker: `services/scheduled-transactions.ts`)

**Create, and an edit that changes the date or the frequency** (note 4). The add row and a scheduled row's
edit row use the same rule:
1. Date after `today`, any frequency: a schedule with `date_next = date`. Nothing is real.
2. Date on or before `today`, frequency not Never:
   - one real transaction on that date, **approved false**, uncleared, made by the transactions service;
   - `date_next = occurrenceAfter(date, f, today)`.

   For example, Weekly dated 14 days ago gives one row on that date and a series due on the first weekly date
   after today. The missed occurrences are not entered.
3. Date on or before `today` with Never is **not a schedule**: 422 `unprocessable_entity`.
   - Create answers "A transaction dated today or earlier that does not repeat is not scheduled: create a
     transaction instead".
   - Edit answers "A scheduled transaction needs a date after today or a repeat: use Enter Now to record it today".

**Other rules:**
- An account that is closed is refused with 422 `account_closed`, using the transactions service's
  `CLOSED_NO_NEW` text. A deleted or unknown account is 422 "Account not found in this plan".
- A tracking account takes no category and no Ready to Assign mark (422, the transaction rule's text). Category
  and the mark exclude each other.
- Category is optional.
- `payee_name` creates the payee as `resolvePayee` does, with the race retry. System payees are refused.

**Edit** changes the whole series.
- When `date_first` is sent, it becomes the new anchor.
- When only `frequency` is sent, the series is re-anchored at its current `date_next`. So `date_next` stays the
  same, and a 31st anchor that had been clamped to the 28th keeps the 28th (**decided; not compared**).
- Every other field changes in place.

**Enter Now** (one or several schedules):
- Each schedule gives a real transaction dated **`today`**, **approved true**, uncleared, with the schedule's
  account, payee, category (or the Ready to Assign mark), memo, amount and flag.
- A repeating schedule moves one step from its scheduled date: `date_next = nextDate(date_first, f, date_next)`.
  So 11/25 Monthly becomes 12/25.
- A one-off (Never) is soft-deleted, and its answer has `deleted: true`.
- If the category was deleted since, the entered row has no category ("needs a category"). The same applies to
  entering what is due.

**Entering what is due** (note 6; **decided by the Lead; not compared**):
- One function, `enterDue(env, { budgetIds | "all", day, actor, limit })`.
- Every schedule with `date_next ≤ day` whose plan, account and schedule are live and whose account is open gets
  one real transaction dated `date_next`, **approved false**, uncleared.
- Then `date_next = occurrenceAfter(date_first, f, day)`: missed occurrences in between are not entered, and a
  one-off is removed.
- The oldest `date_next` goes first, and at most `SCHEDULER_MAX_PER_RUN = 100` schedules are entered in one call.
  The rest are left for the next call, and `has_more` says so.
- History rows carry the actor **`service:scheduler`** for both callers (the web app's call and the cron).

**Closed and deleted accounts.** Schedules on them are not listed, not entered and not found by GET (404).
Nothing is deleted, and reopening the account shows them again. Nothing in the accounts service or repository
changes (note 6): the reads join `accounts` themselves.

### Atomicity and the race guard

Every change is one `db.batch` with its `change_log` rows (`entity_type` `scheduled_transaction`; an entered
transaction logs its own `create`).

To enter one schedule, the batch holds:
- a **gate**: `UPDATE … SET date_next, deleted_at, updated_at, write_token = <new uuid> WHERE id = ? AND
  deleted_at IS NULL AND date_next = <read> AND write_token = <read>`;
- then three statements, each guarded by `EXISTS (… WHERE id = ? AND write_token = <new uuid>)`: the
  transaction's insert, its log row, and the schedule's log row.

When two callers read the same token, the second gate matches nothing, so its other statements write nothing. That
schedule is reported as `skipped: changed` (Enter Now) or as not entered (due). The token is a uuid, so two
writes in the same millisecond cannot both pass. An edit or a delete also replaces the token.

## API (REST under `/api/v1`, MCP) — note 2

| Operation | Tool | D1 calls (worst case, per attempt) |
|---|---|---|
| `GET /budgets/{budget_id}/scheduled-transactions` (`?account_id`) | `list_scheduled_transactions` | 2 |
| `POST /budgets/{budget_id}/scheduled-transactions` (`?today`) | `create_scheduled_transaction` | 7 |
| `GET /budgets/{budget_id}/scheduled-transactions/{scheduled_transaction_id}` | `get_scheduled_transaction` | 2 |
| `PATCH …/{scheduled_transaction_id}` (`?today`) | `update_scheduled_transaction` | 8 |
| `DELETE …/{scheduled_transaction_id}` | `delete_scheduled_transaction` | 3 |
| `POST …/{scheduled_transaction_id}/enter` (`?today`) → 201 | `enter_scheduled_transaction_now` | 5 |
| `POST /budgets/{budget_id}/scheduled-transactions/bulk` (`?today`) | `enter_scheduled_transaction_now`, `delete_scheduled_transaction` (one id per call); `bulk_update_scheduled_transactions` for categorize, flag, memo and move | enter 5, delete 3; categorize 5, flag 4, memo 4, move 6; whatever the number of ids |
| `POST /budgets/{budget_id}/scheduled-transactions/enter-due` (`?today`) | `enter_due_scheduled_transactions` | 3 |

- **`/bulk` is an addition to note 2's list.** The action bar must act on several rows "in one request that
  makes a fixed number of D1 calls" (note 7). Its body is `{ op: "enter_now" | "delete", ids: 1..100 }`.
  - The rules are all or nothing (an unknown id is 404, a closed account 422). The writes are guarded per
    schedule.
- **`today`** is `YYYY-MM-DD`, optional. It falls back to the server's UTC date.
- Field lists, bodies and response shapes: spec, task 2.
- **Tool descriptions** say that scheduled splits and transfers are not supported (EXF-501), and use `MONEY`,
  `DATE`, `dates(…)` and `timestamps(["created_at", "updated_at"])`.
- **Coverage file:** `apps/worker/test/mcp-coverage/scheduled-transactions.ts`. All eight tools are called in
  `mcp-timestamps.test.ts`.
- **`app.ts` does not change:** the routes are collected with `import.meta.glob`.

## The two callers of entering what is due (note 6)

- **The web app.** `useEnterDueOnOpen(budgetId)` (in `api/scheduledTransactions.ts`) runs on the **account page
  and the All Accounts page**. It posts `enter-due` with `today = localToday()`.
  - It posts once per plan per load of the app (a module-level map from plan to day). It checks again on window
    `focus`, on `visibilitychange` and every 60 s, so it posts again when the browser's date changes.
  - It repeats while `has_more` is true, up to 5 times, and invalidates the plan's queries when something was
    entered.
  - It forgets the day on failure, so the next trigger tries again.
  - **The Plan page and Reflect do not trigger it yet:** the shell and `plan/**` are another Build's (note 10).
    Opening the app on the Plan page alone leaves the entry to the cron or to the next register visit.
- **The cron** (`scheduled.ts`). It first runs `enterDue(env, { budgetIds: "all", day: <the day before the
  server's UTC date>, actor: "service:scheduler" })` in a `try/catch`, so a failure never stops the bank sync.
  Then it runs `syncDueConnections` with `maxRuns = SCHEDULED_MAX_RUNS − SCHEDULER_CRON_CALLS`.
  - The scheduler's part makes **at most 3 D1 calls**: one set read of the due schedules (with account, payee
    and category state, limit 101) and one batch (at most 100 schedules × 4 statements = 400, the same cap as
    bulk). One call is a spare.
  - **The invocation's worst case is 3 (scheduler) + 1 (`listDue`) + 37 (Durable Object runs) = 41 calls**,
    the same 41 as before this Build and under the Free plan's 50. Each Durable Object run keeps its own
    45-call budget (sync-budget design).
  - A counting test proves it (case 17). An entry made by the cron alone can be up to a day late, and it is
    dated its scheduled date.
- `wrangler.jsonc` and `env.ts` do not change (note 9).

## Web app (EXF-497 register, EXF-499 Enter Now)

- **Calendar.** It gets an optional `Repeat:` row: a native `<select aria-label="Repeat">` listing the 13 options,
  Never by default.
  - It shows in the add row and in a scheduled row's edit row. A real row's edit row has none (EXF-503).
  - The calendar stays open while the select has focus.
- **Saving the add row.** When `savesAsScheduled` holds, the row goes to the scheduled API. Otherwise it goes to
  the transactions API as before.
  - A split or a transfer that would be scheduled shows "Scheduled splits and transfers are not available yet."
  - A real row moved to a future date stays real (**not compared**).
- **The Scheduled Transactions section** (`ScheduledSection.tsx`) sits after the add row and before the real
  rows. It is absent when there are no rows.
  - The header is a button with `aria-expanded`: a calendar icon, `Scheduled Transactions`, and a chevron (down
    when expanded, right when collapsed). Its state lives in `sessionStorage` `register.scheduled-collapsed`.
  - A spacer row follows the section.
  - One muted row per series, at `date_next`, in the register's sort. Cells: ACCOUNT (All Accounts), date with
    `RepeatIcon` and the tooltip `Repeats <label lower case>`, payee, `Group: Category`, memo, outflow and inflow.
  - The cleared cell is empty, and the flag is display-only.
  - **The register has no image button today**, so none is added (note 7).
  - `col-date` grows from 96 to 112px.
- **Selection.** A second set, `scheduled`, sits in `selection.tsx`, and selecting one kind clears the other.
  - A click selects the row.
  - A click on the only selected row, or a double-click, opens the edit row (Cancel and Save) and sends a PATCH.
- **The action bar for scheduled rows.**
  - It shows `N Transaction(s)`, **Enter Now** (`E`), Categorize, Flag and More. Categorize, Flag, Memo... and
    Move to Account work since EXF-657 (see "Bulk edits on scheduled rows").
  - More: Match and Unmatch disabled; Duplicate and Export drawn disabled with the title "Not available for
    scheduled transactions yet"; **Delete** enabled with no confirmation.
  - Enter Now and Delete each send one `/bulk` request.
  - `E` and `Delete`/`Backspace` act when focus is not in a field. The keys for real rows do nothing.
- **Placeholders.** `keepPreviousInPlan(budgetId)` (EXF-499 AC 9).

Custom properties (`register.css`): `--register-scheduled-label: var(--labelSecondary)`,
`--register-scheduled-header-bg: var(--backgroundSecondary)`. Icons (`register/icons.tsx`, Budget's own SVGs):
`RepeatIcon` (14px), `CalendarIcon` (16px).

## Bulk edits on scheduled rows (EXF-657, EXF-679)

**Worker.** `POST …/scheduled-transactions/bulk` takes, besides `enter_now` and `delete`, four ops over 1 to 100
series ids. `bulk_update_scheduled_transactions` is the MCP tool for them (REST = MCP).

| Body | Effect |
|---|---|
| `{ op: "categorize", ids, value }` | `value` is a category id or `ready_to_assign` (clears the category, sets the mark) |
| `{ op: "flag", ids, value }` | `value` is a colour or `null` |
| `{ op: "memo", ids, value }` | `value` is text up to 500 characters; `null` or blank clears it |
| `{ op: "move", ids, value, mirror_ids? }` | `value` is the target account id; `mirror_ids` (a subset of `ids`) were selected only through their mirror row |

- **Writes.** Each changed schedule is one gated update (the token and next-date gate of every edit) and one
  `change_log` row (`update`). All of them go in one `db.batch`, under the request's one change set, so one Undo
  restores them. A schedule edited between the read and the batch is `skipped: changed`.
- **D1 calls**, the same for 10 and 100 ids (`scheduled-bulk-update-calls.test.ts`): categorize 5, flag 4, memo 4,
  move 6; a request that skips every row makes no batch call.
- **Refused, nothing written:** 404 for an unknown id; 422 for a closed account (`account_closed`), a transfer
  whose other account is closed, an unknown category or target account, a closed target, a card's own payment
  category (`own_payment_category`), and the move refusals below. Per-row refusals read `Transaction <id>: …`.
- **Skipped, with a reason** in `skipped`: `unchanged` (already set), `changed`, and for categorize `split`,
  `tracking_account`, `category_not_needed`; for move `mirror`.
- **Categorize rule.** It mirrors the register's real-row rule. A split takes no category (it is in its lines).
  A plain schedule on a tracking account takes none. A transfer between two on-plan accounts takes none; between
  two tracking accounts none; between an on-plan and a tracking account the category belongs to the on-plan side
  (the own-payment-category check uses that side). `scheduledCategorizeSkip` (schema) decides, for the worker and
  the bar alike; it is symmetric, so a mirror row answers as its series.
- **Mirror rows.** A mirror shares its series id, so categorize, flag and memo through a mirror change the series.
  A mirror never shows a flag, so a flag set from a mirror shows only in the owning account. Move acts on the
  series' own account only: ids in `mirror_ids` are skipped (`mirror`, "Scheduled in <account>: move it there").
- **Memo** changes the parent only; split lines keep their memos.
- **Move rules**, in order: a `mirror_ids` id is skipped; a schedule already in the target is `unchanged`; a
  transfer into its other account is refused; a split into a tracking account is refused; a categorized (or Ready
  to Assign) schedule whose new sides take no category is refused; a card's own payment category into that card is
  refused. A plain uncategorized schedule moves into a tracking account. Lines stay as they are.

**Action bar.** `ScheduledBar` reads the selection itself and sends the four ops on the series ids.
- Categorize opens the category picker whatever the count; it is disabled, with the title "None of the selected
  scheduled transactions takes a category", when no selected row takes one. Flag opens the flag menu; Memo...
  the memo dialog; Move to Account lists the open accounts except the one that holds every selected row.
- A selection that mixes real and scheduled rows cannot exist: selecting one kind clears the other.
- After an op the alert lists one line per skipped row: `<payee> on <date> (<amount>): <reason>`. A move that
  skipped something keeps the selection, so the alert and the row stay visible; otherwise a move clears it.
  Categorize, flag and memo keep the selection.
- Duplicate and Export stay disabled for scheduled rows with the title "Not available for scheduled transactions
  yet".

**Move to Account submenu** (real and scheduled rows, EXF-679). It opens on hover, on click (never toggles), and
on ArrowRight, Enter or Space from the keyboard, which also focuses its first item. It closes when the pointer
leaves the button and the submenu (150 ms), when the pointer enters another More item, and on Escape: the first
Escape closes the submenu and focuses the button, the second closes More. ArrowUp/ArrowDown move through the
accounts (wrapping); ArrowLeft closes it. Opening and closing write nothing.

**Edits to existing tests.** `e2e/scheduled-transactions.spec.ts` case 22 (pre-allowed) now asserts Categorize
and Flag enabled, Duplicate and Export disabled with their title, Memo... and Move to Account enabled.
`apps/worker/test/mcp-timestamps.test.ts` gains one `CALLS` line for the new tool (not on the may-touch list: a
declared deviation, required by the one-line-per-tool convention).

## Downstream effects

- Auto-entered rows are unapproved, so they raise the account's `unapproved_count` (which exists). The approval
  icon, banner and sidebar dot are EXF-463's screens.
- A payee created through a schedule appears in the payee list at once.
- A deleted category leaves its schedules uncategorized. The category-delete reassignment does not move
  schedules: that service is another Build's. This is a known limitation, named for EXF-505.
- `syncDueConnections` takes an optional `maxRuns`, and its default behaviour is unchanged.
- The transactions service gains one exported helper that builds a plain row's insert and its log rows under a
  guard, used by the scheduled service. Its own behaviour does not change.

## Out of scope

The right-click menu (the app has none), Undo after Delete (EXF-530), the approval icon, banner and sidebar dot
(EXF-463), Make Repeating (EXF-503), scheduled splits and transfers (EXF-501), the Plan page (EXF-505), the
due entry from the Plan page or the shell, and time
zones.

## Acceptance

All on the clone, 1440×900 unless stated. **None is compared** (the source plan has no scheduled transaction and
no open account). "Today" is fixed with `page.clock.setFixedTime` and sent as `today`.

1. **(497)** Today 2026-11-15, account register: Add Transaction, then click the date field.
   - The calendar shows `Repeat:` and a select listing, in order: Never, Daily, Weekly, Every other week, Twice a
     month, Every 4 weeks, Monthly, Every other month, Every 3 months, Every 4 months, Twice a year, Yearly,
     Every other year. Never is selected.
   - A real row's edit-row calendar has no Repeat select.
2. **(497)** Checking account with a $2,500.00 Starting Balance. Add payee "ZZ-TEST Landlord", outflow 800.00,
   date 11/20/2026, Repeat Never, and Save.
   - A `Scheduled Transactions` header shows above the real rows, with one muted row dated 11/20/2026 and no
     repeat icon.
   - Cleared, Uncleared and Working stay $2,500.00.
   - The API lists it with `amount −800000` and `date_next 2026-11-20`.
3. **(497)** Case 2 with Repeat Monthly: the row has a repeat icon whose tooltip is `Repeats monthly`.
4. **(497)** API, today 2026-11-15. Monthly from `2026-12-31`, then `/enter` four times.
   - `date_next` goes 12/31, 01/31, 02/28, 03/31, 04/30.
   - From 2028-01-31 the next date is 2028-02-29.
5. **(497)** API, Twice a month, then `/enter`:
   - from 2026-11-20: 11/20, 12/05, 12/20, 01/05, 01/20;
   - from 2026-12-10: 12/25, then 01/10;
   - from 2027-01-31: 02/16, then 02/28.
6. **(497)** Click the section header.
   - The rows hide and the chevron points right.
   - Click again: the rows show and the chevron points down.
   - After a reload in the same tab, the section keeps the state you left it in.
7. **(497)** A scheduled row's cleared cell is empty (no button), and its flag cannot be opened. There is no image
   button (the register has none).
8. **(497)** Edit, then delete.
   - Click a scheduled row: it is selected. Click it again: the edit row opens with Cancel and Save, and the date
     picker shows its Repeat.
   - Set the memo to "ZZ-TEST rent" and Save. The row and the API show it, and `date_next` is unchanged.
   - More → Delete removes the row with no dialog, and the API lists nothing.
9. **(497)** Type `12/31/2032`, leave the category empty and Save: a scheduled row dated 12/31/2032 with an empty
   category.
10. **(497)** Create, list, update and delete through REST and through the four MCP tools. Each write makes one
    `change_log` row (`entity_type scheduled_transaction`) with the actor `user:…` or `mcp:…`.
11. **(497)** 422 for each of:
    - a closed account (`account_closed`);
    - a category on a tracking account;
    - `frequency: "fortnightly"`;
    - `date_first 2026-02-30`;
    - a date on or before today with Never (the "create a transaction instead" sentence).
12. **(499)** Today 2026-11-15. Monthly series dated 11/25: select its row and press **Enter Now**.
    - A real row dated 11/15/2026 appears: approved and uncleared.
    - The series shows 12/25/2026.
13. **(499)** Enter Now on a one-off.
    - The row leaves the section, and a real row dated today appears.
    - `GET …/{id}` answers 404, and the change_log has its `delete` row.
14. **(499)** Add row, today 11/15/2026, Weekly, dated 11/15/2026: one real row on 11/15 with `approved false`, and
    `date_next` 2026-11-22.
15. **(499)** Case 14 dated 11/01/2026: one real row on 11/01 and none on 11/08 or 11/15; `date_next` 2026-11-22.
16. **(499)** API: a series dated 2026-11-16, created with today 2026-11-15. Open the register with the browser
    clock at 2026-11-16.
    - One unapproved, uncleared row dated 11/16 appears, and the series moves on.
    - A reload or a second `enter-due` adds nothing.
17. **(499, Lead)** Cron at 2026-11-17T03:00Z with series due 11/16 and 11/17.
    - Only the 11/16 one is entered, with actor `service:scheduler`.
    - The invocation's D1 calls plus the stubbed runs are at most 41, and the runs at most 37.
    - `enter-due` makes 3 calls for both 10 and 100 due schedules.
    - Bulk Enter Now makes 5 calls for both 10 and 100 ids.
18. **(499)** REST `/enter`, MCP `enter_scheduled_transaction_now` and `enter_due_scheduled_transactions` behave as
    cases 12, 13 and 16, with their change_log rows.
19. **(499, Lead)** Two `/enter` calls started together on one Monthly series give one real row and one step.
    Two `enter-due` calls together give one row per due series.
20. **(499, Lead)** From plan A's register, which has a scheduled row, switch to plan B: B never shows A's row
    (checked every animation frame for 2 s).
21. **(497)** At 1024×700, none overflows (`scrollWidth ≤ clientWidth`) or overlaps a neighbour:
    - the select with "Every other month";
    - the tooltip `Repeats every other month`;
    - a repeating row's date cell;
    - the section header.
22. **(497)** Selection and keys.
    - Select a real row, then click a scheduled one: only the scheduled one is selected.
    - The bar shows Enter Now, with Categorize and Flag enabled (EXF-657). In More, Duplicate and Export are
      disabled with the title "Not available for scheduled transactions yet"; Memo... and Move to Account are
      enabled, and Delete is enabled.
    - With two scheduled rows selected, `E` enters both.
    - `Delete` removes the selection.
    - `E` while typing in the memo field does nothing.

## Carry-over

This Build (`p_65ee74c0816d452899f054187504cc58`, base main `85f3cc9`) lands two finished, accepted Threads unchanged:
`origin/exfab/p_900d4c34d7c6414a980c2d1d87cfba26` at `2e5e291` (this design, EXF-497/499) and
`origin/exfab/p_7aa8691536924481bf53c457c86b24ea` at `4fb2983` (`reflect-narrow-design.md`, EXF-625/626/621; its
acceptance cases stay there). Neither design changes.

- **What the merge needed:** nothing. The first merge was a fast-forward to `2e5e291`; the second (`d4102a6`) merged
  with no conflict. Diff against main: 52 files, +6,173 / −158. The only file both sides touch is `docs/README.md`
  (`merge=union`, all three lines kept). The one addition here: the index line for `reflect-narrow-polish.md`, which
  the Reflect branch never added.
- **Fit with main and each other (read on `d4102a6`):** no file in `paths.shared_modules` changes (routes and MCP tools
  are picked up by the `import.meta.glob` in `app.ts` and `mcp/server.ts`); one migration, `20261116101200`, after
  main's last (`20261116101000`); no file of the Lead's out-of-bounds list or of `paths.always_overlap` changes.
- **The shell merge under both:** the dispatcher in `apps/web/src/shortcuts/dispatcher.ts` listens on `window`, acts
  only for bound ids (`open-help`, `toggle-sidebar`), ignores fields and open modals, and calls `preventDefault` only
  for a match; the register's keys (`useRegisterKeys.ts`) listen on `document`, which runs first. No register key is
  bound in the registry, so `E`, Delete, `C` and the rest reach the register as before. The Reflect narrow cases run at
  the default sidebar width (fresh `localStorage` per spec). Both are confirmed by running the specs, not by this read.
- **Run once, nothing else:** `pnpm check`; `pnpm e2e e2e/scheduled-transactions.spec.ts e2e/register.spec.ts
  e2e/register-entry.spec.ts e2e/register-bulk.spec.ts e2e/register-flags.spec.ts e2e/all-accounts.spec.ts
  e2e/income-expense-narrow.spec.ts e2e/age-of-money.spec.ts e2e/income-expense.spec.ts e2e/shortcuts.spec.ts`.
  Code changes only for a merge-caused failure or a Reviewer/Tester finding. The source app is not opened for either.

## Manifest

Union of this design's and `reflect-narrow-design.md`'s manifests, for the whole carry-over Build.

touches: [apps/worker/migrations/20261116101200_scheduled_transactions.sql, apps/worker/src/db/schema/scheduled-transactions.ts, apps/worker/src/repositories/scheduled-transactions.ts, apps/worker/src/services/scheduled-transactions.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/routes/scheduled-transactions.ts, apps/worker/src/mcp/tools/scheduled-transactions.ts, apps/worker/src/scheduled.ts, apps/worker/test/scheduled-transactions*.test.ts, apps/worker/test/scheduled-helpers.ts, apps/worker/test/mcp-coverage/scheduled-transactions.ts, apps/worker/test/mcp-timestamps.test.ts, packages/schema/src/recurrence.ts, packages/schema/src/scheduled-transactions.ts, packages/schema/test/recurrence.test.ts, packages/schema/test/scheduled-transactions.test.ts, apps/web/src/api/scheduledTransactions.ts, apps/web/src/register/**, apps/web/src/pages/account.tsx, apps/web/src/pages/accounts.tsx, apps/web/src/reflect/IncomeExpenseReport.tsx, apps/web/src/reflect/AgeOfMoneyChart.tsx, apps/web/src/reflect/*.css, e2e/scheduled-transactions*.spec.ts, e2e/support/scheduled-seed.ts, e2e/register*.spec.ts, e2e/income-expense-narrow.spec.ts, e2e/age-of-money.spec.ts, docs/scheduled-transactions-design.md, docs/scheduled-transactions-spec.md, docs/scheduled-transactions-polish.md, docs/reflect-narrow-design.md, docs/reflect-narrow-spec.md, docs/reflect-narrow-polish.md, docs/age-of-money-design.md, docs/README.md]
shared: []
migrations: 1
