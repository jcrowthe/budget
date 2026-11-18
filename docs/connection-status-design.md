# Connection status on the account's page and the sidebar (EXF-465 with EXF-824)

A linked account says that its bank connection needs the owner, in the places the owner will see it. On the account's page,
a strip offers `Repair`. The sidebar's status mark gets a popup. A delay of more than three days gets its own line. In the Worker,
deleting a plan no longer leaves bank links behind (EXF-824). The four stored statuses stay as they are; there is no new
column, migration or REST operation. Spec: [connection-status-spec.md](connection-status-spec.md).

## The source app in this Build (from the brief, word for word)

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the Clerk's step 2.

**What may be read, and nothing else:** in the Clerk's tab as it stands (the test plan's Plan page), **the source's loaded style rules and its already-loaded static script files** (same-origin files the page has loaded, read without navigating; they hold no data of the owner's). In a tab of your own on the same address you may add throw-away elements with the source's classes to measure a look (a banner strip, a small popup, a warning icon's colour), and then close that tab. Reason: earlier steps did exactly this and found real differences; it touches none of the owner's data.

**What nobody ever does in the source, each with its reason:**
- **Open any account page, All Accounts, Bank Connections, Add Account, the bank search or a bank's sign-in window, in any plan.** Reason: a connection's status, its banner and its Repair button exist only on linked accounts, and the source's linked accounts are the owner's real banks, balances and transactions; Repair there starts a real sign-in at his bank.
- **Open the plan menu or the address `/users/budgets`.** Reason: they list the owner's other plans by name.
- **Read or print any text of the sidebar's header or the account menu (the plan's name and the signed-in address are there), or print the sidebar's or the page's whole text.** Reason: a Designer's sidebar read once put the account's email into a transcript.
- **Open Reconcile, Reflect or settings; create, edit or delete anything; type into any field.** Reason: it is the owner's account, and a Designer who pressed a button in Reconcile signed the whole session out.
- **Leave the tab changed:** an override is set back and the Clerk's tab stays on the test plan's Plan page. Reason: an override left behind made the next step's check fail.
- **Keep a screenshot of the source that shows more than your own probe elements.**

So the behaviour and the layout of this Build are **"not compared: built from the ticket"**, which is a complete and acceptable answer; only looks read from the style rules count as compared. EXF-465's text holds what was seen on a real account that needed repair on 15 Nov (the header labels, the banner's words, the list badges) and what the help pages say.

**Each step states in its report, for itself only, every action it took in the source app (style rules read, script files read and probe elements included), or that it opened nothing. Nobody but the Clerk runs the Clerk's commands; a step that runs them has opened the source and says so.**

## Source (looks only)

Notes: `/workspace/scratch/source/connection-status/notes.md` (with `probe-*.png` and `probe-measurements.json`). A sub-agent
read only style rules, CSS variables and already-loaded script files in one tab of its own on the test plan's address. It added
one probe container, screenshotted only the probes, then removed the probes and closed its tab. What it found (dark theme):

| Piece | Source (style rules) | Clone token / value |
|---|---|---|
| Strip (`.accounts-notification-item`) | bg `#292C6C`, text `#FFF`, padding 8px 16px, height 48px, 16px/400, icon 16px then text with 6px margins | new token `--calloutStripBackground: #292c6c`; `min-height` 48px (wraps) |
| Strip button | primary `#545BFE`, 32px high, radius 8px, padding 6px 16px, 16px/500, min-width 84px | `--buttonPrimaryBackground` |
| Popup (`.modal-direct-import-status`) | card `#1F2038`, 292px wide, padding 16px, radius 6.4px, shadow `0 16px 64px rgba(0,0,0,.2)`, no scrim; title 14px bold `#FFF`; line 14px/500 `#C4C5CF`; button full width, 32px | `--backgroundTertiary`, `--shadowMenu`, `--labelPrimary`, `--labelSecondary` |
| Sidebar mark | 20×20; when action is needed, bg `rgba(255,255,255,.15)` with radius 4px | `--buttonSubtleBackground` |
| Info notice (`.flash-notice`) | dark `rgba(117,131,255,.2)`, radius 8px, padding 16px, 14px/500 | `--calloutPrimarySubtleBackground` (exists) |
| Modal scrim | `--scrimDefault` dark `rgba(0,0,0,.33)` | `--overlay` (exists, equal) |

