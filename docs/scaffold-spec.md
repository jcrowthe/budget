# Scaffold spec

Design: `docs/scaffold-design.md` (§ references point there). Research with URLs:
`/workspace/scratch/research/scaffold-notes.md`. Do the tasks in order and commit after each green task.

## Pins (exact versions)

The box runs **Node 22.14**, so react-router stays on 7.x (8.x needs ≥ 22.22).

- **Cloudflare:** wrangler 4.162.0, @cloudflare/vite-plugin 1.69.1 (v1, not the v2 beta),
  @cloudflare/vitest-plugin 1.8.2 (replaces the deprecated vitest-pool-workers), @cloudflare/workers-types
  5.20261115.1.
- **Build/test:** vite 8.3.8, @vitejs/plugin-react 6.3.0, vitest 5.1.0, @playwright/test 1.65.1, @biomejs/biome
  2.6.8, typescript 6.0.3.
- **Worker:** hono 4.13.18, @hono/zod-openapi 1.6.3, zod 4.6.7, jose 6.2.17, drizzle-orm 0.45.4.
- **MCP:** agents 0.33.0, @modelcontextprotocol/server 2.4.0 and @modelcontextprotocol/client 2.4.0 (exact, as
  agents requires).
- **Web:** react / react-dom 19.3.1 (+ @types 19.3.0), react-router 7.18.5, @tanstack/react-query 5.107.1,
  @fontsource-variable/figtree.

If a pin fails, use the nearest working version and give the reason in your report.

## Task 1: Workspace

