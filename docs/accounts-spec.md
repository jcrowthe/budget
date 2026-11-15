# Accounts spec (EXF-481)

Implements [accounts-design.md](accounts-design.md). Read `docs/conventions.md` first. Do tasks in order;
run `pnpm check` at the end of each Worker task and at the end. No migration. Do not edit any file in the
design's "out of bounds" list (Lead note 10), `apps/worker/test/{openapi,mcp,existing-surface,months,
budgets,targets}.test.ts`, `e2e/mcp.spec.ts`, `e2e/months.spec.ts`, `router.tsx` or `api/client.ts`.

## T1. Core type rules — `packages/core/src/account-types.ts`

Keep `ACCOUNT_TYPES`, `AccountType`, `CREDIT_ACCOUNT_TYPES`, `CLEARED_STATUSES` as they are. Add:

```ts
export type AccountGroup = "cash" | "credit" | "loan" | "tracking";
export const STARTING_BALANCE_PAYEE = "Starting Balance";
export const LOAN_ACCOUNT_TYPES: readonly AccountType[]; // mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt
export function accountGroup(type: AccountType): AccountGroup;   // checking|savings|cash→cash; creditCard|lineOfCredit→credit; loans→loan; otherAsset|otherLiability→tracking
export function isLoanType(type: AccountType): boolean;
export function isOnBudget(type: AccountType): boolean;          // cash, credit → true; tracking, loan → false (EXF-482/547 revisit loans)
export function positiveMeansOwed(type: AccountType): boolean;   // credit, loan, otherLiability
export function startingBalanceAmount(type: AccountType, entered: number): number; // owed ? (entered === 0 ? 0 : -entered) : entered
export function startingBalanceFeedsReadyToAssign(type: AccountType): boolean;     // accountGroup === "cash"
```

Test `packages/core/test/account-types.test.ts`: every type's group (table of 13); `isOnBudget` for the 7
ticket types; `startingBalanceAmount`: checking 250000→250000, checking −20000→−20000, otherAsset
5000000→5000000, creditCard 150000→−150000, lineOfCredit −5000→5000, otherLiability 700000→−700000,
creditCard 0 → `Object.is(result, 0)`; `startingBalanceFeedsReadyToAssign` true only for the cash group.

## T2. Schemas — `packages/schema`

`src/transactions.ts`: `export` the existing `isCalendarDate` (no other change).

`src/accounts.ts` (import `Milliunits`, `IsoDate`, `dataEnvelope`, `Transaction`, `isCalendarDate`):

- `Account`: add `cleared_balance: Milliunits`, `uncleared_balance: Milliunits`, `balance: Milliunits`.
- `AccountCreate` (service input of the minimal create): `on_budget: z.boolean().optional()`; rest unchanged.
- `AccountCreateRequest` `.openapi("AccountCreateRequest")`:
  `name: z.string().trim().min(1, "Name is required").max(100)`, `type: AccountType`, `balance: Milliunits`,
  `date: IsoDate.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199").refine(isCalendarDate,
  "date must be a real calendar date").optional()`. Field-level checks only (no object refine) so `.shape`
  works for MCP.
- `AccountResponse = dataEnvelope(z.object({ account: Account })).openapi("AccountResponse")`,
  `AccountListResponse = dataEnvelope(z.object({ accounts: z.array(Account) }))`,
  `AccountCreateResponse = dataEnvelope(z.object({ account: Account, starting_balance: Transaction }))`.
- Export the types (`AccountCreateRequest` as `z.input`).

`src/amount-input.ts`:

```ts
/** Form text → milliunits, or null when it is not a plain amount. */
export function parseAmountInput(text: string): number | null;
```

Trim; accept `^(-)?(\$)?(-)?` (at most one `-`), then either `\d+` or `\d{1,3}(,\d{3})+`, or an empty
integer part when a fraction follows, then optional `\.\d{1,2}`; at least one digit; result must be a safe
integer; `-0` → `0`. Build milliunits with integer arithmetic (no float multiply).

Tests `test/amount-input.test.ts`: `250`→250000, `1234.56`→1234560, `-20`→−20000, `0`→0, `-0`→0,
`1,234.56`→1234560, `$1,234`→1234000, `-$20`→−20000, `$-20`→−20000, ` 12.5 `→12500, `.5`→500;
null for `abc`, `10+5`, `1.234`, `12,34`, `1,2345`, `--5`, `$`, `-`, ``, `1e3`, `5.`, `$$5`, `5-`,
`99999999999999999`. `test/accounts.test.ts`: `AccountCreateRequest` trims the name, refuses `"   "`,
`"mortgagee"` type, `1.5` balance, `2026-02-30`, `1899-12-31`; accepts no date.

## T3. Repositories

`apps/worker/src/repositories/accounts.ts` (keep every existing export unchanged). Add:

```ts
export async function list(db, budgetId: string, opts: { includeClosed: boolean }): Promise<AccountRow[]>; // non-deleted, order sort_order, id
export async function nameTaken(db, budgetId: string, name: string): Promise<boolean>; // lower(name)=lower(?) among non-deleted, closed included
export function newAccountGuard(db, budgetId: string, sort: number, name: string); // SELECT 1 … WHERE <sortIsNext condition> AND NOT EXISTS (same-name non-deleted account)
export function insertIfStmt(db, row: AccountRow, guard: SQLWrapper); // INSERT … SELECT <row values> WHERE EXISTS guard (same column order as insertIfSortStmt)
export function existsStmt(db, id: string); // SELECT 1 FROM accounts WHERE id = ?
```

`apps/worker/src/repositories/transactions.ts`. Add:

```ts
export function insertIfStmt(db, row: TransactionRow, guard: SQLWrapper); // INSERT … SELECT … WHERE EXISTS guard; columns in table order
export async function balancesByAccount(db, budgetId: string, accountId?: string):
  Promise<Map<string, { cleared: number; uncleared: number }>>; // non-deleted tx; cleared = cleared+reconciled
