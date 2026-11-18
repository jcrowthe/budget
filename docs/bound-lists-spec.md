# Bound lists and the error log spec (EXF-883, EXF-884)

Build from [bound-lists-design.md](bound-lists-design.md). Commit each part before starting the next one. Worker only. Open nothing in the source app, start no sub-agent, and touch nothing outside the design's Manifest.

Run tests with `pnpm exec vitest run --project worker apps/worker/test/<file>` from the repository root. When a test captures console output, add `--silent=false`.

## Shared test helpers

### `apps/worker/test/bound-lists-helpers.ts`

```ts
export interface BigGroup { bid: string; groupId: string; targetId: string; ids: string[] }
/** A fresh plan (category-helpers `plan()`) with a group "ZZ-TEST Big" of n categories and, in a second group,
 *  a target category. With `history`, one transaction (createAccount + createTransaction, 2026-11-02, -1000)
 *  on the first category. Seeds with createCategoryGroup / createCategory, as category-delete.test.ts does. */
export async function seedBigGroup(n: number, opts?: { history?: boolean }): Promise<BigGroup>;
/** `String(e)` and `String(e.cause)` of the promise's rejection, or "" if it resolves: the assertion message. */
export async function causeOf(p: () => Promise<unknown>): Promise<string>;
```

If one file runs past about 60 s, the helper may seed the n categories in one `db.batch` of `db.insert(categories).values(row)`, one row per statement and every column named. Copy the row from what `createCategory` writes (sort order, `created_at`, `updated_at`). Say so in the report.

### `apps/worker/test/error-log-helpers.ts`

```ts
/** env.DB whose prepare(q) replaces the table name `table` (word match) with `zz_error_log_missing`, so the statements
 *  that read it fail for real in D1 ("no such table"); everything else passes through, batch included. */
export function brokenDb(table: string): D1Database;
/** Spies console.error for the test; returns the lines, each `args.map(String).join(" ")`. Restored in afterEach. */
export function captureErrors(): string[];
```

## Part 1: the fault tests on the unfixed code (commit 1)

`apps/worker/test/bound-lists.test.ts`, `describe("EXF-883: a group's categories as one parameter")`.

Each test asserts through the API with `json` and `api` from `category-helpers.ts`. When the status is wrong, the failure message is `await causeOf(() => <the service call>)`, which quotes the D1 cause.

