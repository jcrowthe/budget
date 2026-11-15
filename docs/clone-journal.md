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

Review counters (finished children since that template's last review): Build 4, Deploy 3, Test user flow 0,
Discover 2 (the first ten were sent for review in round 13). Abandoned Builds, not counted: 3. (The Deploy and the three Discover children ended in under a minute at the profile check; the
cancelled Build is not counted.) Last template-ticket sweep: none yet (due about round 30).

| Date | Round | Child (template, Thread) | Ticket | Pull request | Outcome |
|---|---|---|---|---|---|
| 2026-11-15 | 1 | Build feature, scaffold (`p_f3914d573e1043c8a1968e6f1b7f2db4`) | none | [#1](https://github.com/jcrowthe/budget/pull/1) | merged as `2d82719` |
| 2026-11-15 | 2 | Deploy (`p_29df4df509e0410592bdd63ec05be67e`) | none | none | refused at the profile check; nothing shipped |
| 2026-11-15 | 2 | Build feature, EXF-453 hardening (`p_bed242fbbbc24340b340793fd1631f76`) | EXF-453 | none | cancelled by me after three minutes (sequencing) |
| 2026-11-15 | 2 | Discover, area 1 Plan screen (`p_17cd9c4a93fc4e29a08e8f5eddca54c4`) | none | none | failed at load_profile (`source.driver`) |
| 2026-11-15 | 2 | Discover, area 2 targets and Auto-Assign (`p_5d1242cb6d6a4a9eaaac1d9d9d018506`) | none | none | failed at load_profile |
| 2026-11-15 | 2 | Discover, area 3 accounts (`p_1de9980b363444c8a1d738fe29cac7cd`) | none | none | failed at load_profile |
| 2026-11-15 | 2 | Build feature, profile fix (`p_e9bdeb6d31de438a81905eeaec90f8c8`) | none | [#2](https://github.com/jcrowthe/budget/pull/2) draft | abandoned by me at acceptance (no source tab); branch kept at `f788d48`, to resume |
| 2026-11-15 | 4 | Build feature, profile fix resumed (`p_eb0f06b647ef427f9ff82ac6f2418ea9`) | none | none | abandoned by me after 4 minutes: the Clerk never wrote `request.json`; changed nothing |
| 2026-11-15 | 5 | Build feature, profile fix carried over, ordinary Build (`p_c533be0335ee4a789be544d6e8498b9a`) | none | [#3](https://github.com/jcrowthe/budget/pull/3) | merged as `43b7ce9` (25 minutes) |
| 2026-11-15 | 6 | Deploy (`p_429e665e49e9450eb7137c91c53010db`) | none | none | **live** at https://budget.doxen.dev, `DEPLOY_SHA` `43b7ce9` (5 minutes) |
| 2026-11-15 | 6 | Discover, area 1 Plan screen (`p_2f3f00938c2b46abaf16bb38900ac39a`) | 15 tickets, EXF-485 to EXF-509 (interleaved) | none | completed (45 minutes) |
| 2026-11-15 | 6 | Discover, area 2 targets and Auto-Assign (`p_940e7584759144a19491a447beb60fe0`) | EXF-508, 511, 514, 516, 519, 521, 523, 525, 527 and one more | none | completed (47 minutes), 10 tickets |
| 2026-11-15 | 6 | Discover, area 3 accounts (`p_8f7b7c29a6404af9b7329fe46cf09295`) | EXF-481, 482, 483, 484, 486, 488, 490 | none | completed (38 minutes) |
| 2026-11-15 | 6 | Discover, area 4 register (`p_7841a17514924dd39f237af2070af80e`) | EXF-513, 517, 520, 522, 524, 526, 528, 529, 530, 531, 533, 534, 536 | none | completed (50 minutes), 13 tickets |
| 2026-11-15 | 6 | Discover, area 5 linked accounts, view-only (`p_1dca579d8d604381bbdd2de216b284ee`) | EXF-459 to EXF-467 | none | completed (20 minutes), 9 tickets |
| 2026-11-15 | 6 | Discover, area 6 credit cards and loans (`p_4eb8623564154f3589232ae289e58e3d`) | EXF-532, 535, 537 to 547 | none | completed (54 minutes), 13 tickets |
| 2026-11-15 | 6 | Discover, area 7 scheduled transactions and payees (`p_98d4f5de89aa4e6e83b29bd111e2196c`) | EXF-497, 499, 501, 503, 505, 507, 510, 512, 515, 518 and one more | none | completed (43 minutes), 11 tickets |
| 2026-11-15 | 6 | Discover, area 8 Reflect (`p_73da15272400437f8d2c57fa10f63d3f`) | EXF-548 to EXF-553 | none | completed (58 minutes), 6 tickets |
| 2026-11-15 | 6 | Discover, area 9 plan management, settings, export format (`p_ebbda25af70d450ea6fe87f368173e55`) | EXF-468 to EXF-478, EXF-480 | none | completed (23 minutes), 12 tickets |
| 2026-11-15 | 6 | Build feature, EXF-453 hardening (`p_3d67d55e73834f6ca92c9ec15cfbfebd`) | EXF-453 | [#4](https://github.com/jcrowthe/budget/pull/4) | merged as `eabf341` (17 minutes) |
| 2026-11-15 | 8 | Deploy of `eabf341` (`p_daa5ffd48c364b16a2058d8d143820cb`) | none | none | **live** at https://budget.doxen.dev, `DEPLOY_SHA` `eabf341` (3 minutes) |
| 2026-11-15 | 8 | Build feature, EXF-458 source URL (`p_aa92546acd0641409ad3e7199c73f53b`) | EXF-458 | [#5](https://github.com/jcrowthe/budget/pull/5) | merged as `4f1fbb3` (17 minutes) |
| 2026-11-15 | 11 | Build feature, EXF-485 budget engine and core tables (`p_2088a38c1bed40b7b99f7b9f90ef1ea4`) | EXF-485 | pending | running |
| 2026-11-15 | 11 | Build feature, EXF-475 plan-scoped URLs (`p_744621e075094dd988d0cc04103db917`) | EXF-475 | pending | running |
| 2026-11-15 | 13 | Improve templates, review of ten Discover Threads (`p_cf95d417013546b7bc7ac3be0e864c67`) | none | none | running |

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

- Cancelled the hardening Build three minutes in. The profile fix is on the critical path and must change
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

### 2026-11-15 · Review round 2

Children used 7 of 200. One is running: the profile-fix Build (`p_e9bdeb6d31de438a81905eeaec90f8c8`), on
course, no manifest yet. It is the only Build, so the scheduling rule has nothing to check.

**What ended since the last review** (all already read and acted on in plan round 2):

- Deploy `p_29df4df509e0410592bdd63ec05be67e`: refused at the profile check. No live URL, no DEPLOY_SHA,
  nothing shipped. For the next plan: start it again after the profile fix merges, with `expect_commit` set
  to that merge commit and no `gated_commit` unless the fix's gated head still equals the tree.
- Discover `p_17cd…`, `p_5d12…`, `p_1de9…` (areas 1 to 3): failed at `load_profile`, no tickets, nothing to
  triage. Start them again with the same inputs after the fix merges.
- Build `p_bed2…` for EXF-453: abandoned (my cancel). No branch or pull request to resume; a fresh Build
  later. EXF-453 stays in Backlog, commented.

**Backlog:** EXF-453 (High, hardening) and EXF-454 (Low, shell polish, blocked by EXF-453). No
`clone:feature` tickets: discovery has not run yet. No tickets filed this review.

**Waiting on:** the profile-fix Build's approval card.

### 2026-11-15 · Plan round 3

Children used 7 of 200. One is running: the profile-fix Build (`p_e9bdeb6d31de438a81905eeaec90f8c8`). Main is
still at `2d82719`.

Started nothing, and why:

- Deploy and Discover stop without the profile keys that Build adds (plan step 1: nothing that relies on the
  profile starts until the fix has merged).
- EXF-453 edits `scripts/deploy.sh` and always-overlap files, as the running Build does.
- EXF-454 is blocked by EXF-453, and the running Build touches `clone.profile.json` (always-overlap), so no
  second Build runs beside it.

Tickets: none were filed at the last review. Backlog unchanged (EXF-453 High, EXF-454 Low). Plan unchanged.

### 2026-11-15 · Review round 3

Children used 7 of 200. Nothing is running.

**What ended:** the profile-fix Build (`p_e9bdeb6d31de438a81905eeaec90f8c8`), abandoned by my answer on its
card after 29 minutes. Not merged. Main is still `2d82719`.

**Why I abandoned it.** The work was done and reviewed: planned, built, one review finding fixed, reviewer
approved at `f788d48`, `pnpm check` passing (144 tests). It then looped at acceptance. The Tester runs
`/workspace/.exfab/bin/source_check.sh`, which fails with "No open tab of the source app (app.ynab.com) in
the browser", and answers `blocked_env` within about ten seconds. I answered the card three times in side
turns: Proceed, then Retry with an instruction to open the tab itself, and each time the Tester ran the same
check and stopped; it did not act on the instruction. A child's browser starts on a blank tab, nobody in this
Thread opened the source app because the work has no UI, and I cannot reach a child's browser. A fourth
answer of either kind would have looped again, so I chose Abandon in order to resume.

**What is kept:** branch `exfab/p_e9bdeb6d31de438a81905eeaec90f8c8` at
`f788d48a2079f94154ea788176f43729bfa11587` and draft pull request #2. I checked the branch: the profile has
every key the Deploy and Discover templates named, and the diff stays inside its manifest (profile, three
scripts, script tests, docs; nothing under `apps/` or `scripts/lib/`).

**Decision for the next plan:** resume it with a new Build: `resume_branch`, `resume_head` and
`resume_thread` as above, and a brief that starts with BROWSER FIRST (the first agent opens the Test Budget
URL in a new tab and leaves it open). That is what made the source check pass for the scaffold, whose
agents had opened the source app. Not yet proven for a resume: watch its first minutes.

**Lessons:**

- Every Build brief, UI or not, starts with BROWSER FIRST: open
  `https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget` (never the bare site, which could land
  on another plan), leave the tab open, never close it or kill the browser. Same for Discover and Test user
  flow.
- On the `env_stuck` card, Proceed and Retry both go back to the acceptance step, and the Tester does not
  read the Lead's answer as an instruction. Do not answer it twice the same way.
- The Build's preflight has the same source-tab check; there Proceed does get past it.

**Tickets filed this review** (both `clone:template`; set priority in the next plan):

1. Build feature: a Build with no UI should not be blocked by the source-tab check, and the Tester should
   open the source tab itself or act on the Lead's answer.
2. Build feature (scaffold): write every template's profile keys, not only the Build template's.

**Backlog:** EXF-453 (High), EXF-454 (Low, blocked by EXF-453), plus the two above. No `clone:feature`
tickets yet.

### 2026-11-15 · Plan round 4

Children used 8 of 200. One is running: the resumed profile-fix Build (`p_eb0f06b647ef427f9ff82ac6f2418ea9`).

- Tickets from the last review exist: EXF-455 (Build loops at acceptance on the source-tab check) set to
  High; EXF-456 (scaffold writes only its own template's profile keys) set to Medium. Both `clone:template`.
- Started one Build, no ticket, with `resume_branch` `exfab/p_e9bdeb6d31de438a81905eeaec90f8c8`,
  `resume_head` `f788d48a2079f94154ea788176f43729bfa11587` and `resume_thread`
  `p_e9bdeb6d31de438a81905eeaec90f8c8`. Its brief opens with BROWSER FIRST (open the Test Budget URL in a new
  tab over the DevTools port, leave it open), says the work is finished and must not be planned or built
  again, and restates the original brief for the acceptance cases.
- Started nothing else, for the same reasons as round 3: Deploy and Discover need the profile keys; EXF-453
  overlaps this Build on `scripts/deploy.sh`; EXF-454 is blocked by EXF-453.
- Plan unchanged: after it merges, one Deploy and one Discover first, then the other eight Discover areas,
  then EXF-453.

### 2026-11-15 · Review round 4

Children used 8 of 200. Nothing is running. Main is still `2d82719`; the profile fix has not merged.

**What ended:** the resume Build (`p_eb0f06b647ef427f9ff82ac6f2418ea9`), abandoned by my answer on its
second card, four minutes after it started. It changed no file and opened no pull request.

**What happened, from its trace:**

1. `intake` (Clerk): opened the source tab as the BROWSER FIRST block said (it reported three
   `app.ynab.com` tabs), spent the rest of its time reading the old Thread, then answered `ready` saying
   `request.json` was prepared. It never wrote `/workspace/.exfab/request.json`.
2. `resume` (code): `jq: Could not open file /workspace/.exfab/request.json`, then "MISSING: request.json
   names no resume branch". The card that followed said the old work "is not on origin", which is wrong: it
   is on origin at `f788d48`. I answered Rebuild with an instruction to fast-forward the old commits.
3. `preflight` (code): "request.json is missing: the intake step did not write it." No source-tab failure
   this time. Retry would hit the same missing file; Proceed would run without a file later code steps read.
   I abandoned.

**What is kept:** the finished work, untouched, on `origin/exfab/p_e9bdeb6d31de438a81905eeaec90f8c8` at
`f788d48a2079f94154ea788176f43729bfa11587` (draft pull request #2).

**Decision for the next plan:** do not use the resume inputs. Start an ordinary Build whose brief follows
the pattern another clone's Lead used successfully for the same situation (their Thread
`p_701c393d6f6c4d4897cb6aa73a5062fd`, which merged):

- The first lines address the Clerk: write `request.json` with `"tickets": []` and
  `"reserved_migrations": []`, no resume field, and print it back with `jq`; open the source tab with the
  exact command; put the finished commits on the Thread branch first
  (`git merge --ff-only origin/exfab/p_e9bdeb6d31de438a81905eeaec90f8c8`).
- Then: the work is finished, build nothing new; what the diff must look like, so later agents recognise it.

**Lessons (add to every Build brief from now on):**

- Keep the Clerk's part short and first, with a print-back check on `request.json`. A long brief led this
  Clerk to read history instead of doing its two jobs.
- BROWSER FIRST works when it is in the brief: the first agent runs it.
- A card answer's text is not a reliable way to instruct a child's agents. Put instructions in the brief.

**Tickets:** commented on EXF-455 with the evidence that the brief-level workaround opens the tab. Filing one
new `clone:template` ticket: the Clerk can answer ready without writing `request.json`, and the resume
card then misreports the cause.

**Backlog:** EXF-453 (High), EXF-454 (Low, blocked by EXF-453), EXF-455 (High, template), EXF-456 (Medium,
template). No `clone:feature` tickets yet.

**Cost so far of getting the profile fix merged:** three Build starts (one finished the work, two lost to
platform steps), about 40 minutes of wall time, no product risk.

### 2026-11-15 · Plan round 5

Children used 9 of 200. One is running: `p_c533be0335ee4a789be544d6e8498b9a`.

- EXF-457 (Clerk answers ready without writing `request.json`) exists; set to High.
- Started one ordinary Build, no ticket and no resume inputs, to carry the finished profile fix to merge.
  Its brief opens with three numbered jobs for the Clerk, each with a command and the output it must print:
  write `request.json` and print it back; open the Test Budget tab (only if none is open); fast-forward
  `origin/exfab/p_e9bdeb6d31de438a81905eeaec90f8c8` onto the Thread branch and print `f788d48…` and the
  diff's shape (15 files, 1632 added, 209 removed). Then one line per later role saying what not to redo.
- Started nothing else, as in rounds 3 and 4: everything else needs the profile keys or overlaps this Build.
- If this one stalls too, the next step is to ask the person, not a fourth attempt: three Threads lost on
  platform steps for one small change would mean something I cannot route around from the brief.

### 2026-11-15 · Review round 5

Children used 9 of 200. Nothing is running.

**What ended:** the ordinary Build carrying the profile fix (`p_c533be0335ee4a789be544d6e8498b9a`). I
approved its card in a side turn; it squash-merged as `43b7ce92d2b3cf3a75031f80fb7459c093c52d31` (pull
request #3), 25 minutes after it started. No ticket to move. Pull request #2 (the first attempt's draft) is
superseded.

**The profile is now complete on main** for the Deploy and Discover templates: `repo.deploy`,
`repo.deploy_phases`, `repo.migrations_pending`, `health.version_field`, `source.driver`, `live.health_path`,
`live.auth_headers_from_env`, `live.auth`, `live.recipes.*`, `live.never_run`. `pnpm check` now fails if a
required key goes missing.

**What I checked before approving:** gate covered the head (`4d1f87c`, base unchanged). Against the head
reviewed earlier (`f788d48`) there were three small commits: two fail-closed fixes in the scripts, the rest
tests. Nothing under `apps/` or `scripts/lib/`.

**Accepted knowingly, to fix next:** the codify step added to `scripts/test/repo-hygiene.test.ts` a block
asserting that `apps/` and `scripts/lib/` are unchanged since `2d82719` and that nothing outside that
manifest changed. It fails for the first Build that touches `apps/`. EXF-453 is the next Build, runs alone
and touches `apps/`: I commented on the ticket that its first step is to delete that block. No other Build
starts before EXF-453 has merged, or it would hit the same failing test.

**The brief pattern that worked** (use it for every Build):

1. Title line says what the Clerk does first.
2. Clerk section: numbered jobs, each a command plus the exact output it must print (`request.json` printed
   back; the source tab; for carried-over work, the fast-forward and the expected head and diff shape).
3. One line per later role.
4. Then the context.

**Inferred points for the first Deploy to confirm** (from `docs/profile-completion-design.md`):

- The template runs `repo.deploy` with `DEPLOY_PHASE=gate`, then `DEPLOY_PHASE=release` on the same checkout.
- It reads a line starting with `PHASE_SECONDS`.
- `repo.migrations_pending` prints bare file names, one per line; nothing when none.
- Each `live.recipes.*` value is a command followed by a `# prints …` comment.
- The health answer's `deploy_sha` is the full sha; the template may compare a short one.
- Untested locally: the real D1 query in `scripts/migrations-pending.sh` and the whole release.

**Backlog:** EXF-453 (High, gap), EXF-454 (Low, gap, blocked by EXF-453), EXF-455, EXF-457 (High, template),
EXF-456 (Medium, template). No `clone:feature` tickets yet. No tickets filed this review.

**Next plan:** one Deploy (`expect_commit` `43b7ce9…`, `gated_commit` `4d1f87c`) and one Discover (area 1)
first; when both are past their profile step, the other eight Discover areas. EXF-453 after the Deploy
reports.

### 2026-11-15 · Plan round 6

Children used 20 of 200. Ten are running: nine Discover areas and the EXF-453 Build. The Deploy started this
round has already finished.

**The clone is live:** https://budget.doxen.dev at `43b7ce92d2b3cf3a75031f80fb7459c093c52d31`. First deploy,
passed on the first run of the release (Deploy `p_429e665e49e9450eb7137c91c53010db`, 5 minutes).

- Gate: `pnpm check` 42 s; e2e skipped because the tree equalled the gated head.
- Release: D1 `budget-db` and R2 `budget-files` created, three migrations applied, Worker deployed on the
  custom domain, smoke test ok.
- **Access shape: `combined`.** One application holds Managed OAuth, the Allow policy and the Service Auth
  policy; Cloudflare accepted it. The open question from the architecture is answered at the API level. Not
  yet tried: an MCP client actually signing in through Managed OAuth.
- Verified live by the Deploy's verifier: unauthenticated `/`, `/api/v1/health` and `/mcp` answer 401; with
  the service token `/api/v1/budgets` answers 200 and `/mcp` lists `list_budgets` and `create_budget`; the
  test-plan recipes (create, list, delete, purge) work and left nothing behind; the home page loads in a
  browser with no errors.
- **Access issues a `CF_Authorization` cookie to the service token**, so flow-test children can hold a
  browser session (`scripts/access-browser.mjs storage-state`).
- The inferred contract fits: `PHASE_MODE=split`, the `PHASE_SECONDS` line is read, the health sha is
  compared by prefix, `repo.migrations_pending` listed the three files before and none after.
- Not done by the verifier: it did not look at D1, R2, DNS or the Worker directly, and it did not open the
  Reflect or Accounts pages.
- **Not yet known: whether the person can sign in from a browser.** Ask them to try.

**What I started and why:**

- Deploy and Discover area 1 first; both passed their profile step within 80 seconds, so the profile fix
  works for both templates. Then Discover areas 2 to 9. All nine briefs open with BROWSER FIRST and the rule
  never to open the bare site; each agent names what it creates `D1 ` to `D9 ` so nine can share the Test
  Budget. Area 5 may open one extra URL, the permitted Programmatik account page, look-only, recording no real
  payee or amount. Area 9 is read-and-cancel, and specifies the export file format for the importer.
- EXF-453 as soon as the Deploy had passed (no deploy-script fix to collide with). It runs alone: it is the
  only Build. Its step 0 deletes the stale hygiene test. Ticket moved to In Progress.
- Not started: EXF-454 (blocked by EXF-453; it also needs the shell untouched by others). No Test user flow
  yet: the live clone has only the plans example, so flows 1 to 10 have nothing to walk; flow 11 (the Access
  lock) was in effect checked by the Deploy's verifier. First flow tests after the foundation Builds.

**Risks I am watching:** nine agents in one YNAB plan at once (name prefixes are the only separation); the
Discover children's screenshots are stored as artifacts, so the briefs forbid real data in them.

### 2026-11-15 · Review round 6

Children used 20 of 200. Ten are running: nine Discover areas (all at their explore step, all signed in) and
the EXF-453 Build (at its plan step, past intake and preflight).

**What ended:** the Deploy `p_429e665e49e9450eb7137c91c53010db`, completed. Live URL
https://budget.doxen.dev, `DEPLOY_SHA` `43b7ce9`. Details are in the plan round 6 entry above; nothing new.

**What I learned from the running children:**

- The Discover template's sign-in check opens the profile's `source.url`, which is the bare
  `https://app.ynab.com`, whatever my notes say (the notes reach the explore step, not that one). Area 5's
  agent did exactly that. It landed on the Test Budget, because that was the plan used last. YNAB opens the
  last-used plan, so if another plan is ever the last one used, a child's first page would be that plan.
  Area 5 is the only child allowed onto a Programmatik page, and its brief tells it to return to the Test
  Budget URL when done, which resets the last-used plan.
- The fix is in the profile, not the briefs: make `source.url` the Test Budget URL. The source-tab check
  names the host (`app.ynab.com`), so it should still match; the Build must confirm that. Filing a ticket.

**Backlog:** EXF-453 In Progress (High). EXF-454 Low, blocked by EXF-453. Template tickets EXF-455, EXF-457
(High), EXF-456 (Medium). No `clone:feature` tickets yet: the first discovery reports are due. Filing one
`clone:gap` ticket this review (profile `source.url`).

### 2026-11-15 · Plan round 7

Children used 20 of 200. Ten are running, all started in round 6: nine Discover areas and the EXF-453 Build.

- EXF-458 (profile `source.url` to the Test Budget URL) exists; set to High and blocked by EXF-453. It edits
  `clone.profile.json`, an always-overlap file, so it waits for the running Build.
- Started nothing. EXF-458 and EXF-454 both wait on EXF-453; no `clone:feature` tickets exist yet; the live
  clone has nothing new to deploy or to walk in a flow test.
- Order after EXF-453 merges: EXF-458 next and alone (it is small and closes a privacy gap for every later
  child), then the foundation Builds from discovery, then EXF-454.

### 2026-11-15 · Review round 7

Children used 20 of 200. Nine are running: the nine Discover areas, about 20 minutes in.

**What ended:** the EXF-453 Build. I approved its card in a side turn; it squash-merged as
`eabf341c96392b1ce5d2853ed7f9248641d237a5` (pull request #4) 17 minutes after it started, with no stall: the
brief pattern (Clerk jobs first, each with a print-back) worked a second time. Ticket moved to Done.

**What it changed:** the secrets module derives its AES-256 key with HKDF-SHA-256 from any key of 32
characters or more (the person's key now works); the Worker itself accepts only `ACCESS_ALLOWED_EMAIL` and
service tokens in its map, and fails closed otherwise; the idempotency retry and 409 branches are tested;
the stale hygiene test is gone, so Builds that touch `apps/` no longer trip on it.

**Checked before shipping it:** the hardened Worker refuses a service token whose `common_name` claim is
not in its map. With the credentials in my box I made one read-only call to the live health route and
decoded the Access cookie: `common_name` equals `CF_ACCESS_CLIENT_ID`, `sub` is empty, no email claim. So the
tests' and scripts' service token will still get in after the deploy.

**Not live yet:** live is still `43b7ce9`. The next plan deploys `eabf341` (`gated_commit` `d525be5…`, trees
equal). After that deploy the person's browser sign-in depends on `ACCESS_ALLOWED_EMAIL` matching the email
in their Access token; the Deploy cannot test that, only they can.

**Backlog:** EXF-458 (High, gap) is now unblocked and is the next Build, alone. EXF-454 (Low) unblocked too,
but waits: shell-only, and not worth a slot before the foundation. Template tickets EXF-455, EXF-457 (High),
EXF-456 (Medium). No `clone:feature` tickets yet; discovery reports are due. No tickets filed this review.

### 2026-11-15 · Plan round 8

Children used 22 of 200. Ten are running: eight Discover areas, a Deploy and the EXF-458 Build. One Discover
child finished while I was starting these; the review triages its tickets.

- No tickets were filed at the last review.
- Started a Deploy of `eabf341` (EXF-453), `gated_commit` `d525be5…` (trees equal, so the gate skips the full
  e2e run). Its brief names what changed in the live Worker and what to check: the service token still gets
  in, unauthenticated requests are still refused, the recipes still work. It cannot check the person's
  browser sign-in under the new email pin.
- Started the Build for EXF-458 (profile `source.url` to the Test Budget URL), alone: it is the only Build.
  Ticket moved to In Progress. A Deploy runs beside it; a Deploy changes nothing in the repository.
- Not started: EXF-454 (shell polish, Low). It would have to run beside EXF-458, which touches an
  always-overlap file; and the foundation Builds from discovery should take the next slots.

### 2026-11-15 · Review round 8

Children used 22 of 200. Ten are running: eight Discover areas, the Deploy of `eabf341` and the EXF-458 Build.

**What ended:** Discover area 5, linked accounts (`p_1dca579d8d604381bbdd2de216b284ee`), completed in 20
minutes with nine `clone:feature` tickets, EXF-459 to EXF-467. It stayed inside its limits: on the
Programmatik account page it only hovered and read; its screenshots of that page mask every payee, category,
memo, amount, balance and account name; nothing real went into a ticket.

**Triage (priority; blocked by):**

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-459 | Connect a bank with Plaid Link from the Add Accounts bank search | High | none yet |
| EXF-460 | Manage Bank Connections: list, detail, nickname, Reset, Remove | Medium | EXF-459 |
| EXF-461 | Link a bank account to a plan account, with a Starting Balance; unlink | High | EXF-459 |
| EXF-462 | Import transactions from Plaid: scheduled sync and Sync now | High | EXF-461 |
| EXF-463 | Imported transactions: approve, reject, "This needs a category", banner | High | EXF-462 |
| EXF-464 | Match imported to hand-entered transactions, and unmatch | Medium | EXF-462 |
| EXF-465 | Connection status: sidebar icon, header badge, Repair banner, update mode | Medium | EXF-462 |
| EXF-466 | Pending bank transactions and Enter Now | Low | EXF-463 |
| EXF-467 | Imported payee renaming rules and Bank Import Details | Low | EXF-462 |

All nine also need accounts (area 3) and the register (area 4), whose tickets do not exist yet; EXF-467
needs Manage Payees (area 7). Add those blocking links when those areas report. No Plaid Build starts before
the foundation. None is a duplicate or out of scope.

**Choices the area-5 agent made that are not from the source** (keep in mind when briefing the Builds):
"Sync now" is ours (the source has no manual import); the Plaid error to status mapping and the copy for
statuses it could not see; imports start on the link date for a never-reconciled account; match tie-break is
closest date then oldest entry; "editing an unapproved transaction approves it" is an assumption. EXF-464 and
EXF-466 are from the help pages only. Two wording slips it flagged itself: EXF-461's "with the user actor"
(its own criterion 8 expects `mcp:` for MCP calls) and EXF-466 labelling Plaid details as "help".

**Left for other areas, from its report:** reconcile against the bank balance (area 4); Manage Payees rename
rules (area 7); the plan's "Uncategorized Transactions" section (area 1); the register filters "Is: Matched"
and "Unapproved or Uncategorized" (area 4). Check those areas' tickets cover them; file what is missing then.

**What I learned: the children share one browser.**

- Area 5 reported "The browser tab is shared with other agents: it moved to other Test Budget pages during
  my session." Earlier, a fresh Build's Clerk counted three `app.ynab.com` tabs in a box no agent had used.
  The DevTools port is the same in every box. So there is one signed-in Chrome for the whole project, and
  every child that finds "the" source tab drives the same tab.
- Consequences. (1) Correctness: nine agents navigating one tab step on each other; they notice and
  re-navigate, and area 1 once dragged another agent's category and put it back. (2) Privacy: while area 5 had
  the tab on the Programmatik account page, another agent reading or capturing "its" tab would have seen that
  page. Area 5 has finished and left the tab on the Test Budget, and no other child may open that page, so
  the window is closed. When the other eight report, read their process notes for any sign they saw a page
  they should not have; their screenshots are artifacts on the platform, not in the repository.
- The Bank Connections dialog, opened from the Test Budget, lists the person's real bank connections (they
  belong to the user, not the plan). Area 5 masked them. Children on accounts or bank work will see it too.
- From now on every brief that touches the source says: open **your own** tab, keep its target id, and drive
  only that tab. And no two children are on a non-test page at once (only area 5 ever was).
- Not cancelling the eight running Discover children: they are 25 minutes into work of about that length,
  they are coping, and their tickets are being filed. Flow tests later check the behaviour they describe.
- Filing a `clone:template` ticket.

**Running Builds and the scheduling rule:** EXF-458 is the only Build; no manifest yet.

**Backlog:** 9 `clone:feature` tickets triaged (EXF-459 to EXF-467); area 9 has begun filing EXF-468 onward
and is still running, so those wait for its report. Gap tickets: EXF-458 In Progress, EXF-454 Low. Template
tickets: EXF-455, EXF-457 (High), EXF-456 (Medium).

### 2026-11-15 · Plan round 9

Children used 22 of 200. Nine are running: eight Discover areas and the EXF-458 Build.

- EXF-479 (children share one browser tab) exists; set to High.
- The Deploy of `eabf341` finished while I was in the review: **live** at https://budget.doxen.dev,
  `DEPLOY_SHA` `eabf341`. With the service token: health 200 with the new sha, `GET /api/v1/budgets` 200,
  `/mcp` answers `tools/list`; without credentials `/`, `/api/v1/health` and `/mcp` answer 401; the recipes
  work and left nothing behind; the home page loads with no errors. So the identity pin did not lock the
  service token out. Not checked by it: whether wrangler printed or hid `ACCESS_ALLOWED_EMAIL`, and the
  person's own browser sign-in under the pin.
- Started nothing. EXF-458 is running and touches an always-overlap file, so no other Build runs beside it.
  The Plaid tickets wait on foundation tickets that the still-running Discover areas have not filed. Area 9
  is filing its tickets (EXF-468 onward, with EXF-476 export and EXF-477 import among them); they are triaged
  when it reports. Nothing new is merged to deploy, and the live clone has only the plans example to test.

### 2026-11-15 · Review round 9

Children used 22 of 200. Eight are running: seven Discover areas (1 to 4, 6 to 8) and the EXF-458 Build.

**What ended:**

- Deploy `p_daa5ffd48c364b16a2058d8d143820cb`: live at https://budget.doxen.dev, `DEPLOY_SHA` `eabf341`
  (recorded in plan round 9).
- Discover area 9, plan management and settings (`p_ebbda25af70d450ea6fe87f368173e55`): completed in 23
  minutes with twelve `clone:feature` tickets. It worked read-and-cancel as briefed: no setting saved, no plan
  created, renamed, reset or deleted; the plans list page was not opened.

**Triage of area 9 (priority; blocked by):**

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-468 | Plan formats: currency, number format, placement, date format (Plan Settings) | High | none |
| EXF-475 | Plan-scoped URLs, page titles and browser history | High | none |
| EXF-477 | Import a plan from a YNAB export zip | High | foundation tickets, to link when filed |
| EXF-469 | New Plan dialog | Medium | EXF-468 |
| EXF-470 | Plan menu: full entry list, sections, Open Plan submenu | Medium | none |
| EXF-471 | Plans list page with create and delete | Medium | EXF-469 |
| EXF-476 | Export Plan: zip with Plan and Register files | Medium | foundation tickets, to link when filed |
| EXF-472 | Display Options: theme, progress bars, balance style | Low | none |
| EXF-473 | Keyboard Shortcuts dialog and universal shortcuts | Low | none |
| EXF-474 | Sidebar collapse, expand and resize | Low | none |
| EXF-478 | Make a Fresh Start | Low | none |
| EXF-480 | Plan flag names (Edit Flags) | Low | register flags (area 4), to link |

None is a duplicate. EXF-468 and EXF-475 are foundation: every screen formats amounts and lives under a plan
URL, so they go early. EXF-477 is the person's decision 4 (their YNAB history); the export format in EXF-476
is its specification. EXF-471 and EXF-478 rest on help pages and interface text only (no screenshots).

**EXF-454 changed:** area 9 measured the source's plan menu at 243px, not 240px, so the width may need no
change. Commented on the ticket and blocked it by EXF-470, which rebuilds the menu.

**Privacy notes from its report, for the person:** it opened the bare site once in the sign-in check (landed
on the Test Budget; EXF-458 fixes the cause); recent-plan names appeared once in its own working output and
are in no ticket, screenshot or file; plan names in the menu screenshots were replaced with placeholders.

**Not exploring, unless the person asks:** the account-level "open last used plan" setting (an
account-settings page) and "Hide Amounts". **To check against areas 4 and 8 when they report:** Export
Selected Transactions, the Reflect export file format, file import into an account.

**Backlog now:** 21 `clone:feature` tickets (9 Plaid, 12 plan management), all triaged. Gap: EXF-458 In
Progress; EXF-454 Low, blocked by EXF-470. Template: EXF-455, EXF-457, EXF-479 (High), EXF-456 (Medium).
The core areas (plan grid, targets, accounts, register, credit, scheduled, reports) have not reported yet.

### 2026-11-15 · Plan round 10

Children used 22 of 200. Eight are running, all started earlier: seven Discover areas (1 to 4, 6 to 8) and
the EXF-458 Build, which is at its checks step with no open card.

- No tickets were filed at the last review.
- Started nothing. Two High feature tickets have nothing blocking them (EXF-468 plan formats, EXF-475
  plan-scoped URLs), but EXF-458 edits `clone.profile.json`, an always-overlap file, so no Build runs beside
  it. They start when it has merged.
- EXF-468 and EXF-475 may not run side by side either: both change the plans resource and the web shell or
  router (shared modules). Order: EXF-475 first (routing under every page), then EXF-468.
- The data model and engine Build, which everything else needs, waits for areas 1 to 4 to report: its
  tickets do not exist yet.

### 2026-11-15 · Review round 10 (check-in)

Children used 22 of 200. Eight are running: seven Discover areas (1 to 4, 6 to 8) and the EXF-458 Build.
Nothing ended since the round 9 review. Round 10 is a check-in: sent the person a progress report (live URL,
what landed and failed, backlog, risks, next steps, and the two things only they can do: try signing in, and
configure Plaid's Data Transparency Messaging). No tickets filed.

Totals so far: 22 children. Builds: 3 merged (scaffold, profile fix, EXF-453), 3 abandoned, 1 running.
Deploys: 2 live, 1 refused. Discover: 2 completed (21 tickets), 3 failed at the profile step, 7 running.

### 2026-11-15 · Plan round 11

Children used 24 of 200. Running: two Builds started this round (EXF-485, EXF-475) and the Discover areas
still exploring (2, 4, 6, 7, 8 at the start of the round; two more finished while I worked and are triaged at
the review).

**Ended since the check-in, handled here because Builds depended on it:**

- EXF-458 merged as `4f1fbb3` (pull request #5); ticket Done. `source.url` is now the Test Budget URL, and
  the source-tab check matches by host, so a tab on any Test Budget page passes. No template step can open
  the bare site any more. Nothing to deploy from it (profile and a test only).
- Discover area 1, Plan screen: 15 tickets. Discover area 3, accounts: 7 tickets. Both cleaned up their test
  data.

**Privacy incident, to tell the person plainly.** Area 1's sign-in check (a template step that ran before my
notes reached the agent) opened the bare site and **landed on the Programmatik plan's Plan page**, not the
Test Budget. The person allowed one account page of that plan and nothing else. The agent took the sign-in
screenshot, then saw the plan was wrong, deleted the screenshot, moved the tab to the Test Budget and
explored only there; its report says nothing from that plan is in any ticket or screenshot, and its artifact
list has no sign-in screenshot. The page was in the agent's view for under a minute. Cause closed by EXF-458.
Earlier I had believed every such open landed on the Test Budget; that was true for the later agents only
because area 1 had by then moved the tab.

**Triage (all set this round):**

- Engine and grid (area 1): EXF-485 Urgent. High: EXF-487 grid (after 485); EXF-494 category CRUD, EXF-489
  inline assign, EXF-491 Ready to Assign pill, EXF-493 month navigation (each after 487); EXF-492 move money
  (after 489). Medium: EXF-495 hide (after 494), EXF-496 reorder (after 494), EXF-498 selection, EXF-500
  view chips, EXF-509 Activity popover (after 487), EXF-504 Undo/Redo (after 489), EXF-506 Recent Moves
  (after 492). Low: EXF-502 custom views (after 500).
- Accounts (area 3): High: EXF-481 account resource and unlinked accounts (after 485), EXF-483 sidebar groups
  and EXF-484 headers (after 481). Medium: EXF-482 loan types (after 481), EXF-486 edit dialog (after 483),
  EXF-488 close, reopen, delete (after 486). Low: EXF-490 reorder (after 483).
- Cross-area links added: EXF-459 (Plaid Link) after EXF-481; EXF-477 import and EXF-476 export after
  EXF-485 and EXF-481.
- No duplicates. Area 1 referenced EXF-472 and EXF-473 instead of duplicating them.
- Open points from area 1's report, for the Builds: Ready to Assign totals were seen only as differences
  (nine agents shared the plan); the earliest-month limit is inferred; Ctrl+Y is Redo, Ctrl+Shift+Z did
  nothing; "Show all hidden categories" unhides everything.

**Design decision for the foundation (mine, recorded on the tickets):** the engine Build (EXF-485) also
creates the `accounts` and `transactions` tables, with the columns EXF-481 lists, because Activity and Ready
to Assign read them and three tickets would otherwise each invent them. "Inflow: Ready to Assign" is a boolean
on the transaction. In EXF-485 the writes are services with their history rows; their routes, tools and
screens come with EXF-494, 489, 492, 493, 481 and the register tickets.

**Started, and why these two together:**

- EXF-485 (engine, core tables, months read model, MCP tool): Worker and `packages/core` only.
- EXF-475 (plan-scoped URLs, titles, history, `last_opened_at`): web router and shell, plus the existing
  `budgets` files and one migration.
- Their manifests are disjoint as briefed: EXF-485 is told not to touch `apps/web/` or the `budgets` files;
  EXF-475 is told not to touch `packages/core`, to add no API path (so only EXF-485 edits the OpenAPI path
  list) and to record `last_opened_at` through the existing PATCH. Neither may edit an always-overlap file.
  Check both manifests when they arrive.
- Both briefs give the child its **own source tab** (a new tab whose id it stores) and say the browser is
  shared.
- Not started: EXF-468 (plan formats): it changes the `budgets` files and the shell, as EXF-475 does.

**Ticket writes are rate limited: 60 per hour for this Thread.** I hit the limit at the end of this round.
Not done, to do first next round: comment on EXF-485 with the Lead's scope notes; move EXF-475 to In Progress
and comment with its child and scope notes. Rules from now on: set priority and blocking links in one call;
triage a discovery report's High tickets first and leave Low ones for a later round; spend comments only
where a Build needs them.

### 2026-11-15 · Review round 11

Children used 24 of 200. Five are running: the Builds for EXF-485 and EXF-475 (three minutes in, no manifest
yet) and Discover areas 4 (register), 6 (credit) and 8 (reports), which are already filing tickets.

**What ended:** Discover area 2 (targets, Auto-Assign, inspector, right panel) with 10 tickets, and Discover
area 7 (scheduled transactions, payees, rules) with 11. Both created only their own prefixed data and deleted
it; area 2 never ran the plan-wide Auto-Assign. Area 7 notes that the plan menu showed other plans' names and
that it deleted the one screenshot that captured them at once.

**Triage decided, not yet written to the tickets.** Ticket writes are rate limited to 60 an hour and the
budget is spent until about 21:05 UTC (most of this hour's writes were made between 20:01 and 20:27). Apply
these in the next plan rounds, High first, one call per ticket with priority and links together.

Area 2:

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-511 | Targets engine: needed this month, funded, status | High | EXF-485 |
| EXF-521 | Category inspector: header, Available breakdown, notes | High | EXF-487 |
| EXF-508 | Target form: create, edit, delete | High | EXF-511, EXF-521 |
| EXF-514 | Targets display: grid text, pill, progress bar, Target card | High | EXF-508 |
| EXF-519 | Auto-Assign: per category, multi-select, plan-wide | High | EXF-511, EXF-521 |
| EXF-523 | Right panel: month summary and multi-selection summary | Medium | EXF-487 |
| EXF-516 | Snooze a target, Shift+Z, Snoozed view | Medium | EXF-514 |
| EXF-525 | Cost to Be Me and expected income | Low | EXF-511 |
| EXF-527 | Assigned in Future Months | Low | EXF-523 |

Area 7:

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-507 | Payee picker: sections, new, transfer, hidden, system payees | High | EXF-517 |
| EXF-497 | Scheduled transactions: create, edit, delete, 13 repeat options | Medium | EXF-517 |
| EXF-499 | Coming due: Enter Now and the daily job | Medium | EXF-497 |
| EXF-505 | Upcoming scheduled transactions on categories | Medium | EXF-497, EXF-487 |
| EXF-510 | Manage Payees: list, search, rename, hide, delete, unused | Medium | EXF-513 |
| EXF-515 | Remembered category per payee | Medium | EXF-517 |
| EXF-501 | Scheduled splits and scheduled transfers | Low | EXF-497, EXF-524, EXF-526 |
| EXF-503 | Make Repeating | Low | EXF-497 |
| EXF-512 | Combine payees | Low | EXF-510 |
| EXF-518 | Payee renaming rules on file import | Low | EXF-510, EXF-531 |

Also owed from round 11's plan: the scope comment on EXF-485; EXF-475 to In Progress with its comment. And
when area 4 reports, link EXF-467 (Plaid payee renaming) after EXF-510, and EXF-480 (flag names) after
EXF-522.

**Seen already from the areas still running** (to triage at their reports): register tickets EXF-513
(transactions API and register table; the register's foundation, after EXF-481), EXF-517 (add and edit
inline), EXF-520, 522, 524, 526, 528 to 531, 533, 534; credit engine tickets EXF-532 and EXF-535.

**No duplicates found** between areas 2, 7 and the earlier ones. Two overlaps to watch, not duplicates:
EXF-504 (Undo/Redo on the Plan) with EXF-530 (in the register), which should share one mechanism over
`change_log`; and EXF-518 with EXF-467, both payee renaming, one for files and one for Plaid.

**Backlog:** about 70 `clone:feature` tickets, 43 triaged on the tickets, 21 triaged here only, the rest
arriving. Gap: EXF-454. Template: EXF-455, EXF-457, EXF-479 (High), EXF-456 (Medium). No tickets filed this
review.

### 2026-11-15 · Plan round 12

Children used 24 of 200. Four are running: the Builds for EXF-485 and EXF-475 (both at their plan step, past
intake and preflight, no open card) and two Discover areas; a third Discover area finished since the review
and is triaged at the next one.

- No tickets were filed at the last review.
- Started nothing. Every open High ticket waits on EXF-485 or EXF-475; EXF-468 overlaps EXF-475 on the
  `budgets` files and the shell; nothing new is merged to deploy.
- Ticket writes are still rate limited (20:31 UTC; the budget frees from about 21:05). Owed writes stay as
  listed in review round 11.

### 2026-11-15 · Review round 12

Children used 24 of 200. Four are running: the Builds for EXF-485 and EXF-475 (at their plan step) and
Discover areas 6 (credit) and 8 (reports).

**What ended:** Discover area 4, the transaction register, with 13 tickets. It worked only with its own
prefixed accounts, categories, payees and small made-up import files, and deleted all of them. It did observe
matching and unmatching of imported rows (through file import), which area 5 could only take from the help
pages: use its tickets to check EXF-464 when the Plaid work starts.

**Triage decided, not yet written to the tickets** (rate limit, as in review round 11):

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-513 | Register foundation: transactions API, table, sorting, balances | High | EXF-481 |
| EXF-517 | Add and edit a transaction inline | High | EXF-513 |
| EXF-524 | Split transactions | High | EXF-517 |
| EXF-526 | Transfers between accounts | High | EXF-517 |
| EXF-533 | Reconcile an account | High | EXF-517 |
| EXF-534 | All Accounts register | Medium | EXF-513 |
| EXF-520 | Selection and action bar (bulk edit) | Medium | EXF-517 |
| EXF-522 | Transaction flags | Medium | EXF-513 |
| EXF-528 | Register search | Medium | EXF-513 |
| EXF-529 | Register View options, running balance | Medium | EXF-513 |
| EXF-530 | Undo and Redo in the register | Medium | EXF-517 |
| EXF-531 | File Import: CSV, TSV, OFX, QFX, QIF | Medium | EXF-517 |
| EXF-536 | Transaction images (receipts, stored in R2) | Low | EXF-517 |

No duplicates. EXF-513 is the register's foundation and extends the `transactions` table the engine Build
creates. With it, the foundation chain is: EXF-485, then EXF-481 and EXF-487 side by side, then EXF-513 and
the Plan tickets.

**Discover cadence reached:** ten Discover children have finished (three failed at the profile step, seven
completed). Start Improve templates on the Discover template in the next plan with those ten Thread ids.

**Backlog:** about 85 `clone:feature` tickets: 43 triaged on the tickets, 34 triaged in the journal only
(areas 2, 7 and 4), areas 6 and 8 still filing. No tickets filed this review.

### 2026-11-15 · Plan round 13

Children used 25 of 200. Five are running: the Builds for EXF-485 and EXF-475, Discover areas 6 and 8, and
the Improve templates review started this round.

- No tickets were filed at the last review.
- Started Improve templates in review mode on the Discover template with its first ten finished Threads
  (three failed at the profile step, seven completed). Its notes carry the required sentence, point at the
  open template tickets (EXF-455, 456, 457, 479) so it adds evidence instead of duplicating, and ask it to
  check four things I saw: the sign-in check runs before the Lead's notes arrive; nine agents shared one
  test plan; agents masked personal details on their own initiative; dependencies are written as titles, so
  the Lead sets links by hand under a 60-per-hour write limit.
- Started nothing else: every open High ticket waits on EXF-485 or EXF-475.
- Ticket writes still rate limited at 20:33 UTC; owed writes as listed in review rounds 11 and 12.

### 2026-11-15 · Review round 13

Children used 25 of 200. Four are running: the Builds for EXF-485 and EXF-475, Discover area 8 (reports) and
the Improve templates review.

**What ended:** Discover area 6, credit cards, loans and tracking accounts, with 13 tickets. It used only its
own prefixed accounts and categories. It exercised funded card spending, credit, cash and mixed overspending
in both orders across a month boundary with Ready to Assign differences measured, paying a card exactly,
under and over, refunds, card targets, loan payments with the escrow, interest and principal split, and
tracking transfers.

**Triage decided, not yet written to the tickets** (rate limit):

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-532 | Credit engine: payment categories, funded spending, payments, refunds | High | EXF-485, EXF-481 |
| EXF-535 | Credit engine: credit vs cash overspending, mixed attribution, covering | High | EXF-532 |
| EXF-537 | Plan: Credit Card Payments rows, PAYMENT header, payment inspector | High | EXF-532, EXF-487, EXF-521 |
| EXF-539 | Credit card account page: Payment pill and Record Payment | High | EXF-532, EXF-526 |
| EXF-538 | Credit card payment targets | Medium | EXF-511, EXF-537 |
| EXF-546 | Tracking accounts: rules, transfers, balance updates | Medium | EXF-513, EXF-526 |
| EXF-547 | Account type rules for credit and debt (sign at entry, effect on the plan) | Medium | EXF-481 |
| EXF-540 | Loan engine and Account Activity; Record Payment | Medium | EXF-482, EXF-513 |
| EXF-541 | Loan account page: tiles, payoff date, progress chart | Low | EXF-540 |
| EXF-542 | Loan Add Activity: credit, fee, interest | Low | EXF-540 |
| EXF-543 | Loan Update Balance wizard | Low | EXF-540 |
| EXF-544 | Loan payoff simulator | Low | EXF-541 |
| EXF-545 | Loan paired category and Debt Payment Target | Low | EXF-540, EXF-511 |

**Possible overlap to resolve before building:** EXF-547 states account-type rules that EXF-481 (sign at
entry, on-plan or tracking) and EXF-546 (tracking) also state. Read the three side by side before any of them
is built after EXF-481; if EXF-547 adds nothing once those are done, close it as covered.

**For the engine:** EXF-532 and EXF-535 extend the month read model that EXF-485 is building. The EXF-485
brief asked for the credit rules to be addable without changing existing fields; check that in its design doc
at its approval card.

**Backlog:** about 98 `clone:feature` tickets: 43 triaged on the tickets, 47 triaged in the journal only
(areas 2, 7, 4, 6); area 8 still filing. Flow 4 (credit card) needs EXF-532, 535, 537 and 539. No tickets
filed this review.

### 2026-11-15 · Plan round 14

Children used 25 of 200. Four are running, all started earlier: the Builds for EXF-485 (at its build step) and
EXF-475 (at its plan step), Discover area 8 and the Improve templates review.

- No tickets were filed at the last review.
- **EXF-485's manifest arrived; scheduling rule applied.** It touches new files only under
  `apps/worker/src/db/schema`, `repositories`, `services`, `routes/months.ts`, `mcp/tools/months.ts`,
  `packages/core/src/budget-engine.ts` and `account-types.ts` (new files in a shared module, no existing core
  file changed), `packages/schema/src` (new files), one migration, and tests. No always-overlap file. Three
  existing files it edits that EXF-475 could also edit: `apps/worker/test/openapi.test.ts` (EXF-475 is told
  not to), `apps/worker/test/mcp.test.ts` and `e2e/mcp.spec.ts` (only if EXF-475 changes the budgets MCP
  tool's output), and `docs/README.md` (every Build adds a line to the docs index). Check EXF-475's manifest
  when it arrives; a clash on the docs index alone is a one-line rebase, not a reason to cancel. Whichever
  merges second gets Refresh at its card.
- Started nothing: every open High ticket waits on one of the two Builds.
- Ticket writes still rate limited at 20:37 UTC.

### 2026-11-15 · Review round 14

Children used 25 of 200. Three are running: the Builds for EXF-485 and EXF-475, and the Improve templates
review, which is filing what I approved.

**What ended:** Discover area 8, Reflect, with 6 tickets. Own prefixed data only, all deleted, filters reset.
It captured the export files of each report. **All nine discovery areas have now reported: about 104
`clone:feature` tickets.**

**Triage of area 8, decided here, not yet on the tickets** (rate limit):

| Ticket | What | Priority | Blocked by |
|---|---|---|---|
| EXF-548 | Report shell: tabs, date range, category and account filters, drill-down, export dialog | Medium | EXF-513, EXF-475 |
| EXF-549 | Spending Breakdown | Medium | EXF-548 |
| EXF-550 | Spending Trends | Medium | EXF-548 |
| EXF-551 | Net Worth | Medium | EXF-548 |
| EXF-552 | Income v Expense | Medium | EXF-548 |
| EXF-553 | Age of Money | Low | EXF-548 |

**Improve templates (Discover), answered in a side turn: approved all.** Four new template tickets and two
evidence comments; no duplicates. The comments on EXF-456 and EXF-479 are posted. The four new tickets were
not yet in the tracker at 20:41 UTC; check next round and file any that is missing.

1. Sign-in check gets the Lead's notes and opens a safe `source.start_url`, never the bare `source.url`.
2. A masking helper driven by profile keys (`source.mask_selectors`, `source.redact_text`,
   `source.allowed_url_prefixes`). I added: a way to remove or redact a stored screenshot afterwards.
3. Parallel children in one test space: a `test_prefix` input, a read-back check before every write, and
   `source.test_spaces` so each child can have its own space.
4. Tickets carry structured dependencies and a priority suggestion; the file action sets blocking links.

Its comment on EXF-479 tempers my ticket: two tab listings suggest some boxes had separate browsers, so
"one shared browser" is not proven for every box. Popovers closing under an agent can also come from the
source app syncing other agents' writes.

**Privacy: the exposure was wider than I recorded in plan round 11.** From the review's reading of the
transcripts:

- **Three** discovery children, not one, landed on the Programmatik plan's Plan page in the template's
  sign-in step: areas 1, 2 and 3. That step printed the plan's name, an account name, category amounts and
  the account email into their transcripts; two `signed_in` answers named the plan. Each sign-in screenshot
  was deleted in the next step.
- Other plans' names were printed into tool output in two Threads (areas 9 and 7) when the plan menu opened.
- The account email is visible in some stored screenshots: the sign-in capture in area 5's outputs, one
  early sidebar capture in area 3's, and probably about 90 full-window captures in area 7's.
- Area 5 left an unmasked capture of the permitted Programmatik account page in `/tmp` in its box.
- None of this is in the repository or in a ticket, by the agents' reports and the review. I have not viewed
  the images. I cannot delete transcripts or artifacts.
- Told the person in the side turn's message; offered to raise removal of the stored artifacts as a request
  if they want it.
- Rules for every later brief that touches the source: own tab; the test plan URL only; never open the plan
  menu unless the ticket needs it, and then hide its entries first; mask the sidebar identity in every
  capture; print no page text from outside the test plan.

**Backlog:** about 104 feature tickets: 43 triaged on the tickets, 53 triaged in the journal only (areas 2,
7, 4, 6, 8), the rest are the eight not yet looked at individually in area 2 and 7's tails. Gap: EXF-454.
Template: EXF-455, 456, 457, 479 and four being filed. No tickets filed by me this review.
