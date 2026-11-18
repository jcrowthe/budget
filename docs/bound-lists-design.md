# Bound lists and the error log design (EXF-883, EXF-884)

Two faults that the Build for EXF-881 found outside its ground.

- **EXF-883.** Deleting a category group binds one parameter per category, several times in each statement. D1 refuses a statement with more than 100 bound parameters, so a large group cannot be deleted and its history read fails.
- **EXF-884.** For an unexpected error, the Worker logs only the error's name. The scheduled job logs the whole error object, which can carry bound values.

**Worker only. No web file, no migration, no new operation, no change to any answer's shape or to any tool.** This Build edits one shared module, `apps/worker/src/middleware/errors.ts`, by the Lead's word. Under point 10 it also adds one call to `apps/worker/src/mcp/server.ts`. It needs none of the files closed to it by the EXF-467 Build. It imports nothing from `repositories/payees.ts`. The Build starts from main `deb0f99`.

## The source app in this Build

**No step of this Build opens, reads or probes the source app, and no step starts a sub-agent.** The Clerk's tab command is the only contact, because the platform checks that the tab exists. Nobody uses that tab. Reason: both tickets are faults in the Worker's own statements and log lines. Nothing on any screen changes, and there is nothing to compare.

**Each step states in its report, for itself only, that it opened nothing in the source app.** Nobody but the Clerk runs the Clerk's commands.

The Architect opened nothing in the source app and started no sub-agent; there are no study notes.

## Part A: EXF-883, lists of categories

### Evidence: the Architect's probe on `deb0f99`

The probe was a throwaway Worker test, deleted afterwards and not committed. Plans were seeded with `createCategoryGroup` and `createCategory`, as `category-delete.test.ts` seeds them. "With history" means one transaction on the group's first category, plus `reassign_to` a category in another group.

