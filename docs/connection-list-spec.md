# Connection list spec (EXF-881)

Design: [connection-list-design.md](connection-list-design.md). The Worker and one spec only. No web file, no migration, no schema file, no new operation, and no change to any answer's shape. Commit after each task, in this order.

Every Worker test file of this Build is named `apps/worker/test/connection-list*.test.ts`. The helper beside them is `apps/worker/test/connection-list-helpers.ts`. Run one file with `cd apps/worker && pnpm exec vitest run test/<file>`.

## Task 1: the failing test, on the unfixed code

**`apps/worker/test/connection-list-helpers.ts`**

```ts
export interface SeededEnv { plan: string; connections: { id: string; bankAccountIds: string[] }[] }
/** A new plan of `environment` and `n` connections of `m` bank accounts each, inserted with SQL (columns named). */
export async function seedConnections(environment: "sandbox" | "production", n: number, m: number,
  opts?: { at?: (c: number) => string }): Promise<SeededEnv>
/** Links a new plan account to `bankAccountId` through POST /budgets/{plan}/accounts/from-bank; returns its id. */
export async function linkAccount(plan: string, bankAccountId: string): Promise<string>
```

- **Plan.** Create it with `createPlan(environment)` from `./plaid-stub`, after `seedSandboxCredentials()`. No Plaid call is made: the list and from-bank do not call Plaid.
- **Inserts.** Use one `env.DB.batch` with the column lists of `scheduled-transactions-calls.test.ts:188` for `bank_connections`, and for `bank_accounts`: `(id, bank_connection_id, plaid_account_id, name, mask, type, subtype, created_at)` with `'depository', 'checking'`.
  - Names are `ZZ <c>-<a>`. `display_id` and `plaid_item_id` are random.
  - `created_at` for connection `c` is `2026-11-01T00:<c padded>:00.000Z` by default. The connections are therefore ordered, and the tenth is the newest.
- **`linkAccount`** sends `{ bank_account_ids: [id], today: "2026-11-10" }` and expects 201.

**`apps/worker/test/connection-list.test.ts`**, describe `"EXF-881: the list with 140 bank accounts in one environment"`:

