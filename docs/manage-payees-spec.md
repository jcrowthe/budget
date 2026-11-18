# Manage Payees (EXF-510): implementation spec

Design: [manage-payees-design.md](manage-payees-design.md), which holds the decisions, the D1 table and the acceptance cases. Commit after
each part, in the design's order. Run `pnpm check` before every commit, and only this part's specs (`pnpm e2e <specs>`).
Write no migration. Do not touch any out-of-bounds file of brief note 8. Clicks use `realClick` from `e2e/support/real-click.ts`.

## Part 1: list counts, PATCH, tools, counting tests

### 1.1 Schema (`packages/schema/src/payees.ts`)
- `Payee` gains `transaction_count: z.number().int().min(0)` and `scheduled_count: z.number().int().min(0)`, with a
  doc comment for each (live rows only; a split line counts on its own; transfer entries 0).
- `PayeeIdParam`: path params `budget_id`, `payee_id` (min 1).
- `PayeeUpdate = z.object({ name: z.string().max(200).optional(), hidden: z.boolean().optional() }).openapi("PayeeUpdate")`
- `PayeeResponse = dataEnvelope(z.object({ payee: Payee }))`
- `PAYEE_ERRORS` (one constant each, also used by the web):
  `duplicate: "Another payee already exists with this name"`,
  `empty: "Payee name cannot be empty"`,
  `transfer: "Transfer payees can't be edited or deleted"`,
  `system: "System payees are set by the app and can't be edited or deleted"`,
  `noField: "Give name or hidden"`,
  `replacement: "The replacement must be an ordinary payee of this plan"`,
  `replaceSelf: "A payee can't replace itself"`,
  `replacementOnlyDelete: "replacement_payee_id goes only with delete"`,
  `unknown: "Payee not found in this plan"`,
  `race: "The payees changed meanwhile. Try again."`
- Update the helper `p` in `packages/schema/test/payees.test.ts` with `transaction_count: 0, scheduled_count: 0`. Change only the
  fields, no expectation.

### 1.2 Repository (`apps/worker/src/repositories/payees.ts`)
- `idsIn(col: SQLWrapper, ids: readonly string[]): SQL` gives `${col} in (select value from json_each(${JSON.stringify(ids)}))`.
  The ids ride one parameter.
- `listForPlan(db, budgetId, opts: { includeHidden: boolean; counts?: boolean; ids?: readonly string[] })`. With
  `counts`, two left-joined grouped subqueries:
  - `tc` counts `transactions t join accounts a on a.id = t.account_id and a.deleted_at is null where t.budget_id = ? and
    t.deleted_at is null and t.payee_id is not null group by t.payee_id`;
  - `sc` does the same over `scheduled_transactions s`, with the same account join and `s.deleted_at is null`.

  The function returns `transactionCount` and `scheduledCount` (0 without `counts`). `ids` filters with `idsIn`. `plaid-sync.ts`
  keeps calling it without `counts`, so its cost is unchanged. It stays one D1 call.
- `liveOrdinaryCountSql(budgetId, ids): SQL` counts the live ordinary payees of the plan among `ids`, as a scalar.
- `renameStmt(db, budgetId, id, name, now)` is `update payees set name, updated_at where id, budget_id, deleted_at is null and system is null`.
- `setHiddenStmt(db, budgetId, ids, hidden, now, guard: SQL)` sets `hidden` and `updated_at` on the live ordinary payees among `ids` whose
  `hidden` differs, when `guard` holds.
- `logHiddenStmt(db, base, budgetId, ids, hidden, guard)` is a `logSelectStmt` over the same rows, with
  `json_object('id',id,'name',name,'hidden',jsonBool(hidden))` before, and the same with the new value after.
- `PayeeListRow` gains `transactionCount: number; scheduledCount: number`.

### 1.3 Service (`apps/worker/src/services/payees.ts`)
- `export class PayeeRefused extends Error { constructor(public status: 403 | 409 | 422, public code: string, detail) }`.
  The codes are `forbidden`, `conflict` and `unprocessable_entity`. The route maps it the way `routes/transactions.ts:74` maps
  `TransactionRefused`.
