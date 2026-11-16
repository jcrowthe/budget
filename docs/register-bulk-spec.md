# Register selection, action bar and flags: spec (EXF-520, EXF-522)

Design: [register-bulk-design.md](register-bulk-design.md). Source notes (CSS verbatim): `/workspace/scratch/source/register-bulk/notes.md`.
Do the tasks in order and run `pnpm check` after each Worker task.

**Do not edit**:
- the out-of-bounds files of Lead's note 11;
- `packages/core/src/**`, `apps/web/src/shell/**`, `mcp/tool-text.ts` and `services/batch-groups.ts`;
- `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`, `mcp-descriptions.test.ts` and `e2e/mcp.spec.ts`;
- anything in `paths.always_overlap`.

No new dependency.

## 1. Column, migration, repository

- `apps/worker/migrations/20261116101000_transaction_flags.sql`: `ALTER TABLE transactions ADD COLUMN flag_color TEXT;` (no default, no CHECK).
  Then delete `.e2e-state`.
- `packages/schema/src/transactions.ts`:
  - `FLAG_COLORS = ["red","orange","yellow","green","blue","purple"] as const`;
  - `FlagColor = z.enum(FLAG_COLORS).openapi("FlagColor")`;
  - `FLAG_NAMES: Record<FlagColor,string>` (`Red` … `Purple`).
- `db/schema/transactions.ts`: `flagColor: text("flag_color", { enum: FLAG_COLORS })`, **last**.
- `repositories/transactions.ts`:
  - `"flagColor"` joins `LinkCols` (optional, so the bank sync needs no edit) and `TxSet`.
  - `insertIfStmt` appends `${r.flagColor ?? null}` after `importPayeeName`, in table order.
  - New functions:
    - `findDetailMany(db, budgetId, ids) → Map<id, TransactionDetailRow>`: `findDetail`'s conditions, plus `id in (select value from json_each(?))` with a single JSON parameter;
    - `listLines(db, budgetId, { parentIds })`: a new option, done the same way;
    - `unchangedSince(db, snap: {id, updatedAt}[]): SQLWrapper` (dedupe the ids first):
      `(select 1 where (select count(*) from transactions t, json_each(?) j where t.id = json_extract(j.value,'$.id') and t.updated_at = json_extract(j.value,'$.u') and t.deleted_at is null) = ?)`.
- Verify: `schema-drift.test.ts` passes. A test shows `unchangedSince` holding, then failing after one row's `updated_at` changes.

## 2. Schemas

