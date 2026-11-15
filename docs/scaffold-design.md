# Scaffold design: "Budget" skeleton on Cloudflare

Status: planned 2026-11-15. Brief: the Lead's scaffold brief (no ticket). Spec: `docs/scaffold-spec.md`.

## 1. Feature

A runnable skeleton for "Budget", a single-user YNAB replacement at `https://budget.doxen.dev`, behind
Cloudflare Access, API first. It contains:

- the pnpm monorepo;
- the Access JWT check in front of every request;
- the secrets module;
- one vertical slice (plans = `budgets`: table, service with `change_log`, REST, OpenAPI, MCP tools, UI);
- the app shell (dark sidebar layout);
- `pnpm check` / `pnpm dev` / `pnpm e2e`;
- `scripts/deploy.sh`;
- `clone.profile.json`;
- `docs/conventions.md`.

The goal beyond "it runs": later Builds add a resource by **adding files only**.

## 2. Source

The source was studied live in the Test Budget plan only. Notes and screenshots:
`/workspace/scratch/source/scaffold-shell/notes.md` (screenshots `01-…08-*.png` and `theme-dark-vars.txt` in the
same folder). Stack and API research with URLs: `/workspace/scratch/research/scaffold-notes.md`.

What the shell must reproduce (dark theme; in YNAB the theme is an account display setting, not the OS scheme):

- **Layout:** `sidebar (260px incl. 1px right border rgba(255,255,255,.08)) | main (flex, #0C0D22)`. No
  document scroll; panes scroll.
- **Sidebar** `#121330`, font Figtree 16px, white text. Top to bottom:
  1. Plan-name button 243×46 at (8,8), radius 8, hover `#1B1D48`: 24px logo, plan name 18px/600, caret 12px.
     The source shows the account email as a second line; the clone omits it (no user endpoint in scope).
  2. Nav list from y=62: "Plan", "Reflect", "All Accounts". Rows are 40px with a 4px gap, links 243px wide
     at x=8, radius 6, 24px icon at x=16, label 16px/500 at x=48. Hover `#1B1D48`, active `#1C1F58`.
  3. Empty accounts card: `#1B1D48`, padding 16, radius 5, h5 "No Accounts" 16px/500, then p 14px/500
     `rgba(255,255,255,.7)` "You can't plan without adding accounts first. How about adding one now?".
  4. "Add Account" button: 224×28 at x=16, radius 8, bg `rgba(255,255,255,.15)`, hover `.2`, 14px/500, 12px
     plus-circle icon.
- **Plan menu**: a dropdown right below the button, 243px wide, `#1F2038`, radius 4, shadow
  `0 16px 64px rgba(0,0,0,.2)`. Items are 33px tall, padding 8/12, 14px/500, hover `#292B3D`. The source's first
  two items are "New Plan" and "Open Plan ›" (submenu of plans); the rest is out of scope.
- **Page headers**: `#15172D`. Plan header is 88px tall; Reflect has a 64px tab bar; All Accounts has a 61px
  title strip with "All Accounts" at 24px/700.
- **Tokens**:
  - Main backgrounds: `--backgroundPrimary #0C0D22`, `--backgroundSecondary #15172D`, `--backgroundTertiary #1F2038`.
  - Labels: `--labelPrimary #fff`, `--labelSecondary #C4C5CF`, `--labelTertiary #9B9CAA`.
  - Actions: `--actionPrimary #7583FF`, `--buttonPrimaryBackground #545BFE`.
  - Inputs: `--inputBackground #3C3E53`, `--inputBorder #727484`.
  - Status: `--statusPositive #77BA21`, `--statusNegative #BF2E3B`.
- **URLs**: `/<planId>/budget/<YYYYMM>`, `/<planId>/reflect`, `/<planId>/accounts`. Titles follow
  `<Page> | <Plan> | YNAB`.

## 3. Approach

### 3.1 One Vite project serves web and Worker

`apps/web/vite.config.ts` uses `@cloudflare/vite-plugin` v1 with `configPath: "../worker/wrangler.jsonc"`:

- `vite dev` serves the SPA and runs the Worker in workerd on **one port**;
- `vite build` emits `dist/client` plus `dist/budget/wrangler.json`;
- `vite preview` runs that production bundle locally.

So the profile's api ports equal its web ports: dev 5173, e2e 4173.