- **Files:** `package.json` (`packageManager: "pnpm@11.24.0"`, `engines.node: ">=22.12"`),
  `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `tsconfig.base.json` (strict, `moduleResolution: "bundler"`,
  ES2022, `noUncheckedIndexedAccess`), `tsconfig.json`, `biome.json` (ignore `dist`, `.wrangler`,
  `.e2e-state`, `.screenshots`, reports), `.npmrc`. Add `*.local` to `.gitignore`.
- **Scripts:**
  - `check` = `biome check . && pnpm -r typecheck && vitest run && pnpm --filter @budget/web build`;
  - `dev` = `node scripts/dev-vars.mjs && bash scripts/db-migrate-local.sh .wrangler/state && pnpm --filter
    @budget/web exec vite --port 5173 --strictPort`;
  - `e2e` = `playwright test`;
  - `deploy` = `bash scripts/deploy.sh`.
- **Packages:** `@budget/core`, `@budget/schema`, `@budget/worker`, `@budget/web`, each with `typecheck: tsc
  --noEmit`. Core and schema have `"exports": {"./*": "./src/*.ts"}` and **no index barrel**.

## Task 2: core and schema

- **`core/src/money.ts`** (`Milliunits` = integer): `toMilliunits("12.34")` = 12340 (more than 3 decimals
  throws); `fromMilliunits(m)` (exactly 3 decimals); `addMilliunits(...m)`; `assertMilliunits(n)` (safe
  integer); `formatMoney(m, {currency, locale})`.
- **`core/src/month.ts`** (`Month` = `YYYY-MM-01`): `toMonth(isoDate)`, `currentMonth(now)` (UTC),
  `addMonths(m, n)`, `monthKey(m)` → `"YYYYMM"`, `isMonth(s)`.
- **`schema/src/common/money.ts`:** `Milliunits = z.number().int().safe()`.
- **`schema/src/common/dates.ts`:** `IsoDate`, `IsoDateTime`, and `Month` (an IsoDate whose day is 01).
- **`schema/src/common/envelope.ts`:** `ErrorBody = {error:{id,name,detail}}` and `dataEnvelope(s)` =
  `{data: s}`, with a one-line comment that the shape follows YNAB's public API (the only allowed mention,
  case 13).
- **`schema/src/budgets.ts`:** `Budget {id: uuid, name, created_at, last_modified_on}`, `BudgetCreate {name:
  trim, 1–100}`, `BudgetUpdate = BudgetCreate.partial()`, `BudgetResponse = data{budget}`,
  `BudgetListResponse = data{budgets[]}`. Use `z` from `@hono/zod-openapi` where `.openapi()` is needed.
- **Tests:** `packages/core/test/{money,month}.test.ts` and `packages/schema/test/budgets.test.ts` (too many
  decimals, a year rollover, `Month` rejects `2026-11-15`).

## Task 3: Worker config and entry

- **`apps/worker/wrangler.jsonc`:**
  - exactly design §3.1 and §3.6, with `name: "budget"`, `main: "./src/index.ts"`, `compatibility_date:
    "2026-11-01"`, D1 `{binding: "DB", database_name: "budget-db", migrations_dir: "migrations"}` (no id);
  - vars `ENVIRONMENT: "production"`, `PUBLIC_HOSTNAME: "budget.doxen.dev"`, `ACCESS_TEAM_DOMAIN: ""`,
    `ACCESS_AUD: ""`, `ACCESS_SERVICE_TOKENS: "{}"`, `DEPLOY_SHA: "unknown"`.
- **`src/env.ts`:**
  - `Env` holds `DB`, `FILES`, `ASSETS`, `PLAID_ITEM_SYNC`, those vars, plus optional `LOCAL_JWT_SECRET` and
    `SECRETS_ENCRYPTION_KEY`;
  - `Identity = {kind: "user" | "service"; actor: string; email?: string}`;
  - `AppEnv = {Bindings: Env; Variables: {identity: Identity}}`.
- **`src/index.ts`:** `export default {fetch: createApp().fetch, scheduled}` and `export {PlaidItemSync}`.
- **Stubs:** `src/durable/plaid-item-sync.ts` (`extends DurableObject<Env>`, whose `fetch` returns 501);
  `src/scheduled.ts` (no-op, with a TODO naming the backup and scheduled-transaction Builds).

## Task 4: Migrations, tables, db, history

- **`migrations/20261115000000_budgets_change_log.sql`:**
  - `budgets(id TEXT PK, name TEXT NOT NULL, created_at, updated_at TEXT NOT NULL, deleted_at TEXT)`;
  - `change_log(id TEXT PK, budget_id TEXT, actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN
    ('create','update','delete')), entity_type, entity_id TEXT NOT NULL, before_json, after_json TEXT,
    created_at TEXT NOT NULL)`;
  - index on `(budget_id, created_at)`.
- **`migrations/20261115000100_secrets.sql`:** `secrets(name TEXT PK, ciphertext BLOB, iv BLOB, key_version
  INTEGER, created_at, updated_at)`, all NOT NULL.
- **`migrations/20261115000200_idempotency_keys.sql`:** `idempotency_keys(actor, key, method, path,
  request_hash, status INTEGER, response_body, created_at, PRIMARY KEY (actor, key))`.
- **Drizzle:** `src/db/schema/{budgets,change-log,secrets,idempotency-keys}.ts`, one table each.
  `src/db/client.ts`: `getDb(env)` and `type Db`.
- **`src/history/change-log.ts`:** `changeLogInsert(db, {budgetId, actor, action, entityType, entityId, before,
  after})` returns an **unexecuted** insert to put in `db.batch`.
- **Verify:** `apps/worker/test/schema-drift.test.ts` checks that every Drizzle table's columns equal
  `PRAGMA table_info`.

## Task 5: Middleware

- **`src/middleware/access.ts`:** `accessMiddleware(opts?: {getKey?})`, `identify(token, env, getKey?) →
  Identity | null`, `readToken(req)` (header, then cookie). Behaviour per design §3.4. JWKS via
  `createRemoteJWKSet` on `https://<team>/cdn-cgi/access/certs`, cached per team (`team` = `ACCESS_TEAM_DOMAIN`
  without scheme or trailing `/`). Local path: HS256, iss and aud `budget-local`, only when `ENVIRONMENT ===
  "local"` and `LOCAL_JWT_SECRET` is set. Never log a token.
- **`src/middleware/errors.ts`:** `apiError(c, status, name, detail)`; `onError` (zod → 400, `HTTPException`
  → its status, else 500 `internal_error`, logging no request data); `notFoundApi` (JSON 404).
- **`src/middleware/idempotency.ts`:** per design §3.6. `request_hash` = sha256(method + path + body). Store
  after the handler if the status is below 500. Rows older than 24 h count as absent.