| Case | Result on `deb0f99` | Cause (`err.cause`, or the batch's own error) |
|---|---|---|
| (a) `DELETE …/category_groups/{id}`, 35 categories, no history | **500** `{"error":{"id":"500","name":"internal_error","detail":"Internal error"}}` | `D1_ERROR: too many SQL variables at offset 756: SQLITE_ERROR` (thrown by `db.batch`, not wrapped by Drizzle) |
| (b) the same, 35 categories with history and `reassign_to` | **200: does not fail** | — |
| (c) `GET …/category_groups/{id}/usage`, 55 categories | **500** | `DrizzleQueryError` (`Failed query: select (select count(*) from transactions … in (?, ?, … 55 …)) …`) ← `D1_ERROR: too many SQL variables at offset 516: SQLITE_ERROR` |
| (c) `DELETE` of the same group of 55 | **500** | the same `historyOf` failure |

The server log for each 500 read only `internal_error Error`.

**The counts in EXF-883 are corrected as follows** (measured by size):

- **Group delete without history fails from 24 categories** (23 works), not about 30. The first statement over 100 is `softDeleteManyStmt`: `inArray` n, `deleted_at` and `updated_at`, plus the guard `full` (`noHistory` 2n + 2, `allActive` n + 1, group 1, `groupExact` 2), which is 4n + 8.
- **Group delete with history and `reassign_to` fails from 42 categories** (41 works). There `full` is only n + 6, and the move statements bind the list once more. So the test of case (b) at 35 passes on the unfixed code. The fault test for that path uses 45.
- **The history read fails from 50 categories** (49 works). `historyOf` binds 2n + 2, and 2 × 50 + 2 = 102.

**`historyOf` is called for a group** in two places:

- **`category-delete.ts:194`** is `usageOf`, the read of `GET …/categories/{id}/usage` and `GET …/category_groups/{id}/usage`. The tools `get_category_usage` and `get_category_group_usage` use it too.
- **`category-delete.ts:257`** is `run`, the read before the batch of `DELETE …/categories/{id}` and `DELETE …/category_groups/{id}`. The tools `delete_category` and `delete_category_group` use it too.

### The fix: `idList` binds one parameter

`idList(ids)` (`repositories/guards.ts`) now renders `select value from json_each(?)`, bound to `JSON.stringify(ids)`. That is the same form as `idsIn` in `repositories/payees.ts`.

**Every use was checked.** `grep -n "idList(" apps/worker/src` gives nine uses, and every one is written `in (${idList(…)})`:

- `categories.ts:259` (twice), `:266` (twice) and `:271`
- `category-delete.ts:63` and `:112`
- `category-reassign.ts:9`
- `month-categories.ts:92`

So each becomes `in (select value from json_each(?))`, a valid sub-select, and no call site changes.

**Why `idList` and not `idsIn`:**

- One change fixes all nine sites.
- The statements keep their shape.
- Nothing is imported from `payees.ts`, a file another Build is editing.

An empty list gives `in (select value from json_each('[]'))`, which is false, as `in ()` is today. The ids are uuid text, and `json_each` yields text.

**The rest of `repositories/categories.ts`:**

- **`softDeleteManyStmt`**: its `inArray(categories.id, [...ids])` becomes `` sql`${categories.id} in (${idList(ids)})` ``. With an empty list, Drizzle's `inArray` gives a false condition, and so does the new form.
- **`listActiveByIds`** is removed. `grep -rn listActiveByIds apps/` finds only its definition. Then `inArray` leaves the file's import.

After the fix, every statement of a category or group delete, and every read before it, binds a fixed number of parameters whatever the group's size. The largest is a `change_log` insert with the guard `full`: about 9 values plus 9 for the guard.

### D1 calls (measured on `deb0f99`; the same after the fix)

| Operation | D1 calls, before = after |
|---|---|
| Group delete, no history | **6**: plan, group, its categories, `historyOf`, targets, batch |
| Group delete with history and `reassign_to` | **8**: the above plus the target check and `mergeableMonths` |
| Category delete, no history | **5** |
| Category delete with history and `reassign_to` | **7** |
| Group usage read (non-empty group) | **4**: plan, group, categories, `historyOf` |

The group delete counts were measured at 3 and 10 categories. An empty group's usage read takes 3 calls, because `historyOf` returns before its query. The fix changes how values are bound, not the number of statements, so no new round trip is added. A counting test pins each row at 3 and at 120 categories.

### The audit follows

The count in `apps/worker/test/connection-list-table.test.ts` (`AUDITED`) stays **12** for `repositories/categories.ts`:

- −1 for the `inArray(` of `listActiveByIds`.
- −1 for the `inArray(` of `softDeleteManyStmt`.
- +2 for its new `in (${idList(` (the pattern counts both `in (${` and `idList(`).

The other files keep their counts: `category-delete.ts` 4, `category-reassign.ts` 2, `month-categories.ts` 2. The Implementer runs the test and changes a count only if the code says otherwise.

In `docs/connection-list-design.md`, the two category rows of the table change to:

- **categories / `category-delete` / `category-reassign` / `month-categories`:** "one group's categories, any number; **Fixed (EXF-883)**: `idList` binds the list as one JSON parameter (`json_each`), so each statement's parameters no longer grow with the group".
- **`listActiveByIds`:** "**Removed (EXF-883)**".

`docs/conventions.md` gains one line right after the `IN`-list rule:

> `apps/worker/test/connection-list-table.test.ts` counts the `IN`-list sites (`inArray(`, `notInArray(`, `idList(`, `in (${`) per file of `repositories/` and `services/`: a Build that adds or removes one updates its count and the table in `docs/connection-list-design.md`. `idList` (`repositories/guards.ts`) binds its list as one parameter.

### Plan delete with more than 90 linked accounts

This is left as it is, and `repositories/accounts.ts` is not changed. **`idsIn` would lift it cheaply.** `linksAsRead` compares `id || '|' || bank_account_id` with a list of such strings, so `not in (select value from json_each(?))` takes any number of them on one parameter.

## Part B: EXF-884, what an unexpected error logs

### What the libraries put where (read in the lockfile, shown by the probe)

**`drizzle-orm` 0.45.4.** In `sqlite-core/session.js`, every query (`all`, `get`, `run`, `values`) catches the driver's error and throws `new DrizzleQueryError(queryString, params, e)` (`errors.js`). That error has:

- `name`: `"Error"`. It is not set, so a log of the name says only `Error`.
- `message`: `` `Failed query: ${query}\nparams: ${params}` ``, where `params` is joined with commas. **The bound values are in `message` and in `stack`.**
- `query`: the statement's text, with a `?` for each parameter.
- `params`: the values.
- `cause`: the D1 error.

**`db.batch` is not wrapped.** `d1/session.js` calls `client.batch` with no catch, so a batch throws D1's own error.

**D1 (workerd 1.20261113.1, `d1-api`)** throws `new Error(`D1_ERROR: ${message}`, { cause: new Error(message) })`. The message is SQLite's own text, which names objects and never a bound value. The other forms are `D1_EXEC_ERROR: …` and **`D1_TYPE_ERROR: Type '<type>' not supported for value '<String(value)>'`**, and **that last one carries a value**.

Real examples from the probe, with the marker `ZZ-MARKER-93` in a bound parameter (the chain is error ← cause ← cause):

- **Drizzle query with a constraint failure:**
  - `[0] DrizzleQueryError, name "Error"`: `"Failed query: insert into categories (id) values (?)\nparams: ZZ-MARKER-93"`
  - ← `[1] Error`: `"D1_ERROR: NOT NULL constraint failed: categories.budget_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)"`
  - ← `[2] Error`: the same text without `D1_ERROR: `
- **Batch:**
  - `[0] Error`: `"D1_ERROR: too many SQL variables at offset 756: SQLITE_ERROR"`
  - ← `[1] Error`: the same without the prefix
- **Type error:**
  - `[0] Error`: `"D1_TYPE_ERROR: Type 'object' not supported for value '[object Object]'"`
  - ← `[1] Error`: the same without the prefix

**Statement text holds no value.** Values reach a statement's text only through `sql.raw`. In `src` it is used only with code constants: `guards.ts` `sql.raw("h")`, and `plan-import.ts` `sql.raw(c.lit)`, where `lit("0")` is the only form. So `DrizzleQueryError.query` holds no value, and it is read as its own field, never parsed out of `message`.

### `describeError(err: unknown): string` (in `middleware/errors.ts`)

1. **Chain.** Start with `err`, then each `.cause` that is not null or undefined: **at most 4 links**. It stops at a link already seen.
2. **Label.**
   - `instanceof DrizzleQueryError` (from `drizzle-orm`): `DrizzleQueryError`.
   - Another `Error`: its `name`, cut to 40 characters.
   - Anything else: `non-error <typeof>`, with no text. **A thrown non-error's value is never logged.**
3. **Text of a `DrizzleQueryError`.** Its `query` field, **never its `message` or `params`**. Runs of three or more placeholders (`?, ?, ?`) collapse to `?×<n>`. Whitespace collapses to one space. Cut to 300 characters.
4. **Text of any other `Error`**, from its `message`:
   - (a) everything from the first `"\nparams:"` is dropped (a Drizzle-shaped message);
   - (b) everything from the first `for value` becomes `for value …` (`D1_TYPE_ERROR`);
   - (c) whitespace collapses to one space;
   - (d) cut to 300 characters.
5. A link whose text is contained in the previous link's text is skipped. That drops D1's duplicate cause.
6. Links are written `<label>: <text>` (just `<label>` when the text is empty), joined with ` <- `.
7. The result is cut to 900 characters. `LOG_LINE_MAX = 1000` caps the whole line.

**What a line keeps:**

- the D1 message, which is the useful part (`too many SQL variables`, `NOT NULL constraint failed: categories.budget_id`);
- the statement's text, placeholders only;
- the names.

**It never keeps:** a bound value, a request address, a query string, a header, or a body.

**A message the code itself throws is logged after this.** The plain `Error`s in `src` (`grep -rn "throw new Error(" src`) hold code text only. The doc comment above `describeError` says: never put a value in an `Error`'s message.

### `onError`

For an unexpected error (the existing final branch), `onError` logs one string:

`` console.error(`internal_error ${c.req.method} ${routePath(c)} | ${describeError(err)}`.slice(0, LOG_LINE_MAX)) ``

- **`routePath(c)`** comes from `hono/route` (Hono 4.13.18). It returns `matchedRoutes(c).at(c.req.routeIndex).path`, and `compose` sets `routeIndex` to the handler that ran last, which is the one that threw. For a route module mounted with `app.route("/api/v1", …)`, the path is the full pattern with `:budget_id`, for example `/api/v1/budgets/:budget_id/category_groups/:group_id`.
- An error thrown in a middleware gives that middleware's pattern (`*`, `/api/v1/*`).
- When `routePath` is `""`, the line has the method only.
- **Never `c.req.url`, `c.req.path`, a query, a header, or a body.**
- The answer is unchanged: `500 internal_error`, `Internal error`. The other branches are unchanged.

Example (case (c) before the fix):

```
internal_error GET /api/v1/budgets/:budget_id/category_groups/:group_id/usage | DrizzleQueryError: select (select count(*) from transactions where budget_id = ? and deleted_at is null and category_id in (?×55)) as t, (select count(distinct month) from month_categories where budget_id = ? and assigned <> 0 and category_id in (?×55)) as a <- Error: D1_ERROR: too many SQL variables at offset 516: SQLITE_ERROR
```

**A thrown non-error never reaches `onError`.** Hono 4.13.18's `compose` calls `onError` only when `err instanceof Error`, and otherwise rethrows. `#handleError` does the same. Such a value leaves `app.fetch` as a rejection, and the runtime logs it and answers with its own 500. Today's behaviour is the same. No code in `src` throws a non-error (`grep -rn "throw [^n]" src`: only rethrows and refusal helpers). Catching it would need a wrapper in `app.ts`, a shared module not granted to this Build: see Found, not built. The test pins today's behaviour and `describeError`'s answer for a non-error.

### `scheduled.ts`

Today it runs `console.error("scheduler failed", e)`, which logs the whole object. The runtime renders an `Error` with its message and stack. **This could carry bound values.** If a statement of `enterDue` fails through Drizzle, the message is `Failed query: …\nparams: …`, and its parameters are the scheduled transactions' ids, amounts, memos and dates. That line becomes:

`` console.error(`scheduler failed | ${describeError(e)}`.slice(0, LOG_LINE_MAX)) ``

Nothing else changes: the bank sync still runs after a failure.

### The MCP endpoint (point 10)

**What it does today.** The tool callback in `mcp/server.ts:23` does not catch. `McpServer`'s `tools/call` handler (`@modelcontextprotocol/server` 2.4.0, `mcp-*.mjs`) catches any error and returns `{ content: [{ type: "text", text: error.message }], isError: true }` (or `String(error)` for a non-error) with HTTP 200. **It never reaches `onError` and nothing is logged.**

The tools' refusals take the same path. They are plain `Error`s or classes whose `name` is often unset (`throw new Error("Give category_ids or view, not both")` in `mcp/tools/*`, `BudgetRefused`, …), and some messages hold names (`card-payments.ts:43`). So "unexpected" cannot be told by the class.

**The change, one call.** The callback becomes `try { … tool.run … } catch (e) { logToolError(tool.name, e); throw e; }`. `logToolError(tool: string, e: unknown)` is in `middleware/errors.ts` and is built on `describeError`. It logs `` `mcp_tool_error ${tool} | ${describeError(e)}` `` (capped at `LOG_LINE_MAX`) **only for a fault**:

- a non-error;
- a built-in `TypeError`, `RangeError`, `ReferenceError` or `SyntaxError`;
- a `DrizzleQueryError` or `DrizzleError` anywhere in the chain;
- a message starting with `D1_` anywhere in the chain.

A refusal is not logged. The error is rethrown, so the tool's answer is byte for byte what it is today. Nothing else in `server.ts` changes.

### Where to read the line for the deployed Worker

`pnpm --filter @budget/worker exec wrangler tail` streams it live, as does the Cloudflare dashboard's Worker → Logs → live/real-time view. Neither needs a setting. **Persisted, searchable Workers Logs need `"observability": { "enabled": true }` in `apps/worker/wrangler.jsonc`, which is absent today.** That file is not changed: see Found, not built.

## Downstream effects

None on screen, on answers or on tools; the same D1 calls. The log lines for a 500, a failed scheduler and a faulted tool carry the cause. Tests that capture `console.error` (`bank-connections*.test.ts`, `plaid-sync-budget.test.ts`) check for secrets, never in these lines.

## Out of scope

- Any change to an answer's shape, a tool, the web, or a migration.
- Every other list of the table marked kept.
- `repositories/accounts.ts` (`MAX_LINKS_AS_READ`).
- `wrangler.jsonc`, `app.ts`, and the files closed by the EXF-467 Build.

## Found, not built

- **`wrangler.jsonc` has no `observability` block.** Persisted Workers Logs need `"observability": { "enabled": true }`. Without it, a 500's line is only seen while someone tails.
- **A thrown non-error** bypasses `onError` (Hono rethrows it), so the runtime logs its value and answers its own 500. A first middleware in `app.ts` that turns a non-error into an `Error` would close it. `app.ts` is a shared module not granted here.
- **The MCP tool error text** for a failed statement is Drizzle's message with its parameters. It goes to the MCP client (the owner's own agent, behind Access), not to a log. Changing it would change a tool's answer.
- **An error thrown by `syncDueConnections`** leaves `cronRun` uncaught, and the runtime logs its message.
- **A group delete's batch length** grows with the group: one `change_log` statement per category and per target. That is unchanged and is one D1 call.