- `payeeToApi(row, …)` fills the counts from the row (0 when absent). `listPayees` passes `counts: true` and gives transfer entries 0/0.
- `updatePayee(env, actor, budgetId, payeeId, input: { name?: string; hidden?: boolean }): Promise<Payee>`. Checks, in this order:
  1. the plan exists (`NotFound("Plan")`);
  2. an id starting with `TRANSFER_PAYEE_PREFIX` → 403 `transfer`;
  3. the row from `listForPlan({includeHidden:true, counts:true, ids:[id]})` exists (`NotFound("Payee")`);
  4. a system payee → 403 `system`;
  5. neither field given → 422 `noField`;
  6. the trimmed name is empty → 422 `empty`;
  7. `findByName` finds a row with another id → 409 `duplicate`.

  Then one batch: `changeLogInsertIf` with `{id,name,hidden}` before and after, guarded by the row still being live and ordinary,
  then `renameStmt` and/or `setHiddenStmt`. Nothing changed means no batch. `isUniqueViolation` → 409 `duplicate`. The service
  returns the after row (its counts are unchanged). D1: rename 4, hide 3.

### 1.4 Route (`apps/worker/src/routes/payees.ts`)
`PATCH /budgets/{budget_id}/payees/{payee_id}`, body `PayeeUpdate`, 200 `PayeeResponse`, responses 403/404/409/422
`ErrorBody`, actor `c.get("identity").actor`. The GET stays as it is (the schema now carries the counts).

### 1.5 Tools (`apps/worker/src/mcp/tools/payees.ts`)
- `list_payees`: the description adds `transaction_count` and `scheduled_count`.
- `rename_payee` `{budget_id: Id, payee_id: Id, name: string ≤200}` → `{ payee }`.
- `set_payee_hidden` `{budget_id, payee_id, hidden: boolean}` → `{ payee }`. Its description says a hidden payee is not
  suggested but keeps its transactions.

Every description starts with what the tool does and says `Returns { payee }: …`. Errors are tool errors.

### 1.6 Coverage and timestamps
- `apps/worker/test/mcp-coverage/payees.ts`: `"PATCH /budgets/{budget_id}/payees/{payee_id}": { tool: ["rename_payee", "set_payee_hidden"] }`.
- `apps/worker/test/mcp-timestamps.test.ts`: add CALLS entries for `rename_payee` and `set_payee_hidden`, on a payee the
  test creates for them (`ZZ Timestamps Payee`, through a transaction in its setup). Results hold no timestamps.

### 1.7 Tests
- `apps/worker/test/manage-payees.test.ts`:
  - surface: `apiPaths()` and `listedToolNames()` contain this Build's paths and tools;
  - counts: a split line, a deleted transaction (it counts nothing), a transaction in a deleted account, a scheduled row;
  - PATCH: each refusal with its status and exact detail; a case-only rename is accepted; an unchanged name writes no
    `change_log` row; rename and hide each write one row with the actor; the register read (`GET …/transactions`) shows the
    new name; the MCP tools give the same results.
- `apps/worker/test/manage-payees-calls.test.ts` uses `countingEnv` (see `manual-match-calls.test.ts`):
  - the list with 10 and with 100 payees: equal, and exactly 3;
  - rename: exactly 4;
  - hide: exactly 3.

## Part 2: delete, bulk, popover read

### 2.1 Schema
- `PayeeDeleteQuery = z.object({ replacement_payee_id: z.string().min(1).optional() })`
- `PayeeDeleted = z.object({ id, name, replacement_payee_id: z.string().nullable(), transactions_moved: int, scheduled_moved: int }).openapi("PayeeDeleted")`
- `PayeeDeleteResponse = dataEnvelope(z.object({ deleted: PayeeDeleted }))`
- `PAYEE_BULK_MAX = 1000`; `PayeeBulkRequest = z.object({ payee_ids: z.array(z.string().min(1)).min(1).max(PAYEE_BULK_MAX), action: z.enum(["hide","unhide","delete"]), replacement_payee_id: z.string().min(1).nullable().optional() }).openapi("PayeeBulkRequest")`
- `PayeeBulkResponse = dataEnvelope(z.object({ payees: z.array(Payee), deleted: z.array(PayeeDeleted) }))`.
  Hide and unhide fill `payees` (the after rows); delete fills `deleted`.
