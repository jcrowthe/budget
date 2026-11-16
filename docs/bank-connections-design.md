# Bank connections design (EXF-459)

Connect a bank with Plaid Link from the **Add Accounts** bank search and save the resulting **bank connection**
(one Plaid Item) with its bank accounts. First contact with Plaid: credentials stored encrypted in D1, a small
`fetch` client, institution search, Plaid Link loaded from Plaid's own script, and a per-plan Sandbox/Production
switch. Spec: [bank-connections-spec.md](bank-connections-spec.md). The Lead's scope notes on the Build override
the ticket where they differ.

## Source

Studied live in the plan "Test Budget" on 2026-11-16 (dark theme, 1600×813) without clicking any bank, the
unlinked button or anything under Bank Connections. Notes (exact texts, sizes, colours, DOM) and modal-only
screenshots: `/workspace/scratch/source/bank-connections/notes.md`, `01-start.png`, `02-results-plat.png`,
`03-no-match-zzqxv.png`. In short:

- Same 360×700 modal shell as the existing `account-modal` (header 70px, centred `h1` "Add Accounts", Close X).
  Input focused on open; **Escape closes the modal**; reopening starts empty.
- Label "Search for your bank" (14px/600), 48px input without placeholder, autocomplete/spellcheck off, (not italic: font-style normal, measured)
  note "Search by institution name or web address (URL)" (12px/500 `--labelSecondary`, margin -2px 0 16px).
- Empty query: `h3` "Popular Options" (14px/500), grid 2×158px, gap 8px/12px, 10 tiles 158×64 (border
  `--borderSubtle`, radius 10px, logo only), divider "or", secondary 48px "Add an Unlinked Account".
- Typing: from **1 character**, ~300 ms trailing debounce, **no loading indicator**; `h3` "Results" and at most
  **10** row buttons (`title` = full URL; round 48px logo or grey bank glyph; name 16px/600, accent on hover;
  country and bare domain 14px/500; right chevron; padding 8px 0; names wrap). Grid, divider and button go away.
- No match (no heading): `We couldn't find a financial institution named "zzqxv" that supports Direct Import.`,
  a blank line, "Don't worry, you can still continue setting up this account. …" and a suggestion button
  (Budget drops the suggestion and links "continue setting up this account", per the ticket).
- Clearing returns to Popular Options after the debounce. The Manage Bank Connections entry was not opened
  (forbidden); its Back arrow and missing unlinked button come from the ticket.

## Approach

Follow `docs/conventions.md`: files only, `(env, actor, input)` services, one `db.batch` per mutation, routes
and tools picked up by the globs. **No new dependency**: Plaid's REST API by `fetch`, Plaid Link by injecting
`https://cdn.plaid.com/link/v2/stable/link-initialize.js` when first needed. **No CSP or frame header exists**
in the app (`grep` over `apps/` and `scripts/` finds none; `index.html` has no meta CSP), so no header and no
`middleware/` file changes. **No change to `secrets/`**: its `setSecret`/`getSecret`/`deleteSecret` cover every
need. No webhook, no Durable Object, no cron, no `env.ts`/`wrangler.jsonc` change.

### Environments

- **Plan field** `bank_environment: "production" | "sandbox"` on `budgets` (migration 1, `NOT NULL DEFAULT
  'production'`, `CHECK` in the two values). Optional in `POST /budgets` (absent → `production`) and in
  `PATCH /budgets/{id}` (absent → unchanged; a change is a normal logged update). Returned in every Budget
  object, so REST `GET`/`list` and MCP `list_budgets`/`create_budget` carry it; MCP `create_budget` accepts it.
  No UI to choose it (out of scope); `scripts/live-test-plans.sh create` sends `"bank_environment":"sandbox"`.
- **Which Plaid**: every Plaid call for a plan uses the plan's environment; base URL `https://sandbox.plaid.com`
  or `https://production.plaid.com`. When the Worker's `ENVIRONMENT` is not `production` (local dev, e2e, Worker
  tests), a **production** plan never calls Plaid: it gets the not-set-up error. So locally and in every test only
  Sandbox is reachable.
- **Not set up**: no stored credentials for the plan's environment (or production while not on the live Worker)
  → **422 `bank_connections_not_set_up`, detail "Bank connections are not set up"**. The modal shows that text
  under the search field.
