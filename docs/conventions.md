# Conventions: adding a resource end to end

Worked example: `budgets` (a "Plan" in the UI). Copy its files, rename, and add **files only**. Nothing is
registered by hand: routes, MCP tools and pages are collected with `import.meta.glob`.

## Steps (one file each; replace `widgets` with your resource)

1. **Migration** `apps/worker/migrations/<UTC YYYYMMDDHHMMSS>_widgets.sql`. The 14-digit timestamp is the order;
   two Builds never collide. Forward-only and additive: no edits to old migrations, no drops. There is no
   journal file. After adding one, delete `.e2e-state`.
2. **Table** `apps/worker/src/db/schema/widgets.ts`: one Drizzle table, columns matching the SQL.
   `test/schema-drift.test.ts` fails if they differ.
3. **Zod schemas** `packages/schema/src/widgets.ts`: import `z` from `@hono/zod-openapi`, name schemas with
   `.openapi("Name")`, wrap responses in `dataEnvelope(...)`. No barrel: import `@budget/schema/widgets`.
4. **Repository** `apps/worker/src/repositories/widgets.ts`: reads, plus `*Stmt` functions that return
   **unexecuted** statements.
5. **Service** `apps/worker/src/services/widgets.ts`: one function per use case, `(env, actor, input)`. Every
   mutation reads `before`, then runs **one** `db.batch([rowStmt, changeLogInsert(db, {...})])`. D1 has no
   interactive transactions, so the batch is the atomicity. Throw `NotFound` (from `middleware/errors`) for a
   missing row.
6. **Route** `apps/worker/src/routes/widgets.ts`: `export default` an `OpenAPIHono<AppEnv>` built with
   `createRoute` (paths relative to `/api/v1`). The route is the OpenAPI entry: it appears in
   `/api/v1/openapi.json` automatically. Read `c.get("identity").actor` and pass it to the service.
7. **MCP tool** `apps/worker/src/mcp/tools/widgets.ts`: `export const tools: McpToolDef[]`, calling the same
   service with the `actor` the server passes in (it is `mcp:<identity actor>`). **Every REST operation has
   its tool**, returning the operation's `data` object; add one line for it in
   the resource's own coverage file `apps/worker/test/mcp-coverage/<resource>.ts`
   (`"METHOD /path": { tool: "name" }`; `tool` may be a list when several tools split one operation), or,
   when an agent must not or cannot use it (secrets, a browser-only flow, interface state, plumbing), an
   `{ excluded: "reason" }` line. A tool with no single REST operation goes in that file's
   `toolsWithoutOperation` with its reason. A new resource adds its own coverage file next to its tests
   and never edits another resource's file; an operation added to an existing resource goes in that
   resource's file. The test collects the folder with `import.meta.glob` and fails when two files claim
   one operation. `mcp-coverage.test.ts` fails on a missing line or a missing tool. **Descriptions** (checked
   by `mcp-descriptions.test.ts`): say what the tool returns (`Returns { object }` and its main fields);
   with money in or out, use `MONEY` from `mcp/tool-text.ts` (integer milliunits, 1000 = one currency
   unit, negative is an outflow); with a month input, `MONTH` (`YYYY-MM-01`); with a date input, `DATE`
   (`YYYY-MM-DD`). Ids are `Id` (a non-empty string the service resolves; unknown ids are tool errors).
   Offer in an enum only the values the service accepts.
8. **Web API module** `apps/web/src/api/widgets.ts`: functions and hooks over `apiFetch` with the schemas from
   step 3. The web app calls only `/api/v1`; there is no private endpoint for the UI.
9. **Page** `apps/web/src/pages/widgets.tsx`: `export const page = { path, element }`. Use
   `usePageTitle("Widgets")` for the `<Page> | <Plan> | Budget` title, and the variables in
   `apps/web/src/shell/tokens.css` (never raw colours). Plan pages use a `/:budgetId/...` path and need no
   gate: the router nests them in `PlanScope` (plan resolved, not-found handled, open recorded).
