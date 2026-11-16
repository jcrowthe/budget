# Bank connections spec (EXF-459)

Implements [bank-connections-design.md](bank-connections-design.md). Read `docs/conventions.md` first. Work in
order; run `pnpm check` after each task group. Never print, log, commit or put in a fixture a Plaid
credential or token; tests use five sentinels (`…-SENTINEL-1` … `-5`: client id, secret, access, public and link
token) and assert absence with
`expect(text.includes(x)).toBe(false)` (a failing `not.toContain` would print the value). `PLAID_PRODUCTION_SECRET`
is never read by any test or command of this Build.

## 1. Migrations (sensitive path)

Two files in `apps/worker/migrations/`, names from `date -u +%Y%m%d%H%M%S` at the time you write them (later than
every existing one; the first sorts before the second). Then `rm -rf .e2e-state`.

- `<ts1>_budgets_bank_environment.sql`:
  `ALTER TABLE budgets ADD COLUMN bank_environment TEXT NOT NULL DEFAULT 'production' CHECK (bank_environment IN ('production','sandbox'));`
- `<ts2>_bank_connections.sql`: `bank_connections` and `bank_accounts` with exactly the columns, `UNIQUE`s, the
  `environment` `CHECK` and the `REFERENCES bank_connections(id)` listed in the design's Data section (TEXT ids and
  dates, INTEGER balances, `NOT NULL` except the nullable fields named there and `mask`, `subtype`), plus index
  `bank_connections (environment, created_at)`.

Tables: `db/schema/budgets.ts` adds `bankEnvironment: text("bank_environment", { enum: [...] }).notNull()
.default("production")`; new `db/schema/bank-connections.ts` (`bankConnections`) and `db/schema/bank-accounts.ts`
(`bankAccounts`). Verify: `schema-drift.test.ts` passes.

## 2. Schemas (`packages/schema/src/`)

- `budgets.ts`: `BankEnvironment = z.enum(["production","sandbox"]).openapi("BankEnvironment")`. `Budget` adds
  `bank_environment: BankEnvironment`. `BudgetCreate` adds `bank_environment: BankEnvironment.optional()` (**no
  zod `.default`**: `BudgetUpdate = BudgetCreate.partial()` must leave it undefined on a name-only PATCH).
- `institutions.ts`: `Institution {institution_id, name, country, url: string|null, logo: string|null}`;
  `InstitutionSearchQuery {budget_id: uuid, query: string trim 1..100}`; `PopularQuery {budget_id}`;
  `InstitutionListResponse = dataEnvelope({institutions: Institution[]})`.
- `bank-connections.ts`: `BankAccount {id, bank_connection_id, name, mask|null, type, subtype|null,
  current_balance: Milliunits|null, available_balance: Milliunits|null, balance_updated_at|null}`;
  `BankConnection {id, display_id (/^[0-9a-f]{6}$/), environment: BankEnvironment, institution_id,
  institution_name, institution_logo|null, nickname, status: "connected", provider: "Plaid", last_synced_at|null,
  created_at, accounts: BankAccount[]}`; `LinkTokenCreate {budget_id}`; `LinkTokenResponse =
  dataEnvelope({link_token, expiration})`; `BankConnectionCreate {budget_id, public_token: 1..500,
  institution_id: 1..100, institution_name?: 1..200}`; `BankConnectionsQuery {budget_id}`;
  `BankConnectionResponse`, `BankConnectionListResponse`. Use `status: z.string()` and `provider: z.string()` if
  literals get in EXF-460's way; document values in `.openapi({description})`.
- `plaid-credentials.ts`: `PlaidCredentialsPut {environment: BankEnvironment, client_id: 1..100, secret: 1..200}`
  (both trimmed); `PlaidCredentialStatus {environment, configured: boolean, set_at: string|null}`;
  `PlaidCredentialPutResponse = dataEnvelope(PlaidCredentialStatus)`; `PlaidCredentialsResponse =
  dataEnvelope({credentials: PlaidCredentialStatus[]})`.

## 3. Budgets carry the environment

- `repositories/budgets.ts`: `updateStmt` patch type adds `bankEnvironment?`.
- `services/budgets.ts`: `toApi` adds `bank_environment`; `createBudget` sets `bankEnvironment:
  input.bank_environment ?? "production"`; `updateBudget` applies `bank_environment` like `name` (the `opened`
  shortcut applies only when **both** `name` and `bank_environment` are undefined). New
  `getBudgetEnvironment(env, budgetId): Promise<BankEnvironment>` (404 `NotFound("Plan")`).
