# Account header, All Accounts register, stored updated_at: implementation spec

Design: [account-header-design.md](account-header-design.md). Do the tasks in order: T1–T3 (EXF-570) first, because the rest builds on them. Run `pnpm check` after each group. If a migration is added, delete `.e2e-state` before running `pnpm e2e {specs}`.

Names below are binding: tests and the Tester rely on them.

## T1: migration and table (EXF-570)

- **New migration** `apps/worker/migrations/$(date -u +%Y%m%d%H%M%S)_transactions_updated_at.sql`. It must sort after every file on `origin/main`. The SQL is exactly the design's two statements: the `ALTER … NOT NULL DEFAULT ''`, then the backfill `UPDATE`. Each statement ends with `;`, because `readD1Migrations` splits on it.
- **`apps/worker/src/db/schema/transactions.ts`**: add `updatedAt: text("updated_at").notNull()` after `deletedAt`, with no `.default()`.
- **Verify**: `schema-drift.test.ts` passes, and TypeScript now flags every `TransactionRow` literal that lacks `updatedAt` (T2 fixes them).

## T2: writers and reads (EXF-570)

`apps/worker/src/repositories/transactions.ts`:

- `insertIfStmt`: append `${r.updatedAt}` after `${r.deletedAt}`. That is the table's column order: an added column comes last.
- `updateIfHoldsStmt(db, before, after, updatedAt: string)`: `.set({...same fields, updatedAt})`.
- `softDeleteIfHoldsStmt(db, before, at: string)`: `.set({ deletedAt: at, updatedAt: at })`.
- Delete `lastChangedAt` and the now unused `changeLog` import.
- **New** `openAccountsBalances(db, budgetId): Promise<{cleared: number; uncleared: number}>`. It sums over `transactions` inner-joined to `accounts` on id, where:
  - `transactions.budget_id = budgetId`;
  - `transactions.deleted_at` is null;
  - `accounts.deleted_at` is null;
  - `accounts.closed = 0`.

  It uses the same `case` expressions as `balancesByAccount` and gives `{0, 0}` when there are no rows.
- **New** `listDetailForPlan(db, budgetId, sinceDate?): Promise<PlanDetailRow[]>`, where `PlanDetailRow = TransactionDetailRow & { accountName: string }`. It takes `detailSelect`'s columns plus `accounts.name`, with `innerJoin(accounts, and(eq(accounts.id, transactions.accountId), isNull(accounts.deletedAt)))`. The conditions are the budget, `transactions.deleted_at` null and the optional `date >= sinceDate`. Closed accounts are included. Keep `toDetail`'s shape and add `accountName`.

`apps/worker/src/services/transactions.ts`:

- `createTransaction` and `addTransaction`: `const now = new Date().toISOString()`, then `createdAt: now, updatedAt: now`.
- `transactionDetailToApi(row)`: single argument, `updated_at: row.updatedAt`. Update every caller:
  - `detailOf` drops the `lastChangedAt` call;
  - `listAccountTransactions` drops the `changed` map and the `Promise.all` entry;
  - the delete return becomes `transactionDetailToApi({ ...before, updatedAt: deletedAt })`.
- `mutate`: compute `now` once per attempt. Pass it to `updateIfHoldsStmt(db, before, prepared.after, now)` or to `softDeleteIfHoldsStmt(db, before, now)`.
- `prepare` spreads `...before` into `after`. That is fine: the statement sets `updatedAt` explicitly.

`apps/worker/src/services/accounts.ts`, in `addUnlinkedAccount`: add `updatedAt: now` to `tx`.

**category-reassign**: run `git ls-tree origin/main apps/worker/src/repositories/category-reassign.ts` now, and again after each rebase.

- If the file exists: give its update `updatedAt` (one `now` per batch, the same value its history rows describe), and add a case to `transactions-updated-at.test.ts`: reassign, then the moved rows' `updated_at` falls between the times before and after the call.
- If it does not exist: say so in the report.

**Verify**: `transactions.test.ts`, `accounts.test.ts`, `months.test.ts` and the other Worker tests pass unchanged, and `grep -rn lastChangedAt apps/` finds nothing.

