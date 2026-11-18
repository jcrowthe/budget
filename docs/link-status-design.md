# Link status: Linked Account Not Found, the nightly check, Unavailable and Reauthorize (EXF-866 with EXF-867)

What EXF-465 left ([connection-status-design.md](connection-status-design.md), "Note 1"):
- a linked account whose bank account has left the bank's list reads **Linked Account Not Found**;
- the nightly job checks each `login_required` connection once a day;
- "Unavailable" and "Reauthorize" get their own words over the four stored statuses, from a stored reason;
- EXF-867: a pinned popup closes on a scroll or a resize, and a broken connection is called **Connection Lost** everywhere.

One additive migration (`20261116101700_connection_link_status.sql`). No new REST operation and no new tool. Spec: [link-status-spec.md](link-status-spec.md).

## The source app in the first Build (from its brief, word for word; replaced for the second Build's steps by "Carry-over (second Build)")

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the Clerk's step 2.

**What may be read, and nothing else:** in the Clerk's tab as it stands (the test plan's Plan page), **the source's loaded style rules and its already-loaded static script files** (same-origin files the page has loaded, read without navigating; they hold no data of the owner's; the wording of a status may be found there). In a tab of your own on the same address you may add throw-away elements with the source's classes to measure a look (a strip, a popup, a status icon's colour), and then close that tab. Reason: earlier steps did exactly this and found real differences; it touches none of the owner's data.

**What nobody ever does in the source, each with its reason:**
- **Open any account page, All Accounts, Bank Connections, Add Account, the bank search or a bank's sign-in window, in any plan.** Reason: a connection's status exists only on linked accounts, and the source's linked accounts are the owner's real banks, balances and transactions; a repair there starts a real sign-in at his bank.
- **Open the plan menu or the address `/users/budgets`.** Reason: they list the owner's other plans by name.
- **Read or print any text of the sidebar's header or the account menu (the plan's name and the signed-in address are there), or print the sidebar's or the page's whole text.** Reason: a Designer's sidebar read once put the account's email into a transcript.
- **Open Reconcile, Reflect or settings; create, edit or delete anything; type into any field.** Reason: it is the owner's account, and a Designer who pressed a button in Reconcile signed the whole session out.
- **Fetch a script file the page has not loaded, or let a sub-agent do so.** Reason: only what the tab already holds is read.
- **Leave the tab changed:** an override is set back and the Clerk's tab stays on the test plan's Plan page.
- **Keep a screenshot of the source that shows more than your own probe elements.**

So the behaviour and the layout of this Build are **"not compared: built from the ticket"**, which is a complete and acceptable answer; only looks and words read from the style rules or the loaded script files count as compared. EXF-465's text holds what was seen on a real account on 15 Nov and what the help pages say, with the copy for each status.

**Each step states in its report, for itself only, every action it took in the source app (style rules read, script files read and probe elements included), or that it opened nothing. Nobody but the Clerk runs the Clerk's commands; a step that runs them has opened the source and says so.**