- `routes/budgets.ts`: no change beyond schema types (check the OpenAPI doc shows the field).
- `mcp/tools/budgets.ts`: `create_budget` input adds `bank_environment: BudgetCreate.shape.bank_environment`.
- `scripts/live-test-plans.sh` `create`: body `jq -nc --arg n "$2" '{name: $n, bank_environment: "sandbox"}'`;
  update the header comment. `scripts/test/live-test-plans.test.ts`: assert the created plan reads back
  `bank_environment: "sandbox"`.
- Test `apps/worker/test/budgets-bank-environment.test.ts`: default `production` (POST, GET, list, MCP
  `list_budgets`); POST with `sandbox`; MCP `create_budget` with `sandbox`; PATCH to `sandbox` writes one
  `change_log` update with before/after values; PATCH `{name}` on a sandbox plan keeps `sandbox`; PATCH
  `{opened:true, bank_environment:"sandbox"}` changes it; invalid value → 400.

## 4. Plaid module (`apps/worker/src/plaid/`, new)

- `credentials.ts`: `credentialSecretName(e) = "plaid_credentials:" + e`; `storePlaidCredentials(env, e,
  {client_id, secret}) → set_at` (JSON `{client_id, secret, set_at}` via `setSecret`);
  `plaidCredentialStatus(env, e) → {environment, configured, set_at}` (`getSecret`, parse, return only `set_at`);
  `class PlaidNotSetUp extends Error` (message "Bank connections are not set up");
  `loadPlaidCredentials(env, e)`: throws `PlaidNotSetUp` when `e === "production" && env.ENVIRONMENT !==
  "production"`, when the secret is missing or unparsable, or on `SecretsUnavailable`.
- `client.ts`: `PLAID_BASE = {sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com"}`;
  `class PlaidApiError extends Error {status, errorCode: string|null, displayMessage: string|null}` (message =
  `Plaid <errorCode ?? status>`, never request data); `plaidFor(env, e) → Promise<{environment, post<T>(path,
  body): Promise<T>}>`. `post` uses `fetch(PLAID_BASE[e] + path, {method:"POST", headers: {"Content-Type":
  "application/json", "PLAID-CLIENT-ID", "PLAID-SECRET", "Plaid-Version": "2020-09-14"}, body, signal:
  AbortSignal.timeout(15000)})`; non-2xx → parse `{error_code, display_message}` → `PlaidApiError`; network/abort →
  `PlaidApiError(status 0)`. `linkTokenRequest(e, publicHostname)` (pure, exported for tests): `{client_name:
  "Budget", language: "en", country_codes: ["US"], products: ["transactions"], transactions: {days_requested:
  730}, user: {client_user_id: "budget-owner"}}` plus `redirect_uri: "https://" + publicHostname + "/plaid/oauth"`
  only when `e === "production"`. No `webhook` key, ever.
- `amounts.ts`: `plaidToMilliunits(n: number|null|undefined): number|null`. `null`/`undefined` → `null`;
  non-finite → `RangeError`. `s = String(n)`; if it contains `e`/`E`, use `n.toFixed(6)`. Parse
  `/^(-)?(\d+)(?:\.(\d+))?$/`; milli = `whole*1000 + first 3 fraction digits`; if the 4th fraction digit ≥ 5 add 1
  (magnitude: half away from zero); apply the sign; return `0` for a zero result (never `-0`); `assertMilliunits`.
- `institutions.ts`: `POPULAR_INSTITUTIONS = {sandbox: [ins_109508, ins_109509, ins_109510, ins_109511,
  ins_109512], production: [ins_56, ins_127989, ins_127991, ins_5, ins_128026, ins_10, ins_33, ins_25, ins_7,
  ins_127990]}` `COUNTRY_NAMES`: English names of Plaid's 18
  countries (US "United States", CA, GB "United Kingdom", IE, FR, ES, NL, DE, IT, PL, DK, NO, SE, EE, LT, LV, PT, BE); `toInstitution(plaidInstitution)` → `Institution` (`country =
  COUNTRY_NAMES[cc[0]] ?? cc[0] ?? ""`, `url ?? null`, `logo ? "data:image/png;base64," + logo : null`).