- Seed a Sandbox plan with 10 × 14, and link one plan account to a bank account of the tenth connection.
- `GET /api/v1/bank-connections?budget_id=<plan>` (`json` from `./helpers`). Expect the status to be 200.
- Of `data.bank_connections`, the ones with a seeded id: exactly 10, each with its 14 account ids, which is 140 in all.
- The linked bank account has `linked_account_id` equal to the new account's id. Every other seeded account has `null`.
- **Run it on the unfixed code.** The expected failure is `AssertionError: expected 500 to be 200` at the status line.
  - Quote that line in the commit message and in the report, with the cause. The design has the cause: `D1_ERROR: too many SQL variables`, read in the Architect's probe.
  - To see the cause yourself, call `listBankConnections(env, plan)` in a throwaway file, deleted afterwards. The route logs only `internal_error Error`.
  - **If it does not fail this way, stop and find the cause first** (the brief's point 1).

Commit: `EXF-881: failing Worker test, the list with 140 bank accounts`.

## Task 2: the list's reads

**`apps/worker/src/repositories/accounts.ts`**

```ts
/** bank account id → account id: the plan's live accounts linked to a bank account of `environment`. Binds 2 parameters. */
export async function linksInEnvironment(db: Db, budgetId: string, environment: "production" | "sandbox"): Promise<Map<string, string>>
/** The same for the bank accounts of one connection (`ofConnection`). Binds 2 parameters. */
export async function linksOfConnection(db: Db, budgetId: string, connectionId: string): Promise<Map<string, string>>
```

- Both run `select id, bank_account_id from accounts where budget_id = ? and deleted_at is null and bank_account_id in (<sub-select>)`.
  - `linksInEnvironment`'s sub-select is `select ${bankAccounts.id} from ${bankAccounts} join ${bankConnections} on … where ${bankConnections.environment} = ${environment}`. Import `bankConnections` from `../db/schema/bank-connections` if the file does not yet.
  - `linksOfConnection`'s sub-select is `ofConnection(connectionId)`. Move the `ofConnection` const above both functions if needed.
  - Share one private helper (budgetId, sub-select SQL) → Map.
- `linksForPlan` stays, for `createAccountsFromBank` only. Its doc comment adds: "`bankAccountIds` is the request's list, at most 50 (`AccountsFromBankRequest`)."

**`apps/worker/src/repositories/bank-connections.ts`** · `listByEnvironment`

- The accounts query becomes `.where(sql\`${bankAccounts.bankConnectionId} in (select ${bankConnections.id} from ${bankConnections} where ${bankConnections.environment} = ${environment})\`)`.
- It keeps `.orderBy(bankAccounts.createdAt, bankAccounts.name)`, the early `return []` when there are no connections, and the grouping by `row.id`.
- Update the doc comment.

**`apps/worker/src/services/bank-connections.ts`**

- `listBankConnections`: once `found` is read, call `accountsRepo.linksInEnvironment(db, budgetId, e)`, but only when some connection has a bank account. Otherwise use `new Map()`. This keeps the calls at 4 and 2 (and 3 for connections with no bank account), as today.
- `linksOf(env, budgetId, accounts)` → `linksOf(env, budgetId, connectionId, accounts)`. It returns `new Map()` when `accounts` is empty, and `accountsRepo.linksOfConnection(...)` otherwise.
- Its four callers pass `row.id`: `getBankConnection`, `renameBankConnection`, `finishReset` and `removeBankConnection`.

**Tests**

In `connection-list.test.ts`, add describe `"EXF-881: the list's answer keeps its shape"`. It must pass on the unfixed code (run it there once, by stashing the source change) and after.

- Seed a Sandbox plan with 2 connections × 2 bank accounts, at `2026-11-01T00:00` and `…00:01`. Set fixed names, masks and balances with SQL (`current_balance` 12340, `available_balance` null, `balance_updated_at` fixed).
- Link one plan account to the second account of the older connection.
- From the list, filter the two seeded connections in list order and `toEqual` a **literal** array: every field of `toApi` (`id`, `display_id`, `environment`, `institution_id`, `institution_name`, `institution_logo`, `nickname`, `status`, `status_reason`, `provider`, `last_synced_at`, `last_reset_at`, `sync_failed_at`, `created_at`, `accounts[]` with `id`, `bank_connection_id`, `name`, `mask`, `type`, `subtype`, `current_balance`, `available_balance`, `balance_updated_at`, `linked_account_id`).
- Ids and the linked account's id come from the seed. The newer connection comes first, and accounts are in `created_at, name` order.
- Also `GET /api/v1/bank-connections/{older id}?budget_id=` `toEqual`s the same object as in the list. This covers `linksOfConnection`.

**`apps/worker/test/connection-list-calls.test.ts`**, describe `"EXF-881: D1 calls of the bank connections list"`:

- Use `countingEnv` from `./plaid-sync-helpers` (import it; do not edit that file), and call `listBankConnections(c.env, plan)`.
- Sandbox 10 × 14 with one link: **4 calls**, and the result has the 10 seeded connections.
- A Production plan with no Production connection in the file: **2 calls**.
- Comment: "Measured on f9f1281: 4 with connections (the 140 case failed on its 4th), 2 empty."

Verify with both files and `pnpm check`. Commit: `EXF-881: the list's reads bind no parameter per bank account; shape and call-count tests`.

## Task 3: the spec cleans up (`e2e/bank-connections-sandbox.spec.ts`)

- **State.** At module level, `let plan: string | undefined; let made: string[] = [];`. `test.beforeEach(() => { plan = undefined; made = []; })`.
  - In the test, set `plan` right after reading the created plan's id.
  - `made.push(id)` right after each connection's `expect(res.status()).toBe(201)`, before the list read. Keep the `created` array as is.
- **`test.afterEach(async ({ request }) => { … })`**, with a fresh `authHeaders()`:
  - When `plan` is unset, return.
  - For each id in `made`: `request.delete(\`/api/v1/bank-connections/${id}?budget_id=${plan}\`, { headers })`. Then `request.delete(\`/api/v1/budgets/${plan}\`, { headers })`.
  - A non-2xx answer: read `error.name` from the body if it parses, and `note(\`a Sandbox connection was not removed (HTTP ${status}, ${name})\`)` or `note(\`the plan was not deleted (HTTP ${status})\`)`.
  - A thrown error: `note(\`… (${err instanceof Error ? err.name : "error"})\`)`.
  - `note(text)` is `console.warn(\`cleanup: ${text}\`)` plus `test.info().annotations.push({ type: "cleanup", description: text })`.
  - **Never** print an id, a token, an Item id, a URL with ids, or a credential. The hook never throws, so a cleanup failure never fails the test.
- Assertions, the credentials `PUT`, the direct Plaid call per public token, and the `test.skip` all stay unchanged. Import nothing new except what `./fixtures` and `./support/auth` export. The spec drives no browser, so it has no `realClick`.
- **Do not run the spec on the unfixed code.** Each run leaves two Items at Plaid's Sandbox.
- **Run once:** `pnpm e2e e2e/bank-connections-sandbox.spec.ts --repeat-each=6 --workers=1`. Expect 6 passed (or skipped, with no Sandbox credentials: say so).
- **Then the database check of the design's acceptance 3:** expect 0 connections. Report the last lines.

Commit: `EXF-881: the Sandbox round-trip spec removes its connections and plan`.

## Task 4: the sweep's fixes, the rule

Import `idsIn` from `./payees` (no cycle: `payees.ts` imports neither `accounts.ts` nor `bank-connections.ts` nor `imports.ts`).

- `repositories/bank-connections.ts` · `deleteUnlistedStmt`: `inArray(bankAccounts.id, bankAccountIds)` → `idsIn(bankAccounts.id, bankAccountIds)`.
- `repositories/accounts.ts` · `markMissingStmt`: `missing` becomes `idsIn(accounts.bankAccountId, missingBankIds)` when the list is non-empty, and stays `sql\`0\`` otherwise.
- `repositories/imports.ts` · `livePlanIds`: `inArray(budgets.id, [...budgetIds])` → `idsIn(budgets.id, budgetIds)`.

**`apps/worker/test/connection-list-sweep.test.ts`.** Write each test and run it on the unfixed code first, and quote its failing line. Each is expected to throw `D1_ERROR: too many SQL variables`.

- `"deleteUnlistedStmt removes 120 unlisted bank accounts of one connection"`:
  - Seed 1 × 121, and link one plan account to account 0.
  - Run `getDb(env).batch([repo.deleteUnlistedStmt(db, conn, all121Ids, repo.connectionExists(db, conn))])`.
  - Expect 1 bank account left (the linked one), counted with SQL.
- `"markMissingStmt marks a link among 60 missing bank accounts"`:
  - Seed 1 × 60, and link a plan account to account 59.
  - Run `batch([accountsRepo.markMissingStmt(db, conn, all60Ids, "2026-11-18T00:00:00.000Z", repo.connectionExists(db, conn))])`.
  - Expect that account's `link_missing_since` to be that time.
- `"livePlanIds answers for 150 plan ids"`:
  - Take one live plan and 149 random uuids.
  - Expect `importsRepo.livePlanIds(db, ids)` to equal `new Set([plan])`.

**`docs/conventions.md`.** Under "## Services: D1 calls", after its paragraph, add one paragraph: the rule quoted in the design's Approach, item 6.

Verify with the sweep file, all three `connection-list*` files, the existing `plaid-sync*.test.ts`, `sync-refresh*.test.ts`, `link-status*.test.ts`, `bank-connections*.test.ts` and `account-links.test.ts`, then `pnpm check`. Commit: `EXF-881: one-parameter id lists in the sync's final batch and livePlanIds; the IN-list rule`.

## Not to do

No edit to `plaid-sync-helpers.ts`, `plaid-stub.ts` or any existing test, to `e2e/support/**`, or to any file outside the design's manifest. No new dependency. Never run the whole e2e suite.