10. **Tests**: `apps/worker/test/widgets.test.ts` (REST, change_log rows, atomicity, and the resource's own
    surface: `expect(await apiPaths()).toEqual(expect.arrayContaining([...]))` with its paths and the same
    with `listedToolNames()` for its tools, both from `test/surface.ts`), `e2e/widgets.spec.ts` (the user
    flow). Name test data `ZZ-TEST <random>`; no spec may assume an empty database, nor that it is the only one opening or
    creating plans: a spec that opens `/` or asserts on the latest, first or most recent plan shows the page only
    its own plans (`showOnlyPlans` in `e2e/support/plans.ts`) and asserts only on those. Never edit
    `apps/worker/test/openapi.test.ts`, `apps/worker/test/mcp.test.ts` or `e2e/mcp.spec.ts`: they derive the
    route and tool lists from the globs (every route file contributes a path, every tool file exports a
    tool, no two tools share a name, `tools/list` matches the tool files), so a new resource adds files only.
    The MCP coverage and description tests need no edit for a new resource: add the coverage
    file of step 7.

## Services: D1 calls

A request that handles many rows makes a number of D1 calls that does not grow with the rows: read with set queries, write with one batch (a batch counts as one call; the Free plan allows 50 calls per invocation). Such a handler has a test that counts its calls for 10 and for 100 rows.

No `IN` list built from rows of the database without a stated bound (D1 refuses more than 100 bound parameters in a statement): use a join, a sub-select or `idsIn` (`repositories/payees.ts`, one parameter for any number of ids).

`apps/worker/test/connection-list-table.test.ts` counts the `IN`-list sites (`inArray(`, `notInArray(`, `idList(`, `in (${`) per file of `repositories/` and `services/`: a Build that adds or removes one updates its count and the table in `docs/connection-list-design.md`. `idList` (`repositories/guards.ts`) binds its list as one parameter.

## Statements: name the columns

No statement depends on a table's column order: every insert or copy names its columns. Use `insertSelect` (`repositories/insert-select.ts`) for `insert … select`; Drizzle's `insert(t).select(...)` lists every column of `t` and is refused by `scripts/test/positional-inserts.test.ts`. `insert(t).values({...})` names them and is fine.

## Shared modules: one Build at a time

Changing these affects every feature, so they run alone (`paths.shared_modules` in `clone.profile.json`):
`packages/core/src/**`, `packages/schema/src/common/**`, `apps/worker/src/{app.ts,env.ts}`,
`middleware/**`, `secrets/**`, `db/client.ts`, `history/**`, `mcp/server.ts`, `mcp/types.ts`,
`apps/web/src/{api/client.ts,router.tsx,shell/**}`. Files in `paths.always_overlap` (lockfile, package.json
files, tsconfig, biome, vitest and vite configs, `wrangler.jsonc`, `clone.profile.json`) are touched by many
Builds: keep edits there minimal and rebase often. If a feature needs a new Worker binding or variable, that
is an `env.ts` plus `wrangler.jsonc` change.

## Product rules

- **Money** is integer milliunits (1000 = one currency unit), never a float. Use `@budget/core/money` and
  `Milliunits` from `@budget/schema/common/money`.
- **Dates** are ISO 8601. A **month** is its first day (`2026-11-01`): `@budget/core/month`.
- **Actor**: every mutation records who did it in `change_log`: `user:<email>`, `service:<token name>`, or
  `mcp:<actor>` for MCP calls; `service:plaid` for the writes of a bank sync.
- **Access only**: the Access middleware runs before everything, assets included. No public path, no webhook,
  no `workers.dev` URL. Secrets go through `src/secrets` only and are never returned or logged. The Worker also pins identity: an
  Access user token must carry `ACCESS_ALLOWED_EMAIL` (case-insensitive; empty refuses all), a service token
  must be listed in `ACCESS_SERVICE_TOKENS`, and locally signed `@localhost` tokens work only when
  `ENVIRONMENT` is `local`. `SECRETS_ENCRYPTION_KEY` is any string of at least 32 characters (HKDF per key
  version); the deploy refuses a shorter one.
