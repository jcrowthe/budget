# Clone journal: Budget

The Lead's memory for cloning YNAB into "Budget". Sections 1 to 5 are the settled brief; section 6 is what
discovery found before the proposal; section 7 is the progress log.

## 1. Goal

A web app at `https://budget.doxen.dev`, for one person, that replaces YNAB for tracking money across linked
bank and credit card accounts. Built only for the person: one user, never a product.

Source app: `https://app.ynab.com` (YNAB web). Architecture approved by the person on 2026-11-15, including the
five recommended answers in section 2.

### What parity means

The same screens, workflows and budget arithmetic as YNAB's web app for:

- **Plans:** several separate plans, each with its own accounts, categories and history.
- **Plan screen:** category groups and categories; Assigned, Activity and Available per month; Ready to Assign;
  month navigation and rollover; the Underfunded, Overfunded, Money Available and Snoozed views; moving money;
  notes; undo, redo and Recent Moves.
- **Targets and Auto-Assign:** weekly, monthly, yearly and custom targets; Auto-Assign by underfunded, last
  month's assigned or spent, averages, and the two resets.
- **Accounts:** all thirteen YNAB account types (cash, credit, loans, tracking), the sidebar with balances,
  All Accounts.
- **Register:** add, edit, split, transfer, flag, approve, categorize, bulk edit, search, file import,
  reconcile; cleared, uncleared and working balances.
- **Linked accounts:** automatic import, the "new transactions to approve or categorize" banner, "This needs a
  category", and repairing a broken connection. Plaid replaces YNAB's bank connections.
- **Credit cards, scheduled transactions, payees and payee rules.**
- **Reflect:** Spending Breakdown, Spending Trends, Net Worth, Income v Expense, Age of Money.
- **History:** every past transaction and every assignment change is kept and can be inspected.

Not cloned: sharing (Add Member), subscription and billing, referrals, support chat, the "For You" content,
mobile apps, and sign-in screens (Access replaces them). Tickets for these are closed as not belonging.

Added beyond YNAB: a REST API, an MCP endpoint, and the YNAB import.

## 2. Decisions the person approved

1. **Plaid production access** is the person's task (four open tasks on their Plaid team: select products,
   choose plan, verify business, submit request). Transactions product only; the free Trial plan if offered
   (10 Items, a removed Item does not free its slot, OAuth banks included). Consequence: all testing uses Plaid
   Sandbox and never creates a production Item.
2. **DNS:** the first deploy replaces the existing A record on `budget.doxen.dev` (it points at a private LAN
   address) with the Worker's custom domain.
3. **No Plaid webhooks.** Nothing is public outside Access. Plaid is polled hourly; a "sync now" button covers
   the rest.
4. **YNAB history** comes in through an importer for YNAB's own export file (Plan + Register), run by the
   person per plan. Not the YNAB API: a token would expose every plan to the children.
5. **Name and artwork:** same layout, dark theme and workflows as YNAB, under the name "Budget" with its own
   icons. YNAB's logo and illustrations are not copied.

## 3. Approved architecture

### Stack

| Layer | Choice |
|---|---|
| Language and tooling | TypeScript, pnpm workspace |
| Server | One Cloudflare Worker, Hono, zod with OpenAPI 3.1 generated from the route definitions |
| Web app | React and Vite single-page app, served from the same Worker as static assets |
| Database | D1, Drizzle ORM, SQL migrations applied with wrangler |
| Files | R2: uploaded import files, nightly database exports |
| Durable Objects | One per Plaid Item, to serialize syncing and run its hourly alarm |
| Scheduled work | Cron Triggers: nightly backup, materializing scheduled transactions |
| MCP | Cloudflare's stateless MCP handler (streamable HTTP) at `/mcp` |
| Tests | Vitest (including the Workers pool), Playwright |

### Components

