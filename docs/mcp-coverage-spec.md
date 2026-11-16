# MCP coverage spec (EXF-572)

Design: [mcp-coverage-design.md](mcp-coverage-design.md). Worker-only. Run `pnpm check` at the end; for a
quick loop use `pnpm vitest run --project worker test/<file>.test.ts`. Do not touch routes, services,
repositories, `packages/**`, `apps/web/**`, `mcp/server.ts`, `mcp/types.ts`, `test/surface.ts`,
`openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `e2e/**` or any always-overlap file.

Rule for every tool: it returns the `data` object of its REST operation, unchanged.

## Task 1. `apps/worker/src/mcp/tool-text.ts` (new)

```ts
import { z } from "zod";
export const Id: z.ZodString;          // z.string().min(1): every id input in every tool
export const MONEY: string;            // "Amounts are integer milliunits (1000 = one currency unit); negative is an outflow, positive an inflow."
export const MONTH: string;            // "A month is its first day, YYYY-MM-01."
export const DATE: string;             // "Dates are YYYY-MM-DD."
```
No other exports. Verify: `pnpm -r typecheck`.

## Task 2. Descriptions

Write each description as below; `${MONEY}`, `${MONTH}`, `${DATE}` are the constants of task 1. Keep the
sentences; light rewording is fine if every rule of task 6 still holds and the facts stay true.

**budgets.ts**
- `list_budgets`: "List every plan (a plan is a budget). Returns { budgets }: each with id, name, bank_environment, created_at, last_modified_on and last_opened_at (null if never opened in the app)."
- `get_budget`: "Read one plan. Returns { budget } with id, name, bank_environment, created_at, last_modified_on and last_opened_at. An unknown or deleted plan is a tool error (Plan not found)."
- `create_budget`: "Create a plan (budget). name is 1 to 100 characters. bank_environment is the Plaid environment of the plan's bank connections: production (default, real banks) or sandbox (Plaid test banks). A new plan starts with the default category groups Bills, Needs and Wants and their categories. Returns { budget } with id, name, bank_environment, created_at, last_modified_on and last_opened_at (null)."
- `update_budget`: "Rename a plan or change its bank_environment (production or sandbox: the Plaid environment its bank connections use). Send only what changes. Returns { budget } with id, name, bank_environment, created_at, last_modified_on and last_opened_at."
- `delete_budget`: "Delete a plan (soft delete): it leaves the plan list and every later read of it is a tool error (Plan not found). Returns { deleted: true }."

**accounts.ts**
- `list_accounts`: "List a plan's accounts in display order; closed accounts only when include_closed is true. ${MONEY} Debts are negative. Returns { accounts }: each with id, name, type, on_budget, starred, closed, group (cash, credit, loans, tracking or closed), cleared_balance, uncleared_balance and balance."
- `get_account`: "Read one account of a plan. ${MONEY} Debts are negative. Returns { account } with id, name, type, on_budget, starred, closed, group, cleared_balance, uncleared_balance and balance."
- `update_account`: "Change an account; send only what changes. starred adds it to or removes it from the sidebar's STARRED group; a closed account cannot be starred (tool error). ${MONEY} Returns { account } with id, name, type, starred, closed, group, cleared_balance, uncleared_balance and balance."
- `create_account`: "Add an unlinked account with a Starting Balance transaction. ${MONEY} balance is entered as shown: for credit cards, lines of credit and other liabilities a positive number means money owed and is stored negative. Loan types are not supported yet. ${DATE} date defaults to today (UTC). Returns { account, starting_balance }: the new account with its balances, and the Starting Balance transaction."
- `get_account_summary`: "The cleared, uncleared and working (cleared + uncleared) totals over every open account of a plan. ${MONEY} Returns { balances: { cleared, uncleared, working } }."

**transactions.ts** (delete the `rules` and `locked` constants or rewrite them; `locked` must not be used by `delete_transaction`)
- `list_transactions`: "List a plan's transactions with balances. With account_id: that account's rows and balances. Without account_id: every account's rows (closed accounts included), each with account_name, and balances summed over the open accounts. Newest first, same-date by amount ascending. ${MONEY} ${DATE} since_date limits the rows, not the balances. Returns { transactions, balances: { cleared, uncleared, working } }; each row has id, account_id, date, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign and updated_at."
- `get_account_balances`: "An account's cleared, uncleared and working (cleared + uncleared) balances. ${MONEY} Returns { cleared, uncleared, working }."
- `get_transaction`: "Read one transaction of a plan. ${MONEY} ${DATE} Returns { transaction } with id, account_id, date, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved, inflow_to_ready_to_assign and updated_at. A deleted transaction, or one of another plan, is a tool error (not found)."
- `create_transaction`: "Add a transaction to an account. ${MONEY} ${DATE} cleared is uncleared (default) or cleared; approved defaults to true. Give a category_id or inflow_to_ready_to_assign: true, never both; a tracking account takes neither; the category must be in the plan (otherwise a tool error). Returns { transaction } with id, account_id, date, payee_name, category_id, category_name, category_group_name, memo, amount, cleared, approved and updated_at."
- `update_transaction`: "Change fields of a transaction; send only what changes. ${MONEY} ${DATE} cleared is uncleared or cleared. category_id and inflow_to_ready_to_assign follow the create_transaction rules. A reconciled transaction, and a credit account's Starting Balance payee, category and account, cannot be changed (tool error). Returns { transaction } with the same fields as get_transaction."
- `delete_transaction`: "Delete a transaction (soft delete): it leaves the register, the balances and the month figures. A reconciled transaction cannot be deleted (tool error). ${MONEY} Returns { transaction }: the transaction as it was, with its amount."

**months.ts**
- `get_plan_month`: "Read one month of a plan. ${MONTH} ${MONEY} Returns { month, note, ready_to_assign, rta_breakdown, groups, uncategorized }: each group and each of its categories has id, name, hidden, assigned, activity and available; categories also carried and target."
- `list_plan_months`: "Summaries of a plan's months from from to to, inclusive, at most 120 months; to must not be before from. ${MONTH} ${MONEY} Returns { months }: each with month, note, ready_to_assign, assigned, activity and available."
- `get_month_range`: "The facts behind a plan's month navigation limits. ${MONTH} Returns { first_month, last_assigned_month }: first_month is the earliest of the plan's creation month and the first month with an assigned amount, a note or a transaction; last_assigned_month is the latest month with an assigned amount, or null."
- `set_month_note`: "Set or clear the free-text note of one month of a plan. ${MONTH} An empty or whitespace-only note, or null, clears it; at most 5000 characters. Returns { month, note } as stored (note is null when cleared)."

**month-categories.ts**
- `set_assigned`: "Set a category's Assigned amount for one month of a plan. ${MONTH} ${MONEY} Assigned may be negative. Returns { category: { id, month, assigned, activity, available }, ready_to_assign }: the category's new month amounts and the month's new Ready to Assign."

**bank-connections.ts**
- `list_bank_connections`: "List the bank connections (Plaid) of the plan's bank environment, with their bank accounts. Read only; no secret is ever returned. ${MONEY} Returns { bank_connections }: each with id, institution_name, nickname, status, last_synced_at and accounts (each with id, name, mask, type, subtype, current_balance and available_balance, null when unknown)."

Verify: task 6's test passes for every tool.

## Task 3. Inputs: ids and `cleared`

- Every `budget_id`, `account_id`, `transaction_id`, `category_id` input in every tool file uses `Id` from
  task 1 (`.optional()` / `.nullable()` where the field already is). Replace `z.uuid()` in
  `bank-connections.ts` and `months.ts`; replace the local `const id` in `transactions.ts`. Fields that come
  from a request shape (`TransactionCreateRequest.shape`, `transactionUpdateShape`) keep the shape's
  `z.string().min(1)`, which already meets the rule.
- `set_month_note`: before calling `setMonthNote`, `if (!z.uuid().safeParse(input.budget_id).success) throw new NotFound("Plan")`
  (`NotFound` from `../../middleware/errors`).
- `create_transaction` and `update_transaction`: override `cleared` with
  `PlainClearedStatus.optional()` (from `@budget/schema/transactions`) after spreading the request shape.
  The services still refuse `reconciled`; it is simply no longer offered.

Verify: task 7 cases for ids and `cleared`.

## Task 4. New tools

Each `run` destructures ids and passes the actor for writes. Inputs use `Id` and the existing schemas.

| Tool | inputSchema | run |
| -- | -- | -- |
| `get_budget` | `{ budget_id: Id }` | `({ budget: await getBudget(env, budget_id) })` |
| `update_budget` | `{ budget_id: Id, name: BudgetCreate.shape.name.optional(), bank_environment: BudgetCreate.shape.bank_environment }` | `({ budget: await updateBudget(env, actor, budget_id, rest) })` |
| `delete_budget` | `{ budget_id: Id }` | `await deleteBudget(env, actor, budget_id); return { deleted: true }` |
| `get_account_summary` | `{ budget_id: Id }` | `({ balances: await getAccountSummary(env, budget_id) })` |
| `get_transaction` | `{ budget_id: Id, transaction_id: Id }` | `({ transaction: await getTransaction(env, budget_id, transaction_id) })` |
| `list_plan_months` | `{ budget_id: Id, from: Month, to: Month }` | range check, then `({ months: await listPlanMonths(env, budget_id, from, to) })` |
| `get_month_range` | `{ budget_id: Id }` | `getMonthRange(env, budget_id)` |

- `update_budget` never passes `opened` (not in its input; the input object is `z.object`, which strips
  unknown keys).
- `list_plan_months` range check, copied from `routes/months.ts` (`monthIndex`, `MAX_MONTHS = 120`):
  `span < 0 || span >= 120` → `throw new Error('"to" must not be before "from", and the range at most 120 months')`.
- `Month` is `@budget/schema/common/dates` (the route's own input schema).

Verify: `tools/list` shows 22 tools; task 7.

## Task 5. Mapping file `apps/worker/test/mcp-coverage-map.ts` (new)

```ts
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/** `METHOD path`, the path relative to /api/v1 exactly as in the route file. */
export type OperationKey = `${Method} /${string}`;
export type Coverage =
  | { tool: string; note?: string }   // note: what the tool leaves out, and why
  | { excluded: string };              // the reason no tool exists