- `packages/schema/src/transactions.ts`:
  - `Transaction` gets `flag_color: FlagColor.nullable()`.
  - `updateFields` gets `flag_color: FlagColor.nullable().optional()`, so it reaches PATCH and `transactionUpdateShape`.
  - Extract `TransactionIds` (today's 1–100 `ids`) and reuse it.
  - `BULK_OPS = ["clear","unclear","categorize","memo","move","duplicate","delete","flag"]`.
  - `BulkSkipReason = z.enum(["reconciled","unchanged","split","tracking_account","category_not_needed","starting_balance"])`.
  - `TransactionBulkRequest = z.discriminatedUnion("op", …)`. Every member is `.strict()` with `ids: TransactionIds`, and every `value` has a `.describe`:
    - `clear`, `unclear`, `duplicate`: no value;
    - `delete`: `confirm_reconciled?: boolean`;
    - `categorize`: `value: z.string().min(1)` (a category id or `"ready_to_assign"`);
    - `memo`: `value: z.string().max(500).nullable()`;
    - `move`: `value: z.string().min(1)`;
    - `flag`: `value: FlagColor.nullable()`.
  - `TransactionBulkResult` is `{ op, changed: string[], skipped: {id, reason}[], others: string[], copies: {id, copy_id}[], transactions: TransactionDetail[] }`,
    and `TransactionBulkResponse = dataEnvelope(TransactionBulkResult)`. Export the types.
- `packages/schema/src/ui-state.ts`: `hide_register_export_dialog: z.boolean()` in `UI_STATE_FIELDS`, and nothing else.

## 3. Single-edit service (`services/transactions.ts`)

- `transactionToApi` adds `flag_color: row.flagColor ?? null`, and `setOf` adds `flagColor`. `newOtherSide` stays unflagged.
- `TransactionRefused.status` becomes `404 | 409 | 422`.
- Export `prepare`, `Plan` and `isCreditStartingBalance`. `prepare` gains `opts: { allowReconciled?: boolean } = {}`, which skips
  `refuseOtherReconciled` **in the delete branch only**. In the update branch, `after.flagColor` follows `p.flag_color` when it is sent.
- Move `mutate`'s statement building into an exported
  `planWrites(db, { budgetId, actor, id, kind, plan, now, guard, selfGuard }) → { payees, logs, rest, self }`.
  `rest` holds the lines, tombstones and others in today's order. `mutate` runs `[...payees, ...logs, ...rest, self]`, so its behaviour is
  unchanged and the existing tests pass untouched.
- A PATCH whose only key is `flag_color` goes to `bulkTransactions(env, actor, budgetId, {op:"flag", ids:[id], value})` and then answers
  `getTransaction`. It neither approves the row nor is refused for a reconciled one. (`transactions-bulk.ts` and `transactions.ts`
  import each other, as `transaction-splits.ts` already does; only functions cross the cycle.)
- Verify, with the row made reconciled and unapproved by SQL in the Worker test:
  - PATCH `{flag_color:"red"}` answers 200, keeps `approved` false and writes 1 history row;
  - `{flag_color, memo}` answers 409.

## 4. Bulk service (`services/transactions-bulk.ts`)

```ts
export const BULK_MAX_STATEMENTS = 400;
export async function bulkTransactions(env: Env, actor: string, budgetId: string, input: TransactionBulkRequest,
  hooks?: { beforeWrite?: () => Promise<void> }): Promise<TransactionBulkResult>   // hooks: tests only
```
Parse, `activePlan`, distinct ids in the order given. Up to **3 attempts**, then `Conflict("Transaction")`. Each attempt:
1. **Read.** `findDetailMany`. A missing id is `TransactionRefused(404,"not_found","Transaction <id>: not found in this plan")`.
   Then read the lines (`parentIds`), the accounts, and the other sides (`findDetailMany` on `transferTransactionId`).
2. **Refusals.** None writes anything, and each `detail` starts with `Transaction <id>: `.
   - `categorize`: the category is unknown, so 422 "Category not found in this plan".
   - `move`:
     - unknown target: 422 "Account not found in this plan";
     - closed target: 422 `account_closed` (`CLOSED_NO_MOVE`);
     - `transferAccountId === target`: 422 "a transfer cannot be moved into its other account";
     - both sides of one transfer in `ids`: 422 "both sides of a transfer cannot be moved together";
     - an on-budget row with a category, Ready to Assign or lines, going to an off-budget target: 422 "<target> is a tracking account: its transactions take no category".
   - `duplicate`: a closed account, or a closed other account: 422 `account_closed` (`CLOSED_NO_NEW`/`CLOSED_OTHER`).
   - `delete` without `confirm_reconciled`, when the row or its other side is reconciled: 409 `transaction_reconciled`.
3. **Skips** follow the design's table. `categorize` decides them with `transferCategoryRule`, `onBudget`, the lines, and `isCreditStartingBalance`.
   `unchanged` compares against what the op would write (memo trimmed as `clean` does).
4. **Plans.**
   - `clear`/`unclear`/`memo`/`categorize`/`move` call `prepare(db, budgetId, row, account, "update", patch, now)`. The patches:
     - `{cleared}`;
     - `{memo}`;
     - `{category_id}`, or `{category_id:null, inflow_to_ready_to_assign:true}`;
     - `{account_id}`.

     A thrown `TransactionRefused` refuses the request, rethrown with the id prefix. Assert that `payeeCreates` is empty.
   - `delete` calls `prepare(…, "delete", undefined, now, { allowReconciled: confirm })`.
   - `flag`: `updateIfStmt(id, {flagColor, updatedAt: now}, g)` plus an `update` log (`logShape` before and after, with lines).
   - `duplicate` (`copyRows`):
     - the copy has a new id, `approved: true`, `cleared` (a reconciled source becomes `cleared`), new timestamps, no import fields and no flag;
     - lines get new ids, `parentTransactionId` set to the copy, and the same `splitIndex`, amount, payee, category and memo;
     - a transfer gets `newOtherSide(copy, other.accountId, account.name, now)`, linked both ways;
     - writes: `insertIfStmt` for each row, plus one `create` log per parent (with its lines, as `addTransaction` does) and per transfer side.
   - An id that is already another plan's other side (`delete`, `memo`, `duplicate`) is **covered**: it is not planned again,
     it is listed in `changed`, and its copy is that side's copy.
5. **Batch.**
   - `snap` = the selected rows + every `plan.beforeLines` + every `plan.others[].before`, plus the duplicate sources and their lines.
   - `gateId` = the first plan's own row id (for duplicate, the first copy). `g = writtenAt(db, gateId, now)`.
   - The first plan's `self` is built with `unchangedSince(db, snap)`; **every other statement, logs included**, with `g`.
   - Order: `[firstSelf, ...logs, ...rest, ...otherSelfs]`.
   - More than `BULK_MAX_STATEMENTS` statements: 422 `too_many_changes` "Select fewer transactions: this change is too large for one request".
   - Nothing planned: return with no write.
   - Otherwise `hooks?.beforeWrite?.()`, then **one** `db.batch` (not `runGroups`). If `firstSelf` changed 0 rows, retry.

**Result**:
- `changed` and `skipped` in input order;
- `others`: the `plan.others` ids that are not in `ids`;
- `copies`;
- `transactions`: `detailOf` after the write, the copies for duplicate, or `transactionDetailToApi(before, beforeLines)` for delete.

Verify with `apps/worker/test/transactions-bulk.test.ts` (one `describe` per op, REST through `SELF.fetch` like `transactions.test.ts`)
and `transactions-bulk-rules.test.ts`:
- **Rules:** every skip reason and every refusal, with status, code, the `Transaction <id>` prefix and no new `change_log`.
- **History:** one `change_log` per written transaction, with actor `user:` over REST and `mcp:` through a tool.
- **Delete:** a transfer loses both sides, and a split leaves 0 live lines. An import leaves its tombstone, and with `stubBank`
  (`plaid-sync-helpers.ts`; model it on `transactions-approve.test.ts` "DELETE of a matched hand row writes a tombstone") the next sync does not bring it back.
- **Duplicate:** an import's copy is approved with null import fields; a split's copy has equal lines; a transfer's copy is a linked new pair.
- **Move:** both accounts' balances follow.
- **Race:** `beforeWrite` bumps a row's `updated_at` by SQL on every attempt. The result is 409, no row changed and no new `change_log`.
- **Limit:** 101 ids is a 422; 100 ids work.

## 5. Export

- `packages/schema/src/register-export.ts` (pure):
  - `REGISTER_CSV_HEADER`.
  - `registerCsv(rows: readonly PlanTransaction[])`:
    - It starts with a BOM, quotes every text field (doubling `"`), and joins lines with `\n`.
    - Fields: Date `MM/DD/YYYY`. Outflow and Inflow `$1234.56`, the empty side `$0.00`. Cleared `Cleared`, `Uncleared` or `Reconciled`. Flag
      `FLAG_NAMES[c]` or `""`. Category Group/Category `"<group>: <category>"`; Ready to Assign is `Inflow: Ready to Assign`, group `Inflow`,
      category `Ready to Assign`.
    - A split gives one line per subtransaction: the line's payee (else the parent's), the line's category and amount, and memo
      `Split (i/n) <memo>` trimmed.
  - `exportFileName(plan, at: Date, zone: "local"|"utc")` gives `Selected Transactions for <plan> as of YYYY-MM-DD HH-mm.csv`.
  - Test it in `packages/schema/test/register-export.test.ts`: the header, a flagged row, a split, a transfer, a quote in the memo, and the name.
