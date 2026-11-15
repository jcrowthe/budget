# Account register spec (EXF-513)

Implements [account-register-design.md](account-register-design.md). Tasks in order; each ends with how to verify.
**Do not change** `activityByMonth`, `balancesByAccount`, `insertStmt`, `insertIfStmt`, `transactionToApi(row)`,
`createTransaction`, the existing `Transaction`/`TransactionCreate` schemas, or any file of Lead notes 4 and 6
(`apps/web/src/shell/**`, `api/accounts.ts`, accounts schema/service/route/tool/test, plan and months files,
`packages/core/src/**`, `paths.always_overlap`). No migration.

## T1. Schemas: `packages/schema/src/transactions.ts` (append only)

```ts
export const PlainClearedStatus = z.enum(["uncleared", "cleared"]); // requests never set "reconciled"
export const TransactionDetail = Transaction.extend({
  category_name: z.string().nullable(),
  category_group_name: z.string().nullable(),
  updated_at: z.string(),
}).openapi("TransactionDetail");
export const AccountBalances = z.object({ cleared: Milliunits, uncleared: Milliunits, working: Milliunits })
  .openapi("AccountBalances");
export const TransactionCreateRequest = z.object({
  account_id: z.string().min(1),
  date: <same IsoDate + year regex + isCalendarDate refine as TransactionCreate>,
  amount: Milliunits,
  payee_name: z.string().max(200).nullable().optional(),
  category_id: z.string().min(1).nullable().optional(),
  inflow_to_ready_to_assign: z.boolean().optional(),
  memo: z.string().max(500).nullable().optional(),
  cleared: z.string().optional(),   // validated in the service so "reconciled" gets its own 422 detail
  approved: z.boolean().optional(),
}).strict().openapi("TransactionCreateRequest");
export const TransactionUpdateRequest = <same keys, every one optional>
  .strict().refine(o => Object.keys(o).length > 0, "Nothing to update").openapi("TransactionUpdateRequest");
export const TransactionResponse = dataEnvelope(z.object({ transaction: TransactionDetail }));
export const TransactionListResponse = dataEnvelope(z.object({
  transactions: z.array(TransactionDetail), balances: AccountBalances }));
export type TransactionDetail / AccountBalances / TransactionCreateRequest (z.input) / TransactionUpdateRequest
```

Ids are `z.string().min(1)` (not `z.uuid()`) so an unknown id is a 404, not a 422 (as the accounts route does).
`cleared` accepts the string and the service answers: `"reconciled"` → 422 "Reconciling is not available here";
any other value outside `PlainClearedStatus` → 422 from `PlainClearedStatus.parse` message. Trim `payee_name`;
`""` after trim → `null`. `memo` `""` → `null`.

Verify: `pnpm check` typechecks; T2 tests.

## T2. Pure register rules: `packages/schema/src/register.ts` (new) + `packages/schema/test/register.test.ts`

```ts
export const REGISTER_SORT_COLUMNS = ["date","payee","category","memo","outflow","inflow"] as const;
export type RegisterSortColumn = (typeof REGISTER_SORT_COLUMNS)[number];
export type SortDir = "asc" | "desc";
type SortableTx = Pick<TransactionDetail, "id"|"date"|"amount"|"payee_name"|"memo"|"category_id"|
  "category_name"|"category_group_name"|"inflow_to_ready_to_assign"|"created_at">;
export function categoryText(tx): string   // "Group: Name" | "Inflow: Ready to Assign" | ""
export type CategoryCell =
  | { kind: "text"; text: string } | { kind: "notNeeded" } | { kind: "needsCategory" };
export function categoryCell(tx, account: { type: string; on_budget: boolean }): CategoryCell
export function sortTransactions<T extends SortableTx>(rows: readonly T[], column: RegisterSortColumn,
  dir: SortDir): T[]   // returns a new array
```

- `categoryCell`: category → text `"<group>: <name>"`; flag → text "Inflow: Ready to Assign"; off-plan account →
  `notNeeded`; credit Starting Balance (type `creditCard`/`lineOfCredit`, payee exactly "Starting Balance", no
  category, flag off) → `notNeeded`; else `needsCategory`. `@budget/schema` does not depend on core (and
  `package.json` is always_overlap): export `REGISTER_CREDIT_TYPES = ["creditCard","lineOfCredit"]` and
  `REGISTER_STARTING_PAYEE = "Starting Balance"` here; T7 asserts they equal core's `CREDIT_ACCOUNT_TYPES` and
  `STARTING_BALANCE_PAYEE` (the `ClearedStatus` pattern).