- **Verify, `test/access.test.ts`:** no token → 403; wrong HS secret → 403; a local token with `ENVIRONMENT:
  "production"` → **403 (the required prod-refusal test)**; RS256 via `createLocalJWKSet` with the right
  iss/aud → `user:<email>`, wrong aud → 403; `common_name` → `service:<name>`; production without
  `ACCESS_AUD` → 403; `/index.html` without a token → 403.
- **Verify, `test/idempotency.test.ts`:** case 8.

## Task 6: Secrets

- **`src/secrets/crypto.ts`:** `importKey(b64)` (exactly 32 bytes, AES-GCM); `seal(key, name, text) →
  {ciphertext, iv}` (12-byte random IV, AAD = utf8(name)); `open(key, name, ciphertext, iv)`.
- **`src/secrets/index.ts`** is the only user of the table: `getSecret(env, name)`, `setSecret(env, name,
  value)`, `deleteSecret(env, name)`.
  - `CURRENT_KEY_VERSION = 1`; `keyFor(env, version)` maps version 1 to `SECRETS_ENCRYPTION_KEY`.
  - A missing key throws `SecretsUnavailable`, which never includes the value.
- **Verify:** `test/secrets.test.ts` covers case 10.

## Task 7: Budgets slice

- **`src/repositories/budgets.ts`:** `listActive(db)`, `findActive(db, id)`, `insertStmt`, `updateStmt`,
  `softDeleteStmt`. The `*Stmt` functions return unexecuted statements.
- **`src/services/budgets.ts`:** `listBudgets(env)`, `getBudget(env, id)` (throws `NotFound`), and
  `createBudget(env, actor, input)`, `updateBudget(env, actor, id, patch)` (reads `before` first),
  `deleteBudget(env, actor, id)`, each running **one** `db.batch([row stmt, changeLogInsert(...)])`.
  `toApi(row)` maps `updated_at` → `last_modified_on`.
- **`src/routes/budgets.ts`:** `export default new OpenAPIHono<AppEnv>()` with `createRoute` for the 5
  operations (tag `Budgets`, schemas from `@budget/schema/budgets`, 400/403/404 as `ErrorBody`, POST → 201).
- **`src/routes/health.ts`:** `GET /health` → `{status: "ok", deploy_sha}`.
- **`src/app.ts`:** `createApp(opts?: {getKey?})`. The order inside:
  1. `use("*", accessMiddleware)`
  2. `use("/api/v1/*", idempotency())`
  3. mount every `import.meta.glob("./routes/*.ts", {eager: true})` default export at `/api/v1`, sorted by key
  4. `doc31("/api/v1/openapi.json", {openapi: "3.1.0", info: {title: "Budget API", version: "1"}})` with the
     apiKey header schemes `CF-Access-Client-Id` and `CF-Access-Client-Secret`
  5. `all("/mcp", mcpRoute)`
  6. `all("/api/*", notFoundApi)`
  7. `all("*", c => c.env.ASSETS.fetch(c.req.raw))`
- **Verify:**
  - `test/budgets.test.ts` covers cases 6 and 7. For atomicity, an exported test seam builds the batch with an
    action that violates the CHECK, and the test asserts no budget row exists.
  - `test/openapi.test.ts` checks the 3 paths are listed, which proves glob registration under vitest.

## Task 8: MCP

- **`src/mcp/types.ts`:** `McpToolDef = {name, description, inputSchema: ZodObject, run(input, {env, actor})}`.
- **`src/mcp/server.ts`:** `createServerFactory(env)` → `() => new McpServer({name: "budget", version: "1"})`
  registering every tool from `import.meta.glob("./tools/*.ts")` (export `tools`); tool actor = `"mcp:" +
  getMcpAuthContext()?.props.actor`; results `{content: [{type: "text", text: JSON}], structuredContent}`.
  `mcpRoute(c)` per design §3.6, `allowedHostnames` = `[PUBLIC_HOSTNAME]` (+ `localhost` when local). Import
  only from `agents/mcp/server` and `@modelcontextprotocol/server`; check the v2 `registerTool` signature.