- `packages/core`: the budget engine, pure TypeScript with no I/O. Owns rollover, Ready to Assign, credit card
  payment logic, targets, Auto-Assign and Age of Money.
- `packages/schema`: zod schemas shared by server, web app and MCP tools.
- `apps/worker`: routes (REST, MCP), services (one per use case), repositories (D1), the Plaid client, the sync
  Durable Object.
- `apps/web`: the single-page app.

API first is enforced by construction: the web app talks only to the public REST API, and REST routes and MCP
tools call the same services. There is no private endpoint for the UI.

### REST API

- Base path `/api/v1`, with `/api/v1/openapi.json` as the contract.
- Resources follow the shape of YNAB's public API: budgets, accounts, category groups, categories, months,
  payees, transactions, scheduled transactions, plus Plaid connections, imports and history. The resource is
  `budgets`; the UI calls it a "Plan".
- Amounts are integer milliunits; dates are ISO 8601.
- `import_id` de-duplicates transactions; an `Idempotency-Key` header makes writes safe to retry.

### MCP

Tools mirror the REST use cases: list plans and accounts, read a month, search transactions, create and
categorize transactions, approve, assign and move money, trigger a sync. Every tool call is recorded in history
with the calling client as the actor.

### Data model (D1)

- **Plans:** `budgets`, `settings`, `months` (notes).
- **Budgeting:** `category_groups`, `categories`, `month_assignments`, `targets`, `moves`.
- **Accounts and transactions:** `accounts`, `transactions`, `subtransactions` (splits),
  `scheduled_transactions`, `payees`, `payee_rules`, `reconciliations`, `file_imports`.
- **Plaid:** `plaid_items`, `plaid_accounts`, `plaid_transactions` (raw rows, kept so an import can be
  replayed).
- **History:** `change_log`. Every mutation writes its actor and its before and after values. This one table
  provides the audit history, undo and redo, and Recent Moves.
- **Secrets:** `secrets`.

Activity, Available and Ready to Assign are never stored as truth: the engine derives them from assignments
and transactions. D1 has no interactive transactions, so each service writes its changes as one atomic batch.

### Authentication

- One Cloudflare Access application covers every path of `budget.doxen.dev`, with two policies: allow the
  person's identity only, and Service Auth for service tokens.
- Browser: sign-in through Access. REST clients: an Access service token in the two `CF-Access-Client-*`
  headers. MCP clients: Access Managed OAuth.
- The Worker also verifies the Access JWT on every request (signature, audience, issuer) and refuses anything
  without it. The `workers.dev` and preview URLs are switched off.
- No users, passwords or sessions in the app.
- **To verify in the scaffold:** Managed OAuth and a Service Auth policy on the same application is not
  documented. If they cannot coexist, `/mcp` gets its own Access application.

### Secrets

- `secrets` holds AES-256-GCM ciphertext, a random IV per record, and a key version column for rotation.
- The key is the Worker secret `SECRETS_ENCRYPTION_KEY`, the only application secret on the Worker.
- Stored this way: Plaid client credentials (Sandbox and Production) and each Item's access token.
- Secrets are never returned by the API or MCP, and never logged.

### Plaid integration

- **Linking:** link token, Plaid Link in the page, public token exchange, access token stored encrypted. The
  person maps each Plaid account to a new or existing account and picks a start date. OAuth return address:
  `https://budget.doxen.dev/plaid/oauth`, behind Access.
- **Syncing:** `/transactions/sync` with a cursor per Item, inside that Item's Durable Object. Fires on its
  hourly alarm, right after linking, and on "sync now". Added, modified and removed transactions are applied
  idempotently, including pending-to-posted.
- **Importing:** imported transactions arrive unapproved. A payee rule may categorize them; otherwise "This
  needs a category". Matched to hand-entered transactions (same account and amount, nearby date).
- **Connection health:** a login-required or expiring Item shows "Connection Repair Needed"; Repair opens
  Plaid Link in update mode.
