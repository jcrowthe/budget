# Connection list design (EXF-881)

The bank connections list (`GET /api/v1/bank-connections?budget_id=`) answers 500 once the plan's bank environment holds about a hundred bank accounts. Manage Bank Connections, Link Account and the Add Accounts step all read this list. The Sandbox round-trip spec `e2e/bank-connections-sandbox.spec.ts` leaves two real connections behind on every run, so it brings that state about by itself.

This Build changes the Worker's reads and that one spec. Nothing on screen changes. **No web file, no migration, no schema file, no new operation, no change to any answer's shape or to any tool's description.** The Build starts from main `f9f1281`.

## The source app in this Build

**No step of this Build opens, reads or probes the source app, and no step starts a sub-agent.** The Clerk's tab command is the only contact, because the platform checks that the tab exists. Nobody uses that tab. Reason: the ticket is a fault in the Worker's own database reads and in one test. Nothing on any screen changes, and there is nothing to compare.

**Each step states in its report, for itself only, that it opened nothing in the source app.** Nobody but the Clerk runs the Clerk's commands.

The Architect opened nothing in the source app and started no sub-agent. There are no study notes under `/workspace/scratch/source/`.

## The cause, read from the server (the Architect's probe on `f9f1281`)

The probe was a throwaway Worker test, deleted afterwards and not committed. It had one Sandbox plan, 10 connections of 14 bank accounts each (140), seeded with SQL as `scheduled-transactions-calls.test.ts` seeds them, and one plan account linked through `POST …/accounts/from-bank` to a bank account of the tenth connection (201).