The assets config is `{ binding: "ASSETS", not_found_handling: "single-page-application", run_worker_first:
true }`. Every request, static assets and Vite's dev modules included, goes through the Worker's Access
middleware first. Then the Worker hands non-API paths to `env.ASSETS.fetch`.

### 3.2 Registration by file convention

The Worker and web code are processed by Vite, so `import.meta.glob(..., { eager: true })` collects:

| Glob | Module contract | Collected by |
|---|---|---|
| `apps/worker/src/routes/*.ts` | `default: OpenAPIHono<AppEnv>` (paths relative to `/api/v1`) | `src/app.ts` |
| `apps/worker/src/mcp/tools/*.ts` | `tools: McpToolDef[]` | `src/mcp/server.ts` |
| `apps/web/src/pages/*.tsx` | `page: { path, element }` | `src/router.tsx` |

Keys are sorted for determinism. Shared packages have **no barrel file**: `package.json` `exports: {"./*":
"./src/*.ts"}`, so consumers import `@budget/schema/budgets` and `@budget/core/money`.

Drizzle tables live one per file in `apps/worker/src/db/schema/<table>.ts` and are imported directly by their
repository (no relational-query schema object).

This must be proven in **dev** (curl through `pnpm dev`) and in the **production bundle** (e2e runs `vite
preview`). If either fails, fall back to the smallest hand-edited index per kind (`routes/index.ts`,
`mcp/tools/index.ts`, `pages/index.ts`), add those to `paths.always_overlap`, and say so in the report.

### 3.3 Migrations

Migrations are hand-written SQL in `apps/worker/migrations/<UTC YYYYMMDDHHMMSS>_<name>.sql`. Wrangler orders
them by the numeric prefix and tracks applied files by name, so there is no journal file. Drizzle is used for
queries only, and `drizzle-kit` is not used for migrations (its `meta/_journal.json` would be a shared file).
A Worker test applies all migrations, then checks each Drizzle table's columns against `PRAGMA table_info`.

This Build's migrations: `20261115000000_budgets_change_log.sql`, `20261115000100_secrets.sql`,
`20261115000200_idempotency_keys.sql`.

### 3.4 Access, actor, local identity

`middleware/access.ts` runs first on every request:

- **Token:** taken from `Cf-Access-Jwt-Assertion`, else the `CF_Authorization` cookie.
- **Production:** `jose.jwtVerify` against `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, with issuer
  `https://${ACCESS_TEAM_DOMAIN}` and audience `ACCESS_AUD`.
- **Fail closed:** a missing var, a missing or invalid token → `403 {error:{id:"403",name:"forbidden"}}`.
  Requests to `/api/*` and `/mcp` get JSON; other requests get `text/plain`.
- **Actor** (`c.set("identity", {kind, actor, email?})`):
  - a user token (`email`) → `user:<email>`;
  - a service token (`common_name` = client id, empty `sub`) → `service:<name>`, where `name` comes from the
    var `ACCESS_SERVICE_TOKENS` (JSON `{ sha256hex(client_id): name }`, written by deploy), else
    `service:unknown`;
  - MCP calls prefix the actor: `mcp:user:<email>`.
- **Local:** only when `ENVIRONMENT === "local"` *and* `LOCAL_JWT_SECRET` is set, an HS256 token with issuer
  `budget-local` is also accepted. `wrangler.jsonc` top-level vars set `ENVIRONMENT: "production"`, so a deploy
  can never be local.
  - `apps/worker/.dev.vars` (gitignored) is generated by `scripts/dev-vars.mjs` with `ENVIRONMENT=local`, a
    random `LOCAL_JWT_SECRET` and a random `SECRETS_ENCRYPTION_KEY`. No secret is committed.
- **`pnpm dev` = signed in:** a dev-only Vite plugin (`apps/web/dev/local-access.ts`, `apply: "serve"`, listed
  before `cloudflare()`) plays Access. It adds a locally signed `Cf-Access-Jwt-Assertion` (email
  `dev@localhost`) to every dev request. `vite preview` has no such plugin, so e2e proves that bare requests
  are refused and signs in with a `CF_Authorization` cookie.

### 3.5 Slice pattern (the worked example)

The request path is `route → service(actor) → repository → db.batch`:

- **Route:** validates with zod schemas from `@budget/schema/budgets`, reads `identity`, calls the service.
- **Service:** owns the use case. Each mutation builds its row statement(s) plus
  `history.changeLogInsert(db, {budgetId, actor, action, entityType, entityId, before, after})` and runs them
  as **one `db.batch`**.
