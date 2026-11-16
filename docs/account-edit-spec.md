# Account edit spec (EXF-486, EXF-488)

Design: [account-edit-design.md](account-edit-design.md). Build in this order; run `pnpm check` after each
Worker task. Do not edit: `repositories/transactions.ts`, `services/transactions.ts`, `routes/transactions.ts`,
`mcp/tools/transactions.ts`, `repositories/payees.ts`, `services/payees.ts`, `apps/web/src/register/**`,
`api/transactions.ts`, `api/payees.ts`, `packages/core/src/**`, any migration, `paths.always_overlap`, and the
surface tests (`openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`,
`mcp-descriptions.test.ts`, `e2e/mcp.spec.ts`).

## 1. Schema: `packages/schema/src/accounts.ts`

- `Account`: add `can_delete: z.boolean().openapi({ description: "True when DELETE would succeed: an open account whose only transaction is its Starting Balance (or none), a closed account with no transactions" })`.
- `accountUpdateFields` (strict) becomes:
  `{ name: z.string().max(100).optional(), note: z.string().max(500).nullable().optional(), starred: z.boolean().optional() }`.
  No `min(1)` on name: the service answers `name_required`. Keep `accountUpdateShape` and the "Nothing to update" refine.
- New:
  ```ts
  export const accountAdjustFields = { balance: Milliunits, today: PlanDate.optional() };
  export const AccountAdjustBalanceRequest = z.object(accountAdjustFields).strict().openapi("AccountAdjustBalanceRequest");
  export const accountCloseFields = { today: PlanDate.optional() };
  export const AccountCloseRequest = z.object(accountCloseFields).strict().openapi("AccountCloseRequest");
  export const AccountAdjustmentResponse = dataEnvelope(z.object({ account: Account, adjustment: Transaction.nullable() })).openapi("AccountAdjustmentResponse");
  export const AccountDeleteResponse = dataEnvelope(z.object({ account_id: z.uuid(), deleted_transaction_ids: z.array(z.uuid()) })).openapi("AccountDeleteResponse");
  export const MANUAL_ADJUSTMENT_PAYEE = "Manual Balance Adjustment";
  export const CLOSED_ACCOUNT_MEMO = "Closed Account";
  ```
  plus `z.input` types `AccountAdjustBalanceRequest`, `AccountCloseRequest`.
- The close body is optional on the wire: the route accepts a missing body as `{}`.

Verify: `pnpm check` typechecks; Worker tests still compile.

## 2. Repository: `apps/worker/src/repositories/accounts.ts`

Add (reads, and `*Stmt`/guard builders that return unexecuted statements; reuse the existing style):

- `transactionFacts(db, budgetId, accountId?) → Map<accountId, { count: number; startingId: string | null }>`:
  active transactions per account (`deleted_at is null`), and the id of the active one whose payee has
  `system = 'starting_balance'` (left join `payees`; null when none). One grouped query.
- `canDelete(row: AccountRow, f?: { count; startingId }) → boolean`: `f` absent = `{count 0}`; closed → `count === 0`;
  open → `count === 0 || (count === 1 && startingId !== null)`. (Pure; may live in the service instead.)
- `accountSumSql(accountId)`: `(select coalesce(sum(amount),0) from transactions where account_id = ? and deleted_at is null)`.
- `holdsCondition(before)`: id, `deleted_at is null`, `name = before.name`, `note is before.note`,
  `starred = before.starred`, `closed = before.closed`, `bank_account_id is before.bankAccountId`. Export
  `accountHolds(db, before, extra?: SQL)` → `SELECT 1 … where holds and extra`.