- **Environments:** each Item records Sandbox or Production. The live test plan links Sandbox banks; real
  plans link Production.
- **Left out for now:** Liabilities and Investments (separate Plaid products).

### Hosting and deploy

- Resources: Worker `budget` on the custom domain `budget.doxen.dev`, D1 `budget-db`, R2 `budget-files`, one
  Durable Object namespace, Cron Triggers.
- No GitHub Actions. `scripts/deploy.sh` is the CI.
- Gate: `pnpm check`, then Playwright against a local `wrangler dev`.
- Release: (1) record a D1 Time Travel bookmark; (2) apply migrations and deploy with `DEPLOY_SHA`;
  (3) ensure the Access application and policies exist; (4) smoke test: a service-token call to
  `/api/v1/health` returns the new `DEPLOY_SHA` and an unauthenticated call is refused; (5) print the live URL.
- Backups: a nightly D1 export to R2, on top of D1's 30-day point-in-time restore.

### Credentials on the Application's connections

Status on 2026-11-15: none set, not yet requested. Request them with `request_secrets` once the scaffold Build
is running, so the person gathers them while work proceeds.

| Key | Purpose | Needed by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers, D1, R2, DNS on `doxen.dev`, Access apps, policies, service tokens | first deploy |
| `CLOUDFLARE_ACCOUNT_ID` | The account that owns `doxen.dev` | first deploy |
| `CF_ACCESS_TEAM_DOMAIN` | Zero Trust team domain | first deploy |
| `ACCESS_ALLOWED_EMAIL` | The one identity allowed in | first deploy |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Service token for tests and smoke checks | first deploy |
| `SECRETS_ENCRYPTION_KEY` | 32 random bytes; the person keeps the only copy outside the Worker | first deploy |
| `PLAID_CLIENT_ID`, `PLAID_SANDBOX_SECRET` | Sandbox linking and sync tests | Plaid Builds |
| `PLAID_PRODUCTION_SECRET` | Real banks | after Plaid approves |

### Checks and test approach

- Checks command: `pnpm check` (lint, typecheck, unit tests, Worker integration tests against a local D1, build).
- Engine parity: scenarios carried out by hand in the YNAB Test Budget (unlinked accounts, manual
  transactions), their numbers recorded as fixtures. The engine must reproduce every Assigned, Activity,
  Available and Ready to Assign value.
- API: contract tests from the OpenAPI document; MCP tool tests against the same services.
- Plaid: sync tests from Sandbox fixtures (added, modified, removed, pending-to-posted); a Sandbox link end to
  end in Playwright.
- Security: a request without a valid Access JWT is refused; secrets are ciphertext at rest.
- Local development accepts a locally signed test JWT only when the environment is local; a test proves the
  production configuration refuses it.
- Live testing stays inside one plan carrying the test prefix, linked only to Sandbox banks.

## 4. Conventions every child must follow

Children see only their inputs. Copy the rules that apply into each child's inputs; do not assume they have
read this file.

### Process

- `clone.profile.json` at the repository root holds the app's specifics: commands, ports, paths and, under
  `live.*`, the live URL, the test space, the test-data prefix and the never-touch list. The scaffold Build
  creates it. Children read their values from it and stop, naming the key, when a key is missing. A Build fixes
  a missing or wrong key.
- `scripts/deploy.sh` is the only way to ship. It runs the gate, then the release, and prints the live URL.
  No `.github/workflows` directory, ever.
- Tickets are labelled `clone:feature` (from discovery), `clone:gap` (from flow tests) or `clone:template`
  (template improvements). New tickets are filed through a review's `new_tickets`, never by hand.
- Scheduling rule: Builds run side by side only when their manifests are disjoint; otherwise they are
  sequenced with blocking links. Shared hot spots are kept small on purpose: one file per resource for routes,
  services, repositories, schemas and MCP tools; migrations carry a timestamp prefix so two Builds never pick
  the same number.