- **`src/mcp/tools/budgets.ts`:** `list_budgets` → `{budgets}`; `create_budget {name}` → `{budget}`. Both call
  the services.
- **Verify:** `test/mcp.test.ts` sends JSON-RPC `initialize`, `tools/list` and `tools/call` (with `Accept:
  application/json, text/event-stream` and a local token). The tools are listed, the budget is created, and the
  actor starts with `mcp:user:`.

## Task 9: Test setup

- **`apps/worker/vitest.config.ts`:** `cloudflareTest(async () => ({wrangler: {configPath:
  "./wrangler.jsonc"}, miniflare: {bindings}}))`. Bindings: `TEST_MIGRATIONS` (`readD1Migrations`, from the
  package root), `ENVIRONMENT: "local"`, random `LOCAL_JWT_SECRET` and 32-byte `SECRETS_ENCRYPTION_KEY` per run,
  `ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com"`, `ACCESS_AUD: "test-aud"`, `DEPLOY_SHA: "test"`.
  `test/setup.ts` runs `applyD1Migrations`. `test/helpers.ts`: `localToken(claims)`, `call(path, init,
  envOverride?)` = `createApp().request(path, init, {...env, ...envOverride})`. If assets without `directory`
  break the plugin, stub `ASSETS` via `miniflare` and report it.
- **Root `vitest.config.ts`:** `test.projects` = unit (`packages/*/test/**/*.test.ts`), scripts
  (`scripts/test/**/*.test.ts`, timeout 60 s), and `"apps/worker/vitest.config.ts"`.

## Task 10: Local dev

- **`scripts/dev-vars.mjs`:** adds the missing keys to `apps/worker/.dev.vars` (0600), printing no values:
  `ENVIRONMENT=local`, `PUBLIC_HOSTNAME=localhost`, `ACCESS_TEAM_DOMAIN=local`, `ACCESS_AUD=budget-local`,
  `ACCESS_SERVICE_TOKENS={}`, `DEPLOY_SHA=local`, random 32-byte base64 `LOCAL_JWT_SECRET` and
  `SECRETS_ENCRYPTION_KEY`.
- **`scripts/local-jwt.mjs`:** `localToken({email = "dev@localhost", ttl = "12h"})` reads the secret from
  `.dev.vars`. As a CLI it writes only to `--out <file>`.
- **`scripts/db-migrate-local.sh <stateDir>`:** `wrangler d1 migrations apply budget-db --local -c
  apps/worker/wrangler.jsonc --persist-to <absolute stateDir>`. The path must be absolute, because the plugin
  and wrangler resolve relative paths differently (research §C.4).
- **`apps/web/dev/local-access.ts`:** `localAccess()` with `apply: "serve"`. `configureServer` calls
  `server.middlewares.use` **directly**, not in a returned hook, and sets `req.headers["cf-access-jwt-assertion"]`.
  The token is cached and refreshed hourly.
- **`apps/web/vite.config.ts`:** plugins `[react(), localAccess(), cloudflare({configPath:
  "../worker/wrangler.jsonc", persistState: {path: process.env.BUDGET_STATE_DIR ?? <repo>/.wrangler/state}})]`;
  `preview: {port: 4173, strictPort: true}`.
- **Verify:** cases 2 and 3 with `pnpm dev`; `bash /workspace/.exfab/bin/dev_server.sh` passes; then kill that
  process group.

## Task 11: Web app

- **Entry:** `index.html` (title "Budget", `/favicon.svg`); `src/main.tsx` (QueryClient + RouterProvider);
  `src/router.tsx` collects the glob `./pages/*.tsx` export `page: {path, element}` under a layout route with
  `<AppShell/>`.