- `nameFreeSql(budgetId, accountId, name)`: `not exists (… other non-deleted account of the plan, id <> accountId, lower(name) = lower(?))`.
- `updateFieldsIfStmt(db, before, set: { name?; note?; starred? }, extra?: SQL)`: UPDATE where holds and extra.
- `closeIfStmt(db, before, extra: SQL)`: set `closed 1, starred 0, bank_account_id null, import_start_date null` where holds and extra.
- `reopenIfStmt(db, before)`: set `closed 0` where holds.
- `noOtherTransactionsSql(accountId, exceptId: string | null)`: no active transaction of the account other than `exceptId`.
- `softDeleteStartingBalanceStmt(db, txId, accountId, at)`: UPDATE transactions set `deleted_at = at, updated_at = at`
  where id = txId and account_id and `deleted_at is null` (the one transactions-table write, kept here per the lead).
- `softDeleteIfStmt(db, before, at, extra: SQL)`: set `deleted_at = at, bank_account_id null, import_start_date null` where holds and extra.

Keep `starHolds`/`setStarredIfStmt` working (or reimplement `updateAccount` on `holdsCondition` and delete them if
unused; `account-star.test.ts` must still pass).

## 3. Service: `apps/worker/src/services/accounts.ts`

- `type AccountFacts = { cleared: number; uncleared: number; canDelete: boolean }`;
  `accountToApi(row, f: AccountFacts = { cleared: 0, uncleared: 0, canDelete: true })` adds `can_delete`.
  The create paths pass `canDelete: true`.
- `accountFacts(db, budgetId, accountId?) → Map<string, AccountFacts>` (merges `txRepo.balancesByAccount` and
  `accountsRepo.transactionFacts`; needs the rows' `closed`, so take the rows or return a function
  `(row) => AccountFacts`). `listAccounts`, `getAccount`, `updateAccount` use it.
- `AccountRefused(detail, status: 409 | 422 = 422, code = "unprocessable_entity")`; existing callers unchanged.
- `updateAccount` (same signature): trims `name`; blank → `AccountRefused("The account name is required.", 422, "name_required")`;
  `nameTaken` excluding itself → `NameTaken`. `note`: blank → null. Starred rule unchanged. No real change → return
  the account (no write). One batch: `changeLogInsertIf(update, before/after, accountHolds(before, nameFree))`,
  `updateFieldsIfStmt(…, nameFree)`. Lost race: re-read; if the name is now taken → `NameTaken`; else retry ×5 → `Conflict`.
- `adjustmentRow(...)`: builds the `txRepo.TransactionRow`: payee `manual_adjustment` (`payeeName` = `MANUAL_ADJUSTMENT_PAYEE`),
  `categoryId null`, `inflowToReadyToAssign = row.onBudget`, `cleared "cleared"`, `approved true`, memo per caller.
- `systemPayeeStmts(db, actor, budgetId, existing, now)`: when the plan has no `manual_adjustment` payee, the
  `payeesRepo.insertSystemIfMissingStmt` + guarded payee `create` log (copy the Starting Balance block of
  `insertAccountWithStartingBalance`; factor it into one helper used by both).
- `adjustBalance(env, actor, budgetId, accountId, input) → { account, adjustment: Transaction | null }`:
  parse `AccountAdjustBalanceRequest`; plan and account (404); closed → `AccountRefused("A closed account's balance cannot be adjusted", 422, "account_closed")`;
  `working = cleared + uncleared`; `delta = balance - working`; 0 → `{ account, adjustment: null }`.
  Batch, guard `G = accountHolds(before, accountSum = working)`:
  `[...payee stmts, changeLogInsertIf(account update, before/after balances, G), txRepo.insertIfStmt(tx, G, payeesRepo.systemIdSql(budgetId, "manual_adjustment")), changeLogInsertIf(transaction create, accountsRepo.transactionExistsStmt(db, tx.id))]`
  (add `transactionExistsStmt` to the accounts repository: `SELECT 1 from transactions where id = ?`).
  Success = the insert's `meta.changes > 0`; else retry ×5 → `Conflict`. Return the account with the new
  balances (`cleared + delta`) and `transactionToApi` of the row with the payee id read back (as the create path does).
