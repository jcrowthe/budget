# Bank link screens design (EXF-461, the screens)

EXF-461's screens: **Add Accounts** after a connection, **Link / Unlink / Sync Now** in Edit Account, the sidebar's
linked icon and unapproved dot, the header's status label, a sync after adding or linking and one when a plan opens.
The Worker half is live (`docs/account-links-design.md`); this Build is the web app plus two fields on the account
read. Spec: [bank-link-screens-spec.md](bank-link-screens-spec.md). The Lead's brief wins over the ticket.

## Source

**Not compared: built from the ticket.** No study notes, no source screenshots.

### The source app in this Build

The source app is the owner's real account. **This Build compares nothing in the source, and no step opens, reads or
captures it** beyond what the template itself does (the Clerk's step 2 opens the test plan's tab because the
template's source check needs it; that tab is then left alone on the test plan's Plan page).

Reason: every screen this Build makes has, in the source, either the owner's real banks and accounts on it or a step
that would start a real bank connection in the owner's account. The owner asked that no more data be gathered than
needed, and nothing here needs it: the ticket holds the wording from the source's help pages, and the look comes from
the clone's own dialogs, which were compared with the source when they were built (the Add Account dialog and its
bank search, the account edit dialog, the account header, the sidebar).

**What nobody ever does in the source, each with its reason:**
- **Open Add Account, the bank search or the bank's sign-in window.** Reason: it starts a real connection to a real
  bank in the owner's account.
- **Open Bank Connections, the plan menu, or any account page of the owner's real plan, including the one linked
  account page the owner once allowed for viewing.** Reason: they show the owner's banks, balances and transactions;
  this Build does not need them, and a screenshot or a note of them must never reach the repository.
- **Open an account's edit dialog, Reconcile, Reflect or settings; create, edit or delete anything; type into any
  field.** Reason: it is the owner's account, and a Designer who pressed a button in Reconcile signed the whole
  session out.
- **Leave the tab changed.** Reason: earlier steps left a size override behind and the next step's check failed.

So every part of this Build is **"not compared: built from the ticket"**, which is a complete and acceptable answer.
The Designer's work is inside the clone: consistency with the clone's own dialogs, tokens only, both window sizes.

**Each step states in its report, for itself only, every action it took in the source app, or that it opened
nothing.** (Architect: opened nothing in the source.)

## Approach

- **Two fields, same statements.** `accountsRepo.findActive` and `list` left-join `bank_accounts` and
  `bank_connections` and return `AccountReadRow` (`AccountRow & { connectionStatus, connectionSyncedAt }`).
  `accountToApi` emits `connection_status` and `last_synced_at`, both null whenever `bankAccountId` is null.
  `findBankAccountInEnvironment` (already joined to the connection) also returns them, so `link` and `from-bank`
  answer with the status without another call. No REST operation, no tool added.
- **Shared pure code** `packages/schema/src/bank-link.ts`: `planAccountType` and the default name move here from
  `services/account-links.ts` (which imports them), so the screen proposes what the server makes; `planBalanceOf`
  copies `plaid/amounts.ts` `bankBalanceToPlan` (out of bounds; a Worker test checks they agree); labels,
  `syncLine`, `planSyncDue`.
- **Web API** `apps/web/src/api/bank-link.ts`: the four writes, both syncs, `useBankConnections` (key
  `["bank-connections", budgetId]`) and `startPlanSync(qc, budgetId)` (fire and forget; on settle refreshes every query
  of the plan and the connections).
- `shell/bank-link-accounts.tsx` replaces `BankConnected.tsx` (deleted) in `AddAccountDialog` and on `/plaid/oauth`;
  props only, no URL reads. `/plaid/oauth` wraps it in `PlanFormatsProvider budgetId={saved.budget_id}` (new prop).
- **Link Account** is its own `account-modal` (`account/link-account-dialog.tsx`) because it embeds `BankSearch`;
  `EditAccountDialog` swaps to it as it swaps to `CloseAccountDialog`.
