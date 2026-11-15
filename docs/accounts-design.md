# Accounts design (EXF-481)

The account resource (REST + MCP), **Add Unlinked Account** with a **Starting Balance** transaction for the
seven non-loan types, a first plain account list in the sidebar, and a minimal account page. Spec:
[accounts-spec.md](accounts-spec.md). The Lead's scope notes on the Build override the ticket where they differ.

## Source

Studied live in the plan "Test Budget" on 2026-11-15 (dark theme, 1600×813), without pressing Next. Notes and
screenshots: `/workspace/scratch/source/accounts-add-unlinked/notes.md` (`01-add-accounts-modal.png` …
`11-account-page-tracking.png`). Everything after Next comes from the ticket (discovery created accounts then).

- **Modal**: 360×700, never resizes; header 70px (Back chevron left, `h1` 18px/600 centred, Close X right, both
  icons 24px in the accent colour, 70×70 hit areas); body scrolls (padding 16px 16px 0); footer 81px with a
  top border `--borderSubtle` and one full-width 48px button.
- **Start "Add Accounts"**: bank search + popular banks (EXF-459, not built), then the secondary large button
  **"Add an Unlinked Account"** (48px, 16px/500, `--buttonSecondaryBackground`, radius 8px).
- **Form "Add Unlinked Account"**: intro `<b>Let's go!</b> And don’t worry—if you change your mind, you can link
  your account at any time.` (U+2019, U+2014 without spaces); labels 14px/600 "Give it a nickname",
  "What type of account are you adding?", "What is your current account balance?". Inputs 48px, radius 8px,
  bg `#3c3e53`, border `#56596c`, accent border on focus, **no placeholders**; nickname autofocused; balance
  `inputmode="decimal"`, never reformatted. The type select is a 48px button, 14px/400, text
  "Select account type..." (three ASCII dots) or the chosen label, a small right triangle in the accent colour.
  **Next**: disabled = bg `#292b3d`, text `#9b9caa` (no opacity); enabled `#545bfe`, hover `#7583ff`. No
  `<form>`: Enter submits nothing. Enabled iff `nickname.trim() !== ""` and a type and `balance !== ""`
  (the source enables it for "abc"). Picker → Back keeps all three values.
- **Picker "Select Account Type"**: Back + Close, no footer, body scrolls. Groups: `h3` 16px/600, description
  14px/500 `--labelSecondary`, then tiles 56px, margin-top 8px, padding 16px, 16px/500, left aligned, border
  1px `--borderSubtle`, radius 8px, hover bg `#292b3d`; group margin-bottom 16px. Headings, descriptions
  (straight apostrophes) and 13 labels exactly as in the ticket. A loan type adds interest/payment fields (EXF-482).
- **Sidebar rows** (seen on closed accounts only; the plan has no open account): group label 12px/500,
  letter-spacing 1.36px, uppercase; row 32px, margin 0 5px 4px 8px, radius 6px; name 14px/500 ellipsis with
  `title`; balance 12px/500 tabular-nums right; negative balance = red pill (`#ee5867`, padding
  .125rem .375rem, radius 1000px); link `/<plan>/accounts/<id>`; active row highlighted.