- pnpm only. Hono for every HTTP route.

### Product rules

- API first: the web app calls only `/api/v1`. A feature ships its REST route, its OpenAPI entry, its MCP tool
  when it is a use case an agent would perform, and its UI. REST and MCP call the same service.
- Money is integer milliunits everywhere; never floats. Dates are ISO 8601; a month is its first day.
- Activity, Available and Ready to Assign are derived by `packages/core`, never stored as truth.
- Each service writes its changes as one atomic D1 batch, including its `change_log` row with the actor
  (browser identity, service token name, MCP client, or `plaid`).
- Migrations are forward-only and additive; the live database holds the person's real money data.
- The app is named "Budget". Same layout, dark theme and workflows as YNAB; no YNAB logo, name or
  illustrations.

### Security rules

- Nothing is reachable outside Cloudflare Access. No webhook paths, no bypass policies, no `workers.dev` or
  preview URLs. The global Access JWT check stays in front of every route.
- Secrets go through the secrets module only: encrypted in D1 with `SECRETS_ENCRYPTION_KEY`. Never logged,
  never returned, never in fixtures, never printed from the environment.
- Plaid: Sandbox only in tests and on the live test plan. Never create, repair or remove a Production Item.

### The person's data

- Source test space: the YNAB plan "Test Budget" (`542b334b-696e-4418-937a-5e2c21a8b45c`). The only plan a
  child may modify.
- Plan "Programmatik" (`85810fb1-ae94-4b3e-ab0c-7cc96c0d7a59`): view only, and only the account page
  `/accounts/f6b37d1e-db76-4c1f-b151-02df87c08a89`, the reference for a live linked account.
- No other plan is opened or read. The plan switcher list is not opened unless a ticket needs it, and nothing
  from it is recorded.
- The person's real balances, payees and amounts never go into tickets, fixtures, committed screenshots,
  commit messages or this journal. Evidence comes from the Test Budget or the clone's test plan.
- On the live clone, every plan without the test prefix is on the never-touch list.
- A signed-out source app means stop: only the person can sign in.

## 5. Customer flows to test

The person gave none; these are the Lead's. Flows 10 and 11 exist only in the clone.

1. Create a plan with groups and categories, add a checking account with a starting balance, and assign until
   Ready to Assign is zero.
2. Enter an outflow, an inflow, a split and a transfer; overspend a category and cover it by moving money.
3. Move to next month: leftovers carry over; set a target; fund it with Auto-Assign.
4. Add a credit card, spend on it in a category, see the payment category fill, and record the payment.
5. Link a bank: accounts appear with balances, transactions import, approve and categorize them, repair a
   broken connection. The clone uses a Sandbox bank; the source is observed view-only.
6. Reconcile an account, search and filter the register, import a file.
7. Create a recurring transaction and a payee rule that renames and categorizes.
8. Reflect: Spending Breakdown and Net Worth match the entered data.
9. Switch between two plans and confirm their data is separate.
10. REST and MCP: with a service token, create a transaction and read a month; through MCP, categorize a
    transaction and assign money. Both appear in the UI and in history with the right actor.
11. Access lock: unauthenticated requests to the UI, the API and `/mcp` are refused.

## 6. Discovery notes (2026-11-15, before the proposal)

### Areas to discover

1. Plan screen: month grid, groups and categories, assigning, Ready to Assign, views, moving money, undo and
   redo, Recent Moves.
2. Targets, Auto-Assign, the category inspector and the month summary panel.
3. Accounts: unlinked account types, sidebar groups, edit, close, reorder, balances.
4. Register: add and edit, splits, transfers, flags, approve, bulk edit, search, file import, reconcile.
5. Linked account experience, view-only on the Programmatik account: import banner, needs-a-category, repair,
   Bank Connections.
