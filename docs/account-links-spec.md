# Account links spec (EXF-461, Worker side)

Implements [account-links-design.md](account-links-design.md). Behaviour, error codes, the type table and
the acceptance cases are defined there. This file covers the work order, signatures and checks. Rules for
this Build: no file under `apps/web/` changes; nothing in the Lead's note 7 changes (transactions and payees
files: only call what they export); no new dependency; tests never call Plaid and never read a Plaid secret
(use `test/plaid-stub.ts` sentinels). Run `pnpm check` in the foreground.

## Task 1: migration and table

- `apps/worker/migrations/20261116100600_account_links.sql`: the three statements in the design's Data
  section. Then `rm -rf .e2e-state`.
- `apps/worker/src/db/schema/accounts.ts`: append `bankAccountId: text("bank_account_id")` and
  `importStartDate: text("import_start_date")` **after `deletedAt`**. The order matters: Drizzle's
  `insert().select()` lists the columns in definition order. Add the index:
  `uniqueIndex("accounts_bank_account_link").on(t.budgetId, t.bankAccountId).where(sql\`bank_account_id IS NOT NULL AND deleted_at IS NULL\`)`
  (pattern: `db/schema/payees.ts`).
- `repositories/accounts.ts`: in `insertIfSortStmt` and `insertIfStmt`, append
  `, ${r.bankAccountId}, ${r.importStartDate}` after `${r.deletedAt}`.
- `services/accounts.ts` `createAccount`: the row gets `bankAccountId: null, importStartDate: null`.
- Verify: `test/schema-drift.test.ts` and the existing `accounts.test.ts` pass.

## Task 2: schemas (`packages/schema/src/accounts.ts`, `bank-connections.ts`)

- Extract the date rule of `AccountCreateRequest.date` into
  `export const PlanDate = IsoDate.regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199").refine(isCalendarDate, "date must be a real calendar date")`
  and use it for `date` (same behaviour).
- `Account` gains `bank_account_id: z.uuid().nullable()`, `linked: z.boolean()`,
  `import_start_date: IsoDate.nullable()`. Each gets an `.openapi({ description })`.
- New request schemas. Each exports its `.shape` source object (`…Fields`) so the MCP tool can spread it,
  the way `accountUpdateShape` is reused:
  - `AccountLinkOverride = z.object({ name: z.string().trim().min(1, "Name is required").max(100).optional(), type: AccountType.optional() }).strict()`
  - `accountsFromBankFields = { bank_account_ids: z.array(z.string().min(1)).min(1).max(50), overrides: z.record(z.string(), AccountLinkOverride).optional(), today: PlanDate.optional() }`
  - `AccountsFromBankRequest = z.object(accountsFromBankFields).strict()` with refinements "bank_account_ids must not repeat" and "every override key must be one of bank_account_ids", `.openapi("AccountsFromBankRequest")`
  - `accountLinkFields = { bank_account_id: z.string().min(1), today: PlanDate.optional() }`; `AccountLinkRequest = z.object(accountLinkFields).strict().openapi("AccountLinkRequest")`
  - `AccountsFromBankResponse = dataEnvelope(z.object({ created: z.array(z.object({ account: Account, starting_balance: Transaction })) })).openapi("AccountsFromBankResponse")`
  - Types: `AccountsFromBankRequest = z.input<…>`, `AccountLinkRequest = z.input<…>`.
- `bank-connections.ts`: `linked_account_id` description becomes "The account of the plan named by
  budget_id that is linked to this bank account; null when none".
- Verify: `pnpm --filter @budget/schema typecheck` (or `pnpm check`). `apps/web` still typechecks, because
  it only reads `Account`.

## Task 3: Plaid sign (`apps/worker/src/plaid/amounts.ts`)

```ts
/** A bank account's balance (milliunits, Plaid's sign) as the plan stores it: credit and loan balances are owed, so negative. null → 0; never -0. */
export function bankBalanceToPlan(plaidType: string, milli: number | null): number
```

Rule: if `milli` is null or 0, return 0. If `plaidType.toLowerCase()` is `credit` or `loan`, return
`-milli`. Otherwise return `milli`.

## Task 4: repositories