- A connection records `environment`; lists and lookups for a plan filter on the plan's environment, so a sandbox
  connection is never shown or used with a production plan and the other way round.

### Credentials (encrypted in D1)

- One secret per environment, name `plaid_credentials:sandbox` / `plaid_credentials:production`, value the JSON
  `{"client_id","secret","set_at"}`, stored with `setSecret` (AES-256-GCM). Only `apps/worker/src/plaid/` reads it.
- `PUT /api/v1/plaid/credentials` `{environment, client_id, secret}` → 200
  `{data:{environment, configured: true, set_at}}`. Write-only; writes a `change_log` row (entity
  `plaid_credentials`, entity id = environment, `budget_id` null, before/after `{environment, set_at}` only).
  `setSecret` executes on its own, so the secret write and the log row are two steps (secret first); accepted.
- `GET /api/v1/plaid/credentials` → `{data:{credentials:[{environment:"sandbox", configured, set_at|null},
  {environment:"production", …}]}}`. Never a value or any part of one (not even a length or prefix).
- No MCP tool reads or writes credentials.
- **`scripts/plaid-credentials.sh`** pushes Sandbox when `PLAID_CLIENT_ID` and `PLAID_SANDBOX_SECRET` are set,
  Production when `PLAID_CLIENT_ID` and `PLAID_PRODUCTION_SECRET` are set, skips otherwise; to `live.url` with the
  Access headers on a curl config pipe, the body from `jq -n` reading `$ENV` on stdin (no value in argv). Prints
  only `plaid credentials: sandbox set|skipped|failed, production set|skipped|failed`.
- **`scripts/deploy.sh`**: one step after the smoke test and its `phase_report`, before `Live:`:
  `bash scripts/plaid-credentials.sh || echo "WARNING: Plaid credentials were not pushed" >&2`, and in a dry run
  `DRY: plaid credentials`. It never fails the release and adds no `PHASE_SECONDS` key.

### Plaid client (`apps/worker/src/plaid/`)

- `plaidFor(env, environment)`: credentials in headers, 15 s timeout, errors as `PlaidApiError` without request
  data, never logs. Calls: `/institutions/search`, `/institutions/get_by_id`, `/link/token/create`,
  `/item/public_token/exchange`, `/accounts/get`, `/item/remove` (cleanup). Products `transactions`, country US.
- **Link token**: no webhook; `redirect_uri https://<PUBLIC_HOSTNAME>/plaid/oauth` **only for production**. Plaid's
  link-token flow has no institution pre-select, so Link opens on its own search; the institution actually linked
  comes from Link's metadata.
- **Money**: Plaid decimals become milliunits through their decimal string (no float multiply), half away from
  zero, never `-0`. Institutions map to `{institution_id, name, country ("United States"), url, logo (data URL
  or null)}`.
- **Popular lists** (ids verified on 2026-11-16 with Plaid Sandbox `/institutions/search` and
  `/institutions/get_by_id`; institution ids are shared by Sandbox and Production):
  - Sandbox: `ins_109508` First Platypus Bank, `ins_109509` First Gingham Credit Union, `ins_109510` Tattersall
    Federal Credit Union, `ins_109511` Tartan Bank, `ins_109512` Houndstooth Bank.
  - Production: `ins_56` Chase, `ins_127989` Bank of America, `ins_127991` Wells Fargo, `ins_5` Citibank Online,
    `ins_128026` Capital One, `ins_10` American Express, `ins_33` Discover, `ins_25` Ally Bank, `ins_7` USAA,
    `ins_127990` U.S. Bank. Most are OAuth banks (see `/plaid/oauth`). Several have no Plaid logo: the tile then
    shows the name.

### API (paths under `/api/v1`)