- **Repository:** builds Drizzle statements and reads.
- **MCP tool:** calls the same service with actor `mcp:<identity actor>`.
- **Web:** calls only `/api/v1` through `api/client.ts` and a per-resource module `api/budgets.ts`. Both use the
  same zod schemas, so the client's types derive from the route definitions.

### 3.6 Other choices

- **API shape** follows YNAB's public API:
  - success `{ "data": { ... } }`; errors `{ "error": { "id", "name", "detail" } }`;
  - money in integer milliunits, dates ISO 8601, a month is its first day.
- **Idempotency:** `middleware/idempotency.ts` applies to POST/PATCH/PUT/DELETE under `/api/v1` that carry
  `Idempotency-Key`. The key is stored per (actor, key) with a request hash for 24 h:
  - same key, same hash → replay the stored status and body, with `Idempotent-Replayed: true`;
  - same key, different hash → `422 idempotency_key_reused`;
  - 5xx responses are not stored.
- **MCP:**
  - `app.all("/mcp", …)` builds `createMcpHandler(serverFactory, { route: "/mcp", allowedHostnames:
    [PUBLIC_HOSTNAME], authContext: { props: { actor } } })` and calls it with
    `(c.req.raw, c.env, c.executionCtx)`;
  - tools read the actor through `getMcpAuthContext()`;
  - imports come from `agents/mcp/server` and `@modelcontextprotocol/server`, never `agents/mcp`.
- **Durable Object** `PlaidItemSync` (binding `PLAID_ITEM_SYNC`, `migrations: [{tag:"v1",
  new_sqlite_classes:["PlaidItemSync"]}]`): a stub whose `fetch` answers 501.
- **Cron:** `triggers.crons: ["0 3 * * *"]` with a no-op `scheduled` handler.
- **R2:** binding `FILES`, `bucket_name: "budget-files"`.
- **D1:** binding `DB`, `database_name: "budget-db"`. No `database_id` is committed; deploy fills it into the
  built config.
- **Routing:** `workers_dev: false`, `preview_urls: false`, custom domain `budget.doxen.dev`, `nodejs_compat`.

## 4. What changes

Everything is new. The interfaces are in the spec.

- **Packages:**
  - `packages/core` (`money.ts`, `month.ts`);
  - `packages/schema` (`common/money.ts`, `common/dates.ts`, `common/envelope.ts`, `budgets.ts`).
- **Worker** (`apps/worker`): `app.ts`, `index.ts`, `env.ts`, middleware (`access.ts`, `idempotency.ts`,
  `errors.ts`), `db/client.ts`, `db/schema/*`, `history/change-log.ts`, `secrets/*`, `repositories/budgets.ts`,
  `services/budgets.ts`, `routes/{budgets,health}.ts`, `mcp/{server.ts,tools/budgets.ts}`,
  `durable/plaid-item-sync.ts`, `scheduled.ts`, 3 migrations, tests.
- **Web** (`apps/web`):
  - shell (`AppShell`, `Sidebar`, `PlanMenu`, `NewPlanDialog`, `AddAccountDialog` placeholder, `tokens.css`,
    `icons.tsx`);
  - `router.tsx`;
  - pages (`home`, `plan`, `reflect`, `accounts`);
  - `api/{client,budgets}.ts`;
  - dev plugin `dev/local-access.ts`;
  - own logo `public/favicon.svg`.
