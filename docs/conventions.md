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
   service with the `actor` the server passes in (it is `mcp:<identity actor>`).
8. **Web API module** `apps/web/src/api/widgets.ts`: functions and hooks over `apiFetch` with the schemas from
   step 3. The web app calls only `/api/v1`; there is no private endpoint for the UI.
9. **Page** `apps/web/src/pages/widgets.tsx`: `export const page = { path, element }`. Use
   `usePageTitle("Widgets")` for the `<Page> | <Plan> | Budget` title, and the variables in
   `apps/web/src/shell/tokens.css` (never raw colours).
10. **Tests**: `apps/worker/test/widgets.test.ts` (REST, change_log rows, atomicity), `e2e/widgets.spec.ts`
    (the user flow). Name test data `ZZ-TEST <random>`; no spec may assume an empty database. Update
    `test/openapi.test.ts` only if you must; adding a route changes its expected path list, so extend the list.

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
  `mcp:<actor>` for MCP calls.
- **Access only**: the Access middleware runs before everything, assets included. No public path, no webhook,
  no `workers.dev` URL. Secrets go through `src/secrets` only and are never returned or logged.
- **API shape**: success `{ data: ... }`, errors `{ error: { id, name, detail } }`. Writes accept
  `Idempotency-Key`.
- **Branding**: the app is "Budget" with its own icon. Never use the source app's name, logo or art in code,
  CSS, HTML or SVG.
- **Real data** (balances, payees, amounts) never goes into code, fixtures, screenshots or commit messages.

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
checked first, in every phase. After each finished phase the script prints a line `PHASE_SECONDS <step>=<s> ...`
(gate: `checks`, `e2e`; release: `build`, `resources`, `migrations`, `deploy`, `smoke`; a skipped step is `0`),
and after a release `Live: <url>` and `DEPLOY_SHA=<full sha>`. `DEPLOY_DRY_RUN=1` prints `DRY: ...` instead of
running the gate or calling Cloudflare.

### Scripts

- `bash scripts/migrations-pending.sh`: read-only. Needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  Prints the file name of each migration not yet applied to the remote `budget-db`, one per line, nothing when
  none are pending (all of them when the database does not exist yet). Exit 0 when it can tell; 1 with a message
  on stderr when it cannot; 2 for a missing variable.
- `bash scripts/live-test-plans.sh <command>`: manages test plans (name starts with `live.test_prefix`, `ZZ-TEST`)
  and nothing else; only calls `/api/v1/budgets`. Needs `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
  - `list`: `<id><TAB><name>` per test plan
  - `create '<name>'`: prints the new id; a name without the prefix is refused (exit 2)
  - `delete <id>`: re-reads the plan; prints `deleted <id>`; an unprefixed plan is refused (exit 3)
  - `purge`: prints `deleted <n> remaining <m>`; exit 0 only when `m` is 0; more than 50 matches is refused (exit 3)
  - Local testing: `LIVE_TEST_PLANS_BASE_URL=http://127.0.0.1:<port>` targets `pnpm dev` (which signs requests
    itself); add `LIVE_TEST_PLANS_LOCAL_JWT=1` for the e2e server. No Access headers are sent to a local server.

Live flow tests reach the clone with `scripts/access-browser.mjs`.