6. Credit cards and loans.
7. Scheduled transactions, payees and payee rules.
8. Reflect reports.
9. Plan management and settings, inside the Test Budget only.

### What the Lead saw in the source app

- Shell: left sidebar (plan name menu, Plan, Reflect, All Accounts, account groups with balances, Add Account,
  Bank Connections), dark theme.
- Plan screen: month navigator with month note, Ready to Assign pill, view chips (All, Underfunded,
  Overfunded, Money Available, Snoozed), toolbar (Category Group, Undo, Redo, Recent Moves), grid of groups and
  categories with Assigned / Activity / Available, right panel (month summary, Cost to Be Me, Auto-Assign,
  Assigned in Future Months). The Test Budget starts with YNAB's default groups (Bills, Needs, Wants) and no
  accounts.
- Category inspector: available balance breakdown (cash left over, assigned this month, cash spending, credit
  spending), Target (Weekly / Monthly / Yearly / Custom, amount, due day, "next month I want to" behaviour),
  Auto-Assign (Assigned Last Month, Spent Last Month, Average Assigned, Average Spent, Reset Available, Reset
  Assigned), notes.
- Add Account: bank search plus "Add an Unlinked Account" (nickname, type, current balance). Types: Checking,
  Savings, Cash; Credit Card, Line of Credit; Mortgage, Auto Loan, Student Loan, Personal Loan, Medical Debt,
  Other Debt; Asset, Liability.
- Account register: cleared + uncleared = working balance, Reconcile, Add Transaction, File Import, Undo/Redo,
  View, search; columns flag, date, payee, category, memo, outflow, inflow, cleared. A linked account shows a
  "N new transactions to approve or categorize" banner, "This needs a category" pills, and a "Connection
  Repair Needed" state with a Repair button.
- Reflect: Spending Breakdown, Spending Trends, Net Worth, Income v Expense, Age of Money.

### Facts checked outside the app

- `doxen.dev` is on Cloudflare nameservers.
- Plaid's free Trial plan is for teams created on or after 2026-04-15; whether the person's team qualifies is
  for them to see in the dashboard.
- Cloudflare Access Managed OAuth on a self-hosted application returns a 401 with OAuth discovery to
  non-browser clients, issues opaque tokens, and still forwards `Cf-Access-Jwt-Assertion` to the Worker.
- Cloudflare's stateless MCP handler (`createMcpHandler`) runs in a plain Worker; `McpAgent` is deprecated.
  Check the exact package versions at scaffold time.
- Driving the browser: the signed-in Chrome exposes a DevTools port on localhost (find it in the process
  list); the Lead used a small script over it. Screenshots of the person's data were deleted after reading.

### Why the order of the first rounds

- The scaffold Build goes first and alone: it writes `clone.profile.json`, and every other child stops without
  it.
- Discovery runs next, all nine areas side by side: Discover children write tickets, not code, so they cannot
  collide.
- The first deploy follows the scaffold as soon as the Cloudflare credentials are on the connections, so the
  Access lock and the DNS replacement are proven early, before features pile up.
- Foundation Builds (data model and engine, then plans and categories, accounts, register) come before
  anything Plaid, because every later feature writes through them.

## 7. Progress log