- **Root:**
  - `package.json` scripts, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.config.ts`
    (projects), `playwright.config.ts`, `e2e/*`;
  - scripts: `scripts/{deploy.sh,lib/cf.sh,dev-vars.mjs,db-migrate-local.sh,e2e-serve.sh,local-jwt.mjs,
    access-browser.mjs}` and `scripts/test/*`;
  - docs: `docs/conventions.md`, plus a `.gitignore` update.
- **`clone.profile.json`** (updated in this commit):
  - `ports.dev_api` = 5173 and `ports.e2e_api` = 4173 (single Vite server);
  - `scripts/test/**` added to `paths.tests`;
  - final `always_overlap` / `shared_modules` / `sensitive`;
  - `live.*` (test space, prefix `ZZ-TEST`, never-touch list, Access header variable names, the browser
    helper, the deploy command).
- **User-visible:**
  - `/` redirects to the last used plan (localStorage `budget.lastPlanId`), else the first plan. With no plans,
    the home page shows "Create your first plan".
  - Plan routes: `/:budgetId/budget`, `/:budgetId/reflect`, `/:budgetId/accounts`. The three pages are
    placeholders: a page header in the source's shape and an empty body.
  - Titles: `<Page> | <Plan> | Budget`.

## 5. Downstream effects

- Every later Build follows `docs/conventions.md`. New resources add files under `routes/`, `services/`,
  `repositories/`, `db/schema/`, `mcp/tools/`, `pages/`, `packages/schema/src/`, plus one migration. The only
  shared hot spots are listed in `paths.always_overlap` and `paths.shared_modules`.
- The first Deploy Build runs `scripts/deploy.sh` once credentials exist; §8 lists what only it can verify.
- Flow-test children reach the live clone with `scripts/access-browser.mjs` (header injection; cookie when
  Access issues one).

## 6. Out of scope

- Accounts, categories, transactions, Plaid logic, history browsing UI, `GET /user`.
- The plan menu's other items, sidebar collapse/resize, Bank Connections, referral/Share & Earn.
- The email line under the plan name, and the Add Account dialog contents (an empty titled modal only).
- `.github/workflows` (never).

## 7. Acceptance

Run with the profile commands. "Token" means a locally signed token from `scripts/local-jwt.mjs`.

1. **Clean check.** Start from a fresh clone with no credentials in the environment. Run
   `pnpm install --frozen-lockfile && pnpm check`. It exits 0, and the output shows biome, typecheck, vitest
   (core, schema, worker, scripts projects) and the web build all ran.
2. **Dev server.** Run `pnpm dev`, then `curl -s localhost:5173/api/v1/health`. The answer is `200
   {"status":"ok","deploy_sha":"local"}`. `curl localhost:5173/` returns the SPA HTML. Opening
   `http://localhost:5173/` in a browser shows the shell, signed in.
3. **Glob registration in dev.** With `pnpm dev` running, `curl -s localhost:5173/api/v1/openapi.json | jq
   '.paths|keys'` lists `/api/v1/budgets`, `/api/v1/budgets/{id}` and `/api/v1/health`. A POST to `/mcp` with
   `tools/list` lists `create_budget` and `list_budgets`.
4. **Access refusal** (e2e, production bundle). Bare requests to `/`, `/index.html`, `/api/v1/health`,
   `/api/v1/budgets` and `/mcp` all return 403. A token signed with the wrong secret returns 403. A valid token
   returns 200.
5. **Production config refuses the local token** (Worker test). The app is called with `ENVIRONMENT:
   "production"` and a valid local HS256 token: 403. A JWKS-signed RS256 token with the right `iss` and `aud`
   returns 200. Wrong `aud` returns 403. Missing `ACCESS_AUD` returns 403.
6. **REST slice.**
   - POST `/api/v1/budgets {"name":"ZZ-TEST A"}` returns 201 `{data:{budget:{id,name,created_at,
     last_modified_on}}}`.
   - GET the list: it contains the plan. PATCH the name: 200 with the new name.
   - DELETE: 200, then GET by id returns 404 `{error:{id:"404",name:"not_found"}}`, and the plan is gone from
     the list.
   - An empty name returns 400 with the error envelope.
7. **change_log** (Worker test). After create, update and delete, `change_log` has 3 rows for the plan with
   actions `create`, `update`, `delete`, the token's actor, and before/after JSON (null before on create).
   Making the change_log insert fail makes the plan insert absent too (batch atomicity).
8. **Idempotency.** Two POSTs with `Idempotency-Key: k1` and the same body give the same id and one plan; the
   second carries `Idempotent-Replayed: true`. The same key with a different body returns 422.
9. **MCP.** Use `@modelcontextprotocol/client` against `/mcp` with the token. `list_budgets` returns the
   plans. `create_budget {"name":"ZZ-TEST M"}` creates one, which REST GET then shows. Its `change_log` actor
   starts with `mcp:`.
10. **Secrets** (Worker test). After `set("plaid_x","v")`, the stored ciphertext ≠ "v" and doesn't contain it,
    and `get` returns "v". A wrong key throws. Flipping one ciphertext byte throws. Using the record under
    another name fails (AAD). No route or tool exposes the table.
11. **Shell** (e2e). With a token cookie and at least one plan, `/` redirects to `/<id>/budget`:
    - the sidebar shows the plan name, "Plan" (active), "Reflect", "All Accounts", "No Accounts" and
      "Add Account";
    - clicking Reflect and All Accounts changes the URL, the active item and `document.title`
      (`Reflect | ZZ-TEST… | Budget`);
    - Add Account opens a modal titled "Add Accounts" that closes with ×.
12. **Create and switch plans** (e2e).
    - Plan menu → New Plan → name "ZZ-TEST B" → Create: the URL is `/<newId>/budget` and the sidebar shows
      "ZZ-TEST B".
    - Plan menu → Open Plan → "ZZ-TEST A": the URL and name switch back.
    - After a reload, `/` opens the last used plan.
13. **No YNAB branding.** `grep -RniE 'ynab|you need a budget' apps packages --include=*.{ts,tsx,css,html,svg}`
    finds nothing, except the API-shape comment in `packages/schema/src/common/envelope.ts`. The favicon and
    logo are the clone's own.
14. **Compare: shell vs source.**
    - Source state: YNAB plan "Test Budget", Plan page, dark display theme (as set), viewport 1440×900, sidebar
      expanded, no menus open.
    - Clone: plan "ZZ-TEST A", `/<id>/budget`, 1440×900.
    - Match: the sidebar width (260), background `#121330`, element order (plan button → Plan/Reflect/All
      Accounts → accounts card → Add Account), nav row geometry (40px rows, 4px gap), active and hover colours,
      main background `#0C0D22` and the header band `#15172D`, and the Figtree font.
    - Expected differences: no email line; no Bank Connections, referral or Share & Earn; placeholder page
      bodies.
15. **Compare: plan menu.** Same states as 14, with the plan menu open on both. The dropdown sits under the
    button with the same width, `#1F2038` background, 33px items and `#292B3D` hover. The first items are "New
    Plan" and "Open Plan ›"; the clone has nothing else.
16. **Deploy refusals.**
    - With none of the 7 deploy variables, `bash scripts/deploy.sh` exits non-zero before the gate and names
      `CLOUDFLARE_API_TOKEN`, then all the other missing ones.
    - `scripts/test/deploy.test.ts` sets sentinel values and runs `DEPLOY_DRY_RUN=1 bash scripts/deploy.sh`. It
      exits 0, prints the release steps 1–8 in order (each mutating call shown as `DRY: <METHOD> <path>` or
      `DRY: wrangler …`), and no sentinel value appears in stdout or stderr.
17. **No GitHub Actions**: `.github/workflows` does not exist.

## 8. Unverified until the first Deploy (to be repeated in the report)

- The Access application, its reusable policies and Managed OAuth through the API.
- Whether Managed OAuth and Service Auth coexist on one app. `deploy.sh` tries the combined shape. If the API
  rejects it, or `ACCESS_MCP_SEPARATE_APP=1` is set, it creates a second app for `budget.doxen.dev/mcp` with
  Managed OAuth plus the Allow policy.
- The DNS A-record removal, and the custom domain attach.
- Remote migrations, the Time Travel bookmark, `--secrets-file` on first deploy, and editing
  `dist/budget/wrangler.json` (for `database_id`).
- The smoke test, and whether Access issues a `CF_Authorization` cookie to service tokens: strict
  service-token mode, which is the default for new orgs, does not.
- Token permissions:
  - Account: Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, Access: Apps and Policies Edit, Access:
    Service Tokens Read.
  - Zone `doxen.dev`: DNS Edit, Workers Routes Edit, Zone Read.

## Manifest

touches: [package.json, pnpm-lock.yaml, pnpm-workspace.yaml, tsconfig.base.json, tsconfig.json, biome.json, vitest.config.ts, playwright.config.ts, .gitignore, .npmrc, clone.profile.json, packages/**, apps/**, e2e/**, scripts/**, docs/README.md, docs/conventions.md, docs/scaffold-design.md, docs/scaffold-spec.md]
shared: [packages/core/src/** (creates the money and month primitives), packages/schema/src/common/** (creates the money/date/envelope schemas), apps/worker/src/app.ts (creates the app and glob registration), apps/worker/src/middleware/** (creates Access, idempotency and error middleware), apps/worker/src/secrets/** (creates the secrets module), apps/worker/src/db/client.ts (creates the Drizzle client), apps/worker/src/history/** (creates the change_log writer), apps/worker/src/mcp/server.ts + mcp/types.ts (create the MCP server factory and tool contract), apps/web/src/api/client.ts (creates the API client), apps/web/src/shell/** + apps/web/src/router.tsx (create the app shell, tokens and page registration)]
migrations: 3