- `PAYEE_TRANSACTIONS_LIMIT = 500`; `PayeeTransaction = z.object({ id, kind: z.enum(["transaction","scheduled"]), account_id, account_name, date, category_id: nullable, category_name: nullable, inflow_to_ready_to_assign: boolean, is_split: boolean, memo: nullable, amount: Milliunits }).openapi("PayeeTransaction")`
- `PayeeTransactionsResponse = dataEnvelope(z.object({ transactions: z.array(PayeeTransaction), total_count: int }))`

### 2.2 Statements
- `repositories/transactions.ts` `movePayeeStmt(db, budgetId, fromIds, toId: string | null, now, guard: SQL)`:
  `update transactions set payee_id = toId, payee_name = (select name from payees where id = toId) | null, updated_at = now
  where budget_id = ? and payee_id in (json ids) and deleted_at is null and guard`.
- `repositories/scheduled-transactions.ts` `movePayeeStmt(db, budgetId, fromIds, toId, now, token, guard)`: sets
  `payee_id`, `updated_at` and `write_token = token` (one fresh uuid for all rows) on the live rows.
- `repositories/payees.ts`:
  - `softDeleteStmt(db, budgetId, ids, now, guard)`;
  - `logDeleteStmt(db, base, budgetId, ids, replacementId, counts: Record<id, {t, s}>, guard)`: one `logSelectStmt` over the
    payees, where `before`/`after` are as in the design's history line. The counts ride a JSON parameter read with `json_extract`.
  - `transactionsOf(db, budgetId, payeeId, limit)`: rows with the account name, the category name (including soft-deleted
    categories, as `detailSelect` does), `is_split` (a live line exists), date, memo, amount; plus `count(*) over ()` for the total.
  - `scheduledOf(...)`: the same for scheduled rows.

### 2.3 Service
- `applyToPayees(env, actor, budgetId, input: { ids; action; replacementId?: string | null }): Promise<{ payees; deleted }>`:
  1. dedupe the ids;
  2. check the plan;
  3. a transfer id → 403 `transfer`;
  4. read the rows (`listForPlan` with `ids`, `counts`, `includeHidden`); a missing id → 422 `unknown` (the detail ends with `: <id>`);
  5. a system payee → 403 `system`;
  6. a replacement with hide or unhide → 422 `replacementOnlyDelete`;
  7. the replacement: a transfer → 422 `replacement`; among the ids → 422 `replaceSelf`; `findActive` gives nothing or a system
     payee → 422 `replacement`.

  - Delete builds the batch `[logDeleteStmt, tx.movePayeeStmt, sched.movePayeeStmt, softDeleteStmt]` with one guard: `liveOrdinaryCountSql = n`
    and (with a replacement) the replacement is live and ordinary. When the last result's `meta.changes` < n, the answer is 409 `race`.
  - Hide and unhide build `[logHiddenStmt, setHiddenStmt]`.

  Export `buildPayeeDeleteBatch` so that a test can append a failing statement (atomicity).
- `deletePayee(env, actor, budgetId, payeeId, replacementId)` runs the path checks of `updatePayee` (a missing path id →
  `NotFound("Payee")`), then calls `applyToPayees` and returns `deleted[0]`.
- `listPayeeTransactions(env, budgetId, payeeId)` runs the plan check, the transfer check (403), `findActive` (404) and the system check (403).
  It merges both reads, sorts by date desc, then created_at desc, then id, and cuts the result to 500.

### 2.4 Routes, tools, coverage, timestamps
- Routes: `DELETE /budgets/{budget_id}/payees/{payee_id}` (query `PayeeDeleteQuery`, 200 `PayeeDeleteResponse`),
  `POST /budgets/{budget_id}/payees/bulk` (200 `PayeeBulkResponse`), and `GET /budgets/{budget_id}/payees/{payee_id}/transactions`.