- `tokens.ts`: `accessTokenSecretName(connectionId) = "plaid_access_token:" + id`; `getAccessToken(env, id)`,
  `storeAccessToken`, `deleteAccessToken` (wrappers over `secrets`). EXF-462 uses these.
- `http.ts`: `plaidErrorResponse(c, err): Response | null`: `PlaidNotSetUp` → 422 `{error:{id:"422", name:
  "bank_connections_not_set_up", detail:"Bank connections are not set up"}}`; `PlaidApiError` → 502 `{error:{id:
  "502", name:"plaid_error", detail: displayMessage ?? "Something went wrong. Try again."}}` (use `c.json`,
  `apiError` has no 502); else `null` (rethrow). Routes wrap Plaid-calling handlers with it.

Test `apps/worker/test/plaid-amounts.test.ts`: `110.01→110010`, `0.3→300`, `0.1+0.2→300`, `-0.3→-300`,
`-12.34→-12340`, `1.0005→1001`, `-1.0005→-1001`, `-0.0001→0` (and `Object.is(…, 0)`), `1e-7→0`,
`123456789.12→123456789120`, `null→null`, `NaN` throws.

## 5. Credentials service and routes

- `services/plaid-credentials.ts`: `putPlaidCredentials(env, actor, input)`: `before = plaidCredentialStatus`,
  `set_at = storePlaidCredentials`, then `changeLogInsert` executed alone (entity `plaid_credentials`, id =
  environment, `budget_id` null, action `update` if configured before else `create`, before/after `{environment,
  set_at}`); returns the status. `listPlaidCredentials(env)` → both environments, sandbox first.
- `routes/plaid-credentials.ts`: `PUT /plaid/credentials` (200 `PlaidCredentialPutResponse`), `GET
  /plaid/credentials` (200). Copy the `defaultHook` 400 from `routes/budgets.ts`.
- Test `apps/worker/test/plaid-credentials.test.ts`: surface path; GET before PUT → both unconfigured; PUT
  sandbox sentinels → 200; the `secrets` row's ciphertext holds neither sentinel; GET shows sandbox configured;
  no sentinel in any response, `change_log` row or `idempotency_keys` row (PUT with a key); bad input → 400; no
  MCP tool name contains `credential`.

## 6. Institutions

- `services/institutions.ts`: `searchInstitutions(env, budgetId, query)` → `getBudgetEnvironment` → `plaidFor`
  → `/institutions/search` `{query, products:["transactions"], country_codes:["US"], options:
  {include_optional_metadata:true}}` → first 10 → `toInstitution`. `popularInstitutions(env, budgetId)` →
  `Promise.allSettled` of `/institutions/get_by_id` `{institution_id, country_codes:["US"], options:
  {include_optional_metadata:true}}` for the plan environment's list; fulfilled ones, in list order; if **all**
  rejected, rethrow the first error.
- `routes/institutions.ts`: `GET /institutions` (query `InstitutionSearchQuery`), `GET /institutions/popular`
  (query `PopularQuery`); both 200 `InstitutionListResponse`, errors through `plaidErrorResponse`.
- Test helper `apps/worker/test/plaid-stub.ts`: `stubPlaid(handlers by path)` spies on `globalThis.fetch`,
  serves only Plaid hosts, records `{url, body, headers}`, fails on any other URL, restored in `afterEach`;
  `seedSandboxCredentials()` PUTs sentinels through the API. Storage may persist within a file: tests needing no
  credentials call `deleteSecret(env, "plaid_credentials:sandbox")` first.
- Test `apps/worker/test/institutions.test.ts`: surface paths; sandbox search sends the body above and sentinel
  headers to `sandbox.plaid.com`, returns 10 of 12, "United States", scheme-less `url` kept, logo data URL/null;
  popular keeps list order and skips one stubbed 400; no credentials → 422 `bank_connections_not_set_up`; a
  production plan with fake production credentials → 422 and **no** fetch; Plaid 400 with `display_message: null`
  → 502 "Something went wrong. Try again."; bad query → 400; unknown plan → 404.

## 7. Bank connections

- `repositories/bank-connections.ts`: `listByEnvironment(db, e)` (newest first, accounts by one `inArray` query),
  `insertConnectionStmt`, `insertAccountStmt`.
