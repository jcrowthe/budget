# Register entry spec (EXF-517, EXF-507)

Implements [register-entry-design.md](register-entry-design.md). Tasks in order; each ends with how to verify.
Follow `docs/conventions.md`. Never open the source app. Never edit `apps/web/src/plan/**`, `api/months.ts`,
`api/assigned.ts`, `api/categories.ts`, `api/monthCache.ts`, `services/months.ts`, the months routes/schema,
`apps/web/src/shell/**`, `apps/web/src/menu-actions/**`, `packages/core/src/**`, the other MCP tool files,
`openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `e2e/mcp.spec.ts`, or any `paths.always_overlap`
file. Reading/importing from them is fine (`useMonth`, `sidebarSections`, `STARTING_BALANCE_PAYEE`).

## 1. Migration and tables

`apps/worker/migrations/20261116100100_payees.sql`:

```
CREATE TABLE payees (id TEXT PRIMARY KEY NOT NULL, budget_id TEXT NOT NULL, name TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0, system TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT);
CREATE UNIQUE INDEX payees_budget_name ON payees(budget_id, name) WHERE deleted_at IS NULL AND system IS NULL;
CREATE UNIQUE INDEX payees_budget_system ON payees(budget_id, system) WHERE deleted_at IS NULL AND system IS NOT NULL;
ALTER TABLE transactions ADD COLUMN payee_id TEXT;
CREATE INDEX transactions_payee ON transactions(payee_id);
```

Then three idempotent backfill statements (each one line starting `INSERT` or `UPDATE`, so the test can rerun
them):
- A. `INSERT INTO payees … SELECT <uuid>, budget_id, 'Starting Balance', 0, 'starting_balance', min(created_at),
  min(created_at), NULL FROM transactions t WHERE payee_name = 'Starting Balance' AND NOT EXISTS (system payee of
  t.budget_id) GROUP BY budget_id`.
- B. same for ordinary payees: `payee_name IS NOT NULL AND trim(payee_name) <> '' AND payee_name <> 'Starting
  Balance'`, `NOT EXISTS` a non-deleted non-system payee with that budget and name, `GROUP BY budget_id,
  payee_name`. Deleted transactions included.
- C. `UPDATE transactions SET payee_id = (SELECT p.id FROM payees p WHERE p.budget_id = transactions.budget_id AND
  p.deleted_at IS NULL AND ((transactions.payee_name = 'Starting Balance' AND p.system = 'starting_balance') OR
  (transactions.payee_name <> 'Starting Balance' AND p.system IS NULL AND p.name = transactions.payee_name)))
  WHERE payee_id IS NULL AND payee_name IS NOT NULL`.

`<uuid>`: `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))`.
Verify in the test that ids are distinct per group.

`apps/worker/src/db/schema/payees.ts`: Drizzle `payees` (`id`, `budgetId`, `name`, `hidden` boolean,
`system` text enum `PAYEE_SYSTEMS`, `createdAt`, `updatedAt`, `deletedAt`) with the two partial unique indexes
(`uniqueIndex(...).on(...).where(sql\`...\`)`). `db/schema/transactions.ts`: add `payeeId: text("payee_id")`
**after `updatedAt`** and the index `transactions_payee`.

Then delete `.e2e-state`. Verify: `pnpm check` (`schema-drift.test.ts` passes).

## 2. Schemas (`packages/schema/src`)

`payees.ts` (new):
- `PAYEE_SYSTEMS = ["starting_balance", "manual_adjustment", "reconciliation_adjustment"] as const`,
  `PayeeSystem` enum.
- `Payee = { id: string, name: string, hidden: boolean, system: PayeeSystem | null, last_category_id: string |
  null }` `.openapi("Payee")`; `PayeeListResponse = dataEnvelope(z.object({ payees: z.array(Payee) }))`;
  `PayeeListQuery = { q?: string (max 200), include_hidden?: "true" | "false" }`.