Review counters (finished children since that template's last review): Build 1, Deploy 1, Test user flow 0,
Discover 3. (The Deploy and the three Discover children ended in under a minute at the profile check; the
cancelled Build is not counted.) Last template-ticket sweep: none yet (due about round 30).

| Date | Round | Child (template, Thread) | Ticket | Pull request | Outcome |
|---|---|---|---|---|---|
| 2026-11-15 | 1 | Build feature, scaffold (`p_f3914d573e1043c8a1968e6f1b7f2db4`) | none | [#1](https://github.com/jcrowthe/budget/pull/1) | merged as `2d82719` |
| 2026-11-15 | 2 | Deploy (`p_29df4df509e0410592bdd63ec05be67e`) | none | none | refused at the profile check; nothing shipped |
| 2026-11-15 | 2 | Build feature, EXF-453 hardening (`p_bed242fbbbc24340b340793fd1631f76`) | EXF-453 | none | cancelled by me after ten minutes (sequencing) |
| 2026-11-15 | 2 | Discover, area 1 Plan screen (`p_17cd9c4a93fc4e29a08e8f5eddca54c4`) | none | none | failed at load_profile (`source.driver`) |
| 2026-11-15 | 2 | Discover, area 2 targets and Auto-Assign (`p_5d1242cb6d6a4a9eaaac1d9d9d018506`) | none | none | failed at load_profile |
| 2026-11-15 | 2 | Discover, area 3 accounts (`p_1de9980b363444c8a1d738fe29cac7cd`) | none | none | failed at load_profile |
| 2026-11-15 | 2 | Build feature, profile fix (`p_e9bdeb6d31de438a81905eeaec90f8c8`) | none | pending | running |

### 2026-11-15 · Plan round 1

Children used 1 of 200. (The round brief names a limit of 1000; the platform's live counter says 200. I quote
200, the stricter figure, until the person or a budget card says otherwise.)

- State: no runnable project, no `clone.profile.json`, no tickets, no children before this round.
- Started the scaffold Build and nothing else: every other child stops without the profile it writes. There is
  no ticket for it; the brief was the whole input. It asks for: the monorepo, the Access JWT check in front of
  everything, the secrets module, one vertical slice (plans: table, service with `change_log`, REST, MCP tools,
  shell UI) as the worked example, `pnpm check` / `pnpm dev` / `pnpm e2e`, `scripts/deploy.sh` (gate, then
  release with the DNS replacement and the Access setup), and the profile with test prefix `ZZ-TEST`.
- Asked it to register routes, MCP tools and pages by file convention and to timestamp migrations, so later
  Builds have disjoint manifests. Its report will say whether that worked and what remains in
  `paths.always_overlap`.
- The scaffold cannot run the release (no credentials). Unverified until the first Deploy: the Access setup,
  Managed OAuth beside Service Auth, the DNS replacement, the smoke test.
- Requested the credentials from the person this round (the keys in section 3), so they can gather them while
  the scaffold builds. `PLAID_PRODUCTION_SECRET` is optional until Plaid approves production access.
- Next round: when the scaffold has merged, start the nine Discover areas side by side and, once the
  Cloudflare credentials are set, the first Deploy.

### 2026-11-15 · Plan round 1, continued: credentials arrived

Children used 1 of 200. The scaffold Build is still running (no outputs yet); nothing else started, because
nothing else can run before its profile exists.

The person provided all ten keys. Read-only checks (statuses only, no values printed or stored):

- Cloudflare token: active, and it is an **account-owned** token. It verifies at
  `/accounts/{id}/tokens/verify`; `/user/...` endpoints answer 401. Scripts must not call user-level endpoints.
- It can read the `doxen.dev` zone, DNS, Workers scripts and routes, D1, R2, Access apps and Access service
  tokens. No Worker `budget`, D1 `budget-db`, R2 `budget-files` or Access app for the hostname exists yet.
- It cannot read the Access organization (403). The deploy must take the team domain from
  `CF_ACCESS_TEAM_DOMAIN`, not look it up. The team's JWKS endpoint answers with keys, so the domain is real.
- The identity-provider list came back empty. I cannot tell whether that is the token's scope or the
  organization. The service-token smoke test will not catch a missing login method: the person's first browser
  sign-in is the real test. Ask them to try it right after the first Deploy.
- The service token whose id was provided exists in the account.
- DNS: `budget.doxen.dev` has **no record of its own**. The LAN address comes from a wildcard `*.doxen.dev`
  A record. So there is nothing to delete: the Worker's custom domain adds a specific record that wins over
  the wildcard. The wildcard must not be touched.
- Plaid Sandbox: works, and issues a link token for Transactions.
- Plaid Production: the secret is accepted, but a link token is refused with `INVALID_LINK_CUSTOMIZATION`: a
  Data Transparency Messaging use case must be configured in the Plaid dashboard (Link customization). Only
  the person can do that. It blocks linking real banks, nothing before that. The Sandbox and Production
  secrets provided are the same value.
- `SECRETS_ENCRYPTION_KEY` is 32 characters from the base64 alphabet: about 24 bytes, not the base64 of
  32 bytes that the scaffold brief assumed.

Decisions:

- **Key derivation.** Rather than send the person back for another key, the secrets module derives its
  AES-256 key with HKDF-SHA-256 from the value's bytes (key version in the `info`), and refuses values shorter
  than 32 characters. Any high-entropy string then works, and the format can no longer break a deploy. This
  must be settled before the first deploy, because changing it later means re-encrypting.
- I cannot message a running child. **At the scaffold's approval card, check these and request changes for
  any that is missing:**
  1. HKDF derivation as above, with a `scripts/deploy.sh` preflight on the key's length that prints nothing.
  2. No user-level Cloudflare API calls; token check through the account endpoint.
  3. DNS step deletes nothing when no record named exactly `budget.doxen.dev` exists, and never touches the
     wildcard.
  4. No dependency on reading the Access organization.

To tell the person: configure a Data Transparency Messaging use case in Plaid before linking real banks; try a
browser sign-in after the first Deploy.

### 2026-11-15 · Review round 1

Children used 1 of 200. Nothing is running.

**What ended:** the scaffold Build. I approved its card in a side turn; it squash-merged as `2d82719`
(pull request #1). It ran about ten and a half hours from start to merge.

**What I checked before approving** (read at the gated head `c093de0`): gate covered the head, acceptance 17
of 17. The Access check is in front of every route including static assets and fails closed; the local test
token is accepted only when `ENVIRONMENT` is `local`; `workers.dev` and preview URLs are off; nothing
sensitive is committed (`.screenshots/` is ignored). `scripts/deploy.sh` makes no user-level Cloudflare calls,
does not read the Access organization, and its DNS step only considers a record named exactly
`budget.doxen.dev`, so the wildcard is safe.

**What I learned:**

- Registration by file convention works (`import.meta.glob` for routes, MCP tools and pages). A feature adds
  files and edits none; `docs/conventions.md` is the ten-step recipe. Brief every Build to follow it.
- Profile: `paths.shared_modules` and `paths.always_overlap` are set. `apps/worker/src/env.ts` and
  `wrangler.jsonc` are in `always_overlap`: a Build that adds a binding or variable cannot run beside another.
- Migrations: 14-digit UTC timestamp prefix, no journal file.
- The live browser helper is `scripts/access-browser.mjs` (service-token headers, or a cookie storage state).
- Access shape: the script first tries one application with Managed OAuth and both policies; if Cloudflare
  rejects that, it creates a second application for `/mcp`. Which one holds is known after the first Deploy.
- Correction to my earlier note: the key derivation does not have to precede the first deploy. Nothing is
  encrypted until a feature stores a secret, so the deadline is the first Build that stores one (Plaid). The
  first deploy uploads the key as given and never imports it.

**Defect carried forward:** the secrets module requires base64 of exactly 32 bytes; the person's key is a
32-character string, so `setSecret` would throw. Filed as a hardening ticket (below), which must merge before
any Plaid Build.

**Tickets filed this review** (set priority and links in the next plan):

1. Harden the shared Worker modules: HKDF key derivation with a deploy preflight; the Worker also pins the
   allowed email and refuses unknown service tokens; test the idempotency retry and 409 branch.
2. Shell polish: plan menu is 243px against the source's 240px; hover and active colours unmeasured.

**Backlog:** empty apart from those two. No `clone:feature` tickets yet: discovery has not run.

**Still unverified until the first Deploy:** the Access application and policies, Managed OAuth beside Service
Auth, the custom domain over the wildcard record, remote migrations, the smoke test, and whether the person
can sign in from a browser.

**Next plan:** start the nine Discover areas side by side and the first Deploy with `expect_commit` `2d82719`.
Git note: I merged `origin/main` into this branch (no history rewrite) so the journal sits on top of the
scaffold.

### 2026-11-15 · Plan round 2

Children used 7 of 200. One is running: the profile-fix Build.

**Tickets:** both tickets from the review exist. EXF-453 (hardening) set to High. EXF-454 (shell polish) set
to Low and blocked by EXF-453.

**What I started, and what went wrong:** I started the first Deploy, the hardening Build for EXF-453, and the
first three of nine Discover areas. Within a minute the Deploy had refused and all three Discover children had
failed, all at the profile check. Nothing shipped, and they cost nothing (no agent step ran).

- Deploy: `clone.profile.json` lacks `repo.deploy`, `repo.migrations_pending`, `health.version_field`,
  `live.auth_headers_from_env`, `live.recipes.create/get/delete/purge/routes`, `live.never_run`.
- Discover: `clone.profile.json has no source.driver`.

**Cause:** the scaffold Build filled the keys its own template uses. My brief said "fill every key your
template defines", and a Build does not know the other templates' keys. I did not know them either.

**How I found the full list:** the Deploy names its missing keys; Discover names only the first. I read
finished Threads of another clone in this organization that runs the same template versions (a Deploy's
`profile` output, and the first step of a Discover and of a Test user flow). From those:

- Discover needs `source.url`, `source.driver` (`cdp`), `source.single_tab`, `source.signed_out_markers`,
  `paths.screenshots_dir`, `paths.scratch_dir`.
- Deploy with `repo.deploy_phases: true` runs `repo.deploy` with `DEPLOY_PHASE=gate` (and `DEPLOY_E2E=skip`
  when the tree equals the gated commit), then with `DEPLOY_PHASE=release`. It reads `PHASE_SECONDS` lines,
  compares `health.version_field` with a short sha, and reports pending migrations from
  `repo.migrations_pending`.
- Test user flow dumps `live.*`, `source.*` and `paths.*`; its keys look covered by the Deploy's list.
- Those transcripts contained the other project's personal data. I use only the key names and the contract,
  and record nothing else from them.

**Decisions:**

- Cancelled the hardening Build ten minutes in. The profile fix is on the critical path and must change
  `scripts/deploy.sh` for the phases; the hardening Build edits that file too, and both touch
  `paths.always_overlap`, so by the scheduling rule they cannot run together. EXF-453 stays in the backlog
  (commented) and restarts after the profile fix merges and the first Deploy reports, so a deploy-script fix,
  if one is needed, does not collide with it either.
- Started one Build with no ticket (plan step 1: a Build fixes the profile, and nothing that relies on it
  starts until it merges). It adds the keys, the deploy phases, `scripts/migrations-pending.sh`,
  `scripts/live-test-plans.sh` (test plans carry the `ZZ-TEST` prefix) and a test that fails when a required
  profile key is missing. The phase contract is inferred; its report will say how each inferred point was
  built, to read against the first Deploy.
- The other six Discover areas were not started.

**Lessons:**

- Start one child of a template that has never run on this profile and see it pass its profile step before
  starting the rest. Three Discover starts were wasted (budget only; no cost).
- Tell a discovery child to open the source app itself: its browser starts on a blank tab.
- Discover notes are written (area boundaries, the `D1` to `D9` name prefixes so nine agents can share the
  Test Budget, the data rules); reuse the three failed children's inputs and write the other six the same way.

**Next plan, once the profile fix has merged:** one Deploy (`expect_commit` = the fix's merge commit) and one
Discover first; when both pass their profile step, the other eight Discover areas; then EXF-453.