- `services/bank-connections.ts`: `toApi(row, accounts)`; `listBankConnections(env, budgetId)` (plan's
  environment); `createLinkToken(env, budgetId)` → `/link/token/create` with `linkTokenRequest(e,
  env.PUBLIC_HOSTNAME)` → `{link_token, expiration}`; `createBankConnection(env, actor, input)`:
  1. `e = getBudgetEnvironment`; `plaid = plaidFor(env, e)`.
  2. `/item/public_token/exchange` → `{access_token, item_id}`.
  3. In `try`: `/accounts/get {access_token}` → `accounts`, `item.institution_id`; `/institutions/get_by_id`
     (optional metadata) for `name`/`logo` (on failure: `input.institution_name ?? institution id`, logo null).
  4. `id = randomUUID()`; `storeAccessToken(env, id, access_token)`.
  5. Rows: connection (`display_id` = 3 random bytes as 6 lowercase hex, `nickname = name.slice(0,100)`,
     `status "connected"`, `provider "Plaid"`, `environment e`, nulls, `created_at = updated_at = now`); one account
     row per Plaid account (`plaid_account_id = account_id`, `mask`, `type`, `subtype`, balances via
     `plaidToMilliunits(balances.current/available)`, `balance_updated_at = balances.last_updated_datetime ?? now`).
  6. `db.batch([connection, ...accounts, changeLogInsert({budgetId: null, actor, action: "create", entityType:
     "bank_connection", entityId: id, before: null, after: toApi(...)})])`. On a UNIQUE failure whose message
     names `display_id`, regenerate it and retry (max 5, then `Conflict`).
  7. `catch` after step 2: `deleteAccessToken` (ignore errors), `/item/remove {access_token}` (ignore errors),
     rethrow. Nothing logs.
- `routes/bank-connections.ts`: `GET /bank-connections` (query `BankConnectionsQuery`, 200 list), `POST
  /bank-connections/link-token` (200 `LinkTokenResponse`), `POST /bank-connections` (201
  `BankConnectionResponse`). Plaid errors via `plaidErrorResponse`. Register `link-token` before any `{id}` path.
- `mcp/tools/bank-connections.ts`: `list_bank_connections` `{budget_id: z.uuid()}` → `{bank_connections}`.
- Test `apps/worker/test/bank-connections.test.ts` (stubbed): surface paths and `list_bank_connections` in
  `listedToolNames()`; link token: sandbox call body has no `redirect_uri` and no `webhook`; `linkTokenRequest(
  "production", "budget.example")` has `redirect_uri "https://budget.example/plaid/oauth"`; create with 2 stubbed
  accounts (balances `110.01`/`null`, `-0.3`/`0.1+0.2`) → 201, `status connected`, `provider Plaid`, display id
  `/^[0-9a-f]{6}$/`, `environment sandbox`, balances `110010`/`null`, `-300`/`300`; rows in both tables; the
  `secrets` row `plaid_access_token:<id>` exists and `getAccessToken` returns the sentinel; one `change_log` row
  `bank_connection`/`create`, actor `user:tester@localhost`, `budget_id` null; same bank twice → 2 connections,
  different display ids; `/accounts/get` failing → 502, no rows, no secret, `/item/remove` called; sandbox
  connection absent from `GET ?budget_id=<production plan>`; a seeded production row absent from the sandbox
  plan's list; MCP `list_bank_connections` returns the sandbox one. **Leak check**: across every response text,
  every `change_log`/`idempotency_keys` row, the MCP result text and `console.log/info/warn/error` spies, none of
  the five sentinels appears (the link token appears only in the link-token response itself).

## 8. Web

- `api/bank-connections.ts`: `fetchPopular`, `searchInstitutions`, `createLinkToken` (**no** `idempotencyKey`),
  `createBankConnection` (with one), `listBankConnections`; hooks `usePopularInstitutions(budgetId)` (`staleTime: 1h`,
  `retry: false`), `useInstitutionSearch(budgetId, query)` (`enabled: query !== ""`, `placeholderData:
  keepPreviousData`, `retry: false`).