- Tools:
  - `delete_payee` `{budget_id, payee_id, replacement_payee_id?}` → `{ deleted }`. Its description says the payee's transactions and
    scheduled transactions move to the replacement, or to no payee.
  - `bulk_update_payees` `{budget_id, payee_ids (≤1000), action: enum hide|unhide|delete, replacement_payee_id?}` → `{ payees, deleted }`.
  - `list_payee_transactions` `{budget_id, payee_id}` → `{ transactions, total_count }`. Its description uses `MONEY` and
    `dates("transactions[].date")`.
- Coverage lines: `"DELETE /budgets/{budget_id}/payees/{payee_id}": { tool: "delete_payee" }`,
  `"POST /budgets/{budget_id}/payees/bulk": { tool: "bulk_update_payees" }`,
  `"GET /budgets/{budget_id}/payees/{payee_id}/transactions": { tool: "list_payee_transactions" }`.
- Add the three tools to the CALLS of `mcp-timestamps.test.ts`. Delete and bulk act on payees made for them, so they come last.

### 2.5 Tests
- `manage-payees.test.ts`:
  - delete: an unused payee; a used one to a replacement (the register read shows the replacement's name, and the scheduled
    read shows its id); a used one to no payee (`payee_name` null, the read shows no payee);
  - each refusal of delete and bulk;
  - bulk hide and unhide (unchanged rows not logged), and bulk delete with a replacement;
  - history rows as in the design;
  - atomicity, with a failing statement appended to `buildPayeeDeleteBatch`;
  - the popover read: order, `is_split`, the scheduled row, `total_count` beyond 500;
  - the MCP equivalents.