- `payeeMenu(payees: Payee[], text: string): PayeeMenu`, pure:
  ```
  type PayeeMenu = { top: null | { kind: "create"; text: string } | { kind: "hidden"; payees: Payee[]; label: string };
    help: string | null; heading: "Saved Payees"; saved: Payee[]; hint: string | null; active: number }
  ```
  `t = text.trim()`; visible = non-hidden, non-system, sorted (`compareNames`: case-insensitive, then exact, then
  id). Empty `t`: `top null`, `saved` = visible, `hint` = "Start typing to add a payee." when none, `active` -1.
  Otherwise `saved` = visible whose lowercased name includes lowercased `t`; hidden exact matches (non-system,
  `name === t`) → `top hidden`, label `1 matching payee is hidden` / `N matching payees are hidden`; else `top
  create`; `help` = `"<t>" will be created as a payee.` when `top` is create and `saved` is empty; `active` =
  index into `[top, ...saved]` of the first saved match, else 0.
- Unit tests `packages/schema/test/payees.test.ts`: empty plan hint, alphabetical case-insensitive order, system
  never listed (`Start` → only create), hidden exact → hidden line, hidden partial → not listed, help line only
  without matches, active index.

`transactions.ts`:
- `Transaction` gains `payee_id: z.string().nullable()`; `TransactionDetail` gains `payee_system:
  PayeeSystem.nullable()`.
- `requestFields` gains `payee_id: z.string().min(1).nullable().optional().describe("An existing payee of the
  plan (from list_payees). Give payee_id or payee_name, not both.")`; `payee_name` gets `.describe("Payee text;
  an exact (case-sensitive) match to a non-system payee of the plan, hidden ones included, is used, otherwise a
  new payee is created with the transaction. Null or empty clears the payee.")`. Add `payee_id` to `updateFields`.
  Do **not** add a `.refine` to `TransactionCreateRequest` (its `.shape` feeds the MCP tool); the both-given rule
  is in the service.
- `TransactionCreate` (the internal create) is unchanged in shape.

`register.ts`:
- `SortableTx` adds `payee_system?`. `categoryCell`: "notNeeded" for a credit type when `tx.payee_system ===
  "starting_balance"` (not the text). Keep `REGISTER_STARTING_PAYEE` (its equality test stays).
- `categoryMenu(groups: MonthGroupDetail[], readyToAssign: number, text: string)` →
  `{ groups: { name, rows: { kind: "rta" | "category", id: string | null, name, amount, hidden }[] }[]; flat:
  rows[]; empty: boolean }`. First group "Inflow" with the row `{kind:"rta", name:"Ready to Assign", amount:
  readyToAssign}`; then every group (hidden included) with all categories. Needle = lowercased trimmed text;
  a group whose name matches keeps all rows, else rows whose name matches; empty groups dropped.
- `categoryLabel(value, groups)` → `"<Group>: <Category>"`, `"Inflow: Ready to Assign"`, or `""`.
- Tests in `packages/schema/test/register.test.ts`: the existing Starting Balance cases switch to
  `payee_system`; a credit row with text "Starting Balance" and `payee_system: null` is "needsCategory"; `d4 gro`,
  group match, `inflow`, `zzzz` empty, hidden categories included.

`date-entry.ts` (new; ISO strings, UTC arithmetic, `today` always passed in):
- `formatEntryDate(iso)` → `MM/DD/YYYY`.
- `parseEntryDate(text, today)` → ISO or null. Separators `/ - .`; `M` → month M day 1 of today's year; `M/D`
  → today's year; `M/D/YY` → 20YY; `M/D/YYYY`; also accepts `MM/DD/YYYY` output and ISO `YYYY-MM-DD`. Refuses
  non-calendar dates (`isCalendarDate`) and years outside 1900–2199.
- `dateKeyAction(key, base, today)` → ISO or null (null = not a shortcut): `-` −1 day, `+`/`=` +1, `ArrowUp` −7,
  `ArrowDown` +7, `t` today, `m` first of month, `M` last of month, `y` Jan 1, `r` and `Y` Dec 31.