- `GET /api/v1/bank-connections?budget_id=<plan>` answered **500** `{"error":{"id":"500","name":"internal_error","detail":"Internal error"}}`. The Worker logs only `internal_error Error`, because `middleware/errors.ts:42` logs the error's name and nothing else.
- Called directly, `listBankConnections` threw an error with cause **`D1_ERROR: too many SQL variables at offset 451: SQLITE_ERROR`**.
- `accountsRepo.linksForPlan(db, plan, ids)` worked with 99 ids (99 + the plan's id = 100 parameters) and failed with 100 ids and with 140, giving the same error.
- `listByEnvironment` worked: 10 connection ids is 10 parameters.

**The inference holds.** D1 allows 100 bound parameters in one statement. `linksForPlan` binds one parameter per bank account of the whole environment, plus the plan's id. Seven Sandbox connections of 14 accounts make 99 parameters (works). Eight make 113 (fails). `listByEnvironment` has the same shape for connection ids, and fails from a hundred connections on.

The Implementer still writes the test of task 1 and runs it on the unfixed code first, as the brief says. If it does not fail with this cause, the Implementer stops and finds the real cause.

## D1 calls of the list

Measured in the probe on `f9f1281`: 4 calls with connections (the 140 case: `findActive` for the plan's environment, connections, bank accounts, links), and **2 calls for an empty environment** (`findActive`, connections). The read stops when there are no connections.

**After the fix: the same, 4 and 2.** The links read is still skipped when there is no bank account at all. A counting test pins both numbers.

## Approach

1. **`linksForPlan` gives way to two scoped reads** in `repositories/accounts.ts`. Both select the plan's live accounts (`budget_id = ?`, `deleted_at is null`) with `bank_account_id in (<sub-select>)`:
   - `linksInEnvironment(db, budgetId, environment)`: the sub-select is `select b.id from bank_accounts b join bank_connections c on c.id = b.bank_connection_id where c.environment = ?`. It binds 2 parameters. `listBankConnections` uses it.
   - `linksOfConnection(db, budgetId, connectionId)`: the sub-select is the file's existing `ofConnection(connectionId)`. It binds 2 parameters. The service's `linksOf` uses it (get, rename, reset, remove). Its argument becomes the connection's id instead of the account list. The result is the same, because `accounts` there is exactly that connection's bank accounts (`scoped` → `getInEnvironment`).
   - Both return the same `Map<bank account id, account id>` as today.
   - `linksForPlan(db, budgetId, ids)` stays for its third caller only: `createAccountsFromBank` (`services/account-links.ts:86`). Its list is the request's `bank_account_ids`, bounded by the schema at **`.max(50)`** (`packages/schema/src/accounts.ts:160`), so 51 parameters at most. It is not changed. Its doc comment states that bound.
2. **`listByEnvironment`** reads the bank accounts with `bank_connection_id in (select id from bank_connections where environment = ?)`, 1 parameter. It keeps the same order (`bank_accounts.created_at`, `name`), the same grouping by connection in JS, and the early return when there are no connections.
3. **The sync's two lists of one connection** (see the table) move to `idsIn` (`repositories/payees.ts`, one JSON parameter): `deleteUnlistedStmt` and `markMissingStmt`.
4. **`livePlanIds`** (`repositories/imports.ts`) moves to `idsIn`. Its list is the distinct plans with a link to one connection, and nothing bounds it.
5. **The spec cleans up** (below).
6. **`docs/conventions.md`** gains one rule under "Services: D1 calls":
   > No `IN` list built from rows of the database without a stated bound (D1 refuses more than 100 bound parameters in a statement): use a join, a sub-select or `idsIn` (`repositories/payees.ts`, one parameter for any number of ids).

The answer's shape and order do not change. A shape test pins the JSON of a small case field for field, and it passes both before and after the fix.

## The same pattern elsewhere (point 3): every `IN` list in `repositories/**` and `services/**`

The table is **complete**: it covers every `inArray(`, `notInArray(`, `idList(` and hand-written `in (${…})` in `apps/worker/src/repositories/**` and `apps/worker/src/services/**` on `f9f1281`.

| File · function | Where the list comes from | Its bound | Done |
|---|---|---|---|
| `repositories/accounts.ts` · `linksForPlan`, called by `listBankConnections` | every bank account id of the environment | **none** (the size of an environment) | **Fixed**: `linksInEnvironment`, a sub-select |
| `repositories/accounts.ts` · `linksForPlan`, called by `linksOf` (get, rename, reset, remove) | one connection's bank accounts | one connection's bank accounts, no number | **Fixed**: `linksOfConnection`, a sub-select |
| `repositories/accounts.ts` · `linksForPlan`, called by `createAccountsFromBank` | the request's `bank_account_ids` | schema `.max(50)`, so 51 parameters | Kept; the bound is stated in the doc comment |
| `repositories/bank-connections.ts` · `listByEnvironment` | the environment's connection ids | **none** (fails from 100 connections) | **Fixed**: a sub-select on the environment |
| `repositories/bank-connections.ts` · `deleteUnlistedStmt` (the sync's final batch, `plaid-sync.ts:743`) | the connection's stored bank accounts the bank no longer lists | one connection's bank accounts, no number. It binds the connection id, n ids and the guard's values, so a connection with about 95 or more unlisted bank accounts makes the **whole final batch** fail with `too many SQL variables`. The batch is atomic, so none of its writes apply, on every run while that lasts | **Fixed**: `idsIn` |
| `repositories/accounts.ts` · `markMissingStmt` (same batch, `plaid-sync.ts:736`) | the same list (missing ids) | one connection's bank accounts. **It binds the list twice** (the `case` and the `where`), so about 47 missing ids break the same batch | **Fixed**: `idsIn` (one parameter for each use) |
| `repositories/imports.ts` · `livePlanIds` (`plaid-sync.ts:242`, `account-links.ts:289`) | the distinct plans with a live link to one connection | **none** (the number of plans) | **Fixed**: `idsIn` |
| `repositories/accounts.ts` · `linksAsRead` (plan delete, `services/budgets.ts:255,280`) | the plan's linked accounts | `MAX_LINKS_AS_READ = 90`, refused with 409 before the statement | Not fixed: see below |
| `repositories/imports.ts` · `knownImportIds`, `tombstonesQuery`, `rowsByImportIdQuery` | import ids of a file or of Plaid | chunked: `CHUNK - 1 = 89`, `CHUNK = 90`, `SYNC_UNIT_SIZE = 90`, plus the plan's id | Kept |
| `repositories/categories.ts` · `historyOf`, `noHistory`, `allActive`, `softDeleteManyStmt`; `services/category-delete.ts:63,112`; `repositories/category-reassign.ts:9`; `repositories/month-categories.ts:92` | the deleted category, or the live categories of one group | one group's categories, any number | **Fixed (EXF-883)**: `idList` binds the list as one JSON parameter (`json_each`), so each statement's parameters no longer grow with the group |
| `repositories/categories.ts` · `listActiveByIds` | (no caller in `src`) | none | **Removed (EXF-883)** |
| `repositories/scheduled-transactions.ts` · `listDue` `budgetIds` | `[budget_id]` from the route and the tool, or `"all"` from the cron | 1 | Kept |
| `reports.ts:286` `CASH_TYPES`; `plan-activity.ts:70`, `transactions.ts:197` `UNCOUNTED_STARTING_TYPES`; `card-flows.ts:34`, `plan-activity.ts:35` card types; `reconcile.ts:10` literals; `bank-connections.ts:159,207` statuses | constants | a constant | Kept |
| `payees.ts` `idsIn`; `transactions.ts:319,614,667,711`; `scheduled-transactions.ts:89,222` (`json_each`); `reports.ts:49`, `accounts.ts` `linkedToConnection` / `noLinksToConnection` (sub-selects) | — | one parameter already | Kept |

### Found, not fixed

- **Fixed (EXF-883, see `bound-lists-design.md`).** **Category deletes, one group's categories.** `historyOf` binds the ids twice (2n + 2). By counting placeholders (not run), `GET` usage of a category group fails from about 49 categories in the group. Each statement of the delete batch carries the guard `full` (`noHistory` 2n, `allActive` n, …), so a group delete fails from roughly 30 categories in one group. It answers 500. An ordinary plan rarely puts 30 categories in one group, so this is **not as bad as the list**, but it is reachable. For a ticket.
- **Plan delete with more than 90 linked accounts** is refused with 409 (`MAX_LINKS_AS_READ`). It is a stated bound with a clean refusal, not a crash. `idsIn` over `id|bank_account_id` pairs would lift it. For a ticket if wanted.
- **Removed (EXF-883).** **`listActiveByIds`** had no caller.
- **Items left at Plaid's Sandbox by earlier runs** (the Lead's and the gates') stay. Their access tokens went with the boxes that made them, and nothing can remove them. Nothing is done.
- **Fixed (EXF-884, see `bound-lists-design.md`).** The Worker logged only the error's name for a 500 (`middleware/errors.ts`, a shared module, out of bounds), which is why the cause was not visible in the server log.

## The spec cleans up (`e2e/bank-connections-sandbox.spec.ts`)

- **What the remove does** (`removeBankConnection`, `services/bank-connections.ts:348`). The route is `DELETE /api/v1/bank-connections/{id}?budget_id=<plan>`, which answers 200 `{ data: { deleted: true, plaid } }`. The service first calls Plaid's `/item/remove`.
  - **When Plaid says the Item is gone** (`ITEM_NOT_FOUND`, `INVALID_ACCESS_TOKEN`), the local removal completes with `plaid: "already_removed"`.
  - **Any other Plaid error** (`PlaidApiError`) answers **502 `plaid_remove_failed`**, and *nothing is removed locally*.
  - **A non-Plaid failure** (network) propagates through `refusalOr` → `plaidFail` as an error answer, and again nothing is removed.
  - With missing Plaid credentials it answers 422.
- **The cleanup.** Module-level `plan: string | undefined` and `made: string[]` are reset in `beforeEach`. The plan id is set right after the plan's 201. Each connection id is pushed right after its 201, before any assertion on the list.
  - A `test.afterEach` removes each id in `made` through the route above, then deletes the plan (`DELETE /api/v1/budgets/{plan}`).
  - It runs whether the test passed or failed, and also when only one connection was made.
  - It never throws. A non-200 answer, or a thrown request error, adds one line through `console.warn` and a `test.info().annotations` entry of type `cleanup`. For example: `cleanup: a Sandbox connection was not removed (HTTP 502, plaid_remove_failed)`, or `cleanup: the plan was not deleted (HTTP <n>)`. The line carries the status and the error's `name` only: **no connection id, Item id, token or credential**.
  - A Plaid refusal therefore leaves that connection in the local database, and the test's result is unchanged. With the Worker fix, a leftover no longer breaks the list.
- The assertions stay as they are. The stored Sandbox credentials stay (the `PUT /api/v1/plaid/credentials` at the start). **No other spec relies on them**: every other spec that touches bank connections stubs the API in the browser (`e2e/support/bank-link-stub.ts`), and none creates a connection on the server. So after the six runs the test database should hold **0** connections.
- Each `pnpm e2e` starts from a fresh database (`scripts/e2e-serve.sh` removes `.e2e-state`). The leftovers add up within one run of the command: the gate's ten repetitions, or the suite's three passes.

## Downstream effects

None on screen, on the API's shape or on MCP. The D1 calls of get, rename, reset and remove are unchanged: `linksOf` is still one query. The sync's call count is unchanged (13 per sync): `idsIn` changes the binding, not the number of statements.

## Out of scope

Web; migrations and schema files; tool descriptions; the category-delete and plan-delete bounds above; Items left at Plaid by earlier runs; the logging of 500s.

## Acceptance, and what the Tester does

Nothing on screen changes, so there is no Looking list and no screenshot is asked; take none unless something looks wrong. The Tester runs and reports, with the commands and their last lines:

1. The new Worker tests pass; `pnpm check` passes.
2. `pnpm e2e e2e/bank-connections-sandbox.spec.ts --repeat-each=6 --workers=1` passes 6 of 6. (If the Plaid Sandbox credentials are not in the box's environment the spec skips itself: then say `SANDBOX CREDENTIALS MISSING IN THIS BOX` in the first line and report the Worker tests only.)
3. **After those six runs the local test database holds none of their connections:** read it through the API (a Sandbox plan made for the purpose, `GET /api/v1/bank-connections?budget_id=`, then delete that plan) and report the number of connections (expected 0, or only ones made by other specs' stand-ins: say which).
   - How: the run's server is gone, and `scripts/e2e-serve.sh` would wipe the state. Serve the state as the run left it, with `cd /workspace/repo && BUDGET_STATE_DIR=$PWD/.e2e-state setsid pnpm --filter @budget/web exec vite preview --port 4173 --strictPort > /workspace/scratch/connection-list-serve.log 2>&1 &`. Note its process group.
   - Sign with `node scripts/local-jwt.mjs --out <a 0600 temp file>`, and send the file's content as `Cf-Access-Jwt-Assertion` with curl, never printing it.
   - Then `kill -- -<PGID>`.
   - Expected: `bank_connections` has length 0.
4. The table of point 3 is in the design, complete or marked partial.
5. The report says, for each test of point 5, the line it failed with before the fix.

## The order of the work (commit each part before the next)

1. The Worker test of point 1, run on the unfixed code, its failure quoted in the commit message and in the report.
2. The fix of `linksForPlan` and `listByEnvironment` with the shape test and the counting test.
3. The spec's cleanup; the six runs.
4. The table of point 3, its fixes with their tests, the rule in `docs/conventions.md`.

## Manifest

touches: [apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/repositories/imports.ts, apps/worker/src/services/bank-connections.ts, apps/worker/test/connection-list*.ts, e2e/bank-connections-sandbox.spec.ts, docs/conventions.md, docs/connection-list-design.md, docs/connection-list-spec.md, docs/README.md]
shared: []
migrations: 0