## Decisions

### Strip on the account's page (`apps/web/src/account/connection-status-strip.tsx`)
The strip is placed in `AccountHeader` directly below `BalanceRow`. It is full width and inside `<header class="acct-head">`, so
it shows on the account's page only: All Accounts uses `AllAccountsHeader`. The pure rule `stripFor(account, connection, now)` is in
`packages/schema/src/connection-status.ts`:

| Account | Strip |
|---|---|
| not linked, closed, `connected` | none |
| `login_required` | warning icon, `Repair your bank connection to continue importing transactions.`, primary `Repair` |
| `broken` | warning icon, `This bank connection cannot be repaired. Remove it and connect the bank again.` (the modal's `BROKEN_TEXT`, word for word), primary `Open Bank Connections`: it opens Manage Bank Connections on that connection's detail, where Remove is. There is no Remove on the account's page. |
| `delayed`, last success ≤ 72 h ago | none |
| `delayed`, last success > 72 h ago | clock icon, `Imports have been delayed for over 3 days. Try Reset in Bank Connections.`, no button |

- **Where the three days are counted from:** the account's `last_synced_at` (`services/accounts.ts:148`). That is the
  connection's last *successful* sync: `lastSyncedAt` is written only when a sync finishes (`plaid-sync.ts:694`); a failure
  writes `syncFailedAt` and `syncErrorSince` (`:173`, `:96`). **Never synced** (`null`): counted from the connection's
  `created_at` (`services/bank-connections.ts:39`, from the connections read). While that read has not answered, there is no line.
- **Repair** runs `useConnectionRelink` (`shell/manage-connections-relink.ts`), which is imported from where it is, not
  moved or copied: link token in update mode, sign-in, `reset`, one sync, `invalidateBankLink`, which refreshes the account,
  the register and the sidebar. While it runs, the button is disabled (`aria-busy`). Under the 24-hour rule it is disabled with
  `title` = `resetReason(connection, fmt)` (exported from `manage-connections-detail.tsx`, the modal's sentence).
- **Messages** show on a line under the strip. A closed sign-in is a *notice* (`role="status"`, notice look). Every other
  failure is an *error* (`role="alert"`, the existing `.error-bar` look).
- **The connection** (its id, `created_at` and `last_reset_at`) comes from `useBankConnections` (the existing query, key
  `["bank-connections", budgetId]`), matched by `bank_account_id`. The query is enabled only for a linked, open account whose
  status is not `connected`. A connected account's page therefore sends no request it did not send before.
- 1024×700: the sentence wraps (no fixed height); the button is `flex: none` and stays whole inside the window.

### The sidebar mark's popup (`apps/web/src/shell/connection-status-mark.tsx`)
- `<a>` must not hold a `<button>`, so the mark leaves the `NavLink`. It becomes a `<button class="nav-link-status">`, a sibling
  of the link inside `.nav-account-row`, placed over the link's empty `.slot-right` (absolute, 20×20). It has `aria-label` =
  `connectionLabel(s)`, `aria-expanded` and `aria-controls`, and no `title`, since a native tooltip would cover the popup. A click
  anywhere else on the row still opens the account. A click on the mark opens the popup and keeps it open.
- **Opens** on pointer enter and on focus. **Closes** 200 ms after the pointer has left both the mark and the popup, when focus
  leaves both, on Escape (focus goes back to the mark), on a click outside, and on a scroll of `.sidebar-scroll` or a resize.
  While a Repair started from the popup runs, or when it has left a message, the popup closes only on Escape, a click
  outside or a click on the mark.
- **Content** (`popupFor(s)` in the pure file): the title is `connectionLabel(s)`. `connected`: `lastCheckedText(last_synced_at,
  now)` = `Last checked a few seconds ago` … `Last checked 3 days ago` (the relative-time words are `reconciledAgo` from
  `packages/schema/src/reconcile.ts`, reused and already tested; `null` → `Not checked yet`). `login_required`: `REPAIR_TEXT`
  plus a full-width `Repair` (the same hook; disabled with the reason under the 24-hour rule). `delayed`: `DELAYED_TEXT`.
  `broken`: `BROKEN_TEXT`. The three sentences move into the pure file, and the modal's detail imports them unchanged.
- The popup is `role="dialog"` (non-modal), `aria-label` = the title. It is rendered right after the mark, so the next Tab from
  the mark reaches its button. It is `position: fixed`, which is not clipped by the sidebar's scroll box, with `z-index:
  var(--z-menu)`. It is placed by `placeStatusPopup(mark, size, vw, vh)` (pure file): 8 px right of the mark, centred on it, kept 8 px
  inside the window, or left of the mark when there is no room.
- **Narrow sidebar** (151–220 px, `sidebarState.ts:6,34`): the same mark and popup. **Rail:** it shows no account rows
  (`Sidebar.tsx`, `!rail && … SidebarAccounts`), so it has no mark and no popup. That is unchanged.
- `LinkStatusIcon` shows the clock (`ClockIcon`, the modal's Delayed badge) for `delayed`. The header and the mark follow.

### Manage Bank Connections: the two notes of 18 Nov
- **Dimmed page:** the dim is already there, and the Lead's expectation already holds. Measured in the clone at 1440×900 (a
  throw-away spec, not kept): the modal's `.dialog-backdrop.top` is `position: fixed`, 1440×900, `rgba(0, 0, 0, 0.33)`, `z-index`
  30, and it is the topmost element at (1300, 450). That is the same rule as every other dialog (`global.css:312-320`) and the
  source's dark scrim. On this dark theme the scrim is faint, which is likely why it was taken for none. **The scrim is not
  changed.** The confirmations that replace the modal on screen are listed under Found, not fixed.
- **A closed sign-in is a notice:** `useConnectionRelink` returns `notice` (the closed sentence) apart from `error`. The detail
  shows the notice as `<p class="mc-notice" role="status">` (notice look) where the error bar sits. The strip and the popup
  show it the same way.

### Imports while a connection needs repair (note 4: read, left)
The nightly job is `scheduled.ts:13-29` (cron `0 3 * * *`) → `syncDueConnections` (`plaid-sync.ts:921`) → `listDue`
(`repositories/bank-connections.ts:151-162`). That list **excludes** `login_required` and `broken` (line 157). If such a
connection were run anyway, `syncConnection` would return at once (`plaid-sync.ts:187`). So a connection that needs a sign-in is
never asked again until Repair or Reset. **Left as it is.** A once-a-day retry needs a stored "last tried" time (`syncErrorSince`
is the start of the outage, not the last try; there is no column for that, and none may be added). It also needs a nightly-only
path through the Durable Object (`durable/plaid-item-sync.ts`), because a plan open and Sync Now must keep returning at once.
That is more than one small change → Found, not fixed.

### MCP (note 6)
`list_bank_connections` and `get_bank_connection` share `FIELDS` (`mcp/tools/bank-connections.ts:12`). It lists `status` with
no meaning and no action. Appended to `FIELDS`: *"status: connected; delayed (the bank did not answer, Budget tries again on its
own; when last_synced_at is more than 3 days old, suggest Reset in Bank Connections); login_required (the owner must sign in to
the bank again with Repair, in the app's Bank Connections or on the account's page; an agent cannot do it); broken (cannot be
repaired: the owner removes the connection in Bank Connections and connects the bank again)."* There is no new field.

### EXF-824: a deleted plan unlinks its accounts (Worker)
**Decided: the plan's delete unlinks its linked accounts in the same batch, each with its account history row** (the Lead's
preference). The delete leaves no hidden link, so nothing needs to know about deleted plans. Filtering every "is it linked"
query by live plan would leave the hidden state and every future query would have to remember the filter.
- `deleteBudget` reads `findActive` and `linkedInPlan` (the plan's live accounts with a `bank_account_id`, with the link
  columns, as `linkedToConnection` reads them). When there is at least one, it also reads `accountFacts(db, id)` for the history
  rows' balances. Then **one batch**: the plan's log row, the guarded soft delete, then per account a log row (`update`,
  before → after with `bank_account_id` and `import_start_date` null) and the unlink UPDATE.
- **Atomic, with no retry:** the plan's log row and soft delete hold only while the plan is unchanged **and** no live account of
  the plan is linked other than the (id, bank_account_id) pairs read (`linksAsRead`). Each unlink holds only while its account
  is still linked as read **and** the plan's `deleted_at` equals this delete's time. So a link made between the read and the
  batch makes the whole delete write nothing (`lostRace` → 409), and an unlink never happens without the delete.
- The unlink log rows are built before the plan's row, so none is dated after the plan's delete row.
- **Removing a connection** (`unlinkForConnectionStmts`, `account-links.ts:271`): accounts left linked in plans deleted
  *before* this change are still unlinked, because the removal's guard needs it. They get **no** history row and no balance read.
  Live plans come from `importsRepo.livePlanIds`, read only when there is at least one linked row. Removing a connection
  therefore writes no history row to a deleted plan.
- Out-of-ground file, with the reason: `apps/worker/src/repositories/budgets.ts` (`softDeleteStmt` and `existsUnchanged` take an
  optional extra condition, so the plan's delete can be guarded on `linksAsRead`).

### D1 calls
| Operation | Before | After |
|---|---|---|
| `GET …/accounts` (list) | 5 | 5 (no Worker read changes; `bank-link-calls.test.ts` `MEASURED` unchanged) |
| `GET …/accounts/{id}` | 5 | 5 |
| `DELETE /budgets/{id}`, no linked account | 2 | **3** (`findActive`, `linkedInPlan`, batch) |
| `DELETE /budgets/{id}`, k ≥ 1 linked accounts | 2 | **6** for every k (+3 `accountFacts`); the batch grows by 2 statements per account. Transactions add no call. A lost race adds 1 (`lostRace`). |
| `DELETE /bank-connections/{id}` | 1 + 3 per linked account per attempt (existing) | the same; +1 (`livePlanIds`) when any account is linked; 0 per account of a deleted plan |
| Web: a connected account's page | — | no new request. A non-connected one reads the connections list (4 D1 calls), from the shared cache when it is held. |

### Note 1: the ticket's statuses against the four that exist
| Ticket status | Plaid trigger | Today (`syncStatusForError`, `plaid-import.ts:44-72`) | The person sees |
|---|---|---|---|
| Repair | ITEM_LOGIN_REQUIRED, ITEM_LOCKED, INVALID_CREDENTIALS, ACCESS_NOT_GRANTED, USER_PERMISSION_REVOKED | `login_required` | Connection Repair Needed + Repair |
| Reauthorize | INVALID_MFA, INSUFFICIENT_CREDENTIALS, PENDING_EXPIRATION | `login_required` | Connection Repair Needed + Repair (same update-mode flow) |
| Update | after Reset, until the sign-in finishes | nothing stored: Reset runs the sign-in at once and writes only on success | — |
| Relink / Account Not Found | linked Plaid account missing from the Item | not detected: no code compares the Item's accounts with the links | Connected |
| Imports Delayed | INSTITUTION_DOWN, INSTITUTION_NOT_RESPONDING, PRODUCT_NOT_READY, rate limits, 5xx | `delayed` (every unknown code, network, 5xx) | Imports Delayed (+ the 3-day line) |
| Connection Unavailable | INSTITUTION_NOT_AVAILABLE, INSTITUTION_NO_LONGER_SUPPORTED | `delayed` | Imports Delayed |
| (clone only) | ITEM_NOT_FOUND, INVALID_ACCESS_TOKEN, missing token | `broken` | Connection Repair Needed + Remove |

**Left for a ticket of its own:** Reauthorize, Update, Account Not Found and Unavailable as separate statuses, with their icons,
banners and actions. The copy for each is in EXF-465.

## Out of scope
The ticket's other statuses (note 1), pending transactions (EXF-466), "Learn More" links, the bank's own balance, the nightly
retry (note 4), and the confirmations replacing the modal. The other Build's ground (note 11) is untouched.

## Tests and stand-ins
- Worker: Plaid stubs (`test/plaid-stub.ts`: `plaidError(400, "ITEM_LOGIN_REQUIRED")` → `login_required`), plus direct
  inserts in Worker tests only.
- Browser: `e2e/support/bank-link-stub.ts`. A connection's JSON follows `toApi` (`services/bank-connections.ts:21-53`). An
  account's overlay follows `accountToApi` (`services/accounts.ts:147-148`): `connection_status` is the connection's `status`,
  and `last_synced_at` is the connection's `last_synced_at` (ISO with milliseconds, as `plaid-sync.ts:694` writes it).
  **Extended:** `FakeConnection.created_at?` (default stays `"2030-01-01T00:00:00Z"`), served as `created_at` (`:39`). Times
  are made with `new Date(Date.now() - h*3600_000).toISOString()`. The sign-in uses `stubPlaidLink` (`e2e/support/plaid-stub.ts`):
  `OK` for success, `{ exit: { display_message: null } }` for closed.

### How each "Looking" state is produced (all on a stand-in sandbox plan, account `ZZ Linked` linked to `ZZ Checking`)
1. Connection `login_required`, `last_synced_at` 1 h ago → `/<plan>/accounts/<id>`.
2. As 1, with `stubPlaidLink` closed → `Repair` (the notice). Then a fresh page with `OK` → `Repair` → strip gone, header `Connected`.
3. `delayed` with `last_synced_at` 2 days ago (no strip), and 4 days ago (the 3-day line).
4. `broken`, 1 h ago.
5. Two accounts: `connected` 1 h ago (`Last checked an hour ago`) and `login_required` (Repair): hover with the mouse; then Tab to the mark.
6. `localStorage["sidebar-preferred-width"]="160"` before load (narrow), then the collapse button (rail).
7. As 1 → sidebar `Bank Connections` → the connection → `Repair` with closed (the notice; the scrim behind).

## Acceptance
Each case at 1440×900 unless a size is named. "compare" cases: none (behaviour and layout are not compared: built from the ticket).
1. **login_required strip:** state 1 → under the balances, a strip with the text `Repair your bank connection to continue importing transactions.` and a `Repair` button; the header reads `Connection Repair Needed`.
2. **Repair success:** state 1 with `OK` → click `Repair` → in order, 1 POST `…/link-token`, 1 POST `…/reset`, 1 POST `…/sync`. The strip is gone and the header reads `Connected`.
3. **Repair closed:** state 1 with closed → `Repair` → `The bank sign-in was closed. Nothing was changed.` with `role="status"` (no `alert`), no `reset`, and the strip stays.
4. **24-hour rule:** state 1 with `last_reset_at` 1 h ago → `Repair` is disabled, and its `title` starts with `Reset is available again on`.
5. **broken:** state 4 → the strip reads the broken sentence and has `Open Bank Connections`, with no `Repair`. Clicking it opens the dialog named `ZZ Bank` (the detail) with `Remove`.
6. **delayed:** 2 days ago → no strip. 4 days ago → `Imports have been delayed for over 3 days. Try Reset in Bank Connections.` with no button. Never synced with `created_at` 4 days ago → the line. Never synced with the default `created_at` → no strip.
7. **No strip:** connected, unlinked, and closed accounts, and All Accounts.
8. **Popup by mouse:** state 5 → hovering the connected mark shows the dialog `Connected` with `Last checked an hour ago`. Hovering the login_required mark shows `Repair`; moving onto the popup keeps it open; clicking `Repair` runs case 2's calls.
9. **Popup by keyboard:** Tab to the mark → the popup opens. Tab → its `Repair` has focus. Escape → the popup closes and the mark has focus.
10. **The row still opens the account:** clicking the row's name navigates to the account's page; the popup does not stay open.
11. **Modal notice:** state 7 → the detail shows the closed sentence with `role="status"` and no `alert`.
12. **MCP:** the `list_bank_connections` description contains `login_required (the owner must sign in to the bank again`.
13. **EXF-824:** a plan with one linked account is deleted, then the connection is removed → the removal succeeds and the deleted plan has no change_log row dated after its delete row. This **fails on `b39c8cd`** (the removal writes an `account` `update` row on the deleted plan). After the delete, the account has `bank_account_id` null and has its own history row.
14. **D1 calls:** the counts in the table above, in a counting test.
15. **1024×700:** at states 1, 3 and 4, the strip's button is whole and in the viewport, and its sentence is not cut. At state 5 the popup lies inside the window. At state 6 the mark lies inside its row, and the popup is inside the window.

### Looking (from the brief, word for word)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state (with the browser stand-in in the server's shape), takes a **fresh** screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it (not what a measurement says). The report lists `state, size, file, sentence`. A state without its two entries is PARTIAL with the words "not looked at". **Seven states, fourteen screenshots, every one opened; take no others unless something looks wrong.**

1. An account's page whose connection needs a sign-in: the header's status label and the banner with `Repair`.
2. The same page while the Repair sign-in has just been closed without signing in (the message), and after a Repair that succeeded (no banner, `Connected`).
3. An account's page whose connection is delayed for less than three days, and one delayed for more than three days (the extra line).
4. An account's page whose connection is broken (what the banner offers instead of Repair).
5. The sidebar: the status mark's popup for a connected account (with when it was last checked), and for one that needs a sign-in (with its button), opened by the mouse and by the keyboard.
6. The sidebar at its narrow width and the rail: what the mark and the popup do there.
7. Manage Bank Connections' detail of a connection that needs a sign-in, after this Build's changes to it (the dimmed page behind, the message's look).

## The order of the work (from the brief, word for word)

1. EXF-824 in the Worker: the failing test, the change, the D1 calls.
2. The strip on the account's page for `login_required`, with Repair through the existing flow.
3. The strips for `broken` and for a delay of more than three days.
4. The sidebar mark's popup, by mouse and by keyboard.
5. The modal's two notes (the dimmed page, the notice's look) and the tool's description.
6. The narrow window.

## Departures (existing expectations that change)
- `e2e/bank-link-status.spec.ts:45-52`: `.nav-link-status` `title` → `aria-label` (same three texts). The mark is now a button and drops `title` so it does not cover the popup.
- `e2e/manage-connections-reset.spec.ts:87` (11c), `:211` and `:221` (11e): `getByRole("alert")` → `getByRole("status")`, because a closed sign-in is a notice now. The text is unchanged.

## Found, not fixed
- No nightly self-heal check for `login_required` (note 4; `repositories/bank-connections.ts:157`, `plaid-sync.ts:187`).
- Reset and Remove confirmations replace the modal instead of stacking over it (`manage-connections-dialog.tsx:167-199`).
- Statuses not built (note 1 table).

## Manifest
touches: [apps/web/src/account/AccountHeader.tsx, apps/web/src/account/connection-status-*, apps/web/src/account/account-header.css, apps/web/src/shell/SidebarAccounts.tsx, apps/web/src/shell/bank-link-status.tsx, apps/web/src/shell/connection-status-*, apps/web/src/shell/manage-connections-*, apps/web/src/shell/manage-connections.css, apps/web/src/shell/tokens.css, apps/web/src/api/bank-link.ts, packages/schema/src/connection-status.ts, packages/schema/test/connection-status.test.ts, apps/worker/src/services/budgets.ts, apps/worker/src/services/account-links.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/budgets.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/test/connection-status*.test.ts, e2e/support/bank-link-stub.ts, e2e/connection-status*.spec.ts, e2e/bank-link-status.spec.ts, e2e/manage-connections-reset.spec.ts, docs/connection-status-*.md, docs/README.md]
shared: [apps/web/src/shell/** (SidebarAccounts.tsx: the mark leaves the link; bank-link-status.tsx: clock for delayed; manage-connections-*: notice, initial connection, sentences from the pure file; tokens.css: --calloutStripBackground; new connection-status-mark.tsx and connection-status.css)]
migrations: 0