## Source (words only)
- **Notes:** `/workspace/scratch/source/link-status/notes.md` (the Clerk's tab's 20 loaded scripts and its style rules; probes in a tab of the sub-agent's own, then closed).
- **The words are under Decisions.** Each is marked "compared" when it came from the source's loaded script (`DirectImport_Status_*`).
- **Kept from the brief where the source differs** (each a one-line change):
  - ~~`Account Not Found`~~: since the second Build the source's own `Linked Account Not Found` (see "Carry-over");
  - `Direct Import is Temporarily Unavailable` (in the source, an outage title only);
  - `Connection Lost` (in the source, its offline dialog only).
- The source badges actionable marks in the sidebar on `rgba(255,255,255,.15)`.

## Decisions

### 1. Linked Account Not Found, stored on the link
- **Column:** `accounts.link_missing_since` (ISO time, nullable).
- **Written in the sync's final batch** from `balances`, the list `/accounts/get` has just returned (no further Plaid call), by one guarded statement:
  - it is set (kept if already set) for a linked bank account absent from the list, and cleared for one that is present;
  - only changed rows are written; there is no change_log row and no `updated_at` (sync state, like the balances).
- **Only a good answer marks anything.** A failed call, an early return or a throw writes nothing. The connection's status and its other accounts are untouched.
- **Cleared by every write of `bank_account_id`:** link, unlink, close, delete, a connection's removal, a plan's delete.
- **Relink:** `linkAccount` (`services/account-links.ts:173`) now accepts an account whose `link_missing_since` is set and replaces the link in its guarded batch, with one history row. A healthy link is still refused with 409 `account_already_linked`.
- **API: a field of its own,** `Account.link_missing_since`. `connection_status` stays equal to the connection's `status` (`services/accounts.ts:147`); a fifth value would make an account disagree with its own connection.
- **Which wins:** `login_required` and `broken` show first (after a repair the next sync knows the list again). Otherwise Linked Account Not Found wins over `connected` and `delayed`, whatever the reason.

### 2. The nightly check of a connection that needs a sign-in
- **Column:** `bank_connections.login_checked_at`, the last check that got an error.
- **Nightly only.** `requestSync(env, conn, { check: true })` goes through the Durable Object to `runSync(env, id, { check })`. The early return (`plaid-sync.ts:187`) stays for every request without `check`, so plan opening and Sync Now are unchanged. `broken` is never checked.
- **The check** is one `/accounts/get`, right after `plaidFor`.
  - **Error:** it writes only `login_checked_at`; status, reason and times are unchanged, and there is no change_log row.
  - **Good:** the normal sync continues in the same run, reusing that list, and ends `connected`.
  - **A throw** changes nothing (`failureMayBeRecorded` excludes `login_required`).
- **Order:** the due loop runs first, unchanged. With runs and time left, `listToCheck` lists the `login_required` connections that were never checked or were checked 20 h or more ago (`CHECK_AFTER_MS`): the never-checked first, then the oldest. Each check is one run, so a dead connection never takes a healthy one's run.
- **Cost of a check:** on an error, 1 Plaid call and 5 D1 calls (`findById`, `accountsOf`, the token, the credentials, the write). On a good answer, the calls of a normal sync.

### 3. A stored reason, and words over the four statuses
- **Column:** `bank_connections.sync_error_code`.
  - **Set** with the status by `storeStatus` to Plaid's `error_code` (an identifier; Plaid's message is never stored or shown).
  - **Cleared** by a good sync, by Reset, and by a failure in Budget (`recordFailure`).
- **Derived:** `statusReason(status, code)` (`plaid-import.ts`) is read as **`status_reason`** on the connection and as **`connection_reason`** on the account. A connection that failed before this Build has a null code and reads as today.

| Status | Plaid codes counted | Reason | Name | Action |
|---|---|---|---|---|
| delayed | `INSTITUTION_NOT_AVAILABLE` | `unavailable` | `Direct Import is Temporarily Unavailable` | none; the 3-day line as for delayed |
| delayed | `INSTITUTION_NO_LONGER_SUPPORTED` | `unsupported` | `Connection Unavailable` | none; no strip and no 3-day line (Reset cannot help) |
| delayed | `INSTITUTION_DOWN`, `INSTITUTION_NOT_RESPONDING`, others | null | `Imports Delayed` | as today |
| login_required | `INVALID_MFA`, `INSUFFICIENT_CREDENTIALS`, `PENDING_EXPIRATION`, `PENDING_DISCONNECT` | `reauthorize` | `Reauthorization Needed` | `Reauthorize` (the same sign-in as Repair) |
| login_required | others | null | `Connection Repair Needed` | `Repair` |
| broken | any | null | `Connection Lost` | as today |

- **Why these codes.** DOWN, NOT_RESPONDING, ACCESS_NOT_GRANTED and USER_PERMISSION_REVOKED stay where EXF-465's help table puts them. `PENDING_*` normally arrive by webhook, which the clone does not take.
- **Sentences:**
  - Reauthorize: `Reauthorize your bank connection to continue importing transactions.` (compared).
  - Unsupported: `The import service no longer supports this bank, so new transactions will not be imported.` (compared, adapted).
  - Unavailable: `The import service cannot reach this bank at the moment. Budget tries again on its own.` (not compared).
  - Not found, strip: `Relink your account to continue importing transactions.` (compared).
  - Not found, popup: `Your linked account is not found. Relink to continue importing transactions.` (compared).

### 4. Update Needed: not built
A Reset in the clone cannot be left half done. The sign-in runs first, and `…/reset` (one batch) is posted only after it succeeds (`manage-connections-relink.ts`).