```

And change `activityByMonth`: add to the `where` the exclusion
`NOT (accounts.type IN (<UNCOUNTED>) AND transactions.payee_name = STARTING_BALANCE_PAYEE AND
transactions.category_id IS NULL AND transactions.inflow_to_ready_to_assign = 0)`, where `<UNCOUNTED>` =
`ACCOUNT_TYPES.filter(t => isOnBudget(t) && !startingBalanceFeedsReadyToAssign(t))` computed once at module
load (today `creditCard`, `lineOfCredit`). Comment that EXF-532 replaces it.

## T4. Service — `apps/worker/src/services/accounts.ts`

Errors (exported, in this file; `middleware/errors.ts` does not change):

```ts
export class NameTaken extends Error {}            // message "This account name already exists."
export class UnsupportedAccountType extends Error {} // message = the loan detail in the design's API table
```

```ts
export function accountToApi(row: AccountRow, b = { cleared: 0, uncleared: 0 }): Account; // adds the 3 balances
export async function listAccounts(env, budgetId: string, opts?: { includeClosed?: boolean }): Promise<Account[]>; // NotFound("Plan")
export async function getAccount(env, budgetId: string, accountId: string): Promise<Account>;  // NotFound("Plan"|"Account")
export async function addUnlinkedAccount(env, actor: string, budgetId: string,
  input: AccountCreateRequestInput, opts?: { today?: string }):
  Promise<{ account: Account; starting_balance: Transaction }>;