`repositories/accounts.ts` (import `bankAccounts` from `db/schema/bank-accounts` and `transactions` from
`db/schema/transactions` for subqueries; this edits no transactions file):

```ts
export async function linksForPlan(db: Db, budgetId: string, bankAccountIds: string[]): Promise<Map<string, string>> // bankAccountId → accountId, active accounts only; [] → empty map without a query
export async function findByBankAccount(db: Db, budgetId: string, bankAccountId: string): Promise<AccountRow | undefined> // active
export async function latestReconciledDate(db: Db, accountId: string): Promise<string | null> // max(date) where account_id, cleared='reconciled', deleted_at is null
export function linkHolds(db: Db, before: AccountRow, bankAccountId: string) // SELECT 1 … where linkCondition
export function setLinkIfStmt(db: Db, before: AccountRow, bankAccountId: string, importStartDate: string) // UPDATE … where linkCondition
export function unlinkHolds(db: Db, before: AccountRow) // SELECT 1 where id, deleted_at null, bank_account_id = before.bankAccountId
export function unlinkIfStmt(db: Db, before: AccountRow) // UPDATE set both null, same where
export async function linkedToConnection(db: Db, connectionId: string): Promise<AccountRow[]> // every account row (any plan) whose bank_account_id is one of the connection's bank accounts
export function unlinkByConnectionStmt(db: Db, connectionId: string) // UPDATE set both null where bank_account_id in (select id from bank_accounts where bank_connection_id = ?)
```

`linkCondition(before, bankAccountId)` is private and follows `starCondition`. It requires: id, deleted_at
null, `bank_account_id IS NULL`, `closed = 0`, `type = before.type`, `exists (select 1 from bank_accounts
where id = bankAccountId)`, and `not exists (select 1 from accounts a2 where a2.budget_id = before.budgetId
and a2.deleted_at is null and a2.bank_account_id = bankAccountId)`.

Extend `newAccountGuard(db, budgetId, sort, name, bankAccountId?: string | null)`. When `bankAccountId` is
given, add the same two `exists` / `not exists` conditions. Existing callers are unchanged.

`repositories/bank-connections.ts`:

```ts
export async function findBankAccountInEnvironment(db: Db, environment: "production" | "sandbox", bankAccountId: string): Promise<BankAccountRow | undefined> // join bank_connections on environment
```

## Task 5: the shared create (`services/accounts.ts`)

- `accountToApi` adds `bank_account_id: row.bankAccountId`, `linked: row.bankAccountId !== null`,
  `import_start_date: row.importStartDate`.
- New error, shared by both services:
  ```ts
  export class LinkRefused extends Error { constructor(readonly status: 409 | 422, readonly code: string, detail: string) }
  ```
- Move the body of `addUnlinkedAccount` (from the system-payee read to the end) into:
  ```ts
  export async function insertAccountWithStartingBalance(
    env: Env, actor: string, budgetId: string,
    spec: { name: string; type: AccountType; amount: number; date: string; bankAccountId: string | null; importStartDate: string | null },
  ): Promise<{ account: Account; starting_balance: Transaction }>
  ```
  The row carries `bankAccountId` and `importStartDate`. The guard is
  `newAccountGuard(db, budgetId, sort, name, spec.bankAccountId)`. After a lost batch, check in this order:
  `nameTaken` → `NameTaken`; when `bankAccountId` is set and `findByBankAccount` finds a row →
  `LinkRefused(409, "bank_account_already_linked", …)`; when the bank account row is gone →
  `NotFound("Bank account")`; otherwise retry. After `MAX_ATTEMPTS`, throw `Conflict("Account order")` as
  today.
- `addUnlinkedAccount` keeps parse, loan refusal, plan check and `nameTaken`. It then calls the helper with
  `amount: startingBalanceAmount(type, balance)`, `date: v.date ?? opts.today ?? utcToday()`, and
  `bankAccountId: null, importStartDate: null`. Its responses and change_log rows stay as they are.
- Verify: `accounts.test.ts`, `payees.test.ts`, `register`/`transactions` tests pass unchanged.

## Task 6: link service (`apps/worker/src/services/account-links.ts`, new)