## T3: EXF-570 tests (`apps/worker/test/transactions-updated-at.test.ts`, new)

Keep the backfill case in this file only: it rewrites `updated_at` table-wide.

- **Writers**:
  - POST a transaction: `updated_at === created_at`.
  - PATCH the amount, then PATCH `cleared`. Each time, take `t0`/`t1` ISO strings around the request and assert `t0 <= updated_at <= t1` and that it is greater than the previous value.
  - REST `GET …/transactions/{id}`, the row in `GET …/accounts/{a}/transactions`, and the MCP `list_transactions` row are deep-equal.
  - The Starting Balance from `POST …/accounts`: read through the list, `updated_at === created_at`.
  - DELETE returns `updated_at` equal to the soft-delete time, and the D1 row's `updated_at = deleted_at`.
- **No change_log**: wrap the binding to record every `prepare()` SQL:

  ```ts
  new Proxy(env.DB, { get: (t, p) => p === "prepare" ? (q: string) => (seen.push(q), t.prepare(q)) : bind(Reflect.get(t, p), t) })
  ```

  Call `call(path, await authed(), { DB: spy })` for the account list and for the plan list. Assert `seen.length > 0` and that no entry matches `/change_log/`. Also assert `"lastChangedAt" in txRepo === false`.
- **Backfill**:
  - Insert 4 transactions with raw SQL, `updated_at = ''` and `created_at = 2026-01-01T00:00:00.000Z`.
  - Give them change_log rows (entity_type `transaction`, the same budget_id): none; one at `…T01`; three at `…T01`/`…T03`/`…T02`; one at `2025-12-31…`. Add one row with the same entity id under **another** budget_id at `…T09`, which must be ignored.
  - Run the `UPDATE` from `env.TEST_MIGRATIONS.find(m => m.name.endsWith("_transactions_updated_at.sql")).queries`, the query that starts with `UPDATE`.
  - Expect `created_at`, `…T01`, `…T03`, `created_at`. Compute the expected values with the old rule (`max > created_at ? max : created_at`) in the test, so the equivalence is explicit.
  - Then `SELECT count(*) … WHERE updated_at = ''` is 0.

## T4: schemas (EXF-484, EXF-534)

`packages/schema/src/transactions.ts`:

- `PlanTransaction = TransactionDetail.extend({ account_name: z.string() }).openapi("PlanTransaction")`
- `PlanTransactionListResponse = dataEnvelope(z.object({ transactions: z.array(PlanTransaction), balances: AccountBalances }))`
- the matching types.

`packages/schema/src/register.ts`:

- `PLAN_SORT_COLUMNS = ["account", ...REGISTER_SORT_COLUMNS] as const` and `PlanSortColumn`.
- `SortableTx` gains optional `account_name?: string`.
- `sortTransactions(rows, column: PlanSortColumn, dir)`, where `key(tx, "account") = tx.account_name ?? ""` (collator). The tie rules are unchanged.

`packages/schema/test/register.test.ts`: add the account sort (desc/asc by name, and same-name ties by date desc then amount).

`packages/schema/src/accounts.ts`:

- `AccountUpdateRequest = z.object({ starred: z.boolean().optional() }).strict().refine(o => Object.keys(o).length > 0, "Nothing to update").openapi("AccountUpdateRequest")`
- `accountUpdateShape` (the unrefined object's `.shape`, for MCP)
- `AccountSummaryResponse = dataEnvelope(z.object({ balances: AccountBalances })).openapi("AccountSummaryResponse")`, importing `AccountBalances` from `./transactions`.

## T5: accounts API (EXF-484)

`repositories/accounts.ts`:

- `starHolds(db, before: AccountRow)`: `SELECT 1` where id, `deleted_at` null, `starred = before.starred` and `closed = before.closed`.
- `setStarredIfStmt(db, before, starred)`: an update with the same condition.

`services/accounts.ts`:

- `export class AccountRefused extends Error { status: 422; code = "unprocessable_entity" }`.
- `updateAccount(env, actor, budgetId, accountId, patch: AccountUpdateRequestInput): Promise<Account>`:
  1. Parse the patch, check the plan (404), and loop at most 5 times.
  2. `findActive` (404 "Account").
  3. If `patch.starred === true && before.closed`, throw `AccountRefused("A closed account cannot be starred")`.
  4. If `patch.starred` is undefined or equals `before.starred`, return `accountToApi(before, balances)`.
  5. Otherwise run `db.batch([changeLogInsertIf(db, {budgetId, actor, action: "update", entityType: "account", entityId, before: accountToApi(before, b), after: accountToApi(after, b)}, starHolds(db, before)), setStarredIfStmt(db, before, starred)])`.
  6. If the update changed a row, return `after`. After 5 lost rounds, throw `Conflict("Account")`.
- `getAccountSummary(env, budgetId): Promise<AccountBalances>`: check the plan (404), then `openAccountsBalances` with `working = cleared + uncleared`.

`routes/accounts.ts`:

- `PATCH /budgets/{budget_id}/accounts/{account_id}`, with body `AccountUpdateRequest`, answering 200 `AccountResponse`. It maps `AccountRefused` to `apiError(c, 422, "unprocessable_entity", msg)`, as the POST maps `UnsupportedAccountType`.
- `GET /budgets/{budget_id}/account-summary`, answering 200 `AccountSummaryResponse` as `{ data: { balances } }`.

`mcp/tools/accounts.ts`:

- `get_account` (input `{budget_id, account_id}`) returns `{ account: await getAccount(...) }`.
- `update_account` (input `{budget_id, account_id, ...accountUpdateShape}`) returns `{ account: await updateAccount(env, actor, …) }`. Its description states that a closed account cannot be starred, and that `starred` adds or removes the account from the sidebar's STARRED group.

**Tests** in `apps/worker/test/account-star.test.ts` (new):

- PATCH true/false: 200, `starred` flips, and two `update` change_log rows on `account` with `before.starred`/`after.starred` and actor `user:tester@localhost`.
- A PATCH with no change: 200 and no log.
- MCP `update_account`: actor starts with `mcp:`, and the log shape is the same.
- `get_account` deep-equals REST GET.
- Closed (via `UPDATE accounts SET closed = 1`): `starred: true` answers 422 with no log; `false` answers 200.
- 404s: unknown plan, unknown account, and another plan's account. An empty body or `{name: "x"}` answers 422.
- An Idempotency-Key replay gives the same response and one log row.
- Summary: Checking 250000, Credit Card 150000, Asset 5000000, plus a Savings account with a balance that is then closed in SQL. The summary equals the sums over `GET …/accounts` where `!closed`.
- `GET …/accounts/summary` answers 404 with detail "Account not found".

In `accounts.test.ts`, add the surface assertions: `apiPaths()` contains `/api/v1/budgets/{budget_id}/account-summary` (the PATCH shares the existing `/accounts/{account_id}` entry: assert the document's `paths[...]` has a `patch` key), and `listedToolNames()` contains `get_account` and `update_account`.

## T6: plan-wide transactions (EXF-534)

`services/transactions.ts`: `listPlanTransactions(env, budgetId, opts: {sinceDate?, sort?: PlanSortColumn, dir?})` returns `{transactions: PlanTransaction[], balances}`. It checks the plan (404) and loads in parallel `listDetailForPlan` and `openAccountsBalances` (adding `working`). Each row maps to `{...transactionDetailToApi(r), account_name: r.accountName}`, then `sortTransactions(rows, sort ?? "date", dir ?? "desc")`.

`routes/transactions.ts`: `GET /budgets/{budget_id}/transactions`, with query `since_date`, `sort: z.enum(PLAN_SORT_COLUMNS)` and `dir`, answering 200 `PlanTransactionListResponse`. It is registered on the same path as the existing POST.

`mcp/tools/transactions.ts`, `list_transactions`:

- The input is `{budget_id, account_id?: id.optional(), since_date?}`.
- With `account_id`, it behaves as today. Without it, it returns `listPlanTransactions`.
- Update the description: "Without account_id: every account's rows (closed accounts included), each with account_name, and balances summed over the open accounts."

**Tests** in `apps/worker/test/plan-transactions.test.ts` (new):

- Two open accounts plus one closed (closed in SQL after it gets a row); a deleted transaction is excluded.
- Each row's `account_name` is correct.
- The default order is date desc.
- `sort=account&dir=asc|desc` equals `sortTransactions(rows, "account", dir)`.
- `since_date` limits the rows but not the balances.
- `balances` equal `GET …/account-summary`.
- MCP `list_transactions {budget_id}` deep-equals REST `data`.
- An unknown plan answers 404, and `sort=bogus` answers 422.

In `transactions.test.ts`, the surface case adds a `get` key on `/api/v1/budgets/{budget_id}/transactions`.

## T7: web API modules

`api/accounts.ts`:

- `updateAccount(budgetId, accountId, patch)`: PATCH with `idempotencyKey: crypto.randomUUID()` and schema `AccountResponse`.
- `useSetStarred(budgetId, accountId)`:
  - `onMutate`: cancel `["accounts", budgetId]`, flip `starred` in the cached `["accounts", budgetId, accountId]` and in the matching row of `["accounts", budgetId]`, and return the snapshots.
  - `onError`: restore the snapshots.
  - `onSettled`: `invalidateQueries({ queryKey: ["accounts", budgetId] })`.
- `getAccountSummary(budgetId)` and `useAccountSummary(budgetId)`, with key `["account-summary", budgetId]`.

`api/transactions.ts`:

- `listPlanTransactions(budgetId)` and `usePlanTransactions(budgetId)`, with key `["transactions", budgetId, "all"]` and `retry: false`.
- `useSetCleared(budgetId, key: readonly unknown[])`: use `key` instead of building it, and keep the optimistic map generic over the row type. Update the call in `RegisterTable`.

## T8: header components (EXF-484): `apps/web/src/account/`

- **`icons.tsx`**: `CashIcon`, `CardIcon`, `ChartUpIcon`, `ChartDownIcon`, `LockIcon`, `PencilIcon`, `StarOutlineIcon`, `StarFilledIcon`. Each is a `(p: SVGProps<SVGSVGElement>) => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden …/>`, drawn by us. Reuse `ClearedFilledIcon` and `ClearedOutlineIcon` from `../register/icons`.
- **`Tooltip.tsx`**: `Tooltip({ content: ReactNode, delayed?: boolean (default true), align?: "start" | "end", children: (props) => ReactElement })`.
  - `children` receives `{ "aria-describedby", onMouseEnter, onMouseLeave, onFocus, onBlur, onKeyDown }` to spread on the trigger.
  - It wraps the trigger in `span.acct-tip-anchor` (`position: relative; display: inline-flex`).
  - It renders `span.acct-tooltip[role=tooltip][id=useId()]` only while open, with `.is-delayed` for the 1.9s fade.
  - Escape closes it.
- **`AccountHeader.tsx`**:
  - `BalanceRow({ cleared, uncleared, working }: Partial<AccountBalances>)`, where `TIPS` holds the three ticket texts verbatim as constants.
  - `AccountHeader({ account }: { account?: Account })`: with no account, render an empty `header.acct-head` with an empty `.acct-head-top`.
  - `AllAccountsHeader({ budgetId })` uses `useAccountSummary`.
  - Badge text is `ACCOUNT_BADGE[type] ?? ACCOUNT_TYPE_LABEL[type]`, imported read-only from `../shell/accountTypeLabels`. The icon map is in the design.
  - The star's click calls `setStarred.mutate(!account.starred)`.
  - `.acct-edit` and `.acct-reconcile` carry `data-ticket` and have no `onClick`.
- **`account-header.css`**: the custom properties of the design at the top, then the rules with the Source section's values. Use tokens otherwise: `--backgroundSecondary`, `--labelPrimary`, `--labelSecondary`, `--statusPositive`, `--buttonPrimaryBackground`, `--actionPrimary`, `--buttonSecondaryBackground`, `--buttonSecondaryLabel`, `--buttonSubtleBackground`, `--inputBackground` (tooltip background), `--space-*` and `--radius-*`. `.acct-amount` is `--statusPositive`, and `.acct-amount.is-negative` is `--labelPrimary`. The star is 16px with a left margin of 8px, vertically centred on the name. Focus rings use `outline: 2px solid var(--actionPrimary); outline-offset: 2px` on `:focus-visible`.

## T9: pages and register (EXF-484, EXF-534)

- **`pages/account.tsx`**: keep the redirect on a 4xx. Render `<AccountHeader account={account} />` and, once the account is loaded, `<Register key={account.id} budgetId={budgetId} account={account} />`. Remove the old header JSX and the `Fragment`, `formatMoney` and `PageHeader` imports.
- **`pages/accounts.tsx`**: `<AllAccountsHeader budgetId={budgetId} />` then `<Register budgetId={budgetId} />`. Get `budgetId` from `useParams` and keep `usePageTitle("All Accounts")`.
- **`register/Register.tsx`**: `Register({ budgetId, account }: { budgetId: string; account?: Account })`. The toolbar name is `account?.name ?? "All Accounts"`.
- **`register/RegisterTable.tsx`**: `RegisterTable({ budgetId, account })`, where `plan = !account`.
  - **Query**: call both hooks with `enabled` so the hook order stays stable, or split into two small wrappers around a shared `Table` component. Do **not** copy the table.
  - **Rows** are typed `TransactionDetail & { account_name?: string }`.
  - **Headers**: `[{column: "account", label: "ACCOUNT"}]` is prepended when `plan`. CATEGORY shows when `plan || account.on_budget`.
  - **colgroup**: add `col.col-account` (CSS `width: 10%`) after `col-check` when `plan`.
  - **Category cell**: `categoryCell(tx, account ?? byId.get(tx.account_id) ?? { type: "checking", on_budget: true })`, where `byId` comes from `useAccounts(budgetId)` (only when `plan`).
  - **ACCOUNT cell**: `<td title={name}>{tx.account_name}</td>`.
  - **aria-label**: `${account?.name ?? "All Accounts"} transactions`.
  - The sort state type becomes `PlanSortColumn`.
- **`register/register.css`**: add `.register-table .col-account { width: 10%; }`.
- **Verify**: in the browser, both pages render, and `e2e/register.spec.ts` (account mode) still passes.

## T10: e2e

- **`e2e/register.spec.ts`**: change only the `balance()` helper, to `page.locator(\`[data-balance="${key}"] .acct-amount\`)` with `key` cleared/uncleared/working. Keep `getByText("Working Balance")`.
- **`e2e/accounts.spec.ts`**: `.account-balances` becomes `.acct-balances` (2 places). Nothing else.
- **`e2e/account-header.spec.ts`** (new): design cases 1, 2, 3, 4, 5 and 7 (browser part).
  - Use `getByRole("button", { name: "Toggle Starred", exact: true })`, and the same `exact: true` for "Edit Account" and "Reconcile".
  - Tooltips: `hover()`, then `expect(page.getByRole("tooltip")).toHaveText(TEXT, { timeout: 5000 })`.
  - Colours: `toHaveCSS("color", "rgb(119, 186, 33)")`.
  - Starring: assert the sidebar link appears under a STARRED heading, using the sidebar-groups spec's locators.
  - Closed: `page.route("**/api/v1/budgets/*/accounts/<id>", …)` fetches the real response, sets `closed: true` and `group: "closed"`, and fulfils.
- **`e2e/all-accounts.spec.ts`** (new): design cases 6, 9, 10 and 11. Name the data `ZZ-TEST <random>` and use a fresh plan per test.
- Run `pnpm e2e e2e/account-header.spec.ts e2e/all-accounts.spec.ts e2e/register.spec.ts e2e/accounts.spec.ts e2e/sidebar-groups.spec.ts`. Leave the full suite to final_gate.

## T11: docs and report

- One line in `docs/README.md` (already added by the Architect).
- **Report**, per ticket:
  - the routes and tools as built;
  - what is drawn without an action, with its ticket (EXF-486, EXF-533, EXF-530, credit area);
  - for EXF-570: the migration file name, NOT NULL DEFAULT '' (and why), every writer changed, and the `category-reassign.ts` status;
  - the shell rules left unused (the design's list);
  - the custom properties and icons added;
  - any visible difference that could not be closed;
  - confirmation that no Lead note 10 file changed: `git diff --stat origin/main -- apps/web/src/shell packages/core scripts apps/web/src/plan packages/schema/src/budgets.ts packages/schema/src/categories.ts` is empty.