- Keys: date → `date`; payee → `payee_name ?? ""`; category → `categoryText`; memo → `memo ?? ""`;
  outflow → `amount < 0 ? -amount : 0`; inflow → `amount > 0 ? amount : 0`. Strings compare with one module-level
  `new Intl.Collator("en", { sensitivity: "base", numeric: true })`.
- Order: primary key in `dir`; ties, **never reversed by `dir`**: date desc (skip when column is date), then
  amount asc, then `created_at` asc, then `id` asc.
- Tests: the five-row example of design case 5 for every column × dir (expected orders written out); blanks
  last in desc and first in asc for memo; same-date ties identical in date asc and desc; `categoryCell` for each
  of the five kinds; input array not mutated.

Verify: `pnpm vitest run packages/schema/test/register.test.ts`.

## T3. Repository: `apps/worker/src/repositories/transactions.ts` (add functions only)

```ts
export type TransactionDetailRow = TransactionRow & { categoryName: string|null; groupName: string|null };
export async function findDetail(db, budgetId, id): Promise<TransactionDetailRow|undefined>  // not deleted
export async function listDetailForAccount(db, budgetId, accountId, sinceDate?: string)
  : Promise<TransactionDetailRow[]>          // not deleted, date >= sinceDate; unordered
export async function lastChangedAt(db, budgetId, id?: string): Promise<Map<string,string>>
export function holds(db, before: TransactionRow): SQLWrapper   // `select 1 from transactions where ...`
export function updateIfHoldsStmt(db, before: TransactionRow, after: TransactionRow)
export function softDeleteIfHoldsStmt(db, before: TransactionRow, deletedAt: string)
```

- Detail reads: `leftJoin(categories, eq(categories.id, transactions.categoryId))` and
  `leftJoin(categoryGroups, eq(categoryGroups.id, categories.groupId))`, no `deleted_at` filter on those two.
- `lastChangedAt`: `select entity_id, max(created_at) from change_log where budget_id = ? and entity_type =
  'transaction' [and entity_id = ?] group by entity_id` (Drizzle on `db/schema/change-log`). No `IN` list (D1's
  100-parameter limit).
- `holds`: `id = before.id and deleted_at is null` and every mutable column equal to `before` with null-safe
  `IS` for nullable ones (`account_id, date, payee_name, category_id, inflow_to_ready_to_assign, memo, amount,
  cleared, approved`). `updateIfHoldsStmt`/`softDeleteIfHoldsStmt`: `update transactions set ... where <same
  condition>` (build the condition once, use it in both).

Verify: T5 tests (race and guard cases).

## T4. Service: `apps/worker/src/services/transactions.ts` (add)

```ts
export class TransactionRefused extends Error {
  constructor(public status: 409 | 422, public code: string, detail: string) }
export function transactionDetailToApi(row: TransactionDetailRow, updatedAt: string): TransactionDetail
export async function listAccountTransactions(env, budgetId, accountId,
  opts?: { sinceDate?: string; sort?: RegisterSortColumn; dir?: SortDir })
  : Promise<{ transactions: TransactionDetail[]; balances: AccountBalances }>
export async function getAccountBalances(env, budgetId, accountId): Promise<AccountBalances>
export async function getTransaction(env, budgetId, id): Promise<TransactionDetail>
export async function addTransaction(env, actor, budgetId, input: TransactionCreateRequest): Promise<TransactionDetail>
export async function updateTransaction(env, actor, budgetId, id, patch: TransactionUpdateRequest): Promise<TransactionDetail>
export async function deleteTransaction(env, actor, budgetId, id): Promise<TransactionDetail>
```

- Every function: plan active (`budgetsRepo.findActive`) else `NotFound("Plan")`; account via
  `accountsRepo.findActive(db, budgetId, id)` else `NotFound("Account")`; transaction via `findDetail` else
  `NotFound("Transaction")` (a row of another plan is not found). Parse bodies with the T1 schemas (a `ZodError`
  from MCP input becomes the MCP error; REST validates first through the route).