```ts
export function planAccountType(type: string, subtype: string | null): AccountType // the design's table
export function minusDays(date: string, n: number): string // UTC calendar arithmetic on YYYY-MM-DD
export async function createAccountsFromBank(env: Env, actor: string, budgetId: string, input: AccountsFromBankRequest): Promise<{ created: { account: Account; starting_balance: Transaction }[] }>
export async function linkAccount(env: Env, actor: string, budgetId: string, accountId: string, input: AccountLinkRequest): Promise<Account>
export async function unlinkAccount(env: Env, actor: string, budgetId: string, accountId: string): Promise<Account>
export async function unlinkForConnectionStmts(db: Db, actor: string, connectionId: string): Promise<BatchItem[]> // log rows + unlinkByConnectionStmt
```

- Plan: `budgetsRepo.findActive`, else `NotFound("Plan")`. Environment: `getBudgetEnvironment` (services/budgets).
- `today = input.today ?? new Date().toISOString().slice(0, 10)`.
- `createAccountsFromBank`: parse `AccountsFromBankRequest`. Run every check of the design, in the
  design's order, before any write: resolve each id with `findBankAccountInEnvironment`, apply the type and
  name overrides, refuse cash, use `linksForPlan` for already linked, and check names with `nameTaken` and
  for duplicates inside the request. Then, sequentially for each id, call `insertAccountWithStartingBalance`
  with `{ name, type, amount: bankBalanceToPlan(bank.type, bank.currentBalance), date: today, bankAccountId: bank.id, importStartDate: today }`.
  The default name is `bank.name.trim().slice(0, 100)`.