```

`createAccount` (minimal): only `onBudget: v.on_budget ?? isOnBudget(v.type)`; everything else as is.

`addUnlinkedAccount` steps (design "Create"): `AccountCreateRequest.parse`; `isLoanType` →
`UnsupportedAccountType`; plan `findActive` else `NotFound("Plan")`; `nameTaken` → `NameTaken`; loop up to
`MAX_ATTEMPTS`: account row (`name` trimmed by the schema, `onBudget: isOnBudget`, `sortOrder: maxSort+1`,
`note: null`), tx row (`payeeName: STARTING_BALANCE_PAYEE`, `categoryId: null`, `inflowToReadyToAssign:
startingBalanceFeedsReadyToAssign`, `amount: startingBalanceAmount`, `cleared: "cleared"`, `approved: true`,
`memo: null`, `date: v.date ?? opts.today ?? new Date().toISOString().slice(0, 10)`); account API value with
balances `{cleared: amount, uncleared: 0}`; batch
`[changeLogInsertIf(account, G1), accountsRepo.insertIfStmt(row, G1), txRepo.insertIfStmt(tx, G2),
changeLogInsertIf(transaction, G2)]` with G1 = `newAccountGuard`, G2 = `existsStmt(row.id)`; entries
`action "create"`, `entityType "account"` / `"transaction"`, `after` = the returned account /
`transactionToApi(tx)` (import from `services/transactions`, unchanged). If result[1] changed 0 rows:
`nameTaken` → `NameTaken`, else retry; after the loop `Conflict("Account order")`.

## T5. Route — `apps/worker/src/routes/accounts.ts`

Copy the months route's style (`defaultHook` → 422 `unprocessable_entity`). Params: `budget_id`,
`account_id` as `z.string().min(1)`. Query `include_closed: z.enum(["true","false"]).optional()`
(absent = true). Declare responses 200/201, 403, 404, 409 (POST), 422 with `ErrorBody`. POST handler:

```ts
try { return c.json({ data: await addUnlinkedAccount(c.env, c.get("identity").actor, budget_id, c.req.valid("json")) }, 201); }
catch (e) {
  if (e instanceof NameTaken) return apiError(c, 409, "name_taken", e.message);
  if (e instanceof UnsupportedAccountType) return apiError(c, 422, "unprocessable_entity", e.message);
  throw e;
}
```

Tags `["Accounts"]`. Nothing to register (glob).

## T6. MCP — `apps/worker/src/mcp/tools/accounts.ts`

```ts
list_accounts:  z.object({ budget_id: z.string().min(1), include_closed: z.boolean().optional() }) → { accounts }
create_account: z.object({ budget_id: z.string().min(1), ...AccountCreateRequest.shape })        → { account, starting_balance }
```

Descriptions mention milliunits, the sign rule ("enter the balance as shown; debts are stored negative"),
that loans are not supported yet, and that `date` defaults to today (UTC). Errors propagate (the SDK returns
`isError` with the message).

## T7. Worker tests — `apps/worker/test/accounts.test.ts`

Use `json()` from `helpers.ts`, `apiPaths()`/`listedToolNames()`/`mcpRpc()` from `surface.ts`, `env.DB`
for D1 reads, plan names `ZZ-TEST <uuid>`. Never assume a new plan has no categories: compare Ready to
Assign before/after via `GET /budgets/{id}/months/{month}`. Cover design acceptance 4–9 (API side), 11–14:

- surface: `expect(await apiPaths()).toEqual(expect.arrayContaining(["/api/v1/budgets/{budget_id}/accounts",
  "/api/v1/budgets/{budget_id}/accounts/{account_id}"]))`; tools contain `list_accounts`, `create_account`.
- checking 250 (`date` given): 201; account fields, balances 250000/0/250000, `on_budget` true; one D1
  transaction row with the design's values; RTA of that month +250000.
- credit 150000 → amount −150000, flag false, category null, balance −150000; RTA unchanged in that month
  and the next; month `uncategorized` unchanged. Line of credit same sign.
- otherAsset 5000000 (on_budget false, RTA unchanged), otherLiability 700000 → −700000; cash 0 → row amount 0.
- sort: three creates → `GET` list order equals creation order; `include_closed=false` hides an account set
  `closed = 1` in D1; default includes it; `GET …/{id}` 200, unknown id and `not-a-uuid` 404, unknown plan 404.
- duplicate: case/space variants → 409 `name_taken`; a closed account's name → 409; counts unchanged.
- 422: `mortgage` (detail mentions loans), unknown type, `"  "` name, `balance: 1.5`, `date: "2026-02-30"`.
- MCP `create_account` ≡ REST (same fields except ids/names/timestamps); `change_log` rows
  (`entity_type` account + transaction) with `user:` and `mcp:` actors.
- race: `Promise.allSettled` of 5 `addUnlinkedAccount` with one name → 1 fulfilled, 4 `NameTaken`; D1 counts:
  1 account, 1 transaction, 2 change_log rows for the plan's accounts/transactions. Guard: run
  `db.batch([accountsRepo.insertIfStmt(row, newAccountGuard(...taken name))])` → `meta.changes === 0`.
- minimal `createAccount` without `on_budget` derives it; with it, unchanged.
- `Idempotency-Key` replay of POST returns the same account and creates one row.

## T8. Web API — `apps/web/src/api/accounts.ts`

```ts
listAccounts(budgetId, { includeClosed }): Promise<Account[]>
getAccount(budgetId, accountId): Promise<Account>
createAccount(budgetId, input: AccountCreateRequest): Promise<{ account; starting_balance }> // idempotencyKey: randomUUID
useAccounts(budgetId)              // key ["accounts", budgetId], includeClosed false, enabled when budgetId
useAccount(budgetId, accountId)    // key ["accounts", budgetId, accountId], retry: false
useCreateAccount(budgetId)         // onSuccess: qc.invalidateQueries({ predicate: q => q.queryKey.includes(budgetId) })
localToday(now = new Date()): string // browser-local YYYY-MM-DD
```

## T9. Labels — `apps/web/src/shell/accountTypeLabels.ts`

Pure data: `ACCOUNT_TYPE_GROUPS` (4 entries: heading, description, `types` in the ticket order, exact
strings from the design/ticket, straight apostrophes), `ACCOUNT_TYPE_LABEL: Record<AccountType,string>`
(`otherAsset` = "Asset (e.g. Investment)", `otherLiability` = "Liability", loans "Mortgage", "Auto Loan",
"Student Loan", "Personal Loan", "Medical Debt", "Other Debt"), `ACCOUNT_BADGE` for the 7 types (ticket
table; tracking "Tracking Account: Asset" / "Tracking Account: Liability"), `SIDEBAR_GROUPS` =
`[["cash","CASH"],["credit","CREDIT"],["tracking","TRACKING"]]`.

## T10. Dialog — `AddAccountDialog.tsx` + `AccountTypePicker.tsx` (+ icons, CSS)

State: `screen: "start"|"form"|"types"|"success"`, `name`, `type: AccountType|null`, `balance` (text),
`errors: { name?: string; balance?: string; other?: string }`, `created?: Account`. Props stay
`{ onClose }`; budget id from `useCurrentPlan()`.

- Shell: `<div className="dialog-backdrop top"><div className="dialog modal account-modal" role="dialog"
  aria-label={title}>` with header (Back `icon-button back` aria-label "Back" on form/types; `h2` title; Close
  aria-label "Close"), `.account-modal-body` (flex 1, overflow-y auto, padding 16px 16px 0) and, on form and
  success, `.account-modal-footer` (border-top `--borderSubtle`, padding 16px). Modal height
  `min(700px, calc(100vh - 96px))`, flex column. Only one button is named "Close".
- start: title "Add Accounts"; body ends with the large secondary button "Add an Unlinked Account"
  (→ form). No search field.
- form: title "Add Unlinked Account"; Back → start (values kept). No `<form>` element. Intro `<p>` with
  `<strong>Let's go!</strong>` and the exact rest. Labels with `htmlFor`; nickname `autoFocus`
  `autoCapitalize="words"`; select button (`type="button"`) showing
  `ACCOUNT_TYPE_LABEL[type]` or "Select account type..." + `CaretRightIcon`; balance `inputMode="decimal"`.
  Errors render as `<p className="field-error">` directly under the field. Typing in a field clears its error.
  Next (`button.primary.large`, full width) disabled while `!name.trim() || !type || balance === "" ||
  mutation.isPending`. On click: `parseAmountInput(balance)` null → `errors.balance = "Enter an amount"`;
  else mutate `{ name, type, balance: milli, date: localToday() }`; `ApiError` with `errorName === "name_taken"`
  → `errors.name = "This account name already exists."`; other → `errors.other = error.detail`.