- Calls (exact numbers from the design's table):
  - delete with 1 and with 500 transactions: equal (3 without a replacement, 4 with one);
  - bulk delete of 10 and of 100 payees: equal, 4;
  - bulk hide of 10 and 100: 3;
  - the popover read with 1 and with 500: 4.

  Seed rows with SQL as `manual-match-calls.test.ts` does; every insert names its columns.

## Part 3: the dialog, the list, search, selection, the empty state

### 3.1 Pure model (`packages/schema/src/payees.ts`, tests in `packages/schema/test/manage-payees.test.ts`)
- `nameMatches(name: string, text: string): boolean`: every whitespace-separated word is a case-insensitive substring of the name.
- `type ManageGroups = { payees: Payee[]; transfers: Payee[]; hidden: Payee[] }`;
  `manageGroups(all: Payee[], text: string): ManageGroups` leaves out system payees, puts transfers apart (`transfer_account_id`),
  and sorts each group by `compareNames`.
- `usedCount(p) = p.transaction_count + p.scheduled_count`.
- `unusedIds(groups)` gives the ids in `groups.payees` with `usedCount` 0. The groups are already filtered by the search, and hidden
  payees are left out.
- Labels (singular and plural): `showTransactionsLabel(n)` (`Show 1 Transaction` / `Show n Transactions`),
  `unusedLabel(n)`, `selectedLabel(n)` (`1 Payee Selected` / `n Payees Selected`), and `usingSentence(n)` (the two
  sentences of the design's Source section).
- `paneMode(selected: Payee[]): "none" | "single" | "transfer" | "several" | "mixed"`.
- Texts as constants: `HIDDEN_NOTE`, `TRANSFER_NOTE` (with "Budget"), `EMPTY_PICK = "Select a payee to edit."`,
  `NO_PAYEES` (with ’).
- Test cases: `PHONE co` matches `ZZ Phone Co` and `XX PHONECO 99` but not `ZZ Phone`; system payees are excluded;
  hidden payees are not counted as unused; each label at 1 and at 2.

### 3.2 Web API (`apps/web/src/api/payees.ts`)
`updatePayee(b, id, body)`, `deletePayee(b, id, replacementId | null)`, `bulkPayees(b, body)` (chunks of `PAYEE_BULK_MAX`, sent one
after another), `usePayeeTransactions(b, id | null)` (key `["payee-transactions", b, id]`, `keepPreviousInPlan(b)`), and
`invalidatePayeeViews(qc, b)` (the key set of the design). `usePayees` stays the one list query.

### 3.3 Files (`apps/web/src/payees/`)
- `manage-payees-dialog.tsx`: `ManagePayeesDialog({ budgetId, onClose, returnTo? }: { budgetId: string | null; onClose: () => void; returnTo?: () => HTMLElement | null })`.
  It renders in a portal: `.dialog-backdrop` > `.manage-payees-dialog` (role `dialog`, `aria-modal`, `aria-labelledby`), header h2
  `Manage Payees` with a ✕ `Close`, a body with the two panes, and the footer. Its state: `text`, `selected: string[]`, `open: Record<group, boolean>`
  (`payees: true`), `active` (the list's active item). On mount it invalidates `["payees", b]`. It never shows another plan's data.
- `manage-payees-focus.ts`: `useManagePayeesFocus(box, { onEscape, returnTo })`. Listeners on `window` with capture; Escape and Tab
  call `preventDefault` and `stopPropagation`. On unmount, focus goes to `returnTo()`. The default is `.plan-button, .rail-logo`.
- `manage-payees-window.ts`: `useWindowedRows(count, rowHeight = 33, scroller)` gives `{ start, end, padTop, padBottom }`, with
  10 rows of overscan.
- `manage-payees-list.tsx`: `PayeeList({ groups, open, onToggleGroup, selected, onSelectOnly, onToggle, onToggleGroupAll, active, onActive })`.
  - Items: `{kind:"header", group}` and `{kind:"row", payee, group}`.
  - Header: chevron button (`aria-label` `Expand <g>`/`Collapse <g>`, `aria-expanded`), `<input type="checkbox">` with
    `aria-label` `Check all <g>`/`Uncheck all <g>` and `indeterminate` when partial, and the label `<g>` plus ` (n)`.
  - Row: checkbox `Check <name>`, then a button with `aria-label` `Select <name>`, the name text and `title`.
  - Inner controls have `tabIndex={-1}`. The scroller has `tabIndex=0`, role `listbox` and `aria-activedescendant`; it handles the keys of the design.
- `manage-payees-illustration.tsx`: an original SVG (an outlined tag), 120 px wide, `aria-hidden`.
- `manage-payees.css`: the measurements of the design's Source section. Local custom properties for the two missing colours, each with a
  comment naming the source's variable. Rows have `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- `apps/web/src/menu-actions/manage-payees.tsx`: `export const action: PlanMenuAction = { entry: "manage-payees", Dialog: ManagePayeesDialog }`.

### 3.4 Specs (`e2e/manage-payees.spec.ts`, seed in `e2e/support/manage-payees-seed.ts`)
- The seed: `seedPayees(request)` makes a plan (`testName`), `ZZ Checking`, `ZZ Card`, and the payees of the design's
  acceptance through `POST …/transactions` and `POST …/scheduled-transactions` (as `e2e/support/scheduled-seed.ts`).
  `ZZ Unused` is a transaction that is then deleted. It returns the ids.
- A spec opens the dialog through the plan menu (`mouseClick` of `e2e/support/menu.ts`, as `plan-menu.spec.ts`).
- Cases 1, 3, 4 and 14. Every assertion after a request waits with `expect.poll`.

## Part 4: the edit pane for one payee, the field's button, the skipped spec

- `manage-payees-pane.tsx`: `EditPane({ budgetId, selected: Payee[], all: Payee[], onSelect, onDeselectTransfers })`. It switches on
  `paneMode`. Single mode, card `Payee Name`:
  - the field is an `<input aria-label="Payee Name">`;
  - Enter or blur saves through `updatePayee` when the trimmed text differs; an empty name is caught locally with `PAYEE_ERRORS.empty`;
  - the error bar is `<div role="alert" class="mp-error">` showing the `ApiError` detail; the next keystroke clears it;
  - Escape with unsaved text reverts it and calls `stopPropagation`.

  Then `Show N Transactions`, `No Transactions`, Hide/Unhide (`updatePayee({hidden})`), Delete, and `HIDDEN_NOTE`. Every success calls
  `invalidatePayeeViews`. The group of a payee that moved opens.
- `manage-payees-transactions.tsx`: `TransactionsPopover({ budgetId, payeeId, anchor, onClose })`. It is a dialog-in-dialog
  (role `dialog`, label `Transactions`) and lays out as in the design. The sort state is `{ col, dir }`. It uses `usePlanFormatter().date` and `.money` and
  formats nothing itself. Escape closes only the popover and returns focus to its anchor.
- `apps/web/src/register/PayeeField.tsx`:
  - the footer button drops `disabled` and `aria-disabled` and keeps `data-ticket="EXF-510"`;
  - `onMouseDown={e => e.preventDefault()}`;
  - `onClick` sets `open`, which renders `<ManagePayeesDialog budgetId={useParams().budgetId} onClose returnTo={() => inputRef}>`;
    PickerInput has no ref, so the code finds the combobox with `closest(".entry-picker")?.querySelector("input")` from the button's
    parent, captured at click time.

  `entry.css`: the `:disabled` look no longer applies to this button. Change only the comment and the hover colour
  (`--buttonGhostLabel`, as the bank list's hover).
- `e2e/payee-picker.spec.ts`: departures 2 and 3. Add `hidePayee = (request, plan, id) => call(request, "PATCH", …, { hidden: true })`.
- `e2e/plan-menu.spec.ts`: departure 1, which adds `"Manage Payees"` to `enabled`.
- Specs: cases 2, 5, 6, 7, 8 (single transfer), 9 and 19.

## Part 5: delete and unused

- `manage-payees-delete.tsx`: `NewPayeeSection({ count, options: Payee[], onCancel, onDelete(replacementId | null), several })`.
  It has an h3 `New payee`, the `usingSentence`, `<select aria-label="New payee">` whose first option is `[No Payee]` with value `""`, and
  `Cancel`, plus `Delete` or `Delete All` (`Deleting...` while pending). The pane adds `.mp-deleting` (the cards dim).
- An unused payee is deleted at once. The selection is then cleared.
- The pinned link `unusedLabel(n)` sets `selected = unusedIds`.
- Specs: cases 10, 11 and 12.

## Part 6: several, transfer, narrow, keyboard, scale

- Several mode: `selectedLabel`, the names (`<span title>` each, max-width 240, joined by `, `), `Hide All`/`Unhide All` through
  `bulkPayees`, and `Delete All` through Part 5's section. Mixed mode has the sentence, with its link button `deselect transfer payees`.
- `e2e/manage-payees-keyboard.spec.ts`: cases 15 and 16 at 1024×700. It measures the panes with `boundingBox` and checks the ellipsis with
  `scrollWidth > clientWidth` and the `title`.
- `e2e/manage-payees-scale.spec.ts`: case 18, one test.
  - Seed 2,000 payees with the plan import (`POST /api/v1/budgets/import`, a register file of 2,000 rows each with its own payee;
    see `e2e/support/plan-import-dialog-files.ts` for the file shape). If the import cannot carry that, use `POST …/transactions` in
    parallel groups of 10.
  - `test.setTimeout` on that test only, with the reason on its line.
  - Time `performance.now()` from the menu click to the first row being visible, and from `type("Z")` to the list's first row
    changing. Print both with `console.log("manage-payees-scale open=<ms> filter=<ms>")`, and assert the design's budgets.

## Verify

- `pnpm check`, which includes `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps`, `openapi`, `positional-inserts`,
  `plan-formats-screens` and `repo-hygiene`.
- `pnpm e2e e2e/manage-payees.spec.ts e2e/manage-payees-keyboard.spec.ts e2e/manage-payees-scale.spec.ts e2e/payee-picker.spec.ts e2e/plan-menu.spec.ts`.
- Report the D1 numbers, the scale figures and the departures 1 to 3.