- **API shape**: success `{ data: ... }`, errors `{ error: { id, name, detail } }`. Writes accept
  `Idempotency-Key`.
- **Branding**: the app is "Budget" with its own icon. Never use the source app's name, logo or art in code,
  CSS, HTML or SVG.
- **Placeholders**: a query never shows another plan's data as a placeholder. Use `keepPreviousInPlan(budgetId)` from
  `apps/web/src/api/placeholder.ts`, never `keepPreviousData`.
- **Real data** (balances, payees, amounts) never goes into code, fixtures, screenshots or commit messages.

## Plaid

- Credentials are read only through `apps/worker/src/plaid/credentials.ts` (`loadPlaidCredentials`); they live
  encrypted in `secrets` (`plaid_credentials:<environment>`), written by `PUT /api/v1/plaid/credentials`, never
  in Worker variables. No route, tool or log returns a value.
- Call Plaid only through `plaidFor(env, environment)` (`plaid/client.ts`). The environment comes from the plan
  (`getBudgetEnvironment`, `budgets.bank_environment`) or from the connection (`bank_connections.environment`).
  A sandbox connection is never used with a production plan, and the other way round.
- Production is unreachable unless the Worker's `ENVIRONMENT` is `production`; locally and in tests only Sandbox.
- Access tokens go through `plaid/tokens.ts` (`plaid_access_token:<connection id>` in `secrets`); never in a
  response, log line, MCP result, HTML or `change_log`. Plaid amounts become milliunits with `plaidToMilliunits`.
- Tests stub `fetch` (`test/plaid-stub.ts`) and use sentinel values; they never read `PLAID_PRODUCTION_SECRET`.
  No Plaid webhook: syncing polls.

## Commands

- `pnpm check` (lint, typecheck, unit + Worker tests, build)
- `pnpm dev` (http://localhost:5173, signed in as `dev@localhost`)
- `pnpm e2e` (production bundle on :4173)
- `bash scripts/deploy.sh` (gate, then release; see Deploy phases below)

### Deploy phases

`bash scripts/deploy.sh` is controlled by the `DEPLOY_PHASE` environment variable:

- unset (default): gate, then release
- `gate`: `pnpm check`, then `pnpm e2e`; changes nothing in production
- `release`: build, resources, migrations, deploy, smoke test; runs no gate
- anything else is refused (exit 2) before anything runs

`DEPLOY_E2E=skip` skips only the Playwright run (the gate still runs `pnpm check`). The required variables are
checked first, in every phase (and `SECRETS_ENCRYPTION_KEY` must be at least 32 characters, else exit 2). After each finished phase the script prints a line `PHASE_SECONDS <step>=<s> ...`
(gate: `checks`, `e2e`; release: `build`, `resources`, `migrations`, `deploy`, `smoke`; a skipped step is `0`),
and after a release `Live: <url>` and `DEPLOY_SHA=<full sha>`. `DEPLOY_DRY_RUN=1` prints `DRY: ...` instead of
running the gate or calling Cloudflare.

### Scripts

- `bash scripts/migrations-pending.sh`: read-only. Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  Prints the file name of each migration not yet applied to the remote `budget-db`, one per line, nothing when
  none are pending (all of them when the database does not exist yet). Exit 0 when it can tell; 1 with a message
  on stderr when it cannot; 2 for a missing variable.
- `bash scripts/plaid-credentials.sh`: pushes `PLAID_CLIENT_ID` with `PLAID_SANDBOX_SECRET` / `PLAID_PRODUCTION_SECRET` from the environment to the live clone (the release runs it last; a failure only warns). Prints `plaid credentials: sandbox set|skipped|failed, production set|skipped|failed`; exit 1 when an environment failed, 2 for a refused base URL or missing Access variables. Local: `PLAID_CREDENTIALS_BASE_URL=http://127.0.0.1:<port>` pushes Sandbox only and prints `production skipped (local)`; `PLAID_CREDENTIALS_LOCAL_PRODUCTION` set is refused (exit 2).
- `bash scripts/live-test-plans.sh <command>`: manages test plans (name starts with `live.test_prefix`, `ZZ-TEST`)
  and nothing else; only calls `/api/v1/budgets`. Needs `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
  - `list ['<prefix>']`: `<id><TAB><name>` per test plan
  - `create '<name>'`: creates a Sandbox plan (`bank_environment: sandbox`), prints the new id; a name without the prefix is refused (exit 2)
  - `delete <id>`: re-reads the plan; prints `deleted <id>`; an unprefixed plan is refused (exit 3)
  - `purge ['<prefix>']`: prints `deleted <n> remaining <m>`; exit 0 only when `m` is 0; more than 50 matches is refused (exit 3)
  - `<prefix>` (must start with `ZZ-TEST`, else exit 2) narrows the command to one run's plans, e.g. `purge 'ZZ-TEST F9 '`; with no argument: every test plan
  - Local testing: `LIVE_TEST_PLANS_BASE_URL=http://127.0.0.1:<port>` targets `pnpm dev` (which signs requests
    itself); add `LIVE_TEST_PLANS_LOCAL_JWT=1` for the e2e server. No Access headers are sent to a local server.