### 5. EXF-867
- **(a)** `stickyRef` (`connection-status-mark.tsx`) mirrors `relink.running || !!relink.error || !!relink.notice`, without `pinned`. A pinned popup still survives the pointer leaving.
- **(b)** `connectionLabel("broken")` = `Connection Lost`, in the header, the mark, the popup, the modal's subtitle, the detail banner and `syncLine`. `login_required` keeps `Connection Repair Needed`, and the strip's sentence stays.

### The web
- **One rule:** `shownStatus(account)` (`connection-status.ts`) gives the precedence above. `shownLabel`, `stripFor`, `popupFor`, `LinkStatusBadge`, `LinkStatusIcon` and the mark all use it.

| Shown | Icon (Budget's own) | Sidebar badge | Strip | Popup action |
|---|---|---|---|---|
| not_found | diamond with `!` | yes | the Relink sentence; `Relink` opens `LinkAccountDialog`, `Unlink` opens `UnlinkAccountDialog` | `Relink`, `Unlink` |
| reauthorize | key | yes | the Reauthorize sentence; `Reauthorize` | `Reauthorize` |
| unavailable | octagon with `!` | no | the 3-day line after 72 h | none |
| unsupported | octagon with `!` | no | none | none |

- **Requests:** a not_found account sends no new request. The connection query runs as today.
- **Manage Bank Connections:**
  - the subtitle and the banner title use `statusLabel(status, reason)`;
  - the badge reads `Reauthorize` or `Unavailable` (the source's labels), and the groups are unchanged;
  - the banner's button reads `Reauthorize` for that reason;
  - a bank-account row whose plan account (already read) has `link_missing_since` gains the line `Linked Account Not Found`.
- **MCP:**
  - `FIELDS` describes `status_reason` and what each value asks of the owner (an agent cannot sign in; it tells the owner to open the app).
  - `LINK_STATE` describes `connection_reason` and `link_missing_since`, with the precedence.
  - `link_account` says it may replace a not-found link.
  - The account tools' `timestamps` name `link_missing_since`.
- **1024×700:** the header label has an ellipsis and a `title`. The strip's sentence wraps, and its buttons stay whole. The popup stays inside the window.

## D1 calls (before measured at `b0240a5` with a throwaway counting test)

| Operation | Before | After |
|---|---|---|
| One sync, two linked accounts, two new entries (`world` fixture) | 13 D1, 2 Plaid | 13 D1, 2 Plaid (one more statement inside the final batch) |
| Sync of a `login_required` connection (plan opening, Sync Now) | 1, 0 Plaid | 1, 0 Plaid |
| `GET …/accounts`, `GET …/accounts/{id}` (`bank-link-calls.test.ts`) | 5, 5 | 5, 5 (columns in the same select) |
| `POST …/accounts/{id}/link`, also as Relink | 10 | 10 |
| `GET /bank-connections` (`manage-connections-reads.test.ts`) | 4 | 4 |
| Nightly loop, nothing due, nothing to check | 1 | 2 (`listToCheck`) |
| One check: error / good | — | 5 D1, 1 Plaid / as a normal sync |

## Tests and stand-ins
- **Worker:** `stubBank` with an `/accounts/get` override that leaves out `acc-sav`; `plaidError(400, code)`; `syncDueConnections(env, now, run)` with a `run` that calls `runSync` with `{ check }`.
- **Browser:** `e2e/support/bank-link-stub.ts` gains:
  - `FakeConnection.reason?`, served as `status_reason` (`toApi`, `services/bank-connections.ts:21-53`);
  - `connection_reason` and `link_missing_since` (from `opts.missing`, ISO with milliseconds, as `plaid-sync.ts:645` writes it) in the account overlay (`accountToApi`, `services/accounts.ts:147-148`);
  - a link and an unlink that clear it.
- **Looking states:** each is a stand-in sandbox plan of its own, with `ZZ Linked` linked to `ZZ Checking` of `ZZ Bank`.
  1. Connected, synced 1 h ago, `missing: { ZZ Linked: 2 h ago }`, on the account's page.
  2. As 1; Tab to its mark.
  3. `delayed`, reason `unavailable`, synced 4 days ago.
  4. `login_required`, reason `reauthorize`.
  5. `broken`; a click on its mark on its own page.
  6. `ZZ Checking` (missing, linked to `ZZ Linked`) and `ZZ Savings` (found, linked to `ZZ Other`) → Bank Connections → `ZZ Bank`.
- **What a Deploy can prove:** the reads carry the new fields (null) and the tool texts. **No state of this Build can be produced on the live app by a test.** They come only from the bank's side, and live tests never call Plaid directly.

## Acceptance
Each case is at 1440×900 unless a size is named. The compared words are read from the source's loaded script (`wrapper-*.js`, `DirectImport_Status_*`) in the Clerk's tab as it stands. Everything else is "not compared: built from the ticket".
1. **Not found is marked (Worker; fails on `b0240a5`).** Two linked accounts; a sync whose list lacks `acc-sav` → Savings has `link_missing_since` set and Checking null, both `connection_status` `connected`, and the connection `connected`. The next sync with `acc-sav` back → null.
2. **Only a good answer marks:** `/accounts/get` answering 500 → nothing marked. Sync Now on a `login_required` connection → nothing marked, 0 Plaid calls.
3. **Relink and unlink clear it:** `POST …/link` of a marked account to another bank account → 200, null, one history row. A healthy link → 409 `account_already_linked`. `DELETE …/link` → null.
4. **Screens:** state 1 →
   - the header reads `Linked Account Not Found`;
   - the strip shows the Relink sentence with `Relink` and `Unlink`;
   - `Relink` opens `Link Account`; choosing `ZZ Savings` sends 1 POST `…/link`, and the strip is gone;
   - `Unlink` opens the existing confirm.
5. **Popup by keyboard:** state 2 →
   - the mark's `aria-label` is `Linked Account Not Found`;
   - Tab opens the dialog `Linked Account Not Found` with the popup sentence, `Relink` and `Unlink`;
   - Escape closes it with focus on the mark.
6. **Which wins:** missing with `login_required` → `Connection Repair Needed`; missing with `delayed` → `Linked Account Not Found`.
7. **Modal row:** state 6 → `ZZ Checking`'s row has the line `Linked Account Not Found`, and `ZZ Savings`'s has none.
8. **Nightly check (Worker; fails on `b0240a5`):**
   - a stub that answers well → `connected`, with its entries imported;
   - `ITEM_LOGIN_REQUIRED` → 1 Plaid call, with status, `sync_error_since` and `last_synced_at` unchanged;
   - a second run within 20 h → 0 calls;
   - `broken` → 0 calls;
   - Sync Now on `login_required` → 0 calls.
9. **Healthy first:** with `maxRuns` 2, two due connections and one `login_required` → the two run, and the check does not.
10. **Reason (Worker):**
    - `INSTITUTION_NOT_AVAILABLE` → `delayed`, with `status_reason` and the accounts' `connection_reason` both `unavailable`;
    - `INSTITUTION_NO_LONGER_SUPPORTED` → `unsupported`;
    - `INVALID_MFA` → `login_required`, `reauthorize`;
    - `INSTITUTION_DOWN` → null;
    - a good sync → the code is null.
11. **Words:**
    - state 3 → `Direct Import is Temporarily Unavailable`, with the 3-day line and no button;
    - state 4 → `Reauthorization Needed`, the Reauthorize sentence, and `Reauthorize` posts link-token, reset and sync, in that order;
    - `unsupported` → `Connection Unavailable`, no strip.
12. **EXF-867 (a) (fails on `b0240a5`):**
    - with 30 accounts at 1024×700, a click on a mark pins its popup; a wheel over the sidebar's list → the popup is gone;
    - the same after a resize to 1300×900;
    - with `…/link-token` held (Repair running) → the popup stays after both.
13. **EXF-867 (b):** state 5 → the header, the mark's `aria-label`, the popup's title and the modal's subtitle read `Connection Lost`; the strip keeps `BROKEN_TEXT`.
14. **MCP:** `list_bank_connections` describes each status and `status_reason` with what it asks of the owner. `list_accounts` names `link_missing_since`.
15. **D1 calls:** the table, in `link-status-calls.test.ts`.
16. **1024×700:** at states 1, 3, 4 and 5 the strip's buttons are whole and inside the window, and the header label is not cut without an ellipsis and a `title`. At states 2 and 5 the popup is inside the window. Each state works by keyboard and by mouse.

### Looking (from the brief, word for word)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state (with the browser stand-in in the server's shape), takes a **fresh** screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it (not what a measurement says). The report lists `state, size, file, sentence`. A state without its two entries is PARTIAL with the words "not looked at". **Six states, twelve screenshots, every one opened; take no others unless something looks wrong.**

1. An account's page whose bank account was not found: the header's status label and the strip with its actions.
2. The sidebar's status mark's popup for that account, opened by the keyboard.
3. An account's page whose connection is "unavailable": the header, and the strip if the design gives it one.
4. An account's page whose connection asks for a reauthorization: the header and the strip with `Reauthorize`.
5. An account's page whose connection is broken, with the mark's popup open: the one name in the header, the popup and the strip beside each other.
6. Manage Bank Connections' detail of a connection with one bank account not found and one connected.

## The order of the work (from the brief, word for word)

1. EXF-867: the two failing specs, the two fixes (small, and it clears the names for the rest).
2. The migration and Linked Account Not Found in the Worker: the failing test, the sync's last batch, the reads, the clearing on link and unlink.
3. Linked Account Not Found on the screens: mark, popup, header, strip, the modal's row.
4. The stored reason and the words of note 3, Worker then screens.
5. The nightly check, with its tests and call counts.
6. The tools' descriptions; the narrow window.

**If the Build runs long, parts 1 to 3 are the ones that must be whole;** say plainly in the report what of parts 4 to 6 is not done, and the Lead tickets it. A part half done is worse than a part left out.

## Departures (existing expectations that change)
These assert the old label for `broken`, which is now `Connection Lost` (`e2e/bank-link-status.spec.ts` asserts `login_required`, so it is unchanged):
- `packages/schema/test/bank-link.test.ts:65`;
- `packages/schema/test/manage-connections.test.ts:21`.

## Files outside the brief's ground, with reasons
- `apps/worker/src/services/budgets.ts`: the plan delete's unlinked `after` row gains `linkMissingSince: null`.
- `apps/worker/src/mcp/tool-text.ts`: `LINK_STATE`, the account tools' shared text.
- `apps/worker/src/mcp/tools/reconcile.ts`: its account result's `timestamps`.
- `apps/worker/test/accounts.test.ts`: a full `AccountRow` literal gains the key (a type, not an expectation).

## Found, not fixed
- ~~A broken connection's list badge reads `Repair`~~: fixed in the second Build ("Carry-over", change 2).
- A connection's bank-account list is not refreshed after an update-mode sign-in that adds accounts at the bank.

## Out of scope
- EXF-466, EXF-751, the bank's balance and "Learn More" links.
- Any change to Repair or Reset.
- The other Build's ground.

## Carry-over (second Build)

Build `p_79c7d0a7b7d44cb1ad223a5eac018cd3` (18 Nov 2026) merges the first Build's branch at `c953b12` (reviewed, accepted 16 of 16, stopped only at its gate by the request's reserved list) and makes **two changes, nothing else**. Nothing above is designed or built again; the migration `20261116101700_connection_link_status.sql` is not edited, renamed or added to (`git diff c953b12 -- apps/worker/migrations` prints nothing).

### The source app in this Build (from the brief, word for word)

**No step of this Build opens, reads or probes the source app.** The Clerk's tab command is the only contact, because the platform checks that the tab exists; nobody uses that tab. Reason: everything this Build needs from the source was read by the first Build and is in `docs/link-status-design.md` and `docs/link-status-polish.md` (the status's own name in the source's loaded script, the looks of the strip, the popup, the banner and the icons). The two changes below need no new look.

**Each step states in its report, for itself only, that it opened nothing in the source app, or what it did and why. Nobody but the Clerk runs the Clerk's commands.**

### Change 1: the name is `Linked Account Not Found`
The source's own name (read by the first Architect in the source's loaded script, `DirectImport_Status_*`); the first brief's shorter name was the Lead's mistake. One label, read by every screen through `shownLabel("not_found")`, and the texts that spell it.
- **Label:** `SHOWN_LABELS.not_found` in `packages/schema/src/connection-status.ts` → `Linked Account Not Found`. This alone renames the header's label (and its `title`), the sidebar mark's `aria-label` and the popup's title.
- **Modal row:** `apps/web/src/shell/manage-connections-detail.tsx` (~187) renders `shownLabel("not_found")` for both the text and the `title` (no literal).
- **Texts:** `LINK_STATE` in `apps/worker/src/mcp/tool-text.ts`; `link_account`'s description in `apps/worker/src/mcp/tools/accounts.ts`; `link_missing_since`'s description in `packages/schema/src/accounts.ts`. Code comments may follow or stay (`plaid-sync.ts`, `account-links.ts`, `connection-status.ts`). **Not the migration file**, not even its comment.
- **Unchanged:** `RELINK_STRIP`, `RELINK_DETAILS`, `Relink`, `Unlink`, every other word; test titles stay (the acceptance names tests by them).
- **1024×700:** the header's label already ellipsizes with a `title` (`account-header.css` `.link-status-label`); the popup (292 px) holds the name on one line and its title wraps if ever needed (`.status-popup strong`, block); the row's line is a `.mc-line` (nowrap, ellipsis) with the full name in its `title`. `e2e/link-status-narrow.spec.ts` gains the popup title's check (in its test 2) and the row (new test 6).
- **Tests (expectations first, run once against the old label, one failing line quoted):** `packages/schema/test/link-status.test.ts` (`shownLabel("not_found")`, the popup's title), `apps/worker/test/connection-status-mcp.test.ts` (`toContain("Linked Account Not Found")`: the old `toContain("Account Not Found")` would pass on either name), `e2e/link-status.spec.ts`, `e2e/link-status-narrow.spec.ts`.

### Change 2: a broken connection's badge reads `Connection Lost`
`connectionBadge` (`packages/schema/src/manage-connections.ts`) gave `Repair` to every "attention" connection, broken included, while a broken connection cannot be repaired and is `Connection Lost` everywhere else since EXF-867.
- **Decision:** `status === "broken"` → `Connection Lost`, with the icon the list already uses for it (`LinkWarningIcon`, the same mark as the header's and the sidebar's for broken; `BadgeIcon`'s fall-through gives it unchanged). `login_required` keeps `Repair` / `Reauthorize`; an unknown status keeps `Repair`; delayed and connected unchanged.
- **The list:** the badge's `data-kind` is `lost` for it (no rule reads it; it avoids a value with a space). Groups, order and a click on the row are unchanged (broken stays in Needs Attention).
- **The detail:** reads the same function. Its banner keeps `data-kind="repair"`, the warning mark, `Connection Lost` as title and no button (the button shows for `Repair`/`Reauthorize` only, and never for broken, as today).
- **Tests:** `packages/schema/test/link-status.test.ts` gains `expect(connectionBadge("broken")).toBe("Connection Lost")` (fails first with `Repair`: quote it); `e2e/link-status.spec.ts` gains test `C2`; `e2e/link-status-narrow.spec.ts` test 6 checks the badge is whole at 1024×700.

### Carry-over checks (besides acceptance cases 1 to 16, which read `Linked Account Not Found` where they said `Account Not Found`)
- **C1, the name in its five places:** cases 4, 5, 6, 7 and 14 by their tests, and `e2e/link-status-narrow.spec.ts` tests 1, 2 and 6 at 1024×700: the header, the mark's `aria-label`, the popup's title, the modal row (text and `title`) read `Linked Account Not Found`; the tools' `list_accounts` description contains it.
- **C2, the badge:** a stand-in plan with `ZZ Bank` (connected), `ZZ Gone` (`broken`) and `ZZ Locked` (`login_required`) → Bank Connections list → `ZZ Gone`'s `.mc-badge` reads exactly `Connection Lost` with an `svg`, `ZZ Locked`'s reads `Repair`; both sit under `Needs Attention`, `ZZ Bank` under `All Others`, and `ZZ Bank` has no badge; a click on `ZZ Gone` opens its detail with the `Connection Lost` banner and no `Repair`. Test: `e2e/link-status.spec.ts` "C2 the Bank Connections list: a broken connection's badge reads Connection Lost". At 1024×700 the badge is whole and inside its row (narrow test 6).

### Looking (from the brief, word for word; replaces the list above for this Build)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state (with the browser stand-in the first Build made), takes a **fresh** screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it. The report lists `state, size, file, sentence`. **Four states, eight screenshots, every one opened; take no others unless something looks wrong.** (The first Build's states 3, 4 and 5 were looked at on `c953b12` and their code does not change.)

1. An account's page whose bank account was not found: the header's label with the new name, and the strip.
2. The sidebar mark's popup for that account, opened by the keyboard: its title with the new name.
3. Manage Bank Connections' detail of a connection with one bank account not found and one connected: the row's line with the new name.
4. The Bank Connections list with a broken connection: its badge.

(States 1 to 3 are the first Build's looking states 1, 2 and 6; state 4 is C2's plan.)

### The order of the work (from the brief, word for word; replaces the list above for this Build)

1. The name: expectations first (one failing line quoted), then the label and the texts.
2. The broken connection's badge: the failing test, the change.
3. `pnpm check`; the specs `e2e/link-status*.spec.ts`, `e2e/connection-status*.spec.ts`, `e2e/bank-link*.spec.ts`, `e2e/manage-connections*.spec.ts`.

### D1 calls
**Unchanged:** the table above stands as measured. No Worker code changes in this Build but a tool's description (`tool-text.ts`, `tools/accounts.ts`), a schema description and comments; no request is added on any screen.

### Departures (edited expectations of the first Build's tests; reason: this Build's brief, change 1)
- `packages/schema/test/link-status.test.ts:80` and `:123`: `Account Not Found` → `Linked Account Not Found`.
- `apps/worker/test/connection-status-mcp.test.ts:23`: `toContain("Account Not Found")` → `toContain("Linked Account Not Found")`.
- `e2e/link-status.spec.ts:51, 56, 100, 108, 129, 150`: the same (`:151`'s `not.toContainText("Account Not Found")` stays: it is stricter).
- Acceptance cases 4, 5, 6, 7 and the Looking list's words: the same rename.
None for change 2 (only new expectations).

### Out of bounds (the Lead's scope note 1)
The other Build's ground (`apps/web/src/menu-actions/**`, `plan-export/**`, `plan-import/**`, `plans/**`, `api/plan-export.ts`, `api/plan-import.ts`, `packages/schema/src/ui-state.ts`, `e2e/plan-export-dialog*`, `e2e/plan-import-dialog*`, `e2e/plan-menu.spec.ts`, `e2e/shell-compare.spec.ts`, `e2e/plans-list*`); every `paths.always_overlap` file; `planMenuEntries.ts`, `router.tsx`, `api/client.ts`; `packages/core/src/**`, `packages/schema/src/common/**`; the Worker's `app.ts`, `middleware/**`, `secrets/**`, `db/client.ts`, `history/**`, `mcp/server.ts`, `mcp/types.ts`; `apps/web/src/plan/**`, `reflect/**`, `register/**`; `e2e/support/real-click.ts`; `scripts/**`; the migration file. No dependency is added. Not this Build's (the Lead tickets them): a connection's bank-account list not refreshed after a sign-in that adds accounts; the detail's `Reset` and `Remove` under a scroll at 1024×700.

## Manifest
touches: [apps/worker/migrations/20261116101700_connection_link_status.sql, apps/worker/src/db/schema/accounts.ts, apps/worker/src/db/schema/bank-connections.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/services/account-links.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/budgets.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/durable/plaid-item-sync.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/reconcile.ts, apps/worker/src/mcp/tool-text.ts, apps/worker/test/link-status*.test.ts, apps/worker/test/accounts.test.ts, apps/worker/test/connection-status-mcp.test.ts, packages/schema/src/plaid-import.ts, packages/schema/src/bank-link.ts, packages/schema/src/connection-status.ts, packages/schema/src/manage-connections.ts, packages/schema/src/accounts.ts, packages/schema/src/bank-connections.ts, packages/schema/test/link-status*.test.ts, packages/schema/test/bank-link.test.ts, packages/schema/test/manage-connections.test.ts, packages/schema/test/connection-status.test.ts, apps/web/src/account/**, apps/web/src/shell/connection-status-*, apps/web/src/shell/connection-status.css, apps/web/src/shell/bank-link-status.tsx, apps/web/src/shell/icons.tsx, apps/web/src/shell/manage-connections-*, apps/web/src/shell/manage-connections.css, apps/web/src/api/bank-link.ts, e2e/support/bank-link-stub.ts, e2e/link-status*.spec.ts, e2e/connection-status*.spec.ts, e2e/bank-link-status.spec.ts, e2e/manage-connections*.spec.ts, docs/link-status-*.md, docs/README.md]
shared: [apps/web/src/shell/** (connection-status-mark.tsx: EXF-867 stickyRef, shown status, Relink/Unlink/Reauthorize in the popup; connection-status-icon.tsx / icons.tsx: key, diamond and octagon icons; bank-link-status.tsx: shown label and icon; manage-connections-*: reason-aware label, badge, banner, the row's Linked Account Not Found line; second Build: the row's name from shownLabel, the broken badge Connection Lost)]
migrations: 1