- `closeAccount(env, actor, budgetId, accountId, input) → { account, adjustment }`: already closed → unchanged,
  `adjustment null`. `working ≠ 0` → adjustment with memo `CLOSED_ACCOUNT_MEMO`, amount `-working`. Batch order:
  payee stmts; account `update` log with `after: { ...accountToApi(after, zeroFacts), adjustment_id }` guarded on
  `accountHolds(before, accountSum = working)`; the tx insert and its log (same guard / tx exists); then
  `closeIfStmt(before, accountSum = 0)`. Success = the close UPDATE changed a row. `after` facts: balances 0,
  `canDelete` false when an adjustment or any transaction exists.
- `reopenAccount(env, actor, budgetId, accountId) → Account`: open → unchanged; else log + `reopenIfStmt`.
- `deleteAccount(env, actor, budgetId, accountId) → { account_id, deleted_transaction_ids }`: facts; `!canDelete` →
  `AccountRefused(HAS_TX, 409, "has_transactions")` with `HAS_TX = "This account has transactions other than its Starting Balance, so it cannot be deleted. Close it instead to keep its history."`
  (closed: "…delete all of its transactions first."). Batch with `at = now`: when `startingId`: `transaction delete`
  log (before = `transactionToApi` of the row, after null) guarded on `accountHolds(before, noOtherTransactions(startingId))`,
  `softDeleteStartingBalanceStmt`; then `account delete` log (after null) guarded on the same account guard, and
  `softDeleteIfStmt(before, at, noOtherTransactions(null))` last. Success = account UPDATE changed; else retry → `Conflict`.
- `today` default everywhere: `new Date().toISOString().slice(0, 10)`.

`apps/worker/src/services/account-links.ts`: `balancesOf` returns `AccountFacts` via `accountFacts` (needed by
`accountToApi`); no rule change. Linking a closed account stays refused.

Verify: `apps/worker/test/account-edit.test.ts` and `account-close.test.ts` (task 6).

## 4. Routes: `apps/worker/src/routes/accounts.ts`

- `PATCH`: add `409` and map `NameTaken` → 409 `name_taken`, `AccountRefused` → its status and code.
- New `createRoute`s (params `budget_id`, `account_id`; tags `Accounts`; errors 403/404/422):
  - `POST /budgets/{budget_id}/accounts/{account_id}/adjust-balance`, body `AccountAdjustBalanceRequest` (required), 200 `AccountAdjustmentResponse`, 409 conflict.
  - `POST …/close`, body `AccountCloseRequest` (`required: false`; treat a missing/empty body as `{}`), 200 `AccountAdjustmentResponse`.
  - `POST …/reopen`, no body, 200 `AccountResponse`.
  - `DELETE /budgets/{budget_id}/accounts/{account_id}`, 200 `AccountDeleteResponse`, 409 `has_transactions`.
- Pass `c.get("identity").actor`. All in this one file (the DELETE shares its path with GET/PATCH).

## 5. MCP: `apps/worker/src/mcp/tools/accounts.ts` and coverage

- `update_account`: input adds `name`, `note` (from `accountUpdateShape`); description: changes name (unique in the
  plan ignoring case; blank and taken names are tool errors), note (null or blank clears it) and starred; `MONEY`;
  returns `{ account }` with id, name, note, starred, closed, group, balances and can_delete.
- `adjust_account_balance` `{ budget_id, account_id, balance, today? }`: "Set an open account's working balance by
  adding a cleared, approved "Manual Balance Adjustment" transaction for the difference; on-plan accounts
  (checking, savings, cash, creditCard, lineOfCredit) send it to Ready to Assign, tracking and loan accounts take no
  category. balance is the signed working balance (debts negative). No difference → no transaction. ${MONEY}
  ${DATE} today defaults to the UTC date. Returns { account, adjustment } (adjustment null when unchanged)."
- `close_account` `{ budget_id, account_id, today? }`: zeroing adjustment with memo "Closed Account" when the
  balance is not zero, closes, unstars, unlinks a linked account; returns `{ account, adjustment }`. `MONEY`, `DATE`.