- `shell/plaidLink.ts`: `PLAID_LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js"`;
  `loadPlaidLink(): Promise<PlaidGlobal>` (inject one `<script>`, resolve `window.Plaid`, reject on error) and the
  `PlaidHandler`/`PlaidCreateConfig` types (`token`, `receivedRedirectUri?`, `onSuccess`, `onExit`); `LINK_STATE_KEY = "budget.plaidLink"`, `saveLinkState({link_token,
  budget_id, query})`, `takeLinkState()` (read and remove); `plaidExitMessage(err)` = `display_message ??
  error_message ?? null`.
- `shell/BankSearch.tsx` `BankSearch({budgetId, sandbox, variant, onUnlinked, onConnected})`: markup per design
  (label `htmlFor="bank-search"`, input `id="bank-search"` with `className="account-field"`, `autoComplete="off"`,
  autoFocus, `spellCheck={false}`, `autoCapitalize="off"`, `autoCorrect="off"`; `<em>` note; `.bank-error`
  `<p className="field-error" role="alert">` under the note). Debounce 300 ms on `query.trim()`. Rows: `<button
  className="institution-row" title={url}>`, domain = `hostname` of `url` (prefix `https://` when it has no
  scheme) without a leading `www.`; invalid URL → `url`. No-match text exactly: `We couldn't find a financial
  institution named "{q}" that supports Direct Import.` `<br/><br/>` `Don't worry, you can still ` + (sidebar:
  `<button className="link-button">continue setting up this account</button>`, which calls `onUnlinked`;
  connections: plain text) + `.`. Linking flow as in the design: `linking` state disables `.bank-tile` and
  `.institution-row`; production plans call `saveLinkState` before `open()`; `onExit` and errors set the inline
  error; errors from `ApiError` show `detail`; search errors show "Something went wrong. Try again." unless
  `errorName === "bank_connections_not_set_up"`. Sandbox pill: `<span className="env-pill" title="Plaid Sandbox:
  test banks only">Sandbox</span>` in a flex row with the label.
- `shell/BankConnected.tsx` `BankConnected({connection})`: `CheckCircleIcon`, `<h3>{institution_name}</h3>`,
  `<p>ID: {display_id}</p>`, `<h4>Bank accounts</h4>`, `<ul>` rows: name + `formatMoney(current_balance)` or "—";
  second line `{cap(subtype ?? type)}{mask ? " ending in " + mask : ""}`.
- `shell/AddAccountDialog.tsx`: props `{onClose, variant = "sidebar", onBack?}`; `Screen` adds `"connected"`
  (title "Add Accounts"); the `start` screen renders `BankSearch` (sidebar: then the `.or-divider` "or" and the
  existing "Add an Unlinked Account" button; connections: neither); Back on `start` only in `connections` (calls
  `onBack ?? onClose`); `connected` footer = one `primary large` "Done" (`onClose`). Escape key on the dialog
  closes it unless Link is open. The sandbox flag = `plan?.bank_environment === "sandbox"` from
  `useCurrentPlan()`.
- `shell/Sidebar.tsx`: `useSearchParams`; `?add-accounts=connections` renders `<AddAccountDialog
  variant="connections" onBack={clear} onClose={clear}>` where `clear` deletes the parameter (`replace: true`).
- `shell/icons.tsx`: add `BankIcon` (own building glyph). `global.css`: classes for the note, `.env-pill`
  (12px/600, secondary button colours, pill radius), `.popular-grid` (2 columns, gap 8px 12px), `.bank-tile` (64px,
  border `--borderSubtle`, radius 10px, logo contained, max-height 40px), `.or-divider`, `.institution-row`
  (48px round logo, name 16px/600 with `--actionPrimary` on hover, country `--labelSecondary`, domain
  `--labelTertiary`, chevron `--inputBorder`), `.link-button`, `.bank-connected`. Sizes from the source notes;
  tokens only.