| Test | Expected after the fix | Before (the Architect's probe) |
|---|---|---|
| A1: `DELETE …/category_groups/{g}`, 35 categories, no history | 200; `data.deleted.category_ids` has 35 ids; the group and its 35 categories have `deleted_at` set | 500, `D1_ERROR: too many SQL variables` |
| A2: the same, 35 categories with history, `?reassign_to=<target>` | 200, `transactions_moved: 1` | **passes** (fails from 42) |
| A3: the same as A2 with 45 categories | 200, `transactions_moved: 1` | 500 |
| A4: `GET …/category_groups/{g}/usage`, 55 categories | 200 `{ category_count: 55, transaction_count: 0, has_history: false }` | 500 |
| A5: `DELETE …/category_groups/{g}`, 55 categories with history, no `reassign_to` (this reaches `historyOf` in `run`) | 409 `history_exists` (`routes/category-groups.ts:63`) | 500 |
| A6: 120 categories: the delete without history, the delete with history and `reassign_to`, and the usage read | 200 each; the deletes as in A1 and A2; `change_log` holds 120 `category` delete rows and 1 `category_group` row for the delete without history | 500 |
| A7: `idList` binds one parameter | `getDb(env).all(sql\`select count(*) n from (select 'x' v) where v in (${idList(ids)})\`)` with 500 ids, the last one `'x'`, gives `n = 1` | 500 ids: `too many SQL variables` |

Run the file on `deb0f99` code. **Quote each failing line** (test name, status and the cause from the message) in the commit message and the report. A2 is expected to pass: say so in the report's first lines with the corrected counts (24 / 42 / 50, as in the design). If anything else differs from the table, stop and report before changing code.

Commit 1 holds the test file and its helper only. The tests fail on that commit by design, and part 2 makes them pass. Push nothing: the platform does that at the end of the turn.

## Part 2: the lists' fix (commit 2)

### `repositories/guards.ts`

```ts
/** The ids as ONE bound parameter, for `col in (${idList(ids)})`: renders `select value from json_each(?)`
 *  bound to JSON.stringify(ids). Any number of ids (D1 allows 100 parameters per statement). */
export function idList(ids: readonly string[]): SQL; // sql`select value from json_each(${JSON.stringify(ids)})`
```

Before changing it, run `grep -n "idList(" apps/worker/src`: nine uses, each inside `in (…)`. If one is not, stop and report.

### `repositories/categories.ts`

- **`softDeleteManyStmt`:** `.where(and(sql\`${categories.id} in (${idList(ids)})\`, isNull(categories.deletedAt), guard))`
- **`listActiveByIds`:** delete it. `grep -rn listActiveByIds apps packages` must find nothing.
- **Imports:** drop `inArray` from the import.
- **`historyOf`, `noHistory` and `allActive`:** unchanged. They already go through `idList`.

`services/category-delete.ts`, `repositories/category-reassign.ts` and `repositories/month-categories.ts` need no change. Edit them only if a check asks for it.

### `apps/worker/test/bound-lists-calls.test.ts`

Use `countingEnv()` from `plaid-sync-helpers.ts`, as `connection-list-calls.test.ts` does: seed, `c.reset()`, call the service with `c.env`, then read `c.calls.d1`.

| Call | n = 3 | n = 120 |
|---|---|---|
| `deleteCategoryGroup`, no history | 6 | 6 |
| `deleteCategoryGroup`, history and `reassign_to` | 8 | 8 |
| `groupUsage` | 4 | 4 |

`deleteCategory` is a single category, so its counts do not depend on n: 5 without history and 7 with history and `reassign_to`.

### The audit

- **`apps/worker/test/connection-list-table.test.ts`:** run it. `AUDITED["repositories/categories.ts"]` should stay 12 (see the design). Change a count only to match the code, and say which.
- **`docs/connection-list-design.md`:** in the table "The same pattern elsewhere", the `historyOf…` row's "Its bound" and "Done" cells become as in the design (**Fixed (EXF-883)** …). The `listActiveByIds` row's "Done" becomes **Removed (EXF-883)**. Change no other row and no other section.
- **`docs/conventions.md`:** add the design's one line right after the paragraph "No `IN` list built from rows…".

### Verify

- `bound-lists.test.ts` and `bound-lists-calls.test.ts` pass.
- `category-delete.test.ts`, `category-groups.test.ts`, `categories.test.ts` and `connection-list-table.test.ts` pass **unchanged**.
- `pnpm check` passes.

## Part 3: the describing function, `onError`, `scheduled.ts` (commit 3)

### `middleware/errors.ts`

```ts
import { DrizzleError, DrizzleQueryError } from "drizzle-orm";
import { routePath } from "hono/route";

export const LOG_LINE_MAX = 1000;
/** For the log: names and messages down the cause chain (≤ 4 links), never a bound value (design, rules 1–7).
 *  Never put a value in a thrown Error's message: it is logged on a 500. */
export function describeError(err: unknown): string;
/** MCP: logs `mcp_tool_error <tool> | <describeError(e)>` only for a fault (design, "The MCP endpoint"). */
export function logToolError(tool: string, e: unknown): void;
```

`describeError` follows rules 1–7 of the design exactly:

- **Chain:** at most 4 links; stop at an object already seen.
- **Labels:** `DrizzleQueryError`; otherwise the `Error`'s `name`, cut to 40 characters; `non-error <typeof>` for anything that is not an `Error`.
- **A `DrizzleQueryError`'s text:** its `query`, with runs of 3 or more placeholders collapsed to `?×n`, cut to 300 characters.
- **Another `Error`'s text:** cut at the first `"\nparams:"`; everything from `for value` becomes `for value …`; whitespace collapses; cut to 300 characters.
- **Duplicates:** skip a link whose text is contained in the previous link's text.
- **Format:** links joined with ` <- `; the whole result cut to 900 characters.

`onError`'s last two lines become:

```ts
const route = routePath(c);
console.error(`internal_error ${c.req.method}${route ? ` ${route}` : ""} | ${describeError(err)}`.slice(0, LOG_LINE_MAX));
return apiError(c, 500, "internal_error", "Internal error");
```

Rewrite the doc comment above `onError` to say: it logs the method, the route pattern and `describeError`, and never the address, a query, a header or a body. Every other branch stays byte for byte.

### `scheduled.ts`

Line 26 becomes `` console.error(`scheduler failed | ${describeError(e)}`.slice(0, LOG_LINE_MAX)) ``, importing from `./middleware/errors`. No other change.

### `apps/worker/test/error-log.test.ts`

Use `captureErrors()` in each test. "No value" means: the line contains none of the marker, the plan id, the group id, any category id, `ZZ-QUERY-93` or `ZZ-HEADER-93`.

- **E1: a failed statement through the real app.** Seed a group of 3 categories. `call(api(bid, \`/category_groups/${g}/usage?q=ZZ-QUERY-93\`), await authed({ headers: { "x-zz": "ZZ-HEADER-93" } }), { DB: brokenDb("month_categories") })` (`helpers.ts`).
  - The answer is 500 with body `{"error":{"id":"500","name":"internal_error","detail":"Internal error"}}`.
  - Exactly one line starts with `internal_error GET /api/v1/budgets/:budget_id/category_groups/:group_id/usage | DrizzleQueryError: select (select count(*) from transactions where budget_id = ? and deleted_at is null and category_id in (select value from json_each(?))) as t`.
  - The line contains ` <- Error: D1_ERROR: no such table: zz_error_log_missing: SQLITE_ERROR`.
  - The line holds no value.
- **E2: the marker in a bound parameter.** A test-only `new Hono<AppEnv>()` with `app.onError(onError)` and `app.post("/api/v1/budgets/:budget_id/zz-error-log", h)`. The handler `h` runs `getDb(c.env).all(sql\`insert into categories (id, name) values (${crypto.randomUUID()}, ${(await c.req.json()).memo})\`)`. Send `app.request("/api/v1/budgets/<uuid>/zz-error-log?q=ZZ-QUERY-93", { method: "POST", headers: { "x-zz": "ZZ-HEADER-93", "content-type": "application/json" }, body: JSON.stringify({ memo: "ZZ-MARKER-93" }) }, env)`.
  - The answer is the same 500 body.
  - The line **equals** `internal_error POST /api/v1/budgets/:budget_id/zz-error-log | DrizzleQueryError: insert into categories (id, name) values (?, ?) <- Error: D1_ERROR: NOT NULL constraint failed: categories.budget_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)`.
  - The line holds no value, nor the uuid.
- **E3: a plain `Error`.** In the same app, a route `GET /api/v1/budgets/:budget_id/zz-error-log/plain` throws `new Error("boom")`.
  - The line equals `internal_error GET /api/v1/budgets/:budget_id/zz-error-log/plain | Error: boom`.
  - The answer is the same 500.
- **E4: a thrown non-error.**
  - A route that throws `"ZZ-MARKER-93"`: `app.request` rejects with that value, and no `internal_error` line is logged. This pins Hono's behaviour, as the design says.
  - `describeError("ZZ-MARKER-93") === "non-error string"` and `describeError({ message: "ZZ-MARKER-93" }) === "non-error object"`.
- **E5: D1's type error.** `env.DB.prepare("select ?").bind({ toString: () => "ZZ-MARKER-93" } as never)`, caught: `describeError(e)` starts with `Error: D1_TYPE_ERROR: Type 'object' not supported for value …` and holds no marker.
- **E6: the rules.**
  - `new Error("Failed query: select ?\nparams: ZZ-MARKER-93")` gives `Error: Failed query: select ?`.
  - A chain of 6 causes gives 4 links.
  - A 5,000-character message gives a description of at most 900 characters.
  - A `DrizzleQueryError` built by hand (`new DrizzleQueryError("select ?, ?, ?, ?", ["ZZ-MARKER-93"], new Error("x"))`) gives `DrizzleQueryError: select ?×4 <- Error: x`.
- **E7: the scheduled job.** Seed nothing. `await cronRun({ ...env, DB: brokenDb("scheduled_transactions") }, new Date("2031-07-14T03:00:00Z"), noRun)`, with `noRun` as in `sync-refresh-schedule.test.ts`.
  - It resolves: a failed scheduler does not stop the sync step.
  - Exactly one line starts with `scheduler failed | DrizzleQueryError: ` and contains `no such table: zz_error_log_missing`.
  - The line does not contain `2031-07-13`, the scheduler's day, which is a bound parameter of `listDue`.

For each of E1, E2, E3 and E7, run it once on the code before this part. The line it showed (`internal_error Error`, or `scheduler failed` with the object) goes into the commit message and the report.

### Verify

- `error-log.test.ts` passes.
- Every existing Worker test passes unchanged; `pnpm check` runs them all.
- `pnpm check` passes.

## Part 4: the MCP endpoint (commit 4)

### `mcp/server.ts`

This is the only change in the file. The callback's `const result = await tool.run(…)` becomes:

```ts
let result: unknown;
try {
  result = await tool.run(input as never, { env, actor });
} catch (e) {
  logToolError(tool.name, e);
  throw e;
}
```

### `logToolError`

`logToolError` logs `` `mcp_tool_error ${tool} | ${describeError(e)}`.slice(0, LOG_LINE_MAX) `` only when `e` is one of these:

- not an `Error`;
- an `Error` whose `name` is `TypeError`, `RangeError`, `ReferenceError` or `SyntaxError`;
- an error whose chain holds a `DrizzleQueryError` or `DrizzleError`;
- an error whose chain holds a message starting with `D1_`.

Otherwise it logs nothing.

### Tests (in `error-log.test.ts`)

- **E8: a tool fails for real.** Seed a group of 3. Send `initialize`, then `tools/call` `get_category_group_usage` `{ budget_id, group_id }`, with `call("/mcp", …, { DB: brokenDb("month_categories") })`. Copy the request shape of `mcpRpc` in `surface.ts`, adding the env override.
  - The result has `isError: true`, as today.
  - Exactly one line starts with `mcp_tool_error get_category_group_usage | DrizzleQueryError: `.
  - The line holds no value.
- **E9: a refusal is not logged.** On the real env, `delete_category_group` on a group with history and no `reassign_to` gives `isError: true` and logs no `mcp_tool_error` line.

For E8, run it once before the change: no line is logged. Quote that in the commit message and the report.

### Verify

- `error-log.test.ts` passes.
- `mcp.test.ts` and `mcp-tools.test.ts` pass unchanged.
- `pnpm check` passes.

## The report

Give the answers the brief's "What to report at the end" asks for. Each step states that it opened nothing in the source app.

- **Departures:** any acceptance case or existing expected text that changed, listed separately.
- **`docs/README.md`:** the Architect already added this Build's line. On a rebase, keep both sides' lines.