export const operations: Record<OperationKey, Coverage>;
/** Tools that combine or reshape REST data and have no single operation: name → reason. */
export const toolsWithoutOperation: Record<string, string>;
```
- One line per row of the design's mapping table, grouped by resource with a short comment per group, in
  that order. Exclusion reasons as in the design (`GET /me`'s reason says another Build adds the route).
- Notes: `PATCH /budgets/{id}` (`opened` left out: it is the interface recording an open, not a change);
  both `list_transactions` lines (`sort` and `dir` left out: display order; the tool returns the default
  order, newest first).
- `toolsWithoutOperation = { get_account_balances: "its figures are inside the account read and the account's transactions list" }`.
- A header comment: "A Build that adds a REST operation adds its MCP tool and one line here, or an
  `{ excluded: reason }` line. See docs/conventions.md step 7."

Verify: biome passes (`pnpm check` runs `biome check .`).

## Task 6. Tests: coverage and descriptions (new)

**`apps/worker/test/mcp-coverage.test.ts`**, `describe("mcp-coverage")`. Helpers in the file:
- `documentOperations(): Promise<string[]>`: from `apiDocument().paths`, for each path and each key in
  `get|post|put|patch|delete`, `${key.toUpperCase()} ${path.slice("/api/v1".length)}`.
- `mapped(): [OperationKey, string][]`: the `{ tool }` entries.

Tests (names exact; each uses `expect(list, message).toEqual([])` so the diff names the offenders):
1. `every REST operation has an MCP tool or a stated exclusion`: operations with no key in `operations`.
   Message: "REST operations with no MCP tool and no exclusion. For each, add its tool in
   apps/worker/src/mcp/tools/ and one line in apps/worker/test/mcp-coverage-map.ts, or an { excluded:
   reason } line (docs/conventions.md step 7)."
2. `every mapped tool is in tools/list`: entries `"${op} → ${tool}"` whose tool is not in
   `listedToolNames()`. Message says to add the tool or fix the line.
3. `every tool line names an operation of the document`: `{ tool }` keys not in the document (exclusions
   exempt). Message says the line is stale.
4. `every listed tool maps to an operation or is listed as a tool without one`: listed names not among the
   mapped tools nor `toolsWithoutOperation` keys. Message names the map file.
5. `tools without an operation are listed and map to none`: keys of `toolsWithoutOperation` not listed, or
   also mapped.
6. `every exclusion and note states a reason`: entries whose `excluded`/`note` is shorter than 10 characters.

**`apps/worker/test/mcp-descriptions.test.ts`**, `describe("mcp-descriptions")`:
- Fetch once (module-level memoised promise): `initialize`, then `tools/list` via `mcpRpc`, typed locally as
  `{ name; description; inputSchema }[]`; and `apiDocument()`.
- `it.each(toolFileNames().sort())("%s describes itself", …)`; in each:
  - `description.length >= 80` and `/\bReturns\b/`.
  - `money` = `hasInteger(inputSchema)` or, for each `op` mapped to this tool in `operations`, `hasInteger`
    of the 2xx responses' `application/json` schema of `paths["/api/v1" + path][method]`. `hasInteger` walks
    objects and arrays, follows `$ref: "#/components/schemas/X"` with a visited set, true on
    `type === "integer"` or `type` array containing it. If `money`: contains `milliunits` and
    `1000 = one currency unit`.
  - For each input property (top level), collect `pattern` from it and its `allOf`/`anyOf` items. Any pattern
    ending `-01$` → contains `YYYY-MM-01`; else a pattern equal to `^\d{4}-\d{2}-\d{2}$` → contains `YYYY-MM-DD`.
  - Each property named `id` or ending `_id`: every non-null branch (itself, or `anyOf` items with
    `type !== "null"`) has `type: "string"`, `minLength: 1`, no `format`, no `pattern`. Failure message names
    the property.
- Use `expect(value, "<tool>: <rule>")` messages so a failure says which rule.

Verify: `pnpm vitest run --project worker test/mcp-coverage.test.ts test/mcp-descriptions.test.ts` passes;
design acceptance 9–12 bite as described.

## Task 7. Tests: the tools (`apps/worker/test/mcp-tools.test.ts`, new)

Seed like `transactions.test.ts`: plan through `createBudget(env, "user:tester@localhost", …)`, account and
transaction through REST (`json(...)` from `helpers.ts`), names `ZZ-TEST <random>`. An `mcp(name, args)`
helper: `initialize` then `tools/call`, returns `body.result`. `rest(path)` returns `(await res.json()).data`.
Cases (one `it` each; the design's acceptance 2–7):
- `listedToolNames()` contains the eight tool names (`arrayContaining`).
- parity: `structuredContent` `toEqual` REST `data` for `get_budget`, `get_account`, `get_account_summary`,
  `get_transaction`, `list_plan_months` (`from=2026-09-01&to=2026-11-01`), `get_month_range`,
  `list_transactions` with `account_id` (vs `/accounts/{aid}/transactions`) and without (vs `/transactions`).
- `update_budget`: rename, then `bank_environment: "sandbox"`; each result equals REST `GET` afterwards;
  `change_log` rows `entity_type='budget' and action='update' and entity_id=?` have actor
  `mcp:user:tester@localhost`. `tools/list` input properties of `update_budget` are exactly
  `["bank_environment", "budget_id", "name"]` (sorted).
- `delete_budget`: `{ deleted: true }`; REST `GET /api/v1/budgets/{id}` is 404; `change_log` `action='delete'`
  row with the `mcp:` actor; then `delete_budget` with `crypto.randomUUID()` and with `"not-a-plan"` →
  `isError: true`, text matches `/not found/i`.
- `get_transaction` with plan B's id and plan A's transaction → `isError`, `/not found/i`.
- `list_plan_months` with `from: "2026-11-01", to: "2026-09-01"` → `isError`.
- `set_month_note` and `list_bank_connections` with `budget_id: "not-a-plan"` → `isError`, `/not found/i`.
- `cleared`: `tools/list` `create_transaction` and `update_transaction` `inputSchema.properties.cleared.enum`
  equal `["uncleared", "cleared"]`; `create_transaction` with `cleared: "reconciled"` → `isError`, and the
  plan's `transactions` row count is unchanged.
- descriptions: `delete_transaction` matches `/cannot be deleted/` and not `/cannot be changed/`;
  `create_budget` contains `Bills`, `Needs`, `Wants`, `production`, `sandbox`.

Verify: `pnpm vitest run --project worker test/mcp-tools.test.ts`.

## Task 8. Categories (only if on main at your last rebase)

After each rebase: `ls apps/worker/src/routes apps/worker/src/mcp/tools | grep -i categor`. If category
routes exist, run the coverage test; for each operation it names, add a mapping line to its tool
(`create_category_group`, `rename_category_group`, `set_category_group_hidden`, `delete_category_group`,
`create_category`, `rename_category`, `set_category_hidden`, `delete_category`, `unhide_all_categories`,
`get_category_usage`, `get_category_group_usage`). A `PATCH` on category groups whose body also takes
`collapsed` maps to its rename/hide tool, with note "collapsed is interface state; the rename and hide
tools cover the rest". If an operation has no tool, add it in the categories tool file over the existing
service and say so in the report. If a category tool fails `mcp-descriptions`, fix its description there.
If the routes are not on main when you finish, say so in the report.

## Task 9. `docs/conventions.md`

Step 7, replace with:

> 7. **MCP tool** `apps/worker/src/mcp/tools/widgets.ts`: `export const tools: McpToolDef[]`, calling the same
>    service with the `actor` the server passes in (it is `mcp:<identity actor>`). **Every REST operation has
>    its tool**, returning the operation's `data` object; add one line for it in
>    `apps/worker/test/mcp-coverage-map.ts` (`"METHOD /path": { tool: "name" }`), or, when an agent must not
>    or cannot use it (secrets, a browser-only flow, interface state, plumbing), an
>    `{ excluded: "reason" }` line. A tool with no single REST operation goes in `toolsWithoutOperation` with
>    its reason. `mcp-coverage.test.ts` fails on a missing line or a missing tool. **Descriptions** (checked
>    by `mcp-descriptions.test.ts`): say what the tool returns (`Returns { object }` and its main fields);
>    with money in or out, use `MONEY` from `mcp/tool-text.ts` (integer milliunits, 1000 = one currency
>    unit, negative is an outflow); with a month input, `MONTH` (`YYYY-MM-01`); with a date input, `DATE`
>    (`YYYY-MM-DD`). Ids are `Id` (a non-empty string the service resolves; unknown ids are tool errors).
>    Offer in an enum only the values the service accepts.

Step 10: append one sentence: "The MCP coverage and description tests need no edit for a new resource:
add the mapping line of step 7."

## Task 10. Report

Per the Lead's "What to report": the mapping table, the new tools, note 6's three checks with the failing
test names (design acceptance 9–11), the categories status (task 8), the manifest, and
`git diff --name-only origin/main...HEAD` showing nothing outside it.