- `services/transactions-export.ts`: `exportTransactions(env, budgetId, ids) → { csv, fileName }`, in the ids' order, with a 404 naming an unknown id. The time is UTC.
- The route answers `c.body(csv, 200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"<ascii, \" → '>\"; filename*=UTF-8''<encoded>" })`.
- Test: `apps/worker/test/transactions-export.test.ts`.

## 6. Routes (`routes/transactions.ts`)

- `POST /budgets/{budget_id}/transactions/bulk`: the body is `TransactionBulkRequest`, 200 is `TransactionBulkResponse` ("What changed, what
  was skipped and why. All or nothing: a refused request changes nothing"), with `...errors` and `refusals(c, …)`.
- `GET /budgets/{budget_id}/transactions/export?ids=` (comma-separated, 1–100): 200 `text/csv` (`z.string()`). **Register it before**
  `GET …/transactions/{transaction_id}`, and test that `export` is not taken for an id.
- `apiPaths()` asserts both new paths in `transactions-bulk.test.ts`.

## 7. MCP (`mcp/tools/transactions.ts`)

- `bulk_update_transactions`:
  - Input: `{ budget_id: Id, ids: z.array(Id).min(1).max(100), op: z.enum(["clear","unclear","categorize","memo","move","duplicate"]), value: z.string().max(500).nullable().optional() }`.
    Send no `value` for clear, unclear and duplicate.
  - Description: `MONEY`; each op and its value (categorize: a category id or "ready_to_assign", and the row is approved; memo: text,
    or null to clear; move: an account id; duplicate: hand-entered approved copies; reconciled rows are skipped); 1 to 100 ids;
    all or nothing; skipped rows listed with reasons; `Returns { op, changed, skipped, others, copies, transactions }`, `dates("date")`,
    `timestamps(["updated_at","created_at"])`.
- `delete_transactions` `{ budget_id, ids, confirm_reconciled? }`: the same, plus that it removes both sides of a transfer and a split's
  lines, that an import never comes back, and that **it cannot be undone through the API**.
- `flag_transactions` `{ budget_id, ids, color: FlagColor.nullable() }`: a transfer's sides are flagged separately, and the row is not approved.
- The field lists of `list_transactions`, `list_unapproved_transactions`, `get_transaction`, `update_transaction`, `approve_transactions`
  and `reject_transactions` add `flag_color` (red … purple, or null). `update_transaction`: a flag-only update neither approves nor
  is refused for a reconciled row.
- `test/mcp-coverage/transactions.ts`:
  - `"POST /budgets/{budget_id}/transactions/bulk": { tool: ["bulk_update_transactions","delete_transactions","flag_transactions"] }`;
  - `"GET /budgets/{budget_id}/transactions/export": { excluded: "a CSV file download for the browser; an agent reads the same rows with list_transactions and get_transaction" }`.
- `test/mcp-timestamps.test.ts`: the three tools join `CALLS`. `delete_transactions` deletes a throwaway row made in the setup, and its call runs last.
  Keep every existing entry.
- `listedToolNames()` asserts the tools, and each is called through MCP once.

## 8. Pure selection module (`packages/schema/src/register-selection.ts`)

```ts
export type SelRow = Pick<PlanTransaction, "id"|"account_id"|"amount"|"cleared"|"approved"|"import_id"|"source"|"transfer_account_id"|"transfer_transaction_id"|"subtransactions"|"payee_system"|"flag_color"|"category_id"|"inflow_to_ready_to_assign">;
export type SelAccount = { id: string; type: string; on_budget: boolean; closed: boolean };
export const countLabel: (n: number) => string;               // "1 Transaction" | "2 Transactions"
export function selectedTotal(rows): { count: number; total: number };
export function takesCategory(r, acct: SelAccount, other: SelAccount | null): boolean;
export function clearOp(rows): "clear" | "unclear" | null;
export function barActions(rows, accountOf: (id: string) => SelAccount | null, where: "account" | "all"):
  { approve; reject; categorize; clear: "clear"|"unclear"|null; makeRepeating; move; anyFlagged };
export const DELETE_TEXT: { reconciledTitle; reconciledBody; manyTitle(n); transferBody; matchingBody };
export function deleteConfirm(rows, otherReconciled: (r) => boolean, forceMatching?: boolean): null | { title; paragraphs: string[] };
```
- `takesCategory`: not reconciled, not a split, `on_budget`, `categoryCell` not `notNeeded`, and not a credit Starting Balance.
- `clearOp`: `clear` if any non-reconciled row is uncleared; `unclear` if all of them (at least one) are cleared; otherwise `null`.
- `reject`: every row is unapproved, with an `import_id`, `source` set, and no transfer.
- `makeRepeating`: exactly one row.
- `move`: `where === "account"`.

The texts are the ticket's, word for word. Test them in `packages/schema/test/register-selection.test.ts`: the +250/-4.50 example, every button rule, and every `deleteConfirm` branch.

## 9. Web API

- `apps/web/src/api/transactions.ts`:
  - `bulkTransactions` and `useBulkTransactions` (idempotency key; invalidate every query holding `budgetId`, like `useSaveTransaction`);
  - `approveTransactions` and `rejectTransactions` with their hooks;
  - `useSetFlag(budgetId, key)`, optimistic like `useSetCleared`, through PATCH `{flag_color}`;
  - `downloadExport(budgetId, ids, fileName)`: a blob fetch the way `api/reports.ts` downloads its export (read, don't edit), saved with `<a download>`.
- `apps/web/src/api/accounts.ts`: replace the `localToday` copy with `export { localToday } from "./today";`. Leave `shell/AddAccountDialog.tsx` alone.

## 10. Selection provider, pages, header

- `register/selection.tsx`:
  - `SelectionProvider` and `useSelection()` give `{ selected, set, toggle, clear, rows, setRows }`.
  - `SelectedTotal` renders nothing below 2 rows. Otherwise it renders `div.acct-balance.acct-selected-total[data-balance=selected]`:
    `span.acct-amount` (`is-negative` below 0) with `formatMoney(total)`, over `span.acct-label` "Selected Total (N)".
- `pages/account.tsx` and `pages/accounts.tsx` wrap the header and `Register` in `<SelectionProvider key={`${budgetId}:${accountId ?? "all"}`}>`.
- `account/AccountHeader.tsx`: `BalanceRow` takes `children`, rendered in `div.acct-balances-right` (`margin-left: auto` in `account-header.css`). Both headers pass `<SelectedTotal />`.

## 11. Table and keys

- `RegisterTable.tsx`:
  - Use `useSelection`; publish the rows; drop selected ids that are gone.
  - Add `<col className="col-flag"/>` (42px) after `col-check`, a header cell `th.cell-flag[aria-label=Flag]` with an outline icon,
    `td.cell-flag` holding `FlagCell` in each row, and an empty `td` in line rows. `colCount = columns.length + 3`.
  - `onRowClick`: on a selected row of a multi-row selection, select only that row. Everything else stays as today.
- `EntryRow.tsx`: add `td.cell-flag` after `cell-check`; `colSpan` + 1. `SplitLines.tsx`: `lead` + 1.
- `register/useRegisterKeys.ts`: one `document` `keydown` listener for the design's keys.
  - It ignores `defaultPrevented`, `altKey`, focus in `input,textarea,select,[contenteditable]`, an open `[aria-modal="true"]`, and an open entry row.
  - `ctrl/meta+A` calls `preventDefault` and selects all.
  - Escape clears (menus stop their own Escape).
  - Letter keys compare `e.key` case-insensitively and check `shiftKey`; `Delete` and `Backspace` both delete.

## 12. Bar, menus, dialogs (`apps/web/src/register/`)

- `ActionBar.tsx`:
  - It is portalled to `body`, `position: fixed; bottom: 48px`, with `left` and `width` from `.register`'s rect (`ResizeObserver` and window resize).
  - The container has `pointer-events: none` and the centred bar `auto`.
  - `role="toolbar" aria-label="Selection actions"`. The first button's name is `countLabel(n)`, title "Deselect all", and it clears the selection.
  - Its buttons are named exactly `Approve`, `Reject`, `Categorize`, `Flag`, `Clear`, `More`.
  - A `role="alert"` error line sits above it.
  - `Register.tsx` shows it when the selection is not empty and adds `.has-actionbar` (`padding-bottom: 112px`).
- `MoreMenu.tsx` (`role="menu" aria-label="More actions"`): `menuitem`s named as the design lists them.
  - Disabled entries use `aria-disabled="true"` and `data-ticket`. Match carries the source's title.
  - "Move to Account" opens `role="menu" aria-label="Move to Account"`: the open accounts other than this one, in sidebar order
    (`sidebarSections` from `@budget/core/account-types`, import only).
  - It is placed centred above More, the way `Dropdown.tsx` places its lists, and clamped to the window.
- `FlagMenu.tsx` (`role="menu" aria-label="Flags"`): `menuitem`s `Clear` and `Red` … `Purple`, each with a `<kbd>` cap, then "Edit Flags" (`aria-disabled`,
  `data-ticket="EXF-480"`). A digit picks; Escape closes with `stopPropagation`. It opens below the cell (arrow up) or above the bar's Flag button.
- `MemoDialog.tsx` (`role="dialog" aria-modal="true"`):
  - Title `Edit Memo (${countLabel(n)})`.
  - An autofocused input with label "Memo" and placeholder "Enter a memo for selected transactions".
  - Buttons "Cancel" and `Update ${countLabel(n)}`, disabled while the trimmed input is empty. Enter submits.
- `DeleteDialog.tsx`: the `deleteConfirm` title and paragraphs, then "Delete" and "Cancel".
- `ExportDialog.tsx`:
  - "Export Transactions", the ticket's text, "Don't show again", "Cancel" and "Export".
  - When the box is ticked, `useSaveUiState` writes `{ hide_register_export_dialog: true }`.
  - The download is named `exportFileName(plan.name, new Date(), "local")`. The plan comes from `useCurrentPlan` (import only).
- `BulkCategorize.tsx`: a `Dropdown` on the Categorize button holding `CategoryField` (`startOpen`, `footer="none"`), with `useMonth` for the current month.
  A pick sends `categorize`.
- After a duplicate, select `copies.map(c => c.copy_id)`.
- `icons.tsx`: `FlagOutlineIcon`, `FlagFilledIcon`, `CloseSmallIcon`, `CategorizeIcon`, `MoreDotsIcon`, `ClearedCircleIcon`, `LinkIcon`, `LinkBrokenIcon`,
  `DuplicateIcon`, `RepeatIcon`, `MemoIcon`, `ExportIcon`, `TrashIcon` and `CaretRightIcon`. Draw your own 16px `currentColor` strokes.
- `register.css`:
  - `:root`: the design's custom properties, and the pill rgba values from the notes (§8b).
  - Sizes from notes §3a/3b/5a/6/8b.
  - The bar animates in with `transform .2s` from `translateY(3rem)`.

## 13. Browser specs

- `e2e/support/bulk-seed.ts`:
  - `seedBulk(request)` creates "ZZ-TEST bulk <random>":
    - `ZZ Checking` (Starting Balance $655.50, cleared), `ZZ Savings` (on budget) and `ZZ Asset` (tracking);
    - uncleared -$100.00 and -$60.00, cleared +$250.00 and -$4.50, and a category.
  - `rewriteList(page, patch)`: `page.route` on the list GETs, editing the JSON (`cleared:"reconciled"`, or `approved:false, import_id, source:"plaid"`).
    It never writes the database.
- `e2e/register-bulk.spec.ts` covers design cases 1–14 and 19; `e2e/register-flags.spec.ts` covers 15–18.
  - Clicks: `realClick` everywhere, and `{ exact: true }` names.
  - Before reading the server, use `expect.poll` on the API.
  - Case 14: `setViewportSize({width:1024,height:700})`, 25 rows. Scroll `.main` to its `scrollHeight`, then realClick the last row's checkbox and its flag cell.
  - Downloads: `waitForEvent("download")`. Match `suggestedFilename()` with
    `/^Selected Transactions for ZZ-TEST bulk .+ as of \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.csv$/`, then check line 1.
- Shift positional indices only: in `register.spec.ts` `nth-child(3)` becomes `4`; in `all-accounts.spec.ts` the `col(page,n)` callers get +1 and `nth-child(2)` becomes `3`;
  in `register-entry.spec.ts` `td.nth(2)` becomes `nth(3)`.
- Run `pnpm check`, then `pnpm e2e e2e/register-bulk.spec.ts e2e/register-flags.spec.ts e2e/register.spec.ts e2e/register-entry.spec.ts e2e/all-accounts.spec.ts e2e/splits.spec.ts e2e/transfers.spec.ts`.

## Done when

- `pnpm check` is green and those specs pass.
- Every design acceptance case is tested, or listed as manual.
- No file outside the Manifest's `touches` changed.
- The report names the routes, tools, coverage lines and migration.