- `balances`: `balancesByAccount(db, budgetId, accountId).get(accountId) ?? {cleared:0, uncleared:0}`, plus
  `working = cleared + uncleared`.
- `validate(merged, account, before?)`, in this order, on the **merged** row (before + patch; for create the
  defaults `inflow false, cleared "uncleared", approved true`):
  1. `cleared === "reconciled"` in the request → 422 `unprocessable_entity` "Reconciling is not available here".
  2. both `category_id` and flag → 422 "A transaction cannot have both a category and the Ready to Assign
     inflow flag".
  3. off-plan account (`!account.onBudget`) with a category or the flag → 422 "Tracking accounts do not take a
     category".
  4. `category_id` set and `categoriesRepo.findActive(db, budgetId, category_id)` empty → 422 "Category not found
     in this plan".
  5. credit account (`CREDIT_ACCOUNT_TYPES.includes(account.type)`), merged payee "Starting Balance", and not
     (`before` is the credit Starting Balance of that same account) → 422 "This payee name is reserved".
- Update and delete, before `validate`: `before.cleared === "reconciled"` → 409 `transaction_reconciled`
  "This transaction is reconciled". Update only: `before` is a credit Starting Balance (its account is credit,
  payee "Starting Balance", no category, flag off) and the patch carries `payee_name`, `category_id`,
  `inflow_to_ready_to_assign` or `account_id` with a value different from `before` → 409
  `starting_balance_locked` "A credit account's Starting Balance keeps its payee, category and account". A PATCH
  `account_id` loads that account (404 if not active in this plan) and validates against it.
- Writes: as the design's Services section. History entity type `transaction`, entity id the row id,
  `before`/`after` = `transactionDetailToApi` without `updated_at` (use the category names read for validation).
  Create: `db.batch([txRepo.insertStmt(db,row), changeLogInsert(...)])`. Update/delete: loop up to 5 times:
  re-read `before`, re-check, `const [, w] = await db.batch([changeLogInsertIf(db, log, holds(db, before)),
  updateIfHoldsStmt(...)])`; `w.meta.changes > 0` → done; after 5 → `Conflict("Transaction")`.
- Results: create/update re-read with `getTransaction` (fresh names and `updated_at`); delete returns the
  `before` detail.

Verify: T5.

## T5. Routes: `apps/worker/src/routes/transactions.ts` (new)

Copy the accounts route's skeleton (`json`, `budgetParam`, `defaultHook` → 422 `unprocessable_entity`, tags
`["Transactions"]`). Five `createRoute`s with the design's paths; params `budget_id`, `account_id`,
`transaction_id` as `z.string().min(1)`; list query `since_date` (IsoDate, optional), `sort`
(`z.enum(REGISTER_SORT_COLUMNS)`, optional), `dir` (`z.enum(["asc","desc"])`, optional). Responses: 200/201 with
the T1 envelopes, `403`, `404`, `409`, `422` `ErrorBody`. Each write handler passes `c.get("identity").actor`
and wraps the call:

```ts
catch (e) { if (e instanceof TransactionRefused) return apiError(c, e.status, e.code, e.message) as never; throw e; }
```

(`code` is `unprocessable_entity` for every 422.) POST answers 201.

## T6. MCP: `apps/worker/src/mcp/tools/transactions.ts` (new)