- **Sync Now needs a connection id**, and the account read has only `bank_account_id`: the edit dialog of a *linked*
  account reads `useBankConnections` (the Link list's cached query) to find it and show the bank's name. Sidebar,
  header and icon never read connections.
- **App-open sync**: `usePlanOpenSync(planId)` (`shell/bank-link-sync.ts`) is called from `PlanScope`, reads the
  sidebar's own `useAccounts` query (no extra fetch), and runs once per page load and plan (module-level `Set`).

## What the user sees

### Add Accounts (dialog and `/plaid/oauth`)

Title `Add Accounts`; `Sandbox` pill on a sandbox plan (as the bank search). Under the bank's name, one row per bank
account: checkbox; `<name> – <mask>` (en dash; name alone without mask); under it `<Type> | <balance>`
(`ACCOUNT_TYPE_LABEL[planAccountType(...)]` or the override; `fmt.money(planBalanceOf(type, current_balance))`, `—`
when none, so a card shows its debt negative); an `Edit` link. Both lines: ellipsis + `title`. **Every tickable row
starts ticked.** A row with `linked_account_id` has a disabled unticked box, a `Linked` pill (title `Already linked to
"<account name>" in this plan`, name from the cached accounts list) and no Edit. Nothing tickable: `Every account of
this bank is already linked in this plan.` Below the rows: `Accounts you leave unchecked can be linked later from an
account's Edit Account.` Footer `Next` (disabled while nothing is ticked). Close X / Escape leave; the connection stays.

**Edit** (title `Account Details`, Back): `Account Nickname`, `Account Type` (native select, every type but Cash),
`The type of account cannot be changed once created.`, `Save` (back to the list, override kept). Empty name: `The
account name is required.`

**Summary** (title `Add Accounts`, Back): `These accounts will be added to your plan, each with a Starting Balance
dated today:`, one row per ticked account (bold name, `<Type> | <balance>`), button `Add 1 Account` / `Add <n>
Accounts`: **one** `POST /budgets/{id}/accounts/from-bank` `{ bank_account_ids, overrides (edited rows only), today:
localToday() }`, disabled while it runs. Success: plan queries and connections refresh, `startPlanSync`, `onDone()`
(dialog closes; `/plaid/oauth` navigates to `/<plan>/budget`). Refusal: the summary stays with the detail in an error bar.

### Account edit dialog

- Linked only: an `Account Type` row, a disabled native select titled `The type of a linked account cannot be
  changed.` (the dialog never had a type field; unlinked accounts are unchanged).
- Section `Bank Connection` after the balance. **Open, unlinked, not Cash:** `Not linked. Link this account to import
  its transactions from your bank.` and secondary `Link Account`. **Cash or closed:** no section. **Linked:** status
  icon + label; `<connection nickname> · <name> – <mask>` once connections are read (ellipsis + title); `Last synced
  <fmt.date(local date)>` or `Not synced yet`; buttons `Sync Now` and `Unlink Account`.
- **Link Account** (modal `Link Account`, Back to Edit Account, Sandbox pill): `Choose the bank account to link to
  "<account name>".`; per connection (newest first, heading = nickname) a button row per bank account with
  `linked_account_id === null` (`<name> – <mask>`, `<Type> | <balance>`); last row `Add a New Bank Connection` (shows
  `BankSearch` variant `connections` in place; after the connection the list is re-read). Nothing to choose: `There are
  no bank accounts to link. Add a new bank connection to link this account.` and only that row. A row click sends
  `POST …/accounts/{id}/link { bank_account_id, today }` (rows disabled meanwhile); success: refresh, `startPlanSync`,
  back to Edit Account (linked section); 409/422: the detail under the line.
- **Unlink Account**: dialog `Unlink Account`, `Unlink "<name>" from its bank account? Its transactions stay in your
  plan, and no new transactions will be imported. You can link it again later.`, `Cancel` / `Unlink Account`
  (destructive) → `DELETE …/link`, refresh, back to Edit Account (unlinked section).
- **Sync Now**: `POST /bank-connections/{id}/sync?budget_id=`; disabled and reading `Syncing…` meanwhile; then one
  `role="status"` line, `syncLine(result)` or the error's detail (else `Something went wrong. Try again.`); refresh.
  Disabled with title `Bank connection not found` while no connection holds the bank account.

`syncLine`: `not_set_up` → `Bank connections are not set up.`; else `<head>: <counts>.` with head `Synced` for
`connected`, else the status label; counts = the non-zero of `N new, N matched, N updated, N removed, N skipped`, or
`nothing new`; `has_more` appends ` More to import: press Sync Now again.`

### Sidebar, header, app-open sync

- Label: `Connected` (connected), `Imports Delayed` (delayed), `Connection Repair Needed` (login_required, broken,
  or linked with null status).
- Sidebar row: in a linked account's `slot-right` a 12px check mark (connected) or plain warning mark (otherwise),
  `title` = label. `unapproved_count > 0`: a 6px `--labelPrimary` dot in `slot-left`, title `Unapproved transactions`,
  hidden while the row's pencil shows. Slots keep their widths, so name ellipsis and balance are unchanged.
- Header: between the type and the reconciled label, an `acct-info-item` with the same icon and label (`data-status`),
  linked accounts only. No banner, popup or Repair (EXF-465).
- App-open: when a plan's accounts first load in a page load and an open linked account has `last_synced_at` null
  or older than `DUE_AFTER_MS` (6 h, `@budget/schema/plaid-import`), one `POST /budgets/{id}/sync`; the accounts
  refresh when it answers; a failure shows nothing.

## D1 calls of the account reads

Measured on main `8e54173` (throwaway test with `plan-formats-calls.test.ts`'s `counting()`): **`listAccounts` 5,
`getAccount` 5, `updateAccount` (rename) 7. After: 5, 5, 7** (joins in the same statements). The Implementer first
measures `linkAccount`, `unlinkAccount`, `createAccountsFromBank` (1 and 2 ids) on unchanged code and writes the
numbers here; `apps/worker/test/bank-link-calls.test.ts` asserts all stay equal, and list = 5 with 2 and 10 accounts.

## Downstream effects

- Every Account (REST, MCP, change_log snapshots) gains both fields, schema `.default(null)` (untyped fixtures parse).
- Every MCP tool returning an account names them and lists `last_synced_at` as a nullable timestamp (required by
  `mcp-timestamps.test.ts`): the account tools in `mcp/tools/accounts.ts` and `reconcile_account`.
- EXF-463 reads `unapproved_count`; EXF-465 extends the icon and label; EXF-460 may reuse `bank-link-accounts.tsx`.

## Out of scope

Manage Bank Connections rows (EXF-460); approve and reject controls and the banner (EXF-463); the status popup,
Repair and the other statuses (EXF-465); the Worker's sync, import and Plaid files; `wrangler.jsonc` and the daily
job; choosing a plan's environment.

**Out-of-bounds files** (brief note 10) stay unchanged; no dependency; no migration
(`20261116101600_account_link_status.sql` is not needed).

## Test stand-in

The e2e server cannot reach Plaid and no route makes bank accounts without it. Browser specs use
`e2e/support/bank-link-stub.ts` (on top of `plaid-stub.ts`'s `stubPlaidLink`): in-memory fake connections and links;
it answers `/bank-connections*`, both syncs, `link` and `unlink`; turns `from-bank` into real `POST
/budgets/{id}/accounts` calls (API, `authHeaders`); and overlays the link fields on the server's real `GET …/accounts`
and `GET …/accounts/{id}` (`route.fetch()`). Accounts, Starting Balances and groups are real; only the link is fake.
Worker tests use `test/plaid-stub.ts` and real links.

## Acceptance

No case compares with the source. Specs: `realClick`, exact names, own sandbox plan, `expect.poll` on the stub's
recorded requests. Fixture connection `ZZ Bank`: `ZZ Checking` (0000, depository/checking, 1250500), `ZZ Savings` (no
mask, savings, 300000), `ZZ Card` (4444, credit/credit card, 420250), `ZZ Old` (9999, linked to the plan's `ZZ Linked`).

1. **List** (AC1, `e2e/bank-link.spec.ts`). Stubbed Link from sidebar Add Account → `Add Accounts`; rows `ZZ Checking
   – 0000` / `Checking | $1,250.50`, `ZZ Savings`, `ZZ Card – 4444` / `Credit Card | −$420.25`; three ticked; `ZZ Old`
   `Linked`, box disabled; `Sandbox` shown.
2. **Add 2 Accounts** (AC1). Untick `ZZ Savings`, `Next`, summary lists two, `Add 2 Accounts` → exactly one from-bank
   with (checking, card) and `today` = browser date; dialog closes; sidebar shows `ZZ Checking` (Cash) and `ZZ Card`
   (Credit), each with the check mark; exactly one `POST /budgets/{id}/sync` follows.
3. **Starting Balance** (AC2). `ZZ Checking`'s register: one `Starting Balance` $1,250.50, cleared, today. Worker:
   `account-links.test.ts` case 2.
4. **Edit** (AC3). Edit on `ZZ Savings` → the sentence; name `ZZ Rainy`, type `Checking`, Save → `Checking | …`; add →
   `overrides: { <savings id>: { name: "ZZ Rainy", type: "checking" } }`. No Cash option.
5. **Refusal** (note 7). from-bank 409 `name_taken` → summary stays with the detail; sidebar unchanged.
6. **`/plaid/oauth`**. Saved state + stubbed Link → the same step; `Add 1 Account` → `/<plan>/budget`, account in sidebar.
7. **Link Account** (AC4, `e2e/link-account.spec.ts`). Unlinked checking → Edit Account → `Link Account` → unlinked
   bank accounts + `Add a New Bank Connection`; choose `ZZ Checking – 0000` → one link `{ bank_account_id, today }`;
   linked section shown; sidebar check mark; one plan sync. Import start: Worker case 4.
8. **Nothing to choose**: empty sentence and only `Add a New Bank Connection`, which opens the bank search; after the
   stubbed Link the new connection's accounts are listed.
9. **Linked dialog** (AC3, AC6). Type select disabled with its title; `Unlink Account` → confirmation → one DELETE;
   check mark gone; register rows kept. `Sync Now` → one connection sync, disabled meanwhile, then `Synced: 3 new, 1
   matched.` (stubbed); a stubbed 502 shows its detail.
10. **Cash and closed** (AC5): no `Link Account`.
11. **409 on link** (AC7): `bank_account_already_linked` detail shown. Worker: case 7.
12. **Sidebar and header** (`e2e/bank-link-status.spec.ts`). Statuses connected, delayed, login_required, one with
    `unapproved_count` 2: icon titles `Connected`, `Imports Delayed`, `Connection Repair Needed`; one dot; each header
    reads type, label, `Not Yet Reconciled` in that order.
13. **App-open sync** (`e2e/bank-link-sync.spec.ts`). Linked, `last_synced_at` null: plan → account → plan = exactly one
    plan sync; reload = one more. All synced 1 h ago: none. None linked: none.
14. **Account read** (`apps/worker/test/bank-link-account-read.test.ts`): unlinked null/null; after from-bank the
    response, list and get say `connected`; connection set (env.DB) to `login_required` with a sync time → list, get,
    MCP `list_accounts` show both; after unlink null. Counts as in "D1 calls".
15. **AC7, AC8**: `apps/worker/test/account-links.test.ts` cases 7 and 8, unchanged.
16. **Narrow** (`e2e/bank-link-narrow.spec.ts`, 1024×700, 12 bank accounts, 80-character names): Add Accounts, Account
    Details, summary, Link Account, Edit Account (linked) and the Unlink confirmation lie wholly in the window; lists
    scroll inside the dialog body (`scrollHeight > clientHeight`) with the footer button visible; every cut text has
    `scrollWidth > clientWidth`, an ellipsis and `title` = whole text; a sidebar row with long name, icon and dot keeps
    name, balance and icon inside the row.
17. **Looking** (Tester; this is the main work). For each state below, at 1440×900 and at 1024×700: the Tester drives
    the clone to that state (bank data from the stand-in), takes a **fresh** screenshot in this Thread (not a file a
    spec or an earlier step wrote), opens it, and writes one sentence on what is seen in it. The report lists `state,
    size, file, sentence` for every one. A state without its two entries is PARTIAL with the words "not looked at".
    "A spec is green" is not looking.
    1. The "Add Accounts" step right after a connection is made: the bank's accounts with checkboxes, one of them
       already linked in this plan (shown as linked, not selectable).
    2. A row's Edit open (name and type; the sentence about the type).
    3. The summary with the button `Add 2 Accounts`.
    4. After adding: the sidebar with the two new accounts, each with the linked icon; one of them with the dot after
       the first sync brought unapproved rows.
    5. A linked account's header: the type, `Connected` with its icon, the reconciled label.
    6. A linked account's header when its connection's status is not `connected`.
    7. An unlinked checking account's edit dialog with `Link Account`; the list of bank accounts to choose from; the
       dialog after linking.
    8. A linked account's edit dialog: the type cannot be changed; `Unlink Account` and `Sync Now`; the confirmation
       of Unlink; the line after Sync Now.
    9. A cash account's edit dialog (no `Link Account`).
    10. In a Euro, `123.456,78`, After amount plan: state 1 (the balances in the plan's format).
18. **Repository checks.** `pnpm check` passes, including the formats test, branding, positional inserts, MCP
    descriptions and timestamps.

**Departures** (existing expected text that changes): `e2e/bank-connections.spec.ts` "link success shows the
confirmation; Done closes" and "/plaid/oauth resumes Link … shows the confirmation" assert `BankConnected`'s `ID:
0a1b2c`, `Checking ending in 0000`, `Done`; they now assert the step (`ZZ Checking – 0000`, `Checking | $110.00`,
`Next`), stub and request assertions unchanged. Any Worker test that `toEqual`s a whole Account gains the two fields;
each is listed in the report.

## The order of the work (Implementer: commit after each part)

1. The two fields on the account read with the counting test and the tools' descriptions.
2. The "Add Accounts" step, in the dialog and on the `/plaid/oauth` page, with the first sync.
3. The account edit dialog: Link Account, Unlink Account, Sync Now.
4. The sidebar's icon and dot; the header's label.
5. The sync when the app opens.
6. The narrow-window spec and the correction of `docs/account-links-spec.md`.

## Manifest

touches: [packages/schema/src/accounts.ts, packages/schema/src/bank-link.ts, packages/schema/test/bank-link.test.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/account-links.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/reconcile.ts, apps/worker/test/bank-link-*.test.ts, apps/worker/test/*.test.ts, apps/web/src/api/bank-link.ts, apps/web/src/shell/AddAccountDialog.tsx, apps/web/src/shell/BankConnected.tsx, apps/web/src/shell/BankSearch.tsx, apps/web/src/shell/plaidLink.ts, apps/web/src/shell/SidebarAccounts.tsx, apps/web/src/shell/PlanScope.tsx, apps/web/src/shell/plan-formats-context.tsx, apps/web/src/shell/icons.tsx, apps/web/src/shell/global.css, apps/web/src/shell/bank-link-*.ts*, apps/web/src/shell/bank-link.css, apps/web/src/account/EditAccountDialog.tsx, apps/web/src/account/edit-account.css, apps/web/src/account/AccountHeader.tsx, apps/web/src/account/account-header.css, apps/web/src/account/link-account-*.tsx, apps/web/src/account/link-account.css, apps/web/src/pages/plaid-oauth.tsx, e2e/bank-link*.spec.ts, e2e/link-account*.spec.ts, e2e/support/bank-link-stub.ts, e2e/bank-connections.spec.ts, docs/bank-link-screens-design.md, docs/bank-link-screens-spec.md, docs/bank-link-screens-polish.md, docs/account-links-spec.md, docs/README.md]
shared: [apps/web/src/shell/**: AddAccountDialog.tsx (Add Accounts step replaces the confirmation), BankConnected.tsx (deleted), BankSearch.tsx (linkAccountId kept in the OAuth state), plaidLink.ts (LinkState.link_account_id), SidebarAccounts.tsx (icon, dot), PlanScope.tsx (calls usePlanOpenSync), plan-formats-context.tsx (optional budgetId for /plaid/oauth), icons.tsx (check and warning marks), global.css (icon, dot; .bank-connected removed), new bank-link-accounts.tsx, bank-link-status.tsx, bank-link-sync.ts, bank-link.css]
migrations: 0