- `reopen_account`: returns `{ account }`; the closing adjustment stays; `MONEY`.
- `delete_account`: "Delete an account and its Starting Balance. Refused (tool error) when the account has any other
  transaction, or, for a closed account, any transaction at all: close it instead. Returns { account_id,
  deleted_transaction_ids }." `MONEY` is not needed (no money in or out); include it only if
  `mcp-descriptions.test.ts` requires it for this shape.
- `apps/worker/test/mcp-coverage/accounts.ts` adds:
  ```
  "POST /budgets/{budget_id}/accounts/{account_id}/adjust-balance": { tool: "adjust_account_balance" },
  "POST /budgets/{budget_id}/accounts/{account_id}/close": { tool: "close_account" },
  "POST /budgets/{budget_id}/accounts/{account_id}/reopen": { tool: "reopen_account" },
  "DELETE /budgets/{budget_id}/accounts/{account_id}": { tool: "delete_account" },
  ```

Verify: `pnpm check` (coverage and description tests pass without edits to them).

## 6. Worker tests

`apps/worker/test/account-edit.test.ts` (EXF-486) and `apps/worker/test/account-close.test.ts` (EXF-488), with
`helpers.ts` and `surface.ts`:

- Surface: `apiPaths()` contains `/api/v1/budgets/{budget_id}/accounts/{account_id}/adjust-balance`, `/close`,
  `/reopen`; `listedToolNames()` contains the four new tools.
- Design acceptance 3–8, 10, 13–18, 20–23 at the API level: status codes and error names; transaction fields
  (payee name via the account's transaction list, `payee_system` `manual_adjustment`, memo, cleared, approved,
  amount, `inflow_to_ready_to_assign` per type: checking/creditCard true, otherAsset/otherLiability/loan false);
  RTA via `GET /budgets/{id}/months/{month}` before/after; `change_log` rows per the design table, actors
  `user:`/`mcp:`; `can_delete` on list and get; `today` honoured and defaulted; a second system payee is never
  created (two adjustments share one `manual_adjustment` payee); delete leaves `deleted_at` set on the account and
  the Starting Balance and nothing else; 409 delete writes no row; linked close/delete (Plaid stub as in
  `account-links.test.ts`).
- Atomicity: five parallel adjust-balance; parallel renames to one name.

## 7. Web API: `apps/web/src/api/accounts.ts`

Add `adjustAccountBalance(budgetId, accountId, { balance, today })`, `closeAccount(budgetId, accountId, { today })`,
`reopenAccount`, `deleteAccount` (each with `idempotencyKey: crypto.randomUUID()` and its response schema), and
hooks `useUpdateAccount`, `useAdjustBalance`, `useCloseAccount`, `useReopenAccount`, `useDeleteAccount`, each
invalidating every query of the plan on success (`predicate: (q) => q.queryKey.includes(budgetId)`, as
`useCreateAccount`). Delete must not refetch the deleted account's own query before navigating (navigate first,
then invalidate, or `removeQueries` for `["accounts", budgetId, accountId]`).

## 8. Dialogs: `apps/web/src/account/`

- `EditAccountDialog.tsx`: `export function EditAccountDialog({ budgetId, account, onClose }: { budgetId: string; account: Account; onClose: () => void })`.
  Markup: `.dialog-backdrop` > `form.dialog.form.edit-account[role=dialog][aria-modal=true][aria-label="Edit Account"]`;
  head `h2` "Edit Account" + `button.icon-button[aria-label=Close]` with `CloseIcon` (from `shell/icons`);
  body: `h3` "Account Information", `label[for]` "Account Nickname" + `input.field` (autoFocus),
  `label` "Account Notes" + `textarea.field[rows=2]`; open only: `hr`, `label` "Working Balance" | "Today's Balance"
  (`account.on_budget`), `input.field[inputMode=decimal]`, `p.helper` text; footer as in the design
  (classes: `.ghost` Re-open, `.destructive` Delete / Delete Account / Close Account, `.secondary` Cancel,
  `.primary` Save; `.footer-left` with `margin-right: auto`).
  - Balance prefill: `formatMoney(account.balance).replace("$", "")`.
  - Errors: `{ name?, balance?, other? }` rendered as `p.error-bar[role=alert]` right under the field; editing the
    field clears its error.
  - Save flow, Delete, Re-open, Close Account as in the design; disable the footer buttons while a request runs.
  - Escape: a `keydown` listener on `document` (as `AddAccountDialog`) calls `onClose`.
  - `localToday()` from `api/accounts.ts` for `today`.
  - Close Account: when `account.balance === 0` call close directly; else render `CloseAccountDialog` instead of
    the edit form (state `"edit" | "confirm-close"` inside this component), so both pencils get it for free.