- `linkAccount`: parse; account `findActive`, else `NotFound("Account")`; bank account, else
  `NotFound("Bank account")`. Refuse cash, then closed (422 `account_not_linkable`), then already linked
  (409 `account_already_linked`), then the bank account taken (`findByBankAccount`, 409
  `bank_account_already_linked`, with the holder's name). `importStartDate = D ? minusDays(D, 3) : today`
  where `D = latestReconciledDate`. Batch `[changeLogInsertIf(update account, before/after accountToApi with balances, linkHolds), setLinkIfStmt]`.
  If `changes === 0`, re-read and re-check (up to `MAX_ATTEMPTS` = 5), then `Conflict("Account")`.
- `unlinkAccount`: account, else 404. If `bankAccountId === null`, return `accountToApi(before, balances)`
  without writing. Otherwise batch `[changeLogInsertIf(…, unlinkHolds), unlinkIfStmt]`, with the same
  retry.
- `unlinkForConnectionStmts`: for each row of `linkedToConnection`, a
  `changeLogInsertIf({ budgetId: row.budgetId, actor, action: "update", entityType: "account", entityId: row.id, before, after }, unlinkHolds(db, row))`
  with balances from `txRepo.balancesByAccount(db, row.budgetId, row.id)`. Then one
  `unlinkByConnectionStmt`. The log rows come first. Type the return as Drizzle's `BatchItem<"sqlite">`
  (import from `drizzle-orm/batch`) or whatever `db.batch` accepts. Check against `getDb`'s type.
- Verify: Task 9 tests 1–7, 10 and 12.

## Task 7: bank connection reads and removal (`services/bank-connections.ts`)

- `toApi(row, accounts, links: Map<string, string> = new Map())`. `linked_account_id: links.get(a.id) ?? null`.
- `listBankConnections` and `getBankConnection` (and `rename`/`finishReset`, which re-read through
  `getBankConnection`): build `links` with `accountsRepo.linksForPlan(db, budgetId, allBankAccountIds)`.
  Their change_log `before`/`after` snapshots use the same map.
- `removeBankConnection`: replace the marked comment with `...(await unlinkForConnectionStmts(db, actor, row.id))`,
  placed before `repo.deleteAccountsStmt`. Read the statements **after** the Plaid call, just before the
  batch. Keep the order: connection log, unlink logs + unlink update, delete bank accounts, delete
  connection, delete token.
- Verify: `bank-connections*.test.ts` pass; Task 9 tests 6 and 9.

## Task 8: route and tools

- `apps/worker/src/routes/account-links.ts` (new, `export default` an `OpenAPIHono<AppEnv>`). Copy the
  `json`, `budgetParam`, `errors` and `defaultHook` pattern from `routes/accounts.ts`; `tags = ["Accounts"]`.
  - `POST /budgets/{budget_id}/accounts/from-bank`: body `AccountsFromBankRequest`; responses 201
    `AccountsFromBankResponse`, 409, 404, 422, 403.
  - `POST /budgets/{budget_id}/accounts/{account_id}/link`: body `AccountLinkRequest`; 200
    `AccountResponse`, 409, 404, 422, 403.
  - `DELETE /budgets/{budget_id}/accounts/{account_id}/link`: 200 `AccountResponse`, 404, 403.
  - Error mapping in each handler: `LinkRefused` → `apiError(c, e.status, e.code, e.message)`; `NameTaken`
    → 409 `name_taken` with the name in the detail. `NotFound` and `Conflict` propagate to `onError`.
  - Pass `c.get("identity").actor`.
- `apps/worker/src/mcp/tools/accounts.ts`: add `create_accounts_from_bank`
  (`z.object({ budget_id: Id, ...accountsFromBankFields })`), `link_account`
  (`{ budget_id: Id, account_id: Id, ...accountLinkFields }`) and `unlink_account`
  (`{ budget_id: Id, account_id: Id }`), each calling the Task 6 function. Each description includes
  `${MONEY}`, plus `${DATE}` where there is a `today`, and `Returns { … }` with the main fields. Cover:
  "what is owed is negative", the cash and closed refusals, already linked is an error, another
  environment's bank account is not found, `today` defaults to the UTC date, and unlink keeps transactions.
  Extend the `list_accounts` and `get_account` descriptions with
  "bank_account_id, linked and import_start_date (YYYY-MM-DD, null when not linked)".
- `apps/worker/src/mcp/tools/bank-connections.ts`: in `FIELDS`, replace
  "linked_account_id, null until accounts can be linked" with
  "linked_account_id (the account of this plan linked to it, or null)".
- `apps/worker/test/mcp-coverage/accounts.ts`: add the three lines from the design.
- Verify: `mcp-coverage.test.ts`, `mcp-descriptions.test.ts`, `openapi.test.ts` and `mcp.test.ts` pass
  **without being edited**.

## Task 9: tests (`apps/worker/test/account-links.test.ts`, new)

- Setup: `seedSandboxCredentials()`, `createPlan("sandbox")`, `stubPlaid(handlers)`. The handlers are
  `/item/public_token/exchange` (with a unique `item_id`), `/accounts/get` (the four accounts of the
  design's Acceptance), `/institutions/get_by_id` (name "ZZ Test Bank") and `/item/remove`. Make the
  connection with `POST /api/v1/bank-connections`. Use `json(...)` from `test/helpers.ts` for REST and
  `mcpRpc` from `test/surface.ts` for MCP (see `bank-connections-manage.test.ts`). Use
  `createTransaction` (services/transactions) for the reconciled seed. Use `env.DB` only to set `closed`,
  to count rows, and for the unique-index case.
- One `it` per design Acceptance case 1–12. Each case checks its response, a re-read (`GET` account or
  `list_accounts`) and its change_log rows (`entity_type`, `action`, `actor`, `budget_id`).
- The surface case: `expect(await apiPaths()).toEqual(expect.arrayContaining(["/api/v1/budgets/{budget_id}/accounts/from-bank", "/api/v1/budgets/{budget_id}/accounts/{account_id}/link"]))`.
  Check the exact path form `apiPaths()` returns in `test/surface.ts` first. Add
  `listedToolNames()` ⊇ the three tools.
- Every response and change_log text in the test is checked with `ALL_SENTINELS` absent (no token leaks).
- Verify: `pnpm check` passes in full.

## Task 10: docs

- `docs/README.md` already has this Build's line (added by the Architect). Do not edit it again.
- No e2e spec changes: `e2e/bank-connections.spec.ts` already carries `linked_account_id: null`, and the
  account fixtures are untyped.

## Report (Implementer)

Give the manifest of the design doc, `git diff --stat origin/main -- apps/web` (empty), and a confirmation
that none of the note-7 files changed. Say that no Plaid call left the stub and no Plaid secret was read.