- `monthGrid(firstOfMonth)` → weeks of 7 (`string | null`), Sunday first. `addMonths(firstOfMonth, n)`,
  `monthTitle(firstOfMonth)` → `Nov 2026`.
- Tests `packages/schema/test/date-entry.test.ts`: the EXF-517 table from 2026-11-15 (`m` 11/01, `M` 11/30, `y`
  01/01/2026, `r`/`Y` 12/31/2026, `-` twice 11/13, `+` twice 11/17, `t`), month ends (Jan 31 `+`, Feb 29 2028,
  Dec 31 `+`), `11/3`, `1/2/27`, `3`, `garbage`, `2/30`, `13/1`; grid of Nov 2026 starts Sunday Nov 1.

`amount-entry.ts` (new, sibling of `assigned-edit.ts`, which stays untouched):
- `evaluateAmountEntry(text)` → milliunits ≥ 0 or null (field empty). Strip spaces, `$` and `,`; tokens numbers
  and `+ - * / ( )`; recursive descent with unary minus and parentheses; one trailing operator ignored (`5+`);
  division by zero, bad syntax, non-finite → null. Result rounded to cents (`Math.round(x * 100) * 10`), absolute
  value; 0 → null; above `Number.MAX_SAFE_INTEGER` milliunits → null.
- `formatAmountEntry(milli)` → `1,234.50` (en-US grouping, two decimals, no sign or currency).
- `signedAmount(outflow: number | null, inflow: number | null)` → `(inflow ?? 0) - (outflow ?? 0)`.
- Tests `packages/schema/test/amount-entry.test.ts`: every row of the EXF-517 amounts table plus `-5`, `abc`,
  `0`, `2-5` (3.00), `1/0`, `((2)`, `.5`, `$12`, rounding `0.005`.

Verify: `pnpm check`.

## 3. Payees repository and service (Worker)

`repositories/payees.ts`:
- `PayeeRow`; `listForPlan(db, budgetId, { includeHidden })` → rows with `lastCategoryId` (correlated subquery:
  latest non-deleted transaction of the payee by `date desc, created_at desc, id desc`, its `category_id` when that
  category is not deleted, else null).
- `findActive(db, budgetId, id)`, `findByName(db, budgetId, name)` (non-deleted, `system IS NULL`, exact),
  `findSystem(db, budgetId, system)`.
- `insertStmt(db, row)`, `insertIfStmt(db, row, guard)`, `insertSystemIfMissingStmt(db, row)` (INSERT … SELECT …
  WHERE NOT EXISTS the plan's non-deleted payee of that `system`), `systemIdSql(budgetId, system)` (scalar
  subquery for a column value).
- `isUniqueViolation(e)` → true when the error message contains `UNIQUE constraint failed: payees`.

`services/payees.ts`:
- `payeeToApi(row)`; `listPayees(env, budgetId, { q?, includeHidden? })` (404 `Plan` when missing; `q` filtered
  with `toLowerCase().includes`; sort with `compareNames` from the schema).
- `resolvePayee(db, budgetId, input: { payee_id?: string | null; payee_name?: string | null }, current?: string |
  null)` → `{ payeeId: string | null, name: string | null, system: PayeeSystem | null, create?: PayeeRow }` or
  `undefined` when neither key is given. Both given → `TransactionRefused(422, "unprocessable_entity", "Give
  payee_id or payee_name, not both")`. Rules as in the design (Approach → API). `create` is a new row (uuid, name
  trimmed, `hidden false`, `system null`, timestamps now).

Verify: unit-level through task 5's tests.

## 4. Transactions repository and service

