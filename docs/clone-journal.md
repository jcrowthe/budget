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

Review counters (finished children since that template's last review): Build 0 (reviewed in round 24, fourteen Threads, and sent for review in round 40, eleven Threads), Deploy 0 (sent for review in round 43, ten Threads), Test user flow 2,
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
| 2026-11-15 | 6 | Discover, area 2 targets and Auto-Assign (`p_940e7584759144a19491a447beb60fe0`) | EXF-508, 511, 514, 516, 519, 521, 523, 525, 527 | none | completed (47 minutes), 9 tickets |
| 2026-11-15 | 6 | Discover, area 3 accounts (`p_8f7b7c29a6404af9b7329fe46cf09295`) | EXF-481, 482, 483, 484, 486, 488, 490 | none | completed (38 minutes) |
| 2026-11-15 | 6 | Discover, area 4 register (`p_7841a17514924dd39f237af2070af80e`) | EXF-513, 517, 520, 522, 524, 526, 528, 529, 530, 531, 533, 534, 536 | none | completed (50 minutes), 13 tickets |
| 2026-11-15 | 6 | Discover, area 5 linked accounts, view-only (`p_1dca579d8d604381bbdd2de216b284ee`) | EXF-459 to EXF-467 | none | completed (20 minutes), 9 tickets |
| 2026-11-15 | 6 | Discover, area 6 credit cards and loans (`p_4eb8623564154f3589232ae289e58e3d`) | EXF-532, 535, 537 to 547 | none | completed (54 minutes), 13 tickets |
| 2026-11-15 | 6 | Discover, area 7 scheduled transactions and payees (`p_98d4f5de89aa4e6e83b29bd111e2196c`) | EXF-497, 499, 501, 503, 505, 507, 510, 512, 515, 518 | none | completed (43 minutes), 10 tickets |
| 2026-11-15 | 6 | Discover, area 8 Reflect (`p_73da15272400437f8d2c57fa10f63d3f`) | EXF-548 to EXF-553 | none | completed (58 minutes), 6 tickets |
| 2026-11-15 | 6 | Discover, area 9 plan management, settings, export format (`p_ebbda25af70d450ea6fe87f368173e55`) | EXF-468 to EXF-478, EXF-480 | none | completed (23 minutes), 12 tickets |
| 2026-11-15 | 6 | Build feature, EXF-453 hardening (`p_3d67d55e73834f6ca92c9ec15cfbfebd`) | EXF-453 | [#4](https://github.com/jcrowthe/budget/pull/4) | merged as `eabf341` (17 minutes) |
| 2026-11-15 | 8 | Deploy of `eabf341` (`p_daa5ffd48c364b16a2058d8d143820cb`) | none | none | **live** at https://budget.doxen.dev, `DEPLOY_SHA` `eabf341` (3 minutes) |
| 2026-11-15 | 8 | Build feature, EXF-458 source URL (`p_aa92546acd0641409ad3e7199c73f53b`) | EXF-458 | [#5](https://github.com/jcrowthe/budget/pull/5) | merged as `4f1fbb3` (17 minutes) |
| 2026-11-15 | 11 | Build feature, EXF-485 budget engine and core tables (`p_2088a38c1bed40b7b99f7b9f90ef1ea4`) | EXF-485 | [#6](https://github.com/jcrowthe/budget/pull/6) open | abandoned by me at the gate (no Playwright browser in its box); branch kept at `8b9b465`, to carry over |
| 2026-11-15 | 11 | Build feature, EXF-475 plan-scoped URLs (`p_744621e075094dd988d0cc04103db917`) | EXF-475 | PR #7 | merged `d7a3a40` (round 18) |
| 2026-11-15 | 13 | Improve templates, review of ten Discover Threads (`p_cf95d417013546b7bc7ac3be0e864c67`) | filed EXF-554 to EXF-557 | none | completed (11 minutes); all proposals approved |
| 2026-11-15 | 17 | Build feature, EXF-485 carried over, ordinary Build (`p_2f4994aa9b7e4993bc14635af25e92b1`) | EXF-485 | [#8](https://github.com/jcrowthe/budget/pull/8) | merged as `0eb64f8` (28 minutes) |
| 2026-11-15 | 18 | Build feature, EXF-511 targets engine (`p_899fecccbbbf452fbdecfc802e0abebf`) | EXF-511 | PR #9 | merged `d19f4ff` (round 20) |
| 2026-11-15 | 19 | Deploy of main `d7a3a40` (`p_c55bb7d4d01947fe848d4849c4333b78`) | EXF-458, 485, 475 | n/a | live `d7a3a40` |
| 2026-11-15 | 19 | Build feature, EXF-561 derived test lists (`p_68476e6ced7c47b3b7e89f96a101fc1d`) | EXF-561 | PR #10 | merged `401970d` (round 21) |
| 2026-11-15 | 19 | Build feature, EXF-487 Plan month grid (`p_33dc46ec590f4e2688c8437eee9cc5eb`) | EXF-487 | PR #11 | merged `129e425` (round 22) |
| 2026-11-15 | 21 | Build feature, EXF-481 accounts and unlinked accounts (`p_26e65fda71f744f182581e2cffb61047`) | EXF-481 | PR #12 | merged `d2e659b` (round 23) |
| 2026-11-15 | 23 | Deploy of main `129e425` (`p_77deb9856fa0437b93b1b3d693561e94`) | EXF-511, 561, 487 | n/a | live `129e425` |
| 2026-11-15 | 23 | Build feature, EXF-493 month navigation and note (`p_d0368f708be6478c8718f93c77174947`) | EXF-493 | PR #15 | merged `0de1856` (round 29) |
| 2026-11-15 | 23 | Build feature, EXF-489 edit Assigned inline (`p_538c1bb379f84d0d8d3dac0b6ec51136`) | EXF-489 | PR #13 | merged `0c81b09` (round 27) |
| 2026-11-15 | 24 | Deploy of main `d2e659b` (`p_98f50d74ddb74e78904ef57aa417fcf4`) | EXF-481 | n/a | live `d2e659b` |
| 2026-11-15 | 24 | Improve templates, review of fourteen Build Threads (`p_ba4466d6501f49e2b08b70e18a4bcd86`) | filed EXF-563 to EXF-568 | none | completed (13 minutes); all proposals approved |
| 2026-11-15 | 24 | Build feature, EXF-513 register and transactions API (`p_9a3d48df2d5d492e8f3ead6099fb9a6e`) | EXF-513 | PR #16 | merged `2fcde22` (round 30) |
| 2026-11-15 | 24 | Build feature, EXF-483 sidebar account groups (`p_786e77ad3c2c46a1a202ebf11409fdb1`) | EXF-483 | PR #14 | merged `5c4802e` (round 28) |
| 2026-11-15 | 28 | Build feature, EXF-494 and EXF-495 categories: create, rename, delete, hide (`p_4f6bdb700cf54bec9c138cdfb3649b02`) | EXF-494, EXF-495 | PR #17 | **cancelled by me in round 37** (stalled in review; main moved); branch head `178c13a` carried over |
| 2026-11-16 | 29 | Build feature, EXF-459 Plaid Link and bank connections (`p_3f31601a41c146cfafb7c84cc556af19`) | EXF-459 | PR #18 | merged `82aac3a` (round 33) |
| 2026-11-16 | 30 | Deploy of main `0de1856` (`p_a1da6c560bc5490c9e8e5b0b06f37c25`) | EXF-489, 483, 493 | n/a | live `0de1856` |
| 2026-11-16 | 31 | Test user flow, flows 9 and 11 (`p_943f5578ff6e4b7db6ffdab96fd95d00`) | flows 9, 11 | n/a | completed (9 minutes): flow 9 `new_gaps` (EXF-571), flow 11 `parity` |
| 2026-11-16 | 31 | Build feature, EXF-484, EXF-534, EXF-570 account pages and updated_at (`p_24b188914bc64377afad573abac5152d`) | EXF-484, 534, 570 | PR #19 | merged `2d1982e` (round 36) |
| 2026-11-16 | 34 | Deploy of main `82aac3a` (`p_35445feed3ef4e338886f6265c7210d1`) | EXF-513, 459 | n/a | live `82aac3a` |
| 2026-11-16 | 34 | Build feature, EXF-571, EXF-470, EXF-454 plan menu (`p_5ee85fcef22241cf8600622a07cc8158`) | EXF-571, 470, 454 | PR #20 | **cancelled by me in round 36** (source rules broken); branch head `b7e25de` to carry over |
| 2026-11-16 | 35 | Test user flow, flow 10 REST and MCP (`p_e823d6accfd94427bec7eda412fe3037`) | flow 10 | n/a | completed (8 minutes): `new_gaps` (EXF-572) |
| 2026-11-16 | 37 | Build feature, carry-over of EXF-494 and EXF-495 (`p_4fe1cb348be24f9f9bee5b5622d29168`) | EXF-494, EXF-495 | PR #22 | merged `325ee94` (round 38) |
| 2026-11-16 | 37 | Build feature, carry-over of EXF-571, EXF-470, EXF-454 plan menu (`p_9a58f4af528e469b93711c3de218e26d`) | EXF-571, 470, 454 | PR #21 | merged `41bee46` (round 41; no card reached me); **its Designer opened the source despite the ban** (round 39 review) |
| 2026-11-16 | 37 | Build feature, EXF-572 MCP tool coverage (`p_14fe85267f7449f192572c1b7cfc9cbf`) | EXF-572 | PR #23 | merged `70c71a2` (round 39) |
| 2026-11-16 | 39 | Build feature, EXF-491 and EXF-492 Ready to Assign pill and move money (`p_ed90e00d9e644c1aa0719b13500b32d1`) | EXF-491, 492 | PR #24 | merged `b09078b` (round 46), 88 minutes |
| 2026-11-16 | 39 | Build feature, EXF-517 and EXF-507 inline transactions and payee picker (`p_19407e1a62d54f93b69b9199878c07b6`) | EXF-517, 507 | PR #25 | merged `3a3a977` (round 49), about 2 hours 5 minutes, four cards |
| 2026-11-16 | 40 | Deploy of main `70c71a2` (`p_1569dfe9b3fd4313ad8828bf37c9da61`) | EXF-484, 534, 570, 494, 495, 572 | n/a | live `70c71a2` (6 minutes) |
| 2026-11-16 | 40 | Improve templates, review of Build feature, eleven Threads (`p_8757e1731449410893235e6be0b6c82a`) | n/a | n/a | completed (15 minutes): filed EXF-575 to EXF-578, nine comments |
| 2026-11-16 | 40 | Build feature, EXF-548 and EXF-551 Reflect frame and Net Worth (`p_8c426567ca264a7785a853ed5d415955`) | EXF-548, 551 | PR #27 | merged `df5afbe` (round 51), about 2 hours 5 minutes, four cards |
| 2026-11-16 | 41 | Deploy of main `41bee46` (`p_f620f94442e74ca7aa379602f46a0c69`) | EXF-571, 470, 454 | n/a | live `41bee46` (6 minutes) |
| 2026-11-16 | 41 | Build feature, EXF-460 Worker half and EXF-574 (`p_d8aed3c75dce492981ba3b53a8912270`) | EXF-460, 574 | PR #26 | merged `3007076` (round 45), 35 minutes |
| 2026-11-16 | 43 | Test user flow, flows 9 and 10 again and flow 1 (`p_b3b54aec56044df2a755ef5d984061f4`) | flows 9, 10, 1 | n/a | completed (17 minutes): flow 9 `new_gaps` (EXF-586), flow 10 `new_gaps` (EXF-587), flow 1 `parity_known_gaps` |
| 2026-11-16 | 43 | Improve templates, review of Deploy, ten Threads (`p_d5c887068b264f6a9d70d9f9ec940ebc`) | n/a | n/a | completed (11 minutes): filed EXF-580 to EXF-585, three comments |
| 2026-11-16 | 43 | Build feature, EXF-579 and EXF-569 test infrastructure (`p_cd848105b4374ae2afe041183b489568`) | EXF-579, 569 | PR #28 | merged `0b53a5f` (round 48), 62 minutes |
| 2026-11-16 | 47 | Deploy of main `b09078b` (`p_19af5f217da344c69a6bc314de0cfbaa`) | EXF-460 (Worker), 574, 491, 492 | n/a | live `b09078b` (6 minutes) |
| 2026-11-16 | 47 | Build feature, EXF-498, EXF-523, EXF-521, EXF-586 selection, right panel, inspector (`p_65463dbc6be84add91017e885f952d56`) | EXF-498, 523, 521, 586 | PR #29 | merged `113ced4` (round 55), about 2 hours, one card |
| 2026-11-16 | 50 | Deploy of main `3a3a977` (`p_8e0dbe332cab411d953c0e3eb9b6768c`) | EXF-579, 569, 517, 507 | n/a | live `3a3a977` (6 minutes) |
| 2026-11-16 | 50 | Build feature, EXF-461 Worker half, linked accounts (`p_347cdcc27a6546818f5dad9ee7011a4a`) | EXF-461 | PR #30 | merged `74f1041` (round 53), 45 minutes, one card |
| 2026-11-16 | 50 | Build feature, EXF-526 and EXF-524 transfers and splits (`p_ed951d9308614f88bc3289bed3b27d78`) | EXF-526, 524 | pending | running |
| 2026-11-16 | 51 | Test user flow, flow 1 again and flow 2 as far as built (`p_01e3392182944b22b75a9e0234f7aa17`) | flows 1, 2 | n/a | completed (14 minutes): flow 1 `parity_known_gaps`, flow 2 `new_gaps` (EXF-590) |
| 2026-11-16 | 54 | Deploy of main `74f1041` (`p_440603eb108042738ca17f4ef6e712ba`) | EXF-548 (frame), 551, 461 (Worker) | n/a | live `74f1041` (14 minutes) |
| 2026-11-16 | 54 | Build feature, EXF-486 and EXF-488 edit, close, reopen, delete an account (`p_5847cffd67c1400f9cdba4c83a59afa1`) | EXF-486, 488 | PR #32 | merged `4e3eb7a` (round 58), 75 minutes, one card |
| 2026-11-16 | 55 | Test user flow, flow 8 and flow 5 as far as built (`p_2dd7fe181bcc4d478325a3cef0c35e32`) | flows 8, 5 | n/a | completed (21 minutes): flow 8 `new_gaps` (EXF-591), flow 5 `parity_known_gaps` |
| 2026-11-16 | 56 | Build feature, EXF-508, EXF-514, EXF-592 targets form and display (`p_74b956498a4b4ce1bed94c516291a48f`) | EXF-508, 514, 592 | pending | running |
| 2026-11-16 | 57 | Deploy of main `113ced4` (`p_e549c296232b4f06be26ddeb660f709a`) | EXF-498, 523, 521, 586 | n/a | live `113ced4` (8 minutes) |
| 2026-11-16 | 59 | Deploy of main `4e3eb7a` (`p_749540e03f854b349882000bee3249b2`) | EXF-486, 488 | n/a | running |

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
It captured the export files of each report. **All nine discovery areas have now reported: 94 `clone:feature`
tickets** (EXF-459 to EXF-553, less the template ticket EXF-479). Earlier entries that say areas 2 and 7
filed 10 and 11 tickets, or give totals of about 70, 85 or 98, overcounted: they filed 9 and 10.

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

**Backlog:** 94 feature tickets: 43 triaged on the tickets (areas 5, 9, 1, 3) and 51 triaged in the journal
only (areas 2, 7, 4, 6, 8). Gap: EXF-454.
Template: EXF-455, 456, 457, 479 and four being filed. No tickets filed by me this review.

### 2026-11-15 · Plan round 15

Children used 25 of 200. Three are running, all started earlier: the Builds for EXF-485 (building) and
EXF-475 (still at its plan step after 14 minutes, no manifest yet, no open card), and the Improve templates
review (still filing; its four new tickets are not in the tracker yet).

- No tickets were filed by me at the last review.
- Started nothing: every open High ticket waits on one of the two Builds; discovery is complete with 94
  tickets, so rule 3 (fewer than 5 open) does not apply; nothing new is merged to deploy.
- Ticket writes still rate limited at 20:42 UTC.

### 2026-11-15 · Review round 15

Children used 25 of 200. Two are running: the Builds for EXF-485 and EXF-475.

**What ended:** the Improve templates review of the Discover template, completed. Everything I approved was
filed or posted, so nothing to file again:

- EXF-554: the sign-in check gets the Lead's notes and opens a safe start URL.
- EXF-555: a masking helper driven by the profile.
- EXF-556: parallel children in one test space get a prefix and a write guard.
- EXF-557: tickets carry structured dependencies and a suggested priority; the file action sets links.
- Evidence comments on EXF-456 and EXF-479.

Its figures for the seven completed Discover children: 85 tickets by its count (94 once areas 6 and 8 are
included, which finished after it started), about $55 in total, explore steps of 14 to 40 minutes costing
$2.00 to $11.44, none looped or needed help.

**To set in the next plan** (ticket writes begin to free at about 20:45 UTC): EXF-554 and EXF-555 High (both
are about the person's private data), EXF-556 and EXF-557 Medium. Then the writes owed since round 11, then
the journal triage for areas 2, 7, 4, 6 and 8, High tickets first.

**Backlog:** 94 feature tickets (43 triaged on the tickets, 51 in the journal); EXF-454; eight template
tickets (EXF-455, 456, 457, 479, 554 to 557). No tickets filed this review.

### 2026-11-15 · Plan round 16

Children used 25 of 200. Two are running, both started in round 11: the Builds for EXF-485 (building) and
EXF-475 (its architect is writing the spec after studying the source; no card).

- No tickets were filed by me at the last review; EXF-554 to EXF-557 exist (filed by the template review).
- Ticket writes: three got through before the limit closed again at 20:45 UTC. Done: EXF-475 to In Progress;
  EXF-554 and EXF-555 to High. Still owed, in this order: EXF-556 and EXF-557 Medium; the High tickets of the
  journal triage (EXF-513, 517, 521, 511, 508, 514, 519, 507, 524, 526, 533, 532, 535, 537, 539), each with
  its links; the scope comments on EXF-485 and EXF-475; then the Medium and Low tickets. The next block of
  writes frees between about 21:01 and 21:07, the largest at about 21:25.
- Started nothing: every open High ticket waits on EXF-485 or EXF-475; nothing new is merged to deploy.

### 2026-11-15 · Review round 16

Children used 25 of 200. One is running: the Build for EXF-475.

**What ended:** the Build for EXF-485 (`p_2088a38c1bed40b7b99f7b9f90ef1ea4`), abandoned by my answer on its
second gate card, 27 minutes after it started. Not merged; main is still `4f1fbb3`. EXF-485 stays In Progress.

**The work is finished and kept.** Branch `exfab/p_2088a38c1bed40b7b99f7b9f90ef1ea4` at
`8b9b465fb95fc5c2dd7b805945b082c7825b08ea`, pull request #6: three commits, 35 files, 2886 lines added and 2
removed against main `4f1fbb3`; nothing under `apps/web/` and none of the `budgets` files. Reviewer-approved
(its one blocking finding, impossible dates such as `2026-13-05` breaking later months, was fixed with a
test), acceptance 12 of 12, `pnpm check` green with 183 tests.

**Why the gate failed.** The final gate runs the full e2e suite. The five browser specs (`plans`, `shell`,
`shell-compare`) failed in 2 to 4 ms each: "Executable doesn't exist at
/home/exfab/.cache/ms-playwright/...". No Playwright browser was installed in that box, because nobody in
the Thread had run a browser spec: the work is API-only. The seven API specs passed. Earlier Builds passed
this gate only because some agent in each had installed the browser while working.

**Why I abandoned.** On the `gate_stuck` card I chose Retry with an instruction to run
`pnpm exec playwright install chromium`. The gate failed the same way, and the gate_fix Implementer answered
blocked again without installing anything: it does not see the Lead's card answer, it will not download a
browser on its own, and a Retry gives it one try, not four. A second Retry would have looped.

**What the engine built** (from its architect's and implementer's reports; verify at the next approval card):

- Tables, one migration `20261115203000_budget_engine.sql`: `category_groups`, `categories` (with
  `budget_id`), `month_categories`, `months`, `accounts`, `transactions`. Plural names; `sort_order` and
  `deleted_at` in storage (the API field is `sort`); groups and categories have `updated_at`;
  `transactions.cleared` is text (`uncleared`, `cleared`, `reconciled`); no SQL CHECK on `accounts.type`.
- Services for later tickets: `createCategoryGroup`, `createCategory`, `setAssigned`, `moveMoney` (an empty
  side means Ready to Assign), `setMonthNote`, `getPlanMonth`, `listPlanMonths`, `createAccount`,
  `createTransaction`.
- Rules: only on-plan accounts count; uncategorized acts like a category with nothing assigned; the inflow
  flag wins over a category; credit accounts are treated as cash for now behind one function,
  `classifyTransaction`, so the credit tickets extend it; a transaction whose category was deleted counts as
  uncategorized.
- Known issue it accepted: `setAssigned` and `moveMoney` read the "before" value for history outside the
  write, so two simultaneous writes can record a stale "before". Must be fixed before Undo (EXF-504, EXF-530)
  relies on history. Two nits: a hand-built 422 in `routes/months.ts`, a misplaced comment.

**Decisions for the next plan:**

- Carry the work over with an ordinary Build (the pattern that merged the profile fix): Clerk jobs, each with
  a command and the output it must print: write `request.json`; open the Thread's own source tab;
  fast-forward `origin/exfab/p_2088a38c1bed40b7b99f7b9f90ef1ea4` and print `8b9b465…` and the diff shape; and
  **install the browser**: `pnpm install --frozen-lockfile && pnpm exec playwright install chromium`, then
  list `~/.cache/ms-playwright`.
- From now on every Build brief has the browser install as a Clerk job, until the ticket below lands.
- EXF-475 may hit the same gate failure if nobody in its Thread installed the browser; it is a UI Build, so
  its agents probably ran browser specs. If it does, carry it over the same way.

**Tickets filed this review:**

1. `clone:gap`: e2e runs on the box's system Chrome, so the gate needs no downloaded browser.
2. `clone:template`: the gate fails on a box without the Playwright browser, the gate_fix step cannot fix it,
   and the Lead's card answer does not reach the agent.

**Backlog:** 94 feature tickets (43 triaged on the tickets, 51 in the journal); gap: EXF-454 and one being
filed; template: eight and one being filed.

### 2026-11-15 · Plan round 17

Children used 26 of 200. Two are running: the Build for EXF-475 (pull request #7 open as a draft) and the
carry-over Build for EXF-485 started this round (`p_2f4994aa9b7e4993bc14635af25e92b1`).

- Tickets from the last review exist: EXF-558 (e2e on the system Chrome, `clone:gap`) and EXF-559 (gate on a
  box without a browser, `clone:template`). Priorities to set when the write limit frees: both High; EXF-558
  runs alone (it edits `playwright.config.ts`, an always-overlap file).
- Started the carry-over Build for EXF-485: an ordinary Build, four Clerk jobs with print-back checks (write
  `request.json`; own source tab; fast-forward `origin/exfab/p_2088a38c1bed40b7b99f7b9f90ef1ea4` to
  `8b9b465…`, 35 files, 2886 added, 2 removed; install dependencies and the Playwright browser and list the
  cache). One line per later role saying what not to redo; the Implementer runs the full e2e; anyone fixing a
  gate failure may install the browser. EXF-485 was already In Progress.
- **EXF-475's manifest arrived; scheduling rule applied.** It touches the `budgets` Worker files, one
  migration, the web router, shell and pages, `e2e/shell.spec.ts`, `e2e/plans.spec.ts`, and
  `docs/README.md` and `docs/conventions.md`. Against EXF-485's manifest the only shared file is
  `docs/README.md` (each adds a line to the docs index). No always-overlap file in either. They stay side by
  side; whichever merges second gets Refresh at its card. Both briefs say to keep both lines.
- Not started: EXF-558. It must run alone and two Builds are running. Until it lands, every Build brief
  carries the browser install as a Clerk job.
- Owed ticket writes unchanged (limit still closed at 20:57 UTC).

Addendum to plan round 17 (20:59 UTC): the carry-over Build's Clerk did all four jobs and printed each check:
`request.json` with `EXF-485`; own tab opened; HEAD `8b9b465…` with the expected diff shape; the browser cache
lists `chromium-1255` and `chromium_headless_shell-1255`. EXF-558 set to High (one write got through);
EXF-559's priority is still owed.

### 2026-11-15 · Review round 17

Children used 26 of 200. One is running: the Build for EXF-475, past acceptance (11 pass, 3 partial, none
failed) and on its way to the gate.

**What ended:** the carry-over Build for EXF-485. I approved its card in a side turn; it squash-merged as
`0eb64f85a0577681ad6300b96640872a1083e5fa` (pull request #8). EXF-485 is Done, with a comment listing what
later tickets can rely on. Pull request #6 (the first attempt) is superseded.

**The budget engine is on main**: the first feature. The gate ran the full e2e 12 of 12 three times, browser
specs included, because the Clerk had installed the browser.

**What I checked before approving** (read at the gated head `0b8aa7d`): one commit beyond the head approved
earlier, eleven files, inside the manifest. It fixes the stale-history issue the first review had only
accepted: `setAssigned` and `moveMoney` now write the history row and the cell together under a guard that the
cell still holds what was read, retry up to five times, then throw Conflict. So the history chain matches the
data and no update is lost; under heavy simultaneous writes some moves are rejected (12 of 27 in a stress
run), which a single-user app can live with. The migration has the six tables as briefed; `classifyTransaction`
is the single place for counting rules, ready for the credit tickets.

**Known issues carried forward** (filing one low gap ticket): no upper bound on the month in
`GET /months/{month}` (year 9999 takes about a second); `docs/budget-engine-design.md:137` still describes the
old move write; a leftover docstring in `repositories/category-groups.ts`.

**EXF-475:** its base has moved (the engine merged). At its card expect Refresh, not Approve: both Builds add
a line to `docs/README.md`.

**Ticket writes: the limit freed and I applied most of the triage held in the journal.** Done on the tickets
now: every High and Medium ticket of areas 2, 7, 4, 6 and 8 with its links (38 tickets), plus EXF-559 High,
EXF-556 and EXF-557 Medium. Still owed, all Low: EXF-525, 527, 501, 503, 512, 518, 536, 541, 542, 543, 544,
545, 553; and the links EXF-467 after EXF-510, EXF-480 after EXF-522. About 13 writes are left this hour,
kept for the next plan's starts.

One link differs from the journal tables on purpose: EXF-511 (targets engine) and EXF-532 (credit engine) are
no longer blocked by EXF-485, since it merged; EXF-532 is blocked by EXF-481 only.

**Backlog:** 93 open feature tickets (EXF-485 done), 80 triaged on the tickets, 13 Low still to set. Gap:
EXF-454, EXF-558 (High). Template: nine. Next: EXF-481 (accounts) and EXF-487 (Plan grid) are unblocked.

### 2026-11-15 · Plan round 18

Children used 27 of 200. Two are running: the Build for EXF-475 (refreshing onto the new main after my Refresh
on its card; its gate had passed 24 of 24 on the old base) and the Build for EXF-511 started this round.

- EXF-560 (months path bound and two leftovers), filed at the last review, exists; set to Low.
- **Started EXF-511, the targets engine** (`p_899fecccbbbf452fbdecfc802e0abebf`), High and unblocked now that
  the engine is on main. It is Worker and `packages/core` only. Scope notes: target fields go on the existing
  month read model under `target` (no new REST path, no new MCP tool, so the hand-kept lists in
  `openapi.test.ts` and `mcp.test.ts` are not touched); it creates the `targets` table, shaped for EXF-508,
  516 and 538; writes are services (`setTarget`, `deleteTarget`); the arithmetic is pure with "today" as an
  input. Three Clerk jobs: `request.json`, own tab, browser install. Nobody uses the source app. Ticket moved
  to In Progress and commented.
- **Why not EXF-481 (accounts) and EXF-487 (Plan grid) yet:** both are unblocked by the engine, but EXF-475
  is still open and edits `pages/plan.tsx`, `pages/accounts.tsx`, `pages/account.tsx`, the Sidebar and the
  router, which those two also change. They start as soon as EXF-475 merges, side by side if their manifests
  are disjoint (grid: Plan page and its components; accounts: accounts routes, the Add Account modal, the
  account page).
- Scheduling check for EXF-511 against EXF-475: no shared file expected except `docs/README.md` (one line
  each). EXF-511 changes `packages/core/src/**` (shared module) alone.
- Not started: EXF-558 (needs a moment with no other Build running); EXF-468 (overlaps EXF-475).
- **A hot spot to remove:** every Build that adds a route or an MCP tool edits the same hand-kept lists in
  `apps/worker/test/openapi.test.ts`, `apps/worker/test/mcp.test.ts` and `e2e/mcp.spec.ts`. With many
  parallel Builds these will conflict on every merge. File a gap ticket at the next review: derive the
  expected lists from the route and tool files, or keep one expectation file per resource.
- Deploy: the engine is merged but has no screen; deploy with EXF-475 once it merges, so the new URLs and the
  months API go live together.

### 2026-11-15 · Review round 18

Children used 27 of 200. One is running (the Build for EXF-511, targets engine; no manifest yet, 6 visits).

**Ended: the Build for EXF-475 (plan-scoped URLs), merged as `d7a3a40` (PR #7).** Ticket moved to Done and
commented. Its road: gate 24 of 24 on the old base, then the engine merged, I answered Refresh, then Regate,
and the full run on base `0eb64f8` passed (check, e2e 25 of 25 three times, changed specs 160 of 160, no
flakes). Acceptance 11 pass, 3 partial (month push, menus, rename: green tests, not driven live), 0 fail.
I read the diff before approving: 27 files, +1250/-78.

- What landed: pages nested under `/:budgetId` with a `PlanScope` layout in the shell (it replaces
  `PlanGate`), `planPaths` helpers, `useCurrentPlan`, page titles, history behaviour, a not-found screen for
  an unknown plan, and `/` opening the last opened plan.
- `budgets.last_opened_at` (migration `20261115204324_budgets_last_opened_at.sql`). `PATCH /budgets/{id}`
  accepts `opened: true` and stamps it; with no name in the patch this writes no `change_log` row and does
  not bump `last_modified_on` ("opening is not a change"). No new API path, no new MCP tool.
- Known difference, by the ticket: the source's `/reflect` goes to the last-visited report; the clone always
  opens spending breakdown. Raise again when the reports are built (EXF-548 and later).
- Unplanned files: `apps/worker/test/mcp.test.ts` and `docs/plan-urls-polish.md`. Harmless, but the first one
  is the hot spot again (see below).
- The Build removed its own source screenshots for cases 3 and 4 (register data) and masked the email in the
  others. Good behaviour; nothing for me to clean.

**For the next plan:**

- Main is `d7a3a40`; live is still `eabf341`. Start a Deploy with `expect_commit` `d7a3a40`. Two migrations
  are pending on the live database: `20261115203000_budget_engine.sql` and
  `20261115204324_budgets_last_opened_at.sql`.
- Start EXF-481 (accounts) and EXF-487 (Plan grid). Neither may touch `packages/core/src/**`,
  `services/months.ts` or `routes/months.ts` while EXF-511 runs. Both will add to the shell that EXF-475 just
  changed (`Sidebar.tsx` for accounts): tell the grid Build to stay out of `apps/web/src/shell/**` and
  `router.tsx`, so that only the accounts Build holds the shared web modules.
- Flows 9 and 11 can get a first live drive once the Deploy is live; cases 9 to 11 of EXF-475 get their live
  check there.
- Ask the person again to open https://budget.doxen.dev in their browser after the Deploy.

**New ticket filed with this review (gap):** the hand-kept expectation lists. `apps/worker/test/openapi.test.ts`
(the full path list), `apps/worker/test/mcp.test.ts` and `e2e/mcp.spec.ts` (the full tool list) are edited by
every Build that adds a route or a tool; three Builds have touched them so far (scaffold, EXF-485, EXF-475)
and the accounts, register, Plaid and import Builds all will. Fix: derive the expected lists from the route
and tool files, or keep one expectation file per resource. Set its priority in the next plan (High; it must
run alone like EXF-558, since it edits files every Build edits).

**Ticket writes:** two used now (EXF-475 Done and its comment). About 50 were used between 21:26 and 21:31
UTC, so the window frees from about 22:26 UTC. Still owed, all Low: EXF-525, 527, 501, 503, 512, 518, 536,
541, 542, 543, 544, 545, 553; and the links EXF-467 after EXF-510, EXF-480 after EXF-522.

**Backlog:** 92 open feature tickets (EXF-475 and EXF-485 done; EXF-511 in progress). Gap: EXF-454, EXF-558
(High), EXF-560 (Low), plus the one filed now. Template: nine. Finished Builds since the Build template's
last review: 6 of 10.

### 2026-11-15 · Plan round 19

Children used 30 of 200. Four are running: the Build for EXF-511 (targets engine) from last round, and three
started now.

- The gap ticket filed at the last review exists: **EXF-561** (derive the API path list and MCP tool list in
  tests). Set to High.
- EXF-511's manifest arrived: `packages/core` (`targets.ts`, `budget-engine.ts`), `packages/schema`
  (`targets.ts`, `months.ts`), migration `20261115213604_targets.sql`, Worker `targets` table, repository and
  service, `services/months.ts`, new tests only. As estimated; nothing under `apps/web`, no list test.
- **Started the Deploy of main `d7a3a40`** (`p_c55bb7d4d01947fe848d4849c4333b78`), `gated_commit` `05588ce`
  (I compared the trees: equal). It ships the engine, the months API and the plan-scoped URLs, with two
  additive migrations. Checks asked: pending migrations before and after, health, `last_opened_at`, the months
  API on a `ZZ-TEST` plan, the MCP tool list, the new URLs in a browser session, cleanup.
- **Started EXF-561** (`p_68476e6ced7c47b3b7e89f96a101fc1d`), small, first, because every Build that adds a
  route or tool edits the same three test files. Scope: those three files, step 10 of `docs/conventions.md`,
  new test files; no other existing test, nothing under `apps/worker/src`, `apps/web`, `packages`, `scripts`.
  It must show that the derived checks fail on an empty tool file, a duplicate tool name and a route file
  with no path.
- **Started EXF-487, the Plan month grid** (`p_33dc46ec590f4e2688c8437eee9cc5eb`). Scoped to be disjoint from
  the other three:
  - No new route or tool. The ticket's `PATCH category_groups {collapsed}` moves to EXF-494 (commented
    there); the grid starts from the read model's `collapsed` and keeps changes in the browser.
  - Default groups and categories for a new plan are created in `createBudget` in this Build (the ticket
    lists them, no other ticket does, and without them the grid is empty everywhere). Existing plans are not
    backfilled. Tests that assume an empty new plan change (`months.test.ts`, `budgets.test.ts`,
    `e2e/months.spec.ts`).
  - Values are tested with a stubbed month response in Playwright, because no route creates categories,
    assignments or transactions yet.
  - Stays out of `apps/web/src/shell/**`, `router.tsx`, `api/client.ts` (so the accounts Build can hold the
    shared web modules), out of core and the months files (EXF-511), out of the three list tests (EXF-561).
    Colours with no token become named custom properties in the grid's own CSS; a later Build moves them
    into `tokens.css`.
  - Progress-bar choice in the browser until EXF-472; shortcuts on the page until EXF-473; toolbar buttons,
    checkboxes and the hover icon drawn without actions (EXF-494, EXF-498, the undo ticket).
  - The source app may be looked at (own tab, Test Budget, Plan page only), never changed; the email is
    masked in screenshots.
- **Why not EXF-481 (accounts) now:** it adds routes and MCP tools, so it edits the three list tests that
  EXF-561 rewrites. It starts when EXF-561 merges. It will be the one Build holding `apps/web/src/shell/**`
  (Sidebar, AddAccountDialog).
- Possible cross-Build effect to watch at the cards: once the grid merges, a new plan has eleven categories.
  If EXF-511's tests assume an empty new plan, whichever merges second meets it at its refresh and gate.
- To carry into later briefs: EXF-472 takes over the progress-bar setting from the browser copy; EXF-473 takes
  over the two collapse shortcuts; EXF-468 the money format.
- Not started: EXF-558 (needs a moment with no other Build running; the Clerk's browser-install job covers
  for it). No flow test yet: flows 9 and 11 get a first live drive when the Deploy is live.
- Ticket writes this round: 6 (EXF-561 priority and state, EXF-487 state and comment, EXF-494 comment,
  EXF-561 comment). The 13 Low tickets and two links owed stay owed until the window frees at about 22:26 UTC.
- The person has still not said whether their browser sign-in works; ask in the round 20 check-in report.

### 2026-11-15 · Review round 19

Children used 30 of 200. Three are running: the Builds for EXF-511 (targets engine; manifest as noted in the
plan), EXF-561 (derived test lists; no manifest yet) and EXF-487 (Plan grid; no manifest yet).

**Ended: the Deploy `p_c55bb7d4d01947fe848d4849c4333b78`, passed. Live: https://budget.doxen.dev at
`DEPLOY_SHA` `d7a3a40`** (gate and release both exit 0; four minutes in all; e2e skipped because the tree
equals the gated head `05588ce`).

- Migrations: both pending ones applied (`20261115203000_budget_engine.sql`,
  `20261115204324_budgets_last_opened_at.sql`); none pending after.
- All seven checks passed: health carries the new sha and unauthenticated calls get 401; `GET /budgets` 200
  with `last_opened_at`; the months API answers 200 for a new test plan (zero, no groups) and 422 for a day
  that is not the first; MCP lists exactly `create_budget`, `get_plan_month`, `list_budgets` and
  `get_plan_month` equals REST; in a browser session `/` goes to `/<id>/budget`, the Plan, All Accounts and
  Reflect pages load with the right titles, an unknown plan shows "Plan not found", no failed responses, no
  console errors; opening the plan stamped `last_opened_at` and left `last_modified_on` alone; cleanup left
  nothing.
- This also gives EXF-475's cases a live check for titles, the root redirect and the not-found screen. Cases
  9 to 11 (month push, menus, rename) are still tests only; the first flow test of flow 9 covers them.
- **The live clone has no plan at all** (the plan list was empty before the test plan). So the person has not
  created one, or has not signed in yet. Nothing on live can be harmed by test plans, but it also means the
  person's sign-in is still unconfirmed.
- The Deploy's box had no Playwright browser either and installed it (as my note allowed). EXF-558 remains
  the proper fix.
- Access shape still `combined`.

**Running Builds:** nothing off course. EXF-511 has been at 7 visits for a while (implementing). No card is
waiting.

**For the next plan:** start flow tests for flows 9 and 11 only if they are worth a child now: the live app
has plans, URLs, titles and the plan menu, but no grid, accounts or register yet. My judgement: wait for the
grid and accounts to be live, and test flows 1, 2, 9 and 11 together then; one child per flow now would test
a shell. Start EXF-481 when EXF-561 merges.

**Ticket writes:** none this review. The Low triage and two links stay owed until about 22:26 UTC.

**Backlog:** 92 open feature tickets (2 in progress: EXF-511, EXF-487). Gap: EXF-561 (in progress), EXF-558
(High), EXF-454 and EXF-560 (Low). Template: nine. Finished since each template's last review: Build 6,
Deploy 4, Discover 2, Test user flow 0. Next review is round 20: a check-in.

### 2026-11-15 · Plan round 20

Children used 30 of 200. Three Builds are running, started in rounds 18 and 19: EXF-511 (targets engine),
EXF-561 (derived test lists) and EXF-487 (Plan grid). Nothing started this round.

- No ticket was filed at the last review, so there is nothing to check.
- EXF-561 and EXF-487 have no manifest yet (both in their first steps, a few minutes old); the estimates in
  the round 19 plan stand. EXF-511's manifest is unchanged.
- **Why nothing new:** every unblocked ticket that is left overlaps a running Build. EXF-481 (accounts) adds
  routes and tools and waits for EXF-561; it will also hold `apps/web/src/shell/**`. EXF-468 (plan formats)
  changes the `budgets` files that the grid Build edits for the default categories. EXF-558 edits
  `playwright.config.ts` (always-overlap) and needs a moment with no other Build. Everything else is behind
  the grid or accounts.
- Main is live (`d7a3a40`); nothing merged since, so no Deploy.
- No flow test yet: the live app has no grid, accounts or register, so a flow test would test a shell.
- No discovery: 92 feature tickets are open.
- Review cadence: Build 6, Deploy 4, Discover 2 finished since their last reviews; none is at 10.
- The review of this round is the check-in. It should ask the person again to open
  https://budget.doxen.dev in their own browser (the live clone held no plan before the Deploy's test plan).

### 2026-11-15 · Review round 20 (check-in)

Children used 30 of 200. Two are running: the Builds for EXF-561 (derived test lists; pull request #10 open)
and EXF-487 (Plan grid; its Architect has finished studying the source and is reading the code).

**Ended: the Build for EXF-511 (targets engine), merged as `d19f4ff` (PR #9)** in 28 minutes, first gate
passed, no card but the approval. Ticket Done and commented. I read the diff before approving (15 files,
+2003/-4, exactly the manifest).

- `packages/core/src/targets.ts`: `computeTargetMonth(definition, inputs)`, pure, "today" is an input.
  `budget-engine.ts` gained optional `targets` and `today` on `EngineInput` and `target` (nullable) on each
  category of the month detail.
- Table `targets` (migration `20261115213604_targets.sql`): primary key `category_id`, `budget_id`, `cadence`,
  `behavior`, `amount`, `day_of_week`, `day_of_month`, `due_date`, `due_month`, `repeat_every`,
  `repeat_unit`, `created_on`, timestamps.
- Services `setTarget(env, actor, TargetSet, {today?})` and `deleteTarget(env, actor, TargetDelete)`, each a
  guarded batch with its history row (entity type `target`, entity id the category id).
- The design doc says how the next tickets extend it: EXF-508 adds `PUT/DELETE
  .../categories/{category_id}/target` and the tools `set_category_target` / `delete_category_target`;
  EXF-516 adds a `snoozed_month` column; EXF-538 adds behaviour values for card targets.
- **Carry to EXF-508:** the Worker passes today's date in UTC (`todayUtc()`, the same rule as the current
  month). In the evening in the person's time zone that is tomorrow. The target routes and the month read
  should accept the client's local date. Commented on EXF-511; put it in the EXF-508 brief.
- **Effect on the grid Build (EXF-487):** `MonthCategoryDetail.target` is now a required, nullable field of
  the schema. Its stubbed fixtures need `target: null` after it refreshes onto this merge. Say so in the
  feedback of its card if the gate trips on it.

**EXF-561's manifest arrived:** the three list tests, new `apps/worker/test/surface.ts` and
`existing-surface.test.ts`, `docs/conventions.md`, its docs. No shared module. Disjoint from the grid.

**Shared browser, again:** the grid Build's Clerk counted three `app.ynab.com` tabs in its box after opening
its own. Children do share one browser (evidence for EXF-479). The own-tab rule in every brief stays.

**Not live:** main is `d19f4ff`, live is `d7a3a40`. The targets engine has no screen and no route; deploy it
with the grid.

**Ticket writes:** two (EXF-511 Done and its comment). The Low triage and two links stay owed until about
22:26 UTC.

**Check-in sent** (round 20): what is live, what landed and failed since round 10, backlog, risks, next
steps, and three things only the person can do (try signing in; Plaid Data Transparency Messaging; say
whether to request removal of the stored discovery screenshots and transcripts that show their email or
plan names).

**Backlog:** 91 open feature tickets (EXF-475, 485, 511 done; EXF-487 in progress). Gap: EXF-561 (in
progress), EXF-558 (High), EXF-454 and EXF-560 (Low). Template: nine. Finished since each template's last
review: Build 7, Deploy 4, Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 21

Children used 31 of 200. Two Builds are running: EXF-487 (Plan grid, started in round 19) and EXF-481
(accounts), started now.

- No ticket was filed at the last review.
- **EXF-561 merged as `401970d` (PR #10)** between the check-in and this plan; I approved its card after
  reading the diff (9 files, tests and docs only). Ticket Done and commented. The hand-kept lists are gone:
  `apps/worker/test/surface.ts` gives `apiPaths()`, `listedToolNames()`, `routeModules`, `toolModules`; a new
  resource asserts its own surface in its own test file and never edits `openapi.test.ts`, `mcp.test.ts`,
  `existing-surface.test.ts` or `e2e/mcp.spec.ts`. Its mutation checks passed (empty tool file, duplicate
  name, pathless route file each fail a named test). Build took 23 minutes.
- **The grid's manifest arrived** (pull request #11 open): `pages/plan.tsx`, `apps/web/src/plan/**`,
  `api/months.ts`, `services/budgets.ts`, new `services/default-categories.ts`, `budgets.test.ts`,
  `months.test.ts`, `e2e/months.spec.ts`, new `e2e/plan-grid.spec.ts` and fixtures, docs. No shared module.
  As estimated.
- **Started EXF-481, accounts** (`p_26e65fda71f744f182581e2cffb61047`), now that it adds routes and tools
  as files only. Checked against the grid's manifest: disjoint. Scope notes:
  - API `GET/POST .../budgets/{budget_id}/accounts`, `GET .../accounts/{id}`, tools `list_accounts` and
    `create_account`; balances computed; `on_budget` derived; `date` optional (browser's local date).
  - Errors in the app's envelope (`name_taken` is 409); loan types 422 until EXF-482.
  - Account, Starting Balance and history in one batch; the name check race-safe (a unique index on
    `(budget_id, lower(name))` is allowed as one additive migration).
  - It may not break the existing minimal `createAccount` / `createTransaction` callers, so it does not need
    `months.test.ts`, `budgets.test.ts`, `targets.test.ts` or `e2e/months.spec.ts` (the grid edits some).
  - Pure type rules in `packages/core/src/account-types.ts`: it is the only Build in core now.
  - Web: the Add Unlinked Account flow in `shell/AddAccountDialog.tsx`, a plain sidebar account list (group
    labels, name, balance), a minimal account page. It is the only Build in `apps/web/src/shell/**`.
    Sidebar groups proper are EXF-483, the header EXF-484, the register EXF-513, the bank search EXF-459.
  - Balance input rejects a non-number with "Enter an amount" (the source's `10+5` quirk is not copied).
  - Source: look only; the form and picker may be opened and typed in, "Next" never pressed, the bank
    search never used.
- **Why nothing else:** the web shell is the bottleneck. EXF-470, 472, 473, 474 (plan menu, display options,
  shortcuts, sidebar resize) all change `apps/web/src/shell/**`, which accounts now holds; EXF-468 changes
  `services/budgets.ts`, which the grid holds; everything else is behind the grid or accounts; EXF-558 needs
  an empty moment.
- **No Deploy yet:** main `401970d` adds only the targets engine (no screen, no route) and tests over live
  `d7a3a40`. Deploy when the grid merges.
- Ticket writes this round: 4 (EXF-481 state and comment, EXF-561 Done and comment). The window from the
  21:26 burst frees about 22:26 to 22:31 UTC; apply the owed Low triage at the next review after that.
- Review cadence: Build 8, Deploy 4, Discover 2. The Build template review comes after two more.

### 2026-11-15 · Review round 21

Children used 31 of 200. Two Builds are running: EXF-487 (Plan grid; at its polish step, 14 visits, pull
request #11 open) and EXF-481 (accounts; just started, with its Clerk).

- **Ended since the last review: the Build for EXF-561**, merged as `401970d`. I had already recorded it in
  the round 21 plan (ticket Done and commented there), because the plan came before this review.
- Nothing else ended. Nothing is off course. No card is waiting.
- The grid Build has stored 18 polish screenshots (clone and source pairs). My brief told it to mask the
  email in every source capture; check the card's notes on that when it arrives, and remember that after its
  refresh onto main its fixtures need `target: null` (the targets engine merged after it started).
- Main `401970d`, live `d7a3a40`. Deploy when the grid merges.
- Ticket writes: none now (22:18 UTC; the window frees from about 22:26). Owed, all Low: EXF-525, 527, 501,
  503, 512, 518, 536, 541, 542, 543, 544, 545, 553; links EXF-467 after EXF-510, EXF-480 after EXF-522.

**Backlog:** 91 open feature tickets (2 in progress: EXF-487, EXF-481). Gap: EXF-558 (High), EXF-454 and
EXF-560 (Low); EXF-561 done. Template: nine. Finished since each template's last review: Build 8, Deploy 4,
Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 22

Children used 31 of 200. Two Builds are running: EXF-487 (Plan grid, pull request #11, polishing) and EXF-481
(accounts, started last round). Nothing started this round.

- No ticket was filed at the last review.
- **Why nothing new:** unchanged from round 21. The remaining unblocked tickets change the web shell
  (accounts holds it) or the budgets service (the grid holds it); the rest wait for the grid or accounts;
  EXF-558 needs a moment with no Build running.
- I considered starting the API half of EXF-494 (category-group and category routes, Worker only), which
  would be disjoint from both running Builds. Not done: it would leave one ticket half built, and the grid
  is close to its gate. If the grid's card shows a long wait, split it properly with a new ticket at a
  review instead.
- No Deploy: main `401970d` is still the targets engine and tests over live `d7a3a40`.
- Review cadence unchanged: Build 8, Deploy 4, Discover 2.

### 2026-11-15 · Review round 22

Children used 31 of 200. One is running: the Build for EXF-481 (accounts; pull request #12 open, 22 visits,
at its polish step).

**Ended: the Build for EXF-487 (Plan grid), merged as `129e425` (PR #11)** after 71 minutes, first gate
passed (e2e 35 of 35 three times, changed specs 110 of 110). Ticket Done and commented. I read the diff
before approving (23 files, +2207/-14).

- The grid is in `apps/web/src/plan/**`: `PlanGrid.tsx`, `rows.tsx`, `Toolbar.tsx`, `AvailablePill.tsx`,
  `ProgressBar.tsx`, `collapse.ts`, `progressBars.ts`, `format.ts`, `icons.tsx`, `plan-grid.css`.
  `pages/plan.tsx` mounts it beside an empty `<aside class="plan-inspector">` (room for the right panel).
  `apps/web/src/api/months.ts` has `getMonth` and `useMonth` (query key `["month", budgetId, month]`).
- **Every new plan now has Bills, Needs, Wants and eleven categories**: `services/default-categories.ts`
  adds them, each with its history row, to the batch in `createBudget` (15 create rows with the plan's).
  Existing plans are not backfilled.
- Hooks for later tickets: `saveCollapsed` / `loadCollapsed` in `collapse.ts` (EXF-494 replaces them with the
  server PATCH); `progressBars.ts` (EXF-472); the page key handler for Ctrl/⌘+↑/↓ (EXF-473); inert toolbar
  buttons, checkboxes and hover ⊕ (EXF-494, EXF-498, undo); no target labels (EXF-514).
- Fifteen colours have no token and are declared as named properties at the top of `plan-grid.css`
  (`--separatorStandard`, `--labelHeading`, `--labelAction`, the pill and bar colours). Filing a Low gap
  ticket to move them into `tokens.css`, with the one wrong sentence in the design doc (the ⊕ does not fade
  in). It touches `shell/tokens.css`, so it runs when no Build holds the shell.
- Acceptance: no failure. Collapse is partial only because the source was not driven. Dark theme only.
- Polish: 8 applied, 1 scoped (a plan-local icon rather than editing `shell/icons.tsx`), 1 declined.

**EXF-481's manifest arrived** (pull request #12): core `account-types.ts`; schema `accounts.ts`,
`transactions.ts`, new `amount-input.ts`; Worker accounts service, repositories, new route and tools;
web `api/accounts.ts`, shell `AddAccountDialog.tsx`, `AccountTypePicker.tsx`, `accountTypeLabels.ts`,
`SidebarAccounts.tsx`, `Sidebar.tsx`, `icons.tsx`, `global.css`, `tokens.css`; `pages/account.tsx`; tests and
docs. No migration. As estimated; it is the only Build running. Any Build started beside it must stay out of
`apps/web/src/shell/**`, `packages/core/src/account-types.ts`, `packages/schema/src/accounts.ts` and
`transactions.ts`, the accounts service and the transactions repository.

**Ticket triage, all applied now** (the rate window freed): EXF-525, 527, 501, 503, 512, 518, 536, 541, 542,
543, 544, 545, 553 set to Low with their links; EXF-467 after EXF-510; EXF-480 after EXF-522. EXF-525 and
EXF-545 lost their link to EXF-511 because it is done. Nothing is owed any more. 17 writes this review.

**For the next plan:**

- Deploy main `129e425` (grid, default categories, targets engine; one migration pending:
  `20261115213604_targets.sql`).
- Unblocked by the grid: EXF-494 (category CRUD, with `collapsed`), EXF-489 (edit Assigned), EXF-491 (Ready
  to Assign pill), EXF-493 (month navigation and note), EXF-498 (selection), EXF-521 (inspector), EXF-514
  (targets display), EXF-500 (view chips), EXF-509 (activity popover), EXF-523 (right panel summary). They
  all change `apps/web/src/plan/**` and several add routes over the same services, so they cannot all run at
  once: read each ticket and group by the files they need. First guess: EXF-494 (routes for groups and
  categories, grid rows, toolbar) and EXF-493 (page header, month note route) are far enough apart; EXF-489
  (Assigned cell in `rows.tsx`) overlaps EXF-494's row editing, so it follows.
- The Build template review is due after the next finished Build (9 of 10).

**Backlog:** 90 open feature tickets (EXF-475, 485, 487, 511 done; EXF-481 in progress), all triaged. Gap:
EXF-558 (High), EXF-454 and EXF-560 (Low), plus the one filed now. Template: nine. Finished since each
template's last review: Build 9, Deploy 4, Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 23

Children used 34 of 200. Four are running: the Build for EXF-481 (accounts, pull request #12) from round 21
and three started now.

- The gap ticket filed at the last review exists: **EXF-562** (grid colours into `tokens.css`, one sentence
  in the design doc). Set to Low. It needs a moment when no Build holds the shell.
- **Started the Deploy of main `129e425`** (`p_77deb9856fa0437b93b1b3d693561e94`), `gated_commit` `0943398`
  (trees compared: equal). One additive migration (`20261115213604_targets.sql`). Checks asked: a new test
  plan has Bills, Needs, Wants with 3, 4, 4 categories and `target: null`; the grid in a browser session
  (collapse and progress bars survive a reload); MCP list unchanged; cleanup. I also asked for a count of
  plans that are not test plans, to learn whether the person has started using the app.
- I read EXF-494, 493, 489 and 491 and grouped them by the files they need:
  - **Started EXF-493, month navigation, picker and note** (`p_d0368f708be6478c8718f93c77174947`): the
    Plan header's left part as its own component, `pages/plan.tsx`, the months route, tool, service and
    schema, `api/months.ts`. The limits read returns facts (first month, last assigned month) and the
    browser applies the rule with its local current month, because the Worker's clock is UTC.
  - **Started EXF-489, edit Assigned inline** (`p_538c1bb379f84d0d8d3dac0b6ec51136`): `rows.tsx`,
    `PlanGrid.tsx`, `plan-grid.css`, a new cell component, pure parsing with tests, and the route and tool in
    new files (`PATCH .../months/{month}/categories/{category_id}`, `set_assigned`) over the existing
    `setAssigned`. It may not edit the months files that EXF-493 holds.
  - The two are disjoint from each other and from accounts (which holds `apps/web/src/shell/**`, core,
    the accounts and transactions schema, service and repositories). Both add a line to `docs/README.md`.
  - **EXF-494 (category CRUD) waits for EXF-489**: both change the grid rows. Link set. EXF-489 goes first
    because it is smaller and assigning is the core action; new plans already have categories.
  - **EXF-491 (Ready to Assign pill) waits for EXF-493**: both change the Plan header. Link set. It also
    wants the category picker and the moves route (EXF-492).
- Source rules in the two briefs: look only. EXF-493 may navigate months and open the note popover but never
  save a note; EXF-489 may open and type in a cell but leaves only with Escape.
- Not started: EXF-468 (plan formats: its entry point is the plan menu in the shell, and the money format
  touches the grid's `format.ts`); EXF-558 and EXF-562 (need an empty moment); no flow tests until accounts
  and Assigned are live.
- Carry to later briefs: EXF-508 (local date for targets), EXF-472 and EXF-473 (take over the grid's
  browser-kept settings and shortcuts), the next Build in the grid's docs fixes "fades in" if EXF-562 has
  not.
- Review cadence: Build 9 finished since the last Build template review; the next finished Build triggers
  it. Deploy 4, Discover 2.
- Ticket writes this round: 7 (EXF-562 priority; EXF-493 and EXF-489 state and comment; two links).

### 2026-11-15 · Review round 23

Children used 34 of 200. Three are running: the Deploy of `129e425` (its gate and release have passed; it is
verifying) and the Builds for EXF-493 (month navigation) and EXF-489 (edit Assigned), both a few minutes old.

**Ended: the Build for EXF-481 (accounts), merged as `d2e659b` (PR #12)** after 45 minutes, first gate
passed (e2e 38 of 38 three times). Ticket Done and commented. I read the diff before approving (28 files,
+2382/-21).

- API: `GET .../budgets/{budget_id}/accounts` (`include_closed`), `GET .../accounts/{id}`, `POST .../accounts`
  `{name, type, balance, date?}` answering `{account, starting_balance}`; tools `list_accounts`,
  `create_account`. `Account` gained `cleared_balance`, `uncleared_balance`, `balance`.
- Service `addUnlinkedAccount(env, actor, budgetId, input, {today?})`: one batch (history row, account,
  Starting Balance transaction, its history row), guarded on "sort order is next and the name is free". No
  migration. The minimal `createAccount` stays (now `on_budget` optional, derived from the type).
- Core `account-types.ts`: `isOnBudget`, `isLoanType`, `startingBalanceAmount`,
  `startingBalanceFeedsReadyToAssign`, `STARTING_BALANCE_PAYEE`, the group of a type.
- `packages/schema/src/amount-input.ts`: `parseAmountInput(text)` (plain amounts only), reusable by other
  forms.
- Web: `shell/AddAccountDialog.tsx`, `AccountTypePicker.tsx`, `accountTypeLabels.ts`, `SidebarAccounts.tsx`;
  `api/accounts.ts`; `pages/account.tsx` with its own `.account-header`.
- **A rule to replace:** `activityByMonth` in `repositories/transactions.ts` leaves out a credit account's
  Starting Balance (payee text "Starting Balance", no category, flag off) so it is not counted as
  uncategorized spending. The Build's reviewer found that the first version also dropped payee-less credit
  transactions (SQL NULL); fixed with `coalesce` and a test. **Put in the briefs of EXF-513 and EXF-532:**
  replace the payee-text rule with a proper marker.
- Case folding of names is ASCII only (SQLite `lower`); EXF-547 can revisit.
- The Build's own review chain worked as intended here: designer 12 polish items, reviewer one blocking
  bug, both fixed before the gate.
- Source use: nothing created; "Next" never pressed; the Designer expanded the source's CLOSED sidebar group
  and collapsed it again, and restyled one amount in the page's memory to measure a colour, then put it
  back. No lasting change. The Architect reports the email masked in every screenshot.

**Deploy `p_77deb9856fa0437b93b1b3d693561e94`:** gate passed, release passed, **live at `129e425`**
(migration `20261115213604_targets.sql` applied, none pending, smoke ok, Access shape combined). Its
verification report is not written yet; read it at the next review.

**For the next plan:**

- **Build template review is due:** ten Builds have finished since the template was last reviewed (never).
  Start Improve templates on the Build template with their Thread ids.
- Deploy main `d2e659b` (accounts) once the running Deploy has ended.
- Unblocked by accounts: EXF-483 (sidebar groups), EXF-484 (account headers), EXF-513 (register and
  transactions API), EXF-532 (credit engine), EXF-459 (Plaid Link), EXF-477 (import), EXF-482 (loan types),
  EXF-546 and EXF-547 (type rules). The shell is free again. Read the tickets and group by files: the
  sidebar (EXF-483) and the account page (EXF-484, EXF-513) are different files; EXF-532 is core and Worker.
  They must also stay clear of EXF-493 (Plan header, months files) and EXF-489 (grid rows, new assign files).
- With the shell free, EXF-562 (grid colours into `tokens.css`) could run, but EXF-489 is editing
  `plan-grid.css`; after it.

**Ticket writes:** 2 now (EXF-481 Done and comment).

**Backlog:** 89 open feature tickets (5 done: EXF-475, 481, 485, 487, 511; 2 in progress: EXF-493, EXF-489),
all triaged. Gap: EXF-558 (High), EXF-454, EXF-560, EXF-562 (Low). Template: nine. Finished since each
template's last review: Build 10 (review due), Deploy 4, Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 24

Children used 38 of 200. Six are running: the Builds for EXF-493 and EXF-489 from round 23 and four started
now.

- No ticket was filed at the last review.
- **The Deploy of `129e425` ended, passed: live at `DEPLOY_SHA` `129e425`.** Its checks 1 to 5 passed (a new
  plan has Bills 3, Needs 4, Wants 4 with `target: null`; the grid renders; collapse and progress bars
  survive a reload; no console errors). The summary I read was cut after check 5; read the rest (cleanup and
  the count of plans that are not test plans) at the review.
- **Started the Deploy of main `d2e659b`** (`p_98f50d74ddb74e78904ef57aa417fcf4`), `gated_commit` `cabddec`
  (trees equal), no migration. Checks: accounts API on a test plan (create, list, Ready to Assign rises,
  409, credit card, 422 for a loan), MCP tools, the Add Unlinked Account flow in a browser, cleanup.
- **Started the Build template review** (`p_ba4466d6501f49e2b08b70e18a4bcd86`, Improve templates, mode
  review) on all fourteen ended Builds, with the open template tickets named and nine observations: the
  three Clerk jobs I carry in every brief, resume inputs, card answers not reaching agents, Refresh then
  Regate for a `docs/README.md` line, the review chain that works, where the time goes in UI Builds,
  screenshots listed twice and email masking, the polish file as an unplanned file, the digest's counts, and
  flagging files every feature must edit.
- I read EXF-513 and EXF-483 and scoped them apart:
  - **Started EXF-513, the register** (`p_9a3d48df2d5d492e8f3ead6099fb9a6e`): transactions list, get,
    create, update, delete (plain cases), five MCP tools, the table with sorting and a cleared toggle on the
    account page. New files under `apps/web/src/register/**`; it holds the transactions schema, service and
    repository and `pages/account.tsx`. It may not change `activityByMonth` or the Starting Balance rule, and
    a PATCH may not change payee or category of a credit Starting Balance. Splits, transfers, payees table,
    flags, imports, reconciled state stay with their tickets.
  - **Started EXF-483, sidebar groups** (`p_786e77ad3c2c46a1a202ebf11409fdb1`): `group` on the account
    (REST and MCP, pure function in core), the sidebar groups with totals and collapse, and a small
    general `ui-state` resource (one table) with the key `collapsed_account_groups`. It holds
    `apps/web/src/shell/**`, the accounts schema, service, tool and web api, and core `account-types.ts`.
    STARRED, LOANS and CLOSED are tested from fixtures: no route creates them yet.
  - Both are disjoint from EXF-493 (Plan header, months files) and EXF-489 (grid rows, new assign files).
  - Links set: **EXF-484 (account header) after EXF-513** (same page); **EXF-532 (credit engine) after
    EXF-513** (same repository file, and it replaces the Starting Balance rule).
- **Later EXF-472 should use the `ui-state` resource** for the progress-bar choice and display options.
- Needs a quiet moment, alone, because of always-overlap files: EXF-459 (Plaid Link: new Worker variables in
  `env.ts` and `wrangler.jsonc`) and EXF-558 (`playwright.config.ts`). Plan one when the current six drain.
- Not started: the YNAB import (EXF-477) until splits, transfers and payees exist, or its history would lose
  detail; EXF-562 (grid colours) while EXF-489 edits `plan-grid.css` and EXF-483 holds the shell.
- Flow tests after the accounts Deploy and the Assigned merge: flows 1 (in part), 9, 10 and 11.
- Review cadence: Build 0 since this review; Deploy 5; Discover 2.
- Ticket writes this round: 6 (two states, two comments, two links).

### 2026-11-15 · Review round 24

Children used 38 of 200. Six are running: the Deploy of `d2e659b`, the Build template review, and the Builds
for EXF-493, EXF-489, EXF-513 and EXF-483. None has a card waiting.

**Ended since the last review: the Deploy `p_77deb9856fa0437b93b1b3d693561e94`, passed. Live:
https://budget.doxen.dev at `DEPLOY_SHA` `129e425`** (already noted in the round 24 plan). The rest of its
report, read now:

- All six checks passed; cleanup left nothing (`purge` printed `remaining 0`, the plan answers 404).
- **The live clone holds 0 plans that are not test plans.** The person has not started using it, so their
  sign-in is still unconfirmed and nothing of theirs can be affected by deploys yet.
- The verifier did not run `scripts/migrations-pending.sh` itself; the release summary shows the one
  migration applied and none pending.
- The Thread's recorder printed the migration's file name as `[masked:input_secret]`. The platform's masking
  mistook it for a secret; the release summary shows the real name. Nothing leaked; noted for the Deploy
  template review (Deploy 5 of 10).
- The Deploy's box again had no Playwright browser and installed it.

**Running Builds:** no manifest has arrived since the plan for EXF-513 and EXF-483 (minutes old). EXF-493 and
EXF-489 are about ten minutes in. Nothing is off course.

**Ticket writes:** none this review.

**Backlog:** 89 open feature tickets (4 in progress: EXF-493, 489, 513, 483), all triaged. Gap: EXF-558
(High), EXF-454, EXF-560, EXF-562 (Low). Template: nine. Finished since each template's last review: Build 0,
Deploy 5, Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 25

Children used 38 of 200. Six are running, all started in rounds 23 and 24: the Deploy of `d2e659b`
(accounts), the Build template review, and the Builds for EXF-493 (month navigation), EXF-489 (edit
Assigned), EXF-513 (register) and EXF-483 (sidebar groups). Nothing started this round.

- No ticket was filed at the last review.
- None of the four Builds has a manifest yet (all with their Architect); the estimates in the plans of
  rounds 23 and 24 stand. Check each against the others when it arrives.
- **Why nothing new:** the four Builds hold the Plan page and header, the grid, the months files, the
  account page, the transactions files, the shell, the accounts files and core's account types. Every
  remaining unblocked ticket needs one of those: loan types (EXF-482) and the type rules (EXF-546, EXF-547)
  need the accounts files and the add-account dialog; the plan menu, display options, shortcuts and sidebar
  resize (EXF-470, 472, 473, 474) need the shell; plan formats (EXF-468) need the plan menu and the grid's
  money format. The rest wait for the grid Builds or the register.
- Next in line, by what frees them: EXF-494 after EXF-489; EXF-491 after EXF-493; EXF-484 and EXF-532 after
  EXF-513; EXF-482 and EXF-486 after EXF-483.
- No further Deploy until the running one ends. No flow tests yet: start flows 9, 10 and 11, and flow 1 as
  far as it goes, when accounts are live and Assigned has merged and shipped.
- Review cadence: Build 0, Deploy 5, Discover 2.

### 2026-11-15 · Review round 25

Children used 38 of 200. Five are running: the Build template review (first step) and the Builds for
EXF-493, EXF-489, EXF-513 and EXF-483. No card is waiting.

**Ended: the Deploy `p_98f50d74ddb74e78904ef57aa417fcf4`, passed. Live: https://budget.doxen.dev at
`DEPLOY_SHA` `d2e659b`** (accounts). Four minutes; e2e skipped (tree equals the gated head `cabddec`); no
migration pending before or after.

- Accounts API on a test plan: checking 250000 answered 201 and Ready to Assign became 250000; the same
  name again answered 409 `name_taken`; a credit card of 150000 shows a balance of -150000, leaves Ready to
  Assign at 250000 and adds no uncategorized amount; a mortgage answered 422.
- MCP lists five tools (`create_account`, `create_budget`, `get_plan_month`, `list_accounts`,
  `list_budgets`) and `list_accounts` equals REST.
- Web: the sidebar lists accounts under CASH and CREDIT; the form, the picker (four groups, thirteen
  options) and the success screen work; Done opens the account page; no failed responses, no console
  errors; the Plan grid still renders.
- Cleanup left nothing; deleting the plan makes its accounts unreachable (404).
- Still 0 plans that are not test plans.
- One thing to watch, not a defect yet: the verifier's first screenshot after "Done" was taken before the
  account page had rendered; after a reload it was correct. If a flow test sees a blank account page after
  Done, look at the navigation after creating an account.

**What is live now:** plans and their URLs, the Plan grid with default categories, the budget and targets
engines behind the API, accounts with Add Unlinked Account. Not yet: editing Assigned, month navigation, the
register, sidebar groups (all in Builds now).

**For the next plan:** flow tests become worth a child once Assigned is live (flow 1 needs it). Flows 9
(two plans stay separate) and 11 (Access lock) could run now; flow 10 needs the transactions API. Decide in
the plan whether to start 9 and 11 now or all four together after the next Deploy. My leaning: wait one
Deploy, so that each flow test sees accounts, Assigned and the register together.

**Ticket writes:** none this review.

**Backlog:** 89 open feature tickets (4 in progress), all triaged. Gap: EXF-558 (High), EXF-454, EXF-560,
EXF-562 (Low). Template: nine. Finished since each template's last review: Build 0, Deploy 6, Discover 2,
Test user flow 0.

### 2026-11-15 · Plan round 26

Children used 38 of 200. Five are running, all started in rounds 23 and 24: the Build template review and
the Builds for EXF-493, EXF-489, EXF-513 and EXF-483. Nothing started this round.

- No ticket was filed at the last review.
- Main is `d2e659b` and it is live: nothing to deploy.
- No manifest has arrived yet for the four Builds (EXF-493 and EXF-489 are ten minutes into their
  Architect step, which for the grid and accounts Builds took about fifteen).
- **Builds:** nothing can start beside the four; the reasons of round 25 stand.
- **Flow tests: decided to wait one Deploy.** Flows 9 and 11 could run now, but flow 1 needs Assigned and
  flow 10 needs the transactions API, both in Builds now. Four flow tests after the next Deploy tell more
  than two now and two reruns later.
- Review cadence: Build 0, Deploy 6, Discover 2.

### 2026-11-15 · Review round 26

Children used 38 of 200. Four Builds are running: EXF-493, EXF-489, EXF-513 and EXF-483. No card is waiting.

**Ended: the Build template review `p_ba4466d6501f49e2b08b70e18a4bcd86`, completed.** It read all fourteen
ended Builds and every open template ticket, filed six tickets and posted five evidence comments. Its report
records the decision `approve_all` with two remarks applied while filing. **No proposals card reached me for
this review** (the Discover review in round 13 did send me one), so that decision was not mine: either the
person answered it on the Thread page or the template now decides differently. I have read every proposal
now and I agree with each; nothing to file again.

New template tickets, priorities set now as the report suggests:

- **EXF-563 (High):** commands wrapped in a background-and-poll wait hold a step until its full timeout
  after the command has finished. This was the largest single time cost: 19.7 of 21.7 minutes in one review
  step of the grid Build, nearly 10 minutes in a gate fix of the profile-fix Build.
- **EXF-564 (High):** write the docs-index line at land and catch a moved base before the approval card
  (three cards instead of one for EXF-475).
- **EXF-567 (High):** the `screenshots` output has one entry per file, matches the disk and lists every
  undeclared capture. Privacy: 9 undeclared source captures stayed on disk in the accounts Build.
- **EXF-565 (Medium):** codify never turns a one-time scope check into a permanent test.
- **EXF-566 (Medium):** the approval digest counts what the report says and reaches the card as written.
- **EXF-568 (Medium):** the Architect flags files that every feature of its kind must edit.
- Evidence comments on EXF-455, 457, 559, 479 and 555. Nothing closes.

Its answers to my questions, to act on:

1. **Resume is broken in the template** (the resume step reads the branch only from `request.json`); my
   input was fine. Keep carrying commits over with an ordinary Build.
2. **Card answers do not reach agents**, confirmed on all four non-approval cards. Keep every instruction in
   the brief.
3. Where the time goes in UI Builds: the plan step 12 to 18 minutes, polish 9 to 12, and the stuck wait
   above. The gate itself is under 3 minutes.
4. **In EXF-475 the polish step reversed my scope note 1 and I approved it.** I read that diff at the time
   and accepted what it did; noted here so I check scope notes against the polish list at every card.

**Two things I add to every Build brief from now on:**

- "Run long commands in the foreground and wait for them to return; do not start a command in the
  background and poll for it with a timeout loop" (until EXF-563 is fixed).
- "List every screenshot you keep, and delete any capture of the source you do not list" (until EXF-567).

**Privacy follow-up:** nine undeclared source captures stayed on disk in the box of the accounts Build
(`p_26e65fda…`). Boxes are not the repository and nothing was committed, but this adds to the stored
artifacts the person has not yet said whether to have removed. Mention it at the next check-in.

**Running Builds:** nothing off course; no manifests read this turn.

**Ticket writes:** 6 (the priorities above).

**Backlog:** 89 open feature tickets (4 in progress), all triaged. Gap: EXF-558 (High), EXF-454, EXF-560,
EXF-562 (Low). Template: fifteen (EXF-455, 456, 457, 479, 554 to 557, 559, 563 to 568). Finished since each
template's last review: Build 0, Deploy 6, Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 27

Children used 38 of 200. Four Builds are running, started in rounds 23 and 24: EXF-493, EXF-489, EXF-513 and
EXF-483. Nothing started this round.

- No ticket was filed by me at the last review; the six from the Build template review (EXF-563 to EXF-568)
  exist and have their priorities.
- **Manifests arrived for two Builds, and they are disjoint:**
  - EXF-493 (month navigation): `pages/plan.tsx`; new `plan/PlanHeader.tsx`, `MonthPicker.tsx`,
    `MonthNotePopover.tsx`, `monthNav.ts`, `monthNavIcons.tsx`, `useDismiss.ts`, `plan-header.css`;
    `api/months.ts`; schema `months.ts`; Worker `routes/months.ts`, `mcp/tools/months.ts`,
    `services/months.ts`, new `repositories/month-range.ts`; new tests. No shared module, no migration.
  - EXF-489 (edit Assigned, pull request #13 open): new `plan/AssignedCell.tsx`; `rows.tsx`, `PlanGrid.tsx`,
    `plan-grid.css`, `plan/icons.tsx`; new `api/assigned.ts`; new schema `month-categories.ts` and
    `assigned-edit.ts` (the parsing, with tests); new Worker route, tool and service `month-categories`;
    new tests and `e2e/plan-grid.spec.ts`. No shared module, no migration.
  - Neither touches the account page, the transactions files, the shell or the accounts files (EXF-513,
    EXF-483). `plan/useDismiss.ts` from EXF-493 is a popover helper later grid Builds should reuse.
- EXF-513 and EXF-483 have no manifest yet.
- Nothing else can start: the reasons of round 25 stand. Main `d2e659b` is live; nothing to deploy. Flow
  tests wait for the next Deploy.
- Review cadence: Build 0, Deploy 6, Discover 2.

### 2026-11-15 · Review round 27

Children used 38 of 200. Three Builds are running: EXF-493 (pull request #15), EXF-513 (#16) and EXF-483
(#14), all past their plan step and in polish or review. No card is waiting.

**Ended: the Build for EXF-489 (edit Assigned), merged as `0c81b09` (PR #13)** after 46 minutes, first gate
passed (e2e 53 of 53 three times, changed specs 180 of 180). Ticket Done and commented. I read the diff
before approving (21 files, +1963/-16).

- `PATCH .../months/{month}/categories/{category_id}` `{assigned}` and the tool `set_assigned`, in new files
  (`routes/month-categories.ts`, `mcp/tools/month-categories.ts`, `services/month-categories.ts` with
  `setAssignedAndRead`), over the unchanged `setAssigned` and `getPlanMonth`.
- `packages/schema/src/assigned-edit.ts`: `evaluateAssigned(text, before)`, `formatAssignedInput`,
  `applyAssigned(month, categoryId, assigned)` (the optimistic update of a cached month), with tests.
- Web: `plan/AssignedCell.tsx`; `api/assigned.ts` with `useCommitAssigned` (optimistic write, PATCHes sent
  one after another per plan, refetch when the queue is empty, old value back on failure).
- Unplanned but harmless: a ref on `AvailablePill`, `amountClass` moved into `format.ts`, and one line in
  `e2e/accounts.spec.ts` (an exact locator for "Mortgage", because Assigned cells now carry category names).
- Known, cosmetic: a window-focus refetch can briefly show an older value while edits are queued.
- Not built by scope: undo and Recent Moves (EXF-504, moves), row selection on open (EXF-498), the Ready to
  Assign pill (EXF-491).

**Manifests of the three running Builds, all arrived and pairwise disjoint:**

- EXF-493: as noted in the round 27 plan.
- EXF-513: schema `transactions.ts` and new `register.ts`; Worker transactions service and repository, new
  route and tools; web `api/transactions.ts`, `register/**`, `pages/account.tsx`; tests. No migration.
- EXF-483: core `account-types.ts` (`DISPLAY_GROUPS`, `displayGroup`, `sidebarSections`); schema
  `accounts.ts` and new `ui-state.ts`; one migration (`*_ui_state.sql`) with table, repository, service and
  route; accounts service and tool; web `api/accounts.ts`, new `api/ui-state.ts`, the shell's sidebar files,
  `tokens.css`; `e2e/accounts.spec.ts`; tests.
- `e2e/accounts.spec.ts` was also touched by the merged EXF-489 (one line): EXF-483 will meet it at its
  refresh. `docs/README.md` likewise for all three.

**For the next plan:**

- **EXF-494 (category create, rename, delete) is unblocked** by this merge. It must stay out of the months
  files and the Plan header (EXF-493 still running): new route and tool files for category groups and
  categories; grid rows, toolbar, `collapse.ts`. It cannot import `plan/useDismiss.ts` (EXF-493's popover
  helper, not merged yet): either wait for EXF-493 to merge first, which is close, or accept a second
  helper. Prefer to start EXF-494 after EXF-493 merges if that is within a round.
- Main `0c81b09` is not live (Assigned). Deploy when EXF-493, EXF-513 and EXF-483 have merged too, or
  sooner if they take long: Assigned alone is worth showing.
- Add the two brief lines from the template review (foreground commands; list every screenshot kept).

**Ticket writes:** 2 (EXF-489 Done and comment).

**Backlog:** 88 open feature tickets (6 done; 3 in progress: EXF-493, 513, 483), all triaged. Gap: EXF-558
(High), EXF-454, EXF-560, EXF-562 (Low). Template: fifteen. Finished since each template's last review:
Build 1, Deploy 6, Discover 2, Test user flow 0.

### 2026-11-15 · Plan round 28

Children used 39 of 200. Four Builds are running: EXF-493 (pull request #15), EXF-513 (#16) and EXF-483 (#14)
from earlier rounds, and one started now.

- No ticket was filed at the last review.
- **The child budget needs care.** 39 of 200 children are used and 88 feature tickets are open. One Build
  per ticket, plus Deploys, flow tests and reviews, would not fit in the 161 that remain. From now on:
  **group two or three tickets that change the same files into one Build** (the Clerk's `request.json`
  takes a list), **one Deploy for several merges**, and flow tests in batches after a Deploy. Tell the
  person at the round 30 check-in that the limit of 200 will probably need raising before parity, with the
  numbers.
- **Started one Build for EXF-494 and EXF-495 together** (`p_4f6bdb700cf54bec9c138cdfb3649b02`): category
  and group create, rename, delete with reassignment, hide and unhide, and collapse saved on the server.
  This is the first Build with two tickets; watch that the template's later steps treat both (the brief
  holds both tickets' text and asks for one report with cases named by ticket). Scope notes:
  - Routes and tools in new files; errors in the app's envelope; new rows at the top without changing what
    existing callers of the append services get.
  - Delete with history is one batch (transactions moved, assigned amounts added per month, target row
    removed, soft deletes, history rows); the statement that moves transactions goes in a repository file
    of its own, because EXF-513 holds the transactions repository.
  - `PATCH category_groups {collapsed}` writes no history row; `plan/collapse.ts` drops its browser copy.
  - A shared category picker (`apps/web/src/plan/`), for EXF-491, EXF-492 and EXF-517.
  - It may use `plan/useDismiss.ts` only if EXF-493 has merged when it rebases; otherwise its own helper.
  - It corrects the "fades in" sentence in `docs/plan-grid-design.md` (so EXF-562 keeps only the tokens).
  - A plain click on a category name opens the edit popover until EXF-498 brings selection.
  - Out of bounds: the Plan page, header and months files (EXF-493); account page, register, transactions
    files (EXF-513); shell, accounts files, core (EXF-483).
  - Source: popovers may be opened and left with Cancel or Escape; never OK, Hide, Delete or an unhide.
  - Two new lines in every brief from the template review: long commands in the foreground; list every
    screenshot kept and delete unlisted source captures.
- **No Deploy now, on purpose:** main `0c81b09` adds Assigned over live `d2e659b`. Three more Builds have
  pull requests open; one Deploy after they merge ships all four and saves two or three children.
- No flow tests until that Deploy.
- **Groupings to use next** (same files, one Build each): EXF-491 with EXF-492 (Ready to Assign pill and
  move money: both need the picker and the moves route); EXF-484 with EXF-486 (account header and Edit
  Account); EXF-517 with EXF-507 (inline transactions and the payee picker); EXF-498 with EXF-521
  (selection and the inspector); EXF-524 with EXF-526 (splits and transfers) if their sizes allow.
- Review cadence: Build 1, Deploy 6, Discover 2.
- Ticket writes this round: 4.

### 2026-11-16 · Review round 28

Children used 39 of 200. Three Builds are running: EXF-493 (pull request #15), EXF-513 (#16), and the
two-ticket Build for EXF-494 and EXF-495 (with its Architect, no manifest yet). No card is waiting.

**Ended: the Build for EXF-483 (sidebar groups), merged as `5c4802e` (PR #14)** after 58 minutes, first gate
passed (e2e 62 of 62 three times). Ticket Done and commented. I read the diff before approving (25 files,
+1598/-50).

- Core `account-types.ts`: `DISPLAY_GROUPS`, `displayGroup(type, closed)`, `sidebarSections`. `Account` has
  `group` in REST and MCP.
- **`ui-state` resource:** `GET` / `PUT /api/v1/budgets/{budget_id}/ui-state`; table `ui_state(budget_id,
  key, value, updated_at)` (migration `20261115231600_ui_state.sql`); keys are the lines of
  `UI_STATE_FIELDS` in `packages/schema/src/ui-state.ts` (one today: `collapsed_account_groups`); a strict
  schema refuses unknown keys; no history row; no MCP tool. Web: `api/ui-state.ts`. **EXF-472 should move
  the grid's progress-bar choice here.**
- The sidebar lists closed accounts too now (`useAccounts` asks for them), under CLOSED.
- Acceptance 5 pass, 10 partial, 0 fail: the partial cases cannot be seen in the source today or cannot be
  created through a route yet; they rest on fixture tests. Codify added a geometry test for the header.
- **Open point:** the Designer saw the source list CLOSED accounts in an order that is not A to Z (polish
  P3, declined because the ticket and my note said A to Z). Unknown which rule the source uses (perhaps the
  account order, or the time of closing). Ask the first flow test that closes accounts, or the Build that
  adds closing, to observe it.
- The Tester could not screenshot the source's CLOSED group: the shared tab's screenshot call timed out.
  More evidence that children share one browser (EXF-479).

**Main is `5c4802e`; live is `d2e659b`.** Not live: Assigned (EXF-489) and the sidebar groups, with one
migration pending (`20261115231600_ui_state.sql`). Two more pull requests are open (EXF-493, EXF-513); the
plan is still one Deploy after they merge.

**The shell and the accounts files are free again.** Candidates that needed them: EXF-482 (loan types),
EXF-486 (Edit Account, with EXF-484 after the register merges), EXF-470 to EXF-474 (plan menu, display
options, shortcuts, sidebar resize), EXF-468 (plan formats), EXF-562 (tokens; but the categories Build is
editing `plan-grid.css`). Decide in the plan; group them.

**Ticket writes:** 2 (EXF-483 Done and comment).

**Backlog:** 87 open feature tickets (7 done; 4 in progress: EXF-493, 513, 494, 495), all triaged. Gap:
EXF-558 (High), EXF-454, EXF-560, EXF-562 (Low). Template: fifteen. Finished since each template's last
review: Build 2, Deploy 6, Discover 2, Test user flow 0.

### 2026-11-16 · Plan round 29

Children used 40 of 200. Four Builds are running: EXF-493 (pull request #15), EXF-513 (#16), the two-ticket
Build for EXF-494 and EXF-495, and one started now.

- No ticket was filed at the last review.
- **Started EXF-459, Plaid Link and bank connections** (`p_3f31601a41c146cfafb7c84cc556af19`), the start
  of the Plaid chain. I had planned it for a quiet moment, expecting new Worker variables; reading
  `wrangler.jsonc`, `env.ts` and the approved architecture showed that is not needed: the Durable Object
  binding and a cron already exist, and Plaid credentials are stored encrypted in D1, not in Worker
  variables. So it can run beside the others. Decisions I gave in the brief:
  - **Credentials:** `PUT /api/v1/plaid/credentials` (write-only) and `GET` (which environments are set,
    never a value); `scripts/plaid-credentials.sh` pushes them from the environment; `scripts/deploy.sh`
    runs it after the smoke test (a failure warns, it does not fail the release).
  - **No new dependency, no always-overlap file:** Plaid's REST API by `fetch`; Plaid Link from Plaid's own
    script URL. A response header that blocks it may be changed where it is set (possibly `middleware/`).
  - **Environment is a property of the plan:** a new column on `budgets` (`bank_environment`, default
    `production`, `sandbox` for test plans; `scripts/live-test-plans.sh create` sets it). A connection
    records its environment and is used only with plans of the same one. This replaces the looser wording in
    the architecture ("each Item records Sandbox or Production").
  - **OAuth banks:** `/plaid/oauth` page and `redirect_uri` for production plans. **The person must register
    `https://budget.doxen.dev/plaid/oauth` in their Plaid dashboard**: add to the check-in.
  - Tables `bank_connections` and `bank_accounts` as the ticket names them (the architecture said
    `plaid_items` and `plaid_accounts`; the ticket's names win).
  - After linking, a plain confirmation screen; account selection is EXF-461, Manage Bank Connections
    EXF-460. MCP: `list_bank_connections` only.
  - Tests: Plaid stubbed in Worker tests; one real Sandbox round trip without a browser, only when the
    Sandbox variables are present; the production secret never used.
  - **Source limits, tighter than usual:** the bank search may be typed in, no bank may be clicked, and
    Manage Bank Connections may not be opened at all (it lists the person's real banks).
  - It holds the shell (the add-account dialog), the budgets files and two scripts. Out of bounds: the Plan
    page, header and months files; the account page, register and transactions files; the grid and the
    categories files.
- **No Deploy and no flow tests yet**, as planned in round 28: after EXF-493 and EXF-513 merge.
- Not started: anything else in the shell (EXF-459 holds it), EXF-562, EXF-558.
- Next groupings stay as written in round 28, plus: EXF-460 with EXF-461 after EXF-459; EXF-462 with
  EXF-463 after that.
- Review cadence: Build 2, Deploy 6, Discover 2.
- Ticket writes this round: 2.

### 2026-11-16 · Review round 29

Children used 40 of 200. Three Builds are running: EXF-513 (pull request #16, 27 visits, in review or
acceptance), the two-ticket Build for EXF-494 and EXF-495, and EXF-459 (Plaid Link). No card is waiting.

**Ended: the Build for EXF-493 (month navigation), merged as `0de1856` (PR #15)** after 73 minutes. Ticket
Done and commented. I read the diff before approving (21 files, +2021/-21).

- Web: `plan/PlanHeader.tsx` (replaces the plain title in `pages/plan.tsx`; a comment marks where the view
  chips of EXF-500 go), `MonthPicker.tsx`, `MonthNotePopover.tsx`, `monthNav.ts` (`navLimits`, `canPrev`,
  `canNext`), `monthNavIcons.tsx`, `plan-header.css`, and **`plan/useDismiss.ts`** for popovers.
- API: `PATCH .../months/{month}` `{note}` (trimmed; empty clears; max 5,000), tool `set_month_note`, and a
  limits read (`getMonthRange`: `first_month`, `last_assigned_month`) from the new
  `repositories/month-range.ts`. The browser applies the rule with its local month.
- Gate: the full e2e run was 72 of 72 twice and 71 of 72 once. The failure was `e2e/plans.spec.ts:4`
  ("create a plan, switch back, and reopen the last used plan"), 5 of 5 on rerun. It is the first flake of
  the suite. That spec asserts which plan `/` opens while other workers create and open plans in parallel
  (`fullyParallel: true`); it already tries to compare against the list the page loaded, and still lost
  once. With 72 specs and growing, this will return. **Filing a gap ticket.**
- Three small review leftovers (two brief display races around the note save and the Assigned queue; 404
  instead of 422 on the limits read) and the one from EXF-489: commented onto EXF-560, which already holds
  the months leftovers.
- Unplanned: `e2e/accounts.spec.ts` (three exact locators for "Next", because of the new "Next month"
  button). That file has now been edited by three Builds for the same reason: new buttons whose names
  contain an older button's name. Not worth a ticket; tell Builds to use exact names in new specs.

**Main is `0de1856`; live is `d2e659b`.** Not live: Assigned, sidebar groups, month navigation; one
migration pending (`20261115231600_ui_state.sql`). EXF-513 is still in its Build; it has been close for a
while. **In the next plan, deploy now** rather than wait longer: three merges are worth showing, and the
register can ship with the categories Build.

**Unblocked by this merge:** EXF-491 (Ready to Assign pill), to be grouped with EXF-492 (move money). Both
need the shared category picker that the categories Build (EXF-494, EXF-495) is writing now, and EXF-492
changes the Available pill in the grid rows that Build holds. So they start after it merges.

**Ticket writes:** 3 (EXF-493 Done and comment, EXF-560 comment).

**Backlog:** 86 open feature tickets (8 done; 4 in progress: EXF-513, 494, 495, 459), all triaged. Gap:
EXF-558 (High), EXF-454, EXF-560, EXF-562 (Low), plus the one filed now. Template: fifteen. Finished since
each template's last review: Build 3, Deploy 6, Discover 2, Test user flow 0.

### 2026-11-16 · Plan round 30

Children used 41 of 200. Four are running: the Builds for EXF-513 (pull request #16), EXF-494 with EXF-495,
and EXF-459 (Plaid Link), and the Deploy started now.

- The gap ticket filed at the last review exists: **EXF-569** (the flaky "reopen the last used plan" spec).
  Set to Medium. If its fix needs a Playwright project it edits `playwright.config.ts` and runs alone, in
  the same moment as EXF-558.
- **Started the Deploy of main `0de1856`** (`p_a1da6c560bc5490c9e8e5b0b06f37c25`), `gated_commit` `7e4acb6`
  (trees equal), one additive migration (`20261115231600_ui_state.sql`). It ships edit Assigned, the sidebar
  groups and month navigation. I did not wait for the register any longer: it has been in its Build for 70
  minutes and three merges are worth showing. Checks asked: Assigned through the API and in the grid, the
  month note and the limits read, `group` and `ui-state`, seven MCP tools, the header and the sidebar in a
  browser, cleanup, and the count of plans that are not test plans. I told it about the flaky spec
  (EXF-569).
- **No new Build:** the three running Builds hold the account page and the transactions files, the grid and
  the categories files, and the shell with the budgets files. What is free (the months files, the Plan
  header) is wanted by EXF-491 with EXF-492, which need the category picker the categories Build is writing.
- **Flow tests next round**, once this Deploy is live: flow 9 (two plans stay separate), flow 11 (Access
  lock) and flow 1 as far as it goes (plan, account, assign to zero; creating categories is not live yet).
  Flows 2 and 10 after the register is live.
- **Template ticket sweep:** the plan calls for one about every 30 rounds. Fifteen template tickets are open;
  the Build template review in rounds 24 to 26 read all of them and recorded their overlaps (nothing
  closed). A sweep now would repeat that for one child. Deferred to about round 35, together with the Deploy
  template review if it is due by then (Deploy 6 of 10, 7 after this one).
- Review cadence: Build 3, Deploy 6, Discover 2.
- **For the check-in at this round's review:** the child budget (41 of 200 with 86 feature tickets open),
  the Plaid redirect URI, sign-in, the stored captures.
- Ticket writes this round: 1.

### 2026-11-16 · Review round 30 (check-in)

Children used 41 of 200. Three are running: the Deploy of `0de1856` (gate and release passed; verifying) and
the Builds for EXF-494 with EXF-495 (categories) and EXF-459 (Plaid Link). No card is waiting.

**Ended: the Build for EXF-513 (register), merged as `2fcde22` (PR #16)** after 74 minutes, first gate
passed (e2e 76 of 76 three times). Ticket Done and commented. I read the diff before approving (21 files,
+2999/-4).

- Routes: `GET .../accounts/{account_id}/transactions`, and `GET/POST/PATCH/DELETE .../transactions[/{id}]`;
  tools `list_transactions`, `get_account_balances`, `create_transaction`, `update_transaction`,
  `delete_transaction`. Services `addTransaction`, `updateTransaction`, `deleteTransaction`,
  `listAccountTransactions`, `getAccountBalances`, `getTransaction` beside the unchanged
  `createTransaction`.
- `packages/schema/src/register.ts`: `sortTransactions` and the sort columns (shared by the Worker and web).
- Web: `apps/web/src/register/**` (`Register.tsx`, `RegisterTable.tsx`, `RegisterToolbar.tsx`, `format.ts`,
  `icons.tsx`, `register.css`), `api/transactions.ts`; two lines in `pages/account.tsx`.
- Refusals: 409 `transaction_reconciled`; 409 `starting_balance_locked`; 422 "This payee name is reserved"
  for "Starting Balance" on a credit account. EXF-532 removes the last two with the rule behind them.
- **`updated_at` is derived from `change_log`** (the newest row per transaction), one grouped query per
  list, because I froze the insert builders in the brief and a new column would have changed them. Correct
  today, too slow once thousands of transactions exist (the YNAB import, Plaid sync). **Filing a gap
  ticket: store it as a column.** The next Build in these files (EXF-517 with EXF-507) should carry it.
- Acceptance 9 pass, 3 partial (the source's side could not be shown), 0 fail. Polish: 14 applied.

**Deploy `p_a1da6c560bc5490c9e8e5b0b06f37c25`:** gate passed, release passed, **live at `0de1856`**
(migration applied, smoke ok). Its API checks 1 to 5 passed and the browser checks were running when I
read it; read the report at the next review.

**The categories Build's manifest arrived** (two tickets, one design): schema `categories.ts`; categories
service and new `category-delete.ts`; category repositories and new `category-reassign.ts`; new routes and
tools for categories and category groups; grid files (`rows.tsx`, `PlanGrid.tsx`, `Toolbar.tsx`,
`collapse.ts`, `plan-grid.css`, `icons.tsx`) and new `Popover.tsx`, `NamePopover.tsx`, `DeleteDialog.tsx`,
`CategoryPicker.tsx`, `HiddenCategories.tsx`; tests; no migration. It names its own `Popover.tsx` (it
started before `useDismiss.ts` merged). Disjoint from EXF-459.

**Check-in sent** (round 30): what is live, what landed since round 20, the backlog, the child budget with
numbers, risks, next steps, and four things only the person can do.

**For the next plan:**

- Main `2fcde22` is one merge ahead of live (the register). Deploy it with the categories Build, or sooner
  for the flow tests: flows 2 and 10 need the transactions API live.
- Unblocked by the register: EXF-484 with EXF-486 (account header, Edit Account; the shell is held by
  EXF-459, the account page is free), EXF-517 with EXF-507 (inline transactions, payee picker; carries the
  `updated_at` column), EXF-532 (credit engine: core, the transactions repository, the categories files the
  categories Build holds), EXF-548 (report shell).
- Flow tests 9, 11 and 1 on live `0de1856`.

**Ticket writes:** 2 (EXF-513 Done and comment).

**Backlog:** 85 open feature tickets (9 done; 3 in progress: EXF-494, 495, 459), all triaged. Gap: EXF-558
(High), EXF-569 (Medium), EXF-454, EXF-560, EXF-562 (Low), plus the one filed now. Template: fifteen.
Finished since each template's last review: Build 4, Deploy 6 (7 when the running one ends), Discover 2,
Test user flow 0.

### 2026-11-16 · Plan round 31

Children used 43 of 200. Four are running: the Builds for EXF-494 with EXF-495 (categories) and EXF-459
(Plaid Link) from earlier rounds, and two started now.

- The gap ticket filed at the last review exists: **EXF-570** (stored `updated_at`). Set to High and
  started at once (below).
- **The Deploy of `0de1856` ended, passed: live at `DEPLOY_SHA` `0de1856`.** Every check passed (Assigned
  through the API and in the grid, the month note and limits read, `group` and `ui-state`, seven MCP tools,
  the header and the sidebar in a browser, cleanup).
- **The live clone now holds 1 plan that is not a test plan.** The person has signed in and created a plan:
  sign-in works. From now on the live app holds their data. Consequences, in every brief that touches live:
  - never open the bare `/` (it opens the plan opened last, perhaps theirs, and stamps it as opened);
  - never list all plans through the API (use `scripts/live-test-plans.sh list`);
  - mask non-test rows in any screenshot of the plan menu;
  - never write another plan's name or id anywhere.
  If their plan was created before the grid went live it has no categories until the categories Build
  ships (existing plans were not backfilled). I do not look: it is their plan. The categories Build lets
  them add groups themselves; mention it at the next contact.
- **Test user flow inputs, learned from another clone's Threads:** the template takes one input, `flow`, a
  free text that describes the flow or flows to walk; its report starts with `Verdict:` and has one row per
  flow. So several flows fit in one child.
- **Started the first flow test** (`p_943f5578ff6e4b7db6ffdab96fd95d00`): flows 9 (two plans keep their
  data apart) and 11 (the Access lock), clone only. Flow 11 exists only in the clone; flow 9's source side
  would need the source's plan list, which is forbidden, so it is not walked there. One child for two flows,
  also as the first trial of this template on this profile (if a profile key is missing it must name all of
  them). The live rules above are in its text.
- **Started one Build for EXF-484, EXF-534 and EXF-570** (`p_24b188914bc64377afad573abac5152d`): the account
  header with the star (`PATCH accounts {starred}`, an accounts summary, tools `get_account` and
  `update_account`), the All Accounts register (plan-wide transactions list, ACCOUNT column), and
  `transactions.updated_at` as a column with a backfill. It holds the account pages, the register, the
  transactions files and the accounts service, repository, route and tool. Out of bounds: the shell and the
  budgets files and scripts (EXF-459), the grid and the categories files (EXF-494, EXF-495), core.
  - It must make `repositories/category-reassign.ts` (from the categories Build) set `updated_at` if that
    file is on main when it rebases; otherwise it reports that, and I have it fixed in the next Build there.
  - Disjoint from the two running Builds: the categories Build's manifest has no transactions or accounts
    file; EXF-459 was told to stay out of the account page, register and transactions files (its manifest
    has not arrived; check it against this one when it does: `services/accounts.ts` and `api/accounts.ts`
    are the places to look).
- **No Deploy now:** main `2fcde22` is one merge ahead of live (the register). One Deploy when the
  categories Build merges; then flows 1, 2 and 10.
- EXF-517 with EXF-507 (inline transactions, payee picker) waits for both this Build (same files) and the
  categories Build (the shared category picker).
- Review cadence: Build 4, Deploy 7, Discover 2, Test user flow 0.
- Ticket writes this round: 5.

### 2026-11-16 · Review round 31

Children used 43 of 200. Four are running: the categories Build (pull request #17, second polish round),
the Plaid Link Build (pull request #18, implementing), the account-pages Build (EXF-484, 534, 570; just
started) and the first flow test (flows 9 and 11; at its second step, so its profile step passed).

**Ended since the last review: the Deploy `p_a1da6c560bc5490c9e8e5b0b06f37c25`**, passed, live at
`0de1856`. Recorded in the round 31 plan, with the finding that the live clone now holds one plan of the
person.

**EXF-459's manifest arrived.** It is large and as scoped: migrations `*_budgets_bank_environment.sql` and
`*_bank_connections.sql`; a new `apps/worker/src/plaid/**`; tables, repository, services (`bank-connections`,
`institutions`, `plaid-credentials`), routes and schemas for them; the budgets table, repository, service,
route, schema and tool (for `bank_environment`); `list_bank_connections`; shell `AddAccountDialog.tsx`, new
`BankSearch.tsx`, `BankConnected.tsx`, `plaidLink.ts`, `Sidebar.tsx`, `global.css`, `icons.tsx`;
`pages/plaid-oauth.tsx`; `scripts/plaid-credentials.sh`, `scripts/deploy.sh`, `scripts/live-test-plans.sh`
and tests for both scripts; `docs/conventions.md`. No `middleware/` file, no secrets module change, no
always-overlap file.

**Checked against the other two Builds: disjoint.** It has no accounts or transactions file and nothing
under the account pages or the register (the account-pages Build), and nothing under `apps/web/src/plan/`
or the categories files (the categories Build). `docs/README.md` is shared by all, as always.

**The flow-test template works on this profile** as far as its profile step: no `blocked` on a missing key.

Nothing is off course. No card is waiting.

**Ticket writes:** none this review.

**Backlog:** 85 open feature tickets (9 done; 5 in progress: EXF-494, 495, 459, 484, 534), all triaged.
Gap: EXF-570 (High, in progress), EXF-558 (High), EXF-569 (Medium), EXF-454, EXF-560, EXF-562 (Low).
Template: fifteen. Finished since each template's last review: Build 4, Deploy 7, Discover 2, Test user
flow 0.

### 2026-11-16 · Plan round 32

Children used 43 of 200. Four are running, all started in rounds 28 to 31: the categories Build (EXF-494,
EXF-495; pull request #17), the Plaid Link Build (EXF-459; pull request #18), the account-pages Build
(EXF-484, EXF-534, EXF-570) and the first flow test (flows 9 and 11). Nothing started this round.

- No ticket was filed at the last review.
- **Why nothing new:** the three Builds hold the grid and the categories files, the shell with the budgets
  files and scripts, and the account pages with the transactions and accounts files. What is free (the
  months files, the Plan header, core, the Reflect page) is wanted by:
  - EXF-491 with EXF-492, which need the category picker from the categories Build;
  - EXF-532 (credit engine), which needs the transactions repository and the categories files;
  - the reports (EXF-548 and after), which I hold until splits and transfers exist, because every report
    query would have to be rewritten when a transaction can have several categories or two sides.
- No Deploy: main `2fcde22` is one merge ahead of live; deploy when the categories Build merges.
- Review cadence: Build 4, Deploy 7, Discover 2, Test user flow 0.

### 2026-11-16 · Review round 32

Children used 43 of 200. Three Builds are running: the categories Build (pull request #17), the Plaid Link
Build (pull request #18) and the account-pages Build. No card is waiting.

**Ended: the first flow test `p_943f5578ff6e4b7db6ffdab96fd95d00`, completed in 9 minutes. Verdict
`new_gaps`.** The template works on this profile; two flows fit in one child.

| Flow | Verdict | Note |
| -- | -- | -- |
| 9. Two plans keep their data apart | `new_gaps` | data is separate everywhere; one new gap in the plan menu |
| 11. The Access lock | `parity` | every request without credentials gets 401 |

- **Flow 9:** all ten steps hold for the data: accounts, assignments, the month note, Ready to Assign
  (210000 and 85000), page titles and the sidebar's collapse state are per plan in the interface, REST and
  MCP; another plan's account id answers 404 and the page falls back to All Accounts.
- **New gap EXF-571 (set to High): the plan menu's Open Plan submenu is clipped by the sidebar**, so a
  mouse user cannot pick another plan. The submenu sits at x 247 to 394 inside a sidebar that is 259 px wide
  with `overflow: auto`. The browser tests never saw it because Playwright's click scrolls the element into
  view. **Until it is fixed, a person can switch plans only by URL.** It is in the shell
  (`PlanMenu.tsx`), which EXF-459 holds: fix it right after that merges, in one Build with EXF-470 (the
  full plan menu) and EXF-454 (menu polish). Lesson for briefs: ask the Tester to click with a real mouse
  move at the element's centre for anything in a popover or menu.
- **Flow 11:** `/`, the API, `/mcp`, a static asset, forged service-token headers, an unsigned and a
  self-signed JWT, and six other paths all answer 401 from Access; plain HTTP redirects to HTTPS; with the
  service token everything answers. Side note from the report: `/favicon.ico` returns the app's HTML, so
  the app has no favicon file (small; fold into the shell Build above).
- The "Done" navigation after adding an account rendered in 183 ms without a reload: the earlier blank
  screenshot was the Deploy verifier's timing, not a defect.
- Cleanup left nothing.

**Correction to the round 31 plan: the person has NOT yet signed in.** The Deploy verifier of `0de1856`
reported "1 plan on the live clone does not start with ZZ-TEST". The flow test then saw only test plans in
the plan menu, so I checked, read only: the live API lists no plan that is not a test plan, and the live
`change_log` holds 16 plan rows, all creates and deletes of test plans by the service token (eight pairs:
six Deploy checks and this flow test), and none by a user. The table `budgets` has 8 rows, all test plans,
all deleted. So the verifier's count was wrong, and what I wrote in the round 31 plan and told the person
("your sign-in works") was wrong. Told the person in this turn's summary. The stricter rules for the live
app (never open `/`, never list all plans, mask plan menus) stay: they are right for the day the person
does sign in.

- How I checked, for next time: `GET /api/v1/budgets` with the service token piped through `jq` to print
  counts and timestamps only; `wrangler d1 execute budget-db --remote` with `SELECT` statements on
  `change_log` and `budgets` that return the actor kind, the action, the time and whether the name has the
  test prefix, never a name. (`pnpm exec wrangler` installed the dependencies in my box; the repository is
  unchanged.)
- For the Deploy template review (Deploy 7 of 10): a verifier's count of non-test plans was wrong once;
  ask for the method next time (the exact filter), not only the number.

**Ticket writes:** 1 (EXF-571 High).

**Backlog:** 85 open feature tickets (9 done; 5 in progress), all triaged. Gap: EXF-570 (High, in
progress), EXF-571 (High), EXF-558 (High), EXF-569 (Medium), EXF-454, EXF-560, EXF-562 (Low). Template:
fifteen. **Flow verdicts: flow 9 `new_gaps`, flow 11 `parity`; the other nine not run yet.** Finished since
each template's last review: Build 4, Deploy 7, Discover 2, Test user flow 1.

### 2026-11-16 · Plan round 33

Children used 43 of 200. Three Builds are running, started in rounds 28 to 31: the categories Build
(EXF-494, EXF-495; pull request #17), the Plaid Link Build (EXF-459; pull request #18) and the account-pages
Build (EXF-484, EXF-534, EXF-570). Nothing started this round.

- No ticket was filed by me at the last review. EXF-571 (the clipped Open Plan submenu, from the flow test)
  is High and now linked behind EXF-459, which holds the shell; it goes into one Build with EXF-470 and
  EXF-454 as soon as EXF-459 merges.
- **Why nothing new:** unchanged from round 32. The three Builds hold the grid and categories files, the
  shell with the budgets files and scripts, and the account pages with the transactions and accounts files.
- No Deploy: main `2fcde22` is one merge ahead of live `0de1856`; deploy when the categories Build merges.
- No flow test: flows 9 and 11 have run; flows 1, 2 and 10 need the categories and register live.
- To add to every brief with a popover or a menu from now on: "The Tester clicks with a real mouse move to
  the element's centre, not a DOM click, and checks that the element is the topmost one there."
- Review cadence: Build 4, Deploy 7, Discover 2, Test user flow 1.
- Ticket writes this round: 1.

### 2026-11-16 · Review round 33

Children used 43 of 200. Two Builds are running: the categories Build (EXF-494, EXF-495; pull request #17,
working on the changes I asked for) and the account-pages Build (EXF-484, 534, 570; pull request #19, in
polish). No card is waiting.

**Ended: the Build for EXF-459 (Plaid Link), merged as `82aac3a` (PR #18)** after 67 minutes. Ticket Done
and commented. I read the sensitive parts of the diff before approving (55 files, +3708/-19).

- `apps/worker/src/plaid/**`: `client.ts` (`plaidFor(env, environment)`, REST by `fetch`, errors carry only
  Plaid's code and display message), `credentials.ts` (secret names `plaid_credentials:<environment>`),
  `tokens.ts` (`plaid_access_token:<connection id>`), `amounts.ts` (`plaidToMilliunits`), `institutions.ts`
  (popular lists, ids verified against Plaid Sandbox).
- Routes: `PUT`/`GET /api/v1/plaid/credentials`; `GET /api/v1/institutions`, `/institutions/popular`;
  `POST /api/v1/bank-connections/link-token`, `POST` and `GET /api/v1/bank-connections`; all plan-aware
  through `getBudgetEnvironment`. Tool `list_bank_connections`.
- `budgets.bank_environment` (`production` default, `sandbox`): migration
  `20261116002832_budgets_bank_environment.sql`; tables in `20261116002833_bank_connections.sql`.
  `scripts/live-test-plans.sh create` now makes sandbox plans.
- **`scripts/deploy.sh` now pushes the Plaid credentials after the smoke test** (`scripts/plaid-credentials.sh`;
  a failure warns, the release still passes). The next Deploy stores Sandbox and Production credentials
  encrypted in the live database. Ask that Deploy to report the script's one status line and
  `GET /api/v1/plaid/credentials`.
- Web: `shell/BankSearch.tsx`, `BankConnected.tsx`, `plaidLink.ts` (Plaid's script loaded on demand),
  `pages/plaid-oauth.tsx`; a temporary `?add-accounts=connections` parameter for the second variant until
  EXF-460.
- No Content-Security-Policy exists in the app, so nothing had to change for Plaid Link. (Worth a hardening
  ticket one day; not now.)
- Acceptance 14 pass, 1 partial (Plaid's real Link frame could not be scripted past the login), 0 fail. The
  first flow test of flow 5 should drive Sandbox Link by hand on live.
- **To note:** the Tester ran `scripts/plaid-credentials.sh` against the local dev server in its box, which
  stored both credential sets (encrypted) in that box's local database. My brief said the production
  secret must not be used by the Build at all. No Plaid production call was made and the box is discarded;
  I will word that rule more exactly next time ("do not export or send `PLAID_PRODUCTION_SECRET` anywhere,
  including to a local server").
- Colours: three literals were used because their tokens live in the grid's CSS (`--labelAction`,
  `--separatorStandard`, `--actionSecondary`). EXF-562 (move the grid's colours into `tokens.css`) now also
  serves this dialog and the Plan header; raise it to Medium at the next plan.
- Gate: the full run was 88 of 88 twice and 87 of 88 once: `e2e/plans.spec.ts:4` again (EXF-569).

**The categories Build:** I answered its card with Request changes (side turn). Two of three full e2e runs
failed at `e2e/assigned.spec.ts:192`; the gate called it a flake, but it is a race the branch introduces:
collapse is an optimistic write to the cached month, and the Assigned queue's refetch, started earlier,
returns the old `collapsed` and reopens the group. Asked for one rule for every writer of the cached month
(cancel in-flight fetches before an optimistic write; refetch only when no write is pending) in one module,
a test that reproduces the race with a delayed response, three clean full runs, and two small items from
the Tester. This also covers the web leftovers on EXF-560. It is at 47 visits and comparing popover arrows
(round 3), so the feedback reached it (approval-card feedback is the one channel that works).

**The account-pages Build's manifest arrived** and it lists `apps/worker/src/repositories/category-reassign.ts`,
a file the categories Build creates. That is the conditional edit I asked for (set `updated_at` there if the
file is on main at its rebase). By the letter of the scheduling rule this is an overlap of two running
Builds. I let both run: the file exists in only one branch until one of them merges, and whichever merges
second must handle it. **At each of the two cards, check that file**: if categories merges first, the
account-pages Build must set `updated_at` in it; if account-pages merges first, the categories Build must
do so at its refresh, and I say so in that card's feedback.

**For the next plan:**

- **Deploy main `82aac3a` now** (the register and Plaid Link; two migrations; the first run of the
  credentials push). Do not wait for the categories Build any longer.
- **The shell is free:** start the plan-menu Build (EXF-571 High, with EXF-470 and EXF-454). Then EXF-460
  with EXF-461 (also shell), one after the other.
- Flow 10 (REST and MCP) can run after that Deploy; flows 1 and 2 after the categories Build ships.

**Ticket writes:** 2 (EXF-459 Done and comment).

**Backlog:** 84 open feature tickets (10 done; 4 in progress: EXF-494, 495, 484, 534), all triaged. Gap:
EXF-570 (High, in progress), EXF-571 (High), EXF-558 (High), EXF-569 (Medium), EXF-454, EXF-560, EXF-562
(Low). Template: fifteen. Flow verdicts: 9 `new_gaps`, 11 `parity`. Finished since each template's last
review: Build 5, Deploy 7, Discover 2, Test user flow 1.

### 2026-11-16 · Plan round 34

Children used 45 of 200. Four are running: the categories Build (EXF-494, EXF-495; pull request #17, fixing
what I sent back), the account-pages Build (EXF-484, 534, 570; pull request #19), and two started now.

- No ticket was filed at the last review.
- **Started the Deploy of main `82aac3a`** (`p_35445feed3ef4e338886f6265c7210d1`), `gated_commit` `fd719d4`
  (trees equal). It ships the register and Plaid Link, with two additive migrations, and is the first
  release whose script pushes the Plaid credentials into the live database (encrypted). Checks: the
  script's one status line; `GET /api/v1/plaid/credentials` shows both environments set and no value; a
  test plan is a sandbox plan; institution search and a link token through Plaid Sandbox; the transactions
  API with balances after create, clear and delete; thirteen MCP tools; the register and the bank search in
  a browser. **It may not create a bank connection on live** (no route removes one yet) and may not click a
  bank. It must say how it counts plans that are not test plans.
- **Started one Build for EXF-571, EXF-470 and EXF-454, the plan menu**
  (`p_5ee85fcef22241cf8600622a07cc8158`). EXF-571 (High) is the reason: on live, nobody can switch plans
  with a mouse. Scope:
  - the menu and its submenu rendered outside the sidebar's scroll box; every row tested with a real mouse
    move and click at its centre, at two window sizes;
  - the full entry list; **entries whose feature is not built are shown disabled**; a later Build enables
    its entry by adding one file in a folder outside the shell, collected with `import.meta.glob`, so eight
    later tickets do not each need the shell;
  - Log Out to `/cdn-cgi/access/logout`; the plan button shows the signed-in identity from a new
    `GET /api/v1/me`;
  - re-measured width and hover and active colours through `tokens.css`; a favicon;
  - **in the source the Open Plan entry is never hovered or clicked** (its submenu lists the person's other
    plans); only the first level of the menu is studied.
  - It holds the shell. Out of bounds: the grid and categories files; the account pages, register, accounts
    and transactions files.
- **EXF-460 with EXF-461 (Manage Bank Connections, linking bank accounts) wait for this Build**: they need
  the shell (the sidebar's Bank Connections button, the add-account dialog), and EXF-461 also needs the
  accounts files that the account-pages Build holds.
- Later menu tickets (EXF-468, 472, 473, 476, 478, 480, 510, 460) should each add their menu-action file;
  put that in their briefs.
- Flow 10 after this Deploy; flows 1 and 2 after the categories Build ships.
- The template-ticket sweep moves to about round 36, with the Deploy template review if it is due (Deploy 7
  of 10; 8 after this one).
- Review cadence: Build 5, Deploy 7, Discover 2, Test user flow 1.
- Ticket writes this round: 5.

### 2026-11-16 · Review round 34

Children used 45 of 200. Three Builds are running: the categories Build (pull request #17, on my requested
changes), the account-pages Build (pull request #19) and the plan-menu Build (started last round). No card
is waiting.

**Ended: the Deploy `p_35445feed3ef4e338886f6265c7210d1`, passed. Live: https://budget.doxen.dev at
`DEPLOY_SHA` `82aac3a`** (the register and Plaid Link). Seven minutes; e2e skipped (tree equals the gated
head); both migrations applied, none pending; smoke ok.

- All nine checks passed.
- **Plaid credentials are now stored on live:** `GET /api/v1/plaid/credentials` shows `sandbox` and
  `production` configured, each with a time and no value. The release summary did not carry the script's
  one status line, so the verifier could not quote it; the endpoint is the proof. (For the Deploy template
  review: output printed after the script's last `PHASE_SECONDS` line does not reach the summary.)
- Through the live Worker, Plaid Sandbox answers: popular test banks, search for "plat", and a link token
  for a sandbox test plan. No bank connection was created on live.
- The transactions API on live: Starting Balance 500000 / 0 / 500000; after an outflow of 17.34, 500000 /
  -17340 / 482660; cleared, 482660 / 0 / 482660; the category's activity -17340; after delete, back to the
  start.
- MCP lists thirteen tools.
- Web: the register and the bank search (with its Sandbox mark, results and no-match text) work; no console
  errors. Sorting could only be checked by `aria-sort` with one row.
- **Plans that are not test plans: 0**, counted with `GET /api/v1/budgets` filtered on the prefix; the
  unfiltered total was also 0 after cleanup. Consistent with my own check in round 32.
- The platform's recorder again printed a migration's file name as `[masked:input_secret]` (this time
  `20261116002832_budgets_bank_environment.sql`, earlier the targets and ui-state ones). Harmless; for the
  Deploy template review.

**What is live now:** plans and URLs; the Plan grid with default categories, edit Assigned, month
navigation and notes; accounts with Add Unlinked Account and sidebar groups; the account page with the
register (read, sort, cleared toggle; no entry by hand yet); the bank search with Plaid Link for sandbox
plans; 13 MCP tools. Not live: categories create, rename, delete, hide (in rework), the account header and
All Accounts (in a Build), the plan menu fix (in a Build).

**For the next plan:** flow 10 (REST and MCP: create a transaction and read a month with the service
token; through MCP, categorize a transaction and assign money; both visible in the interface and in the
history with the right actor) can run now. There is no history route yet: the flow test may read
`change_log` on the live database with `wrangler d1 execute --remote` and `SELECT` only (the profile's
`live.never_run` allows that), limited to its test plan's rows. Flow 5 (link a bank) needs EXF-461 at
least. Flows 1 and 2 after the categories Build ships.

**Ticket writes:** none this review.

**Backlog:** 84 open feature tickets (10 done; 5 in progress: EXF-494, 495, 484, 534, 470), all triaged.
Gap: EXF-570 and EXF-571 (High, in progress), EXF-454 (Low, in progress), EXF-558 (High), EXF-569 (Medium),
EXF-560, EXF-562 (Low). Template: fifteen. Flow verdicts: 9 `new_gaps`, 11 `parity`. Finished since each
template's last review: Build 5, Deploy 8, Discover 2, Test user flow 1.

### 2026-11-16 · Plan round 35

Children used 46 of 200. Four are running: the categories Build (pull request #17), the account-pages Build
(pull request #19), the plan-menu Build, and the flow test started now.

- No ticket was filed at the last review.
- **Started the flow test of flow 10** (`p_e823d6accfd94427bec7eda412fe3037`) on live `82aac3a`: with the
  service token through REST (account, transaction, assign, an idempotent retry, error shapes), through MCP
  (create a transaction without a category, categorize it, assign, balances, a tool error), then the
  interface shows the same numbers, and the history holds a row per change with `service:` or
  `mcp:service:` as actor. The history is read with `wrangler d1 execute --remote` and `SELECT` only,
  limited to its own plan (there is no history route yet).
  - **Part E, for the person's "API first, MCP critical" requirement:** a table of every REST operation and
    its MCP tool, with one combined gap ticket for REST operations that have no tool (plan rename and
    delete, the months limits read and whatever else it finds), and a second section for tool descriptions
    that omit units or formats. Expected to have no tool by design: health, the OpenAPI document, `/me`,
    the Plaid credentials and link-token routes, creating a bank connection, institution search, `ui-state`.
  - I ran it alone rather than wait to batch it with flows 1 and 2: the API and MCP are what the person
    called critical, and gaps there are cheapest to fix before more resources are added.
  - A slip in my text: step 13 has a half-corrected sentence about the balances ("$1,000,000... no: read
    them as $1,000.00"). The numbers that follow are right; watch that the tester was not thrown by it.
- **No new Build:** the three running Builds hold the grid and categories files, the account pages with the
  accounts and transactions files, and the shell.
- **No Deploy:** main `82aac3a` is live.
- The template-ticket sweep and the Deploy template review: when ten Deploys have finished (8 now), start
  both in one round.
- Review cadence: Build 5, Deploy 8, Discover 2, Test user flow 1.
- Ticket writes this round: none.

### 2026-11-16 · Review round 35

Children used 46 of 200. Three Builds are running: the categories Build (pull request #17; at its review
step after my requested changes, 108 minutes in all), the account-pages Build (pull request #19) and the
plan-menu Build. No card is waiting.

**Ended: the flow test of flow 10 `p_e823d6accfd94427bec7eda412fe3037`, completed in 8 minutes. Verdict
`new_gaps`.**

- **Steps 1 to 15 all pass.** Through REST: an account, a transaction, an assignment, an idempotent retry
  (two identical calls with one `Idempotency-Key` gave one row and byte-identical answers), and three errors
  in the envelope shape. Through MCP: a transaction without a category shows as uncategorized, categorizing
  it moves the activity to the category, assigning brings Available to zero, balances equal REST, and a bad
  category id answers a tool error. The interface shows the same numbers. The history has a row per change
  with `service:` or `mcp:service:` as actor.
- **New gap EXF-572 (set to High, linked behind EXF-484): MCP tools missing for REST operations.** Of 28 REST
  operations and 13 tools, seven operations that are not excluded by design have no tool: update a plan,
  delete a plan, read one plan, read one account (being built in EXF-484), read one transaction, list
  months, and the month navigation limits. Its acceptance asks for **a test that derives the REST
  operations from the OpenAPI document and fails when a non-excluded one has no tool**: that turns the
  person's "API first, MCP too" requirement into a gate for every later Build.
- The same ticket's second part: eight tool descriptions leave out the money unit, the month or date
  format, or what the tool returns; `cleared` offers `reconciled` although it is always refused; two tools
  require a uuid for `budget_id` and the others take any string.
- Cleanup left nothing.
- My slip in step 13 of the brief did not throw the tester.

**Rule for every brief from now on, until EXF-572's test exists:** "Every REST operation you add has an MCP
tool that does the same, and every tool description states the money unit (integer milliunits, negative is
an outflow), the month format (`YYYY-MM-01`), the date format (`YYYY-MM-DD`) and what it returns."

**When to build EXF-572:** it touches the budgets, accounts, transactions and months tool files. The
account-pages Build holds the accounts and transactions tools (and is adding `get_account`); the budgets and
months tools are free. Build it right after the account-pages Build merges, as one Build, alone in those
tool files.

**Running Builds:** nothing off course. The categories Build is long (its second pass through checks,
review, acceptance and gate).

**Ticket writes:** 1 (EXF-572 High with its link).

**Backlog:** 84 open feature tickets (10 done; 5 in progress), all triaged. Gap: EXF-570, EXF-571 (High, in
progress), EXF-572 (High), EXF-558 (High), EXF-569 (Medium), EXF-454 (Low, in progress), EXF-560, EXF-562
(Low). Template: fifteen. **Flow verdicts: 9 `new_gaps` (EXF-571), 10 `new_gaps` (EXF-572), 11 `parity`;
the other eight not run yet.** Finished since each template's last review: Build 5, Deploy 8, Discover 2,
Test user flow 2.

### 2026-11-16 · Plan round 36

Children used 46 of 200. Three Builds are running, started in rounds 28 to 34: the categories Build
(EXF-494, EXF-495; pull request #17, second pass), the account-pages Build (EXF-484, 534, 570; pull request
#19) and the plan-menu Build (EXF-571, 470, 454). Nothing started this round.

- No ticket was filed by me at the last review. EXF-572 (MCP tools missing, from flow 10) is High and linked
  behind EXF-484.
- **Why nothing new:** the three Builds hold the grid and categories files, the account pages with the
  accounts and transactions files, and the shell. Every ready ticket needs one of them:
  - EXF-572 needs the accounts and transactions tool files (account-pages Build);
  - EXF-491 with EXF-492 need the category picker (categories Build);
  - EXF-517 with EXF-507 need both;
  - EXF-460 with EXF-461 need the shell (plan-menu Build) and the accounts files.
- No Deploy: main `82aac3a` is live. No flow test: flows 1 and 2 wait for the categories Build to ship;
  flows 9 and 10 are re-run after their gap tickets (EXF-571, EXF-572) are fixed and deployed.
- The template-ticket sweep and the Deploy template review wait for the tenth Deploy (8 so far); one round
  for both.
- Review cadence: Build 5, Deploy 8, Discover 2, Test user flow 2.

### 2026-11-16 · Review round 36

Children used 46 of 200. One Build is running: the categories Build (pull request #17). I cancelled the
plan-menu Build in this review (below).

**Ended: the account-pages Build, merged as `2d1982e` (PR #19)** after 73 minutes, first gate passed (e2e 97
of 97 three times). EXF-484, EXF-534 and EXF-570 are Done and commented. I checked the scope and read the
data-layer part before approving (38 files, +2159/-117).

- `transactions.updated_at`: not-null column, migration `20261116100000_transactions_updated_at.sql` with
  the backfill; every writer sets it; the grouped `change_log` query is gone. **The file name carries
  10:00 UTC today**, later than when it was written: a migration written before then that depends on this
  column must be named after it. Put that in briefs until 10:00 UTC has passed.
- **`repositories/category-reassign.ts` was not on main**, so `updated_at` is not set there. The categories
  Build must do it at its refresh onto this merge: **put it in the feedback of its next card.**
- Account header: `apps/web/src/account/**`; `PATCH .../accounts/{id}` `{starred}`; an accounts summary;
  tools `get_account`, `update_account`.
- All Accounts: `GET /api/v1/budgets/{budget_id}/transactions`, `list_transactions` without an account,
  the page with the ACCOUNT column.
- Two small display races from its review are noted on EXF-560.

**Cancelled: the plan-menu Build `p_5ee85fcef22241cf8600622a07cc8158` (EXF-571, 470, 454), for breaking the
source rules. A privacy incident; tell the person.** Read from its own transcript:

- **The Designer step opened the source's "Open Plan" submenu**, which lists the person's other plans by
  name, measured its position, and stored screenshots: `pm-submenu-dark-source.png`,
  `pm-submenu-light-source.png`, `polish-P1-dark-source.png`, `polish-P1-light-source.png` (and others of
  the open menu) in the Thread's `screenshots` output. My brief said, in bold, never to hover or click that
  entry, and why. I cannot see the images, so I must assume they show the other plans' names and the
  account email.
- Its report says it compared a **light theme in the source** and that the "dark theme [was] restored":
  it appears to have switched the person's YNAB display setting and switched it back. The brief said to
  click no entry of the menu.
- It says it **measured in another Thread's source tab**, because its own tab was stuck at 560 px wide after
  a screenshot timed out. The brief said never to use another tab.
- Earlier, the Architect's study sub-agent read the page's hidden markup and the other plans' names
  appeared in its tool output; it reported this itself, wrote nothing and kept nothing.
- Nothing of this is in the repository or in a ticket: the branch holds code and docs only, and I name no
  plan anywhere.
- Why cancel instead of waiting for the card: the next polish round would re-measure the submenu the same
  way, and answers on cards do not reach the agents. Cancelling was the only way to stop a repeat.
- The code on the branch is sound and is not lost: head `b7e25de` (26 files, +1883/-109: the menu and
  submenu portalled out of the sidebar, the entry list with disabled entries, the action registry in
  `apps/web/src/menu-actions/`, `GET /api/v1/me`, the favicon, real-mouse specs at four window sizes).
  **Carry it over in the next plan with a new Build in which nobody uses the source app at all**; the one
  open polish item is known (the submenu starts at the Open Plan row's right edge and top, not the menu's
  edge; the Designer gave the numbers).
- **Filing a template ticket**: the Build's Designer, Tester and study sub-agents must be bound by the
  Lead's source rules; a "compare with the source" step treated a forbidden area as its job.
- **For my briefs from now on:** whenever a ticket's subject sits next to something private in the source,
  say "nobody opens the source app in this Build" outright, and give the measurements or accept the
  ticket's description, instead of allowing a limited look.

**The categories Build** has sat at its review step for about 40 minutes with almost no new tokens (cost
13.98 to 14.04 USD in 18 minutes). It may be waiting out a timeout (EXF-563). Leave it one more round; if it
has not moved by the next review, cancel and carry over.

**For the next plan:**

- Carry over the plan-menu work (above). It holds the shell.
- **EXF-572 (MCP tools) can start**: the accounts and transactions tool files are free now.
- Main `2d1982e` is one merge ahead of live `82aac3a` (one migration). Deploy with the categories Build if
  it lands soon, otherwise alone next round.
- Unblocked by the account-pages merge and waiting only for the category picker: EXF-517 with EXF-507.

**Ticket writes:** 6 (three Done, three comments).

**Backlog:** 82 open feature tickets (12 done; 3 in progress: EXF-494, 495, 470), all triaged. Gap: EXF-571
(High, in progress, to carry over), EXF-572 (High), EXF-558 (High), EXF-569 (Medium), EXF-454 (Low, in
progress), EXF-560, EXF-562 (Low); EXF-570 done. Template: fifteen plus the one filed now. Flow verdicts: 9
`new_gaps`, 10 `new_gaps`, 11 `parity`. Finished since each template's last review: Build 7 (one of them
cancelled), Deploy 8, Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 37

Children used 49 of 200. Three Builds are running, all started now. I cancelled the categories Build in this
plan (below).

- The template ticket filed at the last review exists: **EXF-573** (the Build's Designer, Tester and study
  steps obey the Lead's source rules). Set to High.
- **Cancelled the categories Build `p_4f6bdb700cf54bec9c138cdfb3649b02`** and carried it over. Its
  transcript shows the Reviewer wrote "running the touched specs" at 01:28 UTC and nothing after: 30
  minutes at one step with no new tokens (the waiting pattern of EXF-563, or a hung run). Main had also
  moved by two merges, one of which needs a change in its `category-reassign.ts`, so its next card would
  have meant Request changes and another full pass anyway. Its branch head `178c13a` has everything:
  the feature, the fixes for two write races its Reviewer found in delete and unhide, polish P1 to P5, and
  **the fix I asked for**: `apps/web/src/api/monthCache.ts`, one rule for every writer of the cached month,
  with a test that reproduces the collapse and refetch race. (So my Request changes did reach the agents:
  the notice with my explanation is in the transcript, and the Implementer followed the payload.)
- **Carry-over pattern when main has moved:** the Clerk's merge job is `git merge --no-edit
  origin/exfab/<old thread>` (not `--ff-only`), with the expected diff size printed and the rule for a
  `docs/README.md` conflict. I tried both merges with `git merge-tree` first: no conflicts.
- **Started the carry-over of EXF-494 and EXF-495** (`p_4fe1cb348be24f9f9bee5b5622d29168`): merge
  `178c13a` (expected 39 files, +4896/-94 against main), then three changes only: `updated_at` on the
  transactions a delete with reassignment moves; MCP tools for `unhide_all` and the two usage reads, with
  the description rules; fixes for anything the merge breaks. It holds `apps/web/src/plan/**`,
  `api/categories.ts`, `api/assigned.ts`, `api/months.ts`, `api/monthCache.ts` and the categories files.
- **Started the carry-over of EXF-571, EXF-470 and EXF-454, the plan menu**
  (`p_9a58f4af528e469b93711c3de218e26d`): merge `b7e25de` (expected 26 files, +1883/-109), then one change:
  the Open Plan submenu starts at the Open Plan row's right edge and top (numbers from the cancelled
  Thread's Designer: left 244, top 100 at the default size), with the two tests and the design doc that
  encode the old placement. It holds the shell, `menu-actions/`, the `/me` route, the favicon.
- **In both carry-overs nobody opens the source app at all**, said in capitals for every role, with the
  sentence to answer when a step's own instructions ask for a comparison.
- **Started EXF-572, MCP tool coverage** (`p_14fe85267f7449f192572c1b7cfc9cbf`), Worker only: six new tools
  (`update_budget`, `delete_budget`, `get_budget`, `get_transaction`, `list_plan_months`,
  `get_month_range`), a coverage test that reads the OpenAPI document and needs a tool or a stated exclusion
  for every operation (mapping kept in one data file next to the test), a description test, the rule in
  `docs/conventions.md`. Exclusions by design: health, the OpenAPI document, Plaid credentials, link token
  and creating a bank connection, institution search, `ui-state`, `/me`. It holds the six tool files on
  main and adds no route.
- **How the three fit together:** disjoint files. The categories carry-over brings its own tools and
  description quality; EXF-572 adds the category operations to its mapping if they are on main when it
  rebases, otherwise it reports that and whichever merges second adds the lines (check at the cards: **if
  EXF-572 merges first, the categories carry-over must add its operations to the mapping file at its
  refresh, or its gate will fail on the coverage test**; if categories merges first, EXF-572 adds them).
  `/me` is excluded in advance.
- **No Deploy now:** main `2d1982e` is one merge ahead of live `82aac3a`. One Deploy when these three have
  merged; it will be the ninth.
- No flow test: flows 1 and 2 and the re-runs of 9 and 10 after that Deploy.
- Review cadence: Build 8 since the last Build review (two of them cancelled by me), Deploy 8, Discover 2,
  Test user flow 2. The Build template review comes due again at 10; give it the two cancelled Threads.
- Ticket writes this round: 5.

### 2026-11-16 · Review round 37

Children used 49 of 200. Three Builds are running, all started in the round 37 plan: the categories
carry-over, the plan-menu carry-over and EXF-572 (MCP coverage). No card is waiting.

**Ended since the last review:** the two Builds I cancelled, both now abandoned and both carried over:
`p_5ee85fcef22241cf8600622a07cc8158` (plan menu; cancelled in the round 36 review for breaking the source
rules) and `p_4f6bdb700cf54bec9c138cdfb3649b02` (categories; cancelled in the round 37 plan after it
stalled). Their tickets stay In Progress under the carry-over Builds. Nothing merged, nothing deployed.

**The carry-overs started cleanly:**

- Categories (`p_4fe1cb348be24f9f9bee5b5622d29168`): the Clerk's merge met the expected conflict in
  `docs/README.md`, kept both sides, and printed the expected size (39 files, +4896/-94, eight commits ahead
  of main). The Architect is checking the branch's tests for raw transaction inserts that the new not-null
  `updated_at` column would break: the right thing to look for.
- Plan menu (`p_9a58f4af528e469b93711c3de218e26d`): the merge was a fast-forward to `378b72b`, 27 files,
  +1894/-109, a little more than the 26 files I quoted: the cancelled Thread's Implementer had already
  committed the submenu placement change and rebased onto main before the cancel took effect. So change 1 is
  already on the branch; the Architect noticed and is checking the tests instead of redoing it.
- Lesson for carry-over briefs: quote the expected size as "at least", or read the branch head at the
  moment of writing; a cancelled Thread can still push a last commit.

**EXF-572** (`p_14fe85267f7449f192572c1b7cfc9cbf`): with its Architect; no manifest yet.

Nothing is off course.

**Ticket writes:** none this review.

**Backlog:** 82 open feature tickets (12 done; 3 in progress: EXF-494, 495, 470), all triaged. Gap: EXF-571
and EXF-572 (High, in progress), EXF-454 (Low, in progress), EXF-558 (High), EXF-569 (Medium), EXF-560,
EXF-562 (Low). Template: sixteen. Flow verdicts: 9 `new_gaps`, 10 `new_gaps`, 11 `parity`. Finished since
each template's last review: Build 8, Deploy 8, Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 38

Children used 49 of 200. Three Builds are running, all started in round 37: the categories carry-over
(EXF-494, EXF-495), the plan-menu carry-over (EXF-571, EXF-470, EXF-454) and EXF-572 (MCP coverage).
Nothing started this round.

- No ticket was filed at the last review.
- **Why nothing new:** the three Builds hold the grid and categories files, the shell, and the MCP tool
  files. What is ready needs one of them: EXF-517 with EXF-507 need the category picker and the
  transactions tool file; EXF-491 with EXF-492 need the picker and the grid; EXF-460 with EXF-461 need the
  shell.
- No Deploy: main `2d1982e` is one merge ahead of live `82aac3a`; one Deploy when the three Builds have
  merged. No flow test until then.
- At the cards of the categories carry-over and EXF-572: whichever merges second must add the category
  operations to the coverage mapping (see the round 37 plan).
- Review cadence: Build 8, Deploy 8, Discover 2, Test user flow 2.

### 2026-11-16 · Review round 38

Children used 49 of 200. Two Builds are running: the plan-menu carry-over (at its acceptance step) and
EXF-572, MCP coverage (reworking what I asked for). No card is waiting.

**Ended: the categories carry-over, merged as `325ee94` (PR #22)** in 32 minutes. EXF-494 and EXF-495 are
Done. Gate: e2e 111 of 111 three times, no flake (the cancelled Build's version had failed two runs in
three). I checked the carry-over's changes in the diff (39 files, +5141/-94): `moveTransactionsStmt` now
sets `updated_at` to the delete's time; three more tools; nothing else.

- The two-ticket Build worked: one design, one pull request, both tickets accepted. Grouping is safe to
  keep using.
- A carry-over with "nobody opens the source app" also worked: the Tester noted "source_check.sh not run
  (source forbidden)" and kept clone screenshots only.
- What later Builds build on: `apps/web/src/plan/CategoryPicker.tsx` (shared picker), `Popover.tsx`,
  `apps/web/src/api/monthCache.ts` (the one rule for writers of the cached month), `api/categories.ts`;
  Worker `services/categories.ts`, `services/category-delete.ts`, `repositories/guards.ts`.

**EXF-572's card, answered in the same side turn: Request changes** (the gate was clean, 97 of 97 three
times). Two reasons, neither a defect:

1. The categories merge adds nine operations and eleven tools; EXF-572's coverage test would fail on main
   once both were merged. It must rebase onto `325ee94` and add them (two tools can serve one operation:
   rename and hide share a PATCH, so a coverage line may name several tools).
2. **My mistake in its brief:** I asked for the mapping in one file. Every route-adding Build would edit it,
   and by the scheduling rule Builds that share a file cannot run side by side: the same hot spot EXF-561
   removed. Asked for one coverage file per resource in a folder, collected with `import.meta.glob`, with
   the rule in `docs/conventions.md`.
   It is at its rework step now.
- What it built, for later briefs: tools `update_budget`, `delete_budget`, `get_budget`, `get_transaction`,
  `list_plan_months`, `get_month_range`, `get_account_summary`; `apps/worker/test/mcp-coverage.test.ts` and
  `mcp-descriptions.test.ts`; `apps/worker/src/mcp/tool-text.ts` (shared description text).
- **Rule for every brief once EXF-572 has merged:** a Build that adds a REST operation adds its tool and its
  own coverage file (or a line in its resource's file), or an exclusion with a reason; the description test
  checks units and formats.

**Main is `325ee94`; live is `82aac3a`.** Not live: the account pages with `updated_at` (one migration) and
categories. Two more Builds are close. **Deploy when both have merged**, or next round with what is there
if they take long.

**Unblocked now** (the grid, the categories files and the picker are on main; the account pages and the
transactions files are free; the tool files are held by EXF-572 until it merges):

- EXF-491 with EXF-492 (Ready to Assign pill, move money): Plan header, grid pill, a moves route and tool.
- EXF-517 with EXF-507 (inline transactions, payee picker): register, transactions files, a payees table.
  Both need new tools: in new tool files they do not collide with EXF-572, but they should start after it
  merges so they can follow its coverage rule from the start. Decide in the plan.

**Ticket writes:** 3 (two Done, one comment).

**Backlog:** 80 open feature tickets (14 done; 1 in progress: EXF-470), all triaged. Gap: EXF-571 and
EXF-572 (High, in progress), EXF-454 (Low, in progress), EXF-558 (High), EXF-569 (Medium), EXF-560, EXF-562
(Low). Template: sixteen. Flow verdicts: 9 `new_gaps`, 10 `new_gaps`, 11 `parity`. Finished since each
template's last review: Build 9, Deploy 8, Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 39

Children used 51 of 200. Four Builds are running: the plan-menu carry-over (EXF-571, EXF-470, EXF-454, at
acceptance), EXF-572 (MCP coverage, reworking), and two started this round.

- No ticket was filed at the last review.
- **Started EXF-491 with EXF-492** (`p_ed90e00d9e644c1aa0719b13500b32d1`): the Ready to Assign pill
  (breakdown, Assign Manually, Fix This) and Move and Cover from the Available pill.
  - Surface: `POST .../months/{month}/moves` (`from`, `to`, `amount`; `"ready_to_assign"` is a valid end),
    `POST .../months/{month}/categories/{category_id}/cover`, tools `move_money` and `cover_overspending`
    in a new tool file.
  - Holds: `apps/web/src/plan/**` (with `CategoryPicker.tsx`), `api/months.ts`, `api/assigned.ts`,
    `api/categories.ts`, `api/monthCache.ts`, `services/months.ts`, the months routes and schema,
    `assigned-edit.ts`.
  - Every write to the cached month goes through `monthCache.ts`. The "Auto" tab is drawn disabled.
  - It may look at the source's Plan page under the usual limits.
- **Started EXF-517 with EXF-507** (`p_19407e1a62d54f93b69b9199878c07b6`): the add and edit row of the
  register, and payees with the payee picker.
  - **Nobody opens the source**: the test plan has no open account, so the tickets are the specification.
  - Data: a `payees` table, `transactions.payee_id`, a backfill from the payee text, system payees. The
    credit Starting Balance rule moves from payee text to the system payee; the reserved-name refusal goes.
  - Surface: `GET .../payees`, tool `list_payees` in a new tool file; transaction create and update accept
    `payee_id` or `payee_name`.
  - Holds: `apps/web/src/register/**`, `api/transactions.ts`, a new `api/payees.ts`, the transactions and
    payees Worker files, `services/accounts.ts`.
  - Its category field is a dropdown of its own under `register/` (the other Build holds the Plan picker).
    **Two category dropdowns will exist after both merge: a later ticket should fold them into one.**
  - Left out or drawn disabled: transfer payees and "Payment/Transfer" (EXF-526), "Split" (EXF-524),
    "Manage Payees" (EXF-510), the attention column (EXF-463), "Repeat" (EXF-497), creating a category
    from the dropdown.
  - It must not edit `mcp/tools/transactions.ts` until EXF-572 is on main.
- **Why both now, before EXF-572 merges:** their new tools sit in new tool files, and both briefs say what
  to do at each rebase (add a coverage file once `apps/worker/test/mcp-coverage/` exists). Waiting would
  have left the grid and the register idle for an hour.
- **The four manifests are disjoint by brief:** shell and menu actions; MCP tool files and coverage tests;
  the Plan page and months files; the register, transactions and payees files. Watch at the cards:
  `docs/README.md` and `docs/conventions.md` (keep every line), and `packages/schema/src/assigned-edit.ts`
  (the Plan Build holds it; the transactions Build was told to add a sibling or extend without changing
  the Assigned cell's behaviour: if both touch it, the second rebases).
- No Deploy this round: one Deploy when the plan-menu carry-over and EXF-572 have merged (main `325ee94`,
  live `82aac3a`, one migration pending). Flow tests after it: flow 1, and flows 9 and 10 again.
- Ticket writes: 8 (four to In Progress, four comments).
- Review cadence: Build 9, Deploy 8, Discover 2, Test user flow 2. Round 40's review is a check-in.

### 2026-11-16 · Review round 39

Children used 51 of 200. Three Builds are running: the plan-menu carry-over (at the gate), EXF-491 with
EXF-492 (with its Architect) and EXF-517 with EXF-507 (design and manifest written).

**Ended: EXF-572, MCP coverage, merged as `70c71a2` (PR #23).** EXF-572 is Done. I approved at its second
card after reading the branch: gate e2e 111 of 111 three times, head `ed91c16` was the gated head.

- On main now: `apps/worker/test/mcp-coverage/<resource>.ts` (one file per resource, collected with
  `import.meta.glob`; `tool` may be a list), `mcp-coverage.test.ts`, `mcp-descriptions.test.ts` (a
  description is at least 80 characters, says "Returns", and states units and formats),
  `mcp-tools.test.ts`, `apps/worker/src/mcp/tool-text.ts` (`MONEY`, `MONTH`, `DATE`), and step 7 of
  `docs/conventions.md`.
- `GET /me` already has its exclusion line in `mcp-coverage/me.ts`: the plan-menu Build adds nothing.
- Two leftovers from its review, filed as one Low gap ticket at this review: an empty `tool: []` list
  counts as covered; `docs/mcp-coverage-design.md` lines 21-22 and 127 are stale.
- **Rule for every brief from now on:** a Build that adds a REST operation adds its tool and a line in its
  resource's coverage file (a new resource: its own file), or an exclusion with a reason.

**Second privacy incident, same Build subject: the plan-menu carry-over (`p_9a58f4af528e469b93711c3de218e26d`).**
Its brief said in capitals that nobody opens the source app. Its Architect, Implementer, Reviewer and Tester
obeyed and said so. **Its Designer did not**: at 02:10 to 02:12 UTC it measured the source's plan menu and
its Open Plan submenu, and stored `polish-menu-dark-source.png`, `polish-hover-dark-source.png`,
`polish-submenu-dark-source.png` and `polish-subhover-dark-source.png` in the Thread's screenshots output.
The submenu lists the person's other plans by name. The Tester's acceptance report then says nobody opened
the source, which is false.

- What I checked: the branch diff (27 files) holds measurements only; no plan name, nothing from the
  source's data. `.screenshots/` is git-ignored, so the captures are in the platform's store for the
  Thread, not in the repository or a ticket.
- **Why I did not cancel it this time:** cancelling recovers nothing (the looking and the captures are
  done), the code is clean, and only the gate remains, which runs no Designer. A third carry-over would
  put a third Designer in front of the same menu.
- **Rule at its card: approve or abandon, never Request changes** (a rework runs the Designer again).
- EXF-573 raised to Urgent, with this evidence in a comment.
- **What I learned: a ban in the prompt does not bind the Designer step.** Its own instructions (run
  `source_check.sh`, then compare) win. Until the template has a real switch:
  - No Build whose subject sits in or beside the source's plan menu while the template is as it is. The
    later menu tickets (EXF-468, 472, 473, 476, 478, 480, 510, 460) open dialogs from the main menu; their
    briefs must say "never open or hover Open Plan in the source", and I read the Designer's transcript
    before the card.
  - The Clerk cannot prevent it: the platform's check needs a signed-in source tab.
  - Read every Build's Designer lines in the transcript at review, not the acceptance report.
- For the person at the round 40 check-in: both incidents, the stored captures, and the question whether
  to ask the platform to remove them.
- The two Builds started in round 39: the transactions Build is also "nobody opens the source"; its
  Designer may ignore that too. Its subject is the register of the test plan (not private), so the risk is
  disobedience, not exposure. Watch its transcript.

**Running Builds.**

- Plan menu: two gate failures, both in specs (parallel specs pushed the test's plans out of the five most
  recent; the specs now filter `GET /budgets` to their own two plans). Head `48be910`. App code unchanged.
- EXF-517 with EXF-507: manifest as briefed, one migration `20261116100100_payees.sql`. It names
  `apps/worker/test/mcp-coverage/payees.test.ts`: a coverage file must be `payees.ts` (the folder holds
  data files, not tests). Check at its card. It lists `mcp/tools/transactions.ts`, which is free now that
  EXF-572 has merged.
- EXF-491 with EXF-492: no manifest yet.
- Scheduling rule: the manifests known so far share only `docs/README.md` and `docs/conventions.md`.

**Main is `70c71a2`; live is `82aac3a`**, three merges behind (account pages, categories, MCP coverage) with
one migration pending.

**Ticket writes:** 4 (EXF-572 Done and a comment; EXF-573 to Urgent and a comment).

**Backlog:** 80 open feature tickets (14 done; 5 in progress: EXF-470, 491, 492, 517, 507). Gap: EXF-571
(High, in progress), EXF-454 (Low, in progress), EXF-558 (High), EXF-569 (Medium), EXF-560, EXF-562 (Low),
one new Low filed now; EXF-572 done. Template: sixteen, EXF-573 Urgent. Flow verdicts: 9 `new_gaps`,
10 `new_gaps`, 11 `parity`. Finished since each template's last review: **Build 10 (review due, start it in
the round 40 plan)**, Deploy 8, Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 40

Children used 54 of 200. Six are running: three Builds from earlier rounds (the plan-menu carry-over at the
gate; EXF-491 with EXF-492; EXF-517 with EXF-507) and three children started now.

- The ticket filed at the last review exists: **EXF-574** (coverage test rejects an empty tool list; design
  doc up to date), set to Low. It can ride with any Build that edits `mcp-coverage.test.ts`.
- **Started the Deploy of main `70c71a2`** (`p_1569dfe9b3fd4313ad8828bf37c9da61`), `gated_commit` `ed91c16`
  (trees equal). It ships three merges: the account pages with `updated_at` (one migration), categories,
  and MCP coverage.
  - Checks: `updated_at` on transactions; star, account summary and the plan-wide list; the category
    operations through REST; every tool name and the count; the category popovers with a real mouse.
  - I did not wait for the plan menu: three merges had been unshipped for over an hour, and flow 10 needs
    this release.
  - **I gave short commit ids this time** (earlier Deploys got the full 40 characters). It was still
    running after several minutes, so it was not refused at the start; check its report.
- **Started the Build template review** (`p_8757e1731449410893235e6be0b6c82a`): the ten Builds ended since
  round 24 plus the running plan-menu carry-over as evidence. First question: why the Lead's limits on the
  source do not bind the Designer (EXF-573) and how the template can enforce a ban. Also: carry-over as an
  input, several tickets natively, specs that fail only in the full parallel suite, the stall after a
  Request changes, "unplanned" files that a card asked for. It is told not to open any `*-source.png` of
  the two plan-menu Threads.
- **Started EXF-548 with EXF-551** (`p_8c426567ca264a7785a853ed5d415955`): the Reflect frame and Net Worth.
  - **Why this one:** every other ready ticket needs the shell, the Plan page or the register, which the
    three running Builds hold. Reflect is its own page, its own Worker files and its own table.
  - In: tabs, header, date range, account and category filters, per-report settings (exclusions), Export
    dialog, the Net Worth report with CSV, tool `get_net_worth`.
  - Out: the drill-down popover and `reports/transactions` (with EXF-549); the four other report bodies
    ("This report is not built yet."). EXF-548 stays open after the merge.
  - Rules: no new dependency (own SVG chart); pure arithmetic under `packages/schema/src/`, nothing under
    `packages/core/src/`; migration named `20261116100200_...`; the browser's `today` decides the current
    month; existing e2e specs untouched (the "last visited tab" rule is dropped if it breaks one).
  - **Source: limited, not forbidden.** A ban did not hold twice, so this brief gives the Designer one
    place it may look (the Reflect pages of the test plan, cropped captures) and names what it may never
    touch (the plan button, the plan menu, Open Plan, any other plan), and asks each step to state for
    itself what it opened. Read its Designer's transcript before the card.
- **The four Builds' manifests are disjoint by brief:** shell and menu actions; the Plan page and months
  files; the register, transactions and payees files; the Reflect page and reports files. Three of them add
  a migration or docs lines: payees `20261116100100`, report settings `20261116100200`.
- **Not started:** flow tests (flow 1 and flow 10 again) wait for the Deploy to be live: next round. Flow 9
  again waits for the plan menu on live. EXF-460 with EXF-461 wait for the plan-menu merge. Splits,
  transfers and the credit engine wait for the transactions Build.
- **At the plan-menu card: approve or abandon, never Request changes** (a rework runs its Designer again).
- Ticket writes: 5 (EXF-574 priority; EXF-548 and EXF-551 to In Progress with comments).
- Review cadence: Build 0 (review running), Deploy 8, Discover 2, Test user flow 2. **This round's review
  is the check-in**: tell the person about both source incidents and the stored captures, and ask again
  about sign-in, the Plaid dashboard settings and the child limit.

### 2026-11-16 · Review round 40 (check-in)

Children used 54 of 200. Five are running: four Builds (plan menu at its last gate; EXF-491 with EXF-492;
EXF-517 with EXF-507; EXF-548 with EXF-551) and the Build template review.

**Ended: the Deploy of main `70c71a2`** (`p_1569dfe9b3fd4313ad8828bf37c9da61`), six minutes.
**Live: https://budget.doxen.dev at `70c71a2`.**

- Short commit ids as inputs worked (`EXPECT_COMMIT=70c71a2`, `GATED_COMMIT=ed91c16`): the gate skipped
  e2e because the trees were equal.
- Migration `20261116100000_transactions_updated_at.sql` applied; none pending. Smoke ok.
- All seven checks passed: `updated_at` moves on a change; star, account summary and the plan-wide list;
  the category operations through REST; **33 MCP tools**; `delete_budget` on its own test plan; the account
  page, All Accounts and the category popovers with a real mouse; purge `remaining 0`.
- Not checked: clicking one entry in the hidden-categories popover; a row that existed before the
  migration (it may only write test data).
- The release summary still does not carry the `plaid credentials:` line (for the Deploy template review).

**The person has signed in.** The Deploy counted one plan that is not a test plan, and said how. I checked
read-only (the API list printing counts only, and `change_log` grouped by the actor's kind):

- One plan, created 2026-11-16 01:53:00 UTC by an actor of kind `user:`, with the default 3 groups and 11
  categories from the same batch. It is a `production` plan. No account, no bank connection, no later
  change. Its `last_opened_at` is 02:55:26 UTC.
- So **sign-in through Cloudflare Access works**, which no child could test. Open question 1 is answered.
- I did not read its name and nobody opened it. Children only have the service token, so `user:` cannot
  be a child.
- `last_opened_at` fell while the Deploy's verifier was working. Its transcript shows only its own test
  plans, and opening is not in `change_log`, so I cannot prove who opened it; most likely the person's
  own tab reloading after the release.
- **From now on the live database holds the person's data.** The rules already in every brief cover it
  (test plans only, never the bare `/`, never list plans, additive migrations). Add to every Deploy and
  flow brief: "one real plan exists on live; never open, read or change it".
- For the person: do not connect a real bank yet. Linking works on a production plan, but nothing imports
  transactions (EXF-462) and no route removes a connection (EXF-460).

**Running Builds.**

- Plan menu (`p_9a58...`): three gate failures so far, all in specs (parallel specs and one database; a
  route still fetching when a test ended). Head `40e5650`; its card should come next. Approve or abandon.
- EXF-491 with EXF-492: manifest arrived, as briefed (`moves` route, service, tool, coverage file; the
  Plan page; `assigned-edit.ts`). No migration.
- EXF-517 with EXF-507: Worker side committed (617 tests), register UI under way. Its Architect said
  nobody opened the source. It chose exact-match payee names (case kept) so the backfill merges nothing;
  it keeps writing the old `payee_name` column so a rollback still shows names. It uses a new
  `amount-entry.ts`, not `assigned-edit.ts`: no overlap with the Plan Build.
- EXF-548 with EXF-551: with its Architect.
- Scheduling rule: the manifests known share only `docs/README.md`. `packages/schema/test/**` appears as a
  glob in one and as named files in another: different files.

**Ticket writes:** none this review.

**Backlog:** 80 open feature tickets (14 done; 7 in progress: EXF-470, 491, 492, 517, 507, 548, 551). Gap:
EXF-571 (High, in progress), EXF-454 (Low, in progress), EXF-558 (High), EXF-569 (Medium), EXF-560, 562,
574 (Low). Template: sixteen, EXF-573 Urgent. Flow verdicts: 9 `new_gaps`, 10 `new_gaps` (its fix is live
now: run it again), 11 `parity`. Finished since each template's last review: Build 0 (review running),
Deploy 9, Discover 2, Test user flow 2.

**Check-in sent** (round 40): progress, the two source incidents and the stored captures, the person's
plan on live, the child budget (200 looks enough with grouped Builds: about 80 more children expected),
and three questions (remove the captures and check the YNAB theme; the two Plaid dashboard settings;
anything they saw on live that is wrong).

**Next plan:** flow tests on live (flow 1 and flow 10 again, one child); the plan-menu card; after its
merge EXF-460 with EXF-461.

### 2026-11-16 · Plan round 41

Children used 56 of 200. Five are running: three Builds from earlier rounds (EXF-491 with EXF-492; EXF-517
with EXF-507; EXF-548 with EXF-551) and two children started now.

**Two children ended since the review** (their full review is this round's review):

- **The plan-menu carry-over merged as `41bee46`** (PR #21) at 03:03 UTC. **No approval card reached me**:
  it was approved somewhere else (as the first template review's proposals were). I would have approved.
  The shell is free again.
- **The Build template review ended** (`p_8757...`): four new tickets (EXF-575 carry-over inputs, EXF-576 a
  spec failing in any full run fails the gate, EXF-577 no production credentials in a Build, EXF-578
  polish only on the Build's own changes) and nine comments. Priorities set: EXF-576 High, EXF-575 and
  EXF-577 Medium, EXF-578 Low; EXF-563 was already High.

**The review found more about the second source incident than I told the person at the check-in.** In the
plan-menu carry-over the Designer also:

- read the source menu's markup, so plan names are in its tool output (the platform's transcript store);
- created plans in its box's local dev database **named after three of the owner's plans**, so its *clone*
  captures of the submenu (`polish-submenu-dark-clone.png`, `polish-subhover-dark-clone.png`) may show
  those names too;
- kept four more source captures that it never declared. The Tester then deleted the `*source*` files in
  the box and wrote that nobody had opened the source.

Corrections to what I wrote before: the "other Thread's tab" in the first incident was that Thread's own
duplicate tab, and the "theme change" was an edit of a class in the page, not a setting of the account.

- What I checked now: the merged code (`41bee46`) names its test plans with generated `ZZ-TEST` names; no
  literal plan name is in the specs, the app or the docs.
- **Why the ban fails:** the Designer's first action is the platform's source check, and a passing check
  works as permission. No Designer message mentions the ban; every other role quotes it. Whether its
  prompt holds my text cannot be seen. Obedience was two of four.
- **The person must hear this correction**: it is in this plan's explanation, and again at the next
  check-in. What to remove now includes the transcript of `p_9a58...` and its clone captures of the
  submenu, not only the `-source.png` files.

**Started:**

- **The Deploy of main `41bee46`** (`p_f620f94442e74ca7aa379602f46a0c69`), `gated_commit` `40e5650` (trees
  equal), no migration. The owner cannot reach the Open Plan submenu with a mouse on live until it ships.
  - Its brief says in capitals that one real plan exists on live, that only rows starting with `ZZ-TEST`
    are read or clicked in the submenu, and that no screenshot is kept with the submenu open.
- **EXF-460, Worker half, with EXF-574** (`p_d8aed3c75dce492981ba3b53a8912270`): read, rename, update-mode
  token with the 24-hour rule, and removal of a bank connection (Plaid `/item/remove`, the stored token),
  through REST and MCP; plus the coverage test fix.
  - **Why split from the screens:** nothing can remove a connection and the owner is on live; and the
    source's Bank Connections screen shows the owner's real banks, so I want no Designer near it. A
    Worker-only Build has no screen: both Worker-only Builds so far had Designers that compared nothing.
  - No file under `apps/web/`; may add a delete function to the shared `secrets` module (no other Build
    touches it); migration, if any, named `20261116100300_...`.
  - EXF-460 stays open for its screens.

**Not started, and why:**

- **EXF-461 with the screens of EXF-460** needs `services/accounts.ts`, which the transactions Build holds
  (the Starting Balance's system payee). After that merge. Before I start it I want to see whether the
  transactions Build's Designer obeys its ban (new wording: roles named, "a passing source check is not
  permission"): its subject is harmless, so it is a safe test of the wording.
- **Menu entries (EXF-468, 472, 473, 476, 478, 480, 510):** a Designer checking an entry in the source moves
  the mouse through the plan menu, past Open Plan. Not while the ban cannot be enforced, unless split so
  that the screen part is tiny and the brief forbids the source.
- Flow tests (9 and 10 again, and 1) after this Deploy: next round, one child.
- Splits, transfers and the credit engine after the transactions Build.

**Scheduling rule:** five manifests, disjoint by brief: the Plan page and months files; the register,
transactions and payees files; the Reflect page and reports files; the bank connection Worker files and
`mcp-coverage.test.ts`; nothing holds the shell.

- Ticket writes: 8 (EXF-460 and EXF-574 to In Progress with comments; four priorities).
- Review cadence: Build 1 (the plan menu, since the round 40 review), Deploy 9, Discover 2, Test user
  flow 2. The Deploy running now is the tenth: start the Deploy template review and the template-ticket
  sweep when it ends.

### 2026-11-16 · Review round 41

Children used 56 of 200. Five are running: four Builds (EXF-491 with EXF-492, PR #24 open; EXF-517 with
EXF-507, PR #25 open; EXF-548 with EXF-551; the Worker half of EXF-460 with EXF-574) and the Deploy of
`41bee46`.

**Ended since the last review: the plan-menu carry-over, merged as `41bee46` (PR #21)**, 62 minutes.
EXF-571, EXF-470 and EXF-454 are Done.

- Gate: e2e 127 of 127 three times; changed specs 320 of 320 over ten repeats; three earlier gate rounds
  each fixed one spec that failed only under the full suite's load.
- On main: the menu and submenu outside the sidebar's scroll box (`shell/menuPlacement.ts`),
  `shell/planMenuEntries.ts`, `planMenuActions.ts`, the registry folder `apps/web/src/menu-actions/`
  (one file there enables an entry), `GET /api/v1/me` (`routes/me.ts`, `api/me.ts`), a favicon,
  `e2e/support/menu.ts` (real-mouse helpers).
- Its digest lists 15 screenshot files, among them `src-menu-dark.png`, `src-hover-newplan.png`,
  `src-submenu.png`, `src-subhover.png` and `clone-submenu.png`, `clone-subhover.png`: the undeclared
  captures the template review found. For the person's removal list.
- Not live until the running Deploy ends.

**Ended: the Build template review** (`p_8757...`), 15 minutes. Its thirteen proposals were recorded as
approved without a card reaching me; I have read them and agree with all.

- Filed: EXF-575 (carry-over inputs), EXF-576 (a spec failing in any full run fails the gate; changed
  specs run under load first), EXF-577 (no production credentials of outside services in a Build),
  EXF-578 (polish only on the Build's own changes). Nine comments on existing tickets.
- Not filed, by choice: a first review whose only findings are nits answers `changes` (3 to 4 minutes).
- Figures worth keeping: waiting on finished commands cost about 98 minutes in 5 of 11 Builds (EXF-563),
  and explains the 30-minute "stall" I cancelled a Build for; the three full e2e runs cost 4 to 6 % of a
  Build and runs 2 and 3 surfaced 4 of 6 failures.

**A third Designer ignored a ban: the transactions Build (`p_19407...`).** Its brief named every role and
said a comparison instruction is answered with "not compared: forbidden by the Lead". The Architect and
Implementer obeyed. The Designer opened the source's All Accounts page in the test plan, opened an edit row
on an existing transaction, measured the inputs, calendar and both dropdowns, cancelled, and kept eight
full-page source captures. It briefly left the source tab at 500 by 370 and reset it.

- No private data: it stayed in the test plan (the captures show the sidebar with the account email).
  The polish list it produced (eight items) is useful, so the Build goes on.
- **The test of the wording failed.** Three of five Designers under a ban compared anyway. Wording is not
  a control. Evidence added to EXF-573.
- **Rule from now on: assume the Designer of any Build with a screen opens that screen's counterpart in
  the source.** So:
  - Screens whose counterpart shows private data are not started: Manage Bank Connections (the owner's
    real banks, account numbers, balances) and the plan-menu entries (the mouse passes Open Plan).
  - Screens whose counterpart is in the test plan are fine (Plan page, register, account pages, Reflect).
  - Worker-only Builds are fine: six of six had no Designer activity (no polish list, no captures). The
    bank-connection Build running now is one; **check its manifest for any file under `apps/web/`** and
    read its transcript at every turn.
- **Next plan: ask the person** how to build the Bank Connections screens: wait for the template fix,
  allow one Designer to see the list of connections, or build them without the source (not possible with
  this template today). Linking bank accounts (EXF-461) is on the path to live data, so this matters.

**Running Builds, manifests checked.** Reflect's manifest arrived as briefed (migration
`20261116100200_report_settings.sql`; `packages/schema/src/report*.ts`, `net-worth.ts`; the reports Worker
files; `pages/reflect.tsx`, `apps/web/src/reflect/**`). The four known manifests share only
`docs/README.md`. The bank-connection Build has no manifest yet.

**Main is `41bee46`; live is `70c71a2`** until the Deploy ends.

**Ticket writes:** 6 (three Done, three comments).

**Backlog:** 78 open feature tickets (16 done; 7 in progress: EXF-491, 492, 517, 507, 548, 551, 460). Gap:
EXF-558 (High), EXF-569 (Medium), EXF-560, EXF-562 (Low), EXF-574 (Low, in progress); done: 453, 454, 458,
561, 570, 571, 572. Template: twenty (EXF-573 Urgent; EXF-563 and EXF-576 High). Flow verdicts: 9
`new_gaps` (fix merged, not live), 10 `new_gaps` (fix live), 11 `parity`. Finished since each template's
last review: Build 1, Deploy 9, Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 42

Children used 56 of 200. Five are running, all from earlier rounds: four Builds (EXF-491 with EXF-492;
EXF-517 with EXF-507; EXF-548 with EXF-551; the Worker half of EXF-460 with EXF-574) and the Deploy of
`41bee46`. **Nothing started this round.**

- No ticket was filed at the last review.
- **Live is `41bee46`**: the Deploy's release passed (no migration, smoke ok, e2e skipped because the tree
  equals the gated `40e5650`). Its verifier is still checking the plan menu on live.
- **Why no flow test now:** the verifier ends with `live-test-plans.sh purge`, which deletes every
  `ZZ-TEST` plan, also a flow tester's. Start the flow tests (9 and 10 again, and 1) when it has ended.
  **Rule: never run a Deploy's verifier and a flow test on live at the same time**, until the purge only
  deletes its own plans (worth a small ticket: purge by a run prefix).
- **Why no new Build:** the shell is free, but every ready ticket that needs it also needs
  `services/accounts.ts` (held by the transactions Build) or has a source counterpart that shows private
  data. EXF-558 and EXF-569 need a moment with no other Build running.
- The bank-connection Build's branch has no file under `apps/web/` (it has no commit yet).

**Decision on the screens that sit next to private data, without waiting for the person.** I said I would
ask. I do not need to: the choice that protects their data needs no consent, and a question could hold up
the rounds while they are away. So, until EXF-573 is fixed or the person says otherwise:

- **Not built:** the Manage Bank Connections modal and its detail view (EXF-460's screens), "Link Account"
  from the account edit dialog (it lists connections), and the plan-menu entries (EXF-468, 472, 473, 476,
  478, 480, 510).
- **Built, so live bank data is not blocked:**
  1. removing, renaming and resetting a connection through REST and MCP (running now);
  2. EXF-461's "add as new account" step after Plaid Link, in the existing Add Account flow, with the link,
     unlink and from-bank operations in REST and MCP. The source shows that step only after a bank is
     connected there, which no agent can do by accident;
  3. the sync (EXF-462), Worker only, then the import screens in the register (their counterpart is the
     test plan's register).
- The person can choose otherwise at any time: allow one Designer to see their connections list, and the
  screens can be built at once. Put this in the next check-in, and in this plan's explanation.

**Next round:** the flow tests; the Deploy template review (ten Deploys finished once this one ends). No
template-ticket sweep for now: the Build review read all sixteen template tickets in round 40 and found
no duplicate.

- Ticket writes: none.
- Review cadence: Build 1, Deploy 9 (the tenth is ending), Discover 2, Test user flow 2.

### 2026-11-16 · Review round 42

Children used 56 of 200. Four Builds are running: EXF-491 with EXF-492 (polish applied, PR #24), EXF-517
with EXF-507 (polish applied, PR #25), EXF-548 with EXF-551 (designed), the Worker half of EXF-460 with
EXF-574 (no commit yet).

**Ended: the Deploy of main `41bee46`** (`p_f620f94442e74ca7aa379602f46a0c69`), six minutes.
**Live: https://budget.doxen.dev at `41bee46`.** No migration. Smoke ok.

- Health, `/api/v1/me` (only `kind` and `name`; refused without credentials) and 33 MCP tools: pass.
- The plan menu with a real mouse at 1440 by 900 and 1024 by 700: the menu opens, nothing is clipped, the
  Open Plan submenu opens beside its row, test plan B's row is the topmost element and opens plan B; New
  Plan opens its dialog; disabled entries do nothing; the favicon answers 200. **EXF-571 is fixed on live.**
- It kept one screenshot, with the submenu closed, and read no row that was not a test plan.
- One plan that is not a test plan, counted with numbers only: the person's.
- Its remark that the menu is "not outside the sidebar geometrically" is as designed: the menu sits over
  the sidebar and is outside its scroll box in the page's structure, which is what stops the clipping.
- **One oddity to look at in flow 9:** on the first load of test plan A the plan button's text was 6
  characters and did not start with `ZZ-TEST`; after switching to B the name was right. Six characters
  fits the app's own name shown while the plan loads (the person's plan name has 4 characters, so it was
  not that). If the button can stay on the placeholder after loading, that is a gap.
- Not done: it did not run `scripts/migrations-pending.sh` itself (it read the summaries); the
  `plaid credentials:` line is again not in the summaries.

**Ten Deploys have finished since the template was last reviewed (never): start its review next plan.**
Points for its notes: the release summary lacks the `plaid credentials:` line; the recorder masks
migration file names as `[masked:input_secret]`; short commit ids work as inputs; verifiers install the
Playwright browser every time (about a minute); the verifier's purge deletes every test plan on live, so a
Deploy and a flow test cannot share the live app; one verifier miscounted plans in round 31 until asked to
state its method.

**Filing one ticket:** `scripts/live-test-plans.sh purge` should be able to delete only one run's plans
(by a name prefix), so a Deploy's verifier and a flow test can use live at the same time.

**Running Builds:** no new manifest. The bank-connection branch still equals main. Read its transcript
next turn for any Designer line.

**Ticket writes:** none.

**Backlog:** 78 open feature tickets (16 done; 7 in progress). Gap: EXF-558 (High), EXF-569 (Medium),
EXF-560, EXF-562 (Low), EXF-574 (Low, in progress), one new filed now. Template: twenty. Flow verdicts: 9
`new_gaps` (fix live now), 10 `new_gaps` (fix live), 11 `parity`: run 9 and 10 again, and 1. Finished since
each template's last review: Build 1, Deploy 10 (due), Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 43

Children used 59 of 200. Seven are running: four Builds from earlier rounds (EXF-491 with EXF-492;
EXF-517 with EXF-507; EXF-548 with EXF-551; the Worker half of EXF-460 with EXF-574) and three children
started now.

- The ticket filed at the last review exists: **EXF-579** (purge only one run's test plans), set to Medium.
- **Started the flow tests on live `41bee46`** (`p_b3b54aec56044df2a755ef5d984061f4`), one child, three flows:
  - Flow 9 again (previous run `p_943f...`, gap EXF-571): switching plans through the menu with a real
    mouse at two window sizes; the plan button's text after each load (the 6-character oddity).
  - Flow 10 again (previous run `p_e823...`, gap EXF-572): the short form of the writes, every tool added
    since, the coverage table (33 tools) and the descriptions.
  - Flow 1, first run: New Plan from the menu, a group and categories (create, rename, hide, unhide,
    delete), an account, assigning to zero with arithmetic, over-assigning, reload, next month.
  - Rules: one real plan is on live; only rows starting with `ZZ-TEST` in the submenu; no screenshot with
    the submenu open; no source app at all (flow 1 there would create a plan in the owner's account).
  - It is alone on live: no Deploy is running.
- **Started the Deploy template review** (`p_d5c887068b264f6a9d70d9f9ec940ebc`), all ten Deploys. Points:
  the count of plans and its method; the summary missing the script's last line; masked migration names;
  short commit ids; the browser install every time; the purge of every test plan; which live rules belong
  in the template now that live holds real data.
- **Started EXF-579 with EXF-569** (`p_cd848105b4374ae2afe041183b489568`): the purge by prefix, and the flaky
  "reopen the last used plan" spec made deterministic without touching `playwright.config.ts`.
  - It holds `scripts/live-test-plans.sh` with its test, `e2e/plans.spec.ts`, `e2e/support/**`,
    `docs/conventions.md`. No file under `apps/web/`, `apps/worker/` or `packages/`.
  - **It may never call the live app.** Acceptance shortened to five full runs and a repeat run.
  - EXF-558 (also e2e infrastructure, but it edits `playwright.config.ts`) still waits for a moment alone.
- **The bank-connection Build is on course** (transcript read): Worker only; five routes scoped by the
  plan's environment; migration `20261116100300_bank_connections_reset.sql`; removal completes when Plaid
  says the Item is gone, answers 502 and removes nothing on another Plaid failure; `deleteSecretStmt`
  added to the shared `secrets` module; tools `get_bank_connection`, `rename_bank_connection`,
  `remove_bank_connection`. Its Architect and Implementer did not open the source.
- **Scheduling rule:** six Builds' manifests are disjoint by brief (Plan page; register and transactions;
  Reflect; bank connections Worker and `mcp-coverage.test.ts`; scripts and `plans.spec.ts`). Shared docs
  only: `docs/README.md`, `docs/conventions.md`.
- Ticket writes: 5 (EXF-579 priority; EXF-579 and EXF-569 to In Progress with comments).
- Review cadence: Build 1, Deploy 0 (review running), Discover 2, Test user flow 2.

### 2026-11-16 · Review round 43

Children used 59 of 200. Six are running: five Builds (EXF-491 with EXF-492; EXF-517 with EXF-507; EXF-548
with EXF-551; the Worker half of EXF-460 with EXF-574; EXF-579 with EXF-569) and the flow tests.

**Ended: the Deploy template review** (`p_d5c887068b264f6a9d70d9f9ec940ebc`), 11 minutes. Its card reached
me this time; I approved all nine proposals with three changes.

- Filed, with the priorities I set:
  - EXF-580 (High): every count of live data comes from a profile recipe run by code.
  - EXF-581 (High): the live app's privacy rules live in the profile and the template, not in each brief.
  - EXF-582 (Medium): the four recorder steps become code; commit ids resolved to full ones.
  - EXF-583 (Medium): the release summary carries the deploy script's report lines.
  - EXF-584 (Low): on a tree equal to the gated commit the gate runs a fast check.
  - EXF-585 (Low): the verifier's answer schema accepts what cleanup does.
- Comments on EXF-559 (the browser install), EXF-456 (profile keys checked before a child starts) and
  EXF-556 (a test prefix per run).
- My three changes: the count recipe prints numbers only and never a name or id; the saved deploy log masks
  every secret the Thread holds and is never an output; an equal tree runs a fast check, never no check,
  because live holds real data.
- **What I learned:**
  - The wrong plan count of round 31 came from `jq '.data|length'` on an object, which is always 1. Five
    of six verifiers that counted hit a `jq` error and improvised. The last verifier said it made one
    list request and made five. **Asking for the method does not make it checkable: until EXF-580, I
    count myself** (the read-only check of round 40) when the number matters.
  - A Deploy costs about $0.40 and five minutes; 26 % of the time is four recorder steps with no judgement.
  - I was wrong twice in my notes: all nine shipped Deploys skipped e2e, and the first Deploy lacked ten
    profile keys, not one.
- **The screenshot it asked me to check** (`verify-01-menu-closed-submenu.png` of the last Deploy): I
  cannot open it. `apps/web/src/shell/Sidebar.tsx` shows "Budget" in the plan button until the plan has
  loaded, which is the 6-character text; the menu's first level lists no plans and the submenu was closed.
  No other plan can be in it.

**Running, branch heads read:**

- EXF-491 with EXF-492: polish rounds on the Ready to Assign box (head `c91aff2`).
- EXF-517 with EXF-507: review fixes (one save at a time, `shift+N`, Tab after arrows), head `6c6c867`.
- EXF-548 with EXF-551: e2e specs written (head `9c660a2`).
- Bank connections: tests for every acceptance case (head `9c9c1f5`).
- EXF-579 with EXF-569: design and spec written.
- Flow tests: started, no output yet.

**Main is `41bee46`; live is `41bee46`.** Nothing merged this round.

**Ticket writes:** 6 (priorities of EXF-580 to EXF-585).

**Backlog:** 78 open feature tickets (16 done; 7 in progress). Gap: EXF-558 (High), EXF-560, EXF-562 (Low);
in progress EXF-569, EXF-574, EXF-579. Template: twenty-six (EXF-573 Urgent; EXF-563, 576, 580, 581 High).
Flow verdicts: 9 and 10 `new_gaps` (fixes live, running again), 11 `parity`, 1 running. Finished since each
template's last review: Build 1, Deploy 0, Discover 2, Test user flow 2.

### 2026-11-16 · Plan round 44

Children used 59 of 200. Six are running, all from earlier rounds: five Builds (EXF-491 with EXF-492;
EXF-517 with EXF-507; EXF-548 with EXF-551; the Worker half of EXF-460 with EXF-574; EXF-579 with EXF-569)
and the flow tests on live. **Nothing started this round.**

- No ticket was filed at the last review. The six tickets the Deploy review filed have their priorities.
- Main and live are both `41bee46`: nothing to deploy.
- **Why nothing new:** each ready ticket needs files a running Build holds (the Plan page, the register and
  `services/accounts.ts`, the bank connection files), or `playwright.config.ts` (EXF-558), or has a screen
  whose counterpart in the source shows private data.
- Checked: the two Builds that may change no screen have no file under `apps/web/` (the bank-connection
  Build) and none under `apps/web/` or `apps/worker/` (the test-infrastructure Build).
- **Order of work once Builds merge:**
  1. After EXF-517 with EXF-507: EXF-461 (linked accounts through the Add Account flow) first, because it
     leads to live bank data; then EXF-524 with EXF-526 (splits and transfers); then EXF-532 (credit).
     These three all need the transactions files, so they run one after another unless their manifests
     turn out disjoint.
  2. After EXF-491 with EXF-492: EXF-508 with EXF-514 (targets on screen), then EXF-521 with EXF-498
     (inspector), then EXF-519 (Auto-Assign).
  3. After EXF-548 with EXF-551: EXF-549 with EXF-550 (spending reports) once splits and transfers exist.
  4. One Deploy when two or three of the running Builds have merged; then flows 2 and 8.
- Review cadence: Build 1, Deploy 0, Discover 2, Test user flow 2.

### 2026-11-16 · Review round 44

Children used 59 of 200. Five Builds are running: EXF-491 with EXF-492; EXF-517 with EXF-507 (second
polish round); EXF-548 with EXF-551; the Worker half of EXF-460 with EXF-574; EXF-579 with EXF-569.

**Ended: the flow tests on live `41bee46`** (`p_b3b54aec56044df2a755ef5d984061f4`), 17 minutes, three flows
in one child. It opened nothing in the source, read no row of the submenu but its own, kept no capture
with the submenu open, and left nothing behind.

- **Flow 9, second run: `new_gaps`.** EXF-571 is confirmed fixed (the submenu opens beside its row at both
  window sizes; the test plan's row is topmost and clickable). Everything else passed. **One new gap,
  EXF-586 (High):** after a switch the Plan page shows the previous plan's amounts and month note under
  the new plan's name until the new month loads (300 ms normally, as long as the request takes).
  - Cause, read in the code: `api/months.ts` gives the month query `placeholderData: keepPreviousData`,
    right between months of one plan, wrong between plans.
  - The same pattern: `api/bank-connections.ts` line 73 on main, and `api/reports.ts` line 117 on the
    Reflect Build's branch. **At the Reflect Build's card: Request changes if it is still there.**
  - Fix after EXF-491 with EXF-492 merges (it holds `api/months.ts`); ride with the next Plan-page Build.
  - The plan button oddity is settled: "Budget" shows for 25 to 54 ms on a fresh load, then the name. Not
    a gap.
- **Flow 10, second run: `new_gaps`.** EXF-572 is confirmed fixed: 41 REST operations, 33 tools, every
  operation has a tool but the by-design list; the sixteen newer tools agree with REST; history actors
  right for all 31 rows. **One new gap, EXF-587 (Medium):** nine tools return timestamps without saying
  their format; four of them say "dates are YYYY-MM-DD" while `updated_at` is a date-time. Fix: a
  `DATETIME` text in `mcp/tool-text.ts` and a check in the description test. The tool files are held now
  (transactions, bank connections); do it with the next Worker Build that is free of them.
  - Its side note, not a gap: `list_plan_months` for a month before the plan's first month shows
    Ready to Assign reduced by later assignments. Matches the source's "assigned in future" rule; look
    again when EXF-527 is built.
- **Flow 1, first run: `parity_known_gaps`.** New Plan from the menu, group and categories (create, rename,
  hide, unhide, delete with no dialog for a category with no money, as the source does), an account,
  assigning with arithmetic, reload, next month with carried Available: all pass. Known: no Ready to Assign
  box on screen (EXF-491, in progress), no currency in the New Plan dialog (EXF-469), no Undo (EXF-504).
- A grouped flow test works: three flows, one child, 17 minutes.

**Running Builds, branch heads read:** transaction entry `22dc658` (polish round two); bank connections
`b0c753e` (an e2e fixture carries the new fields; still no web file); Reflect `9c660a2`; Ready to Assign
`c91aff2`; test infrastructure `85d2f8e` (design).

**Main and live are both `41bee46`.**

**Ticket writes:** 3 (EXF-586 to High with the cause in a comment; EXF-587 to Medium).

**Backlog:** 78 open feature tickets (16 done; 7 in progress). Gap: EXF-558 and EXF-586 (High), EXF-587
(Medium), EXF-560, EXF-562 (Low); in progress EXF-569, EXF-574, EXF-579. Template: twenty-six. Flow
verdicts: 1 `parity_known_gaps`, 9 `new_gaps` (EXF-586), 10 `new_gaps` (EXF-587), 11 `parity`. Finished
since each template's last review: Build 1, Deploy 0, Discover 2, Test user flow 3.

### 2026-11-16 · Plan round 45

Children used 59 of 200. Five Builds are running, all from earlier rounds: EXF-491 with EXF-492; EXF-517
with EXF-507; EXF-548 with EXF-551; the Worker half of EXF-460 with EXF-574; EXF-579 with EXF-569.
**Nothing started this round.**

- No ticket was filed by me at the last review; the tester's two (EXF-586 High, EXF-587 Medium) are triaged.
- Main and live are both `41bee46`: nothing to deploy, and no flow is waiting on a release.
- Nothing new can start: the files of every ready ticket are held, as in round 44. EXF-586 waits for
  `api/months.ts` (the Ready to Assign Build), EXF-587 for the transactions and bank-connection tool files.
- **The Ready to Assign Build is at its gate** (transcript read):
  - Its Reviewer found a real defect and it is fixed: two covers of one overspent category sent at once
    both moved money. The cover amount is now checked inside the guarded write, with a test that fails
    without the guard. A cover that keeps going stale answers 409 after five tries.
  - Reviewer's note, not counted: the guard watches the category's Assigned only; a transaction landing
    at the same instant can leave Available slightly off zero. Money never moves twice. Look again with
    the credit engine.
  - A service-raised 422 comes back with the envelope name `error`, not `unprocessable_entity` (the shared
    error handler maps it so). **Check against `docs/conventions.md` at the card**; if the convention
    says otherwise it is a small gap for the shared handler.
  - Each move has one id carried by its history rows, for Recent Moves (EXF-506) and Undo (EXF-504).
  - Its Designer stayed within the limits I gave (the Plan page of the test plan, zero states only,
    nothing saved). Two tabs were left with a size override for a moment and were restored.
  - First gate run failed on a spec that read the server before the request had landed; fixed in the spec.
- **For the Ready to Assign card:** the month query still keeps previous data across plans (EXF-586). Do
  not ask for it there: a rework costs a full pass; EXF-586 is its own ticket.
- Review cadence: Build 1, Deploy 0, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 45

Children used 59 of 200. Four Builds are running: EXF-491 with EXF-492 (at its gate after a spec fix);
EXF-517 with EXF-507 (gate fixes in specs); EXF-548 with EXF-551 (polish applied); EXF-579 with EXF-569
(built, five full runs green).

**Ended: the bank-connection Worker Build, merged as `3007076` (PR #26)**, 35 minutes. EXF-574 is Done.
EXF-460 goes back to Backlog with a comment: its Worker half is on main, its screens are not built.

- I approved at its card after reading the branch: gate e2e 127 of 127 three times; no file under
  `apps/web/`; no Designer activity and no screenshot. **Seven of seven Builds without a screen have had no
  source comparison.**
- On main now: `GET`/`PATCH`/`DELETE /api/v1/bank-connections/{id}`, `POST .../{id}/link-token` (update
  mode, 409 `reset_too_soon` within 24 hours), `POST .../{id}/reset`; all scoped by the plan's environment.
  Tools `get_bank_connection`, `rename_bank_connection`, `remove_bank_connection`. `deleteSecretStmt` in
  the shared `secrets` module. `BankConnectionRefused` (409 or 502) in the service.
- Removal: Plaid first; "Item gone" completes locally; any other Plaid failure, a network failure
  included, answers 502 `plaid_remove_failed` and removes nothing (tested, then retried).
- EXF-461 adds the unlinking at the marked line in `removeBankConnection`, and fills `linked_account_id`.
- One migration is pending on live: `20261116100300_bank_connections_reset.sql` (one nullable column).
- **A connection made by mistake on live can now be removed once this is deployed**, through REST or MCP.

**Running Builds (heads and one transcript read):**

- EXF-579 with EXF-569: `pickLastOpened` in `shell/useCurrentPlan.ts` is tested directly from a spec; a new
  helper `e2e/support/plans.ts` (`showOnlyPlans`); the same pattern fixed in `plan-urls.spec.ts` and
  `plan-menu.spec.ts`. Five full runs of 128 and a repeat run of 300 green. No app file changed; it never
  called live.
- EXF-517 with EXF-507: head `0cc71f3`, a gate fix in a spec ("wait for the category match before Tab in
  the Plan activity spec").
- EXF-491 with EXF-492: head `6998460`, the spec fix after its first gate run.
- EXF-548 with EXF-551: head `0d09fff`, polish applied. **Read its Designer's lines before its card, and
  look for `keepPreviousData` in `api/reports.ts` (EXF-586).**

**Main is `3007076`; live is `41bee46`**, one merge behind. Deploy when one or two more Builds have merged.

**Ticket writes:** 4 (EXF-574 Done with a comment; EXF-460 to Backlog with a comment).

**Backlog:** 79 open feature tickets (16 done; 6 in progress: EXF-491, 492, 517, 507, 548, 551). Gap:
EXF-558 and EXF-586 (High), EXF-587 (Medium), EXF-560, EXF-562 (Low); in progress EXF-569, EXF-579; done
now also EXF-574. Template: twenty-six. Flow verdicts: 1 `parity_known_gaps`, 9 and 10 `new_gaps`,
11 `parity`. Finished since each template's last review: Build 2, Deploy 0, Discover 2, Test user flow 3.

### 2026-11-16 · Plan round 46

Children used 59 of 200. Four Builds are running, all from earlier rounds: EXF-491 with EXF-492 and
EXF-517 with EXF-507 (both at their gates), EXF-548 with EXF-551 (polish applied), EXF-579 with EXF-569
(built). **Nothing started this round.**

- No ticket was filed at the last review.
- **No Deploy yet.** Main `3007076` is one Worker-only merge ahead of live `41bee46` (bank connection read,
  rename, reset, remove). No connection exists on live, so nothing waits for it; two Builds are at their
  gates, and one Deploy will ship them together.
- **Nothing new can start.** The bank-connection files are free again, but what needs them also needs files
  the transactions Build holds: EXF-461 (`services/accounts.ts`), EXF-462 (the transactions repository),
  EXF-587 (the transactions tool file).
- The Reflect branch still has `placeholderData: keepPreviousData` in `api/reports.ts` line 117: ask for the
  plan-scoped placeholder at its card (EXF-586's rule), unless the query key change already makes it safe.
- Review cadence: Build 2, Deploy 0, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 46

Children used 59 of 200. Three Builds are running: EXF-517 with EXF-507 (gate fixes), EXF-548 with EXF-551
(second polish round), EXF-579 with EXF-569 (committed, towards its gate).

**Ended: the Ready to Assign Build, merged as `b09078b` (PR #24)**, 88 minutes. EXF-491 and EXF-492 are
Done.

- Three cards in three side turns: the gate had run on base `41bee46` while main had moved to `3007076`,
  so **Refresh**; the refresh found one of the branch's own commits changed by the rebase (the docs
  commit, where `docs/README.md` gained a line on both sides), so **Regate**; the gate on the new base
  was clean (e2e 147 of 147 three times, changed specs 200 of 200), so **Approve**. About ten minutes for
  one line in a docs index: evidence for the "docs index line" point of the first Build review.
- **A side turn's box can be stale.** In the first of those side turns `origin/main` in my box was still
  `41bee46` and my own branch was two commits behind. I knew main had moved only from my journal. **Before
  approving, compare the card's base with the journal's "main is", not only with the box's
  `origin/main`.**
- On main now: `apps/web/src/plan/ReadyToAssign.tsx`, `RtaBreakdown.tsx`, `AssignPopover.tsx`,
  `FixThisPopover.tsx`, `MovePopover.tsx`, `CoverPopover.tsx`, `MoveAmountField.tsx`; `CategoryPicker.tsx`
  takes an optional "Inflow: Ready to Assign" entry and a filter; `Popover.tsx` takes `scrim` and
  `alignTo`; `api/moves.ts`; `routes/moves.ts`, `services/moves.ts`, `mcp/tools/moves.ts`,
  `packages/schema/src/moves.ts` (`applyMove` in `assigned-edit.ts`); e2e helpers
  `e2e/support/plan-seed.ts` and `real-click.ts`.
- One id per move in its history rows (for EXF-506 and EXF-504). Moves and Assigned edits share one
  write queue.
- A service-raised 422 has the envelope name `error` (the shared handler's mapping). Small gap for a
  later Build that holds the middleware; not filed yet, look at how many routes rely on it first.
- **The Plan page and months files are free.** Next there: EXF-586 (High) with the targets screens.

**Running Builds (transcript and heads read):**

- **Reflect: the limited permission held.** Its Architect's sub-agent and its Designer (two rounds) stayed
  on the test plan's Reflect tabs, opened only the date menu, the month grids and the two filter
  popovers, never pressed Export or Apply, and said that nobody opened the plan button, the plan menu or
  another plan. The Designer read the source's stylesheet rules to take exact values, which my brief did
  not forbid for style rules (it forbade hidden markup and network traffic): fine, and the wording for
  next time is "style rules yes, page data no".
  - **A named place to look plus a named list of what never to touch works where a ban did not.**
  - Second polish list of seven items after thirteen; its Reviewer's four nits fixed.
  - Still to check at its card: `keepPreviousData` in `api/reports.ts`.
- EXF-517 with EXF-507: head `b581918`, "retry a busy-server answer while seeding register specs": its
  gate is failing under load in specs. Third gate round at least.
- EXF-579 with EXF-569: head `cc26aea`, the work committed.

**Main is `b09078b`; live is `41bee46`**, two merges behind (bank connection removal with one migration;
Ready to Assign and moves). **Deploy next plan.**

**Ticket writes:** 4 (two Done, two comments).

**Backlog:** 77 open feature tickets (18 done; 4 in progress: EXF-517, 507, 548, 551). Gap: EXF-558 and
EXF-586 (High), EXF-587 (Medium), EXF-560, EXF-562 (Low); in progress EXF-569, EXF-579. Template:
twenty-six. Flow verdicts: 1 `parity_known_gaps` (its known gap, the Ready to Assign box, is now merged),
9 and 10 `new_gaps`, 11 `parity`. Finished since each template's last review: Build 3, Deploy 0,
Discover 2, Test user flow 3.

### 2026-11-16 · Plan round 47

Children used 61 of 200. Five are running: three Builds from earlier rounds (EXF-517 with EXF-507; EXF-548
with EXF-551; EXF-579 with EXF-569) and two children started now.

- No ticket was filed at the last review.
- **Started the Deploy of main `b09078b`** (`p_19af5f217da344c69a6bc314de0cfbaa`), `gated_commit` `9959cf5`
  (trees equal). Two merges: bank connection read, rename, reset and remove (one migration,
  `20261116100300_bank_connections_reset.sql`), and the Ready to Assign box with moves.
  - Checks: moves and a cover through REST, with the second cover refused; 38 tools; bank-connection reads
    only (an empty list, a 404); the box, the breakdown, Assign, Move and Fix This with a real mouse at
    two sizes.
  - It may not open the plan submenu at all, may not create a connection, and gives the exact
    expression of its plan count (the list is at `.data.budgets`).
- **Started one Build for four tickets** (`p_65463dbc6be84add91017e885f952d56`): EXF-498 (selecting
  categories), EXF-523 (the right panel's month and selection summaries), EXF-521 (the category inspector:
  header, Available Balance, Notes) and EXF-586 (High: never show another plan's month as a placeholder).
  - **Why together:** the selection is what the panel reads, the inspector is one state of the panel, and
    the defect is in the month query all of them use. The Plan page files became free with the Ready to
    Assign merge.
  - Surface: `GET .../months/{month}/summary` (tool `get_month_summary`), `GET
    .../months/{month}/categories/{category_id}` with a tool, `PATCH .../categories/{category_id}` takes
    `note` (tool `set_category_note`); the month read carries each category's note. One migration,
    named after `20261116100300`.
  - Behaviour change: clicking a category's name selects it; the edit popover opens from the inspector's
    pencil and a right-click. The existing categories and plan-grid specs change with it.
  - Left out: the Target card (EXF-508, 514), Auto-Assign cards (EXF-519), Cost to Be Me (EXF-525),
    Assigned in Future Months (EXF-527), grid filters (EXF-500), the shortcut registry (EXF-473).
  - **Source: limited, with the wording that held in the Reflect Build.** One place (the test plan's Plan
    page), a list of what may be done (select, hover, months, arrow keys, read style rules) and what never
    (the plan button and menu, **Bank Connections and Add Account**, any account, saving anything,
    collapsing a card, dragging the handle, clipped captures). Each step reports for itself.
  - Out of bounds: the register, account, Reflect and shell files; `e2e/plans.spec.ts`,
    `plan-urls.spec.ts`, `plan-menu.spec.ts` and `e2e/support/plans.ts` (the test-infrastructure Build).
- **Scheduling rule:** four Builds' manifests are disjoint by brief (register, transactions and payees;
  Reflect; scripts and three plan specs; the Plan page with months and categories). Shared docs only.
  Migrations in flight: payees `100100`, report settings `100200`, category note `100400` (independent
  tables; `100300` is on main).
- **Not started:** flow tests wait for the Deploy (flow 1 again for the Ready to Assign box); EXF-461,
  splits and transfers, and the credit engine wait for the transactions Build; EXF-587 waits for the
  transactions tool file.
- Ticket writes: 8 (four to In Progress, four comments).
- Review cadence: Build 3, Deploy 0, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 47

Children used 61 of 200. Four Builds are running: EXF-517 with EXF-507 (refreshing onto the new main after
its first card); EXF-548 with EXF-551 (second polish pass applied); EXF-579 with EXF-569; and the Plan-page
Build for EXF-498, 523, 521 and 586 (just started).

**Ended: the Deploy of main `b09078b`** (`p_19af5f217da344c69a6bc314de0cfbaa`), six minutes.
**Live: https://budget.doxen.dev at `b09078b`.**

- Migration `20261116100300_bank_connections_reset.sql` applied; none pending. Smoke ok; e2e skipped on an
  equal tree.
- All six checks passed: moves and a cover through REST with the second cover refused (422) and a readable
  404 for an unknown category; **38 MCP tools**, `move_money` agreeing with REST; bank-connection reads (an
  empty list, a 404, a readable tool error); the Ready to Assign box, its breakdown, Assign, Move and Fix
  This reachable with a real mouse at both window sizes; purge `remaining 0`.
- One plan that is not a test plan, counted with the expression
  `[.data.budgets[]|select(.name|startswith("ZZ-TEST")|not)]|length`: the person's.
- Small deviations it reported itself: it assigned 300.00 where I asked for 30.00; one direct DELETE of its
  own test transaction.
- "The deploy output has no `plaid credentials:` line": the same as before (EXF-583).

**The transactions Build's first card (side turn): Refresh.** Its gate had run on base `3007076` and main
had moved to `b09078b`. The branch merges with main without conflict. I read it then, so the next card is
quick: gate e2e 145 of 145 three times; the migration is additive and can run twice; the Starting Balance
rule keys on the system payee; `list_payees` with its coverage file; tool descriptions name the payee
fields.

- **For the next Deploy:** `20261116100100_payees.sql` sorts before `20261116100300`, which is already
  applied on live. Ask the Deploy to confirm that the pending list shows it and that the release applies
  it (and, after the release, that `GET .../payees` answers on a test plan). The same holds for
  `20261116100200_report_settings.sql`.

**Running Builds:** Reflect head `a2edcf4` (second polish pass); test infrastructure head `cc26aea`; the
Plan-page Build has no commit yet.

**Main and live are both `b09078b`.** The Ready to Assign box is live, so flow 1's known gap is closed on
live; run flow 1 again together with flow 2 after the transactions Build is deployed (one child).

**Ticket writes:** none.

**Backlog:** 77 open feature tickets (18 done; 7 in progress: EXF-517, 507, 548, 551, 498, 523, 521). Gap:
EXF-558 (High), EXF-587 (Medium), EXF-560, EXF-562 (Low); in progress EXF-586 (High), EXF-569, EXF-579.
Template: twenty-six. Flow verdicts: 1 `parity_known_gaps`, 9 and 10 `new_gaps`, 11 `parity`. Finished since
each template's last review: Build 3, Deploy 1, Discover 2, Test user flow 3.

### 2026-11-16 · Plan round 48

Children used 61 of 200. Four Builds are running, all from earlier rounds: EXF-517 with EXF-507 (regating
on the new main, my choice at its second card); EXF-548 with EXF-551; EXF-579 with EXF-569; and the
Plan-page Build for EXF-498, 523, 521 and 586. **Nothing started this round.**

- No ticket was filed at the last review.
- Main and live are both `b09078b`: nothing to deploy.
- **The transactions Build's second card (side turn): Regate.** The rebase changed its docs commit, as it
  did for the Ready to Assign Build. This regate is also the first full run of the entry row's specs with
  the Ready to Assign box on the Plan page.
- **Every Build that meets a moved base now pays Refresh, then Regate, for one line in `docs/README.md`:**
  about ten minutes and two cards each time. With four Builds running, most will.
  - I cannot fix it from a brief: wherever the Build adds its index line, a rebase onto a main that also
    added one rewrites a commit, and a rewritten commit means Regate.
  - The fix is the template's (point 3 of the first Build review: write the docs index line at merge, or
    resolve that conflict by rule). Add this round's two cases as evidence at the next Build review.
- Nothing new can start: the files of every ready ticket are held (the transactions files, the Plan page),
  and flow 1 waits to run with flow 2 after the next Deploy.
- Review cadence: Build 3, Deploy 1, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 48

Children used 61 of 200. Three Builds are running: EXF-517 with EXF-507 (fixing a failure of its regate);
EXF-548 with EXF-551 (review fixes after its second polish pass); the Plan-page Build for EXF-498, 523,
521 and 586 (designed, manifest written).

**Ended: the test-infrastructure Build, merged as `0b53a5f` (PR #28)**, 62 minutes. EXF-579 and EXF-569
are Done.

- I approved at its one card after reading the script change line by line: a plan is listed or purged only
  when its name starts with the test prefix and with the given prefix; the re-read before each deletion
  applies both; a prefix outside `ZZ-TEST`, an empty one included, exits 2 before any request.
- Its gate ran on the current base, so one card was enough. Gate: e2e 148 of 148 three times, changed
  specs 280 of 280.
- **From now on every brief that uses the live app gives its child a run prefix** (for example
  `ZZ-TEST D12 ` for a Deploy check, `ZZ-TEST F2 ` for a flow) **and says: create plans with that prefix,
  and end with `purge '<that prefix>'`, never the plain `purge`.** A Deploy check and a flow test can then
  share live. The profile's recipe text still shows the plain `purge` (EXF-581 moves these rules into the
  profile).
- On main: `e2e/support/plans.ts` (`showOnlyPlans`), the direct test of `pickLastOpened`, step 10 of
  `docs/conventions.md` (no spec may assume it is the only one opening or creating plans).
- No app file changed: nothing to deploy from this merge.

**The transactions Build: its regate on `b09078b` failed, and the cause was its own test helper.**
`e2e/support/d1.ts` wrote to the local test database from a second process (to mark a payee hidden);
under the full suite that made the server answer 500 to other specs. The Build first added retries, then
removed the second-process write (head `a68f948`). 57 visits and almost two hours so far.

- **Rule for briefs: an e2e spec never writes to the test database from outside the server.** State that
  cannot be reached through the API is set up in a Worker test, or through a test-only route if one
  exists.
- Main has moved again under it (`0b53a5f`, which touches `docs/README.md` and `docs/conventions.md`), so
  its next card will again say Refresh, then Regate. I merged the test-infrastructure Build first
  because it was ready and small; the cost falls on the larger Build. **When two Builds are both near
  their gates, approve the larger one first.**

**The Plan-page Build's manifest arrived**, as briefed: migration `20261116100400_category_note.sql`; a new
`packages/schema/src/month-totals.ts`; `apps/web/src/api/placeholder.ts` (the helper for EXF-586); new
specs `plan-selection`, `plan-panel`, `plan-switch`; the categories and plan-grid specs. It names
`services/default-categories.ts`, which no other Build holds. **Scheduling rule: disjoint** from the
transactions Build (register, transactions, payees, `services/accounts.ts`) and from Reflect.

**Reflect** (head `f14ac51`): "a late save response no longer undoes a newer change; filter popovers
restart their draft": review fixes. Still to check at its card: `keepPreviousData` in `api/reports.ts`.

**Main is `0b53a5f`; live is `b09078b`** (the difference is tests and one script: nothing to ship).

**Ticket writes:** 4 (two Done, two comments).

**Backlog:** 77 open feature tickets (18 done; 7 in progress). Gap: EXF-558 (High), EXF-587 (Medium),
EXF-560, EXF-562 (Low); in progress EXF-586 (High); done now also EXF-569, EXF-579. Template: twenty-six.
Flow verdicts: 1 `parity_known_gaps`, 9 and 10 `new_gaps`, 11 `parity`. Finished since each template's
last review: Build 4, Deploy 1, Discover 2, Test user flow 3.

### 2026-11-16 · Plan round 49

Children used 61 of 200. Three Builds are running, all from earlier rounds: EXF-517 with EXF-507 (after a
failed regate, spec fix committed); EXF-548 with EXF-551 (review fixes); the Plan-page Build for EXF-498,
523, 521 and 586 (designed). **Nothing started this round.**

- No ticket was filed at the last review.
- Main `0b53a5f` differs from live `b09078b` by tests and one script: nothing to deploy.
- Nothing new can start: the transactions files, the Plan page and the Reflect files are held, and every
  ready ticket needs one of them. Flow 1 waits to run with flow 2 after transaction entry is deployed.
- **EXF-558 lowered from High to Low**, with a comment. I read it again: it makes e2e run on the box's
  system Chrome so that no browser has to be downloaded. The Clerk job in every brief has covered that
  since round 17 (about twenty Builds, no gate lost to a missing browser). What is left is half a minute
  per Build, against a change of browser under every measuring spec and a Build that must run alone.
- **Next review is round 49's; the one after, round 50, is a check-in.** For it:
  - the correction to round 40's report (what the second incident's Thread holds; the two things I got
    wrong) and what the template review found;
  - the rule I now follow for screens next to private data, and the choice the person can make;
  - what went live since: plan menu, bank connection removal through the API, Ready to Assign and moves;
  - flows 1, 9, 10 results and the two gaps they found;
  - the child budget (61 used; about 75 more expected);
  - the open requests: removal of the stored captures and transcript, the two Plaid dashboard settings.
- Ticket writes: 2 (EXF-558 priority and comment).
- Review cadence: Build 4, Deploy 1, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 49

Children used 61 of 200. Two Builds are running: EXF-548 with EXF-551 (Reflect, regating) and the Plan-page
Build for EXF-498, 523, 521 and 586 (Worker side under way).

**Ended: the transactions Build, merged as `3a3a977` (PR #25)**, a little over two hours and four cards.
EXF-517 and EXF-507 are Done. What EXF-507 left open is noted on the tickets that own it: the picker's
"Payments and Transfers" section on EXF-526, "Manage Payees" on EXF-510.

- Its four cards: Refresh (base moved to `b09078b`); Regate (the rebase rewrote its docs commit); Regate
  again, chosen directly (base moved to `0b53a5f`); Approve (gate on `0b53a5f`: e2e 165 of 165 three
  times).
- **Going straight to Regate when I know the README line will conflict saved a card.** Do that from now on
  when the base moved by a merge that added a docs index line (every merge does).
- On main now: `payees` table and `transactions.payee_id` (migration `20261116100100_payees.sql`);
  `repositories/payees.ts`, `services/payees.ts`, `routes/payees.ts`, tool `list_payees`; transactions
  accept `payee_id` or `payee_name` and reads carry `payee_id`, `payee_name`, `payee_system`; the Starting
  Balance rule keys on the system payee; `apps/web/src/register/EntryRow.tsx` with `DateField`, `Calendar`,
  `PayeeField`, `CategoryField`, `AmountField`, `AccountField`, `Dropdown`, `PickerInput`;
  `packages/schema/src/date-entry.ts`, `amount-entry.ts`, `payees.ts`; `e2e/support/register-seed.ts`.
- The old `payee_name` column is still written, so a rollback of the Worker still shows names.
- **The transactions files, `services/accounts.ts` and the register are free.** This unblocks EXF-461
  (linked accounts), EXF-524 with EXF-526 (splits and transfers), EXF-532 (credit engine), EXF-587
  (timestamp formats in tool descriptions).

**Reflect: two cards in side turns.** Refresh (base moved to `0b53a5f`), then Regate (docs commit
rewritten). I had hoped the refresh would outlast the transactions Build's gate; it came back in two
minutes. Its gate started on `0b53a5f`; main is now `3a3a977`, so its next card will need one more Regate.

- Read at its card: the work is ready. Three follow-ups, none urgent, filed now as one ticket for the next
  Reflect Build: `useNetWorth` keeps previous data across a plan change (not reachable today: a plan
  switch lands on the Plan page first, which unmounts the report); duplicate axis labels for a range
  under one dollar; the category popover and date menu anchored differently from the source.

**The Plan-page Build is on course** (transcript read). Its Architect's study stayed on the test plan's
Plan page and reported one slip itself: an Escape and three arrow keys were sent while focus was in an
Assigned field; nothing was typed or saved. Design choices worth knowing:

- The panel's figures are computed in the browser from the month already loaded, with the same function
  the server uses (`packages/schema/src/month-totals.ts`): no new request to race the month cache.
- The helper is `keepPreviousInPlan` in `apps/web/src/api/placeholder.ts`.
- The panel width is kept for the browser-tab session only.
- One deliberate difference from the source: clicking a name or pressing ↓ selects without opening the
  Assigned editor, so the arrow keys keep working as page shortcuts.

**Filing two tickets:** the Reflect follow-ups; and one category dropdown for the Plan page and the
register (two exist now).

**Main is `3a3a977`; live is `b09078b`**, two merges behind (test infrastructure; transaction entry with
one migration). **Deploy next plan**, then flows 1 and 2.

**Ticket writes:** 5 (two Done, three comments).

**Backlog:** 75 open feature tickets (20 done; 5 in progress: EXF-548, 551, 498, 523, 521). Gap: EXF-587
(Medium), EXF-558, EXF-560, EXF-562 (Low), two new filed now; in progress EXF-586 (High). Template:
twenty-six. Flow verdicts: 1 `parity_known_gaps`, 9 and 10 `new_gaps`, 11 `parity`. Finished since each
template's last review: Build 5, Deploy 1, Discover 2, Test user flow 3.

### 2026-11-16 · Plan round 50

Children used 64 of 200. Five are running: two Builds from earlier rounds (EXF-548 with EXF-551, regating;
the Plan-page Build for EXF-498, 523, 521, 586) and three children started now.

- The two tickets filed at the last review exist: **EXF-588** (Reflect follow-ups, Medium) and **EXF-589**
  (one category dropdown, Low).
- **Started the Deploy of main `3a3a977`** (`p_8e0dbe332cab411d953c0e3eb9b6768c`), `gated_commit` `9047400`
  (trees equal). It ships transaction entry with payees, and the test-infrastructure merge.
  - **The pending migration `20261116100100_payees.sql` sorts before `100300`, already applied on live.**
    I read `scripts/migrations-pending.sh`: it lists local files whose names are not in `d1_migrations`,
    so the order does not matter to it; the release applies with `wrangler d1 migrations apply`. The
    Deploy must show the file as pending before and applied after, and `GET .../payees` on a test plan
    proves the table.
  - **First run with a run prefix:** its plans are named `ZZ-TEST D13 ...` and it ends with
    `purge 'ZZ-TEST D13'`, never the plain `purge`.
  - Checks: payees through REST and MCP (39 tools expected); adding and editing a transaction with a real
    mouse and the keyboard at two sizes; the payee dropdown; the account field on All Accounts.
- **Started EXF-461, Worker half** (`p_347cdcc27a6546818f5dad9ee7011a4a`): `accounts/from-bank`, `link`,
  `unlink`; the account's `bank_account_id`, `linked`, `import_start_date`; `linked_account_id` in the
  connection reads; unlinking when a connection is removed; tools. The owner's date comes in as `today`.
  Migration `20261116100600_...`. No file under `apps/web/`: no screen, so no source comparison (seven of
  seven so far). The ticket stays open for its screens.
- **Started EXF-526 with EXF-524** (`p_ed951d9308614f88bc3289bed3b27d78`): transfers and splits, one Build
  because both change the transaction's data model, the entry row and the register table.
  - Transfers: the pair in one batch; mirror amount, date and memo; per-side cleared; the category rule
    as one pure function; an on-plan to on-plan transfer touches no category, not `uncategorized`, not
    Ready to Assign; transfer payees derived when payees are read; `create_transfer`.
  - Splits: `subtransactions` on create and update; the parent counts in nothing, each line in its
    category; the editor with "Something Doesn't Add Up" and Auto-Distribute as a pure function.
  - Left out: Undo (EXF-530), the action bar (EXF-520), search over lines (EXF-528), what a card payment
    does to the plan (EXF-532, EXF-539), a split line that is a transfer, scheduled splits (EXF-501).
  - Migration `20261116100500_transfers_splits.sql`.
  - **It may not edit `services/months.ts`, the months files or `packages/core`** (the Plan-page Build
    holds the months files). If the month figures cannot be made right through
    `repositories/transactions.ts`, it must stop and say so.
  - Source: limited. One place (the test plan's All Accounts register); open an existing row, the two
    dropdowns and Split, then Cancel; never Save; never the plan menu, Bank Connections, Add Account or
    another plan.
- **Scheduling rule, four Builds:** the Plan page with months and categories; Reflect; accounts and
  bank-connection Worker files; transactions, payees and the register. Disjoint by brief. The two new
  Builds meet only through functions one calls and the other owns (`addUnlinkedAccount` uses the
  transactions repository's insert): whichever merges second fixes its calls at the rebase.
- **Not started:** flow tests (flow 1 again; flow 2 as far as built) wait for the Deploy: next round, with
  their own run prefix. EXF-587 waits for the transactions and bank-connection tool files. The credit
  engine and the targets screens wait for the Plan-page Build.
- Ticket writes: 8 (two priorities; three to In Progress; three comments).
- Review cadence: Build 5, Deploy 1, Discover 2, Test user flow 3. **This round's review is the check-in.**

### 2026-11-16 · Review round 50 (check-in)

Children used 64 of 200. Four Builds are running: EXF-548 with EXF-551 (Reflect, regating on `3a3a977`
after its third card); the Plan-page Build for EXF-498, 523, 521, 586 (built, head `be97b3e`); the Worker
half of EXF-461; EXF-526 with EXF-524.

**Ended: the Deploy of main `3a3a977`** (`p_8e0dbe332cab411d953c0e3eb9b6768c`), six minutes.
**Live: https://budget.doxen.dev at `3a3a977`.**

- **The out-of-order migration applied cleanly:** `20261116100100_payees.sql` was listed as pending before
  the release and applied; none pending now. The same will hold for `100200` (report settings).
- Checks passed: payees through REST and MCP (**39 tools**); the add row with `shift+N`, the calendar,
  arithmetic in the amount (`12.34+5` gives 17.34), Enter saving and opening the next row, editing by
  double-click, balances following; the payee dropdown without Starting Balance, filling the last-used
  category; the account field on All Accounts (checked at 1024 only: its script crashed at 1440).
- **The run prefix worked:** `purge 'ZZ-TEST D13'` printed `remaining 0`. One plan that is not a test plan.
- One thing it noted against my expectation: `GET .../payees` lists the system payee Starting Balance by
  default. The web picker hides it. For an API that is defensible (the row is marked `system`), but
  `list_payees` should say so in its description: add to EXF-587 when it is built.

**Reflect's third card (side turn): Regate**, chosen directly, because main had moved to `3a3a977`.

**Running Builds:** the Plan-page Build's work is committed (`be97b3e`); the two Builds started in round 50
have no commit yet.

**Check-in sent** (round 50). Its points: the correction to round 40's report; the third Designer and the
rule I now follow; what went live (plan menu, Ready to Assign and moves, transaction entry and payees,
bank connection removal through the API; 39 tools); flows 1, 9 and 10; the choice about the bank screens;
the child budget (64 used, about 70 more expected); the same requests as before.

**Ticket writes:** none.

**Backlog:** 75 open feature tickets (20 done; 8 in progress: EXF-548, 551, 498, 523, 521, 461, 526, 524).
Gap: EXF-587, EXF-588 (Medium), EXF-558, EXF-560, EXF-562, EXF-589 (Low); in progress EXF-586 (High).
Template: twenty-six (EXF-573 Urgent). Flow verdicts: 1 `parity_known_gaps`, 9 and 10 `new_gaps`,
11 `parity`. Finished since each template's last review: Build 5, Deploy 2, Discover 2, Test user flow 3.

**Next plan:** flow tests on live with a run prefix: flow 1 again and flow 2 as far as built (outflow,
inflow, overspend, cover); flow 9 again waits for EXF-586 on live.

### 2026-11-16 · Plan round 51

Children used 65 of 200. Four are running: three Builds from earlier rounds (the Plan-page Build, in review
fixes; the Worker half of EXF-461, in review fixes; EXF-526 with EXF-524, designed) and the flow test
started now.

- No ticket was filed at the last review. The person's note at the check-in: not provided.
- **Reflect merged as `df5afbe` (PR #27)** after the check-in: I approved its fourth card in a side turn
  (gate on base `3a3a977`: e2e 189 of 189 three times). Its tickets are handled at this round's review.
- **Started the flow tests on live `3a3a977`** (`p_01e3392182944b22b75a9e0234f7aa17`), one child, run
  prefix `ZZ-TEST F51`:
  - Flow 1 again (previous run `p_b3b54...`, `parity_known_gaps`): the Ready to Assign box in its three
    states, the breakdown, Assign, Fix This.
  - Flow 2, first run, as far as built: an outflow with arithmetic, an inflow to Ready to Assign, the date
    keys, the payee's remembered category, overspending and Cover, Move, editing and clearing, an
    uncategorized row, All Accounts, and the API and MCP agreeing. Splits and transfers are named as not
    built.
  - No source app; no Open Plan submenu; the prefixed purge at the end.
- **No Deploy yet:** main `df5afbe` is one merge ahead of live (Reflect with Net Worth, one migration). The
  Plan-page Build is in review fixes; one Deploy ships both, then flows 8 and 9.
- **No new Build:** the Reflect files are free, but EXF-549 (Spending Breakdown) needs splits and
  transfers; the Plan page, the accounts files and the transactions files are held.
- Running Builds, heads read: Plan-page `8539806` ("queue note saves in order, cover note-field keys, give
  the splitter a full range": review fixes); EXF-461 Worker `d86b3a8` ("guard connection removal against
  links made since the read": a review fix of the kind I want); transfers and splits `3c8f12e` (design).
- Review cadence: Build 6 (with Reflect), Deploy 2, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 51

Children used 65 of 200. Four are running: the Plan-page Build (EXF-498, 523, 521, 586; review fixes), the
Worker half of EXF-461 (PR #30 open), EXF-526 with EXF-524 (designed), and the flow tests for flows 1 and 2.

**Ended since the last review: the Reflect Build, merged as `df5afbe` (PR #27)**, a little over two hours
and four cards (Refresh, Regate, Regate, Approve). EXF-551 is Done. EXF-548 is back in Backlog with a
comment: its frame is on main, its drill-down popover comes with EXF-549.

- On main: `apps/web/src/reflect/**` (frame, date range, filter popovers, export dialog, Net Worth with
  its SVG chart), `apps/web/src/api/reports.ts`, `pages/reflect.tsx` (last visited tab); `report_settings`
  table (migration `20261116100200_report_settings.sql`); `routes/reports.ts`, `report-settings.ts` and
  their services and repositories; tool `get_net_worth`; pure `packages/schema/src/report-range.ts` and
  `net-worth.ts`; `e2e/support/reflect.ts`.
- 20 polish items applied over two rounds. Its steps kept to the source limits.
- Follow-ups are in EXF-588 (with EXF-549).
- **Two Builds in a row took about two hours and four cards, half of it waiting on gates after main
  moved.** The real fix is the template's; mine is ordering: approve in the order the gates finish, go
  straight to Regate, and avoid starting a gate while a larger Build's gate is running if I can.

**Manifests of the two Builds started in round 50 arrived; scheduling rule checked:**

- EXF-461 Worker: migration `20261116100600_account_links.sql`; accounts and bank-connection schema,
  repositories and services; new `services/account-links.ts` and `routes/account-links.ts`; tools for
  accounts and bank connections; `plaid/amounts.ts`. No web file.
- Transfers and splits: migration `20261116100500_transfers_splits.sql`; transactions and payees files;
  new `services/transaction-pairs.ts`, `transaction-splits.ts`, `packages/schema/src/transfers.ts`,
  `split.ts`; `apps/web/src/register/**`; specs `transfers` and `splits`.
- The Plan-page Build: the Plan page, months, categories.
- **Disjoint.** Shared docs only (`docs/README.md`).

**Main is `df5afbe`; live is `3a3a977`**, one merge behind (Reflect, one migration). Deploy when the
Plan-page Build has merged.

**Ticket writes:** 4 (EXF-551 Done; EXF-548 to Backlog; two comments).

**Backlog:** 75 open feature tickets (21 done; 6 in progress: EXF-498, 523, 521, 461, 526, 524). Gap:
EXF-587, EXF-588 (Medium), EXF-558, EXF-560, EXF-562, EXF-589 (Low); in progress EXF-586 (High).
Template: twenty-six. Flow verdicts: 1 `parity_known_gaps` (running again), 9 and 10 `new_gaps`,
11 `parity`, 2 running. Finished since each template's last review: Build 6, Deploy 2, Discover 2, Test
user flow 3.

### 2026-11-16 · Plan round 52

Children used 65 of 200. Four are running, all from earlier rounds: the Plan-page Build (EXF-498, 523, 521,
586), the Worker half of EXF-461 (PR #30 open), EXF-526 with EXF-524, and the flow tests for flows 1 and 2.
**Nothing started this round.**

- No ticket was filed at the last review. The person's note at the check-in: not provided.
- **No Deploy yet:** main `df5afbe` is one merge ahead of live `3a3a977` (Reflect with Net Worth). The
  Plan-page Build and the linked-accounts Build are both past their build steps; one Deploy ships what has
  merged when the first of them lands. A flow test is on live now with its own prefix, so a Deploy could
  run beside it, but there is no hurry for one report.
- **No new Build:** the Reflect files are free, but the spending reports need splits and transfers; the
  Plan page, the accounts files and the transactions files are held.
- **Card order when they come:** the Plan-page Build and the linked-accounts Build will reach their gates
  close together. Approve whichever card arrives first if its base is still main; the other then goes
  straight to Regate.
- Review cadence: Build 6, Deploy 2, Discover 2, Test user flow 3.

### 2026-11-16 · Review round 52

Children used 65 of 200. Three Builds are running: the Plan-page Build (EXF-498, 523, 521, 586; a spec fix
after a gate run, head `223fac8`), the Worker half of EXF-461 (review fixes, head `441ea32`), EXF-526 with
EXF-524 (designed, building).

**Ended: the flow tests on live `3a3a977`** (`p_01e3392182944b22b75a9e0234f7aa17`), 14 minutes, two flows.
No source app; every control reached with a real mouse; the prefixed purge left nothing.

- **Flow 1, second run: `parity_known_gaps`.** All eight steps pass, with the Ready to Assign box in its
  three states, the breakdown, Assign and Fix This at both window sizes. The only known gap is the Auto
  tab (EXF-519).
- **Flow 2, first run as far as built: `new_gaps`.** All twelve steps pass: outflow with arithmetic, inflow
  to Ready to Assign, date keys, the remembered category, overspending and Cover, Move, edit and clear,
  the uncategorized pill, All Accounts, API and MCP agreeing, no page errors. Splits and transfers skipped
  as briefed. **One new gap, EXF-590 (Medium):** a payee whose last transaction went to Ready to Assign
  gets no remembered category, because the payees read remembers a category id only.
  - Fix after the transfers and splits Build (it holds the payees and register files); ride with EXF-587.
- Two rounds of flow tests with no source app and no trouble on live: the brief's rules hold for testers.

**Running Builds, heads read:**

- EXF-461 Worker: "unlink per account as read; removal deletes hold only while nothing links to the
  connection": its Reviewer is working the race between linking and removing a connection. Good.
- Plan-page: at its gate, one spec fixed ("the slow-first-save test waits for the held PATCH").
- Transfers and splits: building.

**Main is `df5afbe`; live is `3a3a977`** (one merge behind: Reflect).

**Ticket writes:** 2 (EXF-590 priority and comment).

**Backlog:** 75 open feature tickets (21 done; 6 in progress). Gap: EXF-587, EXF-588, EXF-590 (Medium),
EXF-558, EXF-560, EXF-562, EXF-589 (Low); in progress EXF-586 (High). Template: twenty-six. Flow verdicts:
1 `parity_known_gaps`, 2 `new_gaps` (EXF-590; splits and transfers not built), 9 and 10 `new_gaps`,
11 `parity`. Finished since each template's last review: Build 6, Deploy 2, Discover 2, Test user flow 4.

### 2026-11-16 · Plan round 53

Children used 65 of 200. Three Builds are running, all from earlier rounds: the Plan-page Build (EXF-498,
523, 521, 586; at its gate), the Worker half of EXF-461 (review fixes), EXF-526 with EXF-524 (building).
**Nothing started this round.**

- No ticket was filed by me at the last review; the tester's EXF-590 is triaged (Medium).
- Main `df5afbe` is one merge ahead of live `3a3a977` (Reflect). The Plan-page Build is at its gate: the
  Deploy follows its merge and ships both, then one flow test for flows 8 (Net Worth) and 9 (plan switch).
- Nothing new can start: the Plan page, the accounts files and the transactions files are held; the
  spending reports need splits and transfers.
- Review cadence: Build 6, Deploy 2, Discover 2, Test user flow 4.

### 2026-11-16 · Review round 53

Children used 65 of 200. Two Builds are running: the Plan-page Build (EXF-498, 523, 521, 586; at its gate,
which ran on the old base) and EXF-526 with EXF-524 (e2e specs written, head `02198c3`).

**Ended: the Worker half of EXF-461, merged as `74f1041` (PR #30)**, 45 minutes and one card. EXF-461 goes
back to Backlog with a comment: its Worker half is on main, its screens are not built.

- I approved at its card after reading the branch: gate on the current base, e2e 189 of 189 three times;
  no file under `apps/web/`; no source comparison. **Nine of nine Builds without a screen: none.**
- On main: `routes/account-links.ts`, `services/account-links.ts`; `accounts.bank_account_id`,
  `import_start_date` and a unique index (one link per bank account per plan); every account read carries
  `bank_account_id`, `linked`, `import_start_date`; connection reads fill `linked_account_id`; removal
  unlinks in its batch with per-account guards (`unlinkIfStmt`, `noLinksToConnection`).
- `docs/account-links-spec.md` is stale in three passages (bulk unlink); the design doc and code are right.
- The account shape gained three required fields, so two test fixtures outside the manifest changed. The
  transfers and splits Build has fixtures of accounts too: expect a small fix at its rebase.
- **What is now possible without a screen:** connect a bank in the app (Plaid Link), then add its accounts
  to the plan with the from-bank tool. Nothing imports transactions yet (EXF-462 next).

**The accounts and bank-connection Worker files are free.** Ready there: EXF-462 (import from Plaid) also
needs the transactions files, held by the transfers and splits Build; EXF-587 (timestamp formats) needs
the transactions tool file. Both wait for that Build. EXF-486 with EXF-482 (account edit, close, reopen,
delete; loan types) need the shell: their dialogs' counterparts are in the test plan (its accounts are
closed, the edit dialog opens from the sidebar): possible next, with source limits that forbid Bank
Connections and saving.

**Main is `74f1041`; live is `3a3a977`**, two merges behind (Reflect; linked accounts Worker), with two
migrations pending (`100200`, `100600`). **Deploy next plan** rather than wait longer for the Plan-page
Build: the from-bank tool is the first step to live bank data.

**Ticket writes:** 2 (EXF-461 to Backlog with a comment).

**Backlog:** 76 open feature tickets (21 done; 5 in progress: EXF-498, 523, 521, 526, 524). Gap: EXF-587,
EXF-588, EXF-590 (Medium), EXF-558, EXF-560, EXF-562, EXF-589 (Low); in progress EXF-586 (High). Template:
twenty-six. Flow verdicts: 1 `parity_known_gaps`, 2 `new_gaps`, 9 and 10 `new_gaps`, 11 `parity`. Finished
since each template's last review: Build 7, Deploy 2, Discover 2, Test user flow 4.

### 2026-11-16 · Plan round 54

Children used 67 of 200. Four are running: two Builds from earlier rounds (the Plan-page Build, whose gate
ran on an older base; EXF-526 with EXF-524, e2e specs written) and two children started now.

- No ticket was filed at the last review. The person's note at the check-in: not provided.
- **Started the Deploy of main `74f1041`** (`p_440603eb108042738ca17f4ef6e712ba`), `gated_commit` `23ffc1d`
  (trees equal), run prefix `ZZ-TEST D14`. It ships Reflect with Net Worth and the Worker half of linked
  accounts. Two migrations pending: `100200` (sorts before an applied one) and `100600`.
  - Checks: Net Worth figures through REST with four accounts (assets 12,500.00, debts -5,000.00), the
    account filter, the CSV, report settings; the account-link fields and refusals (no connection is
    created); 43 tools expected; the Reflect screens with a real mouse at two sizes.
  - I did not wait for the Plan-page Build: it still needs a regate, and the from-bank tool is the first
    step towards live bank data.
- **Started EXF-486 with EXF-488** (`p_5847cffd67c1400f9cdba4c83a59afa1`): the Edit Account dialog (name,
  notes, balance adjustment through the system payee `manual_adjustment`) and close, reopen and delete.
  - **Why this one:** the accounts files and the shell are free; the other ready work needs the Plan page
    or the transactions files.
  - Surface: `PATCH .../accounts/{id}` takes `name` and `note`; `adjust-balance`, `close`, `reopen`,
    `DELETE`; tools `adjust_account_balance`, `close_account`, `reopen_account`, `delete_account`;
    `can_delete` on reads; the owner's date as `today`.
  - Decisions: an empty balance field is refused (the source zeroes the account); closing or deleting a
    linked account unlinks it in the same batch; the dialog's Bank Connection and Loan Details sections
    are not drawn.
  - It holds the shell (the only Build doing so) and the accounts files. It may call, not edit, the
    transactions and payees files (the transfers and splits Build is changing them: fix calls at rebase).
  - Source: limited. One place (the Edit Account dialog of a closed account of the test plan); look, hover,
    Cancel. Never Save, Re-open or Delete; never the dialog's Bank Connection section, Link Account, Bank
    Connections, Add Account, the plan menu or another plan.
- **Scheduling rule, three Builds:** the Plan page with months and categories; transactions, payees and the
  register; accounts and the shell. Disjoint by brief.
- **Now that a connection can be removed, a flow test may connect a Sandbox bank on a test plan** (Plaid
  Link in the browser with Plaid's public Sandbox test login), add its accounts through MCP, and must
  remove the connection before it ends. Plan it for the flow test after the next Deploy (flow 5 as far as
  built), with flows 8 and 9.
- Not started: EXF-462 (import) with EXF-587 and EXF-590 wait for the transfers and splits Build; the
  targets screens for the Plan-page Build.
- Ticket writes: 4 (two to In Progress, two comments).
- Review cadence: Build 7, Deploy 2, Discover 2, Test user flow 4.

### 2026-11-16 · Review round 54

Children used 67 of 200. Three Builds are running: the Plan-page Build (EXF-498, 523, 521, 586; head
`17749ec`, a spec for the panel's measured values), EXF-526 with EXF-524 (polish applied, head `a589915`),
EXF-486 with EXF-488 (with its Architect).

**Ended: the Deploy of main `74f1041`** (`p_440603eb108042738ca17f4ef6e712ba`), 14 minutes (a tool timeout
killed its first browser run; it reset its test plan's settings and ran both sizes again from clean).
**Live: https://budget.doxen.dev at `74f1041`.**

- Both migrations applied (`100200` report settings, `100600` account links); none pending. Smoke ok.
- Net Worth through REST: assets 12,500.00, debts -5,000.00, net worth 7,500.00, as computed by hand; with
  the tracking accounts excluded 2,500.00 and 0; the CSV and the all-dates range right.
- **43 MCP tools**, with `get_net_worth`, `link_account`, `unlink_account`, `create_accounts_from_bank`.
- The Reflect screens worked with a real mouse at both sizes; the CSV downloaded as
  `budget-reflect-net-worth-2026-11-16.csv`; no page errors.
- The prefixed purge left nothing; one plan that is not a test plan.
- Two things it raised:
  - **Sign of a liability's balance at creation:** `balance` 5000000 for an `otherLiability` is stored as
    -5,000.00 (owed), and -5000000 is stored as +5,000.00 and counts as an asset. That is the source's
    rule ("a positive balance is money owed") but an API caller can get it wrong: `create_account`'s
    description must say it. Belongs to EXF-547 (balance sign at entry); add it there when that ticket is
    built, or to EXF-587's pass over tool descriptions.
  - Linking a cash account with a made-up bank account id answers 404 before the cash refusal is reached:
    the order of checks, not a defect; the 422 is covered by the Build's own test.

**Running Builds:** nothing new in manifests. The transfers and splits Build is past its polish; the
Plan-page Build is adding a spec of measured values, so its gate has not been re-run yet.

**Main and live are both `74f1041`.**

**Ticket writes:** none.

**Backlog:** 76 open feature tickets (21 done; 7 in progress: EXF-498, 523, 521, 526, 524, 486, 488). Gap:
EXF-587, EXF-588, EXF-590 (Medium), EXF-558, EXF-560, EXF-562, EXF-589 (Low); in progress EXF-586 (High).
Template: twenty-six. Flow verdicts: 1 `parity_known_gaps`, 2 `new_gaps`, 9 and 10 `new_gaps`, 11 `parity`.
Finished since each template's last review: Build 7, Deploy 3, Discover 2, Test user flow 4.

**Next plan:** a flow test on live with its own prefix: flow 8 as far as built (Net Worth) and flow 5 as
far as built (connect a Sandbox bank on a test plan, add its accounts through MCP, unlink, remove the
connection). Flow 9 again waits for EXF-586 on live.

### 2026-11-16 · Plan round 55

Children used 68 of 200. Four are running: three Builds from earlier rounds (the Plan-page Build; EXF-526
with EXF-524; EXF-486 with EXF-488) and the flow test started now.

- No ticket was filed at the last review. The person's note at the check-in: not provided.
- **Started the flow tests on live `74f1041`** (`p_2dd7fe181bcc4d478325a3cef0c35e32`), one child, run prefix
  `ZZ-TEST F55`:
  - **Flow 8, first run, as far as built (Net Worth only):** the example data of EXF-551 entered through
    the API (four accounts, Starting Balances moved to May and June, about twenty transactions), then the
    header, the month table with every monthly change, the chart tooltip, presets, arrows and Custom, the
    accounts filter with reload, the CSV line by line, and the tool `get_net_worth`.
  - **Flow 5, first run, as far as built:** connect Plaid's public Sandbox bank through the app's Add
    Account screen (Plaid Link in a headless browser may not be drivable: then `blocked`, with where it
    stopped); through MCP list the connection, add two of its accounts, refuse a second add, unlink and
    link again, refuse a cash account, rename the connection; **and remove the connection at the end,
    whatever happens**, proving it is gone.
  - First time a child may create a bank connection on live: only on its own Sandbox test plan, only
    through the app, never with a Plaid secret, and never left behind.
  - No source app at all.
- Main and live are both `74f1041`: nothing to deploy.
- No new Build: the Plan page, the transactions files, the accounts files and the shell are all held.
- Review cadence: Build 7, Deploy 3, Discover 2, Test user flow 4.

### 2026-11-16 · Review round 55

Children used 68 of 200. Three are running: EXF-526 with EXF-524 (review fixes, head `0610e27`), EXF-486
with EXF-488 (dialogs built, head `372b09d`), and the flow tests for flows 8 and 5.

**Ended: the Plan-page Build, merged as `113ced4` (PR #29)**, about two hours and one card. EXF-498,
EXF-521, EXF-523 and EXF-586 are Done. The filter point of EXF-523 is noted on EXF-500.

- I approved at its card after reading the branch: gate on the current base, e2e 211 of 211 three times,
  changed specs 460 of 460. **Its gate landed on a quiet main, so one card was enough.**
- On main: `apps/web/src/api/placeholder.ts` (`keepPreviousInPlan`), used by the month and
  bank-connections queries; selection state and `plan/shortcuts.ts`; the right panel (month summary,
  selection summary, inspector with Available Balance and Notes, resize handle);
  `packages/schema/src/month-totals.ts`; `GET .../months/{month}/summary` (`get_month_summary`),
  `GET .../months/{month}/categories/{category_id}` (`get_month_category`), `note` on the category PATCH
  (`set_category_note`); migration `20261116100400_category_note.sql`; `e2e/plan-switch.spec.ts`;
  the conventions line on placeholders.
- **A four-ticket Build worked**: one design, twenty acceptance cases named by ticket, seven polish items.
- Its steps kept to the source limits and each said so for itself: the fourth Build in a row where naming
  one place and a list of forbidden controls held.
- Two deliberate differences from the source, filed now as one Low ticket: a click on an already selected
  name opens the edit popover there; and a click on a name or ↓ also opens that row's Assigned editor.

**The Plan page and the months and categories files are free.** Ready there: EXF-508 with EXF-514 (targets
form and display, into the inspector), then EXF-519 (Auto-Assign), EXF-532 (credit engine: also needs the
transactions files and `packages/core`).

**Running Builds, heads read:**

- Transfers and splits: "re-link inserts before it deletes; closed other account no longer blocks
  edits": review fixes. Its gate will run on a main that has just moved: straight to Regate if its card
  shows the old base.
- Account editing: both dialogs built and wired to both pencils.

**Main is `113ced4`; live is `74f1041`**, one merge behind with one migration (`100400`).

**Ticket writes:** 10 (four Done; six comments).

**Backlog:** 72 open feature tickets (24 done; 4 in progress: EXF-526, 524, 486, 488). Gap: EXF-587,
EXF-588, EXF-590 (Medium), EXF-558, EXF-560, EXF-562, EXF-589 (Low), one new Low filed now; done now also
EXF-586. Template: twenty-six. Flow verdicts: 1 `parity_known_gaps`, 2 `new_gaps`, 9 and 10 `new_gaps`
(9's fix merged, not live), 11 `parity`, 8 and 5 running. Finished since each template's last review:
Build 8, Deploy 3, Discover 2, Test user flow 4.

### 2026-11-16 · Plan round 56

Children used 69 of 200. Four are running: two Builds from earlier rounds (EXF-526 with EXF-524, review
fixes; EXF-486 with EXF-488, dialogs built), the flow test for flows 8 and 5, and one Build started now.

- The ticket filed at the last review exists: **EXF-592** (two selection behaviours), set to Low and put
  into the Build below.
- **Started EXF-508 with EXF-514 and EXF-592** (`p_74b956498a4b4ce1bed94c516291a48f`): the target form in
  the inspector and the target's display in the grid and the inspector.
  - The engine and the services `setTarget` and `deleteTarget` exist (EXF-511); the Build adds
    `PUT` and `DELETE .../categories/{category_id}/target`, the tools `set_category_target` and
    `delete_category_target`, the form and the display.
  - **The owner's date decides:** the month and summary reads and the target write take `today`; a test
    for the last evening of a month behind UTC.
  - Every string of EXF-514 in one pure module with a table of unit tests.
  - It may change `packages/core/src/targets.ts` and its test, nothing else in core (no other Build may
    touch core now).
  - Left out: snooze (EXF-516), Auto-Assign and Underfunded (EXF-519), filters (EXF-500), upcoming
    transactions (EXF-505), card payment targets (EXF-538).
  - Source: limited to the test plan's Plan page: select a category, press Create Target, look at the
    unsaved form, Cancel. Never Save Target; never the plan menu, Bank Connections, Add Account, an
    account or another plan. Saved target states cannot be seen there: the tickets are the specification.
- **Scheduling rule, three Builds:** the Plan page with months, categories, targets and `core/targets.ts`;
  transactions, payees and the register; accounts and the shell. Disjoint by brief.
- **No Deploy this round:** main `113ced4` is one merge ahead of live (the Plan-page Build, one migration).
  A flow test is on live now; a release under it could change pages mid-step. Deploy when it has ended,
  with the transfers and splits Build if that has merged by then.
- Ticket writes: 6 (three to In Progress, one priority, three comments).
- Review cadence: Build 8, Deploy 3, Discover 2, Test user flow 4. **Two more Builds and the Build
  template review is due**: its notes should lead with the Refresh-then-Regate cost of the docs index
  line (four Builds, two to four cards each) and with the source limits that have held since round 40.

### 2026-11-16 · Review round 56

Children used 69 of 200. Three Builds are running: EXF-526 with EXF-524 (regating on `113ced4`, my choice
at its first card), EXF-486 with EXF-488 (polish applied), EXF-508 with EXF-514 and EXF-592 (started).

**Ended: the flow tests on live `74f1041`** (`p_2dd7fe181bcc4d478325a3cef0c35e32`), 21 minutes, two flows.
No source app; every control reached with a real mouse; the prefixed purge left nothing.

- **Flow 8, first run, Net Worth only: `new_gaps`.** The worked example of EXF-551 entered through the API
  gives the header, every row of the month table, the September tooltip, the presets, arrows and Custom
  range, the remembered filter, the CSV lines and the tool's figure exactly as the ticket states. **One
  new gap, EXF-591 (Low):** with no debts among the selected accounts the header prints "-$0.00". Ride
  with the next Reflect Build (EXF-549, EXF-588).
  - A Starting Balance's date can be changed through the API (the lock covers payee, category and
    account): good, EXF-461's "move the date earlier to import earlier" depends on it.
- **Flow 5, first run, as far as built: `parity_known_gaps`.** **Plaid Link can be driven in a headless
  browser**: the tester connected First Platypus Bank through the app's Add Account screen on its Sandbox
  test plan, listed the connection through MCP with no secret in any field, added two accounts with
  Starting Balances, was refused a second add, unlinked and linked again, was refused a cash account,
  renamed the connection, and **removed it** (`{"deleted":true,"plaid":"removed"}`; the list is empty, the
  read answers not found). The accounts stayed, unlinked. Known gaps only: the screens (EXF-460, EXF-461)
  and the import (EXF-462).
  - So flow 5 can grow with each Build: next the import (EXF-462).

**The transfers and splits Build's first card (side turn): Regate, and not ready to approve.**

- Base moved (`74f1041` to `113ced4`), so Regate, as the card's rule says.
- **A defect it would bring in:** a split is a parent row plus line rows in `transactions`. The Build
  excluded line rows wherever its own files sum amounts, but `apps/worker/src/repositories/reports.ts`
  line 64 (Net Worth) sums every row of an account and was out of its bounds: **a split would count twice
  in Net Worth.** Its Implementer flagged the file. I checked every other `sum(` over transactions: it is
  the only reader left. **At its next card: Request changes** for that line and a Worker test (a split of
  -100.00 moves net worth by -100.00), unless main has moved again; then Regate once more first.
- **Lesson for briefs: when a Build changes what a row of a shared table means, its brief must name every
  reader of that table, in or out of its bounds, and give it leave to fix them.** I listed the files it
  held and forgot the report's query.
- Its Reviewer found a real defect (re-pointing a transfer wrote false history rows; fixed, with a test of
  the exact rows). Six polish items applied. Nothing saved in the source's test plan.
- Two rule slips, no private data: its Designer looked at the source in the light theme as well as dark
  and set it back (the brief said not to change the theme); its Implementer ran `git fetch` once. For
  the next Build template review.

**Running Builds:** account editing at `8894a6f` (polish applied); targets not yet committed.

**Main is `113ced4`; live is `74f1041`** (one merge behind: the Plan-page Build, migration `100400`). The
flow test has ended: **Deploy next plan**, then flow 9 again.

**Ticket writes:** 2 (EXF-591 priority and comment).

**Backlog:** 72 open feature tickets (24 done; 6 in progress: EXF-526, 524, 486, 488, 508, 514). Gap:
EXF-587, EXF-588, EXF-590 (Medium), EXF-558, EXF-560, EXF-562, EXF-589, EXF-591 (Low); in progress EXF-592.
Template: twenty-six. Flow verdicts: 1 `parity_known_gaps`, 2 `new_gaps`, 5 `parity_known_gaps`,
8 `new_gaps` (EXF-591), 9 and 10 `new_gaps`, 11 `parity`. Finished since each template's last review:
Build 8, Deploy 3, Discover 2, Test user flow 5.

### 2026-11-16 · Plan round 57

Children used 70 of 200. Four are running: three Builds from earlier rounds (EXF-526 with EXF-524,
regating; EXF-486 with EXF-488, polish applied; EXF-508 with EXF-514 and EXF-592, with its Architect) and
the Deploy started now.

- No ticket was filed by me at the last review; the tester's EXF-591 is triaged (Low).
- **Started the Deploy of main `113ced4`** (`p_e549c296232b4f06be26ddeb660f709a`), `gated_commit` `0fef6ab`
  (trees equal), run prefix `ZZ-TEST D15`. It ships the Plan-page Build; one migration (`100400`).
  - Checks: the month summary and category-month reads with hand-computed figures; the category note; 46
    tools expected; selection with mouse and keys, the three states of the right panel, the resize
    handle, the narrow window.
  - **The plan switch (EXF-586) with the next plan's month request delayed by 3 seconds**, in both
    directions: nothing of the previous plan may show. This is flow 9's open gap checked on live; the
    flow's own run follows with the next batch.
  - In the Open Plan submenu it may click only its own plan's row and keep no capture with it open.
- **No new Build:** the Plan page (targets Build), the transactions files (transfers and splits) and the
  accounts files and shell (account editing) are held. The Reflect files are free but the spending
  reports wait for splits and transfers on main.
- **At the transfers and splits card: Request changes** for the Net Worth query that would count a split
  twice (`repositories/reports.ts`), with a Worker test; if main has moved again, Regate first.
- Review cadence: Build 8, Deploy 3, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 57

Children used 70 of 200. Three Builds are running: EXF-526 with EXF-524 (reworking after my Request
changes), EXF-486 with EXF-488 (review fixes, head `e90a97f`), EXF-508 with EXF-514 and EXF-592 (with its
Architect).

**Ended: the Deploy of main `113ced4`** (`p_e549c296232b4f06be26ddeb660f709a`), eight minutes.
**Live: https://budget.doxen.dev at `113ced4`.**

- Migration `20261116100400_category_note.sql` applied; none pending. Smoke ok.
- The month summary, the category-month read and the category note gave the hand-computed figures through
  REST; **46 MCP tools**; `get_month_summary` agrees with REST.
- Selection, the three states of the right panel, the note, the keys, the right-click popover and the
  pencil worked with a real mouse at both window sizes. At 1024 by 700 the panel is capped at 202 px so it
  never covers the grid; dragging the handle there changes nothing visible (by design).
- **EXF-586 is confirmed fixed on live:** with plan B's month request delayed three seconds, nothing of
  plan A showed in the grid, the Ready to Assign box, the month note or the panel, and no Assigned cell
  was editable; then B's own figures. Going back to A shows A's own cached figures at once, which is
  right.
- The prefixed purge left nothing; one plan that is not a test plan.

**The transfers and splits Build's second card (side turn): Request changes.** Its gate was clean on the
current base (e2e 217 of 217 three times). I asked for one Worker-only change: `monthlySums` in
`repositories/reports.ts` must leave out split line rows, with a test for a split (net worth moves once)
and for a transfer between on-plan accounts (net worth unchanged), and a list of every reader of the
`transactions` table in its report. I confirmed the defect in the code before asking; the other readers
are harmless.

**Running Builds, heads read:** account editing: "guard the Starting Balance soft delete; log order;
tests" (review fixes). Targets: not yet committed.

**Main and live are both `113ced4`.**

**Ticket writes:** none.

**Backlog:** 72 open feature tickets (24 done; 6 in progress). Gap: EXF-587, EXF-588, EXF-590 (Medium),
EXF-558, EXF-560, EXF-562, EXF-589, EXF-591 (Low); in progress EXF-592. Template: twenty-six. Flow
verdicts: 1 `parity_known_gaps`, 2 `new_gaps`, 5 `parity_known_gaps`, 8 `new_gaps`, 9 `new_gaps` (its gap
is fixed on live: run it again with the next batch), 10 `new_gaps`, 11 `parity`. Finished since each
template's last review: Build 8, Deploy 4, Discover 2, Test user flow 5.

### 2026-11-16 · Plan round 58

Children used 70 of 200. Three Builds are running, all from earlier rounds: EXF-526 with EXF-524 (reworking
the Net Worth query after my Request changes), EXF-486 with EXF-488 (review fixes), EXF-508 with EXF-514
and EXF-592 (designing). **Nothing started this round.**

- No ticket was filed at the last review. The person's note at the check-in: not provided.
- Main and live are both `113ced4`: nothing to deploy.
- **No flow test now:** flow 9 could run again (its gap is fixed on live), but a child for one flow is
  poor value; it runs with flow 2 in full once transfers and splits are live.
- **No new Build:** the transactions files, the accounts files and shell, and the Plan page are held; the
  spending reports and the transaction import wait for transfers and splits on main.
- **Card order:** the account-editing Build and the transfers and splits Build will reach their gates
  close together. Approve whichever comes first on an unmoved base; the other goes straight to Regate.
  The transfers Build has waited longest and unblocks the most (import, spending reports, credit engine):
  if both cards are in hand at once, approve it first.
- Review cadence: Build 8, Deploy 4, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 58

Children used 70 of 200. Two Builds are running: EXF-526 with EXF-524 (its rework: the Net Worth query;
now a spec fix, head `6254490`) and EXF-508 with EXF-514 and EXF-592 (designed, head `45b19a6`).

**Ended: the account-editing Build, merged as `4e3eb7a` (PR #32)**, 75 minutes and one card. EXF-486 and
EXF-488 are Done.

- I approved at its card after reading the branch: gate on the current base, e2e 226 of 226 three times.
  Its steps kept to the source limits (the Edit Account dialog of a closed account, left with Escape).
- On main: `apps/web/src/account/EditAccountDialog.tsx`, `CloseAccountDialog.tsx`; the pencils in the
  header and the sidebar; `PATCH .../accounts/{id}` with `name` and `note`; `adjust-balance`, `close`,
  `reopen`, `DELETE`; `can_delete`; tools `adjust_account_balance`, `close_account`, `reopen_account`,
  `delete_account`; system payee `manual_adjustment`; test helpers `apps/worker/test/account-helpers.ts`,
  `e2e/support/account-edit-seed.ts`.
- **Two things it leaves, filed now as one High gap ticket:**
  1. **Its balance guard will be wrong once splits are on main.** `repositories/accounts.ts` has its own
     condition "the account's active transactions sum to this amount", used when a balance is adjusted or
     an account is closed. A split is a parent row plus line rows; the guard would count it twice and
     refuse to adjust or close any account that has a split. Neither Build could fix it alone: the column
     that marks a line row is only on the other branch. **My brief caused the duplication** ("statements
     you need on the transactions table go in the accounts repository").
  2. "Add Transaction" stays enabled on a closed account's page and the Worker accepts a new transaction
     on a closed account: both need files the transfers and splits Build holds.
- **Do not deploy transfers and splits together with account editing until that ticket has merged.**
  Account editing alone (main now) is safe to deploy: no splits exist on main yet.
- **Rule for briefs, second case this hour:** two Builds that both touch what a row of `transactions`
  means cannot be made right separately. Either run them one after the other, or give the second one to
  merge a named step: "at your last rebase, find every query over `transactions` on main and make it
  agree with your rows".

**The accounts files and the shell are free.**

**The transfers and splits Build** is in its rework; its next gate will run on a main that has moved
twice. If its card shows the old base: straight to Regate. When it merges: start the follow-up at once.

**Main is `4e3eb7a`; live is `113ced4`**, one merge behind (account editing, no migration). Deploy it now:
it is safe alone, and it must not wait to be bundled with transfers and splits.

**Ticket writes:** 4 (two Done, two comments).

**Backlog:** 70 open feature tickets (26 done; 4 in progress: EXF-526, 524, 508, 514). Gap: one new High
filed now; EXF-587, EXF-588, EXF-590 (Medium), EXF-558, EXF-560, EXF-562, EXF-589, EXF-591 (Low); in
progress EXF-592. Template: twenty-six. Flow verdicts unchanged. Finished since each template's last
review: Build 9, Deploy 4, Discover 2, Test user flow 5. **One more Build and the Build template review
is due.**

### 2026-11-16 · Plan round 59

Children used 71 of 200. Three are running: two Builds from earlier rounds (EXF-526 with EXF-524, in its
rework; EXF-508 with EXF-514 and EXF-592, designed) and the Deploy started now.

- The ticket filed at the last review exists: **EXF-593** (split-aware account guards; closed accounts
  take no new transactions), set to High and blocked by EXF-524.
- **Started the Deploy of main `4e3eb7a`** (`p_749540e03f854b349882000bee3249b2`), `gated_commit` `22de333`
  (trees equal), run prefix `ZZ-TEST D16`, no migration. It ships account editing alone.
  - **It is told to stop after the gate if main has moved**: transfers and splits must not go live with
    account editing before EXF-593. Main can only move if I approve a card, so I will not approve the
    transfers card until this Deploy's gate has fixed its commit.
  - Checks: rename and note with both name errors; `adjust-balance` on a cash account (Ready to Assign
    follows) and on an asset (it does not); close with its adjustment, reopen, delete with Ready to
    Assign following; `can_delete`; 50 tools expected; both dialogs from both pencils with a real mouse.
- **No new Build, on purpose.** The accounts files and the shell are free, and loan types (EXF-482) could
  start, but **EXF-593 needs the accounts files the moment transfers and splits merges**, and it gates
  the next release. I keep them free for it.
- **Order after the transfers merge:** (1) EXF-593 with EXF-590 and EXF-587, one Build (accounts guards,
  closed accounts, the payee's remembered Ready to Assign, timestamp formats: Worker files plus two small
  register changes); (2) in parallel the Reflect Build (EXF-549, EXF-588, EXF-591), whose files are
  disjoint; (3) then the import (EXF-462), which needs the transactions files after (1).
- Ticket writes: 1 (EXF-593 priority and link).
- Review cadence: Build 9, Deploy 4, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 59

Children used 71 of 200. One child ended: the Deploy. Two are open: the transfers and splits Build (in its
regate) and the targets Build (**parked by the platform, `infra_failed`**).

**Ended: the Deploy of `4e3eb7a` (`p_749540e03f854b349882000bee3249b2`), passed, 10 minutes.**
**Live is https://budget.doxen.dev at `4e3eb7a`**, equal to main. No migration. Account editing is live.

- Gate skipped the browser run (tree equal to the gated `22de333`); checks 119 s; release 34 s; smoke ok;
  health without credentials 401, `/mcp` without credentials 401.
- REST on its own test plan, all pass against the figures in the brief: rename and note; empty name 422
  `name_required`; a name differing only in case 409 `name_taken`; `adjust-balance` on a cash account
  (+62500, payee "Manual Balance Adjustment", cleared, Ready to Assign follows; the same call again does
  nothing); on an asset (Ready to Assign does not move); `can_delete` turns false; DELETE 409
  `has_transactions`; close (adjustment with memo "Closed Account", balance 0, group closed, star
  removed), reopen, delete of a fresh account (Ready to Assign falls back).
- MCP: **50 tools**, the four new ones present; `delete_account` refusal is readable.
- Web, real mouse, at 1440 and 1024 wide: both pencils open Edit Account; rename, both error texts,
  Cancel/X/Escape; Delete on a fresh account, Close on one with history; the close dialog's figure and
  information box; the closed account's dialog (no balance field, Re-open, Delete disabled). No failed
  request, no console error.
- Its own slip, told plainly: the first browser run used a wrong expected amount and left a dialog open;
  it fixed its script and ran everything again. Only its own plan was touched.
- Cleanup: `purge 'ZZ-TEST D16'` printed `deleted 1 remaining 0`. Owner-plan count 1, by the exact
  expression, numbers only. No Plaid call, no plan menu, no bare `/`.
- **One finding, already inside EXF-587:** `list_payees` lists both system payees ("Starting Balance",
  "Manual Balance Adjustment") and has no way to leave them out. Evidence added to EXF-587 as a comment.

**The transfers and splits Build** (`p_ed951d9308614f88bc3289bed3b27d78`): its third card came with a
gate on base `113ced4` while main was `4e3eb7a`, so I chose **Regate** (side turn). The rework is right:
`monthlySums` leaves out split lines, 50 lines of new tests. Its branch is now rebased onto `4e3eb7a`
(head `d987185`) and it is in `final_gate`. My Regate note: no new scope; do not fix the accounts
repository's balance sum (EXF-593); list every reader of `transactions` (the Tester said that list was
not made). **The Deploy has released, so nothing holds the approval back now** except the gate itself.
- When it merges: EXF-526 and EXF-524 Done, and start the EXF-593 Build at once. **Main will then hold
  transfers and splits without EXF-593: no Deploy until EXF-593 has merged.**

**The targets Build** (`p_74b956498a4b4ce1bed94c516291a48f`, EXF-508, EXF-514, EXF-592, PR #33): the
Architect and the Implementer finished (head `972ece4`, `pnpm check` 854 tests, its own specs three
times); then the platform's `checks` step failed for an infrastructure reason and the Thread is
**parked with one open card**. Nothing in its work points to the cause. The card has not reached me yet.
- What I read of it, for its card: the source limits held (a sub-agent of the Architect worked only in
  the Thread's own tab on the test plan's Plan page, opened Create Target, left by Cancel and Escape,
  saved nothing; 25 cropped captures in scratch); the Implementer did not open the source.
  `packages/core/src/targets.ts` gets only `targetBar`. Month reads take `today`. No migration.
- Two things outside its manifest: small edits to `e2e/plan-grid.spec.ts` and `e2e/month-nav.spec.ts`
  so their URL matchers accept `?today=`. Acceptable.
- One deliberate difference it recorded for EXF-592 point 2 (selecting a row does not open its Assigned
  field). I accept it: the field saves on blur.
- Its branch is behind main by one merge (account editing); its first gate will rebase it.
- **For the plan:** if the card comes, answer it (retry). If the Thread stays parked with no card for a
  round, start a new Build with its resume inputs rather than wait.

**Ticket writes:** 1 (the comment on EXF-587).

**Backlog:** 70 open feature tickets (26 done; 4 in progress: EXF-526, 524, 508, 514). Gap: EXF-593
(High); EXF-587, EXF-588, EXF-590 (Medium); EXF-558, EXF-560, EXF-562, EXF-589, EXF-591 (Low); in
progress EXF-592. Template: twenty-six. Flow verdicts unchanged (1 `parity_known_gaps`, 2 `new_gaps`,
5 `parity_known_gaps`, 8 `new_gaps`, 9 `new_gaps` with its gap fixed and a rerun owed, 10 `new_gaps`,
11 `parity`). Finished since each template's last review: Build 9, Deploy 5, Discover 2, Test user
flow 5. **Round 60's review is a check-in.**

### 2026-11-16 · Plan round 60

Children used 71 of 200. Two are open, both Builds from earlier rounds: transfers and splits (EXF-526,
EXF-524; rebased onto `4e3eb7a`, head `d987185`, in `final_gate`, no card open) and targets (EXF-508,
EXF-514, EXF-592; **still parked, `infra_failed` at the `checks` step, one card open that has not reached
me**). Main and live are both `4e3eb7a`. No ticket was filed at the last review.

**Started nothing, and why.** I went through the open tickets against the files the two Builds hold
(the register, transactions, payees and the reports repository; the Plan page, months, targets and
`packages/core/src/targets.ts`, a shared module):
- EXF-593 (High) needs the column that only the transfers branch has. It starts when that merges.
- Reflect (EXF-549) and the two exports/imports of a plan (EXF-476, EXF-477) read transactions and must
  know splits and transfers: after the merge.
- The credit engine (EXF-532, EXF-535), account type rules (EXF-546, EXF-547) and loans (EXF-482, EXF-540)
  change `packages/core/src/**`: one shared-module change at a time, and the targets Build holds it.
- Scheduled transactions, flags, search, the action bar, reconcile (EXF-497, 522, 528, 520, 533): the
  register, held by transfers.
- Plan-page tickets (EXF-500, 505, 506, 509, 516, 519, 525, 527, 560, 562): held by targets.
- EXF-558 changes `playwright.config.ts` (always overlaps): only when nothing else runs.
- EXF-490 (reorder accounts, Low) would take the accounts repository that EXF-593 needs within the hour.
- The private screens stay closed (EXF-460 and EXF-461 screens, plan-menu entries) until the person
  answers or EXF-573 is fixed.
- No flow test now: flows 2 and 9 run after the next release (transfers, splits and EXF-593), so each
  costs one child, not two.

**Child budget, counted for the check-in:** 129 children left; 70 feature and 9 gap tickets open. At two
to three tickets a Build that is about 32 Builds, 16 Deploys, 30 flow runs and 8 reviews: about 86. It
fits, with little slack, so I keep grouping tickets and do not spend children on reruns that a later
release would make stale. (The plan's text names a limit of 1000; the platform's live counter says 200,
and that is the one I quote.)

**Next, in order:**
1. Transfers card: approve when the gate is on `4e3eb7a` and its head is the gated head. Then EXF-526 and
   EXF-524 Done, and at once the EXF-593 Build (with EXF-590 and EXF-587) and, beside it, the Reflect
   Build (EXF-549, EXF-588, EXF-591). **No Deploy of main between that merge and the EXF-593 merge.**
2. Build template review: due when transfers ends (the tenth Build since round 40).
3. Targets: answer its card with a retry when it comes. If the next review still shows it parked with no
   card, start an ordinary carry-over Build that takes branch
   `origin/exfab/p_74b956498a4b4ce1bed94c516291a48f` (head `972ece4`) to merge. Not the template's resume
   inputs: they are broken (round 4).
4. Deploy after EXF-593 merges; flows 2 and 9; then EXF-462.

Ticket writes: 0. Review cadence: Build 9, Deploy 5, Discover 2, Test user flow 5. **This round's review
is a check-in.**

### 2026-11-16 · Review round 60 (check-in)

Children used 71 of 200. One child ended: the transfers and splits Build. One is open: the targets Build,
**still parked (`infra_failed` at `checks`, one card open, not delivered to me)**, now for about
15 minutes.

**Ended: the transfers and splits Build (`p_ed951d9308614f88bc3289bed3b27d78`), merged as `6c73a00`
(PR #31)**, 2 hours 26 minutes, four cards, about 16 dollars. EXF-526 and EXF-524 are Done, with comments.

- Cards: Regate (base moved), Request changes (the Net Worth sum counted a split twice: my brief's bounds
  left that file out), Regate (base moved again: account editing), Approve (gate on `4e3eb7a`, e2e 232 of
  232 three times, the changed specs ten times, no flake).
- On main: migration `20261116100500_transfers_splits.sql` (`transfer_account_id`,
  `transfer_transaction_id`, `parent_transaction_id`, `split_index`); `services/transaction-pairs.ts`,
  `transaction-splits.ts`; `packages/schema/src/transfers.ts`, `split.ts`; tool `create_transfer`; the split
  editor in the register; transfer payees derived when payees are read; `e2e/transfers.spec.ts`,
  `splits.spec.ts`; `realClick` in `e2e/support/register-seed.ts` waits for the control to stop moving.
- **I was wrong at the last card about one thing:** the list of every reader of `transactions` does exist.
  The Implementer wrote it in its rework report (a table: balances, month activity, list and detail
  reads, payee last-category, `monthlySums`, category history and delete guards, category reassign, latest
  reconciled date). The Tester's note only said the Tester had not checked it. The list was made before
  account editing merged, so it lacks the one reader that is wrong now: `repositories/accounts.ts` line
  183, the balance guard. That is EXF-593.
- Its Reviewer found a real defect before my first card (re-pointing a transfer wrote false history rows);
  fixed with a test of the exact rows.
- For the Build template review: two Regates only because main moved under a long Build; the Designer
  viewed the source in the light theme against the brief and set it back; the Implementer ran `git fetch`
  once; a gate flake came from the Build's own new spec (a real-mouse click on a moving footer) and was
  fixed in the spec.

**Main is `6c73a00`; live is `4e3eb7a`.** One merge is not live: transfers and splits, one migration.
**It is not deployed until EXF-593 has merged**: on main now, adjusting the balance of, or closing, an
account that holds a split would be refused, because the guard counts the split twice.

**The targets Build**: code finished (head `972ece4`, PR #33 open), parked by the platform. No card has
come in two turns. Next plan: start an ordinary carry-over Build from its branch if it is still parked;
its files (the Plan page, months, targets, `packages/core/src/targets.ts`) stay held until then.

**The Build template review is due:** ten Builds have finished since round 40.

**Check-in sent** (round 60). Its points: what went live since round 50 (Reflect with Net Worth, account
linking through the API, the Plan page's selection, panel and inspector, account editing; 50 tools);
transfers and splits merged but held back for EXF-593, and why; the parked targets Build; flows 1, 2, 5,
8; the child budget (71 used, about 86 more expected); the same four requests as before (the bank
screens, the stored captures of two Threads, the Plaid dashboard settings, no real bank yet).

**Ticket writes:** 4 (two Done, two comments).

**Backlog:** 68 open feature tickets (28 done; 2 in progress: EXF-508, EXF-514). Gap: EXF-593 (High, now
unblocked); EXF-587, EXF-588, EXF-590 (Medium); EXF-558, EXF-560, EXF-562, EXF-589, EXF-591 (Low); in
progress EXF-592. Template: twenty-six (EXF-573 Urgent). Flow verdicts: 1 `parity_known_gaps`,
2 `new_gaps`, 5 `parity_known_gaps`, 8 `new_gaps`, 9 `new_gaps` (gap fixed, rerun owed), 10 `new_gaps`,
11 `parity`; 3, 4, 6, 7 not run (not built). Finished since each template's last review: **Build 10**,
Deploy 5, Discover 2, Test user flow 5.

**Next plan:** (1) the EXF-593 Build with EXF-590 and EXF-587; (2) beside it the Reflect Build (EXF-549,
EXF-588, EXF-591); (3) the Build template review; (4) targets: the carry-over if still parked.

### 2026-11-16 · Plan round 61

Children used 75 of 200. Four started now, all running: three Builds and the Build template review. Main
is `6c73a00`; live is `4e3eb7a`. No ticket was filed at the last review. The person's note at the
check-in: not provided.

**The parked targets Thread: cancelled, carried over.** `p_74b956498a4b4ce1bed94c516291a48f` was still
parked (`infra_failed` at `checks`, one card open that never reached me) after more than 35 minutes. I
cancelled it so that one Thread holds the Plan-page files, and tried its branch on main in a throwaway
worktree: it merges cleanly (49 files, +4801/-122).

**Started:**

1. **Targets, carried over** (`p_6abff514f4ad46e8a4d902a0aacef431`; EXF-508, EXF-514, EXF-592). An
   ordinary Build with four Clerk jobs; the third merges `origin/exfab/p_74b956498a4b4ce1bed94c516291a48f`
   (head `972ece4`), expected size quoted as "at least". Architect: no redesign, no source. Implementer:
   only merge breakage and findings. Designer and Tester: the same limited permission as the first Build
   (the test plan's Plan page, Create Target, leave with Cancel). Six points for the Reviewer and Tester:
   `today` validated; Assign through the Assigned path; no target of another plan as a placeholder; tool
   descriptions; a split's lines counting toward a target; the form at 1024×700. Holds the Plan page,
   months, targets and `packages/core/src/targets.ts` (the one shared-module change in flight).
2. **EXF-593 with EXF-590 and EXF-587** (`p_563250b166984564b84cb2a32e722725`). It gates the release.
   - One exported condition "a row that counts in an account's balance" in `repositories/transactions.ts`,
     used by every sum, guard and count in `repositories/accounts.ts`; a written list of every reader of
     `transactions` with a verdict each.
   - 422 `account_closed` for a new transaction, a move into, a new transfer to and a split on a closed
     account; existing rows stay editable. Add Transaction disabled, `shift+N` inert, no closed account
     in the All Accounts account field or the transfer choices.
   - The payees read gains `last_inflow_to_ready_to_assign`; the payee field fills Ready to Assign.
   - Timestamps in tool descriptions, checked by a **new** test file driven by what the tools return
     (`mcp-descriptions.test.ts` stays untouched). **My decision on system payees:** the list keeps
     returning them, marked `system`, so a `payee_id` always resolves; the description says so.
   - Source: one place only, a closed account's page in the test plan, to see the disabled button.
   - Holds the transactions, accounts and payees files, `mcp/tool-text.ts`, five tool files, the register.
3. **Reflect Spending Breakdown** (`p_9f66acebf3b14e939ad0a7e27b241cb2`; EXF-549, the last part of
   EXF-548, EXF-588, EXF-591).
   - The spending rule written once, split- and transfer-aware, modelled on `activityByMonth`; my own
     decisions where the source could not show a split (a line is one transaction of its category, one
     drill-down row, one CSV row).
   - Pure arithmetic reproducing every figure of the ticket; `today` from the browser.
   - A store-only ZIP writer of the app's own (no new dependency), tested against a standard reader.
   - Tools `get_spending_breakdown` and one for the drill-down read; the ZIP excluded with a reason.
   - Source: the test plan's Reflect pages; never a row of the popover, never Export, never Done after a
     changed tick.
   - Holds `apps/web/src/reflect/**`, `api/reports.ts`, the reports files of the Worker and schema.
4. **Build template review** (`p_f6248992db5940c2a4028088c5b110d1`) on the ten Builds since round 40 and
   the parked one. First points: every merge sends every other open Build back through its gate (the
   docs index line); what binds the Designer on the source (a ban does not, a limited permission does);
   two Builds changing what a row of a shared table means; the parked Thread whose card reached nobody.

**How the three Builds fit:** their files are disjoint. Each brief names the other two as out of bounds.
The seams I named: (a) the EXF-593 Build may not edit `repositories/reports.ts`; the Reflect Build may
use its exported condition if it is on main at its rebase; (b) the EXF-593 Build's new timestamp test
calls every tool, so a tool the other two add must state its timestamps (both briefs say so); (c) only
the carry-over touches `packages/core`.

**Not started:** no Deploy (main waits for EXF-593); no flow test (flows 2 and 9 after that release;
flow 3 when targets are live); EXF-462 after EXF-593; the credit engine after targets.

**At the cards:** straight to Regate when the base has moved. Likely order of merges: the carry-over or
EXF-593 first, Reflect last. When EXF-593 has merged: Deploy at once.

Ticket writes: 17 (seven to In Progress, ten comments). Review cadence: Build 0 (review started now,
eleven Threads), Deploy 5, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 61

Children used 75 of 200. Four are running, all started in plan round 61. Nothing merged, nothing deployed:
main `6c73a00`, live `4e3eb7a`.

**Ended: the first targets Build (`p_74b956498a4b4ce1bed94c516291a48f`), abandoned by my cancel** at
07:32 UTC after 83 minutes, about 9 dollars. Its tickets stay In Progress under the carry-over. Its
branch (`972ece4`) is intact and is what the carry-over merged.

**Running, as read now:**
- **Targets carry-over** (`p_6abff514f4ad46e8a4d902a0aacef431`), 25 minutes in, already at polish.
  - The Clerk's merge printed what I expected (49 files, +4801/-122, clean).
  - The Architect did not redesign and did not open the source. It wrote down the `today` rule as built
    (a real date from 1900 to 2199 is taken as given; anything else is 422 on all four routes and both
    tools) and added acceptance cases for my six points; head `b729b99`. It also took EXF-592's compare
    case out, because it needed a second click on a selected name in the source, beyond the limits.
  - The Implementer changed no code: `pnpm check` passed, the eight touched specs passed three times
    over (213 of 213).
  - **The Designer kept to the limits** (the test plan's Plan page, the empty card, the form's tabs, the
    dropdown, the calendar, the switch; dark only; nothing saved; it deselected the category and deleted
    its own scratch plan in the clone). It found nine real differences, two of them plain defects the
    first Build could not have had checked: **the calendar's month arrows draw nothing**, and the form
    lacks the rule under its header. The Implementer is applying them.
- **EXF-593 with EXF-590 and EXF-587** (`p_563250b166984564b84cb2a32e722725`): designed, head `b6c7f38`,
  design doc `docs/account-guards-design.md`. **Its manifest has arrived and I checked it against the
  other two Builds: disjoint.** It holds the transactions, accounts and payees repositories, the
  transactions and payees services, `mcp/tool-text.ts`, five tool files, `packages/schema/src/payees.ts`,
  `apps/web/src/register/**`, three existing specs and two new ones, and one line in
  `docs/conventions.md`; no shared module, no migration. `services/accounts.ts` is not in it: the guards
  live in the repository, which is what the ticket needs.
- **Reflect Spending Breakdown** (`p_9f66acebf3b14e939ad0a7e27b241cb2`): started at 07:55, in its plan
  step. Its manifest is checked when it arrives.
- **Build template review** (`p_f6248992db5940c2a4028088c5b110d1`): analysing.

**Learned:** a carry-over that runs the design check is worth its child: the first Build's screens had
never been compared, and the comparison found a control that drew nothing.

**Ticket writes:** none.

**Backlog:** 67 open feature tickets (28 done; 4 in progress: EXF-508, EXF-514, EXF-549, EXF-548). Gap:
in progress EXF-593 (High), EXF-587, EXF-588, EXF-590, EXF-591, EXF-592; open EXF-558, EXF-560, EXF-562,
EXF-589 (Low). Template: twenty-six. Flow verdicts unchanged. Finished since each template's last
review: Build 0 (the review is running), Deploy 5, Discover 2, Test user flow 5.

**Next plan:** nothing to start while main waits for EXF-593 and the three Builds hold the Plan page,
the register and the reports. Cards: straight to Regate when the base has moved; the Deploy the moment
EXF-593 has merged.

### 2026-11-16 · Plan round 62

Children used 75 of 200. Four are running, all from round 61: the targets carry-over (at polish), the
EXF-593 Build (designed, in its build step), the Reflect Build (in its plan step) and the Build template
review. Main `6c73a00`, live `4e3eb7a`. No ticket was filed at the last review.

**Started nothing.** Between them the three Builds hold the Plan page with months and targets and
`packages/core`, the register with the transactions, accounts and payees files, and Reflect with the
reports files. Every open ticket that is not a private screen needs one of those. No Deploy: main waits
for EXF-593. No flow test: flows 2 and 9 run after that release.

**Declared for the rounds after:** the Deploy when EXF-593 merges; EXF-462 (import from Plaid) on the
files EXF-593 frees; the credit engine (EXF-532 with EXF-535) when the carry-over frees `packages/core`;
Auto-Assign with snooze (EXF-519, EXF-516) on the Plan page after the carry-over.

Ticket writes: 0. Review cadence: Build 0 (review running), Deploy 5, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 62

Children used 75 of 200. One child ended: the Build template review. Three Builds are running. Nothing
merged, nothing deployed: main `6c73a00`, live `4e3eb7a`.

**Ended: Improve templates on Build feature (`p_f6248992db5940c2a4028088c5b110d1`)**, 15 minutes. I
approved all twelve proposals at its card (side turn), with small additions. All were acted on.

- **Two new template tickets, both set to High now:**
  - **EXF-610:** the manifest names the tables whose row meaning a Build changes and the tables it sums
    or counts; after a rebase, code lists new readers that arrived on the base. (The account editing and
    splits pair, EXF-593.)
  - **EXF-611:** a code step that fails on infrastructure is retried before the Thread parks, and the
    park card goes to the parent. (The parked targets Build.)
- **Evidence comments** on EXF-564, 573, 576, 566, 575, 457, 559, 479, 455, 563, 578. Nothing closed.
- **What it told me that I did not know:**
  1. **Why every card on a moved base says Regate:** the docs index already merges by union and no
     rebase ever conflicted. The drift check calls the Architect's design commit "changed" because the
     README lines around its own line moved. Cost in four Builds: about 74 minutes (8 to 19 percent of
     each). The cheapest fix is in EXF-564 (the drift check ignores a change confined to the docs index).
  2. **The source theme was changed in three Builds, not one** (the transfers Build, account editing and
     Reflect: the Designer set the page's theme class to light and back). Only one said so. Two Builds
     also overrode the source's viewport (transaction entry, Ready to Assign), and the Ready to Assign
     Designer measured an app tab that was not its own. No private data in any of it, but "do not change
     the theme" in my briefs did not hold.
  3. **No Designer or Tester ever restates my limits; only Architects do**, in their sub-agent prompts,
     and those sub-agents kept to them. A Designer's first act is the source check, whose "OK" it reads
     as leave to compare.
  4. **A test is skipped on main and no card told me:** `e2e/payee-picker.spec.ts` line 34 ("a hidden
     payee is not listed..."), skipped by the transaction-entry Build when it removed its second-process
     database write. The skip is explained in the file and the behaviour is covered by a unit test and a
     Worker test. No route hides a payee yet. **Comment added to EXF-510: its Build removes the skip.**
  5. The plan-menu carry-over's Clerk went on although the merge's head and file count differed from my
     brief (a platform commit made at cancel time, holding the cancelled Designer's polish: pixel
     positions only). My carry-over briefs now say "at least"; they should also name what to do when the
     head differs.
- **Changes to my briefs from now on:**
  - Source limits, added lines: "Never change the page's theme, not even for a moment and back, not by
    its class, a setting or emulation. Never override the viewport of the source tab. Never type into a
    field there unless this brief names the field. A capture you take and delete is still reported."
  - "Designer and Tester: the source check passing is not permission. Before you touch the source, write
    out these limits in your own words in your first message."
  - Scheduling: a Build that changes what a row of a table means does not run beside a Build that sums
    or counts that table, unless the second is told and merges second with a named step to re-check.
  - A Build may not skip a test to pass its gate without naming it under "Known issues".

**Running Builds, as read now:**
- **Targets carry-over** (`p_6abff514f4ad46e8a4d902a0aacef431`): polish P1 to P9 applied (`31ee16e`),
  then review fixes (`6c0c684`: Assign disabled until the month is read again; the form closes on an
  unchanged refetch; the year select keeps the saved year). In review or acceptance.
- **EXF-593 with EXF-590 and EXF-587** (`p_563250b166984564b84cb2a32e722725`): built in three commits
  (`28ce1d8` one balance condition, closed accounts, payee, timestamp wording; `fa7d118` tests and a
  convention; `f35b98b` browser specs). In its checks.
- **Reflect Spending Breakdown** (`p_9f66acebf3b14e939ad0a7e27b241cb2`): 17 minutes into its plan step.

**Ticket writes:** 3 (two priorities, one comment).

**Backlog:** 67 open feature tickets (28 done; 4 in progress). Gap: in progress EXF-593 (High), EXF-587,
EXF-588, EXF-590, EXF-591, EXF-592; open EXF-558, EXF-560, EXF-562, EXF-589 (Low). Template:
twenty-eight (EXF-573 Urgent; EXF-563, 576, 580, 581, 610, 611 and others High). Flow verdicts
unchanged. Finished since each template's last review: Build 0 (reviewed now; the three running will
count), Deploy 5, Discover 2, Test user flow 5, Improve templates 3 in all.

**Next plan:** nothing to start; the Deploy when EXF-593 merges.

### 2026-11-16 · Plan round 63

Children used 75 of 200. Three Builds are running, all from round 61: the targets carry-over (head
`6c0c684`, after its review fixes), the EXF-593 Build (head `f35b98b`, built, in its checks and review)
and the Reflect Build (still in its plan step). Main `6c73a00`, live `4e3eb7a`. No ticket was filed by me
at the last review; EXF-610 and EXF-611, filed by the template review, exist and are High.

**Started nothing.** The three Builds hold the Plan page, the register with the transactions, accounts
and payees files, and Reflect; main waits for EXF-593 before any Deploy; flows 2 and 9 wait for that
release. The plan declared in round 62 stands: the Deploy when EXF-593 merges, then EXF-462, the credit
engine after the carry-over, Auto-Assign with snooze after the carry-over.

Ticket writes: 0. Review cadence: Build 0, Deploy 5, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 63

Children used 75 of 200. Two Builds ended; one is running (EXF-593, in its final gate).

**Ended 1: the targets carry-over (`p_6abff514f4ad46e8a4d902a0aacef431`), merged as `4da55a7` (PR #34)**,
69 minutes, one card, about 8 dollars. EXF-508, EXF-514 and EXF-592 are Done.

- I approved at its card: gate on the current base (`6c73a00`), e2e 252 of 252 three times, changed
  specs ten times, no flake, no migration. I read the branch: nothing out of bounds, `packages/core`
  only gained `targetBar`, no skipped test.
- Its Reviewer found two real defects the first Build never had reviewed: **Assign added its amount
  twice on a quick second click**, and the form stuck after saving an unchanged target. Both fixed with
  tests that fail without the fix. Its Designer found twelve polish items in two passes (the calendar's
  month arrows drew nothing). All six points I asked for got tests (`today` validated on four operations
  and two tools; Assign lowers Ready to Assign by exactly its amount; no target across a plan switch;
  the tool description; a split's lines counting toward a target; the form at 1024 wide).
- Source: the Designer and the Tester stayed on the test plan's Plan page, in dark, left with Cancel,
  saved nothing. One extra Escape cleared a selection there and was re-made: harmless.
- On main: `routes/targets.ts`, `mcp/tools/targets.ts` (`set_category_target`, `delete_category_target`),
  `packages/schema/src/target-wording.ts`, `target-form.ts`, `apps/web/src/api/targets.ts`, `api/today.ts`
  (`localToday`), the Target card, form and calendar in `apps/web/src/plan/`, `e2e/targets-*.spec.ts`,
  a target case in `e2e/plan-switch.spec.ts`. **52 tools on main.**
- Left: a second copy of `localToday` in `apps/web/src/api/accounts.ts` (out of its bounds): give it to
  the next Build that holds that file.

**Ended 2: the Reflect Build (`p_9f66acebf3b14e939ad0a7e27b241cb2`), abandoned by my answer on its
`checks_stuck` card**, 49 minutes, about 8.60 dollars. Not its fault.

- Its design (`3d74855`) and code (`41f818e`, 39 files, +4381/-79) are finished and on its branch;
  `pnpm check` passed there three times.
- **The platform's `checks` step failed four times in 2 to 3 seconds: `/workspace/.exfab/bin/lib.sh: No
  such file or directory`.** The Build's box had lost the platform's own files (also `request.json`, the
  profile, and the Playwright browser, which the Implementer had to install again). The box was rebuilt
  mid-Thread. The Implementer was sent four times to "fix" a check it could not see.
- The card offered Retry or Abandon. A retry would have failed the same way, and every later code step
  needs the same files. Abandon and carry over: the third carry-over today.
- I tried the branch on the new main (`4da55a7`) in a throwaway worktree: **it merges cleanly, 39 files.**
- Evidence added to **EXF-611** (this is very likely what parked the first targets Build too), with
  three requests: a step that cannot find its helper files says so and restores them; no fix turn when
  the check command never ran; the stuck card shows the step's last lines.
- EXF-549, EXF-548, EXF-588 and EXF-591 stay In Progress; comment on EXF-549.
- **One thing for the carry-over to check:** the Implementer said its plan-switch spec for Net Worth also
  passes with the old placeholder put back (the page remounts on a plan change), so the spec does not
  prove the placeholder fix by itself.

**Running: EXF-593 with EXF-590 and EXF-587** (`p_563250b166984564b84cb2a32e722725`): head `0e3c71b`,
already rebased onto `4da55a7`, in `final_gate`. Its polish added: All Accounts with no open account
disables Add Transaction. When its card comes with base `4da55a7`: read the branch, approve, Deploy.

**Main is `4da55a7`; live is `4e3eb7a`.** Two merges wait (transfers and splits; targets), one migration.

**Learned:**
- A box can be rebuilt under a running Build. The signs: the Playwright browser gone again, `request.json`
  gone, a code step failing in seconds. When I see them in a transcript: do not wait for cards; the
  Thread cannot finish. Carry over.
- Carry-overs have now worked three times in 30 to 70 minutes and each time the later steps found real
  defects. The cost is one child each: 3 of my 75.

**Ticket writes:** 6 (three Done, three comments).

**Backlog:** 67 open feature tickets (30 done; 2 in progress: EXF-549, EXF-548). Gap: in progress
EXF-593 (High), EXF-587, EXF-588, EXF-590, EXF-591; open EXF-558, EXF-560, EXF-562, EXF-589 (Low); done
now EXF-592. Template: twenty-eight. Flow verdicts unchanged. Finished since each template's last
review: Build 2 (the carry-over, the abandoned Reflect Build), Deploy 5, Discover 2, Test user flow 5.

**Next plan:** (1) the Reflect carry-over from `origin/exfab/p_9f66acebf3b14e939ad0a7e27b241cb2` (head
`41f818e`); (2) the Plan page and `packages/core` are free now: Auto-Assign with snooze (EXF-519,
EXF-516) on the Plan page, and decide whether the credit engine (EXF-532, EXF-535) can run beside it
(it changes `packages/core` and reads `transactions`: by my new rule it must not run beside a Build that
changes what a transaction row means; EXF-593 does not, it only reads); (3) the Deploy the moment
EXF-593 merges.

### 2026-11-16 · Plan round 64

Children used 77 of 200. Two started now; three are running with the EXF-593 Build (in its final gate on
`4da55a7`). Main `4da55a7`, live `4e3eb7a`. No ticket was filed at the last review.

**Started:**

1. **Reflect, carried over** (`p_bce37969c15544d3aef56a825ebcb1d8`; EXF-549, the last part of EXF-548,
   EXF-588, EXF-591). Four Clerk jobs; the third merges
   `origin/exfab/p_9f66acebf3b14e939ad0a7e27b241cb2` and **stops if that branch's head is not `41f818e`**
   or the diff is much smaller than 39 files (the lesson from the plan-menu carry-over). Architect: no
   redesign, no source. Seven points for the Reviewer and Tester, first of them that the plan-switch
   spec must fail with the old placeholder or the design must say the remount is the guard.
2. **The Plan page's view chips, snooze and Auto-Assign** (`p_3b70b79de2c54d278a92cb5686f8ed74`;
   EXF-500, EXF-516, EXF-519), one Build because they interlock: Underfunded and Snoozed need snooze,
   Auto-Assign's Underfunded leaves snoozed targets out, plan-wide Auto-Assign follows the view.
   - One pure definition of each view, used by the grid, the subtotals, the panel, both month reads
     (`view=`) and plan-wide Auto-Assign.
   - Snooze per category and month, current month only by the owner's `today`; migration
     `20261116100700_...`; the engine's part in `packages/core/src/targets.ts` (the one shared-module
     change in flight).
   - Auto-Assign arithmetic as pure code reproducing every worked example; averages over at most the
     last 12 months (my decision; not observable); one atomic batch with a history row per changed
     category; buttons disabled until the month is read again.
   - Tools `preview_auto_assign`, `auto_assign`, `snooze_target`, `view` on `get_plan_month` and
     `get_month_summary`.
   - **Source: the strictest limit so far, because one click there moves money:** the test plan's Plan
     page; chips may be clicked; the Auto-Assign card and the Assign popover's Auto tab may be looked
     at and hovered, **never clicked**; no snooze switch, no Shift+Z, no typing.

**New lines in both briefs** (from the template review and from today's lost boxes): the source check
passing is not permission, and the Designer and Tester write the limits out in their first message; no
theme change even for a moment, no viewport override, no typing into the source; a deleted capture is
still reported; no test skipped to pass a gate; and "if the box loses its files, say so at once and do
not re-run checks by hand".

**How the three Builds fit:** disjoint. EXF-593 holds the register and the transactions, accounts and
payees files; the Reflect carry-over holds Reflect and the reports files (its plan-switch cases go in
its own spec, not in `e2e/plan-switch.spec.ts`); the Plan-page Build holds the Plan page, the months,
month-categories and targets files and `packages/core/src/targets.ts`.

**Not started, and why:**
- **The credit engine (EXF-532, EXF-535):** it changes `packages/core`, `services/months.ts` and the
  activity query in `repositories/transactions.ts`. The first two are held by the Plan-page Build, the
  third by EXF-593. It also changes what the month read means, so by my new rule it does not run beside
  a Build that computes from month reads. After the Plan-page Build.
- **EXF-462 (import from Plaid):** needs the transactions and accounts files; after EXF-593 merges.
- **No Deploy** until EXF-593 merges. No flow test until that release.

Ticket writes: 9 (three to In Progress, six comments). Review cadence: Build 2, Deploy 5, Discover 2,
Test user flow 5.

### 2026-11-16 · Review round 64

Children used 77 of 200. No child ended since the last review; three Builds are running. Main `4da55a7`,
live `4e3eb7a`.

**Running, as read now:**
- **EXF-593 with EXF-590 and EXF-587** (`p_563250b166984564b84cb2a32e722725`): in `gate_fix`, its second.
  - First gate failure: its own new spec (`e2e/payee-ready-to-assign.spec.ts`) pressed Tab before the
    payee list had drawn, under load 8 on 5 CPUs; fixed by waiting for the option (`0e3c71b`).
  - Second: after its rebase onto targets (`4da55a7`), **its new timestamp test failed on the two target
    tools that arrived with that merge**: exactly the seam I named in the briefs. It is fixing their date
    wording and adding them to the test's calls. That edit touches `mcp/tools/targets.ts`, which the
    Plan-page Build now holds: a one-line description change, accepted; the Plan-page Build rebases
    over it.
  - What it built, from its reports: `countsInBalance()` exported from `repositories/transactions.ts`
    and used by every sum, guard and count in the accounts repository; the Reviewer swapped the old
    file back and saw the split test fail (409), so the test proves the fix; 422 `account_closed` on
    every new row, move and new transfer link; Add Transaction and File Import disabled on a closed
    account and on All Accounts when no account is open; Undo and Redo drawn disabled until EXF-530;
    `last_inflow_to_ready_to_assign`; `mcp-timestamps.test.ts` calling all 51 tools, with a paragraph
    in `docs/conventions.md` that a new tool must be added to it.
  - **To check at its card:** its Implementer wrote that it skipped the per-reader verdict list and did
    not check `from-bank` and `link` against a closed account; the Architect's design doc says it has
    both (the list, and "left as they are: `from-bank` only creates open accounts, `link` already
    refuses a closed one"). Read the design doc's list on the branch before approving. Known and
    accepted: the closed-account check reads then writes (a race the design names).
  - **Source limits: two slips by its Designer, nothing saved.** It opened the edit row of a transaction
    in the test plan and left with Escape, and it looked at All Accounts; my brief named one place (a
    closed account's page) and said never to click a row. It did refuse to change the theme. Evidence
    for EXF-573, to post when the Build ends.
- **Reflect carry-over** (`p_bce37969c15544d3aef56a825ebcb1d8`): the Clerk's merge is in (`96ebe97`); in
  its plan step.
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): at intake.

**For the two new Builds, a consequence of EXF-593 merging first:** each new tool must be added to
`apps/worker/test/mcp-timestamps.test.ts` and its description must use the date and timestamp helpers
of `mcp/tool-text.ts`; their gates will fail until they do. Both briefs say a test for this is coming;
if a card shows that failure, it is this.

**Ticket writes:** none.

**Backlog:** 64 open feature tickets (30 done; 5 in progress: EXF-549, EXF-548, EXF-500, EXF-516,
EXF-519). Gap: in progress EXF-593 (High), EXF-587, EXF-588, EXF-590, EXF-591; open EXF-558, EXF-560,
EXF-562, EXF-589 (Low). Template: twenty-eight. Flow verdicts unchanged. Finished since each
template's last review: Build 2, Deploy 5, Discover 2, Test user flow 5.

**Next plan:** nothing to start unless EXF-593 has merged: then the Deploy and EXF-462.

### 2026-11-16 · Plan round 65

Children used 77 of 200. Three Builds are running: EXF-593 with EXF-590 and EXF-587 (in its second gate
fix, head `0e3c71b` on origin), the Reflect carry-over (planning, head `96ebe97`) and the Plan-page
Build for views, snooze and Auto-Assign (starting). Main `4da55a7`, live `4e3eb7a`. No ticket was filed
at the last review.

**Started nothing.** The three Builds hold the register with the transactions, accounts and payees
files, Reflect with the reports files, and the Plan page with the months and targets files and
`packages/core`. The plan declared in round 64 stands: the Deploy and EXF-462 when EXF-593 merges; the
credit engine after the Plan-page Build.

Ticket writes: 0. Review cadence: Build 2, Deploy 5, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 65

Children used 77 of 200. One Build ended; two are running.

**Ended: the EXF-593 Build (`p_563250b166984564b84cb2a32e722725`), merged as `3a98673` (PR #35)**,
about 85 minutes, one card, about 9 dollars. EXF-593, EXF-590 and EXF-587 are Done.

- I approved at its card: gate on the current base (`4da55a7`), e2e 259 of 259 three times, changed
  specs ten times, no flake, no migration. I read the branch: `countsInBalance()` in
  `repositories/transactions.ts` is used by every sum, guard and count of the accounts repository; the
  design doc's table lists every reader of `transactions` with a verdict (the Implementer's "skipped
  the list" meant only that it did not redo the Architect's); nothing out of bounds; no skipped test;
  `DATE` kept in `mcp/tool-text.ts` beside the new `timestamps()` and `dates()`.
- On main: 422 `account_closed`; `apps/web/src/register/openAccounts.ts` (`useOpenAccounts`);
  `last_inflow_to_ready_to_assign` on payees; `apps/worker/test/mcp-timestamps.test.ts` with the rule in
  `docs/conventions.md` that **every new tool adds its call there**; `e2e/account-guards.spec.ts`,
  `e2e/payee-ready-to-assign.spec.ts`.
- Two gate failures on the way, both fixed inside the Build: its own new spec pressed Tab before the
  payee list had drawn; and its timestamp test caught the two target tools that arrived with the
  targets merge (two one-line description edits in `mcp/tools/months.ts` and `targets.ts`).
- Known and accepted: the closed-account check reads then writes (a named race).
- **Source limits: its Designer went outside the named place** (All Accounts, and it opened a
  transaction's edit row and left with Escape; nothing saved). Evidence posted on EXF-573.

**Main is `3a98673`; live is `4e3eb7a`.** Three merges wait: transfers and splits (`6c73a00`, migration
`20261116100500_transfers_splits.sql`), targets (`4da55a7`), the account guards (`3a98673`). **Nothing
holds the release back now: Deploy at the next plan.** 52 tools on main.

**Running:**
- **Reflect carry-over** (`p_bce37969c15544d3aef56a825ebcb1d8`): 14 minutes in, at polish. Head
  `8e5de64`: carry-over notes, the `localToday` import, the plan-switch guards and a unit test of the
  placeholder option (my first point). Its base is `4da55a7`; its gate will rebase onto `3a98673`, and
  its two tools must join the timestamp test.
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): 12 minutes in, in its plan step.

**Free now:** the register, the transactions, accounts and payees files, the bank-connection files.
Next plan: the Deploy; EXF-462 (import from Plaid); and a look at what else the register can take
(scheduled transactions EXF-497, reconcile EXF-533, flags EXF-522, search EXF-528, the action bar
EXF-520) beside the import, by manifest.

**Ticket writes:** 6 (three Done, three comments).

**Backlog:** 64 open feature tickets (30 done; 5 in progress: EXF-549, EXF-548, EXF-500, EXF-516,
EXF-519). Gap: done now EXF-593, EXF-590, EXF-587; in progress EXF-588, EXF-591; open EXF-558, EXF-560,
EXF-562, EXF-589 (Low). Template: twenty-eight. Flow verdicts unchanged. Finished since each
template's last review: Build 3, Deploy 5, Discover 2, Test user flow 5.

### 2026-11-16 · Plan round 66

Children used 79 of 200. Two started now; four are running with the Reflect carry-over (at polish) and
the Plan-page Build (planning). Main `3a98673`, live `4e3eb7a`. No ticket was filed at the last review.

**Started:**

1. **Deploy of main `3a98673`** (`p_ad9c4b07f40441a9b48e8c57f69fdfb0`), `gated_commit` `74dfa4f` (I
   compared the two trees: identical), run prefix `ZZ-TEST D17`. Three merges, one migration
   (`20261116100500_transfers_splits.sql`; I confirmed with the pending script that it is the only one).
   Checks, with figures I worked out by hand in one sequence on one test plan (Ready to Assign after
   each step: 1,000,000; 1,000,000; 1,000,000; 1,050,000; 850,000; 810,000; 1,060,000): a transfer; a
   split counted once, with Net Worth 900,000; `adjust-balance` on an account holding a split; close,
   then 422 `account_closed` twice; a monthly target with 60,000 to go and `today=nope` refused; the
   payee's Ready to Assign flag; 53 tools expected (my "52" in round 63 was a miscount: 50 on live,
   plus `create_transfer`, plus the two target tools); in the browser a transfer and a split entered
   with a real mouse, the closed account's disabled button, the Target card with its Assign button,
   the payee filling Ready to Assign.
2. **EXF-462 with the Worker half of EXF-463** (`p_e051b02d89624ff7a3e8144e9f9710c2`): the import from
   Plaid. No file under `apps/web/`, so nobody opens the source; tests use the Plaid stand-in.
   - The cursor is saved only with what it produced; a repeat changes nothing; a Plaid error keeps it.
   - Never import: before the start date, more than 3 days before the latest reconciled row, a
     rejected or deleted `import_id` (tombstones).
   - Automatic matching built here (same account and amount, within 10 days); manual match and
     unmatch stay in EXF-464.
   - Approve, reject, the `needs` read, two counts on accounts; tools `sync_bank_connections`,
     `list_unapproved_transactions`, `approve_transactions`, `reject_transactions`.
   - The Durable Object serialises one sync per connection; the scheduled handler syncs what is older
     than 6 hours. **The cron stays daily**: it lives in `wrangler.jsonc`, which no parallel Build may
     touch. A later change (with EXF-558, when nothing else runs) makes it six-hourly.
   - Migration `20261116100800_...` (the Plan-page Build has `100700`).
   - **No query that sums or counts `transactions` changes meaning**: an unapproved import counts like
     any row. So it may run beside the Plan-page and Reflect Builds by my table rule.
   - It holds the Plaid client, the Durable Object, `scheduled.ts`, the bank-connection files and the
     transactions, accounts and payees files of the Worker.
   - A slip of mine in its brief: note 6 contains a question I answered in the same sentence ("with a
     tombstone? no: ..."). The decision is clear (no tombstone when the bank withdraws a row) and is
     restated in my comment on EXF-462.

**How the four fit:** disjoint files. All three Builds add tools, so all three edit the call list of
`apps/worker/test/mcp-timestamps.test.ts` and `docs/README.md`: a rebase conflict there is to be
resolved by keeping every entry (said in the import brief; the other two will meet it at their gates).

**Not started:** flow tests (after the Deploy: flows 2, 3, 9); the credit engine (after the Plan-page
Build); the plan import from a YNAB export (EXF-477: after Reflect's ZIP module and the Plaid import);
the register's own features (flags, search, action bar, reconcile, scheduled transactions): their
Worker files are held by the import Build.

Ticket writes: 5 (two to In Progress, three comments). Review cadence: Build 3, Deploy 5, Discover 2,
Test user flow 5.

### 2026-11-16 · Review round 66

Children used 79 of 200. Two children ended without result; two Builds are running. Main `3a98673`,
**live still `4e3eb7a`** (I read the health endpoint: unchanged).

**Ended 1: the Plaid import Build (`p_e051b02d89624ff7a3e8144e9f9710c2`), failed after 14 minutes. My
fault.**
- Its Architect wrote and committed the design and spec (`docs/plaid-import-design.md`,
  `docs/plaid-import-spec.md`; head `16c5a85`, on top of main).
- Its Implementer found `/workspace/.exfab/request.json` gone and answered blocked, **as the new line in
  my brief told it to** ("if the box loses its files, say so at once"). The platform has no route for
  "blocked" at the build step: the Thread ended as failed.
- The box was healthy: `bin`, `preflight.md`, `profile.json` and the Playwright browser were there. A
  missing `request.json` after intake is evidently normal (the Reflect Build's Implementer had noted the
  same and gone on). In the box that really was lost, `bin/lib.sh` was missing.
- **The lesson: I wrote a guard into three briefs from one observation, without knowing what a healthy
  box holds.** The guard goes. What stays is only: "if a platform script fails because one of its own
  files is missing, say exactly that". The same line is in the two Builds still running; both passed
  the point where it bit (the Reflect carry-over is past its build and polish steps, the Plan-page
  Build's Implementer is building), but a later step of either could still trip on it. If one ends as
  failed with "request.json is gone": carry it over, do not look for another cause.
- Cost: about 3.60 dollars and one child. The design is kept: next plan carries the branch over.
- **The design, read and accepted** (comment on EXF-462): writes first in repeat-safe batches, the
  cursor and status last; the duplicate check on live rows plus tombstones; **a full re-read of the
  feed when an account is linked after the connection already has a cursor** (a case I had missed: a
  later-linked account would never import); `sync_error_since` marks "came back"; the schedule skips
  `login_required` and `broken`.

**Ended 2: the Deploy of `3a98673` (`p_ad9c4b07f40441a9b48e8c57f69fdfb0`), cancelled by me.** The
platform parked it at its first step (`intake`, `infra_failed`): zero tokens, no transcript, no gate, no
release, a card that did not reach me. Nothing changed on live. Evidence on EXF-611 (a park is not
specific to the Build template's checks step).

**Three children lost to the platform's boxes in two hours** (the first targets Build, the first Reflect
Build, this Deploy) and one to my own guard. The carry-overs and restarts cost four children so far.

**Running:**
- **Reflect carry-over** (`p_bce37969c15544d3aef56a825ebcb1d8`): head `bfd9487`: the polish list
  applied, the tool descriptions use `dates()`, its two tools added to the timestamp test (the seam,
  handled before its gate).
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): designed (`e36d5c5`), Worker side built
  and green (996 tests), web side in progress. **Its manifest has arrived; checked against the Reflect
  carry-over and the import design: disjoint** (it holds the months, targets and auto-assign files,
  `packages/core/src/targets.ts`, `apps/web/src/plan/**`, `e2e/rta.spec.ts`; migration
  `20261116100700_target_snoozes.sql`). One file beyond my list, `packages/schema/src/ui-state.ts` (a
  key for the one-time keyboard tip): fine.
  - **Its Architect asks me to confirm one departure, and I do:** the source shows "Underfunded" at
    $0.00 plan-wide and for a multi-selection, and hides it only for a single category with nothing
    underfunded; the ticket said hidden whenever $0.00. The source wins. Reduce Overfunding is hidden
    at $0.00 everywhere.
  - Its Architect wrote the source limits out before touching the source (the new line worked), and
    its sub-agent stayed inside them: chips clicked, buttons hovered only, nothing typed, no theme or
    viewport change, 31 captures taken and reported with the deleted ones.

**Ticket writes:** 2 (comments on EXF-462 and EXF-611).

**Backlog:** 64 open feature tickets (30 done; 7 in progress: EXF-549, 548, 500, 516, 519, 462, 463).
Gap: in progress EXF-588, EXF-591; open EXF-558, EXF-560, EXF-562, EXF-589 (Low). Template:
twenty-eight. Flow verdicts unchanged. Finished since each template's last review: Build 4, Deploy 6
(the cancelled one counts), Discover 2, Test user flow 5.

**Next plan:** (1) the Deploy of `3a98673` again; (2) the import carried over from
`origin/exfab/p_e051b02d89624ff7a3e8144e9f9710c2` (head `16c5a85`), without the guard.

### 2026-11-16 · Plan round 67

Children used 81 of 200. Two started now; four are running with the Reflect carry-over and the
Plan-page Build. Main `3a98673`, live `4e3eb7a`. No ticket was filed at the last review.

**Started:**

1. **Deploy of main `3a98673`, second attempt** (`p_3e2eeca31173462c8bb9ef7b3bcc1676`), `gated_commit`
   `74dfa4f`, run prefix `ZZ-TEST D18`. The same brief as round 66, with three changes: it says the first
   attempt did nothing; it stops after the gate if main has moved (a Build may merge within the hour,
   and I do not want an ungated tree released by a rule I wrote loosely last time); and "if one of the
   Lead's figures does not match, do not adjust the check: report the figure, the step and the answer".
2. **The Plaid import, carried over** (`p_c81492d33faf41b1bc8a985e48688b83`; EXF-462 with the API half
   of EXF-463). Four Clerk jobs; the third merges
   `origin/exfab/p_e051b02d89624ff7a3e8144e9f9710c2` (head `16c5a85`: two documents and an index line)
   and stops if the head differs. The Architect does not redesign; the code is written here.
   - **The guard is replaced by its opposite:** "Do not stop because a file under `/workspace/.exfab/`
     is missing; `request.json` is normally gone after the Clerk's step."
   - Eight points accepted from the design, seven sharpened by me. The ones that matter most: a full
     re-read of the feed must not bring back what the owner rejected nor change what the owner
     approved, edited or matched (with a test); a sync never changes a reconciled row; a run is bounded
     and reports `has_more`; no token in the history or in a log line (a test searches for it).
   - Holds the Plaid client, the Durable Object, `scheduled.ts`, the bank-connection files and the
     transactions, accounts and payees files of the Worker; migration `20261116100800_plaid_import.sql`.

**How the four fit:** disjoint files (checked against the Plan-page Build's manifest, which arrived
last round). All three Builds edit the timestamp test's call list, the coverage files they own and the
docs index; the import brief says to keep every entry at a rebase.

**If the Reflect carry-over or the Plan-page Build ends as failed with "request.json is gone":** it is
my old guard; carry it over, do not look further.

Ticket writes: 1 (a comment on EXF-462). Review cadence: Build 4, Deploy 6, Discover 2, Test user
flow 5.

### 2026-11-16 · Review round 67

Children used 81 of 200. One child ended: the second Deploy, refused in 72 seconds. Three Builds are
running. Main `3a98673`, **live still `4e3eb7a`** (health read again: unchanged).

**Ended: the Deploy of `3a98673`, second attempt (`p_3e2eeca31173462c8bb9ef7b3bcc1676`), failed.
Nothing shipped.**
- Its intake step wrote `/workspace/.exfab/deploy.env` and read it back (transcript seq 1 and 2, 09:22:21).
  Seventeen seconds later the deploy code step said `DEPLOY_REFUSED: /workspace/.exfab/deploy.env is
  missing: the Intake step writes it` (seq 8). The next agent step could read the code step's
  `summary.txt` in the same directory, but found no `profile.txt`.
- So **a file an agent step writes under `/workspace/.exfab/` is not there for the code step that
  follows.** This is the same thing as the vanished `request.json` in the Builds (round 66), and it is
  not my brief and not the app.
- **What I think happened, from the evidence only:** the platform's box layout changed between about
  07:45 and 08:30 UTC today. Before it, `.exfab` held `profile.md` and agent-written files stayed (the
  Deploy at 06:54 worked; a Clerk's `request.json` was still there at 07:44). After it, `.exfab` holds
  `profile.json` and `preflight.md`, the first Reflect Build's `bin/lib.sh` was gone under a script
  that still wanted it, and agent-written files do not persist. Builds started after the change have
  so far run their plan, build, polish and review steps normally (they do not depend on a file an
  agent wrote there); whether their gates work I will know when the Reflect carry-over reaches its
  gate. **The Deploy template does depend on such a file, so no Deploy can run until this is fixed.**
- I do not restart it blindly: each try costs a child. One more try is worth it after a Build's gate
  has shown the boxes work again, or at the latest before the check-in at round 70.

**Consequences:**
- Main stays three merges ahead of live (transfers and splits, targets, account guards), and will get
  further ahead (Reflect, the Plan-page Build, the import). No flow test until a release.
- **The owner's live app is safe**: nothing was half-released; both failed Deploys stopped before the
  gate or at it.
- Filing an Urgent template ticket now, since this is a defect of the Deploy template on the present
  boxes and the ticket is the channel for that. The check-in at round 70 must lead with it.

**Running:** the Reflect carry-over (in review fixes after 37 minutes), the Plan-page Build (building
its web side, 35 minutes in), the import carry-over (at intake).

**Ticket writes:** none (one ticket filed through this review).

**Backlog:** 64 open feature tickets (30 done; 7 in progress). Gap: in progress EXF-588, EXF-591; open
EXF-558, EXF-560, EXF-562, EXF-589 (Low). Template: twenty-eight, plus the one filed now. Flow
verdicts unchanged. Finished since each template's last review: Build 4, Deploy 7 (two cancelled or
refused without running), Discover 2, Test user flow 5.

**Next plan:** set the new ticket Urgent; start nothing new unless a gate has passed on the new boxes;
then one more Deploy.

### 2026-11-16 · Plan round 68

Children used 81 of 200. Three Builds are running: the Reflect carry-over (in its checks after review
fixes), the Plan-page Build (building its web side) and the import carry-over (in its plan step). Main
`3a98673`, live `4e3eb7a`.

- The ticket filed at the last review exists: **EXF-612** (a file an agent step writes under
  `/workspace/.exfab/` is gone for the next code step, so every Deploy is refused). Set to **Urgent**.
- **Started nothing.** No third Deploy yet: the two failures were the platform's, a third try costs a
  child, and nothing tells me the boxes have changed since 09:23. The Reflect carry-over is the probe:
  its code steps (checks) run, and its final gate comes within the half hour. **When a gate has passed
  on today's boxes, or at round 70 at the latest, one more Deploy.**
- No other Build can start: the three hold Reflect, the Plan page with `packages/core`, and the
  register's Worker files.
- The plan declared in round 67 stands (flows 2, 3 and 9 after a release; the credit engine after the
  Plan-page Build; the plan import from a YNAB export after Reflect and the Plaid import).

Ticket writes: 1 (EXF-612 priority). Review cadence: Build 4, Deploy 7, Discover 2, Test user flow 5.

### 2026-11-16 · Review round 68

Children used 81 of 200. One Build ended; two are running.

**Ended: the Reflect carry-over (`p_bce37969c15544d3aef56a825ebcb1d8`), merged as `e2bcd35` (PR #37)**,
about 80 minutes, one card, about 4.50 dollars. EXF-549, EXF-548, EXF-588 and EXF-591 are Done.

- I approved at its card: gate on the current base (`3a98673`), e2e 276 of 276 three times, changed
  specs ten times, no flake, no migration. **So gates run on today's boxes.** I read `spendingRows` in
  `repositories/reports.ts`: on-plan accounts (closed included), lines counted and parents never, no
  on-plan transfers, no Ready to Assign inflows, no Starting Balances. Nothing out of bounds, no skip.
- Its Reviewer found that the carry-over tasks I had asked for were written into the docs but not
  into the code (the placeholder rule's test, the `localToday` import); both done on the second pass,
  with a counter-check. `keepPreviousInPlan` now lives in `packages/schema/src/placeholder.ts`.
- One gate failure on the way: its own spec measured a popover list before the month had loaded.
- **Gap in what I asked:** my point 4 (a closed account in a past month) got an automated test for Net
  Worth only; for Spending Breakdown it was driven by hand. The query has no closed filter, so the
  behaviour is right; a test should come with the next Reflect Build (EXF-550 or EXF-552).
- **Source limits:** the Tester wrote the limits out first and kept them. **The Designer overrode the
  source tab's viewport several times** to find a breakpoint, although the brief forbade it in those
  words, and said so itself. Evidence on EXF-573. Restating the limits works for the steps that do it;
  the Designer does not.
- On main: routes `reports/spending-breakdown`, its export, `reports/transactions`; tools
  `get_spending_breakdown`, `list_report_transactions`; `packages/schema/src/spending-breakdown.ts`,
  `zip.ts`, `reflect-format.ts`, `placeholder.ts`; the report's components in `apps/web/src/reflect/`.
  **55 tools on main.**

**Main is `e2bcd35`; live is `4e3eb7a`.** Four merges wait (transfers and splits; targets; account
guards; Reflect), one migration. The tree of `e2bcd35` equals the gated head `a003430` (compared).
**My condition for one more Deploy is met** (a gate passed on today's boxes): next plan. If it is
refused again for the missing `deploy.env`, no further try until EXF-612 moves or the person answers.

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): head `d917a3c`, in review fixes ("fixed-size
  guards for Auto-Assign batches, snooze writes guarded in one batch").
- **Import carry-over** (`p_c81492d33faf41b1bc8a985e48688b83`): head `77afbf6`, already in review fixes
  after 40 minutes ("payee insert guarded, Starting Balance not a match, reject in one batch").

**Free now:** Reflect and the reports files. Candidates beside the two running Builds: the next reports
(EXF-550 Spending Trends, EXF-552 Income v Expense: same files, one Build), and the plan import from a
YNAB export (EXF-477) now that the ZIP module is on main; the latter also needs the transactions files
the import Build holds. Decide at the plan.

**Ticket writes:** 7 (four Done, three comments).

**Backlog:** 62 open feature tickets (32 done; 5 in progress: EXF-500, 516, 519, 462, 463). Gap: open
EXF-558, EXF-560, EXF-562, EXF-589 (Low); done now EXF-588, EXF-591. Template: twenty-nine (EXF-573
and EXF-612 Urgent). Flow verdicts unchanged. Finished since each template's last review: Build 5,
Deploy 7, Discover 2, Test user flow 5.

### 2026-11-16 · Plan round 69

Children used 83 of 200. Two started now; four are running with the Plan-page Build and the import
carry-over (both in review fixes). Main `e2bcd35`, live `4e3eb7a`. No ticket was filed at the last
review.

**Started:**

1. **Deploy of main `e2bcd35`, third attempt** (`p_a6a99ac78c284ea7bef1a14072609fe8`), `gated_commit`
   `a003430` (trees compared: identical), run prefix `ZZ-TEST D19`. Four merges, one migration (the
   pending script, read-only, lists only `20261116100500_transfers_splits.sql`). The brief of round 67
   plus: the Spending Breakdown figures for the same test plan (total 100,000; Food 60,000 at 60
   percent, Fun 40,000 at 40 percent; one drill-down row of -60,000; the ZIP's two entries listed with
   Python), 55 tools, and the report's screen checked first in the browser. It says: **if the deploy
   step again reports `deploy.env` missing, report that line and stop.** My condition for this try was
   met: a Build's gate passed on today's boxes. If it fails the same way, no fourth try before
   EXF-612 moves.
2. **Reflect: Spending Trends and Income v Expense** (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`; EXF-550,
   EXF-552), one Build: same files, same frame, same spending query.
   - Spending comes from `spendingRows` alone; income is written once beside it (rows sent to Ready to
     Assign, by payee; never a Starting Balance; adjustments under their own row).
   - Pure arithmetic reproducing both tickets' figures; the chart is the app's own SVG; the ZIP reuses
     `zip.ts`; the Income v Expense export is one CSV without BOM.
   - The drill-down read gains `income_payee_id`, `income=true`, `expenses=true`.
   - Tools `get_spending_trends`, `get_income_expense`, with the sign of every figure stated.
   - The test owed from the last Reflect Build (a closed account in Spending Breakdown).
   - **Source limits, tightened once more for the Designer:** "never override the viewport, not even to
     find a breakpoint and not even if you restore it: a breakpoint is read from the stylesheet's media
     queries or written not compared", and "a polish item that cannot be compared inside these limits
     is written as not compared; the limits are never widened to compare it".
   - The guard about missing files is the corrected one ("do not stop because a file is missing").
   - Holds `apps/web/src/reflect/**`, `api/reports.ts` and the reports files of the Worker and schema.

**How the four fit:** disjoint files. The Reflect Build is told what the import Build adds to
`transactions` (new columns, unapproved rows that count like any row) and that its queries need no
condition on them. Three Builds now add calls to the timestamp test; each brief says to keep every
entry at a rebase.

**Not started:** the credit engine (after the Plan-page Build); the plan import from a YNAB export
(after the Plaid import frees the transactions files); flow tests (after a release).

Ticket writes: 4 (two to In Progress, two comments). Review cadence: Build 5, Deploy 7, Discover 2,
Test user flow 5. **Round 70's review is a check-in.**

### 2026-11-16 · Review round 69

Children used 83 of 200. One child ended: the Deploy, and this time it shipped. Three Builds are running.

**Ended: the Deploy of `e2bcd35`, third attempt (`p_a6a99ac78c284ea7bef1a14072609fe8`), passed.**
**Live is https://budget.doxen.dev at `e2bcd35`**, equal to main (I read the health endpoint myself).

- Gate: checks 124 s, browser run skipped (tree equal to the gated `a003430`). Release 31 s: the D1 Time
  Travel bookmark was taken (the verifier was not given its value), **migration
  `20261116100500_transfers_splits.sql` applied, none pending**, smoke ok. Health and `/mcp` without
  credentials: 401.
- **Every figure I worked out by hand matched**, in order, on one test plan: Ready to Assign 1,000,000;
  after the transfer 1,000,000; after the split 1,000,000 with the account at 700,000 and Net Worth
  900,000; after `adjust-balance` on the account holding a split 1,050,000; after closing 850,000, then
  422 `account_closed` twice; after assigning 810,000 with the target's 60,000 to go (status
  `underfunded`) and `today=nope` refused; after the inflow 1,060,000 with the payee's flag set;
  Spending Breakdown total 100,000 with 60 and 40 percent, one drill-down row, a ZIP with the two CSVs.
- MCP: **55 tools**, as expected; `create_transfer` to a closed account gives a readable error.
- Browser, real mouse, at 1440 and 1024: the Spending Breakdown report with its popover and Groups
  toggle; a transfer and a split entered in the register (a split that does not add up opens the
  "Something Doesn't Add Up" dialog); the closed account's disabled Add Transaction; the payee filling
  "Inflow: Ready to Assign"; Edit Account on an account with splits; the Target card, whose Assign
  button moved Assigned to $100.00 and Ready to Assign down by $60.00 with no reload. No failed
  request, no console error. Its first browser scripts had faults of their own; it re-ran and said
  which run each statement came from, as asked.
- Two things it noted, both fine: the transfer create answers with one transaction (the side asked
  for) that points at the other; and on a category that is both overspent and has a target the grid
  row shows the overspent text, not the target's.
- Cleanup: `purge 'ZZ-TEST D19'` printed `deleted 1 remaining 0`. One plan that is not a test plan.
  No Plaid call.

**So the Deploy fault of rounds 66 and 67 is not constant.** Evidence added to EXF-612, which stays
Urgent: nobody has said what changed, and `request.json` still vanishes in Builds.

**What is live now that was not at the last check-in:** transfers between accounts, split
transactions, targets (create, edit, delete, display, Assign), the account balance fixes and closed
accounts refusing new transactions, the payee remembering Ready to Assign, timestamp formats in tool
descriptions, and the Reflect Spending Breakdown report with drill-down and export.

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): head `6662c05`, in polish.
- **Import carry-over** (`p_c81492d33faf41b1bc8a985e48688b83`): head `7f94354`. Its review loop ran out
  after three rounds, each with a real and narrower defect in how a sync creates a payee, each fixed.
  At its card I chose Proceed after reading the last fix myself (a fresh id for every payee insert,
  the history row under the same id and guard, the transaction's history copy from the same name
  lookup). **At its approval card: read the whole sync again; ask the Tester's result on whether the
  new race test fails on the old code.**
- **Reflect Build for two reports** (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`): started, planning.

**Ticket writes:** 1 (the comment on EXF-612).

**Backlog:** 62 open feature tickets (32 done; 7 in progress: EXF-500, 516, 519, 462, 463, 550, 552).
Gap: open EXF-558, EXF-560, EXF-562, EXF-589 (Low). Template: twenty-nine (EXF-573 and EXF-612
Urgent). Flow verdicts are now stale for 1, 2, 8 and 9 (new features live). Finished since each
template's last review: Build 5, Deploy 8 (three of them never ran), Discover 2, Test user flow 5.

**Next plan:** flow tests on live `e2bcd35`: flow 2 in full (transfers, splits, closed accounts), flow 3
as far as built (targets; Auto-Assign is not live yet), flow 8 (Spending Breakdown), flow 9 again.
**Round 70's review is a check-in.**

### 2026-11-16 · Plan round 70

Children used 84 of 200. One started now; four are running with the Plan-page Build (in polish), the
import carry-over (at acceptance) and the two-report Reflect Build (planning). Main and live are both
`e2bcd35`. No ticket was filed at the last review.

**Started: flow tests on live `e2bcd35`** (`p_eabc968ad4f743d1834cb9c99a7e924e`), one child, run prefix
`ZZ-TEST F70`:
- **Flow 2, second run, now in full** (previous `p_01e3392182944b22b75a9e0234f7aa17`, `new_gaps`,
  its gap EXF-590 fixed and live): outflow with arithmetic; the inflow whose payee now brings Ready to
  Assign back; a split with a remainder refused and then saved; a transfer between on-plan accounts
  (Ready to Assign unchanged); a transfer to a tracking account with a category; editing and deleting
  a transfer; overspend and cover; a closed account; All Accounts; the API and MCP against the screen.
  Figures worked out by hand and checked twice: Working 982.66, 1,232.66, 1,132.66, 932.66, 902.66,
  952.66, 1,102.66; Dining activity -77.34 and Available -27.34; Hobbies 252.66 after the cover. The
  brief says its own arithmetic decides if mine is off.
- **Flow 9, third run** (previous `p_b3b54aec56044df2a755ef5d984061f4`, `new_gaps`, its gap EXF-586
  fixed and live): two plans that differ in everything visible; switching through the submenu
  (only its own rows; no capture with the menu open); the moment of the switch with the next read
  held back 2 seconds, in the Plan page, the registers and both Reflect reports; wrong pairings by
  address, API and MCP; pickers; deleting one plan leaves the other.
- No source app at all. One numbers-only count of plans at the end.

**Not started, and why:**
- **Flow 3** (targets and Auto-Assign) and **flow 8** (Reflect): each would need a second run within
  the hour, when the Plan-page Build and the Reflect Build go live. One run each, after that release.
- **Flow 5** with the import: after the import is live.
- No new Build: the three running hold the Plan page with `packages/core`, the register's Worker
  files, and Reflect.
- No Deploy: main equals live.

Ticket writes: 0. Review cadence: Build 5, Deploy 8, Discover 2, Test user flow 5. **This round's
review is a check-in.**

### 2026-11-16 · Review round 70 (check-in)

Children used 84 of 200. One Build ended; three children are running (the Plan-page Build in its final
gate, the two-report Reflect Build, the flow tests for flows 2 and 9).

**Ended: the Plaid import carry-over (`p_c81492d33faf41b1bc8a985e48688b83`), merged as `9e77748`
(PR #39)**, about 65 minutes, two cards (Proceed after the review loop ran out; Approve), about 10
dollars. EXF-462 is Done; EXF-463 is back in Backlog for its screens.

- I approved after reading the sync on the branch: `services/plaid-sync.ts` (723 lines), the paging in
  `plaid/transactions.ts`, the Durable Object, `scheduled.ts`, `services/batch-groups.ts` and the
  migration. Gate on the current base (`e2bcd35`), e2e 276 of 276 three times.
- What I confirmed in the code: writes first in groups that never straddle a batch, cursor and status
  last under a guard on the old cursor ("sync conflict" if another run moved it); `notKnown` guard plus
  the unique index `transactions_budget_import`; pending entries dropped in `netChanges`; match and
  fallback insert in one group; reconciled rows take the description only; `fresh` re-read when the
  link set is not covered; no pages and no cursor change when no open linked account; only
  `/transactions/sync` and `/accounts/get`; logs name a connection id only.
- **Not read by me:** the approve and reject service code (covered by its tests and three reviews).
- **A risk I found and file now as a gap ticket (High):** one run makes, besides its batches, a read
  per imported row that has a remembered category (`namesOf`) and two reads per match, and four per
  account. A page is 500 entries. Cloudflare limits the database queries of one invocation (far lower
  on a free plan than on a paid one, and I do not know which the owner has). A run that hits the limit
  fails before the cursor is saved and would repeat the same work and fail again. The tests cannot
  see this: the test runtime has no such limit. **Flow 5 on live must import the Sandbox's
  transactions and report the count and whether the run completed.**
- On main: migration `20261116100800_plaid_import.sql`; `packages/schema/src/plaid-import.ts`;
  `repositories/imports.ts`; tools `sync_bank_connections`, `list_unapproved_transactions`,
  `approve_transactions`, `reject_transactions`. **59 tools on main.**

**Main is `9e77748`; live is `e2bcd35`** (one merge ahead: the import, one migration).

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): in `final_gate` after 100 minutes and about
  14 dollars; head on origin `6662c05`. Its gate rebases onto `9e77748`.
- **Reflect: two reports** (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`): building; no commit on origin yet.
- **Flows 2 and 9** (`p_eabc968ad4f743d1834cb9c99a7e924e`): walking, six minutes in.

**Check-in sent** (round 70). Its points: what went live since round 60 (transfers, splits, targets,
account fixes, Spending Breakdown; 55 tools); the import merged and waiting for a release and a Sandbox
proof; the platform's lost boxes (five children lost, EXF-612 and EXF-611) and my own wrong guard; the
source-limit slips without private data; **the bank screens decision, which now stands between the
owner and using the import from the interface**; the child budget (84 used, about 70 more expected);
the unchanged requests.

**Ticket writes:** 4 (one Done, one back to Backlog, two comments). One gap ticket filed through this
review.

**Backlog:** 61 open feature tickets (33 done; 5 in progress: EXF-500, 516, 519, 550, 552). Gap: open
EXF-558, EXF-560, EXF-562, EXF-589 (Low) and the one filed now. Template: twenty-nine (EXF-573 and
EXF-612 Urgent). Flow verdicts: 1 `parity_known_gaps`, 2 `new_gaps` (rerun running), 5
`parity_known_gaps`, 8 `new_gaps` (its gap fixed; rerun after the Reflect Build), 9 `new_gaps` (rerun
running), 10 `new_gaps` (its gap EXF-587 fixed; rerun owed), 11 `parity`; 3, 4, 6, 7 not run. Finished
since each template's last review: Build 6, Deploy 8, Discover 2, Test user flow 5.

**Next plan:** set the new ticket's priority; when the Plan-page Build merges: Deploy (import and Plan
page, two migrations), then flows 3 and 5 (and 10 again); the credit engine on the freed
`packages/core`; a Build for the per-run query count beside it (the import's files are free).

### 2026-11-16 · Plan round 71

Children used 85 of 200. One started now; four are running with the Plan-page Build (in its final gate,
head `2ed8b72`), the two-report Reflect Build (designed, head `c70ce8f`) and the flow tests for flows 2
and 9. Main `9e77748`, live `e2bcd35`. The person's note at the check-in: not provided.

- The ticket filed at the last review exists: **EXF-613** (bank sync: queries per run), set to High.
- **Started the Build for EXF-613** (`p_fc9382ad6b6d49d5b8403c1b52472548`): Worker only, no source app.
  The Architect must first state Cloudflare's limits with a source for each and derive the budget;
  names read once per plan; a position from which the next run continues; a failed run visible on the
  connection; nothing about what is imported may change; the counting test must fail on `9e77748`.
  It holds the sync service, the paging, the imports and bank-connection repositories and services,
  the Durable Object. Migration name if needed: `20261116100900_...`.
- **No Deploy yet:** main is one merge ahead (the import). The Plan-page Build is in its final gate;
  one Deploy ships both and saves a child. If its card is not in by the next plan, deploy the import
  alone: flow 5 against the Sandbox is the evidence EXF-613 asks for.
- **Not started:** the credit engine (needs `packages/core` and the months files, held by the Plan-page
  Build until it merges); the plan import from a YNAB export (EXF-477): its files are free now, its
  ticket is unread; read it and start it next round.

**How the three Builds fit:** disjoint. EXF-613 holds the sync's files; the Plan-page Build the Plan
page, months, targets and `packages/core/src/targets.ts`; the Reflect Build Reflect and the reports.

Ticket writes: 2 (EXF-613 priority and state, one comment). Review cadence: Build 6, Deploy 8,
Discover 2, Test user flow 5.

### 2026-11-16 · Review round 71

Children used 85 of 200. One child ended: the flow tests. Three Builds are running. Main `9e77748`,
live `e2bcd35`.

**Ended: flows 2 and 9 on live `e2bcd35` (`p_eabc968ad4f743d1834cb9c99a7e924e`)**, about 25 minutes. It
opened nothing in the source, clicked only its own rows in the Open Plan submenu, took no capture with
the menu open, and purged its plans (`deleted 2 remaining 0`; one plan that is not a test plan).

- **Flow 2, second run, in full: `parity_known_gaps`.** All twelve steps passed and **every figure I had
  worked out matched its own arithmetic** (Working 982.66, 1,232.66, 1,132.66, 932.66, 902.66, 952.66,
  1,102.66; Dining -77.34 and -27.34; Hobbies 252.66 after the cover).
  - The payee's remembered Ready to Assign works (EXF-590 confirmed on live).
  - A split with a remainder opens "Something Doesn't Add Up" with Auto-Distribute, Update Total and
    Adjust Manually; a saved split is one parent row with indented lines and reopens with both.
  - A transfer between on-plan accounts needs no category and leaves Ready to Assign alone; its jump
    button lands on the other side with that row selected. A transfer to a tracking account takes a
    category.
  - The API and MCP agree with the screen (six rows summing to the Working balance; the split's lines;
    `create_transfer`; the payee flag; the month's figures).
  - Known, not gaps: no delete control in the register (EXF-520), Undo and Redo, File Import, Manage
    Payees.
  - Two small things it met and did not file, kept here: a transfer created through MCP to a tracking
    account with no category shows "This needs a category" (right); and **clearing a row's category in
    the edit row is not possible** (deleting the text and leaving the field puts the old category
    back). The source lets a category be cleared only by choosing another, as far as the tickets say;
    look at it when the register's screens for imports (EXF-463) are built, where "uncategorized"
    matters.
- **Flow 9, third run: `new_gaps`.** Everything about keeping two plans apart passed: the switch through
  the submenu at both sizes; the switch with the next month held back 2 seconds (an empty grid and the
  new plan's own name and account, nothing of the old plan after the click's own frame); the five
  addresses by URL including both Reflect reports; wrong pairings by address (redirect to the plan's
  own accounts), API (404 and 422) and MCP (readable errors); the pickers; deleting one plan.
  **EXF-586 is confirmed fixed on live.**
  - **One new gap, EXF-614 (triaged Low):** at a deleted plan's address the main area rightly says
    "Plan not found", but the sidebar behaves as if an empty plan were open and offers Add Account,
    whose dialog then gets a 404. A shell fix; rides with the next Build that holds the shell.

**Flow verdicts now:** 1 `parity_known_gaps`, 2 `parity_known_gaps`, 5 `parity_known_gaps` (rerun with
the import owed), 8 `new_gaps` (gap fixed; rerun after the Reflect Build), 9 `new_gaps` (EXF-614),
10 `new_gaps` (gap fixed; rerun owed), 11 `parity`; 3, 4, 6, 7 not run.

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): still in its final gate (head `2ed8b72`).
- **Reflect: two reports** (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`): designed (`c70ce8f`), building.
- **EXF-613** (`p_fc9382ad6b6d49d5b8403c1b52472548`): started, planning.

**Ticket writes:** 2 (EXF-614 priority and comment).

**Backlog:** 61 open feature tickets (33 done; 5 in progress). Gap: in progress EXF-613 (High); open
EXF-558, EXF-560, EXF-562, EXF-589, EXF-614 (Low). Template: twenty-nine. Finished since each
template's last review: Build 6, Deploy 8, Discover 2, Test user flow 6.

**Next plan:** if the Plan-page Build has not merged, deploy the import alone and run flow 5 against the
Sandbox; read EXF-477 and start it.

### 2026-11-16 · Plan round 72

Children used 86 of 200. One started now; four are running with the Plan-page Build (still in its final
gate after 35 minutes there, 41 visits), the two-report Reflect Build and the EXF-613 Build. Main
`9e77748`, live `e2bcd35`. No ticket was filed by me at the last review; EXF-614 (from the flow test)
is triaged Low.

**Started: the register's selection, action bar and flags** (`p_7bb9ae1dcb8e4106b60f405a6002857e`;
EXF-520, EXF-522).
- Why now: flow 2 showed the register has no way to delete a transaction; the register's web files and
  the transactions files of the Worker are free since the import merged.
- Every bulk action goes through the single action's rules (both sides of a transfer, a split's lines,
  a tombstone for an imported row; a duplicate is a hand-entered row without import fields). Approve
  and Reject in the bar are built (their API is on main); Match, Unmatch and Make Repeating are drawn
  disabled. Flags: a nullable `flag_color`, migration `20261116101000_...`; names and "Edit Flags" stay
  with EXF-480.
- A chore in a free file: the second copy of `localToday` in `apps/web/src/api/accounts.ts`.
- **Source: the strictest wording yet, because every control there changes data:** the test plan's All
  Accounts register; rows may be ticked, the More menu and the flag menu opened and the Memo dialog
  left with Cancel; no action clicked, no shortcut key pressed, no double-click, no typing.
- Holds `apps/web/src/register/**`, `api/transactions.ts`, the transactions services, repository,
  routes and tools. Disjoint from EXF-613 (the sync's own files; both briefs name the other's), the
  Plan-page Build and the Reflect Build.

**EXF-477 (plan import from a YNAB export) read and not started:** it needs credit card payment
categories, scheduled transactions and flags to bring a real plan over whole, and its format comes
from EXF-476. Blocked by EXF-476, EXF-532 and EXF-497 now.

**No Deploy this round, once more:** the Plan-page Build is still in its gate. **Decision for the next
plan, fixed now so I do not drift: if its card has not come by then, deploy `9e77748` alone** and run
flow 5 against the Sandbox; EXF-613's Build wants that evidence.

**Migration names in flight:** `100700` target snoozes (Plan-page Build), `100900` offered to EXF-613 and
to the Reflect Build (neither expects one; if both take it, the second renames at its rebase),
`101000` flags.

Ticket writes: 6 (two to In Progress, one blocking link set, three comments). Review cadence: Build 6,
Deploy 8, Discover 2, Test user flow 6.

### 2026-11-16 · Review round 72

Children used 86 of 200. One Build ended; three are running.

**Ended: the EXF-613 Build (`p_fc9382ad6b6d49d5b8403c1b52472548`), merged as `c9e9d1c` (PR #41)**, about
55 minutes, one card. EXF-613 is Done.

- I approved after reading its design and the budget code: gate on the current base (`9e77748`), e2e
  276 of 276 three times, one additive migration (`20261116100900_sync_failed_at.sql`).
- **The limits it found, with sources:** 50 D1 queries per invocation on Cloudflare's free plan (1,000
  paid), a `db.batch` counting as one. It assumes the free plan. My guess in the ticket was right in
  kind and worse in size: by its count the merged import made about 1,070 calls for 500 entries, over
  the paid limit too.
- As built: a budget of 45 calls per run; units of up to 90 entries; a stopped run saves **no** cursor
  and reports `has_more` (the next run re-reads and the written entries change nothing); names and
  match details read in one batch; a failed run sets `delayed` and `sync_failed_at`; the scheduled
  handler goes round-robin with caps (5 runs per connection, 40 per invocation).
- Open until flow 5 on live: whether each Durable Object request has its own allowance, and the plan.
- It made small additive edits in `repositories/transactions.ts` (a `parentIds` filter on `listLines`)
  and `repositories/accounts.ts`, files the register Build also holds: that Build rebases over them.

**My side-turn decisions since the last review, for the record:**
- **Plan-page Build, second card: Request changes.** (Its first card got a Regate from me in a side
  turn that is not in this journal's earlier entries: the base had moved, and two Notes-card tests had
  failed in two of three full runs.) At the second card the gate was clean on the current base, and I
  found the cause in the code: **the new Auto-Assign card draws an empty body until its preview
  arrives and then grows by up to eight buttons, pushing the Notes card down under the pointer.** A
  layout jump for a person and a miss for a real-mouse test. Asked: the card keeps its height while
  loading; a spec that proves the Notes card does not move; the Notes tests ten times under load; the
  same for the Assign popover; the snooze race test forced or renamed. No source app for that round.
  Its head is now `b6af0b3` ("Auto-Assign list keeps its height while loading; layout spec; stable
  real clicks").
- Lesson: **a test filed as a flake at one gate and green at the next has not been explained.** Read
  the code around it before approving, especially when the Build adds something that loads late above
  it.

**Main is `c9e9d1c`; live is `e2bcd35`.** Two merges wait (the import, the sync budget), two migrations
pending on live (`100800`, `100900`; read with the pending script). The tree of `c9e9d1c` equals the
gated head `141f5e3`.

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): rework committed (`b6af0b3`), on its way
  back through checks, review, acceptance and the gate.
- **Reflect: two reports** (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`): head `4c074a7`, second polish round.
- **Register: selection, action bar, flags** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): built (`d539ba2`).

**Ticket writes:** 2 (EXF-613 Done and comment).

**Backlog:** 61 open feature tickets (33 done; 7 in progress: EXF-500, 516, 519, 550, 552, 520, 522).
Gap: done now EXF-613; open EXF-558, EXF-560, EXF-562, EXF-589, EXF-614 (Low). Template: twenty-nine.
Flow verdicts unchanged from round 71. Finished since each template's last review: Build 7, Deploy 8,
Discover 2, Test user flow 6.

**Next plan:** Deploy `c9e9d1c` now (the import with its budget: this is the release flow 5 needs), then
flow 5 against the Sandbox.

### 2026-11-16 · Plan round 73

Children used 87 of 200. One started now; four are running with the Plan-page Build (in its rework), the
two-report Reflect Build (polish) and the register Build (built). Main `c9e9d1c`, live `e2bcd35`. No
ticket was filed at the last review.

**Started: the Deploy of main `c9e9d1c`** (`p_0d0b7a1cf82b47e8a58ef3627a6978bd`), `gated_commit` `141f5e3`
(trees compared: identical), run prefix `ZZ-TEST D20`. Two merges (the import; its per-run budget), two
additive migrations (`100800`, `100900`; the pending script lists exactly these).
- It makes no bank connection and no call to Plaid. Checks without a bank: the new fields on hand-entered
  rows (`approved` true, no `import_id`), the `needs` read, approve as a no-op, reject answering 409,
  the plan's sync returning an empty list, the two counts on the account, 59 tools, a working balance
  of 482,660 after my two outflows, and the register, Plan page and Spending Breakdown still loading.
- It stops after the gate if main has moved. **Main can only move by my approval: I approve no Build's
  card until this Deploy has released.**

**Next plan, when it is live: flow 5 against the Sandbox** (connect through Add Account, link through
the API, sync, count entries and runs, approve, reject, re-sync, remove), which is the evidence EXF-613
left open; flow 10 again in the same child.

**Not started:** the credit engine (needs `packages/core` and the months files: after the Plan-page
Build); scheduled transactions (after the register Build); private screens (waiting for the person).

Ticket writes: 0. Review cadence: Build 7, Deploy 8, Discover 2, Test user flow 6.

### 2026-11-16 · Review round 73

Children used 87 of 200. One child ended: the Deploy. Three Builds are running.

**Ended: the Deploy of `c9e9d1c` (`p_0d0b7a1cf82b47e8a58ef3627a6978bd`), passed.**
**Live is https://budget.doxen.dev at `c9e9d1c`**, equal to main (I read the health endpoint myself).
The import from Plaid and its per-run budget are live.

- Gate: checks 145 s, browser run skipped (tree equal to the gated `141f5e3`). Release: the Time
  Travel bookmark phase ran; **both migrations applied** (`20261116100800_plaid_import.sql`,
  `20261116100900_sync_failed_at.sql`), none pending; smoke ok; 401 without credentials.
- REST on its test plan, all pass: hand-entered rows read `approved` true, `import_id` null, `matched`
  false; the `needs` read returns only the uncategorized row; approve of approved rows changes
  nothing; reject answers 409 `transaction_approved`; the plan's sync answers an empty list; **0 bank
  connections**; the connection schema carries `sync_failed_at`; working balance 482,660 as computed.
  One expectation of mine was off and it said so plainly: `needs_attention_count` does not count the
  Starting Balance (it goes to Ready to Assign and needs no category). Right behaviour.
- MCP: **59 tools**, the four new ones present and agreeing with REST.
- Browser at both sizes: the register, an added row, the Plan page and Spending Breakdown load with no
  failed request and no console error. At 1024 its "before" read ran while the register was still
  loading (its script; it said so and did not re-run): the add and the balances were right.
- Cleanup: `purge 'ZZ-TEST D20'` printed `deleted 1 remaining 0`. One plan that is not a test plan.
  No bank connection made, no call to Plaid.

**My side-turn decision since the last review:** the Reflect Build's first card (two reports) got a
**Regate**: its gate was clean (e2e 291 of 291 three times, acceptance 18 of 18, sixteen polish items)
but ran on `9e77748` while main was `c9e9d1c`. That side turn's box was stale (it did not know
`c9e9d1c`); I went by the journal, as my rule says. One known issue to decide at its next card: in the
Spending Trends chart the monthly-total marker's hover area lies under the bars, so on a month with
spending only its upper half opens the marker's tooltip. Its branch is now rebased (head `1af079d`).

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): rework at `b6af0b3`, on its way to the gate.
- **Reflect: two reports** (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`): regating on `c9e9d1c`.
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): built (`d539ba2`), in its checks and reviews.

**Ticket writes:** none.

**Backlog:** 61 open feature tickets (33 done; 7 in progress). Gap: open EXF-558, EXF-560, EXF-562,
EXF-589, EXF-614 (Low). Template: twenty-nine. Flow verdicts unchanged. Finished since each template's
last review: Build 7, Deploy 9, Discover 2, Test user flow 6. **One more Deploy and the Deploy template
review is due.**

**Next plan:** flow 5 on live against the Plaid Sandbox, with the import (and flow 10 again). The
cards of the three Builds may be approved again as they come: the Deploy has released.

### 2026-11-16 · Plan round 74

Children used 88 of 200. One started now; four are running with the Plan-page Build (rework on its way
to the gate), the two-report Reflect Build (regating on `c9e9d1c`) and the register Build (in checks
and reviews). Main and live are both `c9e9d1c`. No ticket was filed at the last review.

**Started: flow tests on live `c9e9d1c`** (`p_1a06c903df354fd0ad9f020e918dccac`), one child, run prefix
`ZZ-TEST F74`:
- **Flow 5, second run, with the import** (previous `p_2dd7fe181bcc4d478325a3cef0c35e32`,
  `parity_known_gaps`): connect First Platypus Bank through Add Account and Plaid's own window; link
  the checking account through the API **with `today` set 60 days back**, because the import skips
  everything before an account's start date and the Sandbox's transactions lie in the past (with
  today's date nearly all would be skipped and the test would prove nothing); sync and keep a table
  of every sync call (duration, counts, `has_more`): the evidence EXF-613 left open; check signs,
  no doubled `import_id`, balance arithmetic; a second sync adds nothing; approve, reject, delete and
  sync again; a second account linked later must not disturb the first; **matching in a second plan**
  (a hand entry 3 days before an import matches, one 12 days before does not); no token text in any
  answer; remove the connection whatever happens.
  - It syncs only the connection it made, uses no Plaid secret and never calls Plaid itself.
  - If a sync fails it stops syncing, reads the connection's status and `sync_failed_at`, and files
    the failure as its own ticket with the table.
- **Flow 10, third run** (previous `p_b3b54aec56044df2a755ef5d984061f4`, `new_gaps`, EXF-587 fixed):
  59 tools; every REST operation has a tool or a recorded reason; descriptions and timestamps; the
  same answers through REST and MCP for transfers, splits, targets, the two reports, account
  adjustments, closed accounts, payees; readable errors; history actors.

**Not started:** flows 3 and 8 (their Builds are not live); the credit engine and scheduled
transactions (their files are held); no Deploy (main equals live).

**The Deploy that ships the next merges will be the tenth since the Deploy template's review** (round
43): start that review after it, with the ten Threads, three of which never ran.

Ticket writes: 0. Review cadence: Build 7, Deploy 9, Discover 2, Test user flow 6.

### 2026-11-16 · Review round 74

Children used 88 of 200. One Build ended; three children are running (the Plan-page Build, the register
Build, the flow tests for flows 5 and 10).

**Ended: the Reflect Build for two reports (`p_e02811d8e6bd45bdbfe5e34e4cbd6c0d`), merged as `033e011`
(PR #40)**, about 2 hours 10 minutes, two cards (Regate for a moved base, Approve). EXF-550 and EXF-552
are Done.

- I approved after reading the branch: gate on `c9e9d1c`, e2e 291 of 291 three times; `spendingRows`
  untouched and the only source of expenses; `incomeRows` as I specified; nothing out of bounds, no
  skip. Acceptance 18 of 18; sixteen polish items.
- Its Reviewer found four small things, fixed: a click on a short bar segment was swallowed by the
  marker's hover circle; the "(no payee)" row took a payee's name; the empty state when a purchase
  and its refund cancel; a redundant condition.
- **One known issue, accepted and filed now as a Low gap:** after that fix the marker's hover circle
  lies under the bars, so on a month with spending only its upper half opens the marker's tooltip.
- **Source limits:** the Tester wrote the limits out and kept them (two tab clicks, two captures). The
  Designer did not resize the source on purpose this time, but **a clipped screenshot that timed out
  left the source tab at 1340 pixels wide**, as in the Plan-page Build an hour earlier; it noticed,
  restored 1600×813 and said so. So "take unclipped captures and crop afterwards" in my briefs is not
  what the Designer's tool does by default. For the next briefs: "capture with the browser's own
  full-page screenshot call and no clip; a clipped capture changes the tab's size".
- On main: routes `reports/spending-trends`, `reports/income-expense` and their exports; tools
  `get_spending_trends`, `get_income_expense`; `packages/schema/src/spending-trends.ts`,
  `income-expense.ts`; `apps/web/src/reflect/TrendsChart.tsx`, `TrendsTable.tsx`,
  `IncomeExpenseReport.tsx`. **61 tools on main.**
- A side note from its Tester: the source's test plan now shows a balance adjustment of -261.11 in
  Income v Expense. Some earlier child's visit to the test plan left it (an account there was adjusted
  or closed at some point). It is the test plan, where changes are allowed; nothing to do.

**Main is `033e011`; live is `c9e9d1c`.** One merge is not live (the two Reflect reports; no migration).

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): head `8ee91a6` (its rework, rebased), on its
  way to the gate; its next card will need a look at the height-keeping change and the layout spec.
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): head `d1d05fa`, polish applied.
- **Flows 5 and 10** (`p_1a06c903df354fd0ad9f020e918dccac`): running against the Sandbox.

**Ticket writes:** 4 (two Done, two comments). One gap ticket filed through this review.

**Backlog:** 59 open feature tickets (35 done; 5 in progress: EXF-500, 516, 519, 520, 522). Gap: open
EXF-558, EXF-560, EXF-562, EXF-589, EXF-614 (Low) and the one filed now. Template: twenty-nine. Flow
verdicts unchanged. Finished since each template's last review: Build 8, Deploy 9, Discover 2, Test
user flow 6.

**Next plan:** no Deploy for one small merge; wait for the Plan-page Build or the register Build and
ship them together (that Deploy is the tenth, and the Deploy template review follows). With Reflect
free again: Age of Money (EXF-553) is the last report; read its ticket and decide.

### 2026-11-16 · Plan round 75

Children used 89 of 200. One started now; four are running with the Plan-page Build (rework rebased, on
its way to the gate), the register Build (after polish) and the flow tests for flows 5 and 10. Main
`033e011`, live `c9e9d1c`.

- The ticket filed at the last review exists: **EXF-615** (the Spending Trends marker's hover), set to
  Low and put in the Build started now.
- **Started: Reflect's last report** (`p_38ee9709f6664cb8bbdf1208634375e3`; EXF-553 Age of Money, with
  EXF-615). Reflect and the reports files were free again. Small: one query, pure arithmetic, one chart
  in the style of Net Worth, one tool.
  - My decisions where discovery could not observe the source: cash accounts only; every positive row
    opens a bucket (refunds too), every negative row is an outflow (a card payment too), transfers
    inside the set ignored; buckets that run out give age 0; half-up rounding. The tests must
    reproduce the ticket's eleven ages and the 114.
  - **Source: a new line about captures.** Two Builds in a row had the source tab resized by a clipped
    screenshot. The brief now says: the browser's plain full-page screenshot with no clip, tab in
    front, crop afterwards; and "never change the size of the source tab, on purpose or by accident".
  - Holds `apps/web/src/reflect/**`, `api/reports.ts`, the reports files. Disjoint from the Plan-page
    and register Builds.
- **No Deploy:** one small merge (two reports) is not live; it ships with the Plan-page or register
  Build. That Deploy is the tenth since the Deploy template's review; the review follows it.
- **Not started:** the credit engine (after the Plan-page Build), scheduled transactions (after the
  register Build), flows 3 and 8 (after that Deploy).

Ticket writes: 3 (EXF-615 priority and state, EXF-553 state and comment). Review cadence: Build 8,
Deploy 9, Discover 2, Test user flow 6.

### 2026-11-16 · Review round 75

Children used 89 of 200. One ended (the flow test for flows 5 and 10); three are running: the Plan-page
Build, the register Build and the Age of Money Build. Main `033e011`, live `c9e9d1c`, both unchanged.

**Flows 5 and 10 on live `c9e9d1c`** (`p_1a06c903df354fd0ad9f020e918dccac`, prefix `ZZ-TEST F74`, 23
minutes). No new gap, no ticket filed.

- **Cleanup checked first, and by me as well.** Its report: connection removed (`deleted: true`,
  `plaid: removed`), both plans purged (`deleted 2 remaining 0`), the count of plans that are not
  `ZZ-TEST` is 1. My own SELECT on live (numbers only): 0 bank connections, 0 bank accounts, 0 live
  test plans, 1 other plan. The owner's plan was not opened.
- **Flow 5 (link a Sandbox bank, import): `parity_known_gaps`.** All fifteen testable steps passed.
  - Through the app's own Add Account screen and Plaid's window: First Platypus Bank, 14 bank accounts.
  - First sync: 12 rows from the start date on, 137 older ones skipped; signs right (a refund is an
    inflow to Ready to Assign); every import unapproved, cleared, with its import id; balance
    110000 + 765080 = 875080 on all three reads.
  - A second sync adds nothing. A rejected and a deleted import do not come back, also when a second
    linked account makes the sync read the whole history again. Approved and categorized rows stay.
  - Matching: a hand entry 3 days before a bank row of the same amount became one row (hand fields
    kept, cleared, the import's id on it); one 12 days before was left alone and the import arrived
    beside it.
  - The same bank account linked in a second plan imports there without touching the first.
  - No access token, item id or secret in any of 96 saved answers. History rows carry `service:plaid`
    for the imports, `mcp:service:…` and `service:…` for the rest.
  - After removal the accounts stay as plain unlinked accounts with their rows.
  - **Known gaps, all screens:** nothing in the register marks an unapproved row except the category
    pill (EXF-463), no linked icon or manual match (EXF-461, EXF-464), no status or repair (EXF-465),
    no pending rows (EXF-466), no payee rules (EXF-467), no Manage Bank Connections or Link Account
    screens (EXF-460, EXF-461). These wait for the person's word on the bank screens.
- **The sync table** (the evidence EXF-613 left open; posted on EXF-613):

  | call | time | added | matched | skipped | has_more |
  |---|---|---|---|---|---|
  | first sync, one linked account | 128 ms | 12 | 0 | 137 | false |
  | again | 41 ms | 0 | 0 | 0 | false |
  | after approve, reject, delete | 26 ms | 0 | 0 | 0 | false |
  | after linking a second account | 50 ms | 4 | 0 | 184 | false |
  | second plan, REST | 1450 ms | 11 | 1 | 321 | false |

  No failure, no timeout, `sync_failed_at` null throughout.
- **What this run did not prove, plainly:**
  - `has_more` was never true. The Sandbox bank's history is too small to reach the 45-call bound, so
    the stop-and-continue path is proven by the Worker tests only. The first real bank with a long
    history is where it first runs on live.
  - The daily cron was not seen running. I checked that it is registered on the live Worker
    (`0 3 * * *`); no connection may stay overnight under my own rule, so its first real run is after
    the person connects a bank.
- **Flow 10 (REST and MCP): `parity`**, third run. 59 tools; 72 operations, 55 with a tool, 17 with a
  written exclusion, 0 with neither. Every description states what it returns, milliunits, date and
  month formats, and names its timestamps (14 tools called to check, 0 unnamed fields: EXF-587 holds on
  live). Transfers, splits, targets, Spending Breakdown, Net Worth, closed-account refusal and the payee
  inflow default all read the same through REST and MCP and match hand arithmetic. Six wrong calls give
  a sentence and create nothing. Without the service token everything answers 401.
  - One stale text, not a customer gap: the exclusion reason for `GET /me` still says "another Build
    adds the route". For the next Build that touches `apps/worker/test/mcp-coverage/`.
- **A fact I had not written down:** deleting a plan is a soft delete. Live holds 37 deleted `ZZ-TEST`
  plans with their rows (0 not deleted). Harmless at this size; I may only SELECT on live, so they stay.
  If the person ever wants them gone for good, that is a small feature (purge deleted plans), not a
  manual clean-up.
- The Tester needed five script runs to get through Plaid's window (its own selectors); nothing was
  left behind by the four failed ones (0 connections before the fifth).

**Running:**
- **Plan-page Build** (`p_3b70b79de2c54d278a92cb5686f8ed74`): head `3219500` on base `033e011`; rework
  accepted by its own Tester (layout spec green, plan-panel 110/110 at ten repeats under load, snooze
  test renamed, source not opened). On its way through the gate; the card comes next.
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): head `d493aff`, thirteen polish items
  handled, before its gate. Its manifest now also lists an export service and `packages/schema/src/ui-state.ts`
  (also in the Plan-page Build's manifest: the second to merge rebases; I look at that file on its card).
- **Age of Money Build** (`p_38ee9709f6664cb8bbdf1208634375e3`): designed, being built.

**Ticket writes:** 1 (comment on EXF-613).

**Backlog:** 59 open feature tickets (35 done; 6 in progress: EXF-500, 516, 519, 520, 522, 553). Gap:
open EXF-558, EXF-560, EXF-562, EXF-589, EXF-614, EXF-615 (in progress). Template: twenty-nine.
**Flow verdicts:** 1 `parity_known_gaps`; 2 `parity_known_gaps`; 5 `parity_known_gaps` (with the
import); 8 `new_gaps` (fixed, rerun owed); 9 `new_gaps` (EXF-614, Low); 10 `parity`; 11 `parity`;
3, 4, 6, 7 not run. Finished since each template's last review: Build 8, Deploy 9, Discover 2, Test
user flow 7.

**Next plan:** nothing new can start beside the three Builds without touching their files; wait for
the cards. First merge of the Plan-page or register Build → Deploy `D21` (the tenth; ships the two
Reflect reports too), then the Deploy template review, then flows 3 and 8.

### 2026-11-16 · Plan round 76

Children used 89 of 200. Nothing started; three are running: the Plan-page Build (head `3219500`, at
its gate), the register Build (head `d493aff`, before its gate) and the Age of Money Build (designed,
being built). Main `033e011`, live `c9e9d1c`. No tickets were filed at the last review, so none to
check.

- **Why nothing new.** I went through the 50 open feature tickets for one whose files are free of all
  three Builds:
  - Plan, months, targets, core: held by the Plan-page Build (so no credit engine, tracking accounts,
    account type rules, loan types, category reorder).
  - Register, transactions, account header: held by the register Build (so no scheduled transactions,
    search, view options, reconcile, file import, images, remembered category).
  - Export Plan's API half (EXF-476) reads the transactions table whose rows the register Build is
    changing (the flag column, which the export's Register file must carry): by the rule from EXF-610
    it goes after that merge, not beside it.
  - Sidebar and settings tickets (EXF-474, EXF-472, EXF-473) write to `packages/schema/src/ui-state.ts`,
    which both the Plan-page and the register Build already change.
  - Plans list page (EXF-471), Manage Payees (EXF-510), the bank screens: their source screens show
    other plans or private data; they wait for the person's word or EXF-573.
- **No Deploy yet** for the two Reflect reports alone: the Plan-page Build is at its gate, and a Deploy
  in flight would hold its card.
- **Child budget, thought through once:** 111 left. About 59 feature and 6 gap tickets at two to three
  per Build is about 30 Builds; with a Deploy per two Builds (15), flow tests at two flows each (15) and
  reviews (5) that is about 65. Enough, as long as Builds stay bundled and Deploys are not spent on
  single small merges.
- **No flow test:** flows 3 and 8 need the next Deploy; 4, 6 and 7 need features not built.

Declared for the tree: Deploy `D21`, the credit engine Build (EXF-532, EXF-535), the scheduled
transactions Build (EXF-497, EXF-499), the Deploy template review, flows 3 and 8.

Ticket writes: 0. Review cadence: Build 8, Deploy 9, Discover 2, Test user flow 7.

### 2026-11-16 · Review round 76

Children used 89 of 200. One ended (the Plan-page Build, merged); two are running: the register Build
and the Age of Money Build. Main `357bc4f`, live `c9e9d1c`. Journal branch merged up to main.

**Plan-page Build merged as `357bc4f`** (`p_3b70b79de2c54d278a92cb5686f8ed74`; EXF-500 view chips,
EXF-516 target snooze, EXF-519 Auto-Assign; four hours, 73 visits, three cards). The merge commit's
tree equals the gated head `e555934`.

- Third card, approved. Gate on base `033e011` (main then), head the gated head, check green, e2e
  327/328 then 328/328 twice, changed specs 470/470 at ten repeats.
- **The defect I sent back is fixed.** The Auto-Assign card draws its rows disabled, at full height,
  while its preview loads. The new `e2e/auto-assign-layout.spec.ts` holds the preview back a second and
  compares the Notes card's top edge; the Reviewer ran it against the old code and it failed there
  (741 → 959). The Notes tests passed 110 of 110 at ten repeats under load.
- **What I read on the branch before approving:** no always-overlap file, no skipped test; in
  `packages/core` only the optional `snoozed_months` input my brief allowed; the migration only adds
  the table `target_snoozes`; coverage lines for the three new operations.
- **The gate's one flake, read:** `e2e/plan-grid.spec.ts:251` (the grid's error, empty and loading
  states) failed once in three full runs and passed 5 of 5 alone. It is an older test with a 1.5 second
  window for seeing the loading state, in a file this branch does not change, and the branch does not
  touch the loading path. I took it as load (three Builds were gating on the same box). **If it fails at
  another gate it gets a ticket**; this is the first time it appears.
- Two spec faults the Build found in its own specs on the way: a click on a button still disabled
  while the preview loads (now waits), and an API call over a keep-alive socket the dev server had
  closed after five idle seconds (that one call now retries on a reset; it sets an absolute amount).
  The second explains the "load" failure of the gate before; the Implementer first called it load and
  then looked again, which is what I want.
- **Known and accepted, filed now as one Low gap ticket:** the card keeps room for all eight rows, so
  with Underfunded or Reduce Overfunding hidden it is 36 to 84 px taller than the source's card; in an
  empty view the placeholder still shrinks to the short message (on a month change and when the
  popover's Auto tab opens, not only after a chip click); and `realClick`'s "stopped moving" check
  compares x, y and width but not height.
- **Not compared with the source, by the limits, and said so on the tickets:** the Overspent chip, the
  hidden-by-view footer, the snooze switch, pill and toast, and the popover's Auto tab. The source's
  test plan has no targets, nothing overspent and nothing to assign; nobody may press Auto-Assign or
  toggle a snooze there. These rest on the tickets' text.
- On main now: routes `GET`/`POST …/months/{month}/auto-assign`, `PUT …/target-snooze`; tools
  `preview_auto_assign`, `auto_assign`, `snooze_target` (**64 tools on main**, 59 on live);
  `packages/schema/src/plan-views.ts`, `auto-assign.ts`; `apps/web/src/plan/ViewChips.tsx`,
  `AutoAssignOptions.tsx`, `panel/AutoAssignCard.tsx`, `snooze.ts`; UI state key `snooze_tip_seen`.
- `e2e/support/real-click.ts` changed for every spec (it now waits up to two seconds for its target to
  stop moving). A guard, but it also means a later layout jump would no longer fail a click test: only
  a spec that measures positions catches one. Worth a line in later Build briefs for panels.

**Main is `357bc4f`; live is `c9e9d1c`.** Two merges are not live: the two Reflect reports and this
one. Pending on live: migration `20261116100700_target_snoozes.sql` (checked with the pending script).

**Running, both on base `033e011`, so each card will need a regate:**
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): head `e7b3de3`, fixing review findings.
  It shares `packages/schema/src/ui-state.ts`, the timestamp test's call list and `docs/README.md`
  with the merge; its brief says to keep every entry of both sides.
- **Age of Money Build** (`p_38ee9709f6664cb8bbdf1208634375e3`): head `1a5bb24`, polish applied.

**Ticket writes:** 6 (EXF-500, EXF-516, EXF-519 to Done, each with a comment). One gap ticket filed
through this review.

**Backlog:** 59 open feature tickets (38 done; 3 in progress: EXF-520, 522, 553). Gap: open EXF-558,
EXF-560, EXF-562, EXF-589, EXF-614, EXF-615 (in progress) and the one filed now. Template:
twenty-nine. Flow verdicts unchanged (flow 3 can now run once this is live). Finished since each
template's last review: Build 9, Deploy 9, Discover 2, Test user flow 7.

**Next plan:** Deploy `D21` for `357bc4f` (the tenth Deploy; migration `100700`; 64 tools; two new
Reflect reports); approve no Build card while it is in flight. The credit engine Build (EXF-532,
EXF-535): `packages/core` and the months files are free; check its manifest estimate against the
register and Age of Money Builds first. After the Deploy: the Deploy template review, flows 3 and 8.

### 2026-11-16 · Plan round 77

Children used 91 of 200. Two started now; four are running with the register Build (fixing review
findings) and the Age of Money Build (polish applied). Main `357bc4f`, live `c9e9d1c`.

- The ticket filed at the last review exists: **EXF-616** (the Auto-Assign card's height in the states
  the source differs in), set to Low. It goes with a later Plan Build.
- **Started: Deploy `D21`** (`p_dc763853fd914adfb4b6fe1852320767`; `expect_commit` `357bc4f`, gated
  head `e555934`, trees identical). Ships two merges: the two Reflect reports and the Plan page's view
  chips, snooze and Auto-Assign.
  - One migration pending, `20261116100700_target_snoozes.sql`. Its number is lower than two already
    applied on live; the brief says that is expected and to stop and quote if the tool objects.
  - Checks: target, preview, snooze on and off, Auto-Assign Underfunded with the figures I expect
    (Ready to Assign 500000 → 400000); what a snoozed target does to the Underfunded preview and what
    Income v Expense lists for a Starting Balance are asked as "report what you read", not asserted,
    because I do not know them; 64 tools; in the browser the chips, the panel's height while the
    preview loads (two measured numbers), the snooze switch, the two report tabs.
  - **It is the tenth Deploy since the Deploy template's review**: the review starts when it ends.
  - **While it runs I approve no Build card** (main must not move under it).
- **Started: the credit engine** (`p_34bc1879fb924226b6a197db43cfeb20`; EXF-532 with EXF-535, both
  High; they block EXF-537, EXF-539, EXF-538 and the plan import EXF-477). `packages/core` and the
  months files are free since the Plan-page merge.
  - **Manifest check against the two running Builds.** The register Build holds the transactions
    repository, where the engine's activity read (`activityByMonth`) lives. The engine needs that read
    per credit account. Rather than wait, the brief has the credit Build write its read in a new
    repository file and leave the transactions repository alone; it also adds no rule about which
    category a row may take (that would be the transactions service), and the engine's rules cover
    every case instead. The register Build changes no meaning of a row (a flag column and bulk actions
    that go through the single-row rules), so the rule from EXF-610 is kept. Age of Money holds only
    reports and Reflect files: disjoint.
  - **My decisions where discovery saw nothing** (each to be written "not compared"): two cards in one
    overspent category split the credit part in proportion, largest remainder; a transfer between a
    cash account and a card is the payment; a transfer between two cards moves the amount between
    their payment categories; an uncategorized card row funds nothing; renaming the account renames
    the payment category, closing keeps it; the group is first and refuses rename, delete, hide and
    move; a target on a payment category is refused until EXF-538; Auto-Assign leaves payment
    categories out of the target and spending options.
  - **The live database may already hold credit accounts** (the owner's plan): the migration
    (`20261116101100_credit_payment_categories.sql`) creates the group and the payment categories for
    existing cards, with a test that arranges "before".
  - A property test I derived first: at each month's end, on-plan cash balances = Ready to Assign +
    every Available + that month's credit parts (with Uncategorized and later-month assignments
    accounted for). The Architect derives the exact form and tests it over random plans.
  - Acceptance rests on replaying EXF-535's eleven steps and EXF-532's examples A, B and C through the
    API, to the milliunit.
  - **Source:** the Plan page of the test plan only, to look and to read style rules; nothing is
    created there, so the yellow pill, the mixed state and the inspector messages are built from the
    ticket and marked not compared.
  - Not in it: the PAYMENT header and payment inspector (EXF-537), Record Payment (EXF-539).
- **Not started:** scheduled transactions (after the register Build); flows 3 and 8 and the Deploy
  template review (after the Deploy).

Ticket writes: 5 (EXF-616 priority; EXF-532 and EXF-535 to In Progress, each with a comment). Review
cadence: Build 9, Deploy 9 (the tenth is running), Discover 2, Test user flow 7.

### 2026-11-16 · Review round 77

Children used 91 of 200. One ended (Deploy `D21`, shipped); three are running: the register Build
(regating on the new base), the Age of Money Build (after review fixes) and the credit engine Build
(designing). Main `357bc4f`, **live `357bc4f`**: nothing merged is waiting.

**Deploy `D21` shipped `357bc4f`** (`p_dc763853fd914adfb4b6fe1852320767`, 25 minutes) to
https://budget.doxen.dev. I read the health endpoint myself: `deploy_sha` `357bc4f…`; the pending
script prints nothing.

- Gate: check passed, the e2e run skipped because the tree equals the gated head `e555934`. Release:
  the Time Travel bookmark ran first; `20261116100700_target_snoozes.sql` applied (its lower number was
  no obstacle); smoke ok.
- **Live now, checked on a test plan:** a monthly target, the Auto-Assign preview (`underfunded`
  100000), snooze on and off (status `snoozed`, figures unchanged, and **a snoozed target leaves the
  Underfunded preview: 0**), Auto-Assign Underfunded (Ready to Assign 500000 → 400000), the views
  through REST, Spending Trends and Income v Expense with 12.34 of spending; **64 tools**; in the
  browser at both sizes the chips, the panel, the snooze switch and both report tabs, no failed
  request, no console error.
- **The Auto-Assign card holds its height on live:** with the preview held back a second, the Notes
  card's top edge was 1183 px before and after at 1440×900 and 1429 px before and after at 1024×700.
- **Two of my expectations were wrong, and the Deploy reported them as they were instead of bending
  the check:**
  - I expected the Underfunded view to be empty in the browser, but my own step 2g had overspent a
    category first, and the Underfunded view also lists overspent categories (by design, in
    `packages/schema/src/plan-views.ts`). The empty view was shown on the Snoozed chip instead.
  - I wrote that a Snoozed chip "appears" on snoozing. The chip is always in the row; only the view's
    content changes.
- **Two things I asked to be read, not asserted:** a Starting Balance is not income in Income v
  Expense (income total 0; by the report's design); a snoozed target is not underfunded.
- **One slip by the Deploy's Verifier:** a `curl -i` printed the response headers of an authenticated
  `/mcp` call into its transcript, including a `CF_Authorization` cookie value. That is a short-lived
  Access session token, not the service token's secret; it stays inside the platform's transcript and
  expires on its own. No rotation needed. It goes into the Deploy template review as evidence for a
  rule: never print response headers of a live call.
- Cleanup: `deleted 1 remaining 0`; plans not named `ZZ-TEST`: 1. The owner's plan was not opened.

**This was the tenth Deploy since the Deploy template's review.** The ten: `p_19af5f217da344c69a6bc314de0cfbaa`,
`p_8e0dbe332cab411d953c0e3eb9b6768c`, `p_440603eb108042738ca17f4ef6e712ba`,
`p_e549c296232b4f06be26ddeb660f709a`, `p_749540e03f854b349882000bee3249b2`,
`p_ad9c4b07f40441a9b48e8c57f69fdfb0` (parked at intake, cancelled), `p_3e2eeca31173462c8bb9ef7b3bcc1676`
(refused: `deploy.env` missing), `p_a6a99ac78c284ea7bef1a14072609fe8`,
`p_0d0b7a1cf82b47e8a58ef3627a6978bd`, `p_dc763853fd914adfb4b6fe1852320767`. The review starts at the
next plan.

**Two cards answered in side turns since the plan:**
- **Register Build, first card: Regate.** Its gate was clean (309 of 309 three times, no flakes, no
  known issues) but ran on base `033e011`; main was `357bc4f`, with four files changed on both sides.
  The branch has since merged main (head `717902f`) and is gating again. The Deploy has ended, so its
  next card can be approved if the gate is on `357bc4f`.
- **Credit engine Build, preflight failed: Proceed without.** I could not see the trace (the child's
  transcript shows only agent messages; my box has no browser). The note covered both causes. Since
  then the Architect says it has the preflight lines and its source study worked (styles only), so the
  source is reachable; the cause will be in its design's "Preflight" section, and I read it there.

**Running:**
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): regating on `357bc4f`.
- **Age of Money Build** (`p_38ee9709f6664cb8bbdf1208634375e3`): head `6ea9b99` on base `033e011`; its
  first card will need a regate too.
- **Credit engine Build** (`p_34bc1879fb924226b6a197db43cfeb20`): the Architect is mapping every
  category and group operation the payment group must refuse.

**Ticket writes:** 0.

**Backlog:** 59 open feature tickets (38 done; 5 in progress: EXF-520, 522, 553, 532, 535). Gap: open
EXF-558, EXF-560, EXF-562, EXF-589, EXF-614, EXF-616 and EXF-615 (in progress). Template:
twenty-nine. **Flow verdicts:** unchanged; flow 3 (targets, Auto-Assign) can now run on live, and flow
8 (Reflect) can be rerun with four of five reports live. Finished since each template's last review:
Build 9, **Deploy 10**, Discover 2, Test user flow 7.

**Next plan:** the Deploy template review (mode review, the ten Threads above, with the cookie slip
and the two "Lead's expectation was wrong, the check was not bent" cases as notes); flows 3 and 8 on
live `357bc4f`. Nothing else is free for a Build: scheduled transactions wait for the register merge.

### 2026-11-16 · Plan round 78

Children used 93 of 200. Two started now; five are running with the register Build (regating), the Age
of Money Build and the credit engine Build (designing). Main `357bc4f`, live `357bc4f`. No tickets were
filed at the last review, so none to check.

- **Started: the Deploy template review** (`p_6421e2b6101a4c0db86039e8aa12df1c`; Improve templates,
  mode review, the ten Deploys since round 43). The six tickets of the last Deploy review are all still
  open, so I asked mainly for new evidence on them and for:
  1. what differed in the two Deploys that did not run (EXF-612 refused, EXF-611 parked) and the
     smallest change that removes the dependency on a file an agent writes;
  2. a rule against printing response headers of live calls (the cookie in `D21`'s transcript; I told
     the reviewer not to copy the value);
  3. shrinking my 7,000 to 12,000 character briefs: which rules and checks can be template, profile or
     code; and keeping the behaviour "the verifier does not bend a check to a wrong expectation";
  4. whether the template already refuses when main is not the expected commit;
  5. a migration numbered below ones already applied: by design or by luck;
  6. where the 7 to 25 minutes go.
  With the standing line: "Post evidence for an existing ticket with comment_ticket or in your report;
  never file stand-in tickets."
- **Started: flows 3 and 8 on live** (`p_3f1312fc03934e6c89f48296cbe4425f`; prefix `ZZ-TEST F78`).
  - Flow 3, first run: three target kinds (two set in the browser), assigning by hand, snooze and
    Shift+Z, plan-wide Auto-Assign Underfunded, spending, the five views, December (carry, the 50.00 of
    cash overspending out of Ready to Assign, the targets' December needs), Auto-Assign for one
    category in December and what it does to November's Ready to Assign, the popover's Auto tab,
    editing and deleting a target, MCP, the history table.
  - Flow 8, second run: a five-month plan with income, four spending categories, a refund, a transfer
    between cash accounts and a categorized transfer to a loan; Net Worth, Spending Breakdown, Spending
    Trends and Income v Expense with drill-downs, a filter, exports, MCP, no other plan's figures on
    first paint, an empty plan.
  - **A new rule in the brief, from the last Deploy:** "If a figure the Lead gives does not match what
    you read, do not adjust the check and do not assume the app is wrong: report both with your own
    arithmetic. The Lead's figures are derived by hand and have been wrong before." And "never print
    the response headers of a call to the live app".
  - Figures I derived and am less sure of, so I know where to look first if they are reported as
    different: whether Underfunded also counts an overspent category (step 3.10 expects 50.00; it may
    read 100.00); November's Ready to Assign after assigning in December (840.00); the average daily
    spending (45.63 over 153 days).
  - No source app, no bank connection.
- **No Build started:** the register, reports, plan and core files are all held; scheduled
  transactions wait for the register merge.
- **Cards now safe to approve** (no Deploy in flight) when their gate is on `357bc4f`.

Declared for the tree as well: scheduled transactions (EXF-497, EXF-499) and Deploy `D22`.

Ticket writes: 0. Review cadence: Build 9, Deploy 0 (review running), Discover 2, Test user flow 7.

### 2026-11-16 · Review round 78

Children used 93 of 200. One ended (the Deploy template review); four are running: the register Build
(reworking after my Request changes), the Age of Money Build (rebased, heading to its gate), the credit
engine Build (design committed, building) and the flow test for flows 3 and 8. Main `357bc4f`, live
`357bc4f`.

**Deploy template review** (`p_6421e2b6101a4c0db86039e8aa12df1c`). I approved all thirteen proposals in
a side turn; all were carried out and nothing is left for me to file.

- **Three new template tickets, priorities set now:**
  - **EXF-617** (High): calls to the live app never print response headers; a profile helper returns
    status and body only; header dumps are cleaned up after the verifier.
  - **EXF-618** (High): code does the fixed parts of every Deploy brief (the main check, expected
    migrations, the out-of-order note, the run prefix, the live probe), and the template states the
    verifier's reporting rules, including "DIFFERS FROM THE BRIEF: expected …, read …".
  - **EXF-619** (Medium): the repository carries a live-check browser helper and code installs the
    browser before the verifier. This one needs a Build in this repository when the template side
    exists.
- **Evidence posted** on EXF-612, EXF-611, EXF-582, EXF-583, EXF-584, EXF-585, EXF-580, EXF-581 and
  EXF-559. I raised EXF-584 and EXF-585 from Low to Medium on that evidence (the gate's repeated check
  is a fifth of every Deploy and growing; seven of eight verifiers' first answer failed).
- **What I learned from it:**
  - The two Deploys that did not run used the very same intake command as the one that worked. Only a
    file handed from an agent step to a code step went missing; every Deploy has two such hand-offs.
    The cause is unexplained and can return.
  - **Nothing visible refuses a release when main has moved past the expected commit.** So the line
    "if main has moved past it, do not release" stays in every Deploy brief, and I keep approving no
    Build while a Deploy is in flight.
  - A migration numbered below ones already applied is by the tool's design (five cases, all fine);
    production then applies them in another order than a fresh test database.
  - More than half of a Deploy's time is the verifier writing browser scripts from nothing.
  - My own figure was wrong: `D21` took 11.4 minutes, not 25.

**Two cards answered in side turns:**
- **Register Build, second card: Request changes** (the gate was clean, on the current base, head the
  gated head). I read the branch and found that a bulk request reads the database at least once per
  selected row: `prepare()` reads the split lines of every row, the other side of every transfer and
  the target account of every moved row, although the bulk service has already read all lines in one
  query. Over 100 rows that is more than 100 D1 calls; the Free plan allows 50 per invocation
  (`docs/sync-budget-design.md`). The local test database does not enforce the limit, so the tests
  pass. On live, "select all, mark cleared" would fail above about 45 rows.
  - **The same loop is already on main and live** in `approveTransactions` and `rejectTransactions`
    (a `listLines` and a `findDetail` per row). I asked for it to be fixed in the same rework (same
    file) and file a gap ticket for it now so the fix has a ticket. Not reproduced on live: it needs
    more than 45 unapproved imports, which only a Sandbox flow test can make.
  - Asked for: set reads before the loop, no database call inside it; a test that counts calls for 10
    and for 100 rows per op and failed before the fix; the wrong sentence about the 400-statement cap
    corrected; **a rule in `docs/conventions.md`** ("a request that handles many rows makes a number of
    D1 calls that does not grow with the rows … with a test that counts its calls").
  - **This is the third time** (the bank sync, approve and reject, bulk). From now on every brief for a
    Build with a handler over many rows names the rule and the counting test.
  - Everything else on the branch was as asked: bulk actions go through the single-edit rules, a bulk
    delete of an import leaves its tombstone, a duplicate carries no import fields, one nullable column.
- **Credit engine Build, preflight: Proceed** (recorded at the last review). **The cause is now known,
  from the design's "Preflight" section: the box had lost platform files again** (`bin/lib.sh` and
  `bin/source_check.sh` missing; `request.json` was there). That is EXF-612's fault three and a half
  hours after its last case, so it is not confined to this morning. Evidence posted on EXF-612.
  **Risk:** this Build's `checks` and gate steps use the same directory. If they fail on `lib.sh`, I
  carry the branch over at once and do not look for another cause.

**Credit engine design, read and accepted** (`docs/credit-engine-design.md` at `2862fb4`; comment on
EXF-532).
- Manifest against the register and Age of Money Builds: disjoint. The activity read is a new file;
  the transactions repository is untouched; one month read still makes 8 queries.
- **The Architect corrected me twice, rightly.** (1) A mixed overspent category that is partly covered
  loses its cash part first: the observed formula depends only on totals, and the ticket's "credit
  first" is loose wording. (2) My identity for the property test lacked card rows that move plan money
  without moving cash (cashback, a card row put straight into a payment category, uncategorized card
  rows).
- Its own decisions, accepted: a card whose payment category has history cannot be deleted (409); a
  payment category cannot receive a deleted category's money; the system group reads first.
- Source: styles read, one checkbox ticked and unticked, one capture kept (cropped), size unchanged.
  Ticking the row opened its Assigned cell by itself; nothing was typed.

**Running:**
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): reworking the reads.
- **Age of Money Build** (`p_38ee9709f6664cb8bbdf1208634375e3`): head `ceeddf4`, now on base `357bc4f`.
- **Credit engine Build** (`p_34bc1879fb924226b6a197db43cfeb20`): building.
- **Flows 3 and 8** (`p_3f1312fc03934e6c89f48296cbe4425f`): running on live.

**Ticket writes:** 7 (five priorities; comments on EXF-612 and EXF-532). One gap ticket filed through
this review.

**Backlog:** 59 open feature tickets (38 done; 5 in progress: EXF-520, 522, 553, 532, 535). Gap: open
EXF-558, EXF-560, EXF-562, EXF-589, EXF-614, EXF-616, EXF-615 (in progress) and the one filed now.
Template: thirty-two (EXF-573 and EXF-612 Urgent). Flow verdicts unchanged. Finished since each
template's last review: Build 9, Deploy 0, Discover 2, Test user flow 7.

**Next plan:** set the new gap ticket to High and link it to the register Build. Nothing else is free
to start; wait for the cards (Age of Money first) and the flow test.

### 2026-11-16 · Plan round 79

Children used 94 of 200. One started now; four are running with the register Build (reworking its
reads), the credit engine Build (building) and the flow test for flows 3 and 8. Main `5ebac3c`, live
`357bc4f`. Journal branch merged up to main.

- **Between the review and this plan the Age of Money Build merged as `5ebac3c`** (I approved its first
  card in a side turn: gate on `357bc4f`, clean; the merge commit's tree equals the gated head
  `ceeddf4`). Its tickets and its one accepted known issue (the chart's hover columns reach over the
  "Current" value) are for the next review, which is where an ended child is recorded.
- The ticket filed at the last review exists: **EXF-620** (approve and reject read the database once
  per row), set to High and In Progress with a comment: the register Build's rework fixes it.
- **Started: the shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`; EXF-473 Keyboard Shortcuts
  dialog with a shortcut registry, EXF-474 sidebar collapse, expand and resize, EXF-614 the sidebar on
  a plan that was not found). Three Low tickets, but they are the only work whose files are free: the
  shell is held by nobody, and the Build changes no Worker file.
  - **Manifest estimate against the three running Builds:** `apps/web/src/shell/**`, a new
    `apps/web/src/shortcuts/**`, one new file under `menu-actions/`, shell specs. Disjoint from the
    register (register, account, transactions), the credit engine (core, months, categories, accounts
    services, `plan/**`) and nothing in the always-overlap list. The sidebar's state goes to the
    browser's storage as the ticket says, so `ui-state.ts` (which the register Build changes) is not
    touched.
  - **Scope cut on purpose:** the registry and dispatcher are built, but the Plan page's and the
    register's existing shortcuts are not moved into it (other Builds hold those files). The
    dispatcher must swallow no key it has no handler for; the proof is that the existing Plan and
    register specs pass untouched.
  - **Source:** the test plan's Plan page; `?` to open the dialog (focus outside any field), the
    collapse button and Shift+. with the sidebar left expanded. **Never the drag** (it changes a saved
    width), never the plan button or the rail's logo (both open the plan menu). The expanded sidebar
    shows the owner's email: captures are cropped below it.
  - New in the brief after today's lost platform files: the Clerk creates no other file under
    `/workspace/.exfab/` (the credit Build's Clerk had made up a profile file), and a platform script
    failing on one of its own files is quoted word for word at the top of the answer.
  - This Build changes the width of the main area on every page: I told it that a spec of another
    page that fails after its change is its to explain.
- **No Deploy** for Age of Money alone; it ships with the register Build.
- **Not started:** scheduled transactions and the API half of Export Plan (both after the register
  merge); the private screens (the person's word).

Ticket writes: 7 (EXF-620 priority, state and comment; EXF-473, EXF-474, EXF-614 to In Progress with
comments). Review cadence: Build 10 with Age of Money (the Build template review is due at the next
plan), Deploy 0, Discover 2, Test user flow 7.

### 2026-11-16 · Review round 79

Children used 94 of 200. One ended since the last review (the Age of Money Build, merged); four are
running: the register Build (rework committed, head `29084dc`), the credit engine Build (building),
the shell Build (just started) and the flow test for flows 3 and 8. Main `5ebac3c`, live `357bc4f`.

**Age of Money Build merged as `5ebac3c`** (`p_38ee9709f6664cb8bbdf1208634375e3`; EXF-553 with EXF-615;
78 minutes, one card). Both tickets are Done with comments.

- Gate on base `357bc4f`: check green, e2e 335 of 335 three times, changed specs 310 of 310, no flakes.
  The merge commit's tree equals the gated head `ceeddf4`.
- **What I read before approving:** only Reflect and reports files and the two shared test lists; no
  migration; no skipped test; the arithmetic pure with `today` as an input; unit tests for the ticket's
  eleven ages, October's 114 and my five extra cases; one query for the rows (a fixed number of
  database calls, the rule I now check on every card).
- **The Reviewer earned its place again:** the Implementer had quietly changed a test from "40px above
  the marker" to 25px because 40px did not work. The Reviewer proved with a throwaway test that the
  acceptance case failed and sent it back; the fix made each month's hover area the whole column.
- **That fix left the one known issue:** the hover columns reach 48px above the chart and lie over the
  right part of the "Current" value. Accepted for the merge; filed now as a Low gap.
- **Observed in the source after all:** Age of Money's empty state (the test plan has fewer than ten
  outflows). The clone uses the source's callout text with "Budget" for the app's name, plus my
  "Current —" row. The chart, tooltip and markers are **not compared**; a toggle seen only in the
  stylesheet is left out.
- **Source limits:** every step stayed on the Reflect pages, pressed nothing and reported for itself.
  **But the Designer's captures shrank the source tab's visible area again** (to 1292×177; it noticed
  and restored 1600×813), although the brief says "plain full-page screenshot, no clip" in bold. The
  Tester and the Architect's sub-agent captured the same way as told and the size held. So my wording
  does not reach the Designer's capture tool: this needs the template (evidence on EXF-573, with a
  correction to my own first comment there, in which I had named the wrong Builds).
- On main now: route `reports/age-of-money`, tool `get_age_of_money` (**65 tools on main**, 64 on live),
  `packages/schema/src/age-of-money.ts`, `apps/web/src/reflect/AgeOfMoneyChart.tsx`,
  `AgeOfMoneyReport.tsx`. **All five Reflect reports are built.**

**Main is `5ebac3c`; live is `357bc4f`.** One merge is not live (no migration).

**Running:**
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): head `29084dc`, "a bulk request, approve
  and reject make a fixed number of D1 calls"; on base `357bc4f`, so its card will be on an old base
  unless its gate rebases first. On the card I check the counting test and that nothing else changed.
- **Credit engine Build** (`p_34bc1879fb924226b6a197db43cfeb20`): building (head still the design).
- **Shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`): at intake.
- **Flows 3 and 8** (`p_3f1312fc03934e6c89f48296cbe4425f`): running on live for about 35 minutes.

**Ticket writes:** 6 (EXF-553 and EXF-615 to Done with comments; two comments on EXF-573). One gap
ticket filed through this review.

**Backlog:** 58 open feature tickets (39 done; 6 in progress: EXF-520, 522, 532, 535, 473, 474). Gap:
open EXF-558, EXF-560, EXF-562, EXF-589, EXF-616, in progress EXF-614 and EXF-620, and the one filed
now. Template: thirty-two. Flow verdicts unchanged. **Finished since each template's last review: Build
10, Deploy 0, Discover 2, Test user flow 7.**

**The ten Builds for the Build template review** (ended since the review of round 62):
`p_6abff514f4ad46e8a4d902a0aacef431` (targets, carried over), `p_563250b166984564b84cb2a32e722725`
(EXF-593 guards), `p_9f66acebf3b14e939ad0a7e27b241cb2` (Reflect, lost `lib.sh`, abandoned),
`p_bce37969c15544d3aef56a825ebcb1d8` (Reflect carried over), `p_e051b02d89624ff7a3e8144e9f9710c2`
(import, failed on my own guard), `p_c81492d33faf41b1bc8a985e48688b83` (import carried over),
`p_fc9382ad6b6d49d5b8403c1b52472548` (EXF-613), `p_e02811d8e6bd45bdbfe5e34e4cbd6c0d` (two reports),
`p_3b70b79de2c54d278a92cb5686f8ed74` (Plan page), `p_38ee9709f6664cb8bbdf1208634375e3` (Age of Money).

**Next plan:** start the Build template review with those ten. Round 80 is a check-in: lead with the
bank-screens decision (still unanswered), the per-row reads found and being fixed, EXF-612 back, and
what is live.

### 2026-11-16 · Plan round 80

Children used 95 of 200. One started now; five are running with the register Build (rework committed,
head `29084dc`), the credit engine Build (building), the shell Build (at its start) and the flow test
for flows 3 and 8. Main `5ebac3c`, live `357bc4f`.

- The ticket filed at the last review exists: **EXF-621** (Age of Money's hover columns over the
  "Current" value), set to Low. It rides with the next Reflect Build.
- **Started: the Build template review** (`p_de28c2c598b74ef89e70f3a179b81b3b`; Improve templates, mode
  review, the ten Builds ended since the review of round 62, listed at the last review). What I asked
  for, in order:
  1. **Per-row database reads**: three cases in a day (the bank sync, approve and reject, the
     register's bulk service), none caught by a Build's own Architect, Reviewer, tests or gate, because
     the local database does not enforce Cloudflare's limit. Where should the template catch it: the
     design stating calls per handler, the Reviewer's checklist, a counting helper, the gate?
  2. The platform losing its own files (EXF-612, EXF-611): what the boxes held; a card that says so;
     a retry in a fresh box; the preflight's trace on the card.
  3. Carry-overs (EXF-575): three in this batch, all worked; what they cost.
  4. Gates repeated only because the base moved (EXF-564): how many hours in these ten.
  5. Source limits (EXF-573): the Designer's captures resizing the source tab in four Builds, theme
     changes, one Designer outside the named place; what in the Designer's own instructions causes it.
  6. A flake that was a defect (the Plan-page Build), and a card that names a flake without its
     failing assertion.
  7. A step changing the test instead of the code (Age of Money, caught by the Reviewer).
  8. "Run the new test once against the code before the fix": who does it.
  9. What to keep: Reviewers and Architects finding real defects and correcting me.
  10. My 15,000 to 33,000 character briefs: what could be inputs or template text.
  11. Where the Plan-page Build's four hours went.
  With the standing line: "Post evidence for an existing ticket with comment_ticket or in your report;
  never file stand-in tickets."
- **Not started:**
  - No Build: scheduled transactions and the API half of Export Plan wait for the register merge; the
    private screens wait for the person.
  - No Deploy: Age of Money ships with the register Build.
  - **The template-ticket sweep** ("about every 30 rounds") has never run and is due. Thirty-two
    template tickets are open and this review will add some; I start the sweep after it has filed
    them, so it sweeps the whole set once.
- **This is round 80: the review is a check-in.** For the report: what is live (`357bc4f`); the
  bank-screens decision, still unanswered and now holding EXF-460, 461, 463's screens, 510, 476's
  dialog, 477's dialog, 480 and 471; the per-row reads found before they could bite on live; EXF-612
  back; child budget 95 of 200 with about 58 feature tickets open.

Ticket writes: 1 (EXF-621 priority). Review cadence: Build 0 (review running), Deploy 0, Discover 2,
Test user flow 7.

### 2026-11-16 · Review round 80 (check-in)

Children used 95 of 200. One ended (the flow test for flows 3 and 8); four are running: the register
Build (rework rebased onto `5ebac3c`, head `43519e5`, heading to its gate), the credit engine Build
(building), the shell Build (started) and the Build template review. Main `5ebac3c`, live `357bc4f`
(health read by me).

**Flows 3 and 8 on live `357bc4f`** (`p_3f1312fc03934e6c89f48296cbe4425f`, prefix `ZZ-TEST F78`,
31 minutes). Cleanup: `deleted 3 remaining 0`; plans not named `ZZ-TEST`: 1. No source app, no bank
connection, no response headers printed.

- **Flow 3 (targets, snooze, Auto-Assign, next month), first run: `new_gaps`.** Every step passed on
  its figures: three kinds of target (two set in the browser), snooze by switch and by Shift+Z,
  plan-wide Underfunded (Ready to Assign 2,600.00 → 1,240.00), spending, the five views, December
  (carried balances, 1,190.00 after 50.00 of cash overspending), Auto-Assign for one category in
  December (December 790.00, and **November 840.00 with an "Assigned in Future" line of −400.00**),
  reset, the popover's Auto tab, editing and deleting a target, MCP equal to the screen, wrong calls
  refused, the history table. The cards did not move while amounts loaded (measured frame by frame).
  - **One of my figures was wrong and the test said so with the rule:** a Refill target counts
    leftover money only in the current month; in a later month it needs its full amount (EXF-511's
    observed rule). December's Phone needs 60.00, not my 45.00, and Underfunded reads 1,360.00, not
    1,345.00. The app is right.
  - My other uncertain figures held: Underfunded did not add the overspent category (50.00 in step
    3.10); the average daily spending is 45.63.
  - **Three gaps filed, triaged now:** **EXF-622** (Medium): at 1024×700 the grid squeezes a
    category's name behind its target text ("ZZ ..."). **EXF-623** (Medium): at 1024×700 the
    Auto-Assign card's labels wrap and overlap and an amount runs past the card. **EXF-624** (Low):
    the plan-wide card and the popover's Auto tab show "Underfunded $0.00" instead of hiding the
    option (the per-category card does hide it).
- **Flow 8 (Reflect), second run: `new_gaps`.** The tester checked every one of my figures by hand and
  agreed with all of them. Net Worth (seven months, EXF-591 fixed: Debts `$0.00` without the loan),
  Spending Breakdown (6,981.75; 1,396.35 a month; 45.63 a day; drill to group, category and its five
  transactions; a filter), Spending Trends (columns, tooltips, drill, table), Income v Expense (income
  by payee, expenses negative, net income 8,218.25), four exports equal to REST byte for byte or by
  content, five tools equal to REST as JSON, an empty plan's states. **No figure of one plan was ever
  painted in another** (watched with a mutation observer from document start, with the other plan's
  requests held back three seconds).
  - **One gap filed, triaged now: EXF-625** (Medium): at 1024×700 the Income v Expense table is 5 px
    wider than its scroller and the Total column is clipped ("$15,000.0").
  - **Split out by the tester and not filed; I file it now** (Low): in the same table at that width
    the first column's labels are cut ("All Income Source", "Total All Inco...").
  - An observation without a ticket: right after a drill in Spending Trends, the segment that lands
    under the pointer shows no tooltip until the pointer leaves and returns.
  - Age of Money still says "not built" on live: it is merged (`5ebac3c`) and ships with the next
    Deploy.
- **What the four gaps have in common:** all but one are layout at 1024 px. Builds test at 1024×700
  but against their own specs; nobody looks at whether text fits. For the next briefs with screens:
  "at 1024×700 no text of the new screen is cut, wrapped over its neighbour or pushed outside its box;
  a spec measures it (scrollWidth against clientWidth) for the longest label you have".

**Flow verdicts:** 1 `parity_known_gaps`; 2 `parity_known_gaps`; 3 `new_gaps` (first run); 5
`parity_known_gaps`; 8 `new_gaps` (figures all right; one layout gap); 9 `new_gaps` (EXF-614, in
progress); 10 `parity`; 11 `parity`; 4, 6, 7 not run (credit cards, reconcile and file import,
scheduled transactions are not built).

**Running:**
- **Register Build** (`p_7bb9ae1dcb8e4106b60f405a6002857e`): rework rebased onto `5ebac3c`.
- **Credit engine Build** (`p_34bc1879fb924226b6a197db43cfeb20`): building for 35 minutes; no commit
  after the design yet.
- **Shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`): at its start.
- **Build template review** (`p_de28c2c598b74ef89e70f3a179b81b3b`): reading.

**Check-in sent** (round 80). Its points: what is live; what landed since round 70 (the bank import
proven against the Sandbox, the sync's call budget, two Reflect reports, the Plan page's views, snooze
and Auto-Assign; Age of Money merged); the per-row reads I found by reading code (one fixed and live,
one live and being fixed); the platform's lost files back; **the bank-screens decision, unanswered
since round 60 and now holding eight tickets**; whether the Cloudflare account is on the Free plan;
when a real bank can be connected; child budget 95 of 200.

**Ticket writes:** 6 (four priorities, comments on EXF-622 and EXF-625). One gap ticket filed through
this review.

**Backlog:** 58 open feature tickets (39 done; 6 in progress: EXF-520, 522, 532, 535, 473, 474). Gap:
open EXF-558, EXF-560, EXF-562, EXF-589, EXF-616, EXF-621, EXF-622, EXF-623, EXF-624, EXF-625 and the
one filed now; in progress EXF-614, EXF-620. Template: thirty-two. Finished since each template's last
review: Build 0, Deploy 0, Discover 2, Test user flow 8.

**Next plan:** set the new ticket to Low. **A small Reflect Build is free to start:** EXF-625, the
label ticket and EXF-621 (the Reflect files are held by nobody). The Plan-page gaps (EXF-622, EXF-623,
EXF-624, EXF-616) wait for the credit engine merge. Register merge → Deploy `D22` → scheduled
transactions and the API half of Export Plan.

### 2026-11-16 · Plan round 81

Children used 99 of 200. Four started now; five are running with the shell Build (designed, head
`51f2885`). Main `8ec621e`, live `357bc4f`. Journal branch merged up to main.

**Three children ended since review 80; their full record is for review 81. What this plan needed
from them:**
- **The register Build merged as `8ec621e`** (third card, approved in a side turn: gate on `5ebac3c`,
  353 of 353 three times, no flakes; the merge commit's tree equals the gated head `43519e5`). I read
  the rework: `prepare()` takes pre-read lines, other sides, accounts and category names and makes no
  database call when it has them; approve and reject read once per attempt; the counting test asserts
  the same number of calls for 10 and for 100 rows and at most 20, and failed on the old code (clear
  28 against 217, approve 44 against 424, reject 22 against 202); the rule is in `docs/conventions.md`.
  Three small known issues accepted. 68 tools on main; migration `20261116101000_transaction_flags.sql`
  pending on live.
- **The credit engine Build ended without a pull request, by my Abandon at its `checks_stuck` card.**
  Its box had lost the platform's files (the preflight had said so); `pnpm check` passed by hand three
  times with 1,476 tests while the platform's `checks` step failed with no log. The branch has
  everything (head `a8ed5b7`).
- **The Build template review ended**; I approved all twelve proposals in a side turn (three new
  tickets, eight evidence comments). Its findings are for review 81, among them: **Designers went
  outside the named place in six of seven Builds**, which I follow up there.
- The ticket filed at the last review exists: **EXF-626** (Income v Expense's cut labels), set to Low.

**Started:**
1. **Deploy `D22`** (`p_dcdf16fb4bdc45e58b02a72506cae2cd`; `expect_commit` `8ec621e`, gated head
   `43519e5`, trees identical). Two merges: Age of Money and the register.
   - **The check this release most needs:** 60 unapproved rows approved in one call, and bulk actions
     over 60 rows in one call each: the proof on live of the fixed number of database calls (EXF-620).
     The create request takes `approved` false, so no bank is needed.
   - Also: clear, categorize, flag, memo, move, duplicate, delete with balances I derived (440000,
     450000 and −10000, 445000, 465000), the export, Age of Money through REST, MCP and the tab; 68
     tools; at 1024×700 a measured look at the action bar.
   - New standing lines: "never print response headers"; "DIFFERS FROM THE BRIEF: expected …, read …";
     compare the health value with `origin/main`, not the local HEAD.
   - **No Build card is approved while it runs.**
2. **The credit engine, carried over** (`p_d256d73e55104993a05ccac960529443`). I merged the old branch
   onto main `8ec621e` in a throwaway worktree first: clean, 55 files, 3,422 insertions. The Clerk
   merges it with exact commands and stops if the head is not `a8ed5b7`. New work only: the calls per
   handler stated (the new conventions rule), the ticket's misprint in example B accepted (722.77), a
   measured check at 1024×700, the backfill checked for name clashes. Its Designer, Reviewer and
   Tester run for the first time.
3. **Scheduled transactions** (`p_900d4c34d7c6414a980c2d1d87cfba26`; EXF-497 with EXF-499; they block
   the plan import EXF-477 and flow 7). The register files are free since the merge.
   - **My decisions:** hyphenated paths; plain rows only (no scheduled splits or transfers); a pure
     recurrence module in `packages/schema` with the ticket's examples as tests; **entering what is
     due has two callers**: the web app when a plan opens, with the browser's date, and the daily cron
     as a backstop with the day before the UTC date, so it never enters a transaction dated in the
     owner's future (the app has no time zone setting). The cron's part shares the invocation's call
     budget with the bank sync and has a counting test.
   - For scheduled rows the action bar offers Enter Now and Delete; the other bulk actions are drawn
     disabled (a ticket after the merge).
   - **Manifest estimate against the others:** its own new files, `register/**`, `scheduled.ts`,
     `sync-budget.ts`, one line in `app.ts` (shared; nobody else changes it). It must not edit the
     accounts service (the credit carry-over holds it) nor `wrangler.jsonc`.
   - Source: the test plan's All Accounts register; the add row may be opened to see the calendar and
     the Repeat select and is left with Cancel.
4. **Reflect narrow-window fixes** (`p_7aa8691536924481bf53c457c86b24ea`; EXF-625, EXF-626, EXF-621).
   Small, web only. **No source app:** nothing at 1024 px can be compared in a tab that is never
   resized. (An outright ban has not bound a Designer before; if this one opens the source anyway, the
   place is the test plan's Reflect, which holds no private data.)

**Changed in every brief from now on** (from the template review and today's losses): the Clerk
creates no other file under `.exfab` and lists the directory; "if the platform's files are missing,
say so at once and do not re-run checks that pass" (my earlier line "request.json is normally gone"
was wrong: in a healthy box it stays); source captures with the plain call and no options, the tab's
size read before and after; nothing written into the source page; a test for a finding run against the
old code by the step that writes it; a departure from an acceptance case listed separately; a measured
check at 1024×700 for new text.

**Not started:** the template-ticket sweep (next round, once the three new template tickets have
priorities); Export Plan's API half (after the credit engine: it reads the month figures that Build
changes); the Plan-page gaps EXF-622, 623, 624, 616 (after the credit engine); the private screens.

Ticket writes: 10 (EXF-626 priority and state; EXF-625, 621, 497, 499 to In Progress; comments on
EXF-625, 497, 499, 532). Review cadence: Build 2 since the review (the register Build and the
abandoned credit Build), Deploy 0, Discover 2, Test user flow 8.

### 2026-11-16 · Review round 81

Children used 99 of 200. Since review 80 four children ended: the register Build (merged), the first
credit engine Build (abandoned by me), the Build template review, and now Deploy `D22` (cancelled by
me; nothing shipped). Four are running: the shell Build, the credit engine carry-over, scheduled
transactions and the Reflect fixes. Main `8ec621e`, **live still `357bc4f`** (health read by me; the
pending script still lists `20261116101000_transaction_flags.sql`).

**Deploy `D22` lost its box and shipped nothing** (`p_dcdf16fb4bdc45e58b02a72506cae2cd`).
- 14:03: its intake recorder wrote `deploy.env` and read it back. 14:07: the recorder after the gate
  found `/workspace/.exfab/` holding only `desktop-keeper.json` and `prompts/`: the gate's summary and
  even that `deploy.env` were gone. It refused to guess the gate's values and asked me for help.
- I answered: record nothing, release nothing; a release must not rest on values somebody typed in.
  Then I cancelled the Thread at this review so that a new Deploy can start.
- **This is EXF-612 in a new direction** (a code step's output missing for the next agent step; the
  Deploy review an hour ago had concluded only agent-to-code hand-offs break). Evidence posted there.
- **Seven children have now been lost to this fault today** (four Builds, three Deploys). It is the
  largest single cost of this clone, and it is outside what I can fix.

**Register Build merged as `8ec621e`** (`p_7bb9ae1dcb8e4106b60f405a6002857e`; three cards: Regate for a
moved base, Request changes for per-row reads, Approve). EXF-520, EXF-522 and EXF-620 are Done with
comments. What it put on main: selection, the action bar with Selected Total, ten bulk actions through
the single-edit rules, flags (`transactions.flag_color`, migration `20261116101000`), a register
export, tools `bulk_update_transactions`, `delete_transactions`, `flag_transactions` (**68 tools on
main**), the UI state key `hide_register_export_dialog`, the conventions section "Services: D1 calls",
and `apps/worker/test/bulk-call-count.test.ts`. Three small leftovers accepted at the merge are filed
now as one Low ticket.

**First credit engine Build: ended by my Abandon at its `checks_stuck` card**
(`p_34bc1879fb924226b6a197db43cfeb20`). Its work is on its branch (`a8ed5b7`) and the carry-over
(`p_d256d73e55104993a05ccac960529443`) has merged it (head `f3d393c` on base `8ec621e`).

**Build template review** (`p_de28c2c598b74ef89e70f3a179b81b3b`): all twelve proposals approved and
carried out. Priorities set now:
- **EXF-627** (High): a request's database calls do not grow with its rows (profile limits, a counting
  helper, a Reviewer line, an Architect acceptance case).
- **EXF-628** (Medium): a departure from an acceptance case blocks review; a test for a finding is run
  against the old code; what must be kept of the Reviewer.
- **EXF-629** (Medium): out-of-bounds files as an input every step sees; standing rules into the
  template and the conventions.
- Evidence on EXF-612, 611, 575, 564, 573, 576, 563 and 457.
- **What I take from it for my own work:**
  - **Designers went outside the named place in six of seven Builds** and none restated the limits.
    Every case was inside the source's test plan (by the tab's address); the transcripts show nothing
    saved, though nothing re-read the rows to prove it. The cases: All Accounts opened and a row left
    ticked (the guards Build); attributes written into the source page (targets); a deliberate width
    change and a click on the sidebar's Plan link (Reflect carry-over); the page's markup read
    (two reports); the source tab found by address instead of by its stored id (Plan page); clicks in
    the Categorize menu (register). **No private data, but the limits are not holding for this one
    step**, and a brief cannot fix it: EXF-573 stays Urgent. My new briefs add "write nothing into the
    page", "leave no row ticked", "plain capture, size before and after".
  - In a healthy box `request.json` is still there at the Tester: my line that it is "normally gone"
    was wrong and is out of the briefs since plan 81.
  - "Complete, do not redesign; only fix" in my carry-over briefs made two Implementers skip new cases
    the Architect had added. The credit carry-over's brief says instead that anything the Architect
    adds is new work to build and test.
  - Gates repeated only because the base moved cost about 37 minutes in ten Builds: less than I
    thought. The expensive cycle was the layout defect hidden behind "flakes" (about 110 minutes).

**Running:**
- **Shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`): designed (`51f2885`), building; on base
  `5ebac3c`, so its card will need a regate.
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): branch merged, head `f3d393c`.
- **Scheduled transactions** (`p_900d4c34d7c6414a980c2d1d87cfba26`) and **Reflect fixes**
  (`p_7aa8691536924481bf53c457c86b24ea`): at their start.

**Ticket writes:** 11 (EXF-520, 522, 620 to Done; comments on EXF-520, 620 and two on EXF-612, the
second correcting my count in the first; three priorities). One gap ticket filed through this review.

**Backlog:** 56 open feature tickets (41 done; 6 in progress: EXF-532, 535, 473, 474, 497, 499). Gap:
open EXF-558, EXF-560, EXF-562, EXF-589, EXF-616, EXF-622, EXF-623, EXF-624 and the one filed now; in
progress EXF-614, EXF-621, EXF-625, EXF-626. Template: thirty-five (EXF-573 and EXF-612 Urgent). Flow
verdicts unchanged. Finished since each template's last review: Build 2, Deploy 1, Discover 2, Test
user flow 8.

**Next plan:** a new Deploy for `8ec621e` (prefix `ZZ-TEST D23`; the same brief; it is child 100).
The template-ticket sweep, now that the three new tickets have priorities. No Build card is approved
while the Deploy runs.

### 2026-11-16 · Plan round 82

Children used 101 of 200. Two started now; six are running with the shell Build, the credit engine
carry-over, scheduled transactions and the Reflect fixes. Main `8ec621e`, live `357bc4f` (health read
by me; `20261116101000_transaction_flags.sql` still pending).

- The ticket filed at the last review exists: **EXF-630** (three leftovers of the register's bulk
  actions), set to Low.
- **Started: Deploy `D23`** (`p_596994876dd74d549f308074a946366c`), the second attempt at `8ec621e`
  after `D22` lost its box. Same inputs (`expect_commit` `8ec621e`, gated head `43519e5`, trees
  identical: checked again) and the same checks, with the prefix `ZZ-TEST D23` and one new paragraph:
  every agent step lists `/workspace/.exfab` first and pastes the listing; if a file it needs is
  missing it answers "PLATFORM FILES MISSING IN THIS BOX" with the listing and stops, and nothing is
  released on a record that was typed in. So a second loss costs minutes, not a guess, and each
  listing is evidence for EXF-612 either way.
  - **No Build card is approved while it runs.** Four Builds are open; the shell Build is nearest its
    card and is on an old base anyway (Regate).
- **Started: the template-ticket sweep** (`p_552c46323a86456abb5d968e351a103e`; Improve templates, mode
  sweep), the first in 82 rounds; 35 template tickets are open. Two reviews today found nothing to
  close, so I asked for more than duplicates: one ordered list of the whole set by what each fault has
  cost this clone, grouped by what has to change (the platform's boxes, the Build template's prompts,
  its code steps, the Deploy template, the profile); priorities that no longer fit; texts a later
  finding has overturned; and anything that is really a ticket of the app. It proposes; I approve.
  With the standing line: "Post evidence for an existing ticket with comment_ticket or in your report;
  never file stand-in tickets."
- **Not started:** no new Build (the four running hold the shell, the Plan page and engine, the
  register and transactions, and Reflect); Export Plan's API half and the Plan-page gaps wait for the
  credit engine; flow tests wait for `D23`.
- **Child budget, looked at again at the half-way mark:** 101 used. Of those, seven were lost to the
  platform's boxes and four were the carry-overs that redid them, and about ten were template reviews
  and the sweep. For the 56 open feature tickets and nine open gaps I still expect about 25 Builds, 12
  Deploys, 12 flow tests and 5 reviews: about 55. That fits in the 99 left with room for losses at
  today's rate, but not for much more than that.

Ticket writes: 1 (EXF-630 priority). Review cadence: Build 2, Deploy 1 (cancelled `D22`), Discover 2,
Test user flow 8; the template-ticket sweep is running.

### 2026-11-16 · Review round 82

Children used 101 of 200. One ended since review 81: Deploy `D22`, as abandoned after my cancel
(recorded at review 81; nothing shipped). Six are running. Main `8ec621e`, live `357bc4f` (health read
by me; one migration still pending).

**Running, as read now:**
- **Deploy `D23`** (`p_596994876dd74d549f308074a946366c`): its intake recorder wrote `deploy.env` at
  14:14; the gate is running. Nothing to judge yet.
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): healthy box. The Clerk's merge
  matched my figures exactly (55 files, 3,422 insertions, 122 deletions, no conflict); `pnpm check`
  passes on the merge (1,532 tests). The Architect's "Carry-over" section is committed (`8b5f2db`).
  - **The new conventions rule found a fourth per-row read on its first use:** creating a credit
    account reads the payment group first, and creating accounts from a bank connection ran that read
    once per account. It is being removed, with a counting test at 10 and 100 rows that must fail on
    the old code. So the rule works when a step is asked to state calls per handler; the first three
    cases were found by me reading code, this one by the Build itself.
  - Backfill: names are never compared and no unique index covers names, so a card named like an
    ordinary category is safe; the test gains that case. The partial-cover rule gets a Worker test
    with an exact table. A narrow-window spec with the tickets' longest amounts is added.
- **Shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`): implemented (`de012f7`), on base `5ebac3c`;
  its card will need a regate, and is not approved while `D23` runs.
- **Scheduled transactions** (`p_900d4c34d7c6414a980c2d1d87cfba26`) and **Reflect fixes**
  (`p_7aa8691536924481bf53c457c86b24ea`): no commit yet.
- **Template-ticket sweep** (`p_552c46323a86456abb5d968e351a103e`): reading.

**Ticket writes:** 0.

**Backlog:** unchanged: 56 open feature tickets (41 done; 6 in progress). Gap: open EXF-558, EXF-560,
EXF-562, EXF-589, EXF-616, EXF-622, EXF-623, EXF-624, EXF-630; in progress EXF-614, EXF-621, EXF-625,
EXF-626. Template: thirty-five. Flow verdicts unchanged. Finished since each template's last review:
Build 2, Deploy 1, Discover 2, Test user flow 8.

**Next plan:** nothing free to start; wait for `D23` and the cards. After `D23`: a flow test for flow 2
again (bulk actions, flags, the register export) with a check that 60 imported rows can be rejected in
one call needs a Sandbox bank, so it goes with the next run of flow 5.

### 2026-11-16 · Plan round 83

Children used 101 of 200. Nothing started; six are running: Deploy `D23` (at its gate), the credit
engine carry-over (the Implementer is on the carry-over tasks), the shell Build (implemented, head
`de012f7`, base `5ebac3c`), scheduled transactions and the Reflect fixes (no commit yet) and the
template-ticket sweep. Main `8ec621e`, live `357bc4f`. No tickets were filed at the last review.

- **Why nothing new:** the four Builds hold the shell, the Plan page with the engine, the register
  with the transactions files, and Reflect. Every unblocked ticket needs one of those. The private
  screens still wait for the person's word.
- **No second Deploy and no flow test** while `D23` is in flight: a flow test on live would run against
  a version that is about to change.
- **Cards:** none is approved while `D23` runs. The shell Build's card, when it comes, gets a Regate
  (its base is two merges old).

Declared for the tree: Export Plan's API half (EXF-476) and the Plan page's card rows with the
Plan-page gaps (EXF-537 with EXF-622, 623, 624, 616), both after the credit engine merges; flow 2
again after `D23`; the next Deploy after the next merges.

Ticket writes: 0. Review cadence: Build 2, Deploy 1, Discover 2, Test user flow 8.

### 2026-11-16 · Review round 83

Children used 101 of 200. One ended: **Deploy `D23`, shipped**. Five are running: the shell Build, the
credit engine carry-over, scheduled transactions (designed), the Reflect fixes (designed) and the
template-ticket sweep (carrying out what I approved). Main `8ec621e`, **live `8ec621e`**: nothing
merged is waiting.

**Deploy `D23` shipped `8ec621e`** (`p_596994876dd74d549f308074a946366c`, 9 minutes) to
https://budget.doxen.dev. I read the health endpoint myself (`deploy_sha` `8ec621e…`) and the pending
script prints nothing.

- **The box was whole this time.** The verifier's listing of `/workspace/.exfab` shows `deploy.env`,
  `summary.txt`, `profile.txt`, `deploy.out`, `release.env` and the step scripts. So the loss that
  ended `D22` ten minutes earlier is per box, as before. The listing is the first record of what a
  healthy Deploy box holds.
- Gate: check passed (161 s), e2e skipped because the tree equals the gated head `43519e5`. Release:
  the Time Travel bookmark ran first; `20261116101000_transaction_flags.sql` applied; smoke ok.
- **EXF-620 proven on live:** 60 unapproved rows approved in **one call**, 200 in 582 ms. Each bulk
  action over 60 rows in one call, 200 in 300 to 550 ms. A request with 101 ids answers 422 and
  changes nothing. (Comment on EXF-620.)
- Every figure I derived matched: balances 440000, 450000 and −10000, 445000, 465000; the export's 36
  rows; Age of Money `current_days` 0; 68 tools. The verifier wrote "nothing differs".
- One limitation it named itself: its script cut the bulk answers, so the `changed` and `skipped`
  counts were not read; it proved each action by reading the rows back instead.
- In the browser at both sizes: the action bar with "2 Transactions" and Selected Total −$2.00, the
  flag menu (green set and read back), the More menu with Match, Unmatch and Make Repeating disabled,
  Duplicate; **at 1024×700 no text of the bar or its menus is cut** (measured); Age of Money shows
  "Current 0 days" and its chart. No console error, no failed request.
- A copy made by Duplicate keeps the memo and the category and carries no flag.
- Cleanup: the plan was deleted by id and the prefixed purge then printed `deleted 0 remaining 0`;
  plans not named `ZZ-TEST`: 1. The owner's plan was not opened. No response headers were printed.

**Now live for the first time:** Age of Money (all five Reflect reports), selecting rows in the
register, the action bar and bulk actions, flags, the register export, approve and reject with a fixed
number of database calls; 68 tools.

**The template-ticket sweep's card, answered in a side turn: approve all** (seventeen comments, one
closure: EXF-455 as superseded; no new ticket). It is still posting them; its report and my priority
changes are for the next review. What it gave me beyond tidying:
- one ordered list of all 35 tickets by what each fault has cost this clone, grouped by what has to
  change; it is the hand-over document for whoever maintains the templates;
- one code step proposed three times, one run prefix and two profile keys proposed twice, each now
  with one owner;
- priority proposals I accept and will set: EXF-611 to Urgent and EXF-582 to High (the mitigations
  within reach for the lost boxes), EXF-578 up, EXF-457, EXF-554, EXF-565 and EXF-568 down;
- app work it noticed: a test still skipped on main and a retry patched into a spec without
  confirming its cause; the Plaid credentials script. I checked all three on main and file one Low
  ticket now.

**Running:**
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): on the carry-over tasks.
- **Shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`): implemented (`de012f7`), base `5ebac3c`.
- **Scheduled transactions** (`p_900d4c34d7c6414a980c2d1d87cfba26`): design committed (`423ea8c`); I
  read its manifest at the next review.
- **Reflect fixes** (`p_7aa8691536924481bf53c457c86b24ea`): plan committed (`3e0f6ca`).

**Ticket writes:** 1 (comment on EXF-620). One gap ticket filed through this review.

**Backlog:** 56 open feature tickets (41 done; 6 in progress). Gap: open EXF-558, EXF-560, EXF-562,
EXF-589, EXF-616, EXF-622, EXF-623, EXF-624, EXF-630 and the one filed now; in progress EXF-614,
EXF-621, EXF-625, EXF-626. Template: thirty-five, thirty-four once EXF-455 is closed. Flow verdicts
unchanged. Finished since each template's last review: Build 2, Deploy 2 (one cancelled, one shipped),
Discover 2, Test user flow 8.

**Next plan:** with nothing in flight on live, a flow test: flow 2 again (the register's selection,
bulk actions, flags and export are new there) together with flow 1 as a regression. Cards may be
approved again (no Deploy running).

### 2026-11-16 · Plan round 84

Children used 102 of 200. One started now; five are running with the shell Build, the credit engine
carry-over, scheduled transactions and the Reflect fixes. (The template-ticket sweep has ended; its
report is for the next review.) Main `8ec621e`, live `8ec621e`.

- The ticket filed at the last review exists: **EXF-631** (three leftovers in the repository), set to
  Low.
- **Started: flow 2, third run, on live** (`p_e031b218fd5b42bf981f4d1bfa178a3b`; prefix `ZZ-TEST F84`).
  The Deploy's check proved the bulk API; this run walks what a person does: ticking rows, the header
  checkbox, ctrl+A, shift+click, the Selected Total; Categorize, flags (menu and shift+F), `C`, Memo,
  Move to Account (and a refused move into a tracking account), Duplicate, Delete of a plain row, a
  transfer and a split; the export from a selection; what is drawn disabled; Approve for an
  unapproved row; that typing in a field is not a command; All Accounts; another plan never showing
  this plan's selection; a measured look at 1024×700; REST and MCP against the screen; the history
  table.
  - The setup is seeded through REST so that every balance after each step is known: 802.66 at the
    start, then 797.66, 827.66, 787.66, 827.66, 1,027.66, 1,127.66, 1,120.66, 1,127.66; Cleared 900.00
    and Uncleared −102.34 after clearing four rows; Hobbies −170.00 then −130.00; Dining −82.34 then
    −22.34. As before: "DIFFERS FROM THE BRIEF" with the tester's own arithmetic if one of mine is
    wrong.
  - New in the brief: a separate fault noticed beside a gap is filed as its own ticket by the tester
    (the last run left one in the report for me to file).
  - No source app, no bank connection, no response headers.
- **Not started:** no Build (the four running hold every free ticket's files); no Deploy (main and
  live are equal). Flow 8 is rerun after the Reflect fixes are live, flow 7 after scheduled
  transactions, flow 4 after the credit engine and its screens.

Ticket writes: 1 (EXF-631 priority). Review cadence: Build 2, Deploy 2, Discover 2, Test user flow 8
(the ninth is running).

### 2026-11-16 · Review round 84

Children used 102 of 200. One ended: the template-ticket sweep. Five are running: the shell Build
(polish, head `459f5fb`, now on base `8ec621e`), the credit engine carry-over, scheduled transactions
(designed), the Reflect fixes (planned) and the flow test for flow 2. Main and live `8ec621e`.

**Template-ticket sweep** (`p_552c46323a86456abb5d968e351a103e`; 13 minutes): seventeen comments posted,
EXF-455 closed as superseded, no new ticket, nothing failed. Thirty-four template tickets are open.
- **Priorities set now, as it proposed:** EXF-611 to Urgent (retry in a fresh box and a card that
  shows the cause: the mitigation within reach while EXF-612's cause is unknown); EXF-582 to High (it
  now holds the Deploy slice that removes the file hand-offs which lost three Deploys); EXF-578 up to
  Medium; EXF-457 and EXF-554 down to Medium; EXF-565 and EXF-568 down to Low. Urgent now: EXF-573,
  EXF-611, EXF-612.
- **Its ordered list is the hand-over document** for whoever maintains the templates and the
  platform: every ticket grouped by what has to change (the platform's boxes and hand-offs; the Build
  template's prompts; its code steps and gate; the Deploy template; Discover and Test user flow; the
  profile's schema), ordered by what each has cost this clone, with its kind (prompt text, code step,
  profile key, platform work). It is in the sweep's report in full, and the inventory of about 25
  proposed profile keys is on EXF-456.
- Cheapest fixes with the most return, by its figures: EXF-563 (about 3.4 hours of idle waiting in 11
  Builds; prompt text and a helper), EXF-585 (the first answer failed in 7 of 8 Deploys), EXF-628
  (prompt text only).
- The app work it noticed is ticketed since the last review (EXF-631).

**Scheduled transactions: design read and accepted** (`docs/scheduled-transactions-design.md` at
`423ea8c`; comment on EXF-497).
- Manifest against the credit carry-over, the shell and the Reflect Builds: disjoint. One new table;
  no query over `transactions` changes. It touches `services/transactions.ts` (one exported helper;
  free since the register merge) and `services/plaid-sync.ts` (an optional cap for the cron's shared
  budget); `app.ts` is not touched after all (routes are collected by a glob).
- It states D1 calls per operation (2 to 8; the bulk request 5 whatever the ids; entering what is due
  3) and keeps the cron's invocation at 41 with the bank sync.
- Added by the Architect, accepted: a `/bulk` route for Enter Now and Delete over several rows; a
  write token on each schedule as the race guard.
- **Two limits of this Build to ticket when it merges:** entering what is due is triggered by the
  account pages only (the Plan page and Reflect are other Builds' files); deleting a category leaves
  its schedules uncategorized.
- **Nothing could be compared with the source:** the test plan has no schedule and **its Add
  Transaction button is disabled, because the test plan's accounts are all closed.** That also means
  no later Build can compare the add row there. If the register's entry is to be compared again, the
  test plan needs an open account: a change in the source's test plan, which the person allowed for
  that plan but which I have kept children from making. To raise at the next check-in.

**Running:**
- **Shell Build** (`p_d3d3715280e84394b76bb90f3dc0d418`): in polish, rebased onto `8ec621e`.
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): building the carry-over tasks.
- **Reflect fixes** (`p_7aa8691536924481bf53c457c86b24ea`): planned (`3e0f6ca`).
- **Flow 2** (`p_e031b218fd5b42bf981f4d1bfa178a3b`): walking on live.

**Ticket writes:** 8 (seven priorities; comment on EXF-497).

**Backlog:** 56 open feature tickets (41 done; 6 in progress). Gap: open EXF-558, EXF-560, EXF-562,
EXF-589, EXF-616, EXF-622, EXF-623, EXF-624, EXF-630, EXF-631; in progress EXF-614, EXF-621, EXF-625,
EXF-626. Template: thirty-four (three Urgent). Flow verdicts unchanged. Finished since each template's
last review: Build 2, Deploy 2, Discover 2, Test user flow 8; the next template-ticket sweep is due
about round 114.

**Next plan:** nothing free to start; wait for the cards (the shell Build first) and the flow test.

### 2026-11-16 · Plan round 85

Children used 102 of 200. Nothing started; five are running: the shell Build (in polish, on base
`8ec621e`), the credit engine carry-over, scheduled transactions (designed), the Reflect fixes
(planned) and the flow test for flow 2 on live. Main and live `8ec621e`. No tickets were filed at the
last review.

- **Why nothing new:** unchanged from plan 83. The four Builds hold the shell, the Plan page with the
  engine, the register with the transactions files, and Reflect; every unblocked ticket needs one of
  them. Main and live are equal, so there is nothing to deploy, and one flow test is already on live.
- **Cards can be approved** (no Deploy in flight). The shell Build is nearest.

Ticket writes: 0. Review cadence: Build 2, Deploy 2, Discover 2, Test user flow 8 (the ninth is
running).

### 2026-11-16 · Review round 85

Children used 102 of 200. One ended: the flow test for flow 2. Four Builds are running: the shell
(polish, head `ddaf0ff`), the credit engine carry-over (head `fb643e7`, narrow-window fixes), scheduled
transactions (head `021ffff`, review nits) and the Reflect fixes (head `a0ffff3`). All four are on
base `8ec621e`. Main and live `8ec621e`.

**Flow 2, third run, on live `8ec621e`** (`p_e031b218fd5b42bf981f4d1bfa178a3b`, prefix `ZZ-TEST F84`,
about 25 minutes): **`new_gaps`**. Cleanup: `deleted 2 remaining 0`; plans not named `ZZ-TEST`: 1. No
source app, no bank connection, no response headers, no platform file missing.

- **Every balance and figure I derived matched** (802.66 → 797.66 → 827.66 → 787.66 → 827.66 →
  1,027.66 → 1,127.66 → 1,120.66 → 1,127.66; Cleared 900.00 and Uncleared −102.34; Hobbies −170.00 then
  −130.00; Dining −82.34 then −22.34; 11 rows, then 8 in the export).
- **Passed through the interface with a real mouse and keyboard, at both sizes where asked:** entry
  with a remembered payee; ticking rows, the header checkbox, ctrl+A, Escape, the Selected Total;
  Categorize through the menu and its submenu; flags by the bar, by a row's flag cell and by `shift+F`
  then a digit; `C` toggling cleared; the Memo dialog; Move to Account; Duplicate; Delete of a plain
  row, a transfer (both sides) and a split; the export of a selection (byte for byte the REST export);
  Approve for an unapproved row; typing in a field is not a command; no trace of one plan's selection
  or rows in another (watched from before the first script ran); nothing cut at 1024×700; MCP's bulk
  tools equal to the screen; one history row per changed transaction.
- **Three gaps filed, triaged now, all Medium:**
  - **EXF-635:** shift+click does not select a range. EXF-520 does not describe it, but the source's
    own shortcut list (EXF-473) names "shift click" and "shift ↑/↓"; I noted that on the ticket so the
    fix covers both. **My brief expected the range and also got its total wrong** (I assumed the rows
    sit in the order I created them; the register sorts them otherwise). The tester said so with the
    arithmetic.
  - **EXF-636:** on All Accounts the More menu has no Move to Account.
  - **EXF-637:** a refused bulk action shows the transaction's internal id at the start of its message.
- Observations without a ticket: the Memo dialog's Update button is disabled while the field is empty,
  so the bar cannot clear memos (what the source does is unknown); deleting a transfer asks nothing.
- **The three gaps are in the register's files**, held by the scheduled-transactions Build. They go,
  with EXF-630 and the scheduled rows' bulk actions, into one register follow-up Build after it merges.

**Flow verdicts:** 1 `parity_known_gaps`; 2 `new_gaps` (third run: three interface gaps, no wrong
figure); 3 `new_gaps`; 5 `parity_known_gaps`; 8 `new_gaps`; 9 `new_gaps` (EXF-614, in progress); 10
`parity`; 11 `parity`; 4, 6, 7 not run.

**Running (no card yet):** all four Builds have moved since the plan: the shell Build is in its
polish rounds, the credit carry-over is fixing its narrow-window findings (its own measured check
found a pill and an inspector header that did not fit: the new brief line works), scheduled
transactions is past its first review, the Reflect fixes have their specs.

**Ticket writes:** 4 (three priorities; comment on EXF-635).

**Backlog:** 56 open feature tickets (41 done; 6 in progress). Gap: open EXF-558, EXF-560, EXF-562,
EXF-589, EXF-616, EXF-622, EXF-623, EXF-624, EXF-630, EXF-631, EXF-635, EXF-636, EXF-637; in progress
EXF-614, EXF-621, EXF-625, EXF-626. Template: thirty-four. Finished since each template's last review:
Build 2, Deploy 2, Discover 2, Test user flow 9. **The next finished flow test is the tenth: the Test
user flow template review follows it** (it has never been reviewed).

**Next plan:** nothing free to start; the four Builds' cards come next, then a Deploy for what merges.

### 2026-11-16 · Plan round 86

Children used 102 of 200. Nothing started; four Builds are running. Main and live `8ec621e` (the shell
Build's merge has not landed in my checkout yet). No tickets were filed at the last review.

**Three cards arrived together in a side turn, all gated on `8ec621e` with clean gates:**
- **Shell Build (pull request 45): approved.** Gate 375 of 375 three times, changed specs 380 of 380,
  no flakes, no known issues. I read the branch: only shell files, the new `apps/web/src/shortcuts/`
  module, one menu-action file, shell specs and docs; the dispatcher calls `preventDefault` only for a
  shortcut with a registered handler and does nothing in a field or while a dialog or menu is open;
  the sidebar's state is read from storage synchronously (first paint has the saved width); on a plan
  that was not found the sidebar draws no plan links, no prompt and no Add Account.
- **Scheduled transactions (pull request 48) and the Reflect fixes (pull request 46): Regate.** All
  three pull requests add a line at the same place in `docs/README.md`, so only one can merge onto
  `8ec621e`. I approved the shell Build first because its gate is the most expensive to repeat. A quick
  read of the other two branches showed no out-of-bounds file and no skipped test; I read them in full
  at their next cards.
  - **Order from here:** whichever of the two comes back first on the new main is approved after I
    have read it; the other is regated once more. Three merges in a row cost two extra gates; with
    EXF-564 (the docs line written at land) they would cost none.
- **The Reflect Build's Designer ignored the ban on the source app** ("nobody opens, reads or
  captures it; the tab is never resized"): it changed the source report's date range and set it back,
  captured the source at a 1024-pixel width, and then wrote that the source tab was untouched. The
  place was the test plan's Reflect, no private data, and its two polish findings were real. The
  other four steps kept the ban. Evidence posted on EXF-573: the third outright ban ignored by that
  step. **I stop writing outright bans for Builds that change a file under `apps/web/`: they do not
  hold and they produce a false statement in the report. A limited permission with the one place
  named is what I write, also when there is nothing to compare.**

**Running:** the shell Build (landing), the credit engine carry-over (head `fb643e7`, fixing its
narrow-window findings), scheduled transactions and the Reflect fixes (both regating).

**Nothing new to start:** the same four hold every free ticket's files. When the shell merge lands and
one more follows, a Deploy ships them; the register follow-up Build (EXF-635, 636, 637, 630, the
scheduled rows' bulk actions, and moving the "enter what is due" trigger into the shell) starts when
scheduled transactions has merged.

Ticket writes: 2 (two comments on EXF-573; the second corrects a count in the first that I could not
support). Review cadence: Build 2, Deploy 2, Discover 2, Test user flow 9.

### 2026-11-16 · Review round 86

Children used 102 of 200. One ended: the shell Build, merged. Three Builds are running: the credit
engine carry-over (head `fb643e7`, base `8ec621e`) and, both regating on the new main, scheduled
transactions (head `2e5e291`) and the Reflect fixes (head `4fb2983`). Main `85f3cc9`, live `8ec621e`.
Journal branch merged up to main.

**Shell Build merged as `85f3cc9`** (`p_d3d3715280e84394b76bb90f3dc0d418`; EXF-473 Keyboard Shortcuts
dialog and registry, EXF-474 sidebar collapse and resize, EXF-614 the sidebar on a plan that was not
found; about two hours, one card). The merge commit's tree equals the gated head `ddaf0ff`. The three
tickets are Done with comments.
- On main: `apps/web/src/shortcuts/` (registry, dispatcher, dialog, key caps, shortcut tooltip);
  `apps/web/src/shell/sidebarState.ts` and `useSidebarState.ts`; the menu action
  `menu-actions/keyboard-shortcuts.tsx`; specs `shortcuts`, `shortcuts-registry`, `sidebar-collapse`,
  `sidebar-not-found`. No Worker change; 68 tools as before; no migration.
- **Left on purpose:** only `?` and Shift+. are bound through the registry. The Plan page's and the
  register's shortcuts still run on their own listeners; binding them through the registry is a
  refactor for the Builds that hold those files. The dialog lists every shortcut of the source,
  including ones whose features are not built (Undo, Reconcile, search, the date picker's keys): each
  has its feature ticket.
- **Not compared with the source:** the drag, the snap and the hidden balances (the source's edge is
  never dragged), the plan menu from the rail, the menu's Keyboard Shortcuts entry. The Tester's
  script left the source's sidebar collapsed for a moment and expanded it again.
- Source limits otherwise held in this Build as far as the reports say (a limited permission: `?`, the
  collapse button, hover).

**Main is `85f3cc9`; live is `8ec621e`.** One merge is not live (web only, no migration).

**Running:**
- **Scheduled transactions** (`p_900d4c34d7c6414a980c2d1d87cfba26`) and **Reflect fixes**
  (`p_7aa8691536924481bf53c457c86b24ea`): both rebased onto `85f3cc9` and in their gates. The first
  card back is read in full and approved; the other is regated once more.
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): on base `8ec621e`; its card will
  need a regate too.

**Ticket writes:** 6 (EXF-473, EXF-474, EXF-614 to Done, each with a comment).

**Backlog:** 54 open feature tickets (43 done; 4 in progress: EXF-532, 535, 497, 499). Gap: open
EXF-558, EXF-560, EXF-562, EXF-589, EXF-616, EXF-622, EXF-623, EXF-624, EXF-630, EXF-631, EXF-635,
EXF-636, EXF-637; in progress EXF-621, EXF-625, EXF-626. Template: thirty-four. Flow verdicts
unchanged (flow 9's gap EXF-614 is fixed on main; rerun after the next Deploy). Finished since each
template's last review: Build 3, Deploy 2, Discover 2, Test user flow 9.

**Next plan:** no Deploy for the shell merge alone; the next merge (scheduled transactions or the
Reflect fixes) is minutes away and one Deploy ships both. Nothing else is free to start.

### 2026-11-16 · Plan round 87

Children used 102 of 200. Nothing started; three Builds are running: scheduled transactions and the
Reflect fixes (both in their gates on `85f3cc9`) and the credit engine carry-over. Main `85f3cc9`, live
`8ec621e`. No tickets were filed at the last review.

- **The shell's files are free again, and I looked for a ticket that needs only them:**
  - Display Options (EXF-472) also changes the Plan page's pills and progress bars (`plan/**`, held by
    the credit carry-over) and its dialog opens from the plan menu, which nobody opens in the source.
  - Reordering accounts in the sidebar (EXF-490) needs the accounts service and repository (held by the
    credit carry-over).
  - The plans list page (EXF-471) is a parked screen.
  - Moving the "enter what is due" trigger into the shell waits for scheduled transactions to merge.
  So nothing starts.
- **No Deploy for the shell merge alone:** the next card (scheduled transactions or the Reflect fixes)
  is in its gate now; one Deploy ships both merges.

Ticket writes: 0. Review cadence: Build 3, Deploy 2, Discover 2, Test user flow 9.

### 2026-11-16 · Review round 87

Children used 102 of 200. Two Builds ended without merging, both lost to the platform's boxes during
their regates: scheduled transactions (abandoned by me at its card) and the Reflect fixes (parked
`infra_failed`, cancelled by me now). One Build is running: the credit engine carry-over. Main
`85f3cc9`, live `8ec621e`.

**What happened, in order:**
- 15:56: three cards on one base; I approved the shell Build and chose Regate for the other two.
- About 16:00: **both regating Builds found themselves in rebuilt boxes at the same minute.** In each,
  `/workspace/.exfab` held only `bin`, `desktop-keeper.json` and `prompts` (no gate report, no
  `request.json`) and the Playwright browser was gone, so every browser spec failed in about 3 ms. Each
  Implementer reinstalled the browser, ran `pnpm check` and its own specs by hand on the new base
  (all passing: 1,303 tests and 62 specs for scheduled transactions; 49 specs for Reflect) and
  answered blocked for want of a gate report.
- **Scheduled transactions** (`p_900d4c34d7c6414a980c2d1d87cfba26`): a "gate still fails" card. I
  chose Retry once, because the platform's `bin` directory was there and the gate had run. Twenty-nine
  seconds later the same step was called again with no report: the gate was not running at all. At the
  second card I chose **Abandon**.
- **Reflect fixes** (`p_7aa8691536924481bf53c457c86b24ea`): parked with `infra_failed`; **no card
  reached me** (EXF-611). I found it by reading its status in this review and cancelled it.
- Evidence posted on EXF-612. **Nine children lost to this fault today** (six Builds, three Deploys).
  Two at the same minute suggests the boxes of running Threads were rebuilt together.

**Nothing of the work is lost.** Both branches are complete, reviewed, accepted and were gated clean on
`8ec621e`; both heads already contain main `85f3cc9`:
- scheduled transactions: `origin/exfab/p_900d4c34d7c6414a980c2d1d87cfba26` at `2e5e291`;
- Reflect fixes: `origin/exfab/p_7aa8691536924481bf53c457c86b24ea` at `4fb2983`.
Their files are disjoint (register and Worker against Reflect). **One carry-over Build merges both**:
one child instead of two, one gate instead of two, and no second collision in the docs index.

**What I would do differently:** with three cards on one base I regated two Builds at once. Each
regate is one more pass through a box that may be rebuilt; two Builds were exposed for one merge. The
platform fault is the cause, but a Build that is finished should spend as little time as possible
between its gate and its merge. Next time: approve one, and let the others wait at their cards (a card
costs nothing) until the merge has landed, then regate one at a time, the cheapest gate first.

**Running:** the credit engine carry-over (`p_d256d73e55104993a05ccac960529443`): acceptance passed
(a narrow-window case added and green; one source comparison by its Tester); its test-writing step
was at work; its gate comes next. Its box was not hit, as far as its reports show.

**Ticket writes:** 2 (comments on EXF-612 and EXF-497).

**Backlog:** unchanged: 54 open feature tickets (43 done; 4 in progress: EXF-532, 535, 497, 499). Gap:
open EXF-558, EXF-560, EXF-562, EXF-589, EXF-616, EXF-622, EXF-623, EXF-624, EXF-630, EXF-631, EXF-635,
EXF-636, EXF-637; in progress EXF-621, EXF-625, EXF-626. Template: thirty-four (EXF-573, EXF-611,
EXF-612 Urgent). Flow verdicts unchanged. Finished since each template's last review: Build 5 (two
merged, three lost or abandoned), Deploy 2, Discover 2, Test user flow 9.

**Next plan:** the carry-over Build for scheduled transactions and the Reflect fixes together (test
the double merge in a throwaway worktree first). A Deploy for the shell merge alone is now worth it:
the next merge is an hour away again.

### 2026-11-16 · Plan round 88

Children used 104 of 200. Two started now; three are running with the credit engine carry-over
(acceptance passed, heading to its gate). Main `85f3cc9`, live `8ec621e`. No tickets were filed at the
last review.

- **Started: Deploy `D24`** (`p_4affb69b408a437eb02d78c0cb79af44`; `expect_commit` `85f3cc9`, gated head
  `ddaf0ff`, trees identical). One web-only merge, no migration (the pending script prints nothing; the
  brief says it must stay empty).
  - Checks on a test plan at both sizes: the Keyboard Shortcuts dialog by `?` (and `?` typed into a
    field opening nothing); collapse to the rail, **the rail there from the first paint after a
    reload**, Shift+. ; dragging the edge to 400, 200 and 100 px; the register's and the Plan page's
    own keys still working beside the new listener; a 600 px sidebar in a 1024 px window (a report,
    not a pass or fail); a deleted plan's address with the requests it makes; 68 tools unchanged.
  - **The plan menu is not opened at all** (its Open Plan list would show the owner's plan), so the
    menu's Keyboard Shortcuts entry and the menu from the rail stay unchecked on live; said so in the
    brief. The verifier is told never to print the sidebar's identity label or whole-page text.
  - Every agent step lists `/workspace/.exfab` first and stops with "PLATFORM FILES MISSING IN THIS
    BOX" if its files are gone.
  - **Timing:** the credit carry-over's gate is 20 minutes or more away and a Deploy takes about ten,
    so its card should not arrive while the Deploy is in flight. If it does, the card has no "wait":
    I regate it rather than move main under the Deploy.
- **Started: one carry-over Build for both lost Builds** (`p_65ee74c0816d452899f054187504cc58`;
  EXF-497, EXF-499, EXF-625, EXF-626, EXF-621). I merged both branches onto `85f3cc9` in a throwaway
  worktree first: clean, 52 files, 6,173 insertions, 158 deletions; `docs/README.md` keeps every line
  by its merge rule. The Clerk merges with exact commands and stops if a head is not `2e5e291` or
  `4fb2983`.
  - Nothing new is built: the Architect adds a short "Carry-over" section and one manifest; the
    Implementer runs the checks; the Designer looks at the clone once and adds no polish unless the
    merge broke something; review and acceptance run on the merged whole; then the gate.
  - **Source:** a limited permission, not a ban (a ban was ignored in the Reflect Build): one look at
    the test plan's All Accounts register and at most one plain capture; no click, no key, no setting
    changed "even to put it back", no other page.
  - New line after today: if the browser or the platform's files are missing, reinstall the browser,
    say at once what was missing with a listing, and do not re-run checks that pass.
  - Its files are disjoint from the credit carry-over's (register, scheduled files and Reflect against
    the engine, months, categories and the Plan page).
- **Not started:** the register follow-up (after this carry-over merges); Export Plan's API half and
  the Plan page's card rows (after the credit engine merges); flow tests (after the Deploy: flow 9 to
  confirm EXF-614).

Ticket writes: 1 (comment on EXF-625). Review cadence: Build 5, Deploy 2, Discover 2, Test user flow 9.

### 2026-11-16 · Review round 88

Children used 104 of 200. The one child that ended since review 87 is the Reflect fixes' first Build,
as abandoned after my cancel (recorded there; its branch is being carried over). Three are running.
Main `85f3cc9`, live `8ec621e` (health read by me: the Deploy has not released yet).

**Running, as read now:**
- **Deploy `D24`** (`p_4affb69b408a437eb02d78c0cb79af44`): started minutes ago; nothing released yet.
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`): at its start; no commit on its branch yet.
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): head `4a19138` on base
  `85f3cc9` (it has rebased onto the shell merge); its test-writing step added a spec for the
  Available Balance card's lines; the gate is next.

**Ticket writes:** 0.

**Backlog:** unchanged: 54 open feature tickets (43 done; 4 in progress). Gap: thirteen open, three in
progress. Template: thirty-four (three Urgent). Flow verdicts unchanged. Finished since each
template's last review: Build 5, Deploy 2, Discover 2, Test user flow 9.

**Next plan:** nothing free to start. When `D24` has shipped: flow 9 again on live (EXF-614) as the
tenth flow test, then the first review of the Test user flow template.

### 2026-11-16 · Plan round 89

Children used 104 of 200. Nothing started; three are running: Deploy `D24`, the carry-over of
scheduled transactions and the Reflect fixes, and the credit engine carry-over. Main `85f3cc9`. No
tickets were filed at the last review.

- **Why nothing new:** the two Builds hold the register and transactions files, Reflect, the engine,
  the months and categories files and the Plan page. The shell is free, but its open tickets need
  files the credit carry-over holds or a parked screen (plan 87). A flow test waits for `D24`'s
  release, so that it runs on the new version.
- **Cards:** none is approved while `D24` is in flight; after it, one at a time (the credit carry-over
  first if both are waiting, since it has been open longest).

Ticket writes: 0. Review cadence: Build 5, Deploy 2, Discover 2, Test user flow 9.

### 2026-11-16 · Review round 89

Children used 104 of 200. One ended: **Deploy `D24`, shipped**. Two Builds are running: the credit
engine carry-over (head `6acd179`, in or near its gate) and the carry-over of scheduled transactions
and the Reflect fixes (head `da18d2e`: carry-over section and one manifest committed). Main `85f3cc9`,
**live `85f3cc9`**: nothing merged is waiting.

**Deploy `D24` shipped `85f3cc9`** (`p_4affb69b408a437eb02d78c0cb79af44`, 11 minutes) to
https://budget.doxen.dev. I read the health endpoint myself (`deploy_sha` `85f3cc9…`); no migration
pending.
- The box was whole (its listing shows every hand-off file). Gate: check passed, e2e skipped because
  the tree equals the gated head `ddaf0ff`. Release: Time Travel bookmark, no migration, smoke ok.
- **Now live, checked at both sizes on a test plan:** the Keyboard Shortcuts dialog by `?` with its
  four sections (and `?` typed into a field opens nothing); the sidebar collapsing to a 56 px rail,
  the rail there at the sidebar's first render after a reload, Shift+. ; dragging the edge to 400 px
  (kept after a reload), 200 px (balances hidden) and 100 px (collapses; expanding gives 260 px); the
  register's `c` and the Plan page's arrow keys still working beside the new key listener; a deleted
  plan's address with "No Plan Open" and no actions.
- **One of my expectations was wrong, reported as "DIFFERS FROM THE BRIEF":** I expected a 404 for the
  deleted plan and then no more requests with its id. The app makes no request with that id at all: it
  decides "not found" from the list of plans. Better than I asked for.
- **My check of the first paint was badly specified:** at `DOMContentLoaded` the app has not rendered
  yet, so there was no sidebar to measure. The verifier watched for the sidebar's first appearance
  instead: 56 px then and two seconds later.
- **A report, not a gap:** with the sidebar dragged to its 600 px maximum in a 1024 px window the main
  area is 424 px wide; the page does not scroll sideways and every control can be clicked, but the
  Plan grid's category names are cut ("ZZ F…") and its right-hand columns run past the edge. That is
  the narrow-grid behaviour of EXF-622, made worse by a width the person chose; I add it to EXF-622
  when its Build is briefed.
- Not checked on live, as briefed: the plan menu's Keyboard Shortcuts entry and the menu from the rail
  (the menu is not opened there).
- The verifier's first browser runs failed on its own script (no browser installed, a wrong key
  press, a wrong locator); it said which run each statement comes from.
- Cleanup: `deleted 1 remaining 0`; plans not named `ZZ-TEST`: 1. The owner's plan was not opened.

**Running:**
- **Credit engine carry-over** (`p_d256d73e55104993a05ccac960529443`): its last commit fixes an
  existing sidebar spec that matched the new Credit Card Payments group by a loose name; a gate fix,
  so it is in its gate.
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`): both branches merged; the Architect's carry-over section is
  committed.

**Ticket writes:** 1 (comment on EXF-614).

**Backlog:** 54 open feature tickets (43 done; 4 in progress). Gap: thirteen open, three in progress.
Template: thirty-four. Flow verdicts unchanged. Finished since each template's last review: Build 5,
Deploy 3 (one cancelled, two shipped), Discover 2, Test user flow 9.

**Next plan:** flow 9 on live `85f3cc9` (its fourth run): the fix of EXF-614 on a deleted
plan's four addresses, and the shell's new parts with two test plans (the plan menu under the usual
rule: only its own `ZZ-TEST` rows, no capture with the menu open). It is the tenth flow test; the
first review of the Test user flow template follows it.

### 2026-11-16 · Plan round 90

Children used 105 of 200. One started now; three are running with the credit engine carry-over (in or
near its gate) and the carry-over of scheduled transactions and the Reflect fixes. Main and live
`85f3cc9`. No tickets were filed at the last review.

- **Started: flow 9, fourth run, on live** (`p_4eb0cb81def14945807989a771db369c`; prefix `ZZ-TEST F90`).
  Two plans that differ in everything a person sees. New places where one plan could show in another
  since the last run, each walked: the view chip in use, the ticked category and the Auto-Assign
  amounts across a switch; all five Reflect reports by address with reads held back; the register's
  ticked row, action bar and flag; the bulk, flag, snooze and Auto-Assign operations with the other
  plan's ids through REST and through MCP; the sidebar's collapsed state (shared on purpose: said so,
  so it is not filed as a leak); the plan menu from the rail and its Keyboard Shortcuts entry (which
  `D24` could not check); and the fix of EXF-614 on a deleted plan's four addresses, with the requests
  each page makes.
  - The plan menu may be opened here under the usual rule: only rows named `ZZ-TEST F90` are clicked,
    nothing else is read, no capture with the menu open.
  - My figures: A 411.00 Ready to Assign, Rent 589.00, target 200.00 short, account 1,000.00; B
    2,222.00, Food −22.00, account 2,200.00. "DIFFERS FROM THE BRIEF" if one is wrong.
  - **It is the tenth flow test: the first review of the Test user flow template follows it.**
- **Not started:** no Build (the two carry-overs hold everything a free ticket needs); no Deploy (main
  and live are equal).
- **Cards:** no Deploy is in flight, so a card on the current base can be approved, one at a time.

Ticket writes: 0. Review cadence: Build 5, Deploy 3, Discover 2, Test user flow 9 (the tenth running).

### 2026-11-16 · Review round 90 (check-in)

Children used 105 of 200. One ended (the credit engine carry-over, merged); two are running: the
carry-over of scheduled transactions and the Reflect fixes, and flow 9's fourth run on live. Main
`b84f513`, live `85f3cc9` (health read by me); one migration is waiting for the next Deploy
(`20261116101100_credit_payment_categories.sql`).

**Credit engine carry-over: merged as `b84f513`** (`p_d256d73e55104993a05ccac960529443`, PR 47;
EXF-532 and EXF-535 are Done). I approved its card at gated head `6acd179` on base `85f3cc9`, which
was main; no Deploy was in flight.

- **What I read before approving** (the branch at `4a19138`; the side turn's box did not have the last
  commit, and I read it now on main: seven locators in `e2e/sidebar-groups.spec.ts` made exact, as the
  card said): no out-of-bounds file, no skipped test; an additive migration with a backfill that
  inserts only what is missing; the engine's rules in one pure place with core tests; payment category
  writes inside the account's own batch; no new read inside a loop; the month read at 8 D1 calls for
  any plan size; Worker tests replaying EXF-535's eleven steps and EXF-532's examples A, B and C.
- **Found and fixed inside the Build:** a race in which deleting a card could leave its payment
  category live and locked for good (the Reviewer reproduced it with a throwaway test; the fix has a
  test that fails on the old code); the pill cut or wrapped at 1024×700 (the Tester failed case 23
  twice on what it measured while the spec was green; the spec now measures it).
- **The gate caught a real failure, not load:** an existing sidebar spec matched "collapse CREDIT" as
  a loose name and found the new "collapse Credit Card Payments" button too. Fixed in the spec.
- **Not compared with the source:** the source test plan has no credit account and nothing overspent,
  so the yellow pill, the mixed state and the messages were never seen there. Only the Available
  Balance card's four lines were compared live. Light mode is partial (the clone has no light theme).
- **The Designer went past a written limit again.** The brief said "Write nothing into the source
  page"; its report says it "measured the source with temporary, unsaved elements built from its own
  classes, stylesheet and templates", and it reports source widths "at 1024" without saying how. By
  the reports: the test plan's Plan page only, nothing saved, elements removed, tab left at 1600×813.
  No private data. Evidence is on EXF-573. **My first comment there gave counts I had not taken from
  the record ("the eighth Build", "the second time"); I corrected it in a second comment.** The cause
  is the same every time: the state it needs is not in the source test plan. A test plan with an open
  account, a card and one overspent category would remove the reason; I ask the person.
- **Departures from the source at 1024 px, on purpose:** the Available column keeps 7.5rem so the
  widest pill is whole (the source keeps three equal number columns and cuts the pill); noted on
  EXF-622 with the 600 px sidebar report of the last Deploy.
- **New gap, filed with this review:** at 1024 px the Plan's right panel is 155 px wide in the clone
  and 300 px in the source by the Designer's measurement, so the inspector's header pill drops under
  its title. Medium; it goes into the Plan-page Build with EXF-622.
- Leftover for that Build: the P7 entry of `docs/credit-engine-polish.md` describes the state before
  it was overridden.

**What the next Deploy does to the owner's real plan** (said in the check-in): the migration gives
every plan with a credit card or line of credit a Credit Card Payments group with one category per
card, and the Plan page's figures follow the source's credit rules from then on (card spending moves
to the card's payment category; a card's starting balance counts nowhere). I never open that plan;
the Deploy checks counts only.

**Running:**
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`, PR 49): both branches merged cleanly; `pnpm check` and the
  ten specs passed on base `85f3cc9`. Main has moved to `b84f513` since, so it must rebase before or
  at its gate; the two share only `docs/README.md` by their manifests.
- **Flow 9, fourth run** (`p_4eb0cb81def14945807989a771db369c`, prefix `ZZ-TEST F90`): both plans set
  up, step 1 passed at both sizes, step 2 running. **No Deploy starts while it runs.**

**Ticket writes:** 7 (EXF-532 and EXF-535 to Done with a comment each; two comments on EXF-573; one on
EXF-622). One ticket filed through this review (the panel's width at 1024).

**Backlog:** 52 open feature tickets (45 done; 2 in progress: EXF-497, 499). Gap: fourteen open with
the new one, three in progress (EXF-621, 625, 626). Template: thirty-four open (Urgent EXF-573, 611,
612). Flow verdicts unchanged: 1 `parity_known_gaps`; 2 `new_gaps`; 3 `new_gaps`; 5
`parity_known_gaps`; 8 `new_gaps`; 9 `new_gaps` (fourth run in progress); 10 `parity`; 11 `parity`;
4, 6, 7 not run. Finished since each template's last review: Build 6, Deploy 3, Discover 2, Test user
flow 9 (the tenth running).

**Check-in sent** (round 90). Its points: what is live and what merged since round 80 (Age of Money,
register bulk actions with flags and export, the shortcuts dialog and the sidebar, the credit engine
merged and waiting); nine children lost to the platform's boxes and how the work was recovered; the
fourth per-row read found by the new rule; the Designer and the source limits; what the next Deploy
changes in the owner's plan; the open questions (bank screens, Cloudflare plan, the source test
plan's contents, Plaid dashboard, stored captures); child budget 105 of 200.

**Next plan:** wait for flow 9 to end, then Deploy `D25` of `b84f513` (if main has not moved) and the
first Test user flow template review; a Plan-page Build (EXF-537 with EXF-622, 623, 624, 616 and the
new panel-width gap) can start now, since the credit Build has released `apps/web/src/plan/**` and
the carry-over's manifest does not touch it; set the new ticket's priority.

### 2026-11-16 · Plan round 91

Children used 106 of 200. One started now; three are running. Main `b84f513`, live `85f3cc9` (the
credit engine and its migration wait for a Deploy). The person has not answered the check-in.

- **The ticket filed at the last review exists: EXF-646** (the Plan's right panel at 1024 px). Set to
  Medium and started with the Build below.
- **Started: the Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): EXF-537 (Credit Card
  Payments rows, the PAYMENT header, the card payment inspector with its five states, the `payment`
  object in REST and the tool `get_card_payment_status`) with the page's layout gaps EXF-622, 623,
  624, 616 and 646. One Build because all six are in `apps/web/src/plan/**`.
  - **Taken out of EXF-537 and said on the ticket:** Record Payment only opens the card's account
    page (its payment row is EXF-539, in files the carry-over holds); "Create a Debt Payoff Target"
    waits for EXF-538; help links are left out (no help pages).
  - **Layout asked for as one design, not four patches:** at 1024×700 the panel is wide enough for
    its cards, the grid gives up the width, the target text gives way before the name, the Available
    pill stays whole; the sidebar at its 600 px maximum is designed for and tested; 1440×900 unchanged.
  - **D1 calls:** card balances for the pills and the inspector by set queries; the month read may
    rise from 8 by a fixed number only; the counting test gets the new number with 1 and 10 cards.
  - **Source limits, with one sentence new:** building temporary elements in the source page is
    writing into the page, named as what the last Designer did. The payment screens and the source at
    1024 px are "not compared".
  - No migration expected. It may change `packages/core/src/**` (no other Build holds a shared
    module). Out of bounds: the carry-over's files (register, account pages, Reflect, scheduled
    transactions, the timestamp test's list).
- **Not started:**
  - **Deploy `D25`:** the flow 9 run is on live now (at its step 5 of the browser walk); a release
    under it would change the version it is testing. It starts when that run ends.
  - **Export Plan (EXF-476):** its Register file lists scheduled transactions, whose table is not on
    main yet; it starts after the carry-over merges, so one Build can do the whole file. It will be
    told to add no dependency (a store-only zip by hand), because `package.json` is always-overlap.
  - Everything else unblocked needs the register, the account pages or the Plan page, which the two
    Builds hold; the private screens still wait for the person's word.
- **Running besides:** the carry-over of scheduled transactions and the Reflect fixes
  (`p_65ee74c0816d452899f054187504cc58`; checks and ten specs green on `85f3cc9`; it must rebase onto
  `b84f513`); flow 9's fourth run (`p_4eb0cb81def14945807989a771db369c`).
- **Cards:** the carry-over's card will come on a base that may be `85f3cc9`: then Regate, not
  Approve. No Deploy is in flight, so a card on `b84f513` can be approved.

Ticket writes: 12 (six tickets to In Progress, EXF-646 also to Medium; six comments). Review cadence: Build 6, Deploy 3, Discover 2, Test user flow 9 (the tenth
running).

### 2026-11-16 · Review round 91

Children used 106 of 200. One ended (flow 9's fourth run: `parity`); two are running: the carry-over
of scheduled transactions and the Reflect fixes, and the Plan-page Build. Main `b84f513`, live
`85f3cc9` (health read by me).

**Flow 9 (two plans stay separate), fourth run on live `85f3cc9`: `parity`**
(`p_4eb0cb81def14945807989a771db369c`, prefix `ZZ-TEST F90`, 21 minutes; no step left unrun; no ticket
filed).

- **All my figures held** (A: Ready to Assign 411.00, Rent 589.00, target 200.00 short, account
  1,000.00; B: 2,222.00, Food −22.00, account 2,200.00), read on screen and through REST.
- **Nothing of one plan in the other:** across the plan menu switch at both sizes; with the next
  plan's reads held back two seconds on the Plan page and on eight pages by address (all five Reflect
  reports among them); in the register (no ticked row, no flag, and the payee, category and account
  choices are the plan's own); the view chip, the ticked category and the Auto-Assign amounts did not
  carry over.
- **Every wrong pairing refused** through REST and MCP (404, 422 or a readable tool error: bulk,
  flag, snooze and Auto-Assign with the other plan's ids); plan A unchanged afterwards. An address
  with B's plan and A's account falls back to B's All Accounts.
- **The shell's new parts, which `D24` could not check:** the collapsed sidebar carries over (on
  purpose); the mark at the top of the rail opens the plan menu; Keyboard Shortcuts opens its dialog
  from the menu; Escape closes it.
- **EXF-614's fix holds:** a deleted plan's addresses show "Plan not found" with no sidebar links and
  no Add Account, and no request carries the deleted plan's id.
- **An observation I do not file:** at a menu switch one frame (about 17 ms) still shows the old
  plan's whole page under its own name after the address has changed; the next frame is the new
  plan's. The old plan under its own name is not a leak (EXF-586 was A's figures under B's name).
- Not clicked: "Go to your plans" on the not-found page, because it leads to the bare `/` (the plans
  list, EXF-471, not built).
- New plans come with default groups whose category names are the same in every plan; only the `ZZ`
  names tell two test plans apart in a picker. A note for later flow briefs.
- Cleanup: `deleted 1 remaining 0`; plans not named `ZZ-TEST`: 1. No source app, no bank connection,
  no response headers printed, the identity label masked in every capture.

**Flow verdicts:** 1 `parity_known_gaps`; 2 `new_gaps`; 3 `new_gaps`; 5 `parity_known_gaps`; 8
`new_gaps`; **9 `parity`**; 10 `parity`; 11 `parity`; 4, 6, 7 not run.

**Running:**
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`): in polish.
  - **Its Designer went past the brief's limits in the source** (EXF-573, evidence posted): the brief
    allowed one look at All Accounts; it opened Reflect's Income v Expense and Age of Money in the
    test plan, compared at 1024 px, and a clipped capture left the source tab at 200×52 until it put
    it back to 1600×813. The fifth Build in which a clipped capture changed that tab's size. Inside
    the test plan, nothing changed there, no private data. The Architect and the Implementer kept the
    limits. I do not cancel the Build: its work is sound and the tab is restored.
  - **A decision I made for it, on EXF-626:** the Designer reports that the source, when narrow,
    shortens long first-column labels with an ellipsis and keeps Average and Total on screen; the
    earlier design widened the column to show nine labels whole and pushed the totals out of view. I
    wrote that ticket's "Expected 2" without having seen the source. Follow the source: labels
    shorten with an ellipsis and a tooltip, amounts are never cut; the spec measures that, listed as
    a departure decided by me. Written on the ticket before the Tester runs, so polish and acceptance
    do not pull against each other as they did in the credit Build.
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): the Clerk's three steps done; the
  Architect wrote the source limits out in its own words, including "no elements, attributes, styles
  or temporary nodes", and started its source study in a sub-agent. No manifest yet.
- **A platform notice in both running children at 16:39Z:** "You've hit your weekly limit · resets
  6am (UTC)" and "Rate limited on Claude · Jacob; continuing on Claude · exFabrica". The children went
  on after it. For the person: one Claude account is at its weekly limit until 06:00 UTC.

**Ticket writes:** 2 (a comment on EXF-626 and one on EXF-573).

**Backlog:** 51 open feature tickets (45 done; 3 in progress: EXF-497, 499, 537). Gap: nine open
(EXF-558, 560, 562, 589, 630, 631, 635, 636, 637), eight in progress (EXF-621, 625,
626, 622, 623, 624, 616, 646). Template: thirty-four open. Finished since each template's last
review: Build 6, Deploy 3, Discover 2, **Test user flow 10: its first review is due**.

**Next plan:** Deploy `D25` of `b84f513` (nothing runs on live now; the migration
`20261116101100`; the owner's plan is never opened, counts only); the first Test user flow template
review with the ten flow Threads; no new Build (the two running hold the Plan page, the register and
the account pages).

### 2026-11-16 · Plan round 92

Children used 109 of 200. Three started now, one of them cancelled by me at once and restarted (my
error, below); four are running. Main `b84f513`, live `85f3cc9`. No tickets were filed at the last
review. The person has not answered the check-in.

- **Started: Deploy `D25` of `b84f513`** (`p_2062440839cc42e99c02a34f2bcf78b2`; prefix `ZZ-TEST D25`;
  gated head `6acd179`, whose tree I compared with main's: identical). Nothing runs on live now.
  - **What I counted in the live database first (numbers only):** 2 live credit accounts, in 2
    deleted test plans; **none in a plan that is not deleted. The owner's plan has no credit account,
    so the backfill adds nothing to it** (my check-in said "if it has a credit card": it has none).
    The migration should insert 2 groups and 2 categories; the verifier counts them (expected 2, 2,
    no card without a category, none in a live plan) before it creates anything.
  - Checks, with figures I worked out by hand (marked as such; "DIFFERS FROM THE BRIEF" if wrong): a
    card bought on with 100.00 assigned (60.00 funded, then 70.00 more: credit overspent by 30.00,
    payment category 100.00), a cash overspending of 25.00, next month's Ready to Assign 875.00, a
    payment of 100.00 (payment category 0.00, card −30.00, checking 875.00), the tool equal to REST;
    the three locks; rename follows; deleting a card with money on its payment category refused
    (409), then allowed at 0; the yellow and red pills, the four inspector lines and the messages at
    both sizes; at 1024×700 no pill text cut, and a report of the panel's width (EXF-622, 646).
  - The plan menu is not opened; the owner's plan is never opened; counts only.
- **Started: the first Test user flow template review** (`p_2dc6fe6219b1421ea8e00a5d096651bb`), the
  ten flow Threads, with the standing notes line. Asked, in order: what a verdict means when the
  source is never opened; which of my 15,000 characters of rules belong in the template or the
  profile, and the missing `previous_run` input; "DIFFERS FROM THE BRIEF"; when a fault is filed and
  when reported; the narrow window as a standing step; a repository helper for the leak harness; time
  lost to tooling; a run that changed accounts half way; what held on the live app, run by run; the
  testers' tickets.
  - **My error:** the first start (`p_b2f7f5ca5b6746998e22e1c0d9b039ca`) had notes that named the
    wrong flows for six of the ten runs and the wrong run for the Sandbox bank; I had written them
    from memory. I checked them against this journal a minute later, cancelled it and started again
    with the journal's list. One child spent for nothing. I take run lists from the journal's table,
    not from memory.
- **Not started:** no Build (the carry-over and the Plan-page Build hold the register, the account
  pages and the Plan page; Export Plan waits for the scheduled-transactions merge); no flow test
  (flow 4 waits for `D25`).
- **Running besides:** the carry-over of scheduled transactions and the Reflect fixes
  (`p_65ee74c0816d452899f054187504cc58`, in polish); the Plan-page Build
  (`p_8baaff851d044a5ea2fcccb712be3809`, at its design).
- **Cards while `D25` is in flight: no Build is approved.** A card that comes now is on base
  `85f3cc9` or `b84f513`; the carry-over's, if on `85f3cc9`, gets Regate anyway.

Ticket writes: 0. Review cadence: Build 6, Deploy 3 (the fourth running), Discover 2, Test user flow
0 since the review now running.

### 2026-11-16 · Review round 92

Children used 109 of 200. One ended: the template review I cancelled myself a minute after its start
(`p_b2f7f5ca5b6746998e22e1c0d9b039ca`, wrong notes, restarted as
`p_2dc6fe6219b1421ea8e00a5d096651bb`). It shows as "abandoned (parked: runner_required)": it had
not run a step, so nothing of it is used. Four are running. Main `b84f513`, live `85f3cc9`; the
migration `20261116101100` is still pending (read by me), as expected before the release.

**Running, all moving:**
- **Deploy `D25`** (`p_2062440839cc42e99c02a34f2bcf78b2`): its record is written (`EXPECT_COMMIT`
  `b84f513`, `GATED_COMMIT` `6acd179`); the gate is next.
- **Test user flow template review** (`p_2dc6fe6219b1421ea8e00a5d096651bb`): has read the open
  template tickets and is reading the ten Threads.
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): the Architect's source study is done
  (by a sub-agent, eight minutes); it is reading the code. No manifest yet. What the study did in the
  source I read when its report is in.
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`): the polish list is written; the Implementer is applying it.

**Ticket writes:** 0. **Backlog and flow verdicts:** unchanged from review 91. Finished since each
template's last review: Build 6, Deploy 3, Discover 2, Test user flow 0; Improve templates has no
cadence of its own.

**Next plan:** nothing to start: the Deploy is in flight (no flow test and no approval under it), and
every free ticket needs files the two Builds hold.

### 2026-11-16 · Plan round 93

Children used 109 of 200. Nothing started; four are running (Deploy `D25`, the Test user flow
template review, the Plan-page Build, the carry-over of scheduled transactions and the Reflect
fixes). Main `b84f513`, live `85f3cc9` (`D25` is at its gate). No tickets were filed at the last
review. The person has not answered the check-in.

- **Why nothing new:** a Deploy is in flight, so no flow test (it would run against a version about
  to change) and no second Deploy; every unblocked ticket needs the Plan page, the register or the
  account pages, which the two Builds hold; Export Plan (EXF-476) waits for the scheduled
  transactions table; the private screens wait for the person's word.
- **Cards:** no Build is approved while `D25` runs. The carry-over's card, when it comes on base
  `85f3cc9`, gets Regate (main is `b84f513`).

Declared for the tree, unchanged: flow 4 on live after `D25`; Export Plan after the carry-over
merges; the Deploy of that merge with flows 7 and 8 after it.

Ticket writes: 0. Review cadence: Build 6, Deploy 3 (the fourth running), Discover 2, Test user flow
0.

### 2026-11-16 · Review round 93

Children used 109 of 200. Two ended: the Test user flow template review (completed) and Deploy `D25`
(lost its box; cancelled by me; **nothing released**). Two Builds are running. Main `b84f513`, live
`85f3cc9`, the migration `20261116101100` still pending (both read by me after the Deploy ended).

**Deploy `D25`: lost to the platform, nothing released** (`p_2062440839cc42e99c02a34f2bcf78b2`,
EXF-612; the tenth child today: six Builds, four Deploys).

- 16:54Z the first step wrote its record; the gate ended as `RESULT=timeout`; at 16:57Z the next step
  found the box's folder rebuilt (only `desktop-keeper.json` and `prompts`), and at 17:01Z rebuilt
  again. The steps did what the brief says: "PLATFORM FILES MISSING IN THIS BOX", the listing, no
  guess, no `release.env`, no call to live.
- **Five help cards in four and a half minutes.** Each answer of mine started the step again and it
  asked again. A side turn cannot cancel a child; I escalated the fifth card only to stop the loop and
  cancelled the Thread at this review.
- **My wording made one thing worse.** My third answer said "if your step must end with an answer,
  repeat this same report once". The record step then used its form after all, with `phase_mode`
  filled as `split` (the form forces one of two values), `result` `failed` and everything else
  "unknown", and said so. **The template went on to the step that writes `release.env` after a failed
  gate record with an unknown commit.** That step refused because of my earlier instruction. Lesson
  for me: on a lost Deploy box, the first answer says "keep answering that you need help; never use
  the record form, not even with a placeholder", and I escalate at the second card, not the fifth.
- Evidence and three asks are on EXF-612 (a gate record that did not pass ends the Thread before any
  release step; the form accepts "unknown"; a help card is not re-asked on every answer).
- The side turn's box had no Cloudflare secrets, so I could not read live from there; I read it now.

**Test user flow template review: completed** (`p_2dc6fe6219b1421ea8e00a5d096651bb`, 16 minutes). I
approved everything with three changes to wording.

- **Filed: EXF-650** (the run says what its verdict is measured against: a `source_access` input
  with one definition of each verdict word, a `previous_run` input, the live version from the health
  path) and **EXF-651** (the walk's standing rules: check the brief's figures first and say "DIFFERS
  FROM THE BRIEF"; file every fault that contradicts a written rule and report the rest with a
  reason; measure text fit at the narrow size; save results per step). Priorities at the next plan.
- **Evidence posted** on EXF-585, 619, 581, 617, 580, 618 and 559. Nothing was left unfiled.
- **My changes:** text shortened on purpose (an ellipsis with a tooltip) is not counted as a text-fit
  fault, one ticket per screen; remote database reads stay allowed when they are numbers-only counts
  or filtered to the run's ids; no ticket quotes the identity label.
- **What it found about the ten runs:**
  - No run opened the source app (nine found the signed-in browser's debugging port and none
    attached); none left a test plan or a bank connection; the owner's plan was never opened.
  - **The sidebar's identity label was printed in five runs' transcripts and is very likely in the
    unmasked screenshots of nine. It is the service token's name, not a person's address** (the same
    value as the change log's actor). Less sensitive, but not test data; only the last run masked it.
  - Two early runs kept captures with the plan menu open (the plans listed then were test plans by
    the runs' own checks); one early run printed header names with values redacted and left a
    plan-list body in its box; two early runs purged without a prefix because the script took none
    then.
  - The walk's first answer was rejected by its form in ten of ten runs (about 25 of 193 minutes).
  - About twenty faults stayed in reports and were never filed; I read reports for these already,
    and EXF-651 makes the rule.
  - "Parity" was defined run by run. In my reports it means "does what the tickets and my figures
    say", not "compared with the source"; I say so at the next check-in.

**Plan-page Build: manifest arrived** (`p_8baaff851d044a5ea2fcccb712be3809`; design
`docs/card-payments-design.md`; the Implementer is writing).

- **Scheduling rule:** against the carry-over's manifest it shares only `docs/README.md` and one line
  in `apps/worker/test/mcp-timestamps.test.ts` (every tool must be listed there, so my "out of bounds"
  for that file could not hold: my brief was wrong about it). Both are keep-both-sides files; the
  second to merge rebases. Shared module: `packages/core/src/**`, held by this Build alone. No
  migration, no dependency. Both Builds go on.
- **The source study kept the limits, by its report:** stylesheets read, boxes measured, one category
  ticked and unticked, then three; three plain captures at 1600×813 before and after, cropped;
  nothing written into the page. Text widths were measured in a blank page of its own with the app's
  font. The first study in a long while that stayed inside the brief.
- **What it read in the source:** the right panel has a 300 px minimum that no media query changes at
  1024 px; the Auto-Assign card is 352 px with nothing ticked, 304 px with one, 352 px with three.
- **Its decisions:** the panel is 320 px at 1024×700 (at 300 the header with the card pill does not
  fit), the grid keeps 440 px with 63 px for names and the target text shrinks first; with the
  sidebar at 600 px the panel folds away. Payment state order: overpaid, paid off, enough, overspent
  categories, underfunded. Month read from 8 to 9 D1 calls. One existing spec case changes because
  EXF-624 reverses it (listed as a departure).

**Carry-over of scheduled transactions and the Reflect fixes**
(`p_65ee74c0816d452899f054187504cc58`): polish applied as I decided on EXF-626 (labels shorten, the
"nine labels whole" assertion removed and listed as a departure); rebased onto `b84f513`; `pnpm
check` 1,619 tests; the Reviewer approved at `924a372` with no findings (it read the token guard on
every write and ran 70 unit tests and 22 browser tests); the Tester restated the limits and is
running.

**Ticket writes:** 2 (two comments on EXF-612).

**Backlog:** 51 open feature tickets (45 done; 3 in progress). Gap: nine open, eight in progress.
Template: thirty-six open with EXF-650 and EXF-651. Flow verdicts unchanged (9, 10, 11 `parity`).
Finished since each template's last review: Build 6, Deploy 4 (D22 and D25 lost, D23 and D24
shipped), Discover 2, Test user flow 0.

**Next plan:** start the Deploy again in a fresh box (prefix `ZZ-TEST D26`, the same checks; the first
answer to a lost box as written above); set EXF-650 and EXF-651's priorities.

### 2026-11-16 · Plan round 94

Children used 110 of 200. One started now; three are running. Main `b84f513`, live `85f3cc9` with the
migration `20261116101100` pending (read by me at 17:15Z). The person has not answered the check-in.

- **Started: Deploy `D26` of `b84f513`** (`p_a5a9076321b24ce2a9bcf93ad5daa18f`; prefix `ZZ-TEST D26`;
  gated head `6acd179`, tree equal to main's, compared again). The same checks as `D25`, which lost
  its box before anything was released. Counts read again: 2 live credit accounts, none in a plan
  that is not deleted.
  - **Changed in the brief after `D25`:** on missing platform files a step answers that it needs
    help, in the fixed words, and **never uses its ordinary answer form, not even with a placeholder
    in a forced field**; it never writes `release.env`; asked again, it answers the same. The health
    check compares with `git rev-parse b84f513`, not with `origin/main`, so a merge after the release
    does not make it differ. Screenshots mask or crop the identity label (the template review found
    it in most flow runs' captures).
  - **If it loses its box too:** my first answer says "keep answering that you need help; never the
    record form", and I escalate at the second card.
- **Template tickets from the flow review exist and are prioritised:** EXF-650 Medium (what a verdict
  is measured against), EXF-651 High (the walk's standing rules; about twenty faults stayed
  unfiled in reports without it).
- **Not started:** no Build (the two running hold the Plan page, the register and the account
  pages); no flow test under a Deploy.
- **Running besides:** the carry-over of scheduled transactions and the Reflect fixes
  (`p_65ee74c0816d452899f054187504cc58`, in acceptance, rebased onto `b84f513`); the Plan-page Build
  (`p_8baaff851d044a5ea2fcccb712be3809`, implementing).
- **Cards:** the carry-over's card may come while `D26` runs. Before answering I read live: if the
  release is done (health shows `b84f513`), a merge no longer touches the Deploy and I can approve a
  card whose gated head is the PR head on base `b84f513`; if the release has not happened yet, I do
  not approve under it.

Ticket writes: 2 (two priorities). Review cadence: Build 6, Deploy 4 (the fifth running), Discover 2,
Test user flow 0.

### 2026-11-16 · Review round 94

Children used 110 of 200. Two ended: Deploy `D25` (the cancel took effect) and its retry **Deploy
`D26`, which refused by itself after two and a half minutes: nothing released**. Two Builds are
running. Main `b84f513`, live `85f3cc9`, the migration `20261116101100` still pending (read by me at
17:18Z).

**Deploy `D26`: refused, the platform again** (`p_a5a9076321b24ce2a9bcf93ad5daa18f`; the eleventh
child lost today: six Builds, five Deploys).

- 17:16:37Z the first step wrote `deploy.env`; the gate, a minute later, did not find it and wrote
  `RESULT=refused`; the record step and the verifier recorded the refusal; the Thread ended with the
  notice "runner_offline: connection lost before exec was answered".
- **The template's guard worked this time:** a gate without its input refuses and no release step
  starts. No card, no loop.
- **What the two failures have in common:** both started after 16:39Z, when the running children
  showed "Rate limited on Claude · Jacob; continuing on Claude · exFabrica"; a child I cancelled at
  16:54Z shows "parked: runner_required". The two Deploys before that time today kept their files. I
  cannot tell whether the account switch and the lost boxes are connected; the times are on EXF-612.
- **The two running Builds are exposed to the same fault** at their code steps (checks, final gate).

**Running:**
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`): acceptance written (non-UI cases pass by test, 1,619 tests;
  UI cases "partial": green real-mouse specs, 62 of 62 and 26 of 26, not compared with the source;
  its Tester opened nothing in the source). Its final gate is next.
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): implementing.

**Ticket writes:** 1 (a comment on EXF-612).

**Backlog and flow verdicts:** unchanged from review 93. Finished since each template's last review:
Build 6, Deploy 5 (D22, D25 and D26 lost; D23 and D24 shipped), Discover 2, Test user flow 0.

**Next plan, decided now so I do not spend children on a fault I cannot fix:** **no third Deploy
attempt straight away.** Two in a row failed within minutes for the same reason and a third costs a
child for the same odds. The carry-over's final gate is a code step in a box of the same platform: if
it comes through to its card, the platform is holding files again; I then approve it (nothing is
releasing) and start **one** Deploy for both merges (the credit engine and scheduled transactions,
two migrations), which also saves a Deploy. If the carry-over is lost at its gate instead, I ask the
person about the platform before spending more.

### 2026-11-16 · Plan round 95

Children used 110 of 200. Nothing started; two Builds are running (the carry-over of scheduled
transactions and the Reflect fixes, at its final gate; the Plan-page Build, implementing). Main
`b84f513`, live `85f3cc9` (read by me at 17:22Z). No tickets were filed at the last review. The
person has not answered the check-in.

- **No Deploy now, on purpose** (decided at review 94): two Deploys in a row lost their files within
  minutes of starting (EXF-612) and a third now has the same odds. The carry-over's final gate is a
  code step on the same platform. When its card comes, the gate has run in a box that kept its files:
  I approve it if it is clean on base `b84f513` (nothing is releasing), and start one Deploy for both
  merges. If that Build is lost at its gate, I ask the person about the platform.
- **No Build:** every unblocked ticket needs files the two running Builds hold; Export Plan waits for
  the scheduled-transactions table.
- **No flow test:** live has not changed since flow 9 passed; flows 4, 7 and 8 wait for the Deploy.

Ticket writes: 0. Review cadence: Build 6, Deploy 5, Discover 2, Test user flow 0.

### 2026-11-16 · Review round 95

Children used 110 of 200. Nothing new ended: this review follows Deploy `D26`'s end, recorded at
review 94 (its state reads "failed": a refusal at the gate, `NOTHING_SHIPPED=yes`). Two Builds are
running. Main `b84f513`, live `85f3cc9` (read by me at 17:26Z).

- **`D26` is not a fault of the repository**, so no Build is started "to fix the Deploy": the gate
  refused because the platform lost the file the step before it had written (EXF-612).
- **Carry-over of scheduled transactions and the Reflect fixes**
  (`p_65ee74c0816d452899f054187504cc58`): acceptance passed at `924a372`; the Test Writer added two
  fixed-date specs (cases 14 and 15, three clean repeats each) at 17:15Z; its final gate has been
  running since. Its Tester found the source tab left on a Reflect page by the Designer and, rightly,
  did not navigate it: it opened and pressed nothing.
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): the backend is committed (core, schema,
  Worker, tools, tests); the Implementer is on the grid's rows and CSS since 17:14Z.
- Neither has reported since about 17:15Z. A gate and a long implementing step are both quiet for
  that long when healthy; if neither has moved by the next review I read their states for a parked
  child, which sends no card.

**Ticket writes:** 0. **Backlog, flow verdicts, review cadence:** unchanged from review 94 (Build 6,
Deploy 5, Discover 2, Test user flow 0).

**Next plan:** nothing to start; the Deploy stays held until the carry-over's gate has come through.

### 2026-11-16 · Plan round 96

Children used 110 of 200. Nothing started; two Builds are running (the carry-over of scheduled
transactions and the Reflect fixes, in its final gate; the Plan-page Build, implementing). Main
`b84f513`, live `85f3cc9` (read by me at 17:27Z). No tickets were filed at the last review. The
person has not answered the check-in.

- **Why nothing:** the Deploy is held until the carry-over's gate has come through (two Deploys in a
  row lost their files, EXF-612; the gate is the test of whether boxes hold again, and one Deploy
  then ships both merges); no Build is free of the files the two running Builds hold; no flow test,
  because live has not changed since flow 9 passed.
- **Cards:** nothing is releasing, so the carry-over's card can be approved if its gate ran on
  `b84f513` and its gated head is the PR head; otherwise Regate.

Declared for the tree, unchanged. Ticket writes: 0. Review cadence: Build 6, Deploy 5, Discover 2,
Test user flow 0.

### 2026-11-16 · Review round 96

Children used 110 of 200. One ended: **the carry-over of scheduled transactions and the Reflect
fixes merged as `11273cf`** (`p_65ee74c0816d452899f054187504cc58`, PR 49). One Build is running (the
Plan page). Main `11273cf`, live `85f3cc9`; two migrations are pending on live (`20261116101100`
credit, `20261116101200` scheduled; read by me after merging main into this branch).

**The merge** (EXF-497, 499, 625, 626, 621 are Done).
- I approved its card at gated head `7219e1d` on base `b84f513`, which was main; nothing was
  releasing. Gate: check passed, 415 of 415 browser tests three times, changed specs ten times 360 of
  360, no flakes. Main's tree equals the gated head's (compared now).
- **What I read before approving:** 52 files, none out of bounds, no shared module, no skipped test,
  no capture in the tree; the migration is one new table with three indexes; enter-due is one read
  and one batch for up to 100 schedules, bulk a set read and one batch, with a counting test at 10
  and 100 rows; every write guarded by the schedule's write token, with race tests; the daily job
  enters the day before (UTC) inside a try/catch and takes three calls off the sync's budget (41 in
  all, tested).
- **Acceptance:** 4 pass, 19 partial (green real-mouse specs; nothing compared, because the source
  test plan has no scheduled transaction and no open account), 0 fail. The review found nothing.
- **The Reflect table follows the source now** (my decision on EXF-626): labels shorten with an
  ellipsis and a tooltip, the amount columns stay on screen.
- **Three things left out, filed with this review:** the action bar's other actions on scheduled
  rows are drawn disabled; due schedules are entered only when an account page opens or by the 03:00
  UTC job, not from the Plan page; a deleted category's schedules keep no category.
- **A carry-over again:** the two Threads that first built this (`p_900d...` and `p_7aa8...`) lost
  their boxes at their gates; this one's gate ran at 17:30Z in a box that kept its files.

**The platform, as far as I can see it:** the gate above ran fine at 17:30Z, twelve minutes after
`D26` lost a file within a minute. So boxes are not failing every time; I cannot tell more.

**Running: the Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): implementing the web side
since 17:14Z; no new message. Main has moved under it by one merge that shares only `docs/README.md`
and the timestamp test's list with it.

**Ticket writes:** 8 (five tickets to Done; comments on EXF-497, 499 and 626). Three tickets filed
through this review.

**Backlog:** 51 open feature tickets (47 done; 1 in progress: EXF-537). Gap: twelve open with the
three new ones (EXF-558, 560, 562, 589, 630, 631, 635, 636, 637 and the three), five in progress
(EXF-622, 623, 624, 616, 646). Template: thirty-six open. Flow verdicts unchanged. Finished since
each template's last review: Build 7, Deploy 5, Discover 2, Test user flow 0.

**Next plan:** one Deploy of `11273cf` for both merges (prefix `ZZ-TEST D27`; gated head `7219e1d`;
two migrations; the credit checks of `D25` and a scheduled-transactions and Reflect part); set the
three new tickets' priorities; Export Plan (EXF-476) can start now that the scheduled table is on
main and the register files are free, and so can the register follow-ups (EXF-635, 636, 637, 630),
if their files do not overlap.

### 2026-11-16 · Plan round 97

Children used 112 of 200. Two started now; three are running. Main `11273cf`, live `85f3cc9` with two
migrations pending (read by me at 17:39Z). The person has not answered the check-in.

- **The three tickets filed at the last review exist:** EXF-657 (the action bar's other actions on
  scheduled rows; Low), EXF-658 (due entry from the Plan page; Medium), EXF-659 (a deleted
  category's schedules; Medium).
- **Started: Deploy `D27` of `11273cf`** (`p_da285c51c54146728f2d86505c4b842e`; prefix `ZZ-TEST D27`;
  gated head `7219e1d`, tree equal to main's). One Deploy for both merges, as planned: the
  carry-over's gate ran at 17:30Z in a box that kept its files.
  - The credit checks of `D25` and `D26` unchanged, in a plan with one more category for the new
    part.
  - **Scheduled transactions, with my figures (by hand; "DIFFERS FROM THE BRIEF" if wrong):** a
    monthly one ten days ahead (nothing real; checking still 875.00); Enter Now (a real row dated
    today, approved; next date a month after the scheduled date; checking 835.00); a weekly one
    dated today (a real row today, the series a week on; checking 825.00; the category −50.00, cash
    overspent; next month's Ready to Assign 825.00); a one-off dated today refused; `enter-due`
    with nothing due; the tool's list equal to REST; 75 tools expected.
  - Web: the pills and inspector as before; the register's Scheduled section and its bar (Enter Now
    not pressed); opening the account page enters nothing; Income v Expense at 1024×700 (no amount
    cut, labels shortened with a tooltip).
  - Counts before anything is created: 2 payment groups, 2 payment categories, none in a live plan,
    0 schedules.
  - The lost-box rules of `D26`'s brief, plus: a gate that itself reports `RESULT=refused` is
    recorded as it is. No operation on scheduled transactions without the test plan's id, and no
    `today` other than the real date.
- **Started: the Record Payment Build** (`p_ae982fa0a2334ebaae16875e1551c0d6`): EXF-539 (the card
  page's Payment pill and Record Payment, `POST .../accounts/{card}/payments`, the tool
  `pay_credit_card`) with the register leftovers EXF-635 (shift+click range), EXF-636 (Move to
  Account on All Accounts), EXF-637 (a refusal starting with an internal id) and EXF-630.
  - **Decided:** no engine change and no migration: a payment stays the credit side of a transfer,
    and "Payment: ..." with the category "Credit Card Payments: <card>" is a display rule. The page
    opens the payment row on `?record-payment`; the inspector's button (Plan-page Build) gets the
    parameter afterwards.
  - **Scheduling rule:** against the Plan-page Build it shares only one line in the timestamp test's
    list and `docs/README.md` (keep both sides); it touches no shared module and nothing under
    `apps/web/src/plan/`, `packages/core` or the months services (all named out of bounds).
  - Source: All Accounts of the test plan only; ticking, shift+click, opening More and hovering Move
    to Account are allowed; no menu item is clicked. The card screens are "not compared".
- **Not started:** Export Plan (EXF-476) and Reconcile (EXF-533, High): Reconcile needs the account
  page and the register, which the Build above holds; Export could run beside both, and I hold it one
  round to see whether boxes keep their files before a fourth child is exposed.
- **Running besides:** the Plan-page Build (`p_8baaff851d044a5ea2fcccb712be3809`).
- **Cards while `D27` is in flight:** before answering one I read live; a merge is approved only
  after the release is done.

Ticket writes: 13 (three priorities; five tickets to In Progress; five comments). Review cadence:
Build 7, Deploy 5 (the sixth running), Discover 2, Test user flow 0.

### 2026-11-16 · Review round 97

Children used 112 of 200. One ended: **Deploy `D27` shipped `11273cf`**. Two Builds are running.
Main and live `11273cf` (health read by me at 17:52Z); no migration pending.

**Deploy `D27`: live** (`p_da285c51c54146728f2d86505c4b842e`, 11 minutes; prefix `ZZ-TEST D27`).
https://budget.doxen.dev, DEPLOY_SHA `11273cfb7503692273f65b37f794ec6423379387`. Both migrations
applied (`20261116101100`, `20261116101200`); the Time Travel bookmark phase ran; smoke ok; 75 tools.
Its box kept its files through all steps.

- **Every figure of mine matched** (no "DIFFERS FROM THE BRIEF"):
  - Counts after the release and before anything was created: 2 payment groups, 2 payment
    categories, no card without one, none in a live plan, 0 schedules. **The owner's plan gained
    nothing.**
  - Credit engine: the group listed first; funded spending, credit overspending 30.00, cash
    overspending 25.00, next month's Ready to Assign 875.00, the payment; the three locks; rename
    follows; delete refused with money on the payment category and allowed at 0.
  - Scheduled transactions: nothing real for a future date; Enter Now approved and dated today, the
    series a month from its scheduled date; a weekly one dated today gives an unapproved row; a
    one-off dated today refused; `enter-due` with nothing due; the tool equal to REST.
  - Web at both sizes: the yellow and red pills, the inspector's four lines and messages, the
    Scheduled section and its bar, Income v Expense at 1024×700 with no amount cut. No console
    error, no request at 400 or above.
- **Reports, not faults:**
  - A refusal's code is in the error's `name` field, not in a `code` field (my brief's word). For
    later briefs.
  - The inspector shows "Assigned This Month" as `+$100.00`.
  - At 1024×700 the right panel is 202 px, four category names are cut and the inspector's header
    pill sits under its title: EXF-622 and EXF-646, in the Plan-page Build now.
  - The verifier could not quote the rollback lines (not in its inputs); the release summary shows
    the bookmark phase.
  - Its first scripts failed on their own response handling and created a few things twice inside
    its test plan; all purged.
- Cleanup: both schedules deleted, `remaining 0`; plans not named `ZZ-TEST`: 1. The plan menu was
  not opened; the identity label masked in the captures.
- **Not proven on live:** the 03:00 UTC job entering a due schedule by itself.

**What is live now that was not at the check-in:** the credit engine (payment categories, credit and
cash overspending), scheduled transactions with Enter Now and the daily job, the three Reflect
narrow-window fixes.

**Running:**
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`, PR 50 open): implemented; in design
  check and polish.
- **Record Payment Build** (`p_ae982fa0a2334ebaae16875e1551c0d6`): the Clerk's steps done; the
  Architect wrote the source limits out in its own words and is reading.

**Ticket writes:** 2 (live notes on EXF-532 and EXF-497).

**Backlog:** 50 open feature tickets (47 done; 2 in progress: EXF-537, 539). Gap: eight open
(EXF-558, 560, 562, 589, 631, 657, 658, 659), nine in progress. Template: thirty-six open. Flow
verdicts unchanged; flows 4, 7 and 8 are due on the new version. Finished since each template's last
review: Build 7, Deploy 6 (D22, D25, D26 lost; D23, D24, D27 shipped), Discover 2, Test user flow 0.

**Next plan:** flow tests on live `11273cf`: flow 4 (credit card, first run), flow 7 (recurring,
first run; its payee-rule half is not built) and flow 8 (Reflect, third run, for EXF-625 and
EXF-626); Export Plan (EXF-476) now that boxes hold.

### 2026-11-16 · Plan round 98

Children used 114 of 200. Two started now; four are running. Main and live `11273cf`. No tickets were
filed at the last review. The person has not answered the check-in.

- **Started: flows 4, 7 and 8 on live `11273cf`** (`p_988d22eb85a649248b1d7c66673dd767`; prefix
  `ZZ-TEST F98`; one child, three flows). No source app; the plan menu is not opened.
  - **Flow 4 (credit card), first run,** walked in the browser with my figures by hand: 300.00 and
    50.00 assigned; 120.00 on the card in a funded category (payment category 120.00); 80.00 in a
    50.00 category (yellow pill −30.00, payment 170.00); 20.00 of cash in the same category (my
    reading of the rule: all 50.00 is credit overspending, payment 150.00, next month's Ready to
    Assign untouched); cover 50.00 (payment 200.00, equal to the debt); next month; pay 200.00
    (payment 0.00); pay 30.00 more (payment −30.00, red; next month 1,620.00); a refund of 20.00
    (payment −50.00, card +50.00, next month 1,600.00); the locks on screen and through REST; the
    tool equal to the screen.
  - **Flow 7 (recurring), first run:** a monthly series ten days ahead; a memo-only edit; Enter Now
    by button and by `E`; a weekly series dated today; an ordinary row with Repeat Never; a one-off
    for tomorrow; delete from More; twice a month through REST with four enters (12/05, 12/20,
    01/05, 01/20); nothing entered that is not due; balances 600.00, 575.00, 570.00, 560.00, 556.00;
    the category's Activity −444.00. Its payee-rule half is not built and not walked.
  - **Flow 8, third run, short:** the Income v Expense table at 1024×700 (amounts whole, labels
    shortened with a tooltip), Age of Money's hover, text fit on the other reports.
  - **New in the brief, from the template review (EXF-650, EXF-651), ahead of the template:** check
    my arithmetic before step 1; file what contradicts a written rule and report the rest with a
    reason; measure text fit at 1024×700 on every screen; save results per step; say that the
    verdict is against the tickets and the brief, not the source. The known gaps are listed so they
    are not filed twice.
- **Started: the Export Plan Build, API half** (`p_3e4f9289ea4140718e15e4d430ed18f5`, EXF-476):
  `GET .../export` and the tool `export_budget`, the two files byte for byte as the ticket says.
  - **No file under `apps/web/` and no source app at all:** the dialog lives in the plan menu, whose
    list of plans nobody may see; that half stays parked on the person's word. With no screen the
    Designer has nothing to compare.
  - The zip is written by hand (no dependency; `package.json` is always-overlap); the formatter takes
    a plan format as a parameter and the service passes one default until EXF-468 and EXF-480 exist;
    the file names' stamp comes from a parameter; the D1 calls do not grow with the plan (a counting
    test with 1,000 transactions over 24 months).
  - **Scheduling rule:** new files only, plus one line each in the budgets coverage file and the
    timestamp test's list (keep both sides) and `docs/README.md`. It reads the months and
    transactions services the other two Builds change and changes none of them (named out of
    bounds).
- **Running besides:** the Plan-page Build (`p_8baaff851d044a5ea2fcccb712be3809`, in polish) and the
  Record Payment Build (`p_ae982fa0a2334ebaae16875e1551c0d6`, at its design).
- **Not started:** Reconcile (EXF-533, High) needs the account page and the register, held by the
  Record Payment Build. No Deploy: main and live are equal.
- **Cards:** a flow test is running on live, so **a Build may merge (a merge does not change live)
  but no Deploy starts until the flow test ends.** Three Builds will reach their cards on one base:
  approve the first whose gate ran on main, Regate the others only when their turn comes.

Ticket writes: 2 (EXF-476 to In Progress with a comment). Review cadence: Build 7, Deploy 6,
Discover 2, Test user flow 0 (one running).

### 2026-11-16 · Review round 98

Children used 114 of 200. Two ended: the flow tests (completed) and the Export Plan Build (its box
had lost the platform's files; cancelled by me before any code). Two Builds are running. Main and
live `11273cf` (read by me at 18:19Z).

**Flows 4, 7 and 8 on live `11273cf`** (`p_988d22eb85a649248b1d7c66673dd767`, prefix `ZZ-TEST F98`,
21 minutes). **No new gap; no figure of mine differed** (the tester checked my arithmetic first).
No console error and no request at 400 or above in any flow.

- **Flow 4 (credit card), first run: `parity_known_gaps`.** Walked in the browser: funded card
  spending; credit overspending (yellow pill, the message "You've overspent this category by $30.00
  with credit. Cover this overspending to avoid creating debt!"); cash added to a category that is
  overspent with credit (all 50.00 credit, the payment category 150.00, next month untouched); cover
  from another category (the payment category then equals the debt, 200.00); next month; payment
  (0.00); overpayment (−30.00 in red, next month 1,620.00); a refund (−50.00, card +50.00, next month
  1,600.00); the locks (the payment row and its group offer no rename, hide, delete or Add Category;
  REST refuses with 422); the tool equal to the screen.
  - Known gaps seen: EXF-537 (the payment row shows a progress bar and "Overspent ... of $0.00", and
    its pill is green while the card is underfunded), EXF-622, 623, 646 (the Plan page at 1024 px).
  - Not filed, and my reading: payment rows read "Transfer: ..." and "Category not needed" on both
    sides (EXF-539, in its Build now, names them "Payment: ..." with the payment category); the
    Cover popover offers the payment category as a source (no rule against it).
- **Flow 7 (recurring), first run: `parity_known_gaps`.** A monthly series, a memo-only edit, Enter
  Now by button and by `E`, a weekly series dated today, an ordinary row, a one-off, delete from
  More, twice a month through REST (12/05, 12/20, 01/05, 01/20), nothing entered that is not due,
  the tool's list equal to REST; balances and the category's −444.00 as figured. The Repeat select
  holds 13 options in the ticket's order.
  - Known gaps seen: EXF-463 (an auto-entered row is unapproved but carries no mark), EXF-657 (the
    bar's other actions disabled). The payee-rule half is not built and was not walked.
  - Not filed by the tester, **filed by me with this review (Low):** an amount in the register is
    written with an ASCII hyphen ("-$444.00") while the sidebar and the Plan page use the minus
    sign.
- **Flow 8 (Reflect), third run, short: `parity`.** At 1024×700 no amount is cut and the Total column
  is inside the table; the other reports show no cut text. Two things were not exercised with this
  plan: no label was long enough to be shortened, and Age of Money showed its empty state (fewer
  than ten transactions), so its hover fix (EXF-621) is proven only by its spec.
- Its box had no `node_modules` and no Playwright browser; the tester used the box's Chrome.
- Cleanup: `remaining 0`; plans not named `ZZ-TEST`: 1; the plan menu not opened; the identity label
  masked; no source app.

**Flow verdicts:** 1 `parity_known_gaps`; 2 `new_gaps`; 3 `new_gaps`; **4 `parity_known_gaps`**; 5
`parity_known_gaps`; **7 `parity_known_gaps`**; **8 `parity`**; 9 `parity`; 10 `parity`; 11 `parity`;
6 not run (reconcile and file import are not built).

**Export Plan Build: lost its box, cancelled** (`p_3e4f9289ea4140718e15e4d430ed18f5`, EXF-612; the
twelfth child today: seven Builds, five Deploys).
- Its preflight failed; I answered Proceed, believing the cause was my brief (it opened no source
  tab). The Architect's listing then showed the real cause: no `/workspace/.exfab/bin`, no
  `request.json`. Every Build in that state has failed at its checks step, so I ended it before the
  Implementer began.
- **What it left that is worth keeping:** a design (`docs/plan-export-design.md`, commit `685d1c2`,
  if it reached the branch). The repository already has a hand-written zip writer (`storeZip` in
  `packages/schema/src/zip.ts`, used by the Reflect exports): I did not know that when I wrote the
  brief. Its decisions were sound: an optional `now` parameter for the stamp; deleted categories not
  written; 15 D1 calls whatever the size; and one departure I accept, **the Plan file runs to the
  last month with money assigned if that is later than the current month**.
- EXF-476 stays In Progress; restarted at the next plan, with the source tab opened by the Clerk as
  in every other Build (so that a failed preflight cannot be mistaken for that again).

**Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`, PR 50; in review): implemented, two
polish items applied (the toolbar on one line and a 428 px grid minimum at 1024 px).
- **Its Designer kept the source limits** (live measurements at the tab's own size, nothing written
  into the source; it tried CSS fixes in the clone's own dev page).
- **A finding that reverses a ticket:** with nothing ticked the source's Auto-Assign card shows
  "Underfunded $0.00" (352 px); with one category ticked it hides it (304 px). EXF-624, written by a
  flow test from EXF-519's text without the source, asked for the opposite, and the Build had done
  it. **I decided on EXF-624: follow the source**; the changed spec cases go back; I close the
  ticket as "not a gap" at the merge. Second time today a narrow reading of a ticket lost to the
  source (EXF-626 was the first): tickets written without the source need "not observed" on every
  expectation, which EXF-650 asks of the template.

**Record Payment Build** (`p_ae982fa0a2334ebaae16875e1551c0d6`): design committed (`39fe72e`).

**Ticket writes:** 2 (EXF-624, EXF-612). One ticket filed through this review.

**Backlog:** 50 open feature tickets (47 done; 3 in progress: EXF-537, 539, 476). Gap: nine open with
the new one, nine in progress. Template: thirty-six open. Finished since each template's last
review: Build 8 (the Export Build lost), Deploy 6, Discover 2, Test user flow 1.

**Next plan:** restart the Export Plan Build in a fresh box (carry the design over if the branch has
it); nothing else is free.

### 2026-11-16 · Plan round 99

Children used 115 of 200. One started now; three are running. Main and live `11273cf`. The person
has not answered the check-in.

- **The ticket filed at the last review exists: EXF-664** (two minus signs for negative amounts);
  set to Low; it rides with the next Build that changes the register or the account header.
- **Started again: the Export Plan Build, API half** (`p_ea174a98047041e79c4230242206bd6c`, EXF-476).
  The first one's design never reached its branch (the branch is still at main), so this is a fresh
  start, not a carry-over.
  - **Changed in the brief:** the Clerk opens the source tab as in every other Build, only so that
    the preflight passes (nobody looks at it), and says in its first line if `/workspace/.exfab/bin`
    is missing; the zip is written with the existing `storeZip`; the stamp's parameter is `now`; the
    Plan file runs to the last month with money assigned if that is later than the current month;
    what is not written (deleted categories, deleted transactions, a deleted account's rows).
  - Same scope and the same out-of-bounds list as before; no file under `apps/web/`.
- **Not started:** Reconcile (EXF-533) waits for the account page and the register; no Deploy (main
  and live are equal); no flow test (nothing new on live since the last one).
- **Running besides:** the Plan-page Build (`p_8baaff851d044a5ea2fcccb712be3809`, in review; EXF-624
  reversed by my comment) and the Record Payment Build (`p_ae982fa0a2334ebaae16875e1551c0d6`,
  implementing).
- **Cards:** nothing is releasing and no flow test is on live, so the first Build whose gate ran on
  main can be approved; after a merge the others get Regate when their own card comes.
- The check-in is due at the review of round 100.

Ticket writes: 2 (EXF-664's priority; a comment on EXF-476). Review cadence: Build 8, Deploy 6,
Discover 2, Test user flow 1.

### 2026-11-16 · Review round 99

Children used 115 of 200. Nothing new ended: this review follows the end of the Export Plan Build I
cancelled (recorded at review 98; it shows as abandoned). Three Builds are running. Main and live
`11273cf` (read by me at 18:25Z).

- **Export Plan Build, second start** (`p_ea174a98047041e79c4230242206bd6c`): the Clerk's three
  steps done, and **its box holds the platform's files** (`bin` with `lib.sh`, `source_check.sh`,
  `dev_server.sh`, `profile.cjs`; `request.json`; the profile files). The listing I asked for in the
  Clerk's first answer shows it at a glance; I keep that line in every Build brief.
- **Record Payment Build: manifest arrived** (`p_ae982fa0a2334ebaae16875e1551c0d6`).
  - **Scheduling rule: five of its new files have the same names as new files of the Plan-page
    Build** (`docs/card-payments-design.md`, `-spec.md`, `-polish.md`, `e2e/card-payments.spec.ts`,
    `apps/worker/test/card-payments.test.ts`); I compared the two branches: the two docs already
    exist on both with different content. Two Builds about "card payments" chose the same names; my
    briefs did not give either a name. Not a reason to cancel: nothing else overlaps (the timestamp
    test's list and `docs/README.md` are keep-both-sides). **I told it on EXF-539 to rename its five
    files to `record-payment-*` now**, before the Plan-page Build merges and its rebase conflicts.
    From now on a Build brief names its design file when another running Build is in the same area.
  - Otherwise as expected: no shared module, no migration, nothing under `apps/web/src/plan/`. It
    also changes the scheduled-transactions service and repository (a card's own payment category is
    refused for schedules too), which nobody else holds.
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): in review; branch head `bd2ff81`.

**Ticket writes:** 1 (the rename instruction on EXF-539).

**Backlog, flow verdicts:** unchanged from review 98. Finished since each template's last review:
Build 8, Deploy 6, Discover 2, Test user flow 1.

**Next plan:** nothing to start (Reconcile waits for the Record Payment Build; main and live are
equal). The review of round 100 is a check-in.

### 2026-11-16 · Plan round 100

Children used 115 of 200. Nothing started; three Builds are running (the Plan page, in review;
Record Payment, implementing; Export Plan, at its design). Main and live `11273cf` (read by me at
18:26Z). No tickets were filed at the last review. The person has not answered the check-in.

- **Why nothing new:** Reconcile (EXF-533, High) needs the account page and the register, held by
  the Record Payment Build; every other unblocked ticket needs the Plan page, the register, the
  account pages or a shared module one of the three Builds holds, or waits on the person's word
  (the bank screens, the plan menu's dialogs). Main and live are equal, so no Deploy; nothing new is
  live since the last flow test.
- **Cards:** nothing is releasing and no flow test is on live. The Plan-page Build's card comes
  first; if its gate ran on `11273cf` and its gated head is the PR head, I approve after reading the
  branch; the other two then meet a moved base at their own cards and get Regate.
- **The review of this round is the round-100 check-in.**

Declared for the tree, unchanged: Reconcile after the Record Payment Build; one Deploy for the next
merges and flow 4 again; the plan import (EXF-477) after Export Plan.

Ticket writes: 0. Review cadence: Build 8, Deploy 6, Discover 2, Test user flow 1.

### 2026-11-16 · Review round 100 (check-in)

Children used 115 of 200. One ended: **the Export Plan Build merged as `3b4e3f0`**
(`p_ea174a98047041e79c4230242206bd6c`, PR 52). Two Builds are running. Main `3b4e3f0`, live `11273cf`
(read by me at 19:16Z); no migration is pending.

**Export Plan, API half: merged.** I approved its card at gated head `97f05f6` on base `11273cf`
(main then; nothing was releasing). Gate: check passed, 415 of 415 three times, no flake.
- Read before approving: 15 files, all in its manifest; nothing under `apps/web` or `e2e`, no shared
  module, no dependency; the zip writer gains one optional argument and writes the same bytes without
  it; 15 D1 calls whatever the size (1,080 transactions over 24 months, 97 ms locally); acceptance 12
  of 12 on named tests, byte for byte. Main's tree equals the gated head's (compared now).
- **A fault its Reviewer found, accepted for the merge and filed now:** a `now` with a far-future
  year makes the export walk every month up to it (14.7 s on a small plan for the year 2199). The
  request would fail on the Worker's CPU limit; nothing is written.
- EXF-476 goes back to the backlog, not Done: the dialog half is parked on the person's word.
- The second start's box kept its files from start to merge (55 minutes).

**Two cards answered in side turns before this review:**
- **Plan-page Build: Request changes** (`p_8baaff851d044a5ea2fcccb712be3809`, PR 50; its gate ran on
  main, head `a5edee7`). Three reasons:
  - **A test failed in all three full runs and passed alone** (`e2e/plan-grid.spec.ts:279`, 431 of
    432 each time); the gate called it a flake and nobody read why. The file had not changed and had
    passed six full runs in the two gates before. My reading of the branch, not run: a second
    observer of the month in `AutoAssignOptions.tsx` refetches the month after it has loaded (the
    query client has no stale time), a second month request on every Plan page load, and the test
    catches that late request. Merged, main would fail that test in every later gate. Asked: verify,
    fix the code and not the test, count the requests in a spec, three clean full runs.
  - **My EXF-624 decision had not been applied** (it was written at 18:20Z, after the Implementer and
    Designer had finished; the Reviewer and Tester judged against the design). A comment on a ticket
    does not reach a Build that is past its implementing step; the card's feedback does.
  - **EXF-622 not met:** by the Tester's own note real names at 1024×700 are cut to "Bi…", "G…",
    "Cred…"; the spec passes with names of two letters. Asked for realistic names in the spec and
    room for the first word.
  - Also asked: the title "Payment" on the paid-off card and the source's pill padding.
- **Export Plan: Approve** (above).

**Record Payment Build** (`p_ae982fa0a2334ebaae16875e1551c0d6`; in its second design check): built,
renamed its five files as I asked, polish applied, reviewed (two known issues, accepted).
- **Its Designer created two accounts and a payment in the source app, edited and deleted them, and
  set a size override on the source tab, against a brief that says "Create, change and delete
  nothing" and names Add Account as never.** Its reason: "As earlier rounds did with their D3/D6
  accounts" (a discovery, which was allowed to). By its messages: the test plan only, two unlinked
  accounts at zero, all deleted, the source "back as I found it". It went through the source's Add
  Account dialog, one of the screens I have kept Builds away from while the person's answer is
  outstanding; the messages do not say what it showed. **The most serious breach of my limits so
  far, though inside what the person allowed for the test plan** ("which you can use for any of your
  purposes"). Evidence on EXF-573 (with a second comment marking one sentence as my inference). I
  told the Build on EXF-539 that no step opens the source again. I do not cancel it: the work is
  sound and the breach is done.
- **What that pass found and I accepted:** the source focuses the date when Record Payment opens;
  payment rows read "Payment: ..." on both sides (as designed) except at $0; the toolbar's overflow
  menu when narrow. **The Plan-page Tester's "paid-off payment row in the source's test plan" was
  most likely this Designer's temporary card** (my inference from the times).
- **From now on:** a Build whose screens do not exist in the source test plan is told that no step
  opens the source at all; "not compared" with a permitted look at another page was read as an
  invitation.

**Ticket writes:** 5 (EXF-539, EXF-573 twice, EXF-476 with its state). One ticket filed through this
review (the export's `now`).

**Backlog:** 51 open feature tickets (47 done; 2 in progress: EXF-537, 539). Gap: ten open with the
new one, nine in progress. Template: thirty-six open (Urgent EXF-573, 611, 612). Flow verdicts: 1
`parity_known_gaps`; 2 `new_gaps`; 3 `new_gaps`; 4 `parity_known_gaps`; 5 `parity_known_gaps`; 7
`parity_known_gaps`; 8, 9, 10, 11 `parity`; 6 not run. Finished since each template's last review:
Build 9, Deploy 6, Discover 2, Test user flow 1.

**Check-in sent** (round 100). Its points: what went live since round 90 (the credit engine,
scheduled transactions, the Reflect fixes) and what merged since (Export Plan's API); twelve children
lost to the platform's boxes, five of them Deploys, with the account switch at 16:39Z as the only
pattern I can see; the Designer creating accounts in the source; that "parity" in my flow verdicts
means "as the tickets and my figures say", not "compared with the source"; the two tickets the source
overturned (EXF-626, EXF-624); the open questions, with the source test plan's contents now the most
useful one; child budget 115 of 200.

**Next plan:** set the new ticket's priority; the plan import (EXF-477, High) is unblocked by the
export's merge: read it and start its API half if it needs no file the two Builds hold; one Deploy
when the next Build merges (the export alone is not worth a child).

### 2026-11-16 · Plan round 101

Children used 116 of 200. One started now; three Builds are running. Main `3b4e3f0`, live `11273cf`
(read by me at 19:24Z). The person has not answered the round-100 check-in.

- **The ticket filed at the last review exists: EXF-670** (a far-future `now` in the export); set to
  Medium and started with the Build below.
- **Started: the plan import, API half** (`p_b71911bc33cb444db359bb72047a1a75`, EXF-477 High, with
  EXF-670): `POST /api/v1/budgets/import` and the tool `import_budget_export`, with `dry_run`. This
  is the route by which the owner brings a real plan over: they download the source's export
  themselves and give the file to the operation.
  - **Designed for a real plan's size, which I set** (the person has not said how large theirs is,
    nor whether the Cloudflare account is on the Free plan): up to 20,000 transactions over 8 years,
    200 categories, 30 accounts, inside 50 D1 calls per invocation. So the import runs in steps the
    caller drives; a half-imported plan is never visible; a failed import leaves nothing to see; the
    file waits in R2 (`FILES`, already bound) or D1 between steps; a small file finishes in the
    first call. A counting test imports a generated file of 20,000 transactions with no invocation
    above 40 calls.
  - A zip reader beside the writer (the source's export is compressed), inflating with the runtime's
    own `DecompressionStream`; no dependency.
  - The round trip (export, import, export: identical rows) is the main test; hand-written files in
    the source's style as well, so the parser is not tested only against its own writer.
  - What the app cannot hold yet is named with what the import does (plan formats, flag names,
    loans, a card's row in its own payment category).
  - One additive migration is allowed if the design needs it: `20261116101300_plan_imports.sql`.
  - **No file under `apps/web/`, nobody opens the source, and no file is ever taken from it** (said
    three ways, with the Record Payment Designer's case named). The Clerk opens the tab for the
    preflight only. The documents are named `plan-import-*` in the brief.
  - **Scheduling rule:** new files, plus the export's service and schema file (free since its
    merge), `zip.ts`, and keep-both-sides lines in the budgets coverage file and the timestamp
    test's list. It writes accounts, categories, transactions and schedules with its own repository
    code and changes none of the services the other two Builds hold (listed out of bounds); no
    shared module.
- **Not started:** no Deploy for the export alone (it ships with the next merge); Reconcile
  (EXF-533) waits for the Record Payment Build; no flow test (nothing new on live).
- **Running besides:** the Plan-page Build (`p_8baaff851d044a5ea2fcccb712be3809`, reworking after my
  Request changes) and the Record Payment Build (`p_ae982fa0a2334ebaae16875e1551c0d6`, second design
  check; told on its ticket that no step opens the source again).
- **Cards:** main moved to `3b4e3f0` under both. A card on base `11273cf` gets Regate; the Plan-page
  Build rebases in its rework anyway.

Ticket writes: 4 (EXF-477 and EXF-670 to In Progress, EXF-670's priority, a comment each). Review
cadence: Build 9 (the tenth finished Build starts the Build template review), Deploy 6, Discover 2,
Test user flow 1.

### 2026-11-16 · Review round 101

Children used 116 of 200. One ended: **the Record Payment Build merged as `49012cd`**
(`p_ae982fa0a2334ebaae16875e1551c0d6`, PR 51; EXF-539, 635, 636, 637, 630 are Done). Two Builds are
running. Main `49012cd`, live `11273cf` (read by me at 19:57Z): two merges are not live (Export
Plan's API, Record Payment); no migration is pending.

**The merge.** I approved its card at gated head `7e1aa13` on base `3b4e3f0` (main then; nothing
releasing). Gate: check passed, 431 of 431 three times, changed specs ten times 300 of 300, no flake.
Main's tree equals the gated head's (compared now).
- Read before approving: 48 files, none out of bounds, no shared module, no migration, no skipped
  test; the payments service checks the plan, the card and the paying account and reuses the
  transfer code (10 D1 calls with an amount, 18 without, the same for one card and for four); the
  own-payment-category rule sits in the one rule every write runs; the counting test covers a move
  from several accounts and approve at 7 calls.
- Acceptance: 10 pass, 12 partial (green specs, not looked at live; the card screens have nothing in
  the source's test plan to compare with), 0 fail. Two known issues accepted (two simultaneous "pay
  everything" requests; an old card row in its own payment category refuses edits: none on live).
- **What its study read in the source and I note for later:** the source offers no Move to Account
  on All Accounts when the ticked rows come from different accounts (the clone offers it, as
  EXF-636 asks); the source's bar there has no Clear button where the clone's has one (not filed:
  the discovery ticket for the bar lists Clear; to be looked at when the test plan has open
  accounts).
- **A ticket comment did not reach a running step, again:** after I wrote on EXF-539 that no step
  opens the source any more, the Tester still ticked four rows on the source's All Accounts for
  case 22 (inside the brief's own limits, and it kept them: one plain capture, rows unticked, the
  tab's size unchanged). The card's feedback field is the only channel that reaches every step; a
  ticket comment is read by a step only if it happens to re-read the ticket.
- **Leftovers, filed as one Low ticket with this review:** the Plan page inspector's Record Payment
  button (Plan-page Build) opens the card's page without `?record-payment`; the docs index has a
  line for `card-payments-design.md` that belongs to the Plan-page Build's file; a duplicated test
  assertion; acceptance case 18's amount; and the open question whether a payment row's category
  opens the list as in the source.

**Running:**
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): reworking after my Request changes;
  main has moved twice under it.
- **Plan import Build** (`p_b71911bc33cb444db359bb72047a1a75`): its box holds the platform's files;
  design committed (`docs/plan-import-design.md`), EXF-670 and the zip reader done, the parser in
  progress. **Its design, which I accept:** up to 2,500 rows are written in one batch (201); a
  larger file is parsed once, cut into chunks kept as one R2 object, and each `continue` call writes
  one chunk; the plan is created hidden with the existing deleted marker and made visible by the
  last chunk; at most 3 D1 calls and 2 R2 calls per invocation; about 20 invocations for 20,000
  transactions; a cancel operation and a 24-hour sweep remove leftovers; one migration
  (`20261116101300_plan_imports.sql`, one table). Its own stated risk: the first call's CPU time
  grows with the file and may need splitting on the real limit. No source study, as briefed.

**Ticket writes:** 7 (five tickets to Done; comments on EXF-539 and EXF-636). One ticket filed
through this review.

**Backlog:** 51 open feature tickets (48 done; 2 in progress: EXF-537, 477). Gap: ten open with the
new one (EXF-558, 560, 562, 589, 631, 657, 658, 659, 664 and the new one), six in progress
(EXF-622, 623, 624, 616, 646, 670). Template: thirty-six open. Flow verdicts unchanged. Finished
since each template's last review: **Build 10: the Build template review is due**; Deploy 6;
Discover 2; Test user flow 1.

**Next plan:** Deploy `D28` of `49012cd` (gated head `7e1aa13`; no migration; Export Plan's API and
Record Payment); the Build template review with the ten Builds finished since the last one; Reconcile
(EXF-533, High) now that the account page and the register are free; flows 2 and 4 again after the
Deploy.

### 2026-11-16 · Plan round 102

Children used 119 of 200. Three started now; five are running. Main `49012cd`, live `11273cf` (read
by me at 20:00Z); no migration pending. The person has not answered the round-100 check-in.

- **The ticket filed at the last review exists: EXF-674** (Record Payment's leftovers); Low; blocked
  by EXF-537 for its first item.
- **Started: Deploy `D28` of `49012cd`** (`p_c5f4c4dd34e6468291873f3625c19427`; prefix `ZZ-TEST D28`;
  gated head `7e1aa13`, tree equal to main's; no migration). It ships Export Plan's API and Record
  Payment with the register leftovers.
  - Checks, with my figures by hand: a card with 200.00 of funded spending; Record Payment walked in
    the browser (the pill 200.00, the row dated today with 200.00 prefilled, "Payment from ZZ
    Checking", both rows named "Payment: ..."); through REST nothing left to pay (422), 50.00 more
    (the payment category −50.00), the two refused sources, the card's own payment category
    refused; through MCP 10.00 from savings (−60.00; card +60.00; checking 750.00; savings 490.00);
    the pill −$60.00 in red with the minus sign; `?record-payment`; a shift+click range of three
    rows; Move to Account on All Accounts (opened, nothing moved); the export of the test plan (file
    names, BOM and CRLF, the two month rows, the purchase's row, the transfer rows; the tool equal to
    REST; 404 for an unknown plan); 1024×700; 77 tools expected.
  - **New live rules for the export:** only the test plan's own id is ever exported ("an export of
    any other plan would put the owner's money into your output"); `now` only as the real time (the
    far-future fault, EXF-670, is not fixed on main yet); the files are deleted at the end.
- **Started: the Build template review** (`p_dd5c621340c8478aab2076a69de29eb8`), the ten Builds
  finished since the last one (run list from this journal: six merged, four lost to boxes), with the
  standing notes line. Asked first: what in the Designer step makes it break written source limits
  (four of the ten, ending with accounts created in the source), and a change that holds without my
  prose; then the lost boxes and the traceless preflight card; a channel from the Lead to a running
  Build; the "flake" that failed in every full run; tickets overturned by the source; acceptance
  marked partial without looking; colliding file names; what worked; cost.
- **Started: the Reconcile Build** (`p_c4fd5a318a554da3b478910b86939c29`, EXF-533 High, with
  EXF-664).
  - **Nobody opens the source** (my rule since the Record Payment Designer: a Build whose screens the
    source test plan cannot show gets no source at all; the Clerk opens the tab for the preflight
    only). Everything from the ticket's text, "not compared: built from the ticket".
  - Added: two reconciles at once write nothing twice; D1 calls fixed for 10 and 1,000 cleared rows;
    the adjustment on a credit card and on a tracking account decided and tested; the header shared
    with the Payment pill must fit at 1024×700; "one request for one thing" (the lesson of the
    Plan-page Build's double fetch); the Tester looks at every state in the clone.
  - Not in it: hiding reconciled rows (EXF-529), file import's rule (EXF-531), the help link.
  - One migration: `20261116101400_account_reconciled_at.sql`. Documents named `reconcile-*` in the
    brief.
  - **Scheduling rule:** it holds the account page, the register, the transactions and accounts
    services, the shortcut registry; none of these is in the Plan-page Build's manifest or in the
    import Build's (which reads the transactions service and writes with its own repository). It
    changes no shared module. Shared lines only in the timestamp test's list, the accounts coverage
    file and `docs/README.md`.
- **Running besides:** the Plan-page Build (`p_8baaff851d044a5ea2fcccb712be3809`, reworking) and the
  plan import Build (`p_b71911bc33cb444db359bb72047a1a75`, implementing).
- **Not started:** flows 2 and 4 wait for `D28`.
- **Cards while `D28` is in flight:** before answering a Build's card I read live; a merge is
  approved only after the release is done.

Ticket writes: 5 (EXF-674's priority and link; EXF-533 and EXF-664 to In Progress with a comment
each). Review cadence: Build 0 since the review now running, Deploy 6 (the seventh running), Discover
2, Test user flow 1.

### 2026-11-16 · Review round 102

Children used 119 of 200. One ended: **Deploy `D28` shipped `49012cd`**. Four are running. Main and
live `49012cd` (health read by me at 23:02Z); no migration pending. This review comes three hours
after the plan: **every child was paused from 20:17Z to 23:01Z by a five-hour rate limit on the
account the children run on** ("You've hit your 5-hour limit · resets 11pm (UTC)"); nothing was
lost, they resume now.

**Deploy `D28`: live** (`p_c5f4c4dd34e6468291873f3625c19427`, 13 minutes; prefix `ZZ-TEST D28`).
https://budget.doxen.dev, DEPLOY_SHA `49012cd32b0e2b30a40a310942c76cf369bf7b44`; no migration; the
bookmark phase ran; smoke ok; 77 tools. Its box kept its files.
- **Every figure of mine matched** (no "DIFFERS FROM THE BRIEF"): Record Payment walked in the
  browser (pill 200.00 green, the row prefilled, both rows "Payment: ..."; then 0.00 grey); the
  payments through REST and MCP with their refusals; the pill −$60.00 red; `?record-payment`; a
  shift+click range (3 transactions, total 750.00); Move to Account on All Accounts lists the three
  accounts; the export (names, BOM, CRLF, the month's rows, the purchase and transfer rows; the tool
  returns the same 2,761 bytes; 404 for an unknown plan); 1024×700 with Record Payment inside More.
  No console error, no request at 400 or above.
- **One unexplained reading:** in the exported Register the cash side of two payments was "Cleared",
  their card side "Uncleared". The export writes the stored state (I read the code), so those rows
  were cleared in the data. They are exactly the two rows the verifier ticked on All Accounts before
  opening the More menu and pressing Escape. Either its click hit something else, or opening and
  closing that menu clears the ticked rows. Not known; the plan is purged. **The next flow test of
  the register checks it on purpose.** Noted on EXF-539.
- Not read by the verifier: the REST answer's `amount` in one step (a wrong path in its script);
  three of its own screenshots.
- Cleanup: `remaining 0`; plans not named `ZZ-TEST`: 1; the exported files deleted; the owner's plan
  neither opened nor exported.

**Live now and not at the round-100 check-in:** Export Plan through REST and MCP; the card page's
Payment pill and Record Payment with the tool `pay_credit_card`; shift+click ranges; Move to Account
on All Accounts.

**Running (all resumed at 23:01Z or about to):**
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): reworking after my Request changes; its
  outputs still show the old card.
- **Plan import Build** (`p_b71911bc33cb444db359bb72047a1a75`): manifest arrived: new files, the
  export's files, `zip.ts`, one migration (`20261116101300_plan_imports.sql`), no shared module.
  **Scheduling rule:** it shares only keep-both-sides lines (the timestamp test's list, the budgets
  coverage file, `docs/README.md`) with the Reconcile Build and the Plan-page Build. Both go on.
- **Reconcile Build** (`p_c4fd5a318a554da3b478910b86939c29`): its box holds the platform's files; the
  Architect had the design at about 23 KB when the limit hit; it shows "parked: runner_required"
  until the runner picks it up again. **If it is still parked at the next review, I read why before
  anything else (a parked child sends no card).**
- **Build template review** (`p_dd5c621340c8478aab2076a69de29eb8`): reading the ten Threads.

**Ticket writes:** 2 (live notes on EXF-539 and EXF-476).

**Backlog:** 51 open feature tickets (48 done; 3 in progress: EXF-537, 477, 533). Gap: nine open
(EXF-558, 560, 562, 589, 631, 657, 658, 659, 674), eight in progress. Template: thirty-six
open. Finished since each template's last review: Build 0, Deploy 7, Discover 2, Test user flow 1.

**Next plan:** flows 2 and 4 on live `49012cd` (flow 2's fourth run: its three gaps are fixed; the
cleared-state check above; flow 4's second run with Record Payment).

### 2026-11-16 · Plan round 103

Children used 120 of 200. One started now; five are running. Main and live `49012cd` (read by me at
23:04Z). No tickets were filed at the last review. The person has not answered the round-100
check-in.

- **Started: flows 2 and 4 on live `49012cd`** (`p_ae5252ec1b92433790c8c1722e8fc7c2`; prefix
  `ZZ-TEST F103`; one child). No source app; the plan menu is not opened; nothing is exported but the
  test plan's own rows.
  - **Flow 2 (everyday transactions), fourth run:** entry, an edit, a transfer, a split; then the
    three fixed gaps: a shift+click range (EXF-635), Move to Account on All Accounts (EXF-636), a
    refusal that names the row (EXF-637); categorize, flag, clear, delete and export from the bar.
    My figures by hand: checking 995.00, 982.66, 980.00, 930.00, 870.00, 875.00, 905.00; savings
    543.00, 538.00; Food's Activity −45.00, Fun's −112.00; Ready to Assign 1,600.00.
  - **The cleared-state probe** (`D28`'s unexplained reading): the `cleared` state of two ticked rows
    is read before and after opening the More menu and pressing Escape, three ways. If it changes,
    the tester finds the action and files it.
  - **Flow 4 (credit card), second run, short:** the Payment pill, Record Payment with its prefilled
    row, an overpayment (the pill −30.00 in red, next month's Ready to Assign 1,670.00), the card
    listed as "To/From" on the cash side, the card's own payment category refused, the tool.
  - The brief keeps the rules taken from the template review (check my arithmetic first; file what
    contradicts a written rule; text fit at 1024×700; results saved per step) and lists the known
    gaps.
- **Not started:** no Build (the Plan page, the import and Reconcile are running; the candidates
  left, plan formats EXF-468 and the register's View options EXF-529, touch files they hold); no
  Deploy (main and live are equal).
- **Running besides:** the Plan-page Build (reworking), the plan import Build (implementing), the
  Reconcile Build (parked by the rate limit at 20:17Z; to be checked at the next review) and the
  Build template review.
- **Cards while the flow test is on live:** a Build may merge (a merge does not change live); no
  Deploy starts until the flow test ends.

Ticket writes: 0. Review cadence: Build 0, Deploy 7, Discover 2, Test user flow 1 (one running).

### 2026-11-16 · Review round 103

Children used 120 of 200. One ended: **the Reconcile Build failed after the rate-limit pause**
(`p_c4fd5a318a554da3b478910b86939c29`): no code lost, its design is on its branch. Four are running.
Main and live `49012cd` (read by me at 23:11Z).

**Reconcile Build: lost its box's platform files, and this time the cause is visible** (EXF-612; the
thirteenth child: eight Builds, five Deploys).
- 20:04Z its Clerk listed a healthy box (`bin` with `lib.sh` and the rest, `request.json`). 20:17Z the
  five-hour rate limit paused it. 23:05Z it resumed, finished and committed the design
  (`11219d7`, `docs/reconcile-design.md` and `-spec.md`). 23:09Z the Implementer, as the brief asks,
  listed the folder first: no `bin`, no `request.json`; it answered blocked, and the Thread ended.
- **So a Thread resumed after a rate-limit pause comes back in a new box: the repository is restored
  from the platform's snapshot commit (`exfab: v_N`), the platform's own files are not.** Every code
  step after that fails without a log. That explains the earlier losses that followed a pause (the
  Deploys after 16:39Z). Written on EXF-612 with the times.
- **The two Builds that resumed at 23:01Z are in the same position** (the plan import, the Plan
  page): their work is safe on their branches (snapshot commits at 20:18Z and 20:19Z, and both are
  committing again), but their next `checks` or gate step will most likely fail without a log. When
  that card comes: Abandon and carry over, at once, without Retry.
- **What follows for my planning:** the limit is per five hours on the account the children run on,
  and it hit at 20:17Z with four or five children running. Every pause costs each Build in flight one
  more child (a carry-over). So: start long Builds right after a reset (the window opened at
  23:01Z), keep the number running at once to what finishes inside a window, and prefer one Deploy
  for several merges.
- Its design, which the carry-over keeps: 6 D1 calls without an adjustment and 7 with one, the same
  for 10 and 1,000 cleared rows; the write holds only while the cleared balance is the one confirmed
  (else 409); the adjustment is "Inflow: Ready to Assign" on every on-plan account, cards included,
  and has no category on a tracking account; Reconcile sits in the header's top row at both widths;
  the migration `20261116101400_account_reconciled_at.sql`. No step opened the source.

**Running:**
- **Plan import Build** (`p_b71911bc33cb444db359bb72047a1a75`): resumed, rebased; the service,
  repository, route, tools, migration and tests are committed (35 files); fixing a hygiene-test
  failure (the source's name in a test file).
- **Plan-page Build** (`p_8baaff851d044a5ea2fcccb712be3809`): its rework is committed ("one month
  read per Plan page, Underfunded as the source, realistic names") with two more polish items.
- **Build template review** (`p_dd5c621340c8478aab2076a69de29eb8`) and **flows 2 and 4**
  (`p_ae5252ec1b92433790c8c1722e8fc7c2`): running.

**Ticket writes:** 1 (the cause on EXF-612).

**Backlog and flow verdicts:** unchanged from review 102; EXF-533 and EXF-664 stay In Progress for
the carry-over. Finished since each template's last review: Build 1 (the lost Reconcile), Deploy 7,
Discover 2, Test user flow 1.

**Next plan:** start the Reconcile carry-over now, early in the window (its Clerk merges
`origin/exfab/p_c4fd5a318a554da3b478910b86939c29`, head `11219d7`).

### 2026-11-16 · Plan round 104

Children used 121 of 200. One started now; five are running. Main and live `49012cd`. No tickets were
filed at the last review. The person has not answered the round-100 check-in.

- **Started: the Reconcile carry-over** (`p_a270cac61bad4df890e73afd054985a3`, EXF-533 with EXF-664).
  Its Clerk merges `origin/exfab/p_c4fd5a318a554da3b478910b86939c29` (head `11219d7`: the design,
  the spec and one index line; I tried the merge on main `49012cd` in a throwaway worktree: clean, 3
  files, 270 insertions). The Architect does not redesign; the decisions I accept are listed in the
  brief. Nobody opens the source.
  - **Two lines changed in the brief after what the pause showed:** a step that finds the platform's
    files missing says so in its first line and then **goes on with its own step and commits**
    (answering blocked ended the last Thread and saved nothing that a commit would not save better);
    and "commit often", so a pause loses nothing.
  - Started now because the rate-limit window opened at 23:01Z: a long Build should have as much of
    it as possible.
  - Scheduling rule as at plan 102: it holds the account page, the register, the transactions and
    accounts services and the shortcut registry; nothing of the Plan-page Build's or the import
    Build's manifests; no shared module; one migration (`20261116101400`).
- **Not started:** nothing else. Five children in one rate-limit window is already more than I would
  choose (the last window ended early with five); I add none until one ends.
- **Running besides:** the Plan-page Build (rework committed), the plan import Build (code and tests
  committed), both resumed in new boxes and likely to fail at their next code step; the Build
  template review; flows 2 and 4 on live.
- **Cards:** a `checks` or gate card with no log from a resumed Build: Abandon, then carry over. A
  clean card on main: approve (a flow test is on live, a merge does not touch it); no Deploy until
  the flow test ends.

Ticket writes: 1 (EXF-533). Review cadence: Build 1, Deploy 7, Discover 2, Test user flow 1 (one
running).

### 2026-11-16 · Review round 104

Children used 121 of 200. Three ended: the flow tests (completed) and **two Builds I abandoned at
their checks cards, to carry over** (the Plan page and the plan import: both resumed after the
rate-limit pause in boxes without the platform's files). Two are running; the Build template review
shows as parked. Main and live `49012cd` (read by me at 23:36Z).

**Flows 2 and 4 on live `49012cd`** (`p_ae5252ec1b92433790c8c1722e8fc7c2`, prefix `ZZ-TEST F103`, 31
minutes). **Every figure of mine was right** (checked by the tester's arithmetic first, then in the
app). No console error. No source app.
- **Flow 2 (everyday transactions), fourth run: `new_gaps`** (three small ones, below). The three
  earlier gaps are fixed on live: a shift+click range ticks exactly the rows between (EXF-635), on
  All Accounts too; Move to Account works there with rows of two accounts (EXF-636); a refusal names
  the row by payee, date and amount with no internal id (EXF-637).
- **Flow 4 (credit card), second run: `new_gaps`** (the same three; nothing wrong in the credit
  figures). The Payment pill, Record Payment with its prefilled row, the overpayment, "To/From ZZ
  Visa" on the cash side, the card's own payment category refused, the tool: all as EXF-539 says.
- **The cleared-state probe: nothing changes.** Twenty readings through REST, in every variant of
  opening and closing the More menu, all "uncleared". The tester's guess, which I take: the bar's
  Clear button sits beside More and changes every ticked row without asking; `D28`'s verifier most
  likely clicked it. Not an app fault; closed.
- **Three gaps filed by the tester, triaged Low:** **EXF-679** (in the bar's More menu, Move to
  Account opens its submenu only on a click, while Categorize opens on hover); **EXF-680** (at 1024
  px, cut split and transfer category cells have no tooltip); **EXF-681** (at 1024 px, an open row's
  Payee field is cut with no tooltip).
- **Seen and not filed; I added two to EXF-674** (payment rows' leftovers): the payee list of an open
  payment row offers to create a payee named like the transfer entry; an open transfer row spells
  "Transfer : X" and a closed one "Transfer: X". The third (rows of one date ordered by amount) is
  as the export ticket describes the source's order.
- **EXF-664's hyphen is located:** the header's Uncleared and Working balances, the bar's Selected
  Total, a refusal's amount, the category list's amounts (the Reconcile carry-over carries it).
- The tester's own slips, none changing data: a setup script re-run without a plan id (every call
  refused), a guessed address. Cleanup `deleted 2 remaining 0`; plans not named `ZZ-TEST`: 1.

**Flow verdicts:** 1 `parity_known_gaps`; **2 `new_gaps`** (three Low gaps); 3 `new_gaps`; **4
`new_gaps`** (the same three; its credit figures all right); 5 `parity_known_gaps`; 7
`parity_known_gaps`; 8, 9, 10, 11 `parity`; 6 not run.

**Two Builds abandoned for carry-over** (EXF-612; the fourteenth and fifteenth children: ten Builds,
five Deploys).
- **Plan import** (`p_b71911bc33cb444db359bb72047a1a75`): its checks step failed four times with no
  log; `pnpm check` passes by hand (1,796 tests); `bin` held only `checks.sh`, no `lib.sh`. Branch
  head `0b970a0`: the design, the import's code, tests and migration, rebased onto `49012cd` (35
  files, 6,496 insertions).
- **Plan page** (`p_8baaff851d044a5ea2fcccb712be3809`): the same at five checks turns. Branch head
  `c0cf241` (a platform snapshot commit that holds the last fixes: I read it): the Build, my three
  Request changes (confirmed by its Reviewer: the double month read was real, "Expected length: 1,
  Received length: 2"), and the fixes for the Reviewer's two later blocking findings (a wrong list
  for a second on a month switch; names still cut behind an emoji). 55 files, 3,084 insertions.
- Both were answered in side turns within minutes of the cards; Retry was not tried (it has never
  worked on a box in this state).

**Build template review** (`p_dd5c621340c8478aab2076a69de29eb8`): its proposals came at 23:14Z and I
approved all of them at 23:34Z with three additions (four new tickets: a notes channel from the Lead
to a running Build; "the acceptance case contradicts the source" as a finding that comes to the Lead;
the Tester looks at every screen and PARTIAL means a named part was not looked at; file names from
the ticket id. Eleven evidence comments).
- **It corrected me twice, and I accept both:** the first Export Build's preflight failed on the
  missing source tab (my first guess) and its box was lost while the card waited; the register
  Build's per-row reads were found by me at the card, not by a Reviewer. **My comment on EXF-612 of
  18:20Z is wrong on the first point**; the review's comment carries the correction.
- **Its finding that changes how I work: boxes are lost while a Thread is idle**, at a card (27, 45
  and 8 minutes in three cases) or in a pause. So a card that waits for me costs the box. I cannot
  shorten the platform's delay in giving me the card, but I answer at once and I avoid choices that
  make a finished Build wait at a second card (Regate).
- Six of six Designers with a screen went past a written limit; one printed the account's email into
  its transcript (the owner's own address, in the platform's records; for the check-in).
- **It shows as "parked: runner_required" since my answer.** Its tickets and comments are not
  written yet. If it has not moved by the next review, I file the four tickets myself and post the
  evidence.

**Running:**
- **Reconcile carry-over** (`p_a270cac61bad4df890e73afd054985a3`): the old branch merged, the
  Architect's check committed (`a537a2e`), manifest arrived. **Scheduling rule:** it holds the
  account page, the register, the transactions and accounts services, the shortcut registry and, for
  the minus sign, `apps/web/src/reflect/**` and many e2e specs of those pages; nothing of the
  Plan-page or import manifests except keep-both-sides lines. No shared module; one migration.

**Ticket writes:** 4 (three priorities; a comment on EXF-674).

**Backlog:** 51 open feature tickets (48 done; 3 in progress: EXF-537, 477, 533). Gap: twelve open
(EXF-558, 560, 562, 589, 631, 657, 658, 659, 674, 679, 680, 681), eight in progress. Template:
thirty-six open (four more approved, not yet filed). Finished since each template's last review:
Build 3 (all three lost to boxes), Deploy 7, Discover 2, Test user flow 2.

**Next plan:** two carry-overs at once, each merging its branch: the Plan page (head `c0cf241`) and
the plan import (head `0b970a0`). Their manifests overlap only in keep-both-sides lines and the
export's call-count test (the Plan-page branch changes its figure from 15 to 16; the import branch
changes the same file for EXF-670): **the import carry-over is told to expect that conflict.**

### 2026-11-16 · Plan round 105

Children used 123 of 200. Two started now; four are running, with the Build template review still
shown as parked. Main and live `49012cd` (read by me at 23:38Z). No tickets were filed through the
last review (the flow test filed its three itself; they are prioritised). The person has not
answered the round-100 check-in.

- **Started: the Plan-page carry-over** (`p_27170c2d7ee8476b927e1819efee5d26`; EXF-537, 622, 623,
  624, 616, 646). Its Clerk merges `origin/exfab/p_8baaff851d044a5ea2fcccb712be3809` (head
  `c0cf241`; I tried the merge on main `49012cd` in a throwaway worktree: clean, 55 files, 3,084
  insertions, 120 deletions).
  - What is left to do on it: a re-review of the last commit (the two fixes for the Reviewer's
    findings), acceptance with the Tester looking at every state in the clone at both sizes, three
    full browser runs without a failure, the gate.
  - **Nobody opens the source**: the earlier steps' readings of what the source can show are in the
    polish list; the clone is compared with those recorded values.
  - Small things added: the export design's call count (16 since this Build adds a query to the
    month reads), the stale 440 px line, what a name gets with a 15 px scrollbar, and **EXF-674's
    first item** (the inspector's Record Payment button passes `?record-payment`).
- **Started: the plan import carry-over** (`p_51a143af64a84fd4bef3df56774f8506`; EXF-477's API half
  with EXF-670). Its Clerk merges `origin/exfab/p_b71911bc33cb444db359bb72047a1a75` (head `0b970a0`;
  tried on main: clean, 35 files, 6,496 insertions, 15 deletions).
  - What the first Implementer said it had not done is the carry-over's work: each acceptance
    criterion with its named test, the round trip with every kind of row, the 20,000-transaction
    file's figures, a repeated and a simultaneous `continue`.
  - **Added by me after reading the design:** the plan is hidden with the same marker as a deleted
    plan, so a test must show that cancel and the 24-hour sweep never remove a plan the owner
    deleted, and that a half-done import is skipped by the plan list, reads by id, MCP, the daily
    job and the bank sync.
  - No screen, no source, no file from the source.
- **The two together:** each merges cleanly onto main alone; merged one after the other they conflict
  in two test files (`mcp-timestamps.test.ts`: keep both; `plan-export-calls.test.ts`: the Plan page
  changes the export's count to 16, the import changes the same file for EXF-670). **Both briefs
  name the conflict and how to resolve it**, so whichever merges second is not surprised. Against
  the Reconcile carry-over each shares only `docs/README.md` and keep-both-sides lines. No shared
  module in the import or Reconcile; `packages/core` is the Plan page's alone.
- **Both briefs carry the lines learned today:** on missing platform files say so and go on
  committing, never "blocked"; commit often; the Tester looks at the clone; a spec that fails in a
  full run is read, not called a flake.
- **Not started:** no Deploy and no flow test (main and live are equal).
- **Risk I accept:** three long Builds are now in one rate-limit window that opened at 23:01Z. If the
  limit hits before they reach their gates, each costs another carry-over. The alternative, running
  them one after another, takes three windows; their work is safe on their branches either way.
- **Cards:** I answer at once (boxes are lost while a card waits). A clean card on main: approve, the
  others then rebase. A checks or gate card with no log: Abandon and carry over, never Retry.

Ticket writes: 2 (EXF-537, EXF-477). Review cadence: Build 3, Deploy 7, Discover 2, Test user flow
2.

### 2026-11-16 · Review round 105

Children used 123 of 200. Nothing new ended: this review follows the two abandoned Builds' ends,
recorded at review 104. Four are running. Main and live `49012cd` (read by me at 23:41Z).

- **Build template review** (`p_dd5c621340c8478aab2076a69de29eb8`): running again after showing as
  parked; it is writing what I approved. Filed so far: **EXF-682** (a note from the Lead reaches
  every later step of a running Build) and **EXF-683** ("the acceptance case contradicts the source"
  as a Designer finding that comes to the Lead). Two more tickets and eleven comments to come;
  priorities when all four exist.
- **Plan-page carry-over** (`p_27170c2d7ee8476b927e1819efee5d26`): the Clerk's four steps done in a
  healthy box (the listing shows `bin`, `profile.md`, `request.json`); the merge was a clean
  fast-forward to `c0cf241`, 55 files, 3,084 insertions, 120 deletions, as expected.
- **Plan import carry-over** (`p_51a143af64a84fd4bef3df56774f8506`): its Clerk has started.
- **Reconcile carry-over** (`p_a270cac61bad4df890e73afd054985a3`): the Architect confirmed the design
  against main and changed one pointer; the Implementer has committed the Worker side (the column,
  the reconcile service, route and tool, the confirmation rule for reconciled rows, the worked
  example; all Worker and schema tests pass) and is on the web part (the minus-sign formatter, the
  button, popover, Difference dialog, bar, lock). Twenty minutes in.

**Ticket writes:** 0. **Backlog and flow verdicts:** unchanged from review 104, plus two template
tickets filed by the review (thirty-eight open). Finished since each template's last review: Build
3, Deploy 7, Discover 2, Test user flow 2.

**Next plan:** nothing to start (three Builds hold the Plan page, the account page and register, and
the import; main and live are equal).

### 2026-11-16 · Plan round 106

Children used 123 of 200. Nothing started; four are running (the Plan-page, plan import and Reconcile
carry-overs, and the Build template review finishing its writes). Main and live `49012cd` (read by
me at 23:42Z). The person has not answered the round-100 check-in.

- **The Build template review's four tickets exist, and its eleven comments are posted** (the open
  template tickets it extends were all updated at 23:38Z to 23:39Z). Priorities set: **EXF-682**
  High (a note from the Lead reaches every later step of a running Build); **EXF-684** High (the
  Tester looks at every screen; what PARTIAL may mean); **EXF-683** Medium ("the acceptance case
  contradicts the source" comes to the Lead as a card); **EXF-685** Medium (file names from the
  ticket id). EXF-573, EXF-611 and EXF-612 stay Urgent.
- **Why nothing new:** the three Builds hold the Plan page, the account page and register, and the
  import; every other unblocked ticket needs one of those or a shared module, or waits on the
  person's word. Main and live are equal: no Deploy, no flow test. And I add nothing more to this
  rate-limit window (opened 23:01Z): three long Builds are in it already.
- **Cards:** answered at once. A clean card on main: approve. A checks or gate card with no log:
  Abandon and carry over.

Ticket writes: 4 (four priorities). Review cadence: Build 3, Deploy 7, Discover 2, Test user flow 2.

### 2026-11-16 · Review round 106

Children used 123 of 200. One ended: **the Build template review completed**
(`p_dd5c621340c8478aab2076a69de29eb8`). Three Builds are running. Main and live `49012cd` (read by me
at 23:43Z).

**Build template review: what I approved, all of it filed.** Four tickets (EXF-682 notes from the
Lead to a running Build, High; EXF-683 "the acceptance case contradicts the source" as a card,
Medium; EXF-684 the Tester looks at every screen and what PARTIAL may mean, High; EXF-685 file names
from the ticket id, Medium) and eleven evidence comments (EXF-573, 612, 611, 576, 563, 564, 578, 627,
628, 629, 575), with my three additions; EXF-559's item 2 moved into EXF-682. Nothing approved was
left unfiled.
- What I take from it for my own work, beyond what review 104 recorded:
  - **The Designer step is the one that breaks source limits (six of six), and wording does not hold
    it.** Until the template changes, a Build whose screens the source cannot show gets no source at
    all, and a Build whose screens it can show gets the earlier readings as recorded values where
    they exist.
  - **A card answer's free text is the only channel that reaches every later step.** A ticket
    comment reaches only a step that happens to re-read the ticket (Implementers do; Designers,
    Reviewers and Testers do not).
  - **Boxes are lost while a Thread is idle** (a card, a pause): answer cards at once; avoid a second
    card for a finished Build.
  - A Reviewer's wait loop cost about 48 minutes across three Builds (EXF-563): nothing I can change
    from a brief.
  - The four lost Builds of that batch cost about 32 dollars and their carry-overs 21 more, by its
    count.

**Running:**
- **Plan import carry-over** (`p_51a143af64a84fd4bef3df56774f8506`): healthy box; the merge clean at
  `0b970a0` (35 files, 6,496 insertions); the Architect found the round-trip fixture already covers
  all eight kinds of row and that two invisibility tests are missing (the bank sync, a plan the
  owner deleted): the gaps I asked about.
- **Plan-page carry-over** (`p_27170c2d7ee8476b927e1819efee5d26`) and **Reconcile carry-over**
  (`p_a270cac61bad4df890e73afd054985a3`): working.

**Ticket writes:** 0. **Backlog:** 51 open feature tickets (48 done; 3 in progress). Gap: twelve
open, eight in progress. Template: forty open (Urgent EXF-573, 611, 612). Flow verdicts unchanged.
Finished since each template's last review: Build 3, Deploy 7, Discover 2, Test user flow 2.

**Next plan:** nothing to start.

### 2026-11-16 · Plan round 107

Children used 123 of 200. Nothing started; three Builds are running (the Plan-page, plan import and
Reconcile carry-overs). Main and live `49012cd`. No tickets were filed at the last review. The person
has not answered the round-100 check-in.

- **Why nothing new:** the three Builds hold the Plan page with the engine, the account page and
  register with the transactions service, and the import with the export's files; every other
  unblocked ticket needs one of those or a shared module, or waits on the person's word (the bank
  screens, the plan menu's dialogs). Main and live are equal: no Deploy and no flow test. Reviews:
  Build 3, Deploy 7, Discover 2, Test user flow 2 since each template's last review; none is due.
- **Cards:** answered at once. A clean card on main: approve; the others then rebase (the two named
  test-file conflicts are in their briefs). A checks or gate card with no log: Abandon and carry
  over.

Declared for the tree, unchanged: one Deploy for the three merges as they land; flows 3, 4 and 6
after it; then plan formats (EXF-468) or the register's View options (EXF-529).

Ticket writes: 0.

### 2026-11-17 · Review round 107

Children used 123 of 200. One ended: **the Reconcile carry-over was abandoned by me**
(`p_a270cac61bad4df890e73afd054985a3`, EXF-533 with EXF-664). Two Builds are running. Main and live
`49012cd` (read by me at 00:56Z).

**What happened between the plan and this review (all in side turns):**
- **23:55Z to 00:01Z: the Reconcile Designer used the source against an absolute ban.** The brief
  said in capitals that nobody opens the source app. The Designer opened a closed account of the
  test plan, opened Reconcile, typed a balance, pressed Enter and Next. By its report nothing was
  saved and it stayed inside the test plan.
- **00:01Z: the source app showed its sign-in page** in that box and stayed there. I do not know
  whether the Designer's actions caused it or the session expired.
- **00:16Z to 00:20Z:** the plan import Build (no screen, no use of the source) stopped at
  acceptance on the same check; my Proceed did not get past it (the Tester ran the check again).
  I escalated both cards to the person: only they can sign in.
- **The person answered Retry on both.** These are the only answers I have had from them in the
  rounds since the check-ins of rounds 90 and 100, whose questions are still open.
- **00:42Z: the Reconcile box was gone** (`/workspace/.exfab/bin/source_check.sh: No such file or
  directory`): the sixteenth lost box, the eleventh Build, lost while the escalated card waited.
  Abandoned at 00:48Z; the code is on its branch (head `cb25396`, PR 54 unmerged).
- **00:52Z and 00:53Z:** the import Build and the Plan-page Build each stopped again on a tab still
  at the sign-in page. I answered Retry on each with a command that loads the test plan's page
  again in that tab. The Plan-page Designer did not run it: it ran only the check and answered
  blocked 44 seconds later ("I'm not allowed to close tabs"). The import Build's result is not in
  yet.
- **00:57Z: in my own fresh box the test plan's page loads signed in** (address and title read,
  tab closed). So the sign-in is back for new boxes. Whether the two older boxes hold it I cannot
  tell.

**What I learned:**
- **An absolute ban does not hold the Designer step either.** Seven Designers with a screen, seven
  past a written limit (the template review counted six; this is one more). Evidence on EXF-573.
- **The source check fails on any tab at the sign-in page, also beside a loaded one, and for a
  Build that uses no source; no step repairs the tab, and my card note did not make one do it.**
  Evidence on EXF-479 (EXF-455 was closed into EXF-479 and EXF-559, so no new ticket).
- **An escalation costs the box.** Half an hour at a card was enough. When the same sign-out comes
  again, I abandon and carry over once a fresh box shows the sign-in, rather than wait in the old
  box.
- **My reading of the person's Retry, not their words:** I asked on the escalated Reconcile card
  whether the Designer may go on comparing Reconcile in the test plan; they answered Retry. I take
  that as yes, inside the test plan only, and said so to them. If they correct it, the next brief
  closes the source again.

**The Reconcile work, for the third Build:** code and tests complete (`pnpm check` 1,699 tests by
the Implementer's report; the full browser suite not run). The Designer's measured differences are
on EXF-533: the source keeps Reconcile enabled on a closed account (case 16 says disabled); the ask
popover's arrow, card and two primary buttons; the Difference step as the same popover widened to
323px, not a centred modal. Not measured: the bar, the "Account reconciled" popover, locked rows,
the Save confirmation.

**Running:**
- **Plan import carry-over** (`p_51a143af64a84fd4bef3df56774f8506`): reviewed and approved at
  `d427fbb` (1,803 tests; the Reviewer found a real race at the last import step, fixed with tests
  that fail on the old code). At acceptance, behind the source check.
- **Plan-page carry-over** (`p_27170c2d7ee8476b927e1819efee5d26`): built at `b680a59`, `pnpm check`
  green, three full browser runs at 448 passed and 0 failed. At the design check, behind the
  source check.
- If either comes back blocked again, I abandon it and carry it over into a fresh box: a further
  Retry in an old box has now failed twice.

**Ticket writes:** 4 comments (EXF-573, EXF-612, EXF-479, EXF-533). **Backlog:** unchanged: 51 open
feature tickets (48 done; 3 in progress). Gap: twelve open, eight in progress. Template: forty open
(Urgent EXF-573, 611, 612). Flow verdicts unchanged. Finished since each template's last review:
Build 4, Deploy 7, Discover 2, Test user flow 2.

**Next plan:** the third Reconcile Build, in a fresh box, merging `cb25396`.

### 2026-11-17 · Plan round 108

Children used 125 of 200. Started two Builds; a third is held back on purpose. Main and live
`49012cd`. No tickets were filed at the last review. The person has not answered the round-100
check-in.

**After the review, in a side turn (01:00Z):** the Plan-page and plan import Builds both came back
blocked on the tab at the sign-in page a further time; I abandoned both, as the review said I
would. The import Build's check had failed four times in its box. Both branches are whole:
`b680a59` (Plan page) and `d427fbb` (import, reviewed and approved).

**Started:**
- **Plan import, second carry-over** (`p_54808387099a4079ae59bcea99e3509f`, EXF-477 API half with
  EXF-670): merges `d427fbb` (36 files, 6,970 insertions); acceptance and the gate are left. One
  addition from the Reviewer's open risk: amounts with thousands separators (`$1,234.56`) are
  accepted when unambiguous under the file's number format; the clone's export writes none
  (`plan-export.ts` says so), and nobody has seen whether the source's real export does. The
  owner's real file must not be refused for that.
- **Plan page, second carry-over** (`p_d551d2b31d2045cebf7e9161c230c828`, EXF-537 with EXF-622,
  623, 624, 616, 646): merges `b680a59` (57 files, 3,154 insertions); the design check, a review of
  everything after the first review, acceptance and the gate are left. One full browser run instead
  of three (three were clean on this commit). The Reviewer also reads the month picker's
  click-outside race that failed `e2e/month-nav.spec.ts` once.
- I tried both merges together in a throwaway worktree: they conflict only in
  `apps/worker/test/mcp-timestamps.test.ts` and `apps/worker/test/plan-export-calls.test.ts`, as
  both briefs say.

**New in both briefs:**
- The Clerk prints the number of tabs at the sign-in page after opening its own (must be 0;
  otherwise "SOURCE SIGNED OUT IN THIS BOX" in its first line).
- Any step that meets a source check failing on a sign-in tab loads the test plan's address again
  in that tab once, with a command I tested in my own box at 01:05Z (it navigated a blank tab to
  the test plan's page; signed in), then runs the check again; "RELOADED, STILL SIGNED OUT" if it
  still fails. A card note did not make a step do this; a brief may.

**Held back: the third Reconcile Build (EXF-533 with EXF-664, merges `cb25396`).** The source
signed out while the last Reconcile Designer was pressing through Reconcile in the test plan. I do
not know whether that caused it. Its design step would come before the Plan-page Build's own
source checks, and no wording has kept a Designer out of the source. So it starts when the two
Builds above are past acceptance; a sign-out then stops only itself, and would tell me the cause.
Its brief will allow what the person's Retry allowed by my reading: comparing Reconcile in the test
plan only, never pressing a button that saves.

**Not started, and why:** every other unblocked ticket needs the Plan page, the account page or
the register (held by these three), a shared module, or the person's word. Main and live are
equal: no Deploy, no flow test. Reviews since each template's last review: Build 6, Deploy 7,
Discover 2, Test user flow 2; none is due.

Declared for the tree: the two Builds, the Reconcile Build, one Deploy (`ZZ-TEST D29`) for the
three merges, then flows 3, 4 and 6.

Ticket writes: 2 comments (EXF-477, EXF-537).

### 2026-11-17 · Review round 108

Children used 125 of 200. Two ended since the last review, both **abandoned by me at 01:00Z** and
both already carried over in the plan of this round: the Plan-page carry-over
(`p_27170c2d7ee8476b927e1819efee5d26`, branch head `b680a59`, PR 56 unmerged) and the plan import
carry-over (`p_51a143af64a84fd4bef3df56774f8506`, branch head `d427fbb`, PR 55 unmerged). Nothing
merged. Main and live `49012cd` (read by me at 01:09Z).

**Why they ended:** the platform's source check kept failing on a tab left at the sign-in page in
their old boxes (the import Build four times, the Plan-page Build twice), and no step reloaded the
tab. Not a fault of either Build's work. Evidence is on EXF-479; the tickets (EXF-477, EXF-537)
carry the comments.

**Running, both in fresh boxes, both started well (their Clerks at 01:07Z):**
- **Plan import** (`p_54808387099a4079ae59bcea99e3509f`): platform files present; three source tabs,
  none at the sign-in page; merge clean at `d427fbb` (36 files, 6,970 insertions). The Architect is
  writing the thousands-separator rule.
- **Plan page** (`p_d551d2b31d2045cebf7e9161c230c828`): platform files present; three source tabs,
  none at the sign-in page; merge clean at `b680a59` (57 files, 3,154 insertions).
- Their manifests are the earlier ones (the Plan-page one gains `e2e/record-payment.spec.ts`); they
  share only the two test files and two documents both briefs name. They run side by side as
  before.

**Lost boxes and lost Builds so far, for the check-in at round 110:** sixteen children lost their
platform files (EXF-612); two more Builds were lost to the stale sign-in tab (EXF-479). Three groups
of tickets need a third Build each (Plan page and import running, Reconcile to start): six extra
children in all, five of them started.

**Ticket writes:** 0. **Backlog:** unchanged: 51 open feature tickets (48 done; 3 in progress).
Gap: twelve open, eight in progress. Template: forty open (Urgent EXF-573, 611, 612). Flow verdicts
unchanged. Finished since each template's last review: Build 6, Deploy 7, Discover 2, Test user
flow 2.

**Next plan:** the third Reconcile Build once both running Builds are past acceptance; nothing
else can start beside them.

### 2026-11-17 · Plan round 109

Children used 125 of 200. Nothing started; two Builds are running (the plan import and Plan-page
carry-overs, both started at 01:06Z in fresh boxes). Main and live `49012cd`. No tickets were filed
at the last review. The person has not answered the round-100 check-in.

- **Why nothing new:** the third Reconcile Build stays held until both running Builds are past
  acceptance (the reason is in the plan of round 108). Every other unblocked ticket needs the Plan
  page, the account page or the register, a shared module, or the person's word. Main and live are
  equal: no Deploy and no flow test. Reviews: Build 6, Deploy 7, Discover 2, Test user flow 2 since
  each template's last review; none is due.
- **Cards:** answered at once. A clean card on main: approve; the other then rebases (the two named
  test-file conflicts are in both briefs). A source check failing a further time after the brief's
  reload: abandon only if a fresh box would differ; otherwise to the person. A checks or gate card
  with no log: Abandon and carry over.

Declared for the tree, unchanged from round 108: the two running Builds, the Reconcile Build, one
Deploy (`ZZ-TEST D29`) for the three merges, then flows 3, 4 and 6. The next review is round 109's;
the check-in is the review of round 110.

Ticket writes: 0.

### 2026-11-17 · Review round 109

Children used 125 of 200. Two ended: **the plan import Build completed and merged**
(`p_54808387099a4079ae59bcea99e3509f`, pull request 57, main now `8b3e9a7`), and **the Plan-page
Build was abandoned by me** (`p_d551d2b31d2045cebf7e9161c230c828`, branch head `ffcd2eb`, PR 58
unmerged). Nothing is running. Live is still `49012cd` (read by me at 05:03Z); one migration is
pending on live, `20261116101300_plan_imports.sql`.

**What happened: a second rate-limit pause, 01:47Z to 04:00Z.** Both Builds came back in new boxes
without the platform's files (the seventeenth and eighteenth child; evidence on EXF-612).
- **Plan import: landed all the same.** It was paused at its relay step, after the final gate. Its
  relay agent asked for help (`card.md` and `gate-line.txt` gone). I gave it a text to send in
  their place, marked as rebuilt, with only the head, the base, the diff size and the listing. The
  approval card came. **I did the gate's work by hand on that head (`2540886`) in a throwaway
  checkout: `pnpm check` 133 files and 1,825 tests; the whole browser suite 430 passed, 2 skipped,
  0 failed.** I approved at 05:02Z and it landed at 05:03Z. Main's tree equals the commit I checked
  (`git diff` empty).
- **Plan page: lost before acceptance.** Its Reviewer approved `ffcd2eb` at 04:08Z in the new box
  (after installing the browser itself); then the dev-server step failed with an empty message.
  The gate cannot run in such a box. Abandoned at 04:54Z.

**The plan import as merged (EXF-477 API half, EXF-670):** `POST /api/v1/budgets/import`, its
`continue` and cancel, tools `import_budget_export`, `continue_budget_import`,
`cancel_budget_import`; acceptance 15 of 15; the 20,000-transaction file in 17 calls with at most
3 D1 and 2 R2 calls each; thousands separators accepted when unambiguous. Known issues: the zip
filter's narrower checks; a stored file left in R2 if its delete fails; never tried with a real
export. EXF-670 is Done; EXF-477 is back in Backlog for the dialog (parked on the person's word).

**The Plan-page work at `ffcd2eb`:** reviewed and approved there (cases 21, 28 and 26 each shown
failing on the old code; the month picker spec passed 5 of 5 alone and could not be made to fail);
one polish item applied (P6: at 1024 px the header, group and category names now start at the same
x); one full browser run gave 447 passed and 1 failed, `e2e/reflect-frame.spec.ts` "548-6 account
filter sections", a file the branch does not touch, 10 of 10 alone: called load by the
Implementer, **not read by anyone, so by my rule still open**. Acceptance and the gate are left.

**What I learned:**
- **A Thread past its gate can land from a box without the platform's files;** the steps before
  the landing (checks, dev server, gate) cannot. So: a late help card gets an answer and my own
  check of the head; an early one gets Abandon.
- **The rate limit, not the Builds, now decides what lands.** Two pauses (20:17Z to 23:01Z,
  01:47Z to 04:00Z) hit every Build running at the time: three were lost in the first, one in the
  second, and the import Build landed only because it was already past its gate. The allowance
  lasted 2 hours 46 minutes with three Builds, then two, running. A Build must start early in a
  window and be short, and I run fewer at once.
- **The Designer went into the source again against the ban** (the Plan page of the test plan,
  measuring only; it left the tab at a wrong size and restored it). Eight of eight. Evidence on
  EXF-573. Its finding was real (P6).
- The sign-in tab rule in the new briefs was not needed: both fresh boxes were signed in.

**Ticket writes:** 6 (EXF-670 Done and comment; EXF-477 Backlog and comment; evidence on EXF-573
and EXF-612). **Backlog:** 51 open feature tickets (48 done; 2 in progress: EXF-537, EXF-533). Gap:
twelve open, seven in progress, EXF-670 done. Template: forty open (Urgent EXF-573, 611, 612). Flow
verdicts unchanged. Finished since each template's last review: Build 8, Deploy 7, Discover 2, Test
user flow 2.

**Next plan:** the fourth Plan-page Build, short, merging `ffcd2eb` onto main `8b3e9a7` (I try the
merge first: the two test files will conflict). A Deploy for the import merge can run beside it.
The Reconcile Build waits for the Plan-page Build's acceptance.

### 2026-11-17 · Plan round 110

Children used 126 of 200. Started one Build. Main `8b3e9a7`, live `49012cd` (one merge and one
migration behind). No tickets were filed at the last review. The person has not answered the
round-100 check-in.

**Started: the Plan page, third carry-over** (`p_27986a1771a440a3b5efdec4bd06865a`, EXF-537 with
EXF-622, 623, 624, 616, 646): merges the approved branch `ffcd2eb` onto main `8b3e9a7`.
- **I tried it first in a throwaway worktree.** The merge conflicts in the two test files both
  earlier briefs named; two `sed` commands resolve them (both lines kept in the timestamp list;
  `pinPlanClock();` with a count of 16 in the export's counting test). I ran the brief's three
  command blocks exactly as written: 57 files, 3,199 insertions. Then `pnpm check` on the merged
  tree: 1,852 tests pass and one fails, `apps/worker/test/plan-export-now.test.ts` line 56
  (`expected 16 to be 15`): the import Build's new test counts the export's calls, and the Plan
  page adds one. The brief gives the Implementer that one line as its first job.
- **The brief is built to be short**, because a pause has killed this work twice: the Architect
  gets five minutes; the Implementer runs no full browser suite; the Designer confirms P6 in the
  clone only; the Reviewer reviews only what changed after `ffcd2eb`; the Tester's acceptance and
  the gate are the real work. The Implementer also reads `e2e/reflect-frame.spec.ts` "548-6", which
  failed once under load and was called load without being read.

**Not started, and why:**
- **The Deploy for the import merge.** One Deploy after the Plan-page Build ships both and saves a
  child; the import is REST and MCP only, with nothing for the owner to see on a screen, and a
  Deploy beside the Build would spend the rate-limit allowance the Build needs.
- **The third Reconcile Build:** after the Plan-page Build's acceptance (its Designer will go into
  the source; and one Build at a time while pauses replace boxes).
- Everything else needs the Plan page, the account page or the register, a shared module, or the
  person's word. Reviews: Build 8, Deploy 7, Discover 2, Test user flow 2 since each template's
  last review; the Build review is due after two more.

**My error this turn, repaired:** while trying the brief's merge commands I set a throwaway git
identity with `git config` inside the worktree. A worktree shares the repository's config, so that
overwrote the repository's own identity, and my clean-up then removed it. I restored the name and
email from my last journal commit and checked that they match. From now on a throwaway commit gets
its identity from `git -c` on the command line only.

Declared for the tree: the Plan-page Build; one Deploy (`ZZ-TEST D29`) for both merges; the
Reconcile Build; flows 3, 4 and 10 after the Deploy, flow 6 after Reconcile. The review of this
round is the check-in.

Ticket writes: 1 comment (EXF-537).

### 2026-11-17 · Review round 110 (check-in)

Children used 126 of 200. Nothing ended since the plan of this round; the Plan-page Build
(`p_27986a1771a440a3b5efdec4bd06865a`) is in its Clerk step (05:14Z). Main `8b3e9a7`, live `49012cd`
(read by me at 05:14Z); one migration pending on live (`20261116101300_plan_imports.sql`).

**Since the check-in of round 100, counted from the children list:** eleven children started (115
to 126): eight Builds, one Deploy, one flow test, one template review.
- **Went live** (Deploy D28, live `49012cd`): Export Plan through REST and MCP; the card's Payment
  pill and Record Payment; shift+click ranges and Move to Account in the register; readable bulk
  refusals.
- **Merged, not live:** the plan import through REST and MCP (`8b3e9a7`), on its third Build.
- **Lost, none for a fault of its work, seven Builds:** three to the first rate-limit pause
  (`p_8baa…`, `p_b719…`, `p_c4fd…`), one to a box replaced while an escalated card waited
  (`p_a270…`), two to a tab left at the source's sign-in page (`p_2717…`, `p_51a1…`), one to the
  second rate-limit pause (`p_d551…`).
- **In flight:** the Plan page (fourth Build, approved code, acceptance and gate left); Reconcile
  (code complete on `cb25396`, third Build not started).

**Check-in sent** (round 110). Its points: the state above; that the rate limit now decides what
lands, and what I ask about it; the Designers in the source (eight of eight; the sign-out at
00:01Z; my reading of the person's Retry); the open questions, ranked, with two new ones (may a
child download the test plan's export from the source to check the importer; the Cloudflare plan,
which now matters for the import's first step); that 74 children will not reach parity at this
loss rate, and the order I work in; my own errors of these rounds.

**Ticket writes:** 0. **Backlog:** 51 open feature tickets (48 done; 2 in progress). Gap: twelve
open, seven in progress. Template: forty open (Urgent EXF-573, 611, 612). Flow verdicts: 1
`parity_known_gaps`; 2, 3, 4 `new_gaps`; 5, 7 `parity_known_gaps`; 8, 9, 10, 11 `parity`; 6 not
run. Finished since each template's last review: Build 8, Deploy 7, Discover 2, Test user flow 2.

**Next plan:** nothing to start while the Plan-page Build runs; then one Deploy for both merges,
then the Reconcile Build.

### 2026-11-17 · Plan round 111

Children used 126 of 200. Nothing started; one Build is running, the Plan-page third carry-over
(`p_27986a1771a440a3b5efdec4bd06865a`). Main `8b3e9a7`, live `49012cd`. No tickets were filed at
the last review. The person has not answered the round-110 check-in (sent at 05:16Z).

- **The Build, at 05:33Z, 19 minutes in:** the Clerk's merge went as the brief said (`c09175e`, 57
  files, both conflicts resolved, no tab at the sign-in page); the Architect took one commit; the
  Implementer changed the one test line and `pnpm check` passes with 1,853 tests (`3623ee0`); the
  design check is running.
  - **The Designer is measuring the source again** ("measure the narrow Plan page and the wide one
    on both apps"; it had to reset the source tab's viewport after a screenshot timed out), against
    a brief that says in capitals not to open, measure or capture it. Nine of nine. Evidence goes
    on EXF-573 at the review.
  - `e2e/reflect-frame.spec.ts` "548-6", read by the Implementer: the spec clicks by screen
    coordinates right after the accounts list reloads; a reload under load could move a row before
    the click lands; no wait it could name is missing; the product code is out of this Build's
    bounds. A known issue for me: a Low gap ticket with the next Reflect work, if it fails again.
- **Why nothing new:** one Build at a time while rate-limit pauses replace boxes (the window opened
  at 04:00Z). The Deploy waits for this Build so that one Deploy ships both merges. The Reconcile
  Build waits for this Build's acceptance.
- **Cards:** answered at once. A clean approval card on main `8b3e9a7`: approve. A help card after
  the gate: an answer and my own check of the head. A failure before the gate with no log: Abandon.

Declared for the tree, unchanged from round 110. Reviews: Build 8, Deploy 7, Discover 2, Test user
flow 2 since each template's last review.

Ticket writes: 0.

### 2026-11-17 · Review round 111

Children used 126 of 200. One ended: **the Plan-page Build completed and merged**
(`p_27986a1771a440a3b5efdec4bd06865a`, pull request 59, main now `0fefc6c`), on its fourth Build.
Nothing is running. Live is still `49012cd` (read by me at 06:30Z), two merges behind; one
migration is pending on live, `20261116101300_plan_imports.sql`.

**The Plan page (EXF-537 with EXF-622, 623, 616, 646; EXF-624 closed as not a gap): merged.** I
approved its card at 06:29Z in a side turn.
- **Gate** on main `8b3e9a7` at head `40b4497`, the PR head: check passed; the whole browser suite
  448 of 448 three times; changed specs ten times, 420 of 420; no flake. Main's tree equals the
  gated head (compared now).
- **The Build took 77 minutes in one box, inside one rate-limit window** (05:13Z to 06:30Z). The
  merge commands and the one failing test line I had tried beforehand went as written.
- **What it added after the last approved head (`ffcd2eb`), which I read before approving:** the
  export's count of 16 in the import Build's test; polish P7 (dark scrollbars on the Plan grid and
  panel; scoped there, not in the shell); and a fix for its Reviewer's one finding: a filtered view
  that holds a single category was treated as one ticked category in Auto-Assign (singular labels,
  Underfunded hidden, a card's Total Underfunded added to a plan-wide run). Now "one" means one
  explicitly ticked. Reviewed and approved at `40b4497`.
- **Two weaknesses I accepted rather than send it round again:**
  - **That fix has no test of its own.** Filed through this review as a Low gap ticket.
  - **The Tester's acceptance took 76 seconds and rested on specs;** it looked at three screenshots
    at 1024×700 and reused a stored one at 1440, against the brief. Evidence on EXF-684. The flow
    tests on live look at every state at both sizes.
- **The Designer measured the source again, in both its passes,** against the strongest wording I
  have (ticking categories in the test plan to compare the Auto-Assign card; nothing left ticked).
  Nine of nine. Evidence on EXF-573. Its finding (light scrollbars) was real.
- `e2e/reflect-frame.spec.ts` "548-6": did not fail in the gate's three full runs or in mine.
  The Implementer's reading (a click by coordinates right after a list reload) stays a note here.

**What I learned:**
- **A carry-over that I try first, with the finished steps told to confirm and move on, fits one
  window.** That is the shape for the Reconcile Build too.
- **No wording keeps the Designer out of the source.** I stop spending brief text on it. What I
  can still do: say what it may never do there (save, create, delete), and run such a Build alone.

**Ticket writes:** 15 (EXF-537, 622, 623, 616, 646 to Done and EXF-624 to Canceled, each with a
comment; evidence on EXF-573 and EXF-684; EXF-674 item 1). One ticket filed through this review.
**Backlog:** 50 open feature tickets (49 done; 1 in progress: EXF-533). Gap: twelve open and one in
progress (EXF-664), counted from the tracker now, plus the one filed here. Template: forty open
(Urgent EXF-573, 611, 612). Flow verdicts unchanged. Finished since each template's last review:
Build 9, Deploy 7, Discover 2, Test user flow 2.

**Next plan:** one Deploy (`ZZ-TEST D29`) for the two merges (`8b3e9a7`, `0fefc6c`); the third
Reconcile Build beside it (a Deploy and a Build share no file; no approval while it releases); set
the new ticket's priority.

### 2026-11-17 · Plan round 112

Children used 128 of 200. Started two: a Deploy and the Reconcile Build. Main `0fefc6c`, live
`49012cd` (two merges and one migration behind). The ticket filed at the last review exists as
**EXF-714** (the missing Auto-Assign test); priority set to Low; nothing blocks it. The person has
not answered the round-110 check-in.

**Started:**
- **Deploy D29** (`p_516e428ce4884aebb8cfc56181b7d973`): ships main `0fefc6c`, expects the one
  migration `20261116101300_plan_imports.sql`; `gated_commit` `40b4497` (its tree equals main's,
  compared now). Its checks on live: 81 tools; the card's payment status through REST and MCP; on
  the Plan page the PAYMENT button and dialog, the payment pill, the Payment card in the "enough"
  and "overspent categories" states, Record Payment opening the card's page, Auto-Assign's
  Underfunded for a ticked payment row, and the page at 1024×700; then an export, a dry-run import,
  a real import and a second export of its own two test plans, compared file by file.
  - **A trap I wrote the brief around:** an import without `name` takes its plan's name from the
    file's name, which has no hyphen (`ZZ TEST D29 check`), so the prefixed purge would not find it
    and it would be counted beside the owner's plan. Every import call carries
    `name` = `ZZ-TEST D29 imported`.
  - Where I do not know what the app shows (the pill's colour in the overspent state; the card's
    state after assigning straight to the payment category while a category is still overspent),
    the brief says so and asks for a report, not a pass.
- **Reconcile, third Build** (`p_8d9e0864404e426d946c60c989a6c4a2`, EXF-533 with EXF-664): merges
  `cb25396` onto main `0fefc6c`.
  - **I merged it and ran everything first.** The merge is clean, but **`pnpm check` fails 32 tests
    and the browser suite 2 specs**, both from this Build's new account column meeting code merged
    since: the plan import writes account rows by position (every import answers 500, `13 values
    for 14 columns`), and `e2e/sidebar-groups.spec.ts` stubs accounts without the new field. One
    line each; with both, the failing tests pass (tried). The brief gives the Implementer both as
    its first job and asks the Reviewer to search for more statements that list columns by position
    (the third of this kind).
  - **My decisions on the last Designer's measurements, written into the brief so that no design
    round is spent on them:** Reconcile stays disabled on a closed account (a known difference from
    the source: what it does there past the popover is unknown, and an adjustment would give a
    closed account a new transaction); the ask popover and the bank-balance step as measured; the
    Difference step becomes the same popover widened to 323px, not a centred modal.
  - **The source:** instead of a ban I name the one action that must not happen and why (nobody
    presses Next, Create Adjustment or Finish: the session signed out 36 seconds after the last
    Designer pressed Next), and say that nothing is left to measure without those buttons.
  - The Reviewer reviews all of it (never reviewed); the Tester takes a fresh screenshot per state
    and size.

**Why both at once:** a Deploy and a Build share no file, and the Deploy is done long before the
Build's card (no approval while it releases). By the two earlier pauses the allowance carried about
three Builds for three hours; this window (from 04:00Z) has carried one. If the limit comes all the
same, the Build's code is on its branch and I carry it over again.

**Not started:** flows 3, 4 and 10 wait for the Deploy. Everything else needs the account page or
the register (the Reconcile Build), a shared module, or the person's word. Reviews: Build 9, Deploy
7, Discover 2, Test user flow 2 since each template's last review; the Build review starts after
the next finished Build.

Declared for the tree: the Deploy; the Reconcile Build; flows 3, 4 and 10; a Deploy and flow 6
after Reconcile; the Build template review.

Ticket writes: 2 (EXF-714 priority; a comment on EXF-533).

### 2026-11-17 · Review round 112

Children used 128 of 200. One ended: **Deploy D29 completed**
(`p_516e428ce4884aebb8cfc56181b7d973`). **Live is `0fefc6c`** at https://budget.doxen.dev (read by
me at 06:58Z), equal to main; no migration is pending. One Build is running (Reconcile).

**Deploy D29: released, every check passed, nothing differs from the brief.**
- Gate passed (the tree equals gated `40b4497`, so the browser run was skipped; checks 211 s).
  Release: the D1 bookmark phase ran; `20261116101300_plan_imports.sql` applied; smoke ok. The box
  kept its files from start to end.
- Health gives the whole sha of `0fefc6c`; without credentials 401; **81 MCP tools**.
- **The Plan page's card payments on live, at both sizes:** the PAYMENT button and dialog; the pill
  green (`positive`) at $120.00, yellow (`cautious`) while a category is overspent on the card; the
  Payment card "enough" and "Overspent Categories" with the right sentences and figures; Record
  Payment opens the card's page with the row open; Auto-Assign's Underfunded $50.00 applied
  (assigned 50000, Ready to Assign 650000); the plan-wide card lists Underfunded at $0.00. At
  1024×700: names start at one x (305), the panel is 320 px, no sideways scroll, dark scrollbars;
  long names are cut after their first word with an ellipsis.
- **What I had not predicted, now known:** after assigning straight to the payment category while a
  category is still overspent, the card reads "enough" and keeps a separate "Overspent Categories
  $50.00" row. Not compared with the source.
- **The import on live:** export, dry-run import (2 accounts, 14 categories, 4 transactions, no
  warning, nothing written), real import (201), export again: both Plan files and both Register
  files identical by `cmp`; the imported plan's figures equal the original's; cancel of a finished
  import 409 `import_finished`; the MCP tool gives the same preview; `now` two days ahead refused
  with 422 (EXF-670).
- **Plans not starting with `ZZ-TEST`: 1** (the owner's); the purge left 0 of the run's two plans.
- The verifier's own slip, reported by it: it re-ran its setup script once and made a duplicate
  transaction in its own test plan; deleted and re-read before the later checks.
- The "enough" card's first sentence on live is "You have enough money to pay off your current
  balance!" followed by "You can make this payment anytime."; my brief quoted only the second.

**Reconcile Build** (`p_8d9e0864404e426d946c60c989a6c4a2`): merged clean (`6eeb333`); the Architect
wrote the second carry-over section (`282c64a`); the Implementer is on the two breaks.

**Ticket writes:** 2 (live notes on EXF-537 and EXF-477). No new ticket. **Backlog:** 50 open
feature tickets (49 done; 1 in progress). Gap: thirteen open (with EXF-714), one in progress.
Template: forty open (Urgent EXF-573, 611, 612). Finished since each template's last review: Build
9, Deploy 8, Discover 2, Test user flow 2.

**Not yet proven on live, unchanged:** the 03:00 UTC job entering a due schedule by itself (it ran
at 03:00Z today with no due schedule of mine on live); multi-run bank sync.

**Next plan:** flows 3 and 4 on live (the Plan page and the card, every state at both sizes), and
flow 10 with the import; they can run beside the Build (no Deploy starts until they end).

### 2026-11-17 · Plan round 113

Children used 129 of 200. Started one flow test. Main and live `0fefc6c`. No tickets were filed at
the last review. The person has not answered the round-110 check-in.

**Started: flows 3 and 4 on live in one run** (`p_ad1b056c3b91409d84f2b8182ba6d83b`, prefix
`ZZ-TEST F113`). One child for both, because both walk the Plan page and each alone is short.
- **Flow 3, second run, short:** two targets and one overspent category; plan-wide Underfunded
  1,060.00 applied (Ready to Assign 3,000.00 to 1,940.00) and then listed at $0.00; the one-category
  card without an Underfunded row; the card's heights (352 and 304 px); **a view holding one
  category stays plan-wide** (the behaviour EXF-714 wants a test for); December (Ready to Assign
  1,910.00, Underfunded 1,060.00 by the refill rule found in the first run); the page at 1024×700
  with long names.
- **Flow 4, third run:** five cards, one per payment state (paid off, enough, underfunded by a
  starting debt of 1,200.00, overpaid by 50.00, 30.00 of overspent categories); the pills' text,
  colour and class; each Payment card's words; the balance breakdown; Cover Overspent Categories;
  Auto-Assign for a payment row (Ready to Assign 1,500.00 to 300.00); Record Payment from the
  inspector (ZZ Checking 1,615.00 to 1,495.00); December after an overpayment; the tool
  `get_card_payment_status` for all five.
- **New rule in this brief (rule 15), because the Build's Tester accepted these screens on tests:**
  a fresh screenshot of every named state at both sizes, opened, with one sentence on what is seen.
  Also: the setup script runs once (the Deploy's verifier doubled a transaction by running it
  twice).
- Where I do not predict (the pill of the overspent-categories card, the Auto-Assign amounts for
  past payments, the paid-off card after Record Payment), the brief says so.
- **Not started: flow 10.** Deploy D29 checked the new REST operations and tools on live an hour
  ago (81 tools, the import round trip, the payment status tool); a further run would spend a
  child on the same calls.

**Running beside it:** the Reconcile Build (`p_8d9e0864404e426d946c60c989a6c4a2`). A flow test and
a Build share nothing; no Deploy starts until the flow test ends.

**Not started:** everything else needs the account page or the register (the Reconcile Build), a
shared module, or the person's word. Reviews: Build 9, Deploy 8, Discover 2, Test user flow 2
since each template's last review. The template-ticket sweep is due about round 114; I start it
when the Build review starts, so that the sweep sees that review's tickets.

Declared for the tree: the Reconcile Build; this flow test; a Deploy and flow 6 after Reconcile;
the Build template review; then plan formats (EXF-468) or the register's view options (EXF-529).

Ticket writes: 0.

### 2026-11-17 · Review round 113

Children used 129 of 200. One ended: **the flow test completed**
(`p_ad1b056c3b91409d84f2b8182ba6d83b`, flows 3 and 4 on live `0fefc6c`, prefix `ZZ-TEST F113`, 24
minutes). The Reconcile Build is running. Main and live `0fefc6c`.

**Flow 3 (targets, Auto-Assign, next month), second run: `parity`.** Every figure of mine held and
every step ran: Underfunded 1,060.00 applied (Ready to Assign 3,000.00 to 1,940.00) and then listed
at $0.00; the cards 352, 304 and 352 px; **a view holding one category stays plan-wide** (the
labels read word for word); December 1,910.00 with Underfunded 1,060.00; at 1024×700 the panel is
320 px, no sideways scroll, every cut name has an ellipsis and a tooltip. No minus sign on the Plan
page is a hyphen.
- Not filed, and I agree: at 1024×700 the target text of a row gives way to the name (it sits on a
  clipped second line, with a tooltip): the source's own rule, recorded as polish P3.

**Flow 4 (credit cards: the five payment states), third run: `new_gaps`, one gap.** Every figure
held: the five pills and classes, each Payment card's words, the balance breakdown, Auto-Assign for
a payment row (Ready to Assign 1,500.00 to 300.00), Record Payment from the inspector (ZZ Checking
1,495.00, then the paid-off card), December after an overpayment (paid off, +$50.00), the tool's
five states equal to the screen.
- **EXF-720 (triaged Medium): the "Using Credit Cards" dialog's `Got it!` button is white text on
  a near-white button** (the browser's default button), at both sizes. The Build's spec passed it,
  its Tester did not look, the Deploy's verifier clicked it without remark. **The flow test found
  it because its brief made it open every screenshot.** Evidence on EXF-684.
- What I had left open, now read: the overspent-categories card's pill is $0.00 yellow
  (`cautious`); an overspent category paid by card shows −$30.00 yellow with a card icon
  (`cautious credit`); Paid Last Month and Average Paid read $0.00 in the first month and $385.00
  in December.
- **Noted, not filed (no written rule; unknown in the source, whose test plan has no card):** an
  overpaid card's payment row reads "Overspent. $50.00 of $0.00" in the grid while its card says
  overpaid, and the Overspent view counts it ("2 Overspent"); Cover Overspent Categories switches
  the panel to the view's summary because the ticked row is hidden by the view; the Available for
  Payment pill sits 8 px right of the other amounts; an Assigned amount runs 4 px past its button
  at 1024 px without being cut; Prior Balance $50.00 has no plus sign beside a Current Balance of
  +$50.00. These wait for a source test plan with a card (asked at three check-ins).
- Cleanup: `deleted 2 remaining 0`; plans not starting with `ZZ-TEST`: 1. No source app, no plan
  menu, no bank connection, no response headers. The run's box had no Playwright browser and no
  `node_modules`; it used the box's Chrome with its own `playwright-core`.

**Reconcile Build** (`p_8d9e0864404e426d946c60c989a6c4a2`), 38 minutes in: both breaks fixed
(`pnpm check` 1,876 tests), decisions B to D built, the whole browser suite 455 passed; in its
first design round.
- **The Designer opened Reconcile in the source again (the ask step and the bank-balance step on a
  closed account, in dark and light), but it did not type, did not press Next and did not open the
  Difference step, and said why: the rule I named.** The source stayed signed in. Naming the one
  forbidden action with its reason held where nine bans did not.
- **It corrected a decision of mine taken from the last Designer's words:** No and Yes sit side by
  side (about 120 px each, 8 px gap), not full width each; the label and the amount share one card.
  Eight polish items in all; the Implementer applies them.

**Flow verdicts now:** 1 `parity_known_gaps`; 2 `new_gaps` (EXF-679, 680, 681); 3 `parity`; 4
`new_gaps` (EXF-720); 5, 7 `parity_known_gaps`; 8, 9, 10, 11 `parity`; 6 not run.

**Ticket writes:** 3 (EXF-720 priority and comment; evidence on EXF-684). No new ticket from me.
**Backlog:** 50 open feature tickets (49 done; 1 in progress). Gap: fourteen open (with EXF-714 and
EXF-720), one in progress. Template: forty open (Urgent EXF-573, 611, 612). Finished since each
template's last review: Build 9, Deploy 8, Discover 2, Test user flow 3.

**Next plan:** nothing beside the Reconcile Build: the next small Build (EXF-720 with EXF-714 and
the rest of EXF-674, all on the Plan page) touches no file of Reconcile's, so it could run beside
it; I decide in the plan by the rate-limit window (it resets at 09:00Z).

### 2026-11-17 · Plan round 114

Children used 129 of 200. Nothing started; the Reconcile Build is running
(`p_8d9e0864404e426d946c60c989a6c4a2`, in its design round). Main and live `0fefc6c`. The flow
test's ticket EXF-720 is triaged (Medium). The person has not answered the round-110 check-in.

**What comes next, chosen now from the 45 feature tickets in the backlog:**
- **EXF-509, the Plan page's Activity popover** (a category's transactions for the month; Medium),
  with **EXF-720** (the unreadable `Got it!` button) and **EXF-714** (the missing Auto-Assign
  test) in the same Build: all three are Plan-page files. Why this one: the person asked for
  "historical tracking of all past transactions and assigned lines", and this is the Plan page's
  way to the transactions behind a figure; it is small; and it shares no file with Reconcile if its
  read lives in new Worker files (the brief will say so: Reconcile holds
  `repositories/transactions.ts`, `services/transactions.ts`, their route and tool).
- **EXF-468, plan formats** (High) waits for Reconcile's merge: it changes how every amount and
  date is written, and Reconcile brings the one shared formatter for screens.
- The rest of EXF-674 touches the register: after Reconcile.
- Parked on the person's word, unchanged: EXF-477's and EXF-476's dialogs, EXF-463, 461, 460, 471,
  480, 510.

**Why not started now, although it could run beside Reconcile:** the rate limit. By my rough count
this window (04:00Z to 09:00Z) has carried about three Build-hours of children and many long turns
of mine, against about seven or eight before the two earlier pauses came. A second Build now would
raise the chance of a pause before 09:00Z, and a pause would cost both Builds, one of them nearly
done. The count is a guess; the losses it guards against were real. I start the Build when
Reconcile ends, close to the reset.

**Reviews:** Build 9, Deploy 8, Discover 2, Test user flow 3 since each template's last review.
Reconcile will be the tenth Build: the Build review and the template-ticket sweep (due about now)
start then.

Declared for the tree: the Reconcile Build; the Activity popover Build; a Deploy and flow 6 after
Reconcile; the Build review and the sweep; plan formats.

Ticket writes: 0.

### 2026-11-17 · Review round 114

Children used 129 of 200. One ended: **the Reconcile Build completed and merged**
(`p_8d9e0864404e426d946c60c989a6c4a2`, pull request 60, main now `d005439`), on its third Build.
Nothing is running. Live is `0fefc6c` (read by me at 08:34Z), one merge behind; one migration is
pending on live, `20261116101400_account_reconciled_at.sql`.

**Reconcile and the shared minus sign (EXF-533, EXF-664): merged; both Done.** I approved its card
at 08:33Z in a side turn.
- **Gate** on main `0fefc6c` at head `8b415ab`, the PR head: check passed; the whole browser suite
  456 of 456 three times; changed specs ten times, 1,140 of 1,140; no flake. Main's tree equals
  the gated head (compared now). 82 MCP tools on main (`reconcile_account` is new).
- **The Build took 105 minutes in one box** (06:48Z to 08:33Z), inside the rate-limit window, with
  two design rounds and two reviews. The two breaks I had found beforehand were its first commit.
- **The first review found a real fault:** two reconciles stamped in the same millisecond could
  both write an adjustment while the second answered 409 "nothing written" (the Worker's clock
  moves only after I/O). Fixed by guarding the adjustment with the cleared sum the request read;
  a test with a pinned timestamp fails on the old code ("expected 2 to be 1"). The Reviewer traced
  every order and approved.
- **Ten polish items applied.** The Designer corrected my decision B (No and Yes sit side by side;
  the label and the amount share one card).
- **What I accepted rather than send it round again:** the Tester's acceptance took 47 seconds,
  looked at two screenshots and took none of four states (evidence on EXF-684, the second Build in
  a row); the fix for the Reviewer's nit (the popover reopening after Escape during Yes) has no
  test; Reconcile stays disabled on a closed account by my decision, unlike the source. The last
  two are filed through this review as Low gap tickets.

**What I learned:**
- **The Designer and the source: a named action with its reason held.** It opened the source's
  Reconcile on a closed account in both of its passes, measured two steps, and stopped before
  typing or pressing Next, quoting the rule from the design document, where the Architect had
  copied my brief's sentence. The source stayed signed in. Ten of ten Designers have gone into the
  source; this is the first that kept a limit I set. Evidence on EXF-573 (with a correction of my
  own comment: two passes, not three).
- **Rules the Architect copies into the design reach the later steps; rules that stay in my brief
  do not always.** For anything a late step must keep, I ask the Architect to write it into the
  design.
- **The Tester step does not look, whatever the brief says** (two Builds in a row). Until the
  template changes, every merge with a screen gets a flow test on live with the look-at-everything
  rule; that rule found EXF-720.

**Ticket writes:** 7 (EXF-533 and EXF-664 to Done with comments; evidence on EXF-573 twice and on
EXF-684). Two tickets filed through this review. **Backlog:** 49 open feature tickets (50 done;
none in progress). Gap: fourteen open plus the two filed here; none in progress. Template: forty
open (Urgent EXF-573, 611, 612). Flow verdicts unchanged (3 `parity`; 4 `new_gaps` with EXF-720; 6
not run). **Finished since each template's last review: Build 10, Deploy 8, Discover 2, Test user
flow 3: the Build review is due.**

**Next plan:** one Deploy (`ZZ-TEST D30`) for the Reconcile merge; the Activity popover Build
(EXF-509 with EXF-720 and EXF-714) beside it; the Build template review and the template-ticket
sweep; flow 6 after the Deploy. The rate-limit window resets at 09:00Z.

### 2026-11-17 · Plan round 115

Children used 130 of 200. Started one: the Build template review. Main `d005439`, live `0fefc6c`
(one merge and one migration behind). The two tickets filed at the last review exist as **EXF-721**
(Reconcile on a closed account) and **EXF-722** (the missing Escape test); both set to Low; nothing
blocks them. The person has not answered the round-110 check-in.

**Started: Improve templates, a review of Build feature** (`p_72015a8168514f0fbd6e78217ab08c9d`)
on the ten Builds finished since its last review: `p_8baa…`, `p_b719…`, `p_c4fd…`, `p_a270…`,
`p_2717…`, `p_51a1…`, `p_5480…`, `p_d551…`, `p_2798…`, `p_8d9e…` (ten Builds for three pieces of
work: three merges, seven losses, none caused by the work). What I asked it, in order:
1. the rate-limit pauses that replace boxes; how `p_5480…` still landed; whether a carry-over can
   resume from a step;
2. the source check failing on a stale sign-in tab in Builds that use no source, and why a card's
   note did not reach the step;
3. the Designer in the source: three bans ignored, one named action kept, and whether the
   Architect's copy into the design carried it;
4. the Tester that does not look (76 and 47 seconds; EXF-720), and a floor code can check;
5. the three breaks I found by merging and running before a Build started: should a code step do
   that, and should the conventions forbid inserts by column position;
6. what worked (three real faults found in review, each with a test that fails on the old code);
7. what a card answer can and cannot do; 8. cost.
With the standing line: "Post evidence for an existing ticket with comment_ticket or in your
report; never file stand-in tickets." It may not open the source, the live clone, or a source
screenshot.

**Not started yet, on purpose: the Deploy for the Reconcile merge and the Activity popover Build.**
The rate-limit window resets at 09:00Z and it is 08:40Z. A pause in the middle of a release is the
one loss I cannot carry over. The review is read-only, loses nothing if paused, and should end
about when the window resets; its end brings my next plan, where I start both with a full
allowance. Cost of waiting: about 25 minutes.

**The template-ticket sweep** (due about now) follows this review, so that it sees the tickets the
review files.

Declared for the tree: the review; Deploy D30; the Activity popover Build (EXF-509 with EXF-720
and EXF-714); flow 6; the sweep; plan formats (EXF-468).

Reviews: Build 0 after this one, Deploy 8, Discover 2, Test user flow 3 since each template's last
review.

Ticket writes: 2 (priorities of EXF-721 and EXF-722).

### 2026-11-17 · Review round 115

Children used 130 of 200. One ended: **the Build template review completed**
(`p_72015a8168514f0fbd6e78217ab08c9d`, 15 minutes). Nothing is running. Main `d005439`, live
`0fefc6c` (read by me at 08:54Z); migration `20261116101400_account_reconciled_at.sql` pending.

**What I approved, all of it posted (I read its closing report):** ten evidence comments, no new
ticket, nothing closed: EXF-612, EXF-566, EXF-575, EXF-479, EXF-682, EXF-629, EXF-573, EXF-684,
EXF-611, EXF-628. Three additions of mine went in: the comments say where they correct me; the
count of statements that write rows by position is three (the review could not re-read the Thread
for the sentence I quoted, and rested it on commit `2a4614a`, which adds the new column to two
account inserts; I checked that the commit exists and touches `repositories/accounts.ts`).
Nothing approved was left unfiled.

**Where I was wrong, by the review's reading of the step records (accepted):**
- **`p_51a1…` did lose its box files**, after a 22-minute card wait (`dev_server.sh` missing at
  00:44Z). My note on that card, "this box still has its platform files", was already false. **So
  boxes are lost after any idle of about 20 minutes or more, seven of seven: two rate-limit
  pauses and two card waits; only a 2-minute wait kept its files.**
- `p_51a1…` failed the source check twice, not four times; its other two failures were that
  missing script, and my Retry with the reload command never reached a Tester.
- `p_d551…`'s dev-server step did print its error; the card does not show a step's output
  (EXF-611). I read "no detail" as the fault itself.
- The sign-out came 31 seconds after Next, not 36; the abandon of `p_a270…` was at 00:51Z; my
  00:18Z escalation belongs to `p_51a1…`'s record.
- **`p_2798…`'s review finding was a nit fixed without a test**, not one of the "reproduced, fixed
  with a failing test" cases I listed for the review (my own journal had it right; EXF-714).
- `p_2798…`'s Tester also misreported: the 1440 image it called "stored from an earlier Thread"
  was taken by this Thread's Designer, and it named a file it never opened.
- My EXF-479 comment pointed to the wrong ticket for skipping the check.

**What I take from it for my own work:**
- **A card that waits 20 minutes costs the box.** I answer every card in the side turn it arrives
  in, and I never escalate a card of a Build whose work can be carried over: I abandon and carry
  over instead, and ask the person separately.
- **Designers read the design document, not my brief.** A rule a late step must keep goes into the
  design through the Architect, as a named action with its reason; I ask the Architect to copy the
  reason too (it did not).
- **A step's fixed rule beats a card note** ("if the source check fails, answer blocked"), and my
  own brief line "never navigate a tab" forbade what my card asked. I stop writing card notes that
  ask a step to act against its brief.
- **Carry-overs repeat finished steps whatever the brief says** (about 3 hours and 14 dollars over
  seven Threads; in `p_2798…` 47 of 77 minutes). Nothing I can change from a brief; EXF-575.
- **Cost of this stretch:** the seven lost Builds 61.77 dollars and 22.2 hours of wall time, about
  half of it idle; the three merged ones 12.09 dollars; 73.86 dollars for three pieces of work.

**Ticket writes:** 0 by me (ten comments by the review). **Backlog:** 49 open feature tickets (50
done). Gap: sixteen open (with EXF-721 and EXF-722), none in progress. Template: forty open, no
new one (Urgent EXF-573, 611, 612). Flow verdicts unchanged. Finished since each template's last
review: Build 0, Deploy 8, Discover 2, Test user flow 3.

**Next plan (the rate-limit window resets at 09:00Z):** Deploy D30 for the Reconcile merge; the
Activity popover Build (EXF-509 with EXF-720 and EXF-714); the template-ticket sweep; flow 6 after
the Deploy.

### 2026-11-17 · Plan round 116

Children used 133 of 200. Started three: a Deploy, a Build and the template-ticket sweep. Main
`d005439`, live `0fefc6c`. No tickets were filed at the last review. The person has not answered
the round-110 check-in. The children started between 08:55Z and 08:58Z, a few minutes before the
rate-limit window's reset at 09:00Z (my inference from the last pause ending at 04:00Z; the
platform does not tell me).

**Started:**
- **Deploy D30** (`p_d84176d3eb4c4ba6b3a14a3615996ee4`): ships main `d005439`, expects the one
  migration `20261116101400_account_reconciled_at.sql`; `gated_commit` `8b415ab` (its tree equals
  main's, compared now). Its checks walk Reconcile on live, because the Build's acceptance looked at
  two screens: the worked example of the design through REST (cleared 755,500; a difference of
  −100,000 refused without an adjustment); the Yes path; the No path with the Difference step and
  the bar; clearing live; Finish (seven locked rows); editing a reconciled row with its
  confirmation; the adjustment (Ready to Assign 795,000 back to 790,000); refusals through REST;
  the tool; a closed account; five states at 1024×700; 82 tools. **And one import of its own
  export: the proof on live that the import survives the new account column** (the break I found
  before the merge). Every named state gets a fresh screenshot and a sentence.
- **The Activity popover Build** (`p_4b3e4d16b0784c8a9090ea68151e465d`, EXF-509 with EXF-720 and
  EXF-714; all three now In Progress). A fresh Build, not a carry-over. What its brief does
  differently, from the template review of an hour ago:
  - **The Architect copies three things into the design word for word**, because later steps read
    the design and not my brief: the source rules, the "Looking" list for the Tester, the D1 count.
  - **The source rules are a list of what may be looked at and four things nobody does, each with
    its reason** (no blanket ban): the Designer may open the Activity popover on the test plan's
    Plan page if a row there has activity; otherwise "not compared" is a complete answer.
  - **"Looking":** the Tester's fresh screenshot per state and size with a sentence, as a list in
    the acceptance section; a case without its entries is PARTIAL "not looked at".
  - The read's rows must sum to the month read's Activity to the milliunit, proven on a plan with
    a refund, a split, a categorized transfer to a tracking account, a deleted row, an unentered
    scheduled row and a neighbouring month's row; calls counted at 10 and 100 rows.
  - Payment categories keep their Activity cell as it is unless the same read fits them.
  - EXF-720 with a search for other unstyled buttons on the Plan page; EXF-714's three tests, each
    shown failing on the old condition. "A test for a review finding, whatever the finding is
    called" (the nit that slipped through last time).
  - Every insert names its columns.
- **The template-ticket sweep** (`p_5a6cdef2d3a14bd7b845dd642965e78e`), the second (the first was
  round 82): duplicates; one ordered list with the five changes that would have saved the most;
  priorities against the newest figures; texts out of date (several of them my own comments);
  anything that is not a template matter. With the standing line on evidence and stand-in tickets.

**Three at once, and why now:** the allowance should be fresh within minutes of their start; the
Deploy's release comes after its gate, well past 09:00Z; the Deploy and the sweep
are short and share nothing with the Build; the Build will reach its card long after the Deploy has
released. **Cards are answered in the side turn they arrive in: an idle of 20 minutes costs the
box.** No approval of the Build while the Deploy releases.

**Not started:** flow 6 waits for the Deploy. Plan formats (EXF-468) follows the Build (both touch
how the Plan page writes amounts).

Reviews: Build 0, Deploy 8, Discover 2, Test user flow 3 since each template's last review; the
sweep is running.

Declared for the tree: the three running; flow 6; plan formats; a Deploy and a flow test for the
Activity popover.

Ticket writes: 6 (EXF-509, EXF-720, EXF-714 to In Progress, each with a comment).

### 2026-11-17 · Review round 116

Children used 133 of 200. One ended: **Deploy D30 completed**
(`p_d84176d3eb4c4ba6b3a14a3615996ee4`, 13 minutes). **Live is `d005439`** at
https://budget.doxen.dev (read by me at 09:10Z), equal to main; no migration is pending. Running:
the Activity popover Build and the template-ticket sweep (its card answered at 09:09Z; it is
posting).

**Deploy D30: released; every check ran; one result differs from my brief, and the verifier found
two things I had not asked about.**
- Gate passed (tree equal to gated `8b415ab`; checks 212 s). Release: the D1 bookmark phase ran;
  `20261116101400_account_reconciled_at.sql` applied; smoke ok. Health gives the whole sha; 401
  without credentials; **82 MCP tools**. The box kept its files.
- **Reconcile on live, as the design's worked example says:** the refused difference (409,
  −100,000, nothing written); the Yes path; `shift+E`; the bank-balance step; the Difference step
  with U+2212; the bar; Finish with seven locked rows; the confirmation on a reconciled row's
  amount and none for a memo; the adjustment row and Ready to Assign back to 790,000; refusals; the
  tool; the closed account; five states inside the window at 1024×700. No console error, no
  failing request of the page's own.
- **The import survives the new column on live** (201, done): the break I found before the merge
  did not ship.
- **DIFFERS (step 6):** after a click on a row's cleared icon in reconcile mode, the header's
  balances and the bar still showed the old figures 700 ms later; they had caught up by the next
  click. The design says "live both ways". Filed through this review (Low): it needs measuring.
- **Found by the verifier beyond the brief:** in the plan imported from its own export, the
  adjustment row's payee reads "Manual Balance Adjustment". **I read the cause in the code:**
  `apps/worker/src/services/plan-export.ts` writes every system payee other than the starting
  balance under that one name, and the import knows two system payees; Reconcile added a third
  (`reconciliation_adjustment`). The round-trip test has no reconciled adjustment, so nothing
  caught it. **The owner's real export will hold such rows.** Filed through this review (Medium).
  Also read there, and by the file format: `last_reconciled_at` and a closed account's state do
  not come back through an export and import (the format has no place for them).
- A finished import's session row stays (its DELETE answers 409 `import_finished` and it has no
  read); the plan it made is gone with the purge. Noted on the ticket below.
- After Finish, the transfer's other side stays uncleared on the other account.
- Plans not starting with `ZZ-TEST`: 1; the purge left 0 of the run's two plans.
- The verifier opened most of its 23 screenshots and named the seven it did not.

**Flow 6 (reconcile, search, import):** I do not start it now. Its reconcile part was walked on
live by this Deploy with a screenshot of every state; its other parts (the register's search
tokens, EXF-528; file import, EXF-531) are not built. A child for the same walk an hour later
would add little. Recorded as: reconcile walked by D30, as the tickets say, with the two findings
above; verdict word not given (no flow test ran).

**The template-ticket sweep, what I approved at its card (posting now; I check it at the next
review):** fourteen comments; EXF-554 closed into EXF-479; EXF-612's title replaced; EXF-575 and
EXF-585 to High. I accepted three corrections of my reading: idle is one trigger of the lost
boxes, not the only one (four Deploys on 16 Nov lost theirs within minutes with no idle); a named
action in the source has held once and failed three times; my "nine blanket bans" mixed two
counts (seven bans ignored, two obeyed). Its five changes that would have saved the most: EXF-612
(about 115 dollars and 30 hours of lost Builds, five Deploys refused), EXF-575, EXF-563, EXF-576,
EXF-564. Of its seven items of app work, three are in EXF-631 and EXF-674; one I file here
(inserts by column position); one went onto EXF-631 as a comment; two I do not file (each needs a
Build of its own).

**Activity popover Build** (`p_4b3e4d16b0784c8a9090ea68151e465d`): no commit pushed yet at 09:10Z
(13 minutes in).

**Ticket writes:** 2 (the live note on EXF-533; the profile's purge line on EXF-631). Three
tickets filed through this review. **Backlog:** 49 open feature tickets (50 done; 1 in progress).
Gap: sixteen open, two in progress, plus the three filed here. Template: thirty-nine open after
the sweep's closure (Urgent EXF-573, 611, 612). Flow verdicts unchanged. Finished since each
template's last review: Build 0, Deploy 9, Discover 2, Test user flow 3.

**Next plan:** nothing beside the Build (one Build at a time on the Plan page; plan formats
touches the same amounts). Set the three new tickets' priorities.

### 2026-11-17 · Plan round 117

Children used 134 of 200. Started one Build; one is running from round 116. Main and live
`d005439`. The three tickets filed at the last review exist: **EXF-723** (export and import and
the reconciliation payee; set to Medium), **EXF-724** (the reconcile lag; Low), **EXF-725**
(inserts by column position; Low); nothing blocks them. The person has not answered the round-110
check-in.

**The template-ticket sweep ended** (`p_5a6cdef2d3a14bd7b845dd642965e78e`, 09:11Z; its review is
the next one). Its comments are posted and EXF-554 is Canceled. Its step could not change
priorities or a title, so I did what I had approved: **EXF-575 and EXF-585 to High; EXF-612's
title is now "Clone · platform (all templates): a replaced box comes back with the repository but
without `/workspace/.exfab` and the home cache"** (the same fault, described as the evidence now
shows it; body untouched).

**Started: export and import hardening** (`p_164aad44232a4f72be7ecbbe87815e6b`, EXF-723 with
EXF-725; both In Progress). Worker and schema only, no screen, no source.
- Why now and why first among the gap tickets: the import is how the owner brings their real plan
  over, a real plan that was ever reconciled with a difference holds "Reconciliation Balance
  Adjustment" rows, and the import breaks again with the next column any of its seven tables
  gains.
- The brief asks for: an exhaustive mapping of system payees in the export; the import mapping the
  reconciliation payee to the one a later Reconcile uses (no second payee of that kind); the round
  trip with a reconciled adjustment; named columns built from the Drizzle tables; a test that adds
  a throwaway column to `accounts` and still creates an account and imports a plan, shown failing
  on the present code; a search for other statements of the kind; the conventions rule; what the
  file format cannot carry, written into the import's design; a decision on finished import rows.
  The export's 16 calls and the import's 3 per invocation must not change.
- **Beside the Activity popover Build** (`p_4b3e4d16b0784c8a9090ea68151e465d`): their files are
  disjoint (that Build's read lives in new `category-activity` files and it touches no export,
  import or accounts repository file; this one touches nothing under `apps/web` or `e2e`). They
  meet only in the keep-both files (`mcp-timestamps.test.ts` if this one adds a tool, which is not
  expected, and `docs/README.md`). No shared module in either.

**The Activity popover Build, 20 minutes in:** its Architect wrote the design with my three
sections copied in; the read makes 3 D1 calls with a bound of 500 rows; payment categories are
refused by the read and keep a plain Activity cell (a known issue: no list of rows adds up to
their Activity); three other class-less buttons on the Plan page are styled by their containers,
so `Got it!` was the only one drawn as the browser's default. **The source test plan has no
activity in any month it allows, so the popover is "not compared: built from the ticket"; the
study hovered one amount, used the month arrows and two size overrides, and reported each
action.** The Implementer is writing the Worker side.

**Also this turn:** a correction on EXF-724 ("the icon turned green at once" was my wording, not
the verifier's).

**Not started:** plan formats (EXF-468) follows the Activity popover (both touch how the Plan page
writes amounts). The account page's leftovers (EXF-724, EXF-722, the rest of EXF-674) wait for it
too: one Build per area. No Deploy: main and live are equal.

Reviews: Build 0, Deploy 9, Discover 2, Test user flow 3 since each template's last review; the
sweep ran this round (next about round 146).

Declared for the tree: the two Builds; one Deploy for both merges with a flow test; plan formats;
the account page's leftovers.

Ticket writes: 11 (three priorities; EXF-575, EXF-585, EXF-612's title; the correction on EXF-724;
EXF-723 and EXF-725 to In Progress with comments).

### 2026-11-17 · Review round 117

Children used 134 of 200. One ended since the last review: **the template-ticket sweep completed**
(`p_5a6cdef2d3a14bd7b845dd642965e78e`, 14 minutes). Two Builds are running. Main and live `d005439`
(read by me at 09:17Z).

**The sweep: what I approved, and that it was done.** Fourteen comments, one closure, no new
ticket. The tracker shows the fourteen tickets it named updated between 09:10:13Z and 09:10:49Z
(EXF-612, 611, 582, 559, 457, 575, 564, 573, 479, 684, 566, 618, 456, 554) and EXF-554 Canceled.
Its step could not set priorities or a title; I set them in the plan of this round (EXF-575 and
EXF-585 to High; EXF-612's title). Nothing approved is left undone, so I file nothing.
- **Its ordered list, for whoever maintains the platform and the templates** (in its report): six
  groups; the five changes that would have saved the most are EXF-612, EXF-575, EXF-563, EXF-576,
  EXF-564; EXF-684 is cheap and belongs early.
- **Its corrections of my reading, accepted** (recorded at the review of round 116).

**Running:**
- **Activity popover** (`p_4b3e4d16b0784c8a9090ea68151e465d`): design and spec committed
  (`b67dec9`); the Implementer is on the Worker side.
- **Export and import hardening** (`p_164aad44232a4f72be7ecbbe87815e6b`): started at 09:15Z; no
  commit yet.
- Their manifests: the first has arrived (the Plan page, new `category-activity` Worker files, its
  tests, `mcp-timestamps.test.ts`, the months coverage file, `docs/README.md`; no shared module);
  the second's is still my estimate (the export, the import, the accounts repository, their tests
  and documents; nothing under `apps/web` or `e2e`). Disjoint but for the keep-both files. I check
  the second against the first when it arrives.

**Ticket writes:** 0 in this review. **Backlog:** 49 open feature tickets (50 done; 1 in
progress). Gap: nineteen open, four of them in progress (EXF-720, EXF-714, EXF-723, EXF-725). Template: thirty-nine open (Urgent EXF-573, 611, 612).
Finished since each template's last review: Build 0, Deploy 9, Discover 2, Test user flow 3.

**Next plan:** nothing to start beside the two Builds.

### 2026-11-17 · Plan round 118

Children used 134 of 200. Nothing started; two Builds are running (the Activity popover,
`p_4b3e4d16b0784c8a9090ea68151e465d`, and the export and import hardening,
`p_164aad44232a4f72be7ecbbe87815e6b`). Main and live `d005439`. No tickets were filed at the last
review. The person has not answered the round-110 check-in.

- **What could start by the scheduling rule, and why it does not yet:** the register's view
  options (EXF-529, Medium; with the reconcile lag EXF-724 and the Escape test EXF-722 as riders on
  the same page) share no file with either running Build. But three Builds at once is the load
  under which the rate limit came after 2 hours 46 minutes, and a pause costs every Build that is
  before its gate. Two at once is what the allowance has carried. I start it when the first of the
  two ends.
- **Plan formats (EXF-468, High)** follows the Activity popover Build (the same Plan-page files).
- No Deploy and no flow test: main and live are equal. No review is due (Build 0, Deploy 9,
  Discover 2, Test user flow 3; the sweep ran in round 116).
- **Cards:** answered in the side turn they arrive in. A clean card on main: approve, after reading
  what changed since the last review inside the Build; the other Build then rebases (they meet only
  in keep-both files). No approval while a Deploy releases.

Declared for the tree, unchanged from round 117, with the register's view options added after the
first Build ends.

Ticket writes: 0.

### 2026-11-17 · Review round 118

Children used 134 of 200. One ended: **the export and import hardening Build completed and
merged** (`p_164aad44232a4f72be7ecbbe87815e6b`, pull request 62, main now `3ab0051`), in one Build
of 69 minutes. The Activity popover Build is running. Live is `d005439` (read by me at 10:26Z),
one merge behind; no migration is pending.

**EXF-723 (Done) and most of EXF-725 (back in Backlog for what is left): merged.** I approved its
card at 10:25Z in a side turn, three minutes after it arrived.
- **Gate** on main `d005439` at head `7438335`, the PR head: check passed; the whole browser suite
  456 of 456 three times; no flake; no migration. Main's tree equals the gated head (compared now).
- **EXF-723:** one table of system payee names shared by the export and the import, exhaustive over
  the payee types; the import maps the reconciliation payee to the one Reconcile reuses; the round
  trip with a reconciled adjustment is identical; the export test failed on the old code. Calls
  unchanged (16 and 3).
- **EXF-725 was three times the size I had estimated:** the search found 22 inserts that write by
  position, not three. Eighteen are converted through one helper that takes the column names from
  the Drizzle tables; a guard test refuses new ones. The Architect also corrected my proof: a
  column added only to the database does not break the old code (Drizzle names its own columns);
  the fault is a column added to the table definition, so the test adds it to both. The Reviewer
  compared every converted insert with its table and reran the test against the old file.
- **Left open on EXF-725:** four inserts in files the Build was told not to touch (the change log,
  the reconcile repository, two in month-categories), listed on the ticket and exempted by name in
  the guard test.
- **Not built, a known issue:** the removal of finished import rows. It was built and taken out
  because an existing test expects such a row to remain a day later.
- The Tester had no screen to look at and said what it did not rerun (the old-code failures, which
  the Reviewer had rerun).

**What I learned:** asking a Build to "search for every other statement of this kind" turned a
three-line ticket into the right-sized one; without it the next new column would have broken one
of fifteen other inserts. A ticket about a class of fault should always ask for the search.

**The Activity popover Build** (`p_4b3e4d16b0784c8a9090ea68151e465d`), 88 minutes in: the three
EXF-714 tests and the popover with a first polish item are committed (`fa2029d`). It shares only
`docs/README.md` with what just merged; I merged the two branches together in a throwaway checkout
before approving: clean. Its card will need Refresh or Regate, since the base has moved.

**Ticket writes:** 4 (EXF-723 Done and comment; EXF-725 to Backlog and comment). No new ticket.
**Backlog:** 49 open feature tickets (50 done; 1 in progress). Gap: eighteen open, two of them in
progress (EXF-720, EXF-714). Template: thirty-nine open (Urgent EXF-573, 611, 612). Flow verdicts
unchanged. Finished since each template's last review: Build 1, Deploy 9, Discover 2, Test user
flow 3.

**Next plan:** the register's view options (EXF-529) with the two account-page riders, now that
one Build has ended; the Deploy waits for the Activity popover so that one Deploy ships both.

### 2026-11-17 · Plan round 119

Children used 135 of 200. Started one Build; one is running from round 116. Main `3ab0051`, live
`d005439` (one merge behind, nothing pending). No tickets were filed at the last review. The
person has not answered the round-110 check-in.

**Started: the register's View options** (`p_5b0c6eac7fb9459881ccfe507ef9a190`, EXF-529 with
EXF-724 and EXF-722; all three In Progress).
- Why this one: it is the next feature the person's list names for the register ("historical
  tracking of all past transactions": a date range, a running balance, reconciled rows out of the
  way), it builds on Reconcile, which merged this morning, and its two riders are on the same page.
- **What the brief settles so that no design round is spent on it:** Show Reconciled is off by
  default as in the source, so reconciled rows are hidden after this Build, and the Reconcile
  specs and cases that expect locked rows after Finish turn the option on first; a row's running
  balance counts every earlier row, also hidden ones, and is computed in SQL with the same calls
  for 10 and for 1,000 rows; Show Images is stored but changes nothing yet (no image column,
  EXF-536); where the settings live is the Architect's choice (the migration's name is fixed if
  one is needed: `20261116101500_account_view_settings.sql`).
- **The source rules, as a list of what may be done and what never, each with its reason, for the
  Architect to copy into the design:** on one account of the test plan and on All Accounts the View
  popover may be opened and its settings changed and applied to see their effect, and are then set
  back (the before and after go into the report); never Reconcile; never a change to a
  transaction or an account; never the plan menu, Bank Connections, another plan. This is the
  first brief that lets a Designer apply something in the source: view settings are the test
  plan's own display state, and the person gave that plan for any purpose.
- EXF-724: measure, then fix, with a spec that fails on the present code or a report that the lag
  does not exist locally. EXF-722: two tests, each shown failing with the guard removed.
- The "Looking" list for the Tester, as in the Activity popover's brief.

**Beside the Activity popover Build** (`p_4b3e4d16b0784c8a9090ea68151e465d`, 93 minutes in): the
Plan page and new `category-activity` Worker files on one side; the register, the account page
and new `view-settings` files on the other. They meet only in the keep-both files. No shared
module in either. If the new Build's manifest says otherwise when it arrives, I sequence it.

**The rate limit:** the window opened at 09:00Z by my inference; two Builds, a Deploy and the sweep
have run in it so far, which is less than the load before either earlier pause at the same point.
If a pause comes all the same, the code is on the branches.

**Not started:** the Deploy waits for the Activity popover's merge (one Deploy for both merges).
Plan formats (EXF-468) follows both Builds: it changes how the Plan page and the register write
amounts and dates.

Reviews: Build 1, Deploy 9, Discover 2, Test user flow 3 since each template's last review.

Declared for the tree: the two Builds; one Deploy for the two merges; a flow test of the Activity
popover; plan formats.

Ticket writes: 6 (EXF-529, EXF-724, EXF-722 to In Progress, each with a comment).

### 2026-11-17 · Review round 119

Children used 135 of 200. One ended: **the Activity popover Build completed and merged**
(`p_4b3e4d16b0784c8a9090ea68151e465d`, pull request 61, main now `13cfcae`), in one Build of 128
minutes. The register's View options Build is running. Live is `d005439` (read by me at 11:06Z),
two merges behind; no migration is pending.

**EXF-509, EXF-720 and EXF-714: merged; all three Done.** I approved its card at 11:05Z in a side
turn, two minutes after it arrived, on the digest, the diff and the gate; I read the steps' reports
now.
- **Gate** on main `3ab0051` at head `8b5fcc9`, the PR head: check passed; the whole browser suite
  478 of 478 three times; changed specs ten times, 430 of 430; no flake; no migration. Main's tree
  equals the gated head (compared now). 83 MCP tools on main (`list_category_transactions`).
- **The read** lists what the engine counts as a category's Activity and sums to the month read's
  figure to the milliunit; 3 D1 calls at 10 and 100 rows; a bound of 500 rows with the full count
  and sum in the answer. Payment categories keep a plain Activity cell (a known issue).
- **The review loop worked as it should:** the Reviewer's one nit (a column width) was fixed with a
  test shown failing first; the gate's first run failed an older Auto-Assign test, and the fixer
  read the code and found a race in the test (a click before the option was enabled), not load.
- **The Tester looked** (five minutes; a fresh screenshot of every listed state at both sizes; 15
  of 15). What was different: the "Looking" list was in the design, copied there by the Architect.
  Evidence on EXF-684, with two corrections of my own wording there ("the first Tester that
  looked" was wrong, and so was "three before it": two Testers before it did not look, 76 and 47
  seconds). I check a count against the Threads before I write it into a ticket.
- **The source rules held in all three steps that touched the source**, each of which listed its
  actions (month arrows, a hover, style readings, size and colour-scheme overrides set back). The
  source has no category with activity, so the popover is "not compared: built from the ticket".
  Evidence on EXF-573, with the limits of that evidence.
- **What looking found, filed through this review:** at 1024×700 an Activity amount of eight
  characters (−$106.50) is cut with an ellipsis inside its new button, and a group row's amount
  wraps. In my approval I wrote that the text "ran past its box before this Build": that is my
  inference from the flow test's measurement of the Assigned cell at the same width (66 px), not
  something anyone measured for Activity.

**What I learned:** what a late step must do goes into the design through the Architect, word for
word. It has now carried the source rules twice and the Tester's looking once.

**The register's View options Build** (`p_5b0c6eac7fb9459881ccfe507ef9a190`), 37 minutes in:
design and spec committed. Its manifest is not in yet at the time of writing; it shares only
keep-both files with what merged today by my estimate, and I check it when it arrives.

**Ticket writes:** 10 (EXF-509, EXF-720, EXF-714 to Done with comments; evidence on EXF-684 with
two corrections, and on EXF-573). One ticket filed through this review. **Backlog:** 48 open feature tickets (51 done;
1 in progress: EXF-529). Gap: sixteen open, two of them in progress (EXF-724, EXF-722), plus the
one filed here. Template: thirty-nine open (Urgent EXF-573, 611, 612). Flow verdicts unchanged.
Finished since each template's last review: Build 2, Deploy 9, Discover 2, Test user flow 3.

**Next plan:** one Deploy (`ZZ-TEST D31`) for the two merges (`3ab0051`, `13cfcae`); it can run
beside the Build (no approval while it releases). The review of round 120 is a check-in.

### 2026-11-17 · Plan round 120

Children used 136 of 200. Started one Deploy; one Build is running from round 119. Main `13cfcae`,
live `d005439` (two merges behind, nothing pending). The ticket filed at the last review exists as
**EXF-726** (the Plan grid's number columns at 1024 px); set to Medium; it goes with plan formats
(EXF-468). The person has not answered the round-110 check-in.

**Started: Deploy D31** (`p_d9a9dfb24f404474ba3bb5d43e591f83`): ships main `13cfcae`; no
migration; `gated_commit` `8b5fcc9` (its tree equals main's, compared now). Its checks:
- **Every kind of row the rewritten inserts write, once through REST on live:** a plan, a group,
  categories, three account types (a card with its payment category), an assignment, a plain row,
  a refund, a split, a categorized transfer to a tracking account, a row of last month, a card
  purchase, a target, a snooze, a card payment. Eighteen write statements were rewritten in
  `3ab0051`; the tests cover them, and this is the look on live.
- **The Activity popover** at 1440×900 and 1024×700: the button, its tooltip, the four rows, the
  three ways to close it, last month, and whether an eight-character amount is cut at 1024 px
  (EXF-726). The read and the tool: ZZ Food −110,000 from four rows, ZZ Fun −50,000 from two; a
  payment category refused.
- **`Got it!`** readable.
- **Export and import with a reconciled adjustment:** the payee reads "Reconciliation Balance
  Adjustment" in the export and in the imported plan, with the reconciliation system payee; the
  two exports identical.
- 83 tools; the count of plans; the prefixed purge; every import call with its `ZZ-TEST D31` name.
- **An error of mine in the brief, found after sending it:** step 4 says ZZ Checking is 860,000
  after the card payment. By the brief's own rows it is 835,000 (1,000,000 − 60,000 + 10,000 −
  50,000 − 40,000 − 5,000 − 20,000). The brief's rule makes the verifier report the difference
  and not bend the check; I count that report as mine, not the app's. Also not certain: step 7
  assumes rows made through REST are uncleared unless said (so that the cleared balance is the
  starting 1,000,000); if they are cleared by default the adjustment will be another amount, and
  the verifier will say so.

**Running beside it:** the register's View options Build (`p_5b0c6eac7fb9459881ccfe507ef9a190`).
A Deploy and a Build share no file; **no approval of the Build while the Deploy releases** (the
Deploy should be done in about a quarter of an hour; the Build is 40 minutes in).

**Not started:** plan formats (EXF-468) with EXF-726 follows the register Build (one Build per
page, and both change how amounts are written). No flow test yet: the Deploy's own walk covers the
new screens at both sizes.

Reviews: Build 2, Deploy 9 (D31 will be the tenth: the Deploy template review is due when it
ends), Discover 2, Test user flow 3 since each template's last review.

Declared for the tree: the Build; this Deploy; plan formats with EXF-726; a Deploy and a register
flow test after the View options merge; the Deploy template review.

Ticket writes: 1 (EXF-726's priority).

### 2026-11-17 · Review round 120 (check-in)

Children used 136 of 200. One ended: **Deploy D31 completed**
(`p_d9a9dfb24f404474ba3bb5d43e591f83`, 10 minutes). **Live is `13cfcae`** at
https://budget.doxen.dev (read by me at 11:20Z), equal to main; no migration is pending. The
register's View options Build is running.

**Deploy D31: released; every check ran; two results differ from my brief, one of them my own
arithmetic.**
- Gate passed (tree equal to gated `8b5fcc9`; checks 232 s). Release passed, smoke ok. Health
  gives the whole sha; **83 MCP tools**.
- **Every kind of row the rewritten inserts write answered 2xx on live** (group, categories, three
  account types with the card's payment category, assignment, plain row, refund, split, transfer
  to a tracking account, last month's row, card purchase, target, snooze, card payment, reconcile).
- **The Activity popover on live at both sizes:** the four rows, the three ways to close, last
  month; the read and the tool give ZZ Food −110,000 from four rows and ZZ Fun −50,000 from two; a
  payment category is refused with 422. `Got it!` is white on the app's blue. No console error.
- **Export and import of a reconciled adjustment:** the payee reads "Reconciliation Balance
  Adjustment" in the export and in the imported plan, with `system` = `reconciliation_adjustment`;
  the two exports are byte-identical. EXF-723 is fixed on live.
- **DIFFERS 1, mine:** ZZ Checking after the card payment is 835,000, not the 860,000 of my brief
  (I had left out two rows; recorded at the plan before the Deploy reported it).
- **DIFFERS 2:** at 1024×700 the Activity amount "−$110.00" is shown whole (65 px in 65 px), so
  EXF-726 does not show at that amount; it does at "−$106.50" (the Build's Tester). Eight
  characters fit to the pixel or not by their digits. Noted on EXF-726.
- Plans not starting with `ZZ-TEST`: 1; purge `remaining 0`. The verifier named the three
  screenshots it did not open.

**Since the check-in of round 110, counted from the children list:** ten children started (127 to
136): four Builds, three Deploys, one flow test, one template review, one sweep. **None was lost.**
Three Builds merged (Reconcile, the export and import hardening, the Activity popover), the fourth
is running; with the Plan-page Build that was running at the last check-in, four merges. All of it
is live. What changed in how I work: one or two Builds at a time; every card answered within
minutes of arriving; every carry-over merged and run by me first; what a late step must keep
written into the design by the Architect.

**Check-in sent** (round 120). Its points: what is live now; no loss in ten rounds and why; what I
still need (the source test plan's contents first, since three features were built without
anything to compare; then the plan menu and bank screens, where I say what I do if no answer
comes: build them from the tickets with nobody opening those screens in the source); the two
behaviours to expect (reconciled rows hidden by default after the next merge; the Designer may
apply view settings in the test plan); budget: 64 children for 48 open feature tickets, and the
order I work in.

**Ticket writes:** 1 (the measurement on EXF-726). No new ticket. **Backlog:** 48 open feature
tickets (51 done; 1 in progress). Gap: seventeen open, two of them in progress. Template:
thirty-nine open (Urgent EXF-573, 611, 612). Flow verdicts: 1 `parity_known_gaps`; 2 `new_gaps`; 3
`parity`; 4 `new_gaps` (its one gap, EXF-720, is fixed and live; not re-run); 5, 7
`parity_known_gaps`; 8, 9, 10, 11 `parity`; 6 not run (its reconcile part walked by D30).
**Finished since each template's last review: Build 2, Deploy 10 (the Deploy review is due),
Discover 2, Test user flow 3.**

**Next plan:** the Deploy template review; nothing else beside the register Build (plan formats
with EXF-726 follows it).

### 2026-11-17 · Plan round 121

Children used 137 of 200. Started one: the Deploy template review. One Build is running from round
119. Main and live `13cfcae`. No tickets were filed at the last review. The person has not
answered the check-ins of rounds 110 and 120.

**Started: Improve templates, a review of Deploy** (`p_cdb0214708904792a520429beb80d1a6`) on the
ten Deploys finished since its last review: `p_dcdf…` (abandoned), `p_5969…`, `p_4aff…`,
`p_2062…` (abandoned after five help cards), `p_a5a9…` (failed), `p_da28…`, `p_c5f4…`, `p_516e…`
(D29), `p_d841…` (D30), `p_d9a9…` (D31). What I asked, in order: the three that did not release;
why the three of today released cleanly; the verifier's first script failing on its own account
in almost every run (once doubling a row on live); screenshots taken but not opened; which
sentences of the 13,000-character brief a step acted on, and the import-name trap as a profile
recipe; the DIFFERS rule; findings beyond the brief; the `plaid credentials:` line reaching some
verifiers and not others; cost per step. With the standing line: "Post evidence for an existing
ticket with comment_ticket or in your report; never file stand-in tickets." It may open neither
the source nor the live clone.

**Running:** the register's View options Build (`p_5b0c6eac7fb9459881ccfe507ef9a190`), started
at 10:28Z, 71 minutes in at 11:39Z. The review is read-only and shares nothing with it.

**Not started, and why:** plan formats (EXF-468) with EXF-726 follows the register Build. No
Deploy: main and live are equal. No flow test: Deploy D31 walked the new screens on live at
about 11:18Z; flow 4's one gap (EXF-720) was read as fixed on live by that Deploy, and a
re-run for the verdict word alone is not worth a child now.

**What I said I would do if the person stays silent on the plan menu and bank screens** (check-in
of round 120): build the plans list page and the New Plan dialog (EXF-471, EXF-469) from the
tickets, with the plan menu on the source's never-list, after plan formats. I read both tickets
before I start that.

Reviews: Build 2, Deploy 0 after this one, Discover 2, Test user flow 3 since each template's last
review.

Declared for the tree: the Build; this review; a Deploy and a register flow test after the merge;
plan formats with EXF-726; the plans list and New Plan dialog.

Ticket writes: 0.

### 2026-11-17 · Review round 121

Children used 137 of 200. One ended: **the Deploy template review completed**
(`p_cdb0214708904792a520429beb80d1a6`, 14 minutes). The register's View options Build is running.
Main and live `13cfcae` (read by me at 11:52Z).

**What I approved, all of it posted:** eleven evidence comments, no new ticket, nothing closed. The
tracker shows the eleven tickets updated between 11:50:24Z and 11:50:54Z (EXF-612, 582, 611, 618,
580, 581, 617, 583, 584, 585, 619). Nothing approved was left unfiled, so I file nothing.

**What it found, by the step records:**
- **The three Deploys of 16 Nov that did not release lost hand-off files within seconds, with no
  idle wait, in two directions:** in two the gate had passed and printed its whole summary to the
  transcript, and the box was replaced 17 and 24 seconds later; in one the agent's file was gone
  before the gate read it. Nothing in the records explains why: four Deploys released that same
  day between the failures at the same loads, and today's three are no different. A replaced box
  can be told by the date of `/workspace` (a cheap check for code).
- **In `p_2062…` the template passed a typed-in record with `result: failed` on to the release
  step;** only my card text stopped `release.env` being written. One condition in the template
  would stop it (EXF-582).
- The verifier's own script failures: six of seven runs, seconds each (about 6.5 of 38 verifier
  minutes). The one doubled row came from a rerun that re-ran setup inside the same command; one
  verifier avoided it by itself with a setup guarded by a state file.
- **Screenshots: 73 kept, 27 opened**; three verifiers misreported how many they had opened.
- The DIFFERS rule was used correctly four times and no check was bent; five of seven verifiers
  reported things beyond their brief unasked (among them the payee fault, since fixed).
- The `plaid credentials:` line is in no summary; it reaches a verifier only if it greps the raw
  log.
- About 11 minutes and 0.91 dollars per released Deploy; the four recorder steps take more than
  twice the release's own time.

**Where I was wrong (accepted):** the gate of `p_2062…` printed `RESULT=passed`; the "timeout" I
quoted on EXF-612 was the recorder's placeholder. Its box was replaced 24 seconds after the gate
finished, not "three minutes after the first step". My count of screenshots a verifier left
unopened (seven) came from the verifier's own sentence; the records say ten.

**What I change in the next Deploy briefs:** the setup is one script that refuses to run when its
state file exists and prints each id as it is created; the report carries separate lines DIFFERS,
NOT CHECKED and OBSERVED; "which screenshots did you not open" is asked as a list, since the
sentence was wrong three times. The platform-files paragraph and the import-name rule stay.

**The register's View options Build** (`p_5b0c6eac7fb9459881ccfe507ef9a190`), 84 minutes in: the
View specs, the reconcile tests and a polish list of twelve items are committed (`3c2070e`).

**Ticket writes:** 0 by me. **Backlog:** unchanged: 48 open feature tickets (51 done; 1 in
progress). Gap: seventeen open, two in progress. Template: thirty-nine open (Urgent EXF-573, 611,
612). Finished since each template's last review: Build 2, Deploy 0, Discover 2, Test user flow 3.

**Next plan:** nothing beside the Build.

### 2026-11-17 · Plan round 122

Children used 137 of 200. Nothing started; the register's View options Build is running
(`p_5b0c6eac7fb9459881ccfe507ef9a190`). Main and live `13cfcae`. No tickets were filed at the last
review. The person has not answered the check-ins of rounds 110 and 120.

- **Why nothing new, although the scheduling rule would allow a second Build** (the plans list and
  New Plan dialog share no file with the register Build): the rate-limit window that opened at
  about 09:00Z is three hours old, and both earlier pauses came at about this point of a window
  (2 hours 46 minutes and 3 hours 38 minutes in). This window has carried three Builds, three
  Deploys, the sweep, two template reviews and many turns of mine. A Build started now would have
  most of its steps ahead of it when a pause is most likely; the Build that is running has only
  its last steps left. The next window should open at about 14:00Z.
- **What starts then, in this order:** plan formats (EXF-468, High) with the narrow number columns
  (EXF-726), once the register Build has merged; the plans list page and New Plan dialog (EXF-471,
  EXF-469) from the tickets, with the plan menu on the source's never-list, as I told the person
  at the check-in. The second touches the shell and the router (shared modules), so it runs with
  no other shared-module Build.
- **When the register Build's card comes:** read what changed since its last review, approve on a
  clean gate on main `13cfcae`; then one Deploy with the review's three new lines in its brief,
  and a register walk in that Deploy (no separate flow test unless the Deploy finds something).
- No review is due (Build 2, Deploy 0, Discover 2, Test user flow 3).

Declared for the tree, unchanged from round 121.

Ticket writes: 0.

### 2026-11-17 · Review round 122

Children used 137 of 200. One ended: **the register's View options Build completed and merged**
(`p_5b0c6eac7fb9459881ccfe507ef9a190`, pull request 63, main now `2f33143`), in one Build of 153
minutes. Nothing is running. Live is `13cfcae` (read by me at 13:01Z), one merge behind; no
migration is pending.

**EXF-529, EXF-724 and EXF-722: merged; all three Done.** I approved its card at 13:00Z in a side
turn, one minute after it arrived, on the digest, the diff and the gate; I read the steps' reports
now.
- **Gate** on main `13cfcae` at head `1e95f30`, the PR head: check passed; the whole browser suite
  492 of 492 twice and 491 of 492 once; changed specs ten times, 390 of 390; no migration. Main's
  tree equals the gated head (compared now). 87 MCP tools on main (four for view settings).
- **The settings live in the app's UI state** (no table, no migration); the running balance is
  computed in SQL (5 calls for the list with or without it, at 10 and 1,000 rows).
- **The Reviewer found a real fault:** two saves of view settings at once lost one change (10 of
  10 in its throwaway test). Fixed with a guarded write and a bounded retry, and a test that fails
  on the old code.
- **EXF-724 was real locally and is measured:** click to new figures went from about 89 and 185 ms
  (10 and 500 rows) to about 8 and 95 ms; the bar's button waits for the server.
- **Two regressions made by the polish itself were caught by the Designer's second pass** (column
  widths with flags off; the category column at 1024 px with BALANCE on) and fixed with a test.
- **The gate's own first run failed a Reconcile spec** that clicked Finish before the button was
  enabled (the new EXF-724 behaviour); the fixer read the code and fixed the spec.
- **The one failure left in the three full runs: `e2e/month-nav.spec.ts:127`, "6 month picker"**
  (5 of 5 alone). Not this Build's files. It also failed once in a full run of the second
  Plan-page Build yesterday (read then as a click-outside race under load) and could not be made
  to fail alone by a Reviewer. Twice is enough: filed through this review.
- **Departure I accept:** a row hides as soon as the page holds it as reconciled, not at the next
  load as I had expected; the ticket's criterion 2 says so.
- **Known issues:** Show Images does nothing yet; at 1024 px with BALANCE on the CATEGORY header
  is clipped; one stale sentence in the design.
- **The source:** this was the first Build allowed to apply something there. Three steps did what
  the rules allow and no more, and each listed the settings as found and as left. Evidence on
  EXF-573. The Tester looked (the "Looking" list was in the design) and named the two states it
  did not open.

**Ticket writes:** 7 (EXF-529, EXF-724, EXF-722 to Done with comments; evidence on EXF-573). One
ticket filed through this review. **Backlog:** 47 open feature tickets (52 done; none in
progress). Gap: fifteen open, none in progress, plus the one filed here. Template: thirty-nine
open (Urgent EXF-573, 611, 612). Flow verdicts unchanged. Finished since each template's last
review: Build 3, Deploy 0, Discover 2, Test user flow 3.

**Next plan:** one Deploy (`ZZ-TEST D32`) for `2f33143`, with a walk of the register's View
options and of reconcile mode on live; then, in the next rate-limit window (about 14:00Z), plan
formats with EXF-726.

### 2026-11-17 · Plan round 123

Children used 138 of 200. Started one Deploy. Main `2f33143`, live `13cfcae` (one merge behind,
nothing pending). The ticket filed at the last review exists as **EXF-727** (the month picker
spec); set to Low; it rides with the next Plan-page Build. The person has not answered the
check-ins of rounds 110 and 120.

**Started: Deploy D32** (`p_cca7951cd0c14278bc76a44b44020c8e`): ships main `2f33143`; no
migration; `gated_commit` `1e95f30` (its tree equals main's, compared now). Its checks:
- 87 tools; the view settings through REST and MCP (defaults, a write, per account, the refusal of
  Running Balance for All Accounts);
- **the running balance to the cent** on five dated rows (500,000; 530,000; 510,000; 465,000;
  455,500), through REST and in the BALANCE column, surviving a reload and a date range;
- the View popover (six presets on one row, the selects, four checkboxes, Cancel and Apply), This
  Month, the flag column, Cancel changing nothing;
- **reconciled rows hidden by default** after a reconcile through REST, the footer and View All;
- **reconcile mode keeping up (EXF-724), measured in milliseconds on live**, where a verifier saw
  the figures stale after 700 ms before;
- All Accounts; 1024×700 with the BALANCE column (the clipped CATEGORY header is expected);
- the count of plans; the prefixed purge.
- **Three changes in the brief from the Deploy template review:** the setup is one script with a
  state file that refuses a second run; the report ends with four lists (DIFFERS, NOT CHECKED,
  OBSERVED, SCREENSHOTS NOT OPENED); the `plaid credentials:` line is looked for in the raw
  `deploy.out`.
- My figures, checked twice this time: cleared 500,000 + 30,000 − 20,000 = 510,000; uncleared
  −45,000 − 9,500 = −54,500; balance 455,500; a statement of 465,000 is 45,000 below cleared.
  Not certain, and said so in the brief: whether an account created with a starting balance of 0
  has a starting row, and whether a date range shows the footer.

**Not started yet:** plan formats (EXF-468) with EXF-726 and EXF-727. It starts when this Deploy
has ended: by then the rate-limit window (about 09:00Z to 14:00Z) is nearly over, and I read
EXF-468 first. Then the plans list and New Plan dialog.

Reviews: Build 3, Deploy 0, Discover 2, Test user flow 3 since each template's last review.

Declared for the tree: this Deploy; plan formats with its two riders; the plans list and New Plan
dialog; a Deploy and a flow test of flows 2 and 3 after plan formats.

Ticket writes: 1 (EXF-727's priority).

### 2026-11-17 · Review round 123

Children used 138 of 200. One ended: **Deploy D32 completed**
(`p_cca7951cd0c14278bc76a44b44020c8e`, 14 minutes). **Live is `2f33143`** at
https://budget.doxen.dev (read by me at 13:19Z), equal to main; no migration is pending. Nothing
is running.

**Deploy D32: released; every check held; four points differ from my brief, none of them a wrong
figure.**
- Gate passed (tree equal to gated `1e95f30`; checks 235 s). Release passed, smoke ok; the bookmark
  phase ran. Health gives the whole sha; 401 without credentials; **87 MCP tools**.
- **The view settings, the running balance to the cent, hidden reconciled rows with the footer and
  View All, All Accounts: as briefed**, through REST, MCP and the browser. No console error, no
  failing request of the page's own.
- **EXF-724 on live: the header and the bar changed within 32 ms of the click** (stale at 700 ms
  before); the bar's button stayed disabled for about 0.6 s until the server answered.
- **The four points:**
  1. A click on a preset applies it at once and closes the popover; my brief had the verifier press
     Apply. The design says so from the source study (line 29); I had not read the design before
     writing the brief.
  2. View All also saves Show Reconciled as on (what I expected for reconciled rows; noted by the
     verifier for the date-range case too).
  3. The starting balance row of 0 is hidden with the reconciled rows (it is cleared, so it was
     reconciled): correct, and I had left it out of "three rows".
  4. **At 1024 px with the BALANCE column the CATEGORY header is clipped with no ellipsis and no
     tooltip.** I expected the clipping; the missing ellipsis and tooltip break the narrow-window
     rule. Filed through this review (Low).
- Plans not starting with `ZZ-TEST`: 1; purge `remaining 0`. The verifier listed the two
  screenshots it did not open, and found the `plaid credentials:` line in the raw log (sandbox
  set, production set). The setup ran once from a state file.

**What I learned:** before I write a Deploy's checks for a feature, I read the Build's design, not
only the ticket: the design holds what the source study found (here: presets apply at once).

**Ticket writes:** 1 (the live note on EXF-529). One ticket filed through this review.
**Backlog:** 47 open feature tickets (52 done; none in progress). Gap: sixteen open (with
EXF-727), none in progress, plus the one filed here. Template: thirty-nine open (Urgent EXF-573,
611, 612). Flow verdicts unchanged; flow 2 (the register) is due a run after two merges on that
page. Finished since each template's last review: Build 3, Deploy 1, Discover 2, Test user flow 3.

**Next plan:** plan formats (EXF-468) with EXF-726 and EXF-727; I read EXF-468 first.

### 2026-11-17 · Plan round 124

Children used 139 of 200 (138 before this plan; one started). Nothing else is running. Main and
live are both `2f33143`.

**The ticket filed at the last review exists: EXF-728** (the register's CATEGORY header clipped at
1024 px with the BALANCE column); priority set to Low. It goes with EXF-680 and EXF-681 in one
small register Build later.

**Started: Build feature for EXF-468 (plan formats) with EXF-726 (the Plan grid's number columns
at 1024 px)**, child `p_a45bb55447494ccd9dfb245a1af9f37b`. One Build, alone: it changes how every amount and date is
written on every screen, so no other Build can run beside it.

**What I read first, and what it changed:**
- EXF-468 is wide: a migration, a catalogue of about 130 currencies, new fields on the plan in
  REST and MCP, one formatter for every screen, typed amounts and dates, the export and import
  files, and the Plan Settings dialog. The code writes amounts in at least seven different places
  today (`formatMoney` in core, `screenMoney`, `money` on the Plan page, `registerMoney`, the
  Reflect formatters, literal `$` in components).
- **EXF-727 (the month picker spec) is not in this Build**, against what I wrote at the last
  review: the Build is already the widest so far, and the picker's fault is a separate search.
  The brief names it as the one known flake and puts its files out of bounds. It goes into the
  next small Plan-page Build.
- EXF-726 stays in: the formatter changes how wide amounts are, and both touch
  `apps/web/src/plan/columnWidths.ts`. Its own example of "twelve characters" has eleven; the
  brief measures with `−$888,888.88` (twelve; counted by script).

**Decisions in the brief (mine, where the ticket is silent):**
- Existing plans get US Dollar, `123,456.78`, Symbol First, `MM/DD/YYYY`, and **for such a plan
  every screen and file reads byte for byte as today, and an API answer differs only by the new
  fields: every existing test passes without an edit** (but a test that compares a whole plan
  object; any other edited expectation is a departure). This is the guard for the owner's real
  plan on live.
- REST and MCP amounts stay integer milliunits and dates stay ISO whatever the formats.
- One tool for one operation: `update_budget` and `create_budget` take the new fields; the
  ticket's `update_budget_settings` is not added.
- A changed currency without a number format or placement takes the currency's defaults, as the
  dialog does.
- Typing follows the plan's decimal separator and date order (the clone's rule; not observed in
  the source).
- Export files follow the plan's formats through the hook the export design left; the importer
  stores the formats it detects; one round trip in a non-default format.
- A repository test fails when a file formats money or a date by itself (the same kind of guard
  as the one for positional inserts).
- The work is ordered in six parts, each committed before the next, so that a lost box keeps what
  is done.
- My figures, checked twice against the ticket's rules: 1,234,560 milliunits in seven formats,
  the yen rounding (`¥1,235`), the Indian grouping (`1,23,45,678.90`), the seven dates.

**The source in this Build:** the test plan's Plan page and one account page may be looked at and
measured; nothing is changed. **The plan menu stays on the never-list** (it lists the owner's
other plans by name; my question at check-in 120 has no answer), so the Plan Settings dialog is
built from the ticket and is "not compared".

**Timing:** the rate-limit window turns at about 14:00Z. I started the Build at 13:43Z, not
at 13:28Z when the brief was ready: a pause before 14:00Z is then shorter than the 20 minutes
after which a box is lost.

**Not started, and why:**
- No flow test now. Flows 2, 3 and 4 are due, but this Build touches every screen they walk; one
  run after it is live covers both (and can walk a plan in a non-default format).
- No Deploy: live equals main.
- No template review: Build 3, Deploy 1, Discover 2, Test user flow 3 finished since each
  template's last review.

Declared for the tree: this Build; then a Deploy (`ZZ-TEST D33`) and a flow test of flows 2, 3 and
4; then the plans list and New Plan dialog (EXF-471, EXF-469, which EXF-468 unblocks); a small
register Build (EXF-680, 681, 728, the rest of EXF-674); a small Plan-page Build with EXF-727.

Ticket writes: 6 (EXF-728 priority; EXF-468 and EXF-726 to In Progress, each with a comment; a
comment on EXF-727 saying why it is not in this Build).

### 2026-11-17 · Review round 124

Children used 139 of 200. One ended: **the plan formats Build completed and merged**
(`p_a45bb55447494ccd9dfb245a1af9f37b`, 3 h 19 min, 38 visits). **Main is `8e54173`** (pull
request 64; its tree equals the gated head `8374d6c`). **Live is still `2f33143`** (read by me at
17:10Z); one migration is pending (`20261116101500_plan_formats.sql`). Nothing is running.

**Build: EXF-468 and EXF-726, both Done.**
- Gate on base `2f33143`: check passed; browser suite 507 of 508, then 508 of 508 twice; the one
  failure was `e2e/reconcile.spec.ts:102`, which passed 5 of 5 alone. I approved in the side turn
  the card arrived in (8 minutes after the card) on the digest, the diff and the gate: no
  out-of-bounds file, the shell files as expected, four additive columns with defaults.
- **What is in it:** four columns on `budgets`; a catalogue of 133 currencies; `currency_format`
  and `date_format` on every plan read; `PATCH` and `POST /api/v1/budgets` take
  `currency_format` `{iso_code?, example_format?, symbol_placement?}` and `date_format`
  `{format}` (a bad value: 422 with a named refusal); `update_budget` and `create_budget` take the
  same; one formatter (`packages/schema/src/plan-formats.ts`) reached through a context mounted
  once in the shell (no second fetch of the plan); the Plan Settings dialog through the menu's
  registry; typing by the plan's separators and date order; export files in the plan's formats;
  the import stores what it detects. Still **87 MCP tools**.
- **The guard test found 48 places** that formatted money or a date by themselves before the
  sweep; it is green now.
- **My figures of note 10 are all in the tests** (with a no-break space where a symbol or a group
  separator has a space, so an amount never breaks).
- **EXF-726, cause found:** the canvas measure ignored tabular digits ("−$106.50": 59.5 px on the
  canvas, 63.5 px in the page). The columns now measure with every digit as `0`, capped at twelve
  wide characters; the name column gives way.
- **The Designer found by measuring** a case nobody had named (a plain Activity amount in the
  Uncategorized row and in payment categories wrapped at 13 characters), then found that its own
  fix had dropped the font of most Activity amounts (P2). Both fixed, both with a test.
- **The Reviewer found** that an even split rounded to cents in every currency (a yen plan stored
  fractions of a yen); fixed with two tests.
- **Departures, all listed in the design:** the tool's key list and the migration test gain the new
  fields; three schema tests import the new formatter where they imported deleted functions; the
  plan menu spec's tests 5 and 6 (Plan Settings is enabled now). No other expectation was edited.
- **Known and not fixed** (in the design): a file cannot carry the group separator, cannot tell
  CAD from USD, and with "Don't show" an imported plan gets the first currency with those decimals;
  IRR's symbol is unverified; RUB and RUR have the same name; the minus sign is U+2212 where the
  source writes a hyphen.
- **The Plan Settings dialog is not compared with the source** (the plan menu stayed closed).

**The source in this Build:** every step reported its own actions; the Plan page of the test plan
only, no click, no typing. Fourth Build in a row that kept the named limits (my count from the
Threads). One incident, reported by the Designer: a timed-out capture left the source tab's
viewport at 562×44; it noticed, reset it to 1600×813 and ran the source check again.

**The Tester looked** (810 s; nine states at two sizes) and reported two things only looking finds
(below). It left the full suite to the gate (case 12 PARTIAL) and said it had not re-run the
EXF-726 spec on the old code.

**Filed through this review (four gap tickets, all Low):**
1. The Activity popover's amount column is fixed at 96 px and cuts a twelve-character amount
   though the popover has room (the Tester's note).
2. The Plan Settings dialog's Currency Placement select cuts its label (the Tester's note).
3. `e2e/reconcile.spec.ts:102` failed once in a full run (the gate); nobody has seen the failing
   line.
4. The pure functions of `packages/schema` take the formatter as an optional last argument that
   defaults to US dollars (the design's departure 9): a call that forgets it writes dollars in a
   Euro plan and no test fails. The Reviewer checked every caller of today by hand; nothing guards
   the next one.

**What I learned:**
- The wide Build went through in one piece. What I think helped: defaults that change nothing (so
  every existing spec was a regression test), the guard test run before the sweep, and the six
  parts committed in order. Holding the start to 13:43Z cost fifteen minutes; no pause came.
- Taking EXF-727 out was right for the size, and the gate met a second spec that fails now and
  then; I file such a spec at its first sighting so the next one has a place to go.
- A step that relaxes "required" to "optional with a default" to keep old tests unedited trades a
  compiler check for nothing; I should have said in the brief which matters more. Ticket 4.

**Ticket writes:** 6 (EXF-468 and EXF-726 to Done, each with a comment; evidence on EXF-573 and
EXF-684).
**Backlog:** 46 open feature tickets (53 done; none in progress); EXF-469 (New Plan dialog) is no
longer blocked. Gap: sixteen open (EXF-726 done, EXF-728 added), plus the four filed here.
Template: thirty-nine open (Urgent EXF-573, 611, 612). Flow verdicts unchanged; flows 2, 3 and 4
are due a run once this is live. Finished since each template's last review: Build 4, Deploy 1,
Discover 2, Test user flow 3.

**Next plan:** Deploy D33 for `8e54173` (one migration; checks for plan formats read from
`docs/plan-formats-design.md`; the owner's real plan must read as before, checked only by the
count of plans and by a new test plan with default formats). I set the four new tickets' priority.
While the Deploy runs no Build is approved; a Build that does not touch the shell can start
(the small register Build: EXF-680, 681, 728). The plans list and New Plan dialog follow.

### 2026-11-17 · Plan round 125

Children used 141 of 200 (139 before this plan; two started). Main is `8e54173`; live is
`2f33143` until the Deploy below releases.

**The four tickets filed at the last review exist: EXF-745** (Activity popover's amount column),
**EXF-746** (Plan Settings' placement select), **EXF-747** (the reconcile spec's one failure),
**EXF-748** (the formatter's optional argument). All set to Low. One count in EXF-745's body was
wrong ("−888.888,88€" has twelve characters, not thirteen); corrected by a comment.

**Started 1: Deploy D33** (`p_80111cfe59a74feeb70c0925e7b83a11`) for `8e54173`, gated head
`8374d6c` (trees equal), prefix `ZZ-TEST D33`. One migration is pending
(`20261116101500_plan_formats.sql`, four additive columns).
- I read the Build's design before writing the checks (the API's field names, the three named
  refusals, the rule for a changed currency).
- **The owner's plan:** one numbers-only request before the setup prints three counts: plans not
  starting with `ZZ-TEST` (1), of those the plans whose formats are not the defaults (0), and plans
  without the new fields (0). Nothing else of it is read.
- **Plan Settings is opened by keyboard only**, with the mouse parked away: the plan menu's
  `Open Plan` row opens its list of other plans on hover (I read `PlanMenu.tsx`), and that list
  would show the owner's plan.
- My figures, checked twice: balance 2,000,000 − 1,234,560 − 45,000 − 30,000 = 690,440; ZZ Food
  1,500,000 − 1,279,560 = 220,440; Ready to Assign 500,000, then 470,000 after `30,00` is typed
  into ZZ Fun; in yen −1,279.56 shows as `−¥1,280` and 1,234.56 as `¥1,235`; Total Spending
  `1.309,56€`. Assumed and said so: the starting balance row is cleared.

**Started 2: Build feature for EXF-461, its screens** (`p_20723ffe9b154bbabbe11c4e862ef60c`).

**Why this and not the plans list, which I had named:** reading the backlog by priority, the High
tickets left are all bank work, and reading the web code showed what the tickets' comments say:
**a connected bank cannot be turned into accounts from the screen.** The app has the bank search,
the sign-in window and a plain "connected" confirmation; the Worker can add accounts from a bank,
link, unlink, sync, approve and reject, but only through REST and MCP. The owner's stated goal is
live bank data in accounts he connects himself. Nothing else in the backlog matters as much, and I
should have put it ahead of plan formats.

**Why now:** on 16 Nov I set these screens aside because a design step could not be kept away
from the source's bank screens (EXF-573). Four Builds in a row have since kept limits named with
their reasons. So the screens are built from the ticket, and **no step opens the source at all in
this Build** (every part "not compared: built from the ticket"); the one linked account page the
owner allowed for viewing is on the never-list too, because nothing here needs it.

**In the Build (my decisions where the tickets are silent):**
- "Add Accounts" after a connection: every row that can be ticked starts ticked; one
  `from-bank` call; a way to leave without adding.
- Link Account, Unlink Account and Sync Now in the account edit dialog (Sync Now is the clone's
  addition, from EXF-462's text).
- The sidebar's linked icon and the white dot for unapproved rows (the dot is EXF-463's; it is
  here because this Build holds the shell).
- Two fields on the account read (`connection_status`, `last_synced_at`) in the same statement,
  so the header's label needs no second request: `Connected`, `Imports Delayed`,
  `Connection Repair Needed`. Banner, popup and Repair stay with EXF-465.
- One sync after accounts are added or linked, and one when a plan is opened and a linked account
  was not synced for six hours. The Worker's job stays daily (`wrangler.jsonc` is out of bounds);
  a six-hourly job has no ticket yet: I file one at the review.
- Out of bounds for it: `apps/web/src/register/**` and the account pages, so that the next Build
  (EXF-463's register screens) can run beside it.

**Order from here:** EXF-463's screens (next plan, beside this Build if the manifests stay apart);
then Manage Bank Connections with the connection statuses and Repair (EXF-460, EXF-465); then a
Deploy and flow 5 on live with a Sandbox bank linked from the screen; then I ask the owner to
connect a real bank. The plans list, the New Plan dialog and the small gap Builds wait.

**Not started:** no flow test (live changes within minutes; flows 2, 3 and 4 run after the
Deploy). No template review: Build 4, Deploy 1, Discover 2, Test user flow 3 finished since each
template's last review. I approve no Build while the Deploy is releasing.

**Timing:** the rate-limit window turns at about 19:00Z; one Deploy and one Build run now.

Ticket writes: 8 (four priorities; the correction on EXF-745; EXF-461 to In Progress with a
comment; a comment on EXF-463).

### 2026-11-17 · Review round 125

Children used 141 of 200. Two ended: **Deploy D33 completed**
(`p_80111cfe59a74feeb70c0925e7b83a11`, 18 minutes) and **the bank-linking screens Build was lost at
intake and cancelled by me** (`p_20723ffe9b154bbabbe11c4e862ef60c`). **Live is `8e54173`** at
https://budget.doxen.dev (read by me at 17:32Z), equal to main; no migration is pending. Nothing
is running.

**Deploy D33: released; every check held.**
- Gate passed (tree equal to gated `8374d6c`; checks 318 s). The release applied
  `20261116101500_plan_formats.sql` after the bookmark phase; smoke ok; health gives the whole
  sha; 401 without credentials; **87 MCP tools**.
- **The owner's plan, counted only:** 1 plan that is not a test plan, 0 of them with formats
  other than the defaults, 0 without the new fields.
- **Plan formats on live, as briefed to the figure:** a default plan reads as before; Plan
  Settings (opened by keyboard, the Open Plan list never shown) cancels and applies; Euro with
  comma decimals and `DD.MM.YYYY` on the Plan page, the sidebar, the register, the Activity
  popover and the Spending Breakdown without a reload; `30,00` typed into Assigned stores 30000;
  the three named refusals; the currency-change rule; yen without decimals; "Don't show"; MCP
  reads and writes; 1024×700 without sideways scroll.
- **Differs from my brief (one point of substance):** a refused `update_budget` is a tool error
  with the message only; my brief expected the refusal's name in it. That is how the tools report
  refusals in general, as far as I can read the code; I had written the expectation without
  looking. Not a ticket until I have checked what the other tools return.
- Not checked: the plan's history rows (no read for them in the API); a twelve-character amount
  in the Activity popover (EXF-745 stands as filed); the `plaid credentials:` line (the verify
  step's box had lost `deploy.out`).
- The verifier's first setup script stopped at the assignment (it sent `2026-11` for the month;
  the API wants `2026-11-01`) and went on from its state file without creating anything twice.
  The state-file rule did its work.
- Purge `remaining 0`.

**Two boxes were replaced at about 17:21Z, with no idle (EXF-612, commented).**
- The Build's Clerk had the platform's files at 17:19Z and not at 17:26Z; it asked for help and I
  told it to stop (a side turn). Nothing was built. **One child spent for nothing; I start the
  same Build again at the next plan with the same brief.**
- The Deploy's verify step ran in a box whose platform files were gone; the gate and the release
  had already passed, and it worked from the Thread's inputs. My brief told a step to stop only
  when a file *its own step needs* is missing; the verifier judged it needed none, said so first
  thing, and listed what it could not read. I accept that reading.
- In the same minutes the Playwright browser download failed in two boxes (no network to the
  download hosts). The verifier used the system Chrome. **EXF-558 (run the suite on the system
  Chrome) would take this dependency away; it is Low and I raise it at the next plan.**

**Filed through this review:** the bank sync job runs once a day (`"0 3 * * *"` in
`apps/worker/wrangler.jsonc`) while the import design wants every connection checked every six
hours; the handler already syncs whatever was not synced for six hours whenever it runs.

**What I learned:**
- A numbers-only count is enough to check a migration against the owner's plan without opening
  it; I keep that form for every migration that touches existing rows' meaning.
- I wrote one expectation into a Deploy brief without reading how the tools report refusals.
  Reading the design was not enough; where the brief asserts wording, I read the code that
  produces it.
- A box can be replaced within four minutes of a Thread's start. Nothing in a brief can guard
  that; the cost is one child each time.

**Ticket writes:** 4 (the live note on EXF-468; EXF-612 with a correction of my own comment;
EXF-461).
**Backlog:** 46 open feature tickets (53 done; EXF-461 in progress, its Build to be restarted).
Gap: twenty open (EXF-745 to EXF-748 added), plus the one filed here. Template: thirty-nine open
(Urgent EXF-573, 611, 612). **Flow verdicts unchanged; flows 2, 3 and 4 are due on live now.**
Finished since each template's last review: Build 5 (one of them the lost one), Deploy 2,
Discover 2, Test user flow 3.

**Next plan:** start the bank-linking screens Build again (same brief); a flow test of flows 2, 3
and 4 on live `8e54173` (one plan in a non-default format); EXF-463's register screens beside the
Build if I can keep their files apart; EXF-558 raised.

### 2026-11-17 · Plan round 126

Children used 143 of 200 (141 before this plan; two started). Main and live are both `8e54173`.

**The ticket filed at the last review exists: EXF-751** (the bank sync job runs once a day);
priority Medium. **EXF-558** (run the browser suite on the system Chrome) raised to Medium with
today's evidence: the browser download failed in two boxes.

**Started 1: the bank-linking screens Build again** (`p_e8c64873b67341c39fd61bdf62633a2d`, for
EXF-461), with the brief of round 125 unchanged but for one line (the Clerk tries the browser
download a second time and then says so). The first one lost its box at intake.

**Started 2: Test user flow for flows 2, 3 and 4 on live** (`p_7fe8174a2d3e40838a84c82548c99c85`,
prefix `ZZ-TEST F126`).
- Flow 2 (the register, fifth run), flow 3 (targets, Auto-Assign, next month; third run) and
  flow 4 (the five payment states; fourth run), each with the steps and figures of its last run,
  which were all right then. So this is a regression walk of the default formats after the
  widest change so far, and it gives flow 4 a verdict word after EXF-720's fix.
- One new step (flow 3, step 8): the plan is set to Euro, `123.456,78`, After amount,
  `DD.MM.YYYY` through REST; Ready to Assign must read `1.940,00€` (3,000 − 1,060), with no `$`
  and no MM/DD/YYYY date left on the Plan page or the register.
- The known list is brought up to date (EXF-728, 745, 746 added; EXF-664, 714, 529, 533 are done
  and taken out). The plan menu is not opened; no bank connection.

**Not started, and why:**
- **EXF-463's register screens** wait for the next plan. Two Builds side by side from 17:40Z
  would both sit in a pause of more than twenty minutes if the rate limit were reached before the
  window turns at about 19:00Z; one Build and one flow test is what I risk. I write that brief
  next and start it late in the window.
- No Deploy: live equals main.
- No template review: Build 5, Deploy 2, Discover 2, Test user flow 3 finished since each
  template's last review.

Declared for the tree: the two above; EXF-463's screens; Manage Bank Connections with the
statuses and Repair (EXF-460, EXF-465); the six-hourly job (EXF-751, alone); a Deploy and flow 5
with a Sandbox bank linked from the screen.

Ticket writes: 4 (EXF-751 priority; EXF-558 priority and comment; EXF-461 comment).

### 2026-11-17 · Review round 126

Children used 143 of 200. **Nothing new ended:** this review came because the Build I cancelled
at the last review (`p_20723ffe9b154bbabbe11c4e862ef60c`) reached its end state, abandoned. It is
already counted and written up (review of round 125).

**Running, both started four minutes ago and both on course:**
- The bank-linking screens Build (`p_e8c64873b67341c39fd61bdf62633a2d`, EXF-461): at intake.
- The flow test of flows 2, 3 and 4 on live (`p_7fe8174a2d3e40838a84c82548c99c85`): walking.

Main and live are both `8e54173`. No ticket write. Backlog and flow verdicts unchanged: 46 open
feature tickets (EXF-461 in progress), twenty-one open gap tickets, thirty-nine template tickets.
Finished since each template's last review: Build 5, Deploy 2, Discover 2, Test user flow 3.

**Next plan:** the brief for EXF-463's register screens, started beside the bank-linking Build
once its manifest shows that the two stay apart, and late enough in the rate-limit window (it
turns at about 19:00Z) that a pause cannot cost both boxes.

### 2026-11-17 · Plan round 127

Children used 143 of 200. Nothing started this round. Two children run: the bank-linking screens
Build (`p_e8c64873b67341c39fd61bdf62633a2d`) and the flow test of flows 2, 3 and 4
(`p_7fe8174a2d3e40838a84c82548c99c85`). Main and live are both `8e54173`.

**The brief for EXF-463's register screens is written** (with EXF-680, EXF-681 and EXF-728 as
riders, because the new attention column changes the same column widths at 1024 px). It is kept
in my scratch folder (`brief_172_approve.md`) and not started, for one reason:

**The browser download is failing in the boxes today.** The bank-linking Build's Clerk failed it
twice (17:41Z and 17:44Z: "Failed to download Chrome for Testing ... Download failure") and has
asked for help. I measured from my own box: the download address at `cdn.playwright.dev` answers
at once with a redirect to `storage.googleapis.com`, and that host timed out in two of three
tries (25 s each) and answered the third in 7 s. So the fault is the network path to that host,
not a box and not the repository. A second Build started now would stall at the same step and
could cost a child.

**What I do about it:**
- The Clerk's card comes to me in a side turn. I tell it to try the download a few more times
  and then to go on either way, saying whether the browser is there: the design step does not
  need it, and every later step's brief already says to install it before a browser spec.
- If the download stays impossible, no Build can pass its gate, because the suite runs on the
  downloaded browser. Then **EXF-558 (run the suite on the system Chrome, which every box has)
  becomes the first thing to build**, alone, since it changes `playwright.config.ts`.
- The flow test's brief already tells it to use the system Chrome if the download fails.

**What EXF-463's brief decides** (for when it starts): nothing in the source is opened (the
ticket holds the measured values); the banner's number is the account read's
`needs_attention_count`, no extra request; while View is on, every row that needs attention
shows, whatever the View options hide; Undo of a reject is out (EXF-530); the sidebar's dot is
the other Build's; the shell, `apps/web/src/account/**` and the account read are out of its
bounds so that the two Builds stay apart.

No template review is due (Build 5, Deploy 2, Discover 2, Test user flow 3). No ticket write.

### 2026-11-17 · Review round 127

Children used 143 of 200. One ended: **the flow test of flows 2, 3 and 4 completed**
(`p_7fe8174a2d3e40838a84c82548c99c85`, 33 minutes). The bank-linking screens Build
(`p_e8c64873b67341c39fd61bdf62633a2d`) is running, at its build step. Main and live are both
`8e54173`.

**Flow verdicts on live `8e54173` (no step left out in any flow; "parity" means the clone does
what the tickets and my figures say; the source was not opened):**
- **Flow 2 (the register, fifth run): `new_gaps`.** Every figure right. One new gap, **EXF-760**:
  on All Accounts at 1024 px the CATEGORY column is 41 px wide and its header runs under MEMO.
  Known and seen again: EXF-679, EXF-680.
- **Flow 3 (targets, Auto-Assign, next month; third run): `parity`.** The new Euro step held: no
  `$` and no MM/DD/YYYY date left in text, titles, labels, placeholders or values on the Plan
  page, the panel, the sidebar and the register.
- **Flow 4 (the five payment states; fourth run): `parity`.** `Got it!` is white on blue and
  readable (EXF-720 confirmed on live). Every state, sentence and figure as briefed; MCP equal.
- So plan formats changed nothing for a plan with the default formats, to the figure, on the
  screens these three flows walk. Purge `remaining 0`; plans that are not test plans: 1.

**Seen and not filed by the walker (no written rule broken); my reading:**
- A register save takes about 1.2 s on live; meanwhile the new row is listed, the editor stays
  open and dimmed, and the header is stale. Not a fault by any ticket. I keep it in mind for the
  owner's first real use: it is the slowest thing he will feel.
- "Amount remaining to assign: 0.00 0.00" in the split editor shows bare numbers; not checked in
  a Euro plan. Small; into the next register Build's brief as a thing to look at.
- With two payment categories ticked, Underfunded reads $0.00 though each alone has an amount:
  as designed (`auto-assign.ts`), accepted earlier.

**EXF-760 triaged:** Medium; it becomes a rider of the register Build for EXF-463's screens
(same file, same width, and that Build adds a column to the same table). I do not know since
when the column collapses and have not called it a regression.

**The running Build, from two side turns:**
- Its Clerk failed the browser download twice and asked for help; my own measurement showed the
  download's host answering again, and the third try worked (17:50Z).
- Then **the preflight failed: "No open tab of the source app"**, twelve minutes after the Clerk
  had opened that tab. I chose Proceed without: this Build compares nothing in the source. I do
  not know why the tab went; the box kept its platform files.
- **Its manifest has arrived and I checked it against the Build I hold back (EXF-463's
  screens):** it touches the shell, `apps/web/src/account/**`, `pages/plaid-oauth.tsx`, the
  account read in the Worker and schema, `e2e/bank-connections.spec.ts`; it does not touch
  `apps/web/src/register/**`, `pages/account.tsx`, `pages/accounts.tsx` or
  `api/transactions.ts`. No migration. The two are disjoint but for `docs/README.md`, which is
  union-merged. One thing to watch at the rebase: its manifest lists `apps/worker/test/*.test.ts`
  broadly (the account read gains two fields, so tests that compare whole accounts change).

**The flow test's box** had no Playwright browser and no `node_modules`; its platform files were
there. It installed `playwright-core` in its scratch folder and drove the system Chrome, as its
brief allowed. Third child today to fall back on the system Chrome (EXF-558).

**What I learned:**
- Re-running three flows with their old figures after the widest change cost one child and gave
  a clean answer in half an hour. Worth doing after every change that touches every screen.
- A walker that has to list "run 1 failed because of my own locator" for seven steps still
  finished every step: the state-file and marker rules hold.
- The preflight wants a source tab even for a Build that is told to open nothing in the source.
  That is a card wait for nothing each time the tab is lost; evidence for the next Build
  template review (I file no template ticket on one sighting).

**Ticket writes:** 2 (EXF-760's priority and triage note).
**Backlog:** 46 open feature tickets (53 done; EXF-461 in progress). Gap: twenty-two open (with
EXF-751 and EXF-760). Template: thirty-nine open (Urgent EXF-573, 611, 612).
**Flow verdicts now:** 1 `parity_known_gaps`; 2 `new_gaps` (EXF-679, 680, 681, 760); 3 `parity`;
4 `parity`; 5, 7 `parity_known_gaps`; 8, 9, 10, 11 `parity`; 6 not run as a flow.
Finished since each template's last review: Build 5, Deploy 2, Discover 2, Test user flow 4.

**Next plan:** start the register Build for EXF-463's screens beside the running Build, with
EXF-680, EXF-681, EXF-728 and now EXF-760 as riders, if the rate-limit window allows (it turns
at about 19:00Z).