- types: title "Select Account Type"; Back → form. `AccountTypePicker({ value, onPick })` renders the groups
  (`h3`, `p`, tiles `button.type-tile`); loan tiles `disabled` (`isLoanType`), muted by opacity 0.5, cursor
  default. Picking → set type, screen form.
- success: title "Add Unlinked Account", no Back; `CheckCircleIcon` (green, `--statusPositive`), `h3`
  "Success!", the Budget line; footer: "Add Another" (secondary large) → reset fields and errors, screen start;
  "Done" (primary large) → `onClose()` then `navigate(accountPath(budgetId, created.id))`. Close on this
  screen does the same as Done; on other screens it only closes.
- `icons.tsx`: add `ChevronLeftIcon`, `CaretRightIcon` (small filled triangle), `CheckCircleIcon`; Budget's own
  simple SVG paths, `currentColor`.
- CSS in `global.css` with tokens only (new tokens in `tokens.css`: `--labelNegative: #ee5867`,
  `--inputBorderSubtle: #56596c`): inputs and select 48px, radius `--radius-lg`, bg `--inputBackground`, border
  `--inputBorderSubtle`, focus border `--actionPrimary`, 14px (select 400 weight); labels 14px/600; large
  buttons 48px 16px/500 radius 8px; Next disabled bg `--menuHover` text `--labelTertiary` (no opacity), enabled
  `--buttonPrimaryBackground`, hover `--actionPrimary`; tiles per the design's Source section. Back sits at
  the left of the header like Close at the right (70×70).