- `pages/plaid-oauth.tsx`: `page = {path: "/plaid/oauth", element}`, title "Bank Connection | Budget"
  (`useDocumentTitle`). Once on mount (guard StrictMode): `takeLinkState()`; none → "This bank connection could
  not be resumed." + link "Back to Budget" (`/`). Else `loadPlaidLink().create({token, receivedRedirectUri:
  window.location.href, onSuccess, onExit}).open()`: success → `createBankConnection` → `BankConnected` in the
  dialog shell, "Done" → `/${budget_id}/budget`; exit → "The bank connection was not completed." + Plaid's
  message + link to `/${budget_id}/budget`.

## 9. End-to-end specs

- `e2e/support/plaid-stub.ts`: `stubPlaidLink(page, {success: {public_token, institution}} | {exit:
  {display_message}})` fulfils `PLAID_LINK_SRC` with JS defining `window.Plaid.create(cfg)` (stores the non-function
  config on `window.__plaidConfig`; `open()` calls `onSuccess`/`onExit` on a timeout); `stubApi(page, {popular?,
  search?, linkToken?, create?})` routes `**/api/v1/institutions**` / `**/api/v1/bank-connections**` and records
  requests. Fake banks only ("ZZ Test Bank", `ins_test_1`).
- `e2e/bank-connections.spec.ts`: design cases 1–9 and 14 (6 and 7 hit the real Worker for the production plan;
  plans via the API with `authHeaders()` and `testName()`).
- `e2e/bank-connections-sandbox.spec.ts`: case 13, `test.skip(!PLAID_CLIENT_ID || !PLAID_SANDBOX_SECRET,
  "Plaid Sandbox credentials are not in the environment: real round trip skipped")`; credentials pushed with
  `request.put("/api/v1/plaid/credentials")`; public tokens from Sandbox `/sandbox/public_token/create`
  (`ins_109508`, `initial_products ["transactions"]`, credential headers). No `console.log`, no token in a message.

## 10. Scripts

- `scripts/plaid-credentials.sh` (mode 755, `set -euo pipefail`, `umask 077`): base from `live.url` (live mode,
  needs `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET`, else exit 2) or `PLAID_CREDENTIALS_BASE_URL` (must match
  `^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$`, else exit 2) with optional `PLAID_CREDENTIALS_LOCAL_JWT=1`
  (signs with `scripts/local-jwt.mjs` like `live-test-plans.sh`). Per environment: skip unless `PLAID_CLIENT_ID`
  and the environment's secret are non-empty; body `PLAID_ENV=<env> jq -n '{environment: $ENV.PLAID_ENV,
  client_id: $ENV.PLAID_CLIENT_ID, secret: $ENV.PLAID_SANDBOX_SECRET}'` (or the production variable) piped to
  `curl -sS --max-time 30 -o <tmp> -w '%{http_code}' -X PUT -K <(auth_config) -H 'Content-Type: application/json'
  --data-binary @- "$BASE/api/v1/plaid/credentials"`; 200 → `set`, else `failed`. Output only `plaid
  credentials: sandbox <s>, production <p>`; exit 1 if any `failed`.
- `scripts/test/plaid-credentials.test.ts` (dev server via `support/dev-server.ts`, sentinels): both set /
  only sandbox / none (exit 0, `skipped`) print the exact line and GET agrees; a 500 → `failed`, exit 1; a bad base
  URL → exit 2; with `support/fake-curl.ts` in live mode the argv log holds no sentinel and the config carries both
  Access header names; no output ever holds a sentinel.
- `scripts/deploy.sh`: after the smoke block's `phase_report` and before `echo "Live: …"` insert
  `# 9. Plaid credentials (EXF-459): pushed from the environment; never fails the release.` then `if is_dry; then
  echo "DRY: plaid credentials"; else bash scripts/plaid-credentials.sh || echo "WARNING: Plaid credentials were
  not pushed" >&2; fi`. Nothing else. Verify `scripts/test/deploy*.test.ts` still pass.

## 11. Docs

- `docs/conventions.md`: a short "Plaid" section: credentials only through `plaid/credentials.ts`
  (`loadPlaidCredentials`), the client only through `plaidFor(env, environment)`, the environment from the plan
  (`getBudgetEnvironment`) or the connection (`bank_connections.environment`), access tokens through
  `plaid/tokens.ts`; production is unreachable unless `ENVIRONMENT` is `production`; tests stub `fetch`
  (`test/plaid-stub.ts`) and never read `PLAID_PRODUCTION_SECRET`; no webhook.
- `docs/README.md`: already has this Build's line; keep it.

## Done when

`pnpm check` passes; `pnpm e2e e2e/bank-connections.spec.ts e2e/bank-connections-sandbox.spec.ts e2e/accounts.spec.ts
e2e/shell.spec.ts` passes (the sandbox spec runs here when the variables are present: say so in the report); no
file outside the design's Manifest changed; `git grep -n "SENTINEL"` hits only tests.