`repositories/transactions.ts`:
- `insertIfStmt`: append `${r.payeeId}` after `${r.updatedAt}` (column order = Drizzle order). Add an optional
  4th parameter `payeeIdSql?: SQL` used in place of `${r.payeeId}` (for the account's Starting Balance).
- `detailSelect`, `listDetailForPlan`, `findDetail`: `leftJoin(payees, eq(payees.id, transactions.payeeId))`;
  `TransactionDetailRow` gains `payeeSystem`; `payeeName` = `coalesce(payees.name, transactions.payee_name)`.
- `activityByMonth`: leftJoin payees; replace the payee-text condition with
  ``sql`coalesce(${payees.system}, '') = 'starting_balance'` `` (other three conditions unchanged).
- `holdsCondition` adds `same(t.payeeId, before.payeeId)`; `updateIfHoldsStmt` sets `payeeId`.
- Remove the `STARTING_BALANCE_PAYEE` import if unused.

`services/transactions.ts`:
- `transactionToApi` adds `payee_id`; `transactionDetailToApi` adds `payee_system`.
- `isCreditStartingBalance(account, row)` uses `row.payeeSystem === "starting_balance"` (callers pass detail
  rows). Delete the reserved-name branch of `validate` (and its `STARTING_BALANCE_PAYEE` use).
- `addTransaction`: loop `MAX_ATTEMPTS`: `resolvePayee`; row `payeeId`, `payeeName` = resolved name; batch
  `[payee insert + payee change_log (if create), tx insert, tx change_log]`; on `isUniqueViolation` retry; the
  tx log's `after` includes `payee_id`.
- `prepare`/`mutate`: resolve the payee from the patch (current = `before.payeeId`); the Starting Balance lock
  compares `payeeId` (not text). When a payee is created: `payeesRepo.insertIfStmt(db, row, holds(db, before))` and
  `changeLogInsertIf(db, payeeLog, holds(db, before))` **before** the tx log and the update; read the update's
  result from the last statement; catch `isUniqueViolation` and `continue`.
- `createTransaction` (internal) runs `payee_name` through `resolvePayee` the same way.

`services/accounts.ts` (`addUnlinkedAccount`): before the loop `findSystem(…, "starting_balance")`; build a system
`PayeeRow` (name `STARTING_BALANCE_PAYEE`) when missing; in the batch, before the tx insert:
`payeesRepo.insertSystemIfMissingStmt(db, sys)` and `changeLogInsertIf(db, {entityType: "payee", action:
"create", entityId: sys.id, …}, select 1 from payees where id = sys.id)`; the tx insert passes
`payeesRepo.systemIdSql(budgetId, "starting_balance")` as `payeeIdSql`. The returned `starting_balance` carries the
system payee's id (re-read with `findSystem` after the batch).

Verify: existing `accounts.test.ts`, `transactions.test.ts`, `months.test.ts`, `plan-transactions.test.ts` pass
unchanged except the reserved-name assertion (task 5).

## 5. Routes, MCP, Worker tests

- `routes/payees.ts`: `GET /budgets/{budget_id}/payees` with `PayeeListQuery`, 200 `PayeeListResponse`, 404,
  422 (copy the shape of `routes/accounts.ts`). `routes/transactions.ts`: no new path; make sure the 422 from
  `TransactionRefused` covers the payee refusals.
- `mcp/tools/payees.ts`: `list_payees`, input `{ budget_id, q?, include_hidden?: boolean }`, description: "List
  the plan's payees: id, name, hidden, system (starting_balance, manual_adjustment, reconciliation_adjustment or
  null for ordinary payees) and last_category_id (the category of the payee's latest transaction, or null).
  Sorted by name, case-insensitive. Hidden payees only with include_hidden: true. q filters by case-insensitive
  substring. Use an id as payee_id in create_transaction/update_transaction, or pass payee_name to match or
  create one." Returns `{ payees }`.
- At your last rebase: if `apps/worker/test/mcp-coverage/` exists, add `mcp-coverage/payees.test.ts` following
  `docs/conventions.md` at that time and add payee sentences to `create_transaction`/`update_transaction` in
  `mcp/tools/transactions.ts`; otherwise do not touch that file and report it.
- `apps/worker/test/payees.test.ts`: surface (`apiPaths()` has `/api/v1/budgets/{budget_id}/payees`,
  `listedToolNames()` has `list_payees`); list order, `q`, `include_hidden`, system listed with `system`;
  `last_category_id` follows the latest transaction; REST and MCP agree; create with a new `payee_name` →
  one payee + `change_log` rows `payee/create` and `transaction/create` with the same actor; same name again
  (and with surrounding spaces) reuses it; different case → a second payee; a hidden payee's exact name reuses
  it and it stays hidden; `payee_id` + `payee_name` → 422; foreign or unknown `payee_id` → 422; system `payee_id`
  on another row → 422; PATCH to a new name creates it with a `change_log` row; a PATCH that loses the race
  (row changed first) creates no payee; two concurrent creates with one new name leave one payee
  (`Promise.all`); a "Starting Balance" typed on a checking or credit account is a new ordinary payee, distinct
  from the system one; deleting all of a payee's transactions keeps the payee.
- `apps/worker/test/payees-migration.test.ts`: insert raw transactions with `payee_id` NULL (two plans, repeated
  names, a different-case name, a "Starting Balance" row, a deleted row, an empty name), run the payees migration's
  `INSERT`/`UPDATE` queries from `env.TEST_MIGRATIONS`, assert as in acceptance 14, run them again (idempotent: no
  new rows).
- `transactions.test.ts`: the credit test's final `post(... payee_name: "Starting Balance")` now expects 201, a
  `payee_system` of null, and the month's uncategorised activity includes it; the locked-row loop adds
  `{ payee_id: <other payee> }` → 409. `accounts.test.ts`: the new account's Starting Balance has `payee_id` = the
  plan's system payee; two accounts share it; the payee-less credit test passes unchanged.

Verify: `pnpm check`.

## 6. Web API modules

- `api/payees.ts`: `listPayees(budgetId)` (always `include_hidden=true`), `usePayees(budgetId)` key
  `["payees", budgetId]`, `staleTime` 30 s.
- `api/transactions.ts`: `createTransaction(budgetId, body)`; `useSaveTransaction(budgetId)` mutation taking
  `{ id?: string; body }` (POST without id, PATCH with), `idempotencyKey` per call, `onSuccess` →
  `qc.invalidateQueries({ predicate: q => q.queryKey.includes(budgetId) })`. Do not import from `plan/` or
  `api/monthCache.ts`.

## 7. Register UI (`apps/web/src/register/`)

Files (new unless noted): `Register.tsx` (edit: `open` state, shift+N listener, passes `onAdd` to the toolbar),
`RegisterToolbar.tsx` (edit: `onAdd` on "Add Transaction"), `RegisterTable.tsx` (edit: row click/double-click,
renders `EntryRow` at the top or in place of the edited row, pill as a button), `EntryRow.tsx`, `entryDraft.ts`
(draft type, `draftFromTx`, `emptyDraft(date)`, `draftToCreate`, `draftToPatch(before, draft)`, pure),
`Dropdown.tsx`, `DateField.tsx`, `Calendar.tsx`, `PayeeField.tsx`, `CategoryField.tsx`, `AccountField.tsx`,
`AmountField.tsx`, `entry.css`, `icons.tsx` (edit: `CalculatorIcon`, `ChevronLeftIcon`, `ChevronRightIcon`),
`format.ts` (edit if needed: `localToday()` from the browser's local date).

Contracts:
- `Draft = { accountId: string | null; dateText: string; lastDate: string; payee: { id: string | null; name:
  string }; category: { kind: "none" } | { kind: "rta" } | { kind: "category"; id: string }; memo: string;
  outflowText: string; inflowText: string; cleared: "uncleared" | "cleared" }`.
- `EntryRow` props: `{ budgetId, mode: "add" | "edit", tx?: Row, account?: Account, accounts: Account[], columns,
  initialFocus: Field, openCategory?: boolean, onClose(), onSaved(next: "close" | "again", date: string) }`;
  `Field = "account" | "date" | "payee" | "category" | "memo" | "outflow" | "inflow"`. Cells carry
  `data-field`; inputs carry `aria-label`s `Account`, `Date`, `Payee`, `Category`, `Memo`, `Outflow`, `Inflow`
  and the placeholders of the design.
- `Dropdown` props: `{ anchor: HTMLElement; label: string; minWidth: number; children; footer? }`; renders
  `role="listbox"` (calendar: `role="dialog"` label "Calendar") into `document.body`, `position: fixed`,
  z-index 50; above the anchor when `window.innerHeight - rect.bottom < min(boxHeight, 240) + 8`; `max-height`
  = room − 8; listeners on `scroll` (capture) and `resize`.
- Options: `role="option"`, `aria-selected` on the active one, accessible name = visible text (exact). Headers
  "Saved Payees", "Inflow" and group names are `role="presentation"` text. The create item's name is
  `Create "<text>" Payee`.
- Row click: `onClick` on `<tr>` ignores events from `button`, `input`, `[role=checkbox]`; `onDoubleClick` opens
  edit. Focus field = the clicked cell's `data-field`. Reconciled rows never open.
- Date field `onKeyDown`: if `dateKeyAction(e.key, base, today)` is non-null → `preventDefault`, set the text to
  `formatEntryDate(result)`, select it, move the calendar's month. Calendar buttons and day cells use `mousedown`
  `preventDefault`.
- Amount field: on focus show `CalculatorIcon` absolutely at left (input padding-left 22px); `onChange` with a
  non-empty value clears the other amount text; `onBlur` formats.
- Save: compute `date = parseEntryDate(dateText, localToday())`; on null show the message and focus the date.
  After "again": reopen an empty draft with `dateText` = the saved date, focus date with calendar open.

`entry.css`: styles of the design's Look section; `--register-entry-row` and `--register-today-ring` declared in
`register.css`'s `:root` block (edit). No raw colours outside those declarations.

Verify: `pnpm check`; `pnpm dev`, then by hand: acceptance 1–8 on a ZZ-TEST plan.

## 8. e2e specs

- `e2e/register-entry.spec.ts` (517 and Lead cases 1, 2, 5–11, 16, 17), `e2e/payee-picker.spec.ts` (507 cases 3,
  12, 13 and the empty-plan hint). Seed through the API (copy `seed` from `e2e/register.spec.ts`); names
  `ZZ-TEST <random>`; `{ exact: true }` on every name locator; read today from the browser
  (`page.evaluate`). The mouse helper: `await option.scrollIntoViewIfNeeded()`, take its box centre, assert
  `page.evaluate(([x,y]) => document.elementFromPoint(x,y)?.closest('[role=option],button')?.textContent)` equals
  the option's text, then `page.mouse.move` + `page.mouse.click`; run it at 1600×900 and at
  `page.setViewportSize({ width: 1024, height: 700 })`, and on the last row of a 25-row register scrolled to the
  bottom (assert the list's top is above the row's top).
- Hidden payee (case 12): `e2e/support/d1.ts` runs `pnpm --filter @budget/worker exec wrangler d1 execute
  budget-db --local -c <root>/apps/worker/wrangler.jsonc --persist-to <root>/.e2e-state --command "UPDATE payees
  SET hidden = 1 WHERE id = '<uuid>'"` (id from `GET …/payees`, validated as a uuid). If the served D1 does not see
  the write, drop the helper, mark the case `test.skip` with the reason, and rely on the `payeeMenu` unit test and
  the Worker test; say so in the report.
- `e2e/register.spec.ts`, `e2e/all-accounts.spec.ts`: change only if a run shows they assert something this Build
  changes (e.g. row click behaviour).

Verify: `pnpm e2e e2e/register-entry.spec.ts e2e/payee-picker.spec.ts e2e/register.spec.ts
e2e/all-accounts.spec.ts --repeat-each=3`, then let final_gate run the full suite.

## 9. Report

Include every item of the Lead's "What to report" list: the screenshots kept (clone only, under
`.screenshots/`), the statement that nobody opened the source, whether EXF-572 was on main, and `git diff
--stat origin/main` showing no out-of-bounds file.