`export const tools: McpToolDef[]` with `list_transactions`, `get_account_balances`, `create_transaction`,
`update_transaction`, `delete_transaction`; input schemas as in the design (`zod` objects; spread
`TransactionCreateRequest.shape` / the update object's shape with `budget_id` and `transaction_id` added).
Descriptions state milliunits, negative = outflow, `cleared` values, and the 409/422 rules in one sentence each.
Return exactly the REST `data` objects (`get_account_balances` returns the balances object).

## T7. Worker tests: `apps/worker/test/transactions.test.ts` (new)

Use `json()` from `helpers.ts`, `mcpRpc` from `surface.ts`, `setAssigned` and the D1 `env`. Plans via
`POST /api/v1/budgets` named `ZZ-TEST <random>`; accounts via `POST …/accounts`; Groceries = the category whose
name ends with "Groceries" in `GET …/months/<this month>`. Cases (design numbers):

- surface (12): `apiPaths()` contains `/api/v1/budgets/{budget_id}/accounts/{account_id}/transactions`,
  `/api/v1/budgets/{budget_id}/transactions`, `/api/v1/budgets/{budget_id}/transactions/{transaction_id}`;
  `listedToolNames()` contains the five tools.
- Starting Balance (2): list has one row, `payee_name` "Starting Balance", `inflow_to_ready_to_assign` true,
  `category_name` null, `cleared` "cleared"; balances `{500000, 0, 500000}`.
- worked example (3): every step's three balances from the list **and** from `GET …/accounts/{id}`; month:
  Groceries `activity` 10000, `available` 210000, `ready_to_assign` 300000.
- sort (5): `?sort=payee&dir=desc` etc. equal `sortTransactions` on the default list; `since_date` filters rows
  but not `balances`.
- REST = MCP (7): `list_transactions` structuredContent deep-equals REST `data`; `get_account_balances` equals
  `balances`; `updated_at` advances after a PATCH.
- history (8): `change_log` rows (query D1) for create/update/delete with actors `user:tester@localhost` and
  `mcp:…`; delete → GET 404, list without it, balances drop it; `Idempotency-Key` POST twice → one row, same
  body.
- refusals (9): every bullet of design case 9 with status, `error.name`, and "no new transaction and no new
  change_log row". Reconciled rows come from `createTransaction(env, "test", {..., cleared: "reconciled"})`.
- atomicity: a batch built from `changeLogInsertIf(holds(stale before))` + `updateIfHoldsStmt(stale before)`
  after a concurrent PATCH changes 0 rows and logs nothing; five concurrent PATCHes of `amount` all succeed or
  `Conflict`, and the final row equals the last logged `after`.

Also: `REGISTER_CREDIT_TYPES`/`REGISTER_STARTING_PAYEE` equal core's constants.
Verify: `pnpm vitest run --project worker apps/worker/test/transactions.test.ts`, then `pnpm check`.

## T8. Web API: `apps/web/src/api/transactions.ts` (new)

```ts
export const listTransactions = (budgetId, accountId) => apiFetch(`/api/v1/budgets/${budgetId}/accounts/${encodeURIComponent(accountId)}/transactions`, { schema: TransactionListResponse }).then(r => r.data)
export const updateTransaction = (budgetId, id, patch: TransactionUpdateRequest) => apiFetch(..., { method: "PATCH", body: patch, idempotencyKey: crypto.randomUUID(), schema: TransactionResponse })
export const useAccountTransactions = (budgetId: string, accountId: string) => useQuery({ queryKey: ["transactions", budgetId, accountId], queryFn, retry: false })
export function useSetCleared(budgetId: string, accountId: string)  // mutate({ id, cleared })
```

`useSetCleared`: `onMutate` cancels and snapshots the list query, sets that row's `cleared`; `onError` restores;
`onSettled` → `qc.invalidateQueries({ predicate: q => q.queryKey.includes(budgetId) })`.

## T9. Register UI: `apps/web/src/register/**` (new)

- `format.ts`: `registerDate(iso) = \`${m}/${d}/${y}\`` by slicing; `registerMoney(m) = formatMoney(Math.abs(m))`.
- `icons.tsx` (Budget's own SVGs, `currentColor`, `aria-hidden`): `PlusCircleIcon` 16, `FileUpIcon` 16,
  `UndoIcon` 12, `RedoIcon` 12, `CaretDownIcon` 8, `CaretUpIcon` 8, `SearchIcon` 12, `ClearedFilledIcon`,
  `ClearedOutlineIcon`, `LockIcon` (12; header uses `ClearedFilledIcon` at 14), `CheckIcon`, `MinusIcon` (10).
- `Register.tsx`: `export function Register({ account }: { account: Account })` → `<section className="register"
  aria-label="Register">` with `<RegisterToolbar name={account.name} />` and `<RegisterTable account={account} />`.
- `RegisterToolbar.tsx`: `<div className="register-toolbar" role="toolbar" aria-label="Register toolbar">`; left
  group: buttons "Add Transaction" (class `primary`, `title="Add new transaction"`, `data-ticket="EXF-517"`),
  "File Import" (`title="Import transactions from a bank file."`, `EXF-531`), `<hr>`, "Undo" (`EXF-530`), "Redo"
  (`EXF-530`); right group: "View" + caret (`title="Set view options like date range, reconciliation status, and
  more."`, `EXF-529`), `<input type="search" placeholder={\`Search ${name}\`} aria-label="Find the transactions
  you're looking for..." data-ticket="EXF-528">`. All `type="button"`, no `onClick`.
- `RegisterTable.tsx`: state `sort: { column: RegisterSortColumn; dir: SortDir }` (default date/desc, reset via
  `key={account.id}` on the component from `Register`), `selected: Set<string>`. `const showCategory =
  account.on_budget`. Rows = `sortTransactions(data.transactions, sort.column, sort.dir)` (memoised).
  - `<colgroup>`: checkbox 36px, date 96px, payee 16% (tracking: none, so auto), category auto, memo 16%
    (tracking: auto), outflow 10%, inflow 10%, cleared 36px.
  - `<thead>`: checkbox `<th>` with a `<button role="checkbox" aria-checked={all|"mixed"|false}
    aria-label="Select all transactions">`; six sortable `<th aria-sort=...>` (active only) each with a `<button
    className="sort-button">` (label text uppercase in source: "DATE" etc.) and, when active, the caret icon
    (`.sort-icon`); cleared `<th>` with `ClearedFilledIcon` and `title` (ticket text), aria-label "Cleared".
    Header click: inactive → `{column, dir:"desc"}`; active → flip.
  - `<tbody>`: per row `<tr className={is-checked?}>` with cells: checkbox (`role="checkbox"`, aria-label
    "Select transaction"), date, payee (`title` = text), category (per `categoryCell`: text with `title`;
    `<span className="category-not-needed">Category not needed</span>`; `<span className="needs-category">This
    needs a category</span>`), memo (`title`), outflow, inflow, cleared button (`className="cleared-button
    is-<state>"`, aria-label "This transaction is <state>", `title` = ticket text or "This transaction is
    reconciled", `disabled={reconciled}` styled as `cursor: default`, onClick → `setCleared.mutate({ id, cleared:
    state === "cleared" ? "uncleared" : "cleared" })`).
  - States per the design (`colSpan` = column count).
- `register.css` (imported by `Register.tsx`): at the top `:root { --register-separator: rgba(255,255,255,.1);
  --register-label-action: #a3acff; --register-row-selected: #1b1d48; --register-needs-category: #daac00;
  --register-needs-category-label: #362c05; --register-icon-muted: #727484; }`; rules use only these and
  `tokens.css` variables. Values and sizes from the design's Source section (toolbar 48px, header 32px, rows
  36px, paddings 6.4px, numeric cells right + `font-variant-numeric: tabular-nums`, sticky `thead th { position:
  sticky; top: 0 }` inside `.register-scroll { overflow-y: auto; flex: 1 }`, cleared colours `--statusPositive`
  / `--register-icon-muted`, selected checkbox `--buttonPrimaryBackground`).

## T10. Mount: `apps/web/src/pages/account.tsx`

Import `Register` and render `<Register key={account.id} account={account} />` after the `account-balances`
div; nothing else changes. If the page's wrapper does not let the register fill the remaining height, give
`.register` `flex: 1; min-height: 0` in `register.css` rather than editing shell CSS.

Verify: `pnpm dev`, open an account: toolbar, header, Starting Balance row; `e2e/accounts.spec.ts` unchanged and
green.

## T11. E2E: `e2e/register.spec.ts` (new)

Data through `request` with `authHeaders()` and `testName()`: one plan, a Checking account (500000), an Asset
account (5000000), rows of design case 5 on the Checking account. Cases 1 (labels, header texts, single ▼ via
`aria-sort`), 2, 4 (no "CATEGORY" columnheader on Asset), 5 (row order by payee cell text after each click), 6
(click the cleared button; page balance texts change without `page.reload`; button aria-label flips), 10, 11
(`page.route` the list URL to 500). Run: `pnpm e2e e2e/register.spec.ts` and with `--repeat-each=3`.

## T12. Docs

`docs/README.md`: one line already added by the Architect. Report: routes/tools, error answers, inert controls
with their `data-ticket`, the `--register-*` properties and icons, visible differences (no flag/image columns,
no persisted multi-key sort, native `title` tooltips).