| Method, path | Request | 2xx | Errors |
| -- | -- | -- | -- |
| `GET /institutions` | `?budget_id=<uuid>&query=<1–100 chars>` | 200 `{data:{institutions: Institution[≤10]}}` | 400, 404 plan, 422 not set up, 502 `plaid_error` |
| `GET /institutions/popular` | `?budget_id=` | 200 `{data:{institutions}}` in configured order; ids Plaid fails to return are left out | same |
| `POST /bank-connections/link-token` | `{budget_id}` | 200 `{data:{link_token, expiration}}` | same |
| `POST /bank-connections` | `{budget_id, public_token, institution_id, institution_name?}` | 201 `{data:{bank_connection}}` | same |
| `GET /bank-connections` | `?budget_id=` | 200 `{data:{bank_connections}}` (plan's environment, newest first) | 400, 404 |
| `PUT /plaid/credentials`, `GET /plaid/credentials` | see above | 200 | 400 |

`502 plaid_error` detail = Plaid's `display_message` when present, else "Something went wrong. Try again.".
The link-token route answers 200 (nothing is created in Budget) and the web never sends an `Idempotency-Key` to
it, because the idempotency middleware stores response bodies and the link token must not be stored.

`BankConnection` and `BankAccount` carry the table fields below except `plaid_item_id`, `plaid_account_id`,
`sync_cursor` and `updated_at`, plus `accounts` on the connection (exact schemas in the spec). No token, ever.

**MCP**: `list_bank_connections {budget_id}` → `{bank_connections}` (same service, read only). No tool creates a
connection.

### Data (migration 2)

- `bank_connections`: `id` uuid PK, `display_id` (6 lowercase hex, `UNIQUE`), `environment` (`CHECK`
  sandbox/production), `plaid_item_id` (`UNIQUE`), `institution_id`, `institution_name`, `institution_logo`
  (nullable data URL), `nickname` (≤100, defaults to the institution name, truncated), `status` (`connected`),
  `provider` (`Plaid`), `last_synced_at`, `sync_cursor` (null), `created_at`, `updated_at`.
- `bank_accounts`: `id` uuid PK, `bank_connection_id` → `bank_connections(id)`, `plaid_account_id`, `name`,
  `mask`, `type`, `subtype`, `current_balance`, `available_balance` (INTEGER milliunits, nullable),
  `balance_updated_at`, `created_at`; `UNIQUE(bank_connection_id, plaid_account_id)`.
- The access token: secret `plaid_access_token:<connection id>` through `setSecret`.

### Create: exchange, store, write once

`createBankConnection(env, actor, input)`: plan → environment → client; exchange `public_token`;
`/accounts/get` (accounts, `item.institution_id`); `/institutions/get_by_id` for name and logo (on failure: the
body's `institution_name`, else the id). Then `setSecret(plaid_access_token:<id>)` and **one** `db.batch`: the
connection row, one row per account, and a `change_log` row (`entity_type "bank_connection"`, action `create`,
`budget_id` null, the user's actor, `after` = the API object). A `display_id` collision (UNIQUE) regenerates it
and retries the batch (5 attempts). If anything fails after the exchange: best-effort `deleteSecret` and
`/item/remove`, nothing written, the error is answered. Same bank twice = two Items = two connections.

### Web

- **`AddAccountDialog`** gains props `variant?: "sidebar" | "connections"` (default `sidebar`) and `onBack?`.
  Its `start` screen becomes the bank search (`BankSearch.tsx`). `connections`: a Back arrow on the start screen
  (calls `onBack`), no "or" divider, no unlinked button, and the no-match sentence is plain text. A new screen
  `connected` (`BankConnected.tsx`) is the plain confirmation. Escape closes the dialog (not while Link is open).
- **Search screen** as in Source, with tokens only. A sandbox plan shows a small pill **"Sandbox"** at the right
  of the label row (`title` "Plaid Sandbox: test banks only"). Popular tile: logo `img` (contained) or, with no
  logo, a bank glyph and the name; accessible name = institution name. Search uses a 300 ms debounce on the
  trimmed query, React Query with the previous data kept (no spinner). Empty debounced query → Popular Options.
  Search error → "Something went wrong. Try again." under the field (the not-set-up detail when that is the
  error); the list area is empty. The popular list failing with not-set-up shows the same detail and hides the
  heading and grid; divider and unlinked button stay.
- **Linking**: a tile/row click posts the link token, loads Plaid's script and opens Link (tiles and rows
  disabled meanwhile). `onSuccess` posts the connection and shows `connected`. `onExit`: back to the search with
  the typed query kept and Plaid's message (if any) under the field; nothing created. Link-token and create
  errors show their detail the same way. A production plan first saves the link state in `sessionStorage`.
- **Confirmation (`connected`)**: check icon, the bank's name, "ID: <display_id>", "Bank accounts" with one row
  each (name, balance, "<Type> ending in <mask>"), and "Done". EXF-461 replaces it.
- **Variant hook**: until EXF-460 adds its screen, the Sidebar opens the `connections` variant when the URL has
  `?add-accounts=connections`; Back and Close remove the parameter. EXF-460 replaces the hook with its caller.
- **`/plaid/oauth` page** (behind Access like every path): resumes Link from the saved state with
  `receivedRedirectUri` = the current URL, then finishes like the dialog (same create call, same confirmation);
  without saved state it says "This bank connection could not be resumed.". Tested with a stubbed Plaid only.

## Downstream

- **EXF-460** (Manage Bank Connections) renders `<AddAccountDialog variant="connections" onBack>` from its list,
  removes the `?add-accounts=connections` hook, lists with `GET /bank-connections?budget_id=`, and adds
  remove (`/item/remove` + `deleteSecret`), nickname and status changes.
- **EXF-461** (link to plan accounts) replaces the `connected` screen and reads `BankAccount` rows.
- **EXF-462** (sync) reads `plaid_access_token:<id>` and `bank_connections.environment` through
  `apps/worker/src/plaid/` (see conventions), fills `last_synced_at`, `sync_cursor`, balances. No webhook.
- The person must register `https://budget.doxen.dev/plaid/oauth` as an allowed redirect URI in the Plaid
  dashboard's API settings ("Allowed redirect URIs") and have Production access with `transactions`; OAuth
  banks also need Plaid's OAuth registration for the app.

## Out of scope

Account selection (EXF-461), Manage Bank Connections (EXF-460), sync/cron/Durable Object (EXF-462), a UI to
choose a plan's environment, "Suggest an Institution", Plaid webhooks, non-US institutions.

## Acceptance

Browser cases use the e2e server (stubs where said) or `pnpm dev`; compare cases name the live source state:
plan "Test Budget", dark theme, 1600×813, sidebar **Add Account**; never click a bank in the source.

1. **Start screen (compare)**. Open a plan, click sidebar "Add Account". Expect dialog "Add Accounts", no Back,
   focused input, label "Search for your bank", note, "Popular Options" with tiles (stubbed list), "or"
   divider, "Add an Unlinked Account". Compare with the source start screen (layout, sizes, colours; tiles hold
   Plaid logos/names instead of banners).
2. **Connections variant**. Open `/<plan>/budget?add-accounts=connections`. Expect a Back arrow, no "or", no
   "Add an Unlinked Account"; Back closes the dialog and the URL loses the parameter.
3. **Results (compare)**. Type "plat" (stub: 12 institutions). Expect "Results" and exactly 10 rows, each with
   name, "United States", the bare domain, `title` = full URL; clearing shows "Popular Options" again. Compare
   with the source typing "plat".
4. **No match (compare)**. Type "zzqxv" (stub: none). Expect `We couldn't find a financial institution named
   "zzqxv" that supports Direct Import.` and "Don't worry, you can still continue setting up this account.";
   the link opens "Add Unlinked Account". Compare with the source typing "zzqxv" (minus the suggestion parts).
5. **Search error**. Stub `/institutions` with 502. Expect "Something went wrong. Try again." under the field;
   typing again works.
6. **Not set up**. On a production plan in the e2e app (no stub), open the modal. Expect "Bank connections are not
   set up" under the field and the unlinked button still there.
7. **Sandbox mark**. A plan created with `bank_environment: "sandbox"` shows "Sandbox" in the modal; a production
   plan does not.
8. **Link success (stubbed)**. Stub link token, Plaid script (calls `onSuccess`) and create. Expect the
   confirmation with the bank name, "ID: 0a1b2c", account rows (name, "Checking ending in 0000", "$110.00"),
   Done closes.
9. **Link exit (stubbed)**. Plaid stub calls `onExit` with `display_message` "The credentials were not correct.".
   Expect the search screen, the query still typed, that message under the field, and no POST to
   `/bank-connections`.
10. **API, Worker tests (Plaid stubbed at `fetch`)**: search/popular/link token/create shapes; create stores rows
    (status `connected`, provider `Plaid`, 6-hex display id, balances in milliunits incl. `110.01`, `-0.3`,
    `0.1+0.2`-style values), a `change_log` create row with the user actor; same bank twice → two connections
    with different display ids; failure after exchange writes nothing; sentinel tokens/secrets never appear in
    any response, `change_log`, MCP result, `idempotency_keys` or console output.
11. **Credentials**: PUT stores a ciphertext row (plaintext absent), GET returns only `configured`/`set_at`;
    the script prints only its one line, no value in argv or output; a sandbox plan without credentials and any
    production plan locally get 422 "Bank connections are not set up".
12. **Environments**: `bank_environment` defaults to `production` in REST and MCP, is settable on create and
    PATCH (PATCH of the name keeps it); a sandbox connection is not listed for a production plan and a production
    connection (seeded row) not for a sandbox plan; `live-test-plans.sh create` sends `sandbox`.
13. **Real Sandbox round trip** (e2e, runs only with `PLAID_CLIENT_ID` and `PLAID_SANDBOX_SECRET`, else skipped
    with a message): push sandbox credentials to the e2e server, `/sandbox/public_token/create` for `ins_109508`
    twice, `POST /bank-connections` each time; `GET /bank-connections?budget_id=` returns both, `connected`,
    `Plaid`, different 6-hex ids, Sandbox accounts with masks and integer balances, no token anywhere;
    `/institutions?query=plat` returns ≤10; popular sandbox list returns all five ids.
14. **OAuth page (stubbed)**. Seed `sessionStorage`, open `/plaid/oauth?oauth_state_id=x`. Expect Plaid created
    with `receivedRedirectUri` equal to that URL and, on success, the confirmation; without stored state, the
    "could not be resumed" message.
15. **By hand (Tester, not a gate)**: in `pnpm dev`, a sandbox plan, credentials pushed with
    `PLAID_CREDENTIALS_BASE_URL`, click First Platypus Bank, complete Link with `user_good` / `pass_good`; report
    the confirmation and `GET /bank-connections`.

## Manifest

touches: [apps/worker/migrations/*_budgets_bank_environment.sql, apps/worker/migrations/*_bank_connections.sql, apps/worker/src/plaid/**, apps/worker/src/db/schema/budgets.ts, apps/worker/src/db/schema/bank-connections.ts, apps/worker/src/db/schema/bank-accounts.ts, apps/worker/src/repositories/budgets.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/services/budgets.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/services/institutions.ts, apps/worker/src/services/plaid-credentials.ts, apps/worker/src/routes/budgets.ts, apps/worker/src/routes/bank-connections.ts, apps/worker/src/routes/institutions.ts, apps/worker/src/routes/plaid-credentials.ts, apps/worker/src/mcp/tools/budgets.ts, apps/worker/src/mcp/tools/bank-connections.ts, packages/schema/src/budgets.ts, packages/schema/src/bank-connections.ts, packages/schema/src/institutions.ts, packages/schema/src/plaid-credentials.ts, apps/web/src/api/bank-connections.ts, apps/web/src/shell/AddAccountDialog.tsx, apps/web/src/shell/BankSearch.tsx, apps/web/src/shell/BankConnected.tsx, apps/web/src/shell/plaidLink.ts, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/global.css, apps/web/src/shell/icons.tsx, apps/web/src/pages/plaid-oauth.tsx, apps/worker/test/bank-connections.test.ts, apps/worker/test/institutions.test.ts, apps/worker/test/plaid-credentials.test.ts, apps/worker/test/plaid-amounts.test.ts, apps/worker/test/budgets-bank-environment.test.ts, apps/worker/test/plaid-stub.ts, e2e/bank-connections.spec.ts, e2e/bank-connections-sandbox.spec.ts, e2e/support/plaid-stub.ts, scripts/plaid-credentials.sh, scripts/deploy.sh, scripts/live-test-plans.sh, scripts/test/plaid-credentials.test.ts, scripts/test/live-test-plans.test.ts, docs/bank-connections-design.md, docs/bank-connections-spec.md, docs/conventions.md, docs/README.md]
shared: [apps/web/src/shell/** (AddAccountDialog.tsx, Sidebar.tsx, global.css, icons.tsx and new BankSearch.tsx, BankConnected.tsx, plaidLink.ts): the bank search lives in the Add Accounts dialog the sidebar opens; Sidebar adds only the temporary ?add-accounts=connections hook. Sensitive, not shared: scripts/deploy.sh (one post-smoke step), apps/worker/migrations/** (two additive migrations). No middleware/, secrets/, app.ts, env.ts or wrangler.jsonc change.]
migrations: 2