Verify: `pnpm check`; the shell and plan-urls specs still pass (`pnpm e2e e2e/shell.spec.ts
e2e/plan-urls.spec.ts e2e/shell-compare.spec.ts`).

## T11. Sidebar — `SidebarAccounts.tsx`, `Sidebar.tsx`

`SidebarAccounts({ budgetId })`: `useAccounts`; group by `accountGroup` in `SIDEBAR_GROUPS` order (skip
`loan`), keep API order inside a group; `<section className="nav-accounts" aria-label="Accounts">`, per
non-empty group `<div className="nav-account-group"><h6>{label}</h6>` then rows `<NavLink
className="nav-account-row" to={accountPath(budgetId, a.id)} title={a.name}>` containing
`<span className="name">{a.name}</span>` and `<span className={a.balance < 0 ? "value negative" : "value"}>
{formatMoney(a.balance)}</span>`. In `Sidebar.tsx`
render it between `.nav` and the card when `plan`; show the "No Accounts" card only when the account list has
loaded with zero rows or no plan is resolved (keeps today's empty-plan layout). CSS per the design's Source
section (label 12px/500, letter-spacing 1.36px; row 32px; name 14px/500 ellipsis; value 12px/500
tabular-nums; `.negative` color `--labelNegative`, pill padding .125rem .375rem, radius 1000px; active row
`--sidebarActive`, hover `--sidebarHover`).

## T12. Account page — `apps/web/src/pages/account.tsx`

`useAccount(budgetId, accountId)`. Error with status 404 (or any `ApiError` < 500) → `<Navigate replace
to={accountsPath(budgetId)} />`. Loading → `<PageHeader variant="accounts" title="" />` placeholder only.
Loaded → `usePageTitle(account.name)` (call the hook unconditionally with `account?.name ?? "Account"`),
`<PageHeader variant="accounts" title={account.name}>` with `<p className="account-badge">{ACCOUNT_BADGE
[type] ?? ACCOUNT_TYPE_LABEL[type]}</p>`, then `<dl className="account-balances">` with "Cleared Balance",
"Uncleared Balance", "Working Balance" and `formatMoney` values. No register, no buttons.

## T13. E2E — `e2e/accounts.spec.ts`

Each test makes its own plan via `request.post("/api/v1/budgets", { headers: await authHeaders(), data:
{ name: testName("accounts") } })` and opens `/{id}/budget`; scope to `getByRole("navigation", { name:
"Sidebar" })`; read RTA through `GET /api/v1/budgets/{id}/months/<local month>` with `authHeaders()`.
Cases: design acceptance 1, 2, 3, 4 (incl. RTA +250000 and sidebar order with a second cash account made
first), 5, 6, 7, 8 (UI to account page $0.00), 9, 10, 13 (form part), 15 (open+close Add Account keeps URL
and `history.length`). Names come from `testName()`; no real data.

## T14. Docs

`docs/README.md` already has the design line (Architect). Do not edit other docs.

## Done when

`pnpm check` passes; `pnpm e2e e2e/accounts.spec.ts e2e/shell.spec.ts e2e/plan-urls.spec.ts
e2e/shell-compare.spec.ts` passes; `git diff --name-only origin/main` lists only Manifest files.