- **Account page**: name 24px/700; badge line 12px/500 `--labelSecondary` ("Checking", "Tracking Account:
  Asset" …); balances "Cleared Balance + Uncleared Balance = Working Balance". Starting Balance row: date,
  payee "Starting Balance", category "Inflow: Ready to Assign" (cash) or "Category not needed", cleared.
- **Success** (ticket): green check, "Success!", one line, "Add Another" and "Done". Its header was not
  observed by this study; Budget keeps the title "Add Unlinked Account" with only the Close X.

## Approach

Follow `docs/conventions.md` (files only, `(env, actor, input)` services, one `db.batch`, guarded inserts as
in `createAccount`). No migration: the tables have every column needed.

### Pure type rules (`packages/core/src/account-types.ts`, shared)

Add, beside `ACCOUNT_TYPES` and `CREDIT_ACCOUNT_TYPES` (unchanged):
`AccountGroup = "cash" | "credit" | "loan" | "tracking"`, `accountGroup(type)`, `isOnBudget(type)` (cash and
credit true; tracking false; loans false until EXF-482/547 decide), `positiveMeansOwed(type)` (credit, loan,
`otherLiability`), `startingBalanceAmount(type, entered)` (negates for debt types, never returns `-0`),
`startingBalanceFeedsReadyToAssign(type)` (cash group only), `STARTING_BALANCE_PAYEE = "Starting Balance"`,
`isLoanType(type)`. Unit tests in `packages/core/test/account-types.test.ts`. Nothing else in core changes.

### API

All under `/api/v1`, Access-protected like every route; validation errors are **422 `unprocessable_entity`**
(as the months route), other errors use the app envelope `{ error: { id, name, detail } }`.

| Method, path | Request | 2xx | Errors |
| -- | -- | -- | -- |
| `GET /budgets/{budget_id}/accounts` | `?include_closed=true\|false` (default `true`) | 200 `{data:{accounts: Account[]}}` ordered by `sort` | 404 `not_found` (plan) |
| `GET /budgets/{budget_id}/accounts/{account_id}` | | 200 `{data:{account}}` | 404 `not_found` (plan or account, any id string) |
| `POST /budgets/{budget_id}/accounts` | `{name, type, balance, date?}` | 201 `{data:{account, starting_balance: Transaction}}` | 404 plan; 409 `name_taken` ("This account name already exists."); 422 `unprocessable_entity` for blank/over-100 name, unknown type, non-integer balance, bad date, loan type (detail: "Loan accounts (mortgage, autoLoan, studentLoan, personalLoan, medicalDebt, otherDebt) are not supported yet") |

`Account` = the existing fields (`id, budget_id, name, type, on_budget, note, starred, closed, sort,
created_at`) **plus** `cleared_balance`, `uncleared_balance`, `balance` (milliunits, computed per request:
cleared = sum of non-deleted transactions with `cleared` in (`cleared`, `reconciled`); uncleared = sum of
`uncleared`; balance = their sum). `balance` in the request is integer milliunits **as entered**; the server
applies `startingBalanceAmount`. `date` is ISO, years 1900–2199, a real calendar date; absent → today in UTC.
`on_budget` is never sent: it is `isOnBudget(type)`. `POST` honours `Idempotency-Key` (existing middleware).

MCP (`apps/worker/src/mcp/tools/accounts.ts`): `list_accounts {budget_id, include_closed?}` → `{accounts}`;
`create_account {budget_id, name, type, balance, date?}` → `{account, starting_balance}`. Both call the same
services; a thrown `NameTaken` / loan refusal becomes an MCP `isError` result carrying the same message.

### Create: one atomic, race-safe write

`addUnlinkedAccount(env, actor, budgetId, input, {today?})` in `services/accounts.ts`:
1. Parse, refuse loans, check the plan, pre-read the name (`lower(name) = lower(?)` among the plan's
   non-deleted accounts, **closed included**) → `NameTaken` early.
2. Build the account row (trimmed name, `on_budget = isOnBudget`, `sort = maxSort + 1`, so it is last in its
   group) and the Starting Balance row.
3. One `db.batch`: (a) `changeLogInsertIf` "account create" guarded by G1; (b) account insert guarded by G1;
   (c) transaction insert guarded by G2; (d) `changeLogInsertIf` "transaction create" guarded by G2.
   **G1** = "sort is still the next free one **and** no non-deleted account of the plan has `lower(name)` equal
   to the new one". **G2** = "an account with the new id exists". D1 runs a batch as one SQL transaction and
   serialises statements per database, so of two simultaneous creates with one name exactly one passes G1;
   the loser writes nothing (no account, no transaction, no log).
4. If (b) changed 0 rows: re-read the name → `NameTaken`; otherwise a sort race → retry (5 attempts, then
   `Conflict`), exactly like `createAccount`.

Name folding is SQLite `lower()` (ASCII) in both the pre-read and the guard, so they always agree; non-ASCII
letters compare case-sensitively (accepted, noted for EXF-547).

The existing minimal `createAccount` stays for other tests: `on_budget` becomes **optional** (default
`isOnBudget(type)`), it still writes no Starting Balance and its behaviour is otherwise unchanged; it returns
the account with zero balances. `createTransaction` is unchanged. REST and MCP use only `addUnlinkedAccount`.

### The Starting Balance transaction

Stored in `transactions` with existing columns only: `payee_name = "Starting Balance"`, `category_id = null`,
`inflow_to_ready_to_assign = startingBalanceFeedsReadyToAssign(type)` (this flag **is** "Inflow: Ready to
Assign"), `amount = startingBalanceAmount(type, balance)` (≥ 0 inflow, < 0 outflow; 0 still writes a row),
`cleared = "cleared"`, `approved = true`, `memo = null`, `date` as above.

**Recognised later** as: the account's transaction with `payee_name = STARTING_BALANCE_PAYEE`, no category,
created in the same batch as the account (the earliest `created_at` of the account). The register (EXF-513)
shows its category as "Inflow: Ready to Assign" when the flag is set, and "Category not needed" when the
account is tracking or the row is a credit Starting Balance. No payees table is invented.

**Counting.** The engine already counts the cash Starting Balance as an RTA inflow and ignores tracking
accounts. A credit Starting Balance (on-plan, no category, no flag) would otherwise land in the engine's
*uncategorized* bucket and lower next month's Ready to Assign. `activityByMonth` therefore leaves out rows on
accounts whose type is on-plan and does not feed RTA (`creditCard`, `lineOfCredit`, derived from the core
rules) with `payee_name = "Starting Balance"`, `category_id IS NULL` and the flag off. EXF-532 replaces this
with the payment-category rule. The engine code itself does not change.

### Web

- `apps/web/src/api/accounts.ts`: `listAccounts`, `getAccount`, `createAccount` over `apiFetch`; hooks
  `useAccounts(budgetId)` (open only, key `["accounts", budgetId]`), `useAccount`, `useCreateAccount(budgetId)`
  (on success invalidates every query whose key contains the plan id, so the Plan page's Ready to Assign
  refreshes whatever key the grid Build uses).
- `AddAccountDialog.tsx` (shell): one dialog, four screens held in state, no URL change (plan-urls C10 checks
  history length): **start** "Add Accounts" (Close; only the "Add an Unlinked Account" button, no search),
  **form**, **types** (picker; loan tiles shown, `disabled`, muted), **success**. The dialog's accessible name
  is the current title. Form values survive form↔types. Balance text is parsed on Next by
  `parseAmountInput` (`packages/schema/src/amount-input.ts`, unit-tested): optional `-`, optional `$`
  (either order), digits with optional correct thousands commas, up to two decimals; anything else →
  "Enter an amount" under the balance field and no request. 409 → "This account name already exists." under
  the nickname; other errors → the error detail above Next. Success: green check icon (Budget's own),
  "Success!", "Add transactions in the register, or import a transaction file with File Import.",
  "Add Another" (back to start, fields cleared) and "Done"; Done and X both close and navigate to
  `/{budget}/accounts/{id}`. The web sends `date` = the browser's local date.
- `SidebarAccounts.tsx`: under the nav, the plan's open accounts grouped CASH, CREDIT, TRACKING (label only
  when non-empty; loan-type accounts, which only tests can create, are not listed), each row a `NavLink`
  (name + `formatMoney(balance)`, negative as the red pill), API order (`sort`) so a new account is last.
  The "No Accounts" card stays, shown only when the plan has no open account.
- `pages/account.tsx`: known id → `PageHeader` with the name, the badge text, and three plain lines
  "Cleared Balance", "Uncleared Balance", "Working Balance" with amounts; title `<Name> | <Plan> | Budget`.
  404 (any unknown id) → `<Navigate replace>` to All Accounts as today.
- Tokens: add `--labelNegative: #ee5867`, `--inputBorderSubtle: #56596c`; reuse `--menuHover`,
  `--labelTertiary`, `--actionPrimary`, `--statusPositive`, `--buttonSecondaryBackground`. No raw colours.

## Downstream effects

- EXF-459 adds the bank search to the start screen. EXF-482 enables loans (picker tiles, extra fields, the 422
  goes away; it decides `isOnBudget` for loans). EXF-483 replaces `SidebarAccounts` (totals, collapse, starred,
  loans, closed, pencil, drag). EXF-484 replaces the page header; EXF-513 adds the register and transaction
  routes and shows the Starting Balance row. EXF-532 replaces the credit Starting Balance exclusion. EXF-547
  extends the core rules.
- `Account` gains three balance fields: any consumer of the schema gets them.

## Out of scope

Bank search and linking, loan types, account edit/close/delete/star/reorder, sidebar totals and collapse,
the register, the real account header, All Accounts content, credit payment categories. Files of other
Builds (Lead note 10) are not touched.

## Acceptance

Clone: a fresh plan made with `POST /api/v1/budgets` (name `ZZ-TEST …`), opened at `/{id}/budget`; tests
never assume a new plan has no categories. Source (compare cases): plan "Test Budget", dark theme, 1600×813,
sidebar **Add Account** → **Add an Unlinked Account**; never press Next.

1. **Form (compare).** Add Account → Add an Unlinked Account: dialog "Add Unlinked Account" with Back and
   Close, the intro text (bold "Let's go!"), the three labels, the select reading "Select account type...",
   nickname focused, Next disabled. Source: same screen. Sizes and colours match the Source section.
2. **Next rule.** "   " + Savings + "5" → disabled; "X" + Savings + "" → disabled; "X" + no type + "5" →
   disabled; "X" + Savings + "abc" → enabled.
3. **Picker (compare).** Select → "Select Account Type": four headings, descriptions and 13 labels in the
   ticket's order; the six loan tiles are disabled and clicking one keeps the picker open. Clicking Savings
   returns to the form showing "Savings" with nickname and balance kept; Back also keeps them. Source: same
   screen (loan tiles enabled there).
4. **Checking 250.** Nickname `ZZ-TEST D3 Checking …`, Checking, `250`, Next → "Success!" and the Budget line;
   Done → URL `/{id}/accounts/{accountId}`, title "<name> | <plan> | Budget", page shows the name, "Checking",
   Cleared $250.00, Uncleared $0.00, Working $250.00. Sidebar: CASH label, the row last in CASH with $250.00.
   API: one transaction (via `starting_balance` and D1): today's local date, "Starting Balance", amount
   250000, flag true, no category, cleared, approved. `GET …/months/<this month>` `ready_to_assign` rose by
   exactly 250000.
5. **Credit Card 150.** Row in CREDIT shows −$150.00 as a red pill; Starting Balance amount −150000, no
   category, flag false; Ready to Assign unchanged this month and next month; the month has no
   `uncategorized` bucket from it.
6. **Asset 5000.** Row in TRACKING $5,000.00; page badge "Tracking Account: Asset"; `on_budget` false; Ready to
   Assign unchanged.
7. **Liability 700.** Row in TRACKING −$700.00; badge "Tracking Account: Liability"; amount −700000.
8. **Zero.** Cash `0` → Starting Balance row with amount 0 exists; balance $0.00.
9. **Duplicate.** With "ZZ-TEST Dup X" existing, Next with "  zz-test dup x " → "This account name already
   exists." under the nickname, the form stays, account and transaction counts unchanged. Same for a closed
   account's name (set `closed` in D1 in the Worker test).
10. **Add Another / X.** On Success, "Add Another" → start screen "Add Accounts" with the button; then the
    form is empty. On another Success, X → the new account's page.
11. **REST = MCP.** `create_account` and `POST` with the same input give the same shapes and amounts;
    `change_log` has an `account` create and a `transaction` create for each, actor `user:…` for REST and
    `mcp:…` for MCP.
12. **Race.** Five simultaneous `addUnlinkedAccount` calls with one name → exactly one account, one
    transaction, two change_log rows; the others reject with `NameTaken`. A guarded batch built directly with
    a taken name changes 0 rows.
13. **Refusals.** `POST` with `mortgage` → 422 and the loan detail; unknown type, blank name, `balance: 1.5`,
    `date: "2026-02-30"` → 422. Form balance `10+5` or `abc` → "Enter an amount", no request.
14. **Surface.** `apps/worker/test/accounts.test.ts` asserts the three paths with `apiPaths()` and both tools
    with `listedToolNames()`; `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `e2e/mcp.spec.ts`
    unchanged.
15. **Unknown id / no regressions.** `/{id}/accounts/<made-up id>` still lands on All Accounts (plan-urls
    spec green); a new plan still shows the "No Accounts" card (shell specs green); opening and closing Add
    Account changes neither URL nor history length.

Files outside the Lead's expected list: `packages/schema/src/transactions.ts` (only exports its existing
`isCalendarDate` so the account `date` uses the same rule), `packages/schema/src/amount-input.ts` and its test
(the form's balance parser, in a package that has unit tests; core is limited to `account-types.ts`),
`packages/schema/test/accounts.test.ts` (request schema cases).

## Manifest

touches: [packages/core/src/account-types.ts, packages/core/test/account-types.test.ts, packages/schema/src/accounts.ts, packages/schema/src/transactions.ts, packages/schema/src/amount-input.ts, packages/schema/test/amount-input.test.ts, packages/schema/test/accounts.test.ts, apps/worker/src/services/accounts.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/routes/accounts.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/test/accounts.test.ts, apps/web/src/api/accounts.ts, apps/web/src/shell/AddAccountDialog.tsx, apps/web/src/shell/AccountTypePicker.tsx, apps/web/src/shell/accountTypeLabels.ts, apps/web/src/shell/SidebarAccounts.tsx, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/icons.tsx, apps/web/src/shell/global.css, apps/web/src/shell/tokens.css, apps/web/src/pages/account.tsx, e2e/accounts.spec.ts, docs/accounts-design.md, docs/accounts-spec.md, docs/README.md]
shared: [packages/core/src/account-types.ts: the pure type rules (group, on-plan, sign, Starting Balance) the Worker and web read; apps/web/src/shell/{AddAccountDialog.tsx, AccountTypePicker.tsx, accountTypeLabels.ts, SidebarAccounts.tsx, Sidebar.tsx, icons.tsx, global.css, tokens.css}: the Add Unlinked Account flow, the sidebar account list, two tokens and three icons]
migrations: 0