## Acceptance, and what the Tester does

Nothing on screen changes, so there is no Looking list and no screenshot is asked; take none unless something looks wrong. The Tester runs and reports, with the commands and their last lines:
1. The new Worker tests pass; `pnpm check` passes.
2. Through the real local server: a plan with one group of 120 categories made through the API; the group is deleted through the API; the answer is the success the API gives for a group of 3, and the group and its categories are gone. (120 requests to make them, no more: tests stay light.)
3. Through the real local server: one request that fails unexpectedly, if one can be made without changing code (say how, or say that none can and that the Worker tests of point 11 stand for it); the server's log line for it, quoted, with no value from the request in it.
4. The audit test's counts and the table agree with the code; `docs/conventions.md` names the test.
5. The report gives, for each test written for a fault, the line it failed with before the fix.

The Architect knows of no request that fails unexpectedly after the fix. Before the fix, a group of 24 or more categories did, and `pnpm dev` prints the Worker's `console.error` lines in its terminal.

## The order of the work (commit each part before the next)

1. The Worker tests of point 1, run on the unfixed code, their failures quoted in the commit message and in the report.
2. The lists' fix, the counting tests, `listActiveByIds`, the audit test's counts, the table, the line in `docs/conventions.md`.
3. The describing function with its tests; `onError`; `scheduled.ts`.
4. The MCP endpoint's reading (and its one call, if point 10 calls for it).

## Manifest

touches: [apps/worker/src/repositories/guards.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/repositories/category-reassign.ts, apps/worker/src/repositories/month-categories.ts, apps/worker/src/services/category-delete.ts, apps/worker/src/middleware/errors.ts, apps/worker/src/scheduled.ts, apps/worker/src/mcp/server.ts, apps/worker/test/connection-list-table.test.ts, apps/worker/test/bound-lists*.ts, apps/worker/test/error-log*.ts, docs/conventions.md, docs/connection-list-design.md, docs/bound-lists-design.md, docs/bound-lists-spec.md, docs/README.md]
shared: [apps/worker/src/middleware/errors.ts: describeError, the onError log line and logToolError (EXF-884, by the Lead's word); apps/worker/src/mcp/server.ts: one try/catch around tool.run with one logToolError call (point 10)]
migrations: 0
