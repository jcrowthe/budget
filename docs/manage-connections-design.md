# Manage Bank Connections screens (EXF-460, the screens) with EXF-773

The Manage Bank Connections modal (list, detail, a bank account's options, Repair, Reset, Remove), from a sidebar
button and the plan menu; rider EXF-773 (the linked account's edit dialog at 1024×700). The Worker half is live
(`docs/bank-connections-manage-design.md`); **this Build is the web app**. Spec:
[manage-connections-spec.md](manage-connections-spec.md). The Lead's brief wins over the tickets.

## Source

**Not compared: built from the ticket.** No study, no source screenshot, no notes file.

### The source app in this Build

The source app is the owner's real account. **This Build compares nothing in the source, and no step opens, reads or
captures it** beyond what the template itself does (the Clerk's step 2 opens the test plan's tab because the
template's source check needs it; that tab is then left alone on the test plan's Plan page; if a later platform check
fails only because that tab is missing, say so in the first line of your answer and go on with your own step).

Reason: the source's Bank Connections screen lists the owner's real banks, with their names, ids and balances. The
ticket holds what was seen there on 15 Nov (the groups, a row's three lines, the badges, the detail's sections and
buttons, the dialogs' words), and the look comes from the clone's own dialogs, which were compared with the source
when they were built.

**What nobody ever does in the source, each with its reason:**
- **Open Bank Connections, Add Account, the bank search or a bank's sign-in window.** Reason: they show the owner's
  banks or start a real bank connection in his account.
- **Open the plan menu, or any account page of the owner's real plan.** Reason: the menu lists his other plans by
  name; the pages show his transactions and balances.
- **Open an account's edit dialog, Reconcile, Reflect or settings; create, edit or delete anything; type into any
  field.** Reason: it is the owner's account, and a Designer who pressed a button in Reconcile signed the whole
  session out.
- **Leave the tab changed.** Reason: earlier steps left a size override behind and the next step's check failed.

So every part of this Build is **"not compared: built from the ticket"**, which is a complete and acceptable answer.
The Designer's work is inside the clone: consistency with the clone's own dialogs (the Add Accounts dialog, the Link
Account dialog, the account edit dialog), tokens only, both window sizes.

**Each step states in its report, for itself only, every action it took in the source app, or that it opened
nothing.** (Architect: opened nothing in the source; ran none of the Clerk's commands.)

## Approach

- **One host, swapped views.** `ManageConnectionsDialog({ budgetId, onClose })` is the plan menu action's `Dialog`
  (`menu-actions/bank-connections.tsx`) and what the sidebar button opens. Confirmations, Unlink and Add Accounts are
  **swapped in** for the modal (as `EditAccountDialog` swaps to `UnlinkAccountDialog`): one dialog, one Escape
  listener at a time. The address never changes; the `?add-accounts=connections` hook goes.
- **One read.** The list is `useBankConnections(budgetId)` (the Link Account dialog's cached query). Detail and
  options hold a connection **id** and render that query's row; no `GET /bank-connections/{id}`. Save writes the
  PATCH's answer into the query (`setQueryData`). Plan accounts: `useAccounts(budgetId)` (the sidebar's query).
- **Reuse, no copies** (list in the spec): `BankLinkAccounts` (gains a `single` mode), `useBankSubline`,
  `UnlinkAccountDialog`, `AddAccountDialog` variant `connections`, the `api/bank-link.ts` writes and helpers.
- **Pure rules in a new file** `packages/schema/src/manage-connections.ts`: `connectionGroup`, `statusLabel`,
  `accountCountLabel`, `resetAvailableAt` (a copy of the Worker's, which is not importable from the web; a Worker test
  checks they agree, as `planBalanceOf` is checked today).
- **Formats.** `fmt.money`, `fmt.date` (`usePlanFormatter()`). The plan formats hold no time, so a time of day is
  the browser's (`timeOfDay(iso)`, `Intl.DateTimeFormat` hour + minute).
- **No Worker source change, REST operation, tool or migration.** One Worker test is added.

## What the user sees

### Ways in
- Sidebar: `Bank Connections` (BankIcon, `.add-account` style) directly under `Add Account`; `Connections` while the
  sidebar is narrow; absent in the rail, when the plan is not found and until the plan is resolved.
- Plan menu: `Manage Bank Connections` enabled. Both open the modal; Close X / Escape on the list close it.

### List (title `Manage Bank Connections`, Close X; classes `dialog modal account-modal`)
- Body: a `Sandbox` pill (`env-pill`, title `Plaid Sandbox: test banks only`) on a sandbox plan, then groups in this
  order, only when they have rows, each an `<h3>`: `Needs Attention` (status `login_required`, `broken` or any unknown
  string), `Delayed` (`delayed`), `All Others` (`connected`). Rows keep the read's order (newest first).
- A row is one `<button aria-label="<nickname>">`: 32px logo (`institution_logo`, else BankIcon glyph) with an 8px
  status dot on its lower right corner (`--statusPositive` for connected, `--labelWarning` otherwise); three lines
  `<nickname>` (bold), `1 Account` / `<n> Accounts`, `ID: <display_id>` (each ellipsis + `title`); a badge for a
  status that is not connected: warning mark + `Repair`, or clock + `Delayed` (amber text on the warning background);
  a chevron.
- Empty: `No bank connections yet.` A failed read: its detail in an `error-bar`.
- Footer: primary large `Add a New Bank Connection`. No Security Policy link.

### Add a New Bank Connection from the modal
The modal is swapped for `AddAccountDialog variant="connections"` (bank search with Back, no unlinked button). Its
own flow is unchanged: sign-in, then **the "Add Accounts" step follows exactly as from the sidebar**, then
`Add N Accounts` (one `from-bank`, a plan sync). Back on the search, Close X at any step, and the step's end
(`onDone`) all return to the **list**, which then invalidates `["bank-connections", budgetId]` so the new connection
shows (also when the person closed the step without adding).

### Detail (Back to the list; title = nickname, subtitle = `statusLabel(status)`; Close X)
1. Banner (warning background, warning mark), only when not connected:
   - `login_required` / unknown: **Connection Repair Needed** — `Your bank needs you to sign in again before new
     transactions can be imported.` and secondary `Repair`.
   - `broken`: **Connection Repair Needed** — `This bank connection cannot be repaired. Remove it and connect the bank
     again.` and destructive `Remove` (opens the Remove confirmation). No `Repair`.
   - `delayed`: **Imports Delayed** — `Your bank or the import service did not answer the last time Budget asked.
     Budget tries again on its own, so new transactions may arrive late.` No button.
2. `Nickname`: input, `maxLength=100`, starts with the nickname.
3. Link section: link icon + `Linked in this plan` when any bank account has `linked_account_id`, else
   `Not linked in this plan`. One row button per bank account: logo, `<name> – <mask>` (`bankAccountLabel`),
   `<Type> | <balance>` (`useBankSubline`, type = the linked plan account's type when linked, else `planAccountType`),
   for a linked one a third line `Linked to <plan account name>`; chevron. Each line ellipsis + `title`.
4. `Bank Connection Details`: label/value rows `Bank Name` (institution_name), `Bank Connection ID` (display_id),
   `Import Provider` (provider, `Plaid`); then `Last synced <fmt.date(local date)> at <timeOfDay>` or `Not synced yet`.
5. Side by side: secondary `Reset` (ArrowsCircleIcon) and destructive `Remove` (trash icon). Under them, when Reset is
   disabled, a note with the same text as its `title`.
6. Footer: primary large `Save`, disabled while the trimmed draft equals the nickname or a write runs.
- Messages of Save, Repair and Reset: one `error-bar` (`role="alert"`) above the footer.

### Save
One `PATCH /bank-connections/{id}?budget_id=` `{ nickname: draft }` (empty allowed: the server falls back to the
bank's name). Success: the answer replaces the row in the list query; the draft becomes the answer's nickname. 422 /
404: its detail.

### Reset and Repair (which call does what)
Both run `useConnectionRelink` (`shell/manage-connections-relink.ts`):
1. `POST /bank-connections/{id}/link-token?budget_id=` (no body, no Idempotency-Key): the **update-mode** token.
   409 `reset_too_soon` / `bank_connection_broken`, 422, 502 → their detail; nothing else happens.
2. `loadPlaidLink()` then `Plaid.create({ token, onSuccess, onExit }).open()` — the bank's sign-in. No OAuth state is
   saved. Escape is ignored while it is open.
3. `onSuccess` → `POST /bank-connections/{id}/reset?budget_id=` (Idempotency-Key): the Worker sets `status`
   `connected` and `last_reset_at` now (so after a Repair, Reset too waits 24 h; the Worker's rule). Then the plan's
   queries are invalidated, and **one** `POST /bank-connections/{id}/sync?budget_id=` is sent (not awaited by the
   screen; on settle the plan's queries and connections are invalidated again; its failure shows nothing).
4. `onExit` → `plaidExitMessage(err)` or `The bank sign-in was closed. Nothing was changed.`; nothing written.
- `Reset` first asks: dialog **Reset Bank Connection**, `Reset signs in to <institution_name> again for this
  connection. Its accounts, their links and their transactions stay. After a reset, Reset is not available for 24
  hours.`, `Cancel` / primary `Reset`. Confirm → back to the detail, the flow starts. `Repair` starts it at once.
- **Disabled** (both `Reset` and `Repair`) while `resetAvailableAt(last_reset_at)` is in the future: title and note
  `Reset is available again on <fmt.date> at <timeOfDay>. A bank connection can be reset once every 24 hours.`
  `Reset` of a `broken` connection is disabled with title and note `This bank connection cannot be reset. Remove it
  and connect the bank again.` Both buttons are disabled while a flow runs.

### Remove
Dialog **Remove Bank Connection**: `This will unlink every account linked to this connection. Their transactions and
the accounts themselves stay.` `Cancel` / destructive `Remove` (disabled while it runs). One `DELETE
/bank-connections/{id}?budget_id=`; success → `invalidateBankLink` (accounts lose marks and labels; the connection
leaves the list) and the **list** view. 502 `plaid_remove_failed` / 404 / 422: the detail in the dialog; nothing
removed. Cancel / Escape → detail.

### A bank account's options (title = `<name> – <mask>`, Back to the detail)
- Not linked here: `<Type> | <balance>` line, then two row buttons with chevrons: `Link to an Existing Account` and
  `Add as a new Account`.
  - **Link to an Existing Account** (title the same, Back to options): `Choose the account to link to "<label>".`
    and one row per plan account that is open, not linked (`!linked`) and not Cash: name, `<Type> | <fmt.money(balance)>`.
    None: `There is no account in this plan to link. Add it as a new account instead.` A click: one `POST
    /budgets/{id}/accounts/{account}/link { bank_account_id, today: localToday() }` (rows disabled meanwhile);
    success → `invalidateBankLink`, `startPlanSync`, detail; refusal → its detail under the sentence.
  - **Add as a new Account** (title `Account Details`, Back to options): `BankLinkAccounts` with `single` and the
    connection narrowed to this bank account: the Account Details form (nickname, type, its note) with footer
    `Add Account` → one `POST …/accounts/from-bank { bank_account_ids: [id], overrides (when edited), today }`;
    success → refresh, `startPlanSync` (inside `BankLinkAccounts`), detail; refusal → error bar, form stays.
- Linked here: `Linked to "<account name>" in this plan.` and secondary `Unlink` → `UnlinkAccountDialog` swapped in
  (its text and `Unlink Account` button); cancel → options; done → detail.

### EXF-773: the linked account's edit dialog at 1024×700
- Under `@media (max-height: 760px)` the dialog's vertical spacing tightens, so on opening `Sync Now` and `Unlink
  Account` lie wholly inside `.form-body`'s visible box. Above 760px nothing changes.
- The result line (success or error) is scrolled into view (`block: "nearest"`) when it appears.
- The Sync button holds both labels in one grid cell (the other `visibility: hidden`): its width never changes, so
  `Unlink Account` stays still.

## D1 calls

- **List read** (`listBankConnections`, the screen's one read), measured on main `9ecd379` with
  `bank-link-calls.test.ts`'s `counting()` (throwaway test; no existing test counts it): **2** calls with no
  connection, **4** with 1 and with 3 (plan environment, connections, bank accounts, the plan's links).
  `apps/worker/test/manage-connections-reads.test.ts` pins 4 for 1 and for 10 connections.
- Writes: the Worker half's, unchanged. **No REST operation and no MCP tool is added.**

## Downstream effects

Two specs' expectations change (Departures). `BankLinkAccounts`' present callers are unchanged. `tokens.css` gains
`--labelWarning` and `--calloutWarningSubtleBackground` (the values the plan grid and panel use locally). EXF-465
builds its statuses on `connectionGroup` / `statusLabel`.

## Out of scope

EXF-465 (header banner, sidebar mark popup, Reauthorize/Update/Account Not Found/Unavailable, pausing imports); a
Security Policy link; resuming an update-mode sign-in after an OAuth redirect (`/plaid/oauth` says it cannot resume;
nothing was written, so Reset can be pressed again); any Worker source file. Every out-of-bounds file of brief note 12 (listed in the spec) stays unchanged. No dependency.
No migration (`20261116101600_bank_connections_screen.sql` is not needed).

## Acceptance

No case compares with the source. Specs: `realClick`, exact names, own sandbox plan, `expect.poll` on the stub's
recorded requests, `e2e/support/bank-link-stub.ts` (extended) and `stubPlaidLink`. Fixtures: `ZZ Bank` (connected, `0a1b2c`, `ZZ Checking – 0000` linked to the plan's `ZZ Linked`,
`ZZ Savings – 1111` not linked), `ZZ Late` (delayed, 1 account), `ZZ Locked` (login_required, 1 account), `ZZ Gone`
(broken). Criteria of EXF-460 are noted (ACn).

1. **Ways in** (AC1, `e2e/manage-connections.spec.ts`). `Bank Connections` directly under `Add Account` (top below
   its bottom, same left) → dialog `Manage Bank Connections` with `Add a New Bank Connection`, URL unchanged. Plan
   menu `Manage Bank Connections` (not aria-disabled) → same dialog. Narrow sidebar → `Connections`.
   `?add-accounts=connections` opens nothing.
2. **One healthy connection** (AC2). Only `ZZ Bank`: one heading `All Others`; row `ZZ Bank`, `2 Accounts`,
   `ID: 0a1b2c`, dot colour = `--statusPositive`, no badge; exactly one `GET /bank-connections`.
3. **Groups** (AC3, screen part). `ZZ Locked`, `ZZ Late`, `ZZ Bank`: headings `Needs Attention`, `Delayed`, `All
   Others` in order; badges `Repair`, `Delayed`; `1 Account`. Server part: `plaid-sync*.test.ts`, unchanged.
4. **Empty and Sandbox.** `No bank connections yet.`, the footer button, the `Sandbox` pill.
5. **Add a New Bank Connection.** Bank search with `Back`, no `Add an Unlinked Account`; stubbed sign-in → `Add
   Accounts` → `Next` → `Add 2 Accounts` (one `from-bank`) → the list with the new row. Back on the search → list.
6. **Detail** (AC4). `ZZ Bank`: every element of "Detail" (title, `Connected`, `Nickname`, `Linked in this plan`,
   `ZZ Checking – 0000` / `Checking | $1,250.50` / `Linked to ZZ Linked`, `ZZ Savings – 1111`, the three detail rows,
   `Not synced yet`, `Reset`, `Remove`, `Save`); unlinked → `Not linked in this plan`; synced → `Last synced <date>
   at <time>`. No `GET /bank-connections/{id}`.
7. **Rename** (AC5). `ZZ Renamed`, Save → one PATCH `{ nickname: "ZZ Renamed" }`; title and (after Back) row read it;
   still one list GET. Stubbed 422 → its detail. `change_log`: `bank-connections-manage.test.ts` case 2.
8. **Link to an Existing Account** (`e2e/manage-connections-accounts.spec.ts`). Lists only open, unlinked, non-Cash
   plan accounts (a cash and a closed one absent); a choice → one link `{ bank_account_id, today }`, one plan sync,
   `Linked to …` in the detail, sidebar check mark.
9. **Add as a new Account.** `Account Details`, name `ZZ Rainy`, `Add Account` → one `from-bank` with that id and the
   override; `ZZ Rainy` in the sidebar; one plan sync.
10. **Unlink.** `Linked to "ZZ Linked" in this plan.` → `Unlink` → `Unlink Account` → one DELETE link; `Not linked in
    this plan`; sidebar mark gone.
11. **Reset** (AC7, `e2e/manage-connections-reset.spec.ts`). Confirm → in order one `…/{id}/link-token`,
    `__plaidConfig.token` = the stub's, one `…/{id}/reset`, one `…/{id}/sync`; then `Reset` disabled with the 24-hour
    title and note. Sign-in exit → its sentence, no reset call. Stubbed 409 `reset_too_soon` → its detail. Worker case 6.
12. **Repair.** `ZZ Locked`: banner + `Repair` → the same three calls; subtitle `Connected`, row in `All Others`.
    `ZZ Gone`: its sentence and `Remove`, no `Repair`, `Reset` disabled with its title. `ZZ Late`: `Imports Delayed`.
13. **Remove** (AC6, screen part). Confirmation text as above → one DELETE → list without it; the linked sidebar
    account loses its mark. Stubbed 502 → its detail, kept. Server part: Worker cases 3–5.
14. **AC8** (MCP): Worker case 7, unchanged.
15. **EXF-773** (`e2e/manage-connections-edit-sync.spec.ts`, 1024×700). Linked account's Edit Account: `Sync Now` and
    `Unlink Account` inside `.form-body`'s box at `scrollTop` 0; `Sync Now` (stub 600 ms late) → `Unlink Account`'s x
    unchanged during `Syncing…`; the `role="status"` line inside the visible box. Fails on `9ecd379` (quote the line).
    1440×900: dialog height unchanged. `e2e/link-account*.spec.ts`, `e2e/bank-link-narrow.spec.ts` pass.
16. **Narrow** (`e2e/manage-connections-narrow.spec.ts`, 1024×700): 30 connections; one with 14 bank accounts and
    80-character names; options, Link to an Existing Account, Account Details and the Reset, Remove and Unlink
    confirmations: each wholly in the window; lists scroll inside `.account-modal-body` with the footer visible;
    every cut text has `scrollWidth > clientWidth`, an ellipsis and `title` = whole text.
17. **Looking** (Tester; this is the main work). For each state below, at 1440×900 and at 1024×700: the Tester drives
    the clone to that state (bank data from the stand-ins), takes a **fresh** screenshot in this Thread (not a file a
    spec or an earlier step wrote), opens it, and writes one sentence on what is seen in it. The report lists `state,
    size, file, sentence` for every one. A state without its two entries is PARTIAL with the words "not looked at".
    "A spec is green" is not looking.
    1. The sidebar with the `Bank Connections` button under `Add Account`; the plan menu's `Manage Bank Connections`
       entry enabled.
    2. The list with three connections, one in each group: `Needs Attention` (with the `Repair` badge), `Delayed`
       (with the `Delayed` badge), `All Others`.
    3. The empty list ("No bank connections yet.") with `Add a New Bank Connection`.
    4. A connected connection's detail: the title and subtitle, `Nickname`, the link section with one bank account
       linked in this plan and one not, `Bank Connection Details` with "Last synced", `Reset`, `Remove`, `Save`.
    5. The detail of a connection that needs repair (its banner and `Repair`), and of a delayed one (its banner).
    6. A bank account's options: for one that is not linked (`Link to an Existing Account`, `Add as a new Account`)
       and for a linked one (`Unlink`).
    7. The Reset confirmation; `Reset` disabled within 24 hours of a reset, with its reason showing.
    8. The Remove confirmation.
    9. After a rename: the list row and the detail's title.
    10. EXF-773, at 1024×700 only: a linked account's edit dialog as it opens (both buttons whole) and after
        `Sync Now` (the result line in view).
    11. In a Euro, `123.456,78`, After amount plan: state 4 (the balances in the plan's format).
18. **Repository checks.** `pnpm check` passes (formats, branding, positional inserts, MCP coverage untouched);
    `git diff --stat origin/main` shows no out-of-bounds file and no `package.json`/lockfile change.

**Departures** (existing expected text that changes): `e2e/plan-menu.spec.ts` "6 EXF-470" — `Manage Bank
Connections` joins the enabled list. `e2e/bank-connections.spec.ts` "the Manage Bank Connections variant has a Back
arrow and no unlinked button" — opened from the sidebar's `Bank Connections` → `Add a New Bank Connection` instead
of `?add-accounts=connections`; after Back the list dialog shows (its assertions on Back, no unlinked button, no `or`
unchanged).

## The order of the work (Implementer: commit after each part)

1. The modal's list with its groups, the two ways in, the empty state.
2. The detail: the sections, Save.
3. A bank account's options: link, add as new, unlink.
4. Repair and Reset; Remove.
5. EXF-773 with its spec.
6. The narrow-window spec.

## Manifest

touches: [apps/web/src/menu-actions/bank-connections.tsx, apps/web/src/shell/manage-connections-*.ts*, apps/web/src/shell/manage-connections.css, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/bank-link-accounts.tsx, apps/web/src/shell/icons.tsx, apps/web/src/shell/tokens.css, apps/web/src/shell/global.css, apps/web/src/api/manage-connections.ts, apps/web/src/account/link-account-section.tsx, apps/web/src/account/EditAccountDialog.tsx, apps/web/src/account/edit-account.css, packages/schema/src/manage-connections.ts, packages/schema/test/manage-connections.test.ts, apps/worker/test/manage-connections-reads.test.ts, e2e/manage-connections*.spec.ts, e2e/support/bank-link-stub.ts, e2e/bank-connections.spec.ts, e2e/plan-menu.spec.ts, docs/manage-connections-design.md, docs/manage-connections-spec.md, docs/manage-connections-polish.md, docs/README.md]
shared: [apps/web/src/shell/**: Sidebar.tsx (the button, opens the modal; hook removed), bank-link-accounts.tsx (`single` mode for Add as a new Account), icons.tsx (trash, link, clock), tokens.css (two warning colours), global.css (the button's spacing), new manage-connections-* files (the modal)]
migrations: 0