- `CloseAccountDialog.tsx`: `({ account, busy, onCancel, onConfirm })`, `aria-label="Close Account"`, `h2` "Close
  Account", the text with `formatMoney(-account.balance)`, `div.info-box` (only when `account.on_budget`), footer
  "Cancel" / "Adjust Balance & Close". Escape and X cancel.
- `edit-account.css`: the measured values of the design's Source section (heading 600 16 px, field 32 px /
  radius `--radius-xs`, textarea `resize: vertical; min-height: 32px`, focus border colours, divider
  `--borderSubtle`, helper 14 px `--labelSecondary`, `.ghost` (`--buttonGhostLabel`, hover
  `--buttonSecondaryBackground`, padding 4px 8px, 14 px), `.destructive` (`--statusNegative`, white; disabled
  `--menuHover` / `--labelTertiary`, `cursor: default`), `.secondary:hover` `--buttonSecondaryBackgroundHover`,
  `.primary:hover` `--actionPrimary`, `.error-bar` (`--statusNegative` background, `--labelPrimary` text, 14 px,
  padding 4px 8px, radius 0 0 4px 4px), `.info-box` (`--backgroundSecondary`, radius `--radius-md`, padding 8px,
  14 px)). Variables only, no raw colours.
- `AccountHeader.tsx`: the pencil gets `onClick={() => setEditing(true)}` (drop `data-ticket` and the "Drawn, not
  wired" comment) and renders `<EditAccountDialog …/>` while editing.
- `shell/tokens.css`: `--buttonGhostLabel: #a3acff;` `--buttonSecondaryBackgroundHover: rgba(117, 131, 255, 0.27);`.
- `shell/Sidebar.tsx`: `const [editingId, setEditingId] = useState<string | null>(null)`; `<SidebarAccounts … onEdit={setEditingId} />`;
  render `<EditAccountDialog budgetId={plan.id} account={accountList.find(a => a.id === editingId)} …/>` when found.
- `shell/SidebarAccounts.tsx`: drop the "EXF-486 wires onEdit" comment (behaviour already calls `onEdit`).

Verify: `pnpm check`; `pnpm dev`, open both pencils; the dialog fits at 1024×700.

## 9. e2e

- `e2e/sidebar-groups.spec.ts`: fixture `fx` adds `can_delete: false`; the test "pencil shows on hover and does
  nothing yet" becomes "pencil shows on hover and opens Edit Account" (same hover/opacity checks; URL unchanged;
  dialog "Edit Account" visible; Escape closes it).
- `e2e/edit-account.spec.ts` (EXF-486): design cases 1–9, 11, 12. `e2e/close-account.spec.ts` (EXF-488): cases
  13–20. Each spec makes its own plan (`ZZ-TEST <random>`) and accounts over REST; clicks with `realClick`
  (hover the sidebar row before its pencil); one case at 1024×700; `{ exact: true }` names; after a click that
  writes, `expect.poll` the server read before asserting on it; never write to D1 from the spec. "No request sent"
  is checked with `page.on("request")` filtered to non-GET `/api/v1/` calls.
- Run the new and changed specs only: `pnpm e2e e2e/edit-account.spec.ts e2e/close-account.spec.ts e2e/sidebar-groups.spec.ts e2e/account-header.spec.ts`.

## 10. Docs

`docs/README.md` already has the design line (added with this plan). No other docs file changes.