- **`src/shell/`:** `tokens.css` (§2 colours as variables, `--sidebar-width: 260px`, `--nav-row: 40px`, radii,
  spacing 4/8/16/32, font `"Figtree Variable", "Helvetica Neue", Helvetica, Arial, sans-serif`; components use
  variables only), `global.css`, `icons.tsx` (own SVGs), `AppShell`, `Sidebar`, `PageHeader`, `PlanMenu` ("New
  Plan", "Open Plan ›" submenu of active plans with ✓ on the current one; Escape/outside click closes),
  `NewPlanDialog` (name, "Create Plan", then navigate), `AddAccountDialog` ("Add Accounts", ×, empty), and
  `useCurrentPlan` (reads `:budgetId`, stores `budget.lastPlanId`, sets the title `<Page> | <Plan> | Budget`).
- **`src/api/client.ts`:** `apiFetch(path: "/api/v1/...", {method, body, idempotencyKey, schema})` parses the
  response with the zod `schema` and throws `ApiError {status, id, name, detail}`.
- **`src/api/budgets.ts`:** CRUD functions (create sends `idempotencyKey: crypto.randomUUID()`), plus
  `useBudgets` and `useCreateBudget`.
- **`src/pages/`:** `home` (`/`: last used plan, else first, else a "Create your first plan" card), `plan`
  (`/:budgetId/budget`, 88px header with the month "Nov 2026" from `@budget/core/month`), `reflect` (64px
  header), `accounts` (61px header, "All Accounts" 24/700). An unknown plan shows "Plan not found" + link to `/`.
- **`public/favicon.svg`:** an own mark (a rounded square with a stylised "B").
- **Verify:** the web build; cases 11 and 12 by hand in dev.

## Task 12: e2e

- **`playwright.config.ts`:** `testDir: "e2e"`, `baseURL: "http://localhost:4173"`, chromium only,
  `globalSetup: "./e2e/global-setup.ts"`, and `webServer: {command: "bash scripts/e2e-serve.sh", url:
  "http://localhost:4173/api/v1/health", reuseExistingServer: false, timeout: 180000}` (a 403 counts as up).
  Install Chromium if it is missing.
- **`scripts/e2e-serve.sh`:** `rm -rf .e2e-state`, then `dev-vars`, then `db-migrate-local.sh .e2e-state`, then
  `BUDGET_STATE_DIR=$PWD/.e2e-state vite build`, then `exec vite preview` with the same variable.
- **`e2e/global-setup.ts`:** writes `.e2e-state/auth.json` (cookie `CF_Authorization=<localToken()>` for
  localhost). `e2e/support/auth.ts` exports `authHeaders()`.
- **Specs:** `access` (4), `api` (6, 8), `mcp` (9), `shell` (11), `plans` (12). Plans are named `ZZ-TEST
  <random>`; no spec assumes an empty database.
- **Verify:** `pnpm e2e`, and `pnpm e2e e2e/plans.spec.ts --repeat-each=3 --workers=1`.

## Task 13: Deploy

**`scripts/lib/cf.sh`:**

- `need VAR…` prints `Missing required environment variable: NAME` for **each** missing one, then exits 2.
- `cf_api METHOD PATH [JSON]` calls `https://api.cloudflare.com/client/v4`. The token goes through
  `curl -K <(printf 'header = "Authorization: Bearer %s"\n' …)`, never argv. If `.success` isn't true, it fails
  with `.errors[].message`.
- `run_wrangler` = `pnpm --filter @budget/worker exec wrangler`.
- With `DEPLOY_DRY_RUN=1`, mutating calls print `DRY: <METHOD> <path>` or `DRY: wrangler <subcommand>`, never
  values, and return a fake success. GETs return empty results.

**`scripts/deploy.sh`** runs with `set -euo pipefail` and `umask 077`, and traps the cleanup of temp files and
the worktree.

0. `need` the 7 variables (`live.deploy_env`); check that `pnpm`, `jq`, `curl` and `git` exist; set
   `DEPLOY_SHA=$(git rev-parse HEAD)`; warn if the tree is dirty.
1. **Gate:** `pnpm check && pnpm e2e`. In a dry run, print `DRY: gate`.
2. **Build:** `git worktree add --detach <tmp> $DEPLOY_SHA`, which is a separate worktree, so the main HEAD is
   untouched. Run `pnpm install --frozen-lockfile` and `vite build` there, with
   `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`. In a dry run, print `DRY: build`.
3. **Resources:** create D1 `budget-db` if `wrangler d1 list --json` lacks it, and record the uuid. Create R2
   `budget-files` if missing.
4. **Bookmark:** if the database pre-existed, print the bookmark from `wrangler d1 time-travel info budget-db
   --json`, with its restore command.
5. **Access** (`scripts/lib/access.sh`): find the service token by `client_id` (record `id`, name). Upsert
   reusable policies `budget-allow-owner` (allow, email `ACCESS_ALLOWED_EMAIL`) and `budget-service-auth`
   (`non_identity`, `service_token.token_id`). Upsert app `budget` (`GET apps?domain=budget.doxen.dev&exact=true`,
   then POST or full PUT): `self_hosted`, `destinations [{type: "public", uri: "budget.doxen.dev"}]`, both
   policies, `oauth_configuration {enabled, dynamic_client_registration {enabled, allow_any_on_localhost,
   allow_any_on_loopback}}`. If the API rejects that or `ACCESS_MCP_SEPARATE_APP=1`, the main app gets no OAuth
   and app `budget-mcp` (`budget.doxen.dev/mcp`) gets the allow policy + Managed OAuth; print the shape. `AUD`
   comes from the main app; `TEAM` is the team domain without scheme.
6. **DNS:** look up zone `doxen.dev` and the records named `budget.doxen.dev`. Delete a single `A` record in
   10/8, 172.16/12 or 192.168/16. Any other record, apart from the Worker's custom-domain record, stops the
   deploy, naming its type. This runs **before** the deploy, because a non-TTY deploy would silently overwrite
   DNS.
7. **Migrations and deploy:** `wrangler d1 migrations apply budget-db --remote -c apps/worker/wrangler.jsonc`;
   jq sets `.d1_databases[0].database_id` in the built `dist/<worker>/wrangler.json` (check the folder name);
   jq `--arg` writes `{SECRETS_ENCRYPTION_KEY}` to a 0600 temp file; then
   `wrangler deploy -c <built json> --secrets-file <tmp> --var DEPLOY_SHA:… --var ACCESS_AUD:… --var
     ACCESS_TEAM_DOMAIN:… --var ACCESS_SERVICE_TOKENS:<{sha256(client_id): name}>`.
8. **Smoke test** (retry up to 120 s): with the service headers (`-K`), `/api/v1/health` returns 200 with
   `deploy_sha == DEPLOY_SHA`; bare `/`, `/api/v1/health` and `/mcp` each return 302 to
   `*.cloudflareaccess.com`, 401 or 403. On failure print rollback hints (bookmark, `wrangler rollback`), exit 1.
9. Print `DEPLOY_SHA=<sha>` and `Live: https://budget.doxen.dev`.

**`scripts/access-browser.mjs`:**

- `attachAccess(context, {host = "budget.doxen.dev"})` uses `context.route` to add the two headers from the
  environment, for that host only.
- The CLI `storage-state <out.json>` calls health with the headers. If a `CF_Authorization` cookie comes back,
  it writes a 0600 storageState and exits 0; otherwise it exits 3 with "Access issued no cookie (strict
  service-token mode): use attachAccess()".
- It never prints values.

**`scripts/test/deploy.test.ts`:** case 16. Run once with an emptied environment (keep `PATH` and `HOME`), then as
a dry run with sentinel values, and assert no sentinel appears in any output.

## Task 14: Profile, docs, finish

- **`clone.profile.json`** has already been updated by the Architect. Change it only if reality differs (ports,
  paths, a registry that had to stay), and report the change.
- **`docs/conventions.md`** (≤ 8 KB): adding a resource end to end with budgets as the example (migration
  name, table, repository, service with batch + `changeLogInsert`, route/OpenAPI, schema, MCP tool, web api
  module, page, tests), the `paths.shared_modules` rule, and the product rules (milliunits, ISO dates, month =
  first day, actor, no YNAB branding, Access only). Add its line to `docs/README.md`.
- **Finish:** `pnpm check` and `pnpm e2e` are green; `.github/workflows` doesn't exist; the case-13 grep is
  clean; `git status` is clean.
- **Report:** registration in dev and in the preview bundle; deviating pins; any assets/vitest workaround; the
  Access shape; the design §8 list.