Live flow tests reach the clone with `scripts/access-browser.mjs`.

**Plan menu entries.** The plan menu's entries are fixed in `apps/web/src/shell/planMenuEntries.ts`. An entry is enabled by adding one file `apps/web/src/menu-actions/<entry-id>.ts(x)` that exports `action: PlanMenuAction` (`{ entry, run(ctx) }` or `{ entry, Dialog }`). The shell collects it with `import.meta.glob`; never edit the shell to enable an entry. Unregistered entries are shown disabled.

**Duplicate column names in batched selects.** A D1 batch (and `db.all`) maps rows by column name, so two selected columns of one name (`categories.name`, `category_groups.name`) collapse into one. Label each with ``sql<T>`${col}`.as("category_name")``; the worker test database (`apps/worker/test/column-guard.ts`) fails any batched or `all()` select with duplicate output names.

**Timestamps in tool results.** A tool whose result holds a timestamp names it with timestamps([...], [nullable]) from mcp/tool-text.ts, and dates with dates(...). A new tool adds its call to CALLS (or a reason to NOT_CALLED) in apps/worker/test/mcp-timestamps.test.ts.

## Browser suite: workers and load

- The worker count comes from `e2e/support/e2e-load-workers.ts`: the cgroup CPU quota minus 1, and a memory limit of
  (memory − 2 GiB) / 512 MiB, never above Playwright's default (half the visible CPUs). `E2E_WORKERS=<n>` overrides;
  `--workers` wins. A 5-CPU, 5 GiB box runs 4 workers.
- Why: 8 workers there reached the memory cap and stalled the test server for 6 to 11 s ([design](e2e-load-design.md)).
- Measure under the made load (four busy loops): `bash scripts/e2e-load.sh <label> on [playwright args]`; past the
  shell's 10 minutes, `bash scripts/e2e-load-bg.sh start|wait|stop <label> on`. The table line and every failed test
  are in `/workspace/scratch/e2e-load/<label>/summary.md`.
- Clicks under load: `mouseClick` and both `realClick`s go through `e2e/support/settled.ts`, which waits (up to 30 s) until
  the target is visible, has the same box on two animation frames and is topmost at its centre, and enabled (pass `{ allowDisabled: true }` only where a spec presses a disabled control to assert nothing happens). Where a press can still be
  lost (a list or card re-renders right after it loads), the spec waits for the list, then presses again until the result
  shows (`openExport`, `expandTransfers`). Retry the action, never loosen the assertion; never skip a test.

Web unit tests for pure helpers live next to the code as `apps/web/src/**/*.test.ts`; the root `vitest.config.ts` `web` project collects them, so `pnpm check` runs them.
