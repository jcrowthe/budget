# Register: approve, reject, attention and the new-transactions banner (design)

EXF-463 (its screens), with riders EXF-680, EXF-681, EXF-728 and EXF-760. The Worker half is live (`9e77748`,
`docs/plaid-import-design.md`); this Build is the register's web code. Spec: [register-approve-spec.md](register-approve-spec.md).
Polish list: [register-approve-polish.md](register-approve-polish.md).

## The source app in this Build

The source app is the owner's real account. **This Build compares nothing in the source, and no step opens, reads or
captures it** beyond what the template itself does (the Clerk's step 2 opens the test plan's tab because the
template's source check needs it; that tab is then left alone on the test plan's Plan page; if a later platform check
fails only because that tab is missing, say so in the first line of your answer and go on with your own step).

Reason: the only place in the source where these screens show is the register of a linked account, with the owner's
real transactions on it. The test plan has no linked account and none may be made there. The ticket already holds
what was seen there on 15 Nov, to the pixel (weights, the pill's colours and padding, the tooltips' words, the
banner's sentence), so nothing more needs to be gathered.

**What nobody ever does in the source, each with its reason:**
- **Open any account page of the owner's real plan, including the one linked account page the owner once allowed
  for viewing, or All Accounts there.** Reason: they show the owner's transactions, payees and balances; a screenshot
  or a note of them must never reach the repository, and the ticket's text is enough.
- **Open Add Account, the bank search, Bank Connections or the plan menu.** Reason: they show the owner's banks or
  would start a real bank connection.
- **Approve, reject, categorize, create, edit or delete anything; type into any field; open Reconcile.** Reason: it is
  the owner's account, and a Designer who pressed a button in Reconcile signed the whole session out.
- **Leave the tab changed.** Reason: earlier steps left a size override behind and the next step's check failed.

So every part of this Build is **"not compared: built from the ticket"**, which is a complete and acceptable answer.
The Designer's work is inside the clone: the ticket's measured values, consistency with the register as it is,
tokens only, both window sizes.

**Each step states in its report, for itself only, every action it took in the source app, or that it opened
nothing.** The Architect opened nothing in the source app.

## Source (what the ticket records)

The ticket's "Register display" and "Actions" sections are the specification (weights, the pill's look, the
tooltips' and the banner's words, View's "Unapproved or Uncategorized" chip). No study notes: nothing was opened.

## What is there today (read in the code at `8e54173`; re-read at `9ecd379`)

EXF-461's merge (`9ecd379`) changed no file under `apps/web/src/register/` and neither page; the facts below hold. What it
added around this Build: the account header's connection label (`LinkStatusBadge`, inside `<AccountHeader>`: the
banner still goes above the header), the sidebar's unapproved dot, `connection_status` and `last_synced_at` on the
account read (joined in the same statement), and `e2e/support/bank-link-stub.ts`.


- `RegisterTable.tsx`: columns check, flag, (account), date, payee, category, memo, outflow, inflow, (balance),
  cleared. The pill is `button.needs-category` (opens the row with the category picker open); **no tooltip**. Its CSS
  (`register.css` `.needs-category`): 22 px high, padding 0 8 px, radius 24 px, background `#daac00`, text `#362c05`,
  **12 px, weight 500 (inherited)**. A category cell with a category already has `title` "<Group>: <Category>"
  (`categoryCell(...).text`). The cleared button already has the ticket's tooltip word for word (`CLEARED_TIP`).
- Split cells ("Split (Multiple Categories)..."), split lines' category cells and "Category not needed" have **no
  title** (EXF-680). The open row's Payee input has a `title` only when the row is a locked start (EXF-681). Header
  cells are `overflow: visible` and the sort button has no ellipsis and no title (EXF-728, EXF-760).
- `useApproveReject` posts `transactions/approve|reject` and invalidates every query of the plan. `barActions`
  offers Reject only for `!approved && import_id && source && !transfer_account_id`.
- The register loads **every** row of the account or plan and hides rows in the page (`registerVisible`).

## Approach

### 1. Attention column, bolder rows, the menu
- A new 24 px column right after the checkbox: header `aria-label="Approval"` with an outlined circled "i" in
  `--register-icon-muted`; a cell in **every** row (data, split lines, entry and split-editor rows, scheduled rows)
  and every `colSpan` widened. Always there, in every mode and on every account.
- An unapproved data row (`approved === false`) gets class `is-unapproved` (its split lines too): every cell's text in
  weight 600. Its attention cell holds a button "This transaction needs approval" with the circled "i" 16 px in
  `--actionPrimary` (the accent). Approved rows, split lines, scheduled rows and the entry row: empty cell.
- The button opens the clone's `Popover` (below, width 200, `role="menu"`, label "Approval") with `bulk-list` /
  `bulk-item` entries `Approve Transaction` and `Reject Transaction` (role `menuitem`). Escape and a press outside close
  it (Popover); focus returns to the icon button; Tab reaches the items, Enter/Space choose. The click never selects
  or opens the row (`isControl` already skips buttons).
- Approve: `useApproveReject(budgetId).mutateAsync({ action: "approve", ids: [id] })`, one request. Reject: the same
  with `"reject"`. `Reject Transaction` is enabled under `barActions`' rule for that one row; otherwise
  `aria-disabled="true"` with `title="Only an imported transaction can be rejected"`. On success the menu closes; the
  refetch removes the icon and the weight (approve) or the row (reject). On a refusal the menu stays open with
  `<p role="alert" class="attention-menu-error">` holding `bulkRefusalText(err.detail, () => "This transaction")`
  (other errors: `err.message`).
- Both sides of a transfer are approved together by the server; the refetch shows both.

### 2. The pill and the tooltips
- The pill: 12 px/500 → 14 px/600; height 22, padding 0 8 px, radius 24 px, amber `#daac00` and text `#362c05` kept.
- The pill (row button and split-line span) gets `title` "Assign a category to this transaction so you'll know what
  you spent your money on." Its accessible name stays "This needs a category".
- Category cells (EXF-680, built in part 5): the `td[data-field=category]` gets a `title` with the whole text in
  every case: the split parent, split lines, "Category not needed", payment cells (unchanged). Pill cells keep no
  `td` title (the pill has its own).
- The cleared mark: unchanged (already the ticket's words).

### 3. The banner
- `register/AttentionBanner.tsx`, rendered by the pages **above the account header**: `pages/account.tsx` before
  `<AccountHeader>` (count = `account.needs_attention_count` of the page's own `useAccount` read) and
  `pages/accounts.tsx` before `<AllAccountsHeader>` (count = `attentionTotal(openAccounts)` from `useOpenAccounts`,
  the accounts list the sidebar already loads). No new request.
- A region "New transactions": full width, `--buttonPrimaryBackground`, info icon, `attentionBannerText(n)`, `View`
  at the right (look in the spec). Not rendered at 0 or while the read is pending.
- It follows changes without a reload: every change (`useApproveReject`, `useSaveTransaction`,
  `useBulkTransactions`) already invalidates every query whose key holds the plan id, so `["accounts", plan, id]` and
  `["accounts", plan]` refetch. The count is the server's; nothing is optimistic.
- The count is a plain integer (not an amount): it does not go through the plan formatter.

### 4. View and its chip
- **The page filters the rows it holds**; it does not ask the server with `needs=approval_or_category`. The register
  already holds every row of the account (or plan), so one request serves both views, and the stored View options
  never change. `needsAttention(tx, account, transferAccount)` in `packages/schema/src/attention.ts` is the same rule
  as the Worker's SQL `needsAttention()` (unapproved, or: on-plan account, no category, not Ready to Assign, no split
  lines, not a transfer to an on-plan account, payee not the Starting Balance). A Worker test checks that the helper
  and `?needs=approval_or_category` pick the same ids and that their count is `needs_attention_count`.
- State: `AttentionFilterProvider` (`register/attention-filter.tsx`, `useAttentionFilter(): { on, setOn }`) wraps the
  banner and the register in each page, inside the keyed `SelectionProvider`; leaving the page (or changing account)
  drops it. `View` sets it on; the chip sets it off.
- While on: rows = the loaded rows that `needsAttention`, skipping `registerVisible` entirely (date range and hidden
  reconciled rows do not apply), still sorted by the header sort; on All Accounts only rows of open accounts (the
  banner sums open accounts, so N and the rows agree). `hidden` is 0 (no footer). The Scheduled section is not shown.
  With nothing left the register shows "No transactions"; the chip stays until removed.
- The chip sits in a row between the reconcile bar and the table: text "Unapproved or Uncategorized" with a ×,
  accessible name "Remove filter: Unapproved or Uncategorized".

### 5. Riders and 6. the narrow window
**Why All Accounts' CATEGORY collapses (EXF-760).** In the fixed-layout table every column has a width except
CATEGORY (auto): check 36, flag 42, date 96, cleared 36 px; payee and memo 16 %; outflow and inflow 10 % with a 96 px
minimum. At 1024×700 the table is about 763 px (the EXF-760 measurements sum to 763). On an account register CATEGORY
gets 763 − 210 − 244 − 192 = 117 px (measured 118). All Accounts adds ACCOUNT at 10 % (76 px) and nothing gives way,
so CATEGORY, the only auto column, absorbs it all: 763 − 210 − 76 − 244 − 192 = 41 px (measured 41). The 96 px amount
minimums already take 40 px more than their 10 %.

**Widths below 1280 px** (the existing media query; the table gets `has-account` on All Accounts). Expected at
1024×700 (table ≈ 763 px; the Implementer measures and records the real numbers, ±2 px):

| State at 1024×700 | Rule (payee, memo) | Attention | CATEGORY today → after |
|---|---|---|---|
| Account, defaults | 16 % → **14 %** (107 px each) | 26 | 118 → 122.1 measured |
| Account, BALANCE on | 13 % → **9.5 %** (73 px each) | 26 | 67 ("CATEGOR") → 94.8 measured (10 % gave 87.2 with the 26 px column) |
| Account, flags off | 16.6 % (unchanged) | 26 | ~150 → 124.4 measured |
| Account, flags off, BALANCE | 13 % → **11 %** (84 px each) | 26 | ~110 → 113.9 measured |
| All Accounts, defaults | 16 % → **10 %** (76 px each) | 26 | 41 → 106.8 measured |
| All Accounts, flags off | 16.6 % → **12 %** (92 px each) | 26 | ~74 → 118.3 measured |

So the new column and the riders' room come from **payee and memo only**; date, amounts, balance, account, flag and
cleared keep their widths. At 1440×900 the media query does not apply: the only change there is CATEGORY giving the
attention column its 24 px. With scheduled rows (date 112 px) CATEGORY is 16 px narrower than the table says.

**Headers (EXF-728, EXF-760).** Header cells clip; each header's label is cut with an ellipsis and carries its
word in `title` (sort buttons and BALANCE). Prefer whole (the widths above); none runs under its neighbour.

**EXF-680:** the titles of part 2. **EXF-681:** `PayeeField` passes `title ?? (value.name || undefined)`, so the open
row's Payee input carries its whole text (added and edited rows, transfers, card payments, both pages); locked starts
keep their lock title.

## Downstream effects

- One more cell per row: position-based test locators shift by one (departures below). Payee and memo are narrower
  below 1280 px (cut with ellipsis and their existing title). No Worker or shared-module change, no migration, no
  new request.

## Reconcile mode, scheduled rows, closed accounts

- **Reconcile mode:** column, icon, menu and banner stay and work; while View is on only the attention rule applies.
- **Scheduled rows:** no icon (empty cell), never bold; the Scheduled section is hidden while View is on.
- **Closed account:** its page shows the banner when its count > 0; View, icon and menu work (a refusal shows in the
  menu). All Accounts counts open accounts only and lists only their rows while View is on.

## Unapproved rows in the specs

Real rows through the API: `POST …/transactions` with `approved: false` (the create schema accepts it). The server
counts them, so the banner, Approve, the bar and the pill's save are real end to end. The Plaid stand-in
(`e2e/support/plaid-stub.ts`) cannot make one: it only answers the browser's institutions and bank-connections calls
and runs no sync. Nor can EXF-461's `e2e/support/bank-link-stub.ts`: its "sync" writes no row; it only lays a made-up
`unapproved_count` over the browser's account reads (not `needs_attention_count`), so the counts would disagree with
the rows. This Build's specs do not use it. **Reject** needs an `import_id`, which no API sets: as in `e2e/register-bulk.spec.ts`, `rewriteList`
marks the row imported in the browser, and the spec's `page.route` for `POST …/transactions/reject` deletes the row
through the server's API (`DELETE …/transactions/{id}`) and answers 200; the refusal case answers 409. Nothing writes
the database from outside the server.

## D1 calls

Measured with the counting `env` of `register-view-calls.test.ts` (a throwaway copy, 10 and 100 rows; pinned by the
new `apps/worker/test/attention-calls.test.ts`):

| Read or write the screens call | D1 calls (10 rows, 100 rows) |
|---|---|
| `GET accounts/{id}/transactions?include=running_balance` (the register) | 5, 5 (also 5 for 1,000 rows: `register-view-calls.test.ts`) |
| same with `needs=approval_or_category` (not called by the screens) | 5, 5 |
| `GET transactions` (All Accounts) / with `needs=…` | 4, 4 / 4, 4 |
| `GET accounts` / `GET accounts/{id}` (banner counts) | 5, 5 / 5, 5 (unchanged by `9ecd379`'s join: `bank-link-calls.test.ts` pins list 5, get 5) |
| `POST transactions/approve`, 1 row and 99 rows | 6, 6 (7 with transfers: `bulk-call-count.test.ts`) |
| `POST transactions/reject`, 1 row and 99 rows | 4, 4 |

## Out of scope / known issues

- Undo of a reject: EXF-530 is not built; a reject cannot be undone in this Build (criterion 5's Undo).
- The sidebar's white dot (criteria 1 and 8): merged with EXF-461 (`9ecd379`, `shell/SidebarAccounts.tsx`
  `.nav-unapproved-dot` from the accounts list's `unapproved_count`; its spec is `e2e/bank-link-status.spec.ts`). Not
  this Build's to change; it follows an approve or reject here through the same invalidation of `["accounts", plan]`.
- Matching and unmatching (EXF-464), pending transactions (EXF-466), connection status and Repair (EXF-465).
- The split editor's "Amount remaining to assign" line: looked at in a Euro plan (case 15), not changed.

## Acceptance

Sizes 1440×900 and 1024×700 unless a case says otherwise. Every case: "not compared: built from the ticket".
Seeds: a plan with ZZ Checking (on plan), ZZ Savings (on plan), a category group "ZZ Group" with "ZZ Food"; three
rows with `approved: false` in ZZ Checking (two with ZZ Food, one without a category) and two approved rows.

1. **Column and weight.** Open ZZ Checking. The three unapproved rows each show a button "This transaction needs
   approval" in the column after the checkbox; approved rows show nothing there; the header cell has the info icon.
   Unapproved rows' cells compute `font-weight: 600`, approved rows' 500.
2. **Menu.** Click a row's icon: a menu "Approval" with `Approve Transaction` and `Reject Transaction`; the row is not
   selected. Escape closes it and focus is on the icon; a click outside closes it.
3. **Approve.** On a categorized unapproved row choose `Approve Transaction`: exactly one POST `…/transactions/approve`
   with that id; the icon goes, the row is 500; the banner reads "2 new transactions to approve or categorize."
4. **Reject.** On an imported unapproved row (the rewrite above) choose `Reject Transaction`: one POST
   `…/transactions/reject`; the row disappears and the banner count drops by one. On a non-imported row the entry is
   disabled with the title "Only an imported transaction can be rejected". A 409 answer leaves the menu open with the
   refusal in an alert.
5. **Pill.** The uncategorized row shows the pill: background `rgb(218, 172, 0)`, text `rgb(54, 44, 5)`, 14 px, 600,
   padding-left/right 8 px, radius ≥ half its height; `title` = "Assign a category to this transaction so you'll know
   what you spent your money on.". A categorized cell's title is "ZZ Group: ZZ Food". The cleared button's title is
   "Marking a transaction as 'cleared' means it has posted to your bank account."
6. **Pill saves and approves.** Click the pill, choose ZZ Food: the row has the category, no icon, weight 500; the
   API row is `approved: true`; the banner drops by one; no reload.
7. **Banner.** Account page: "3 new transactions to approve or categorize." with `View`, above the account header,
   full width. One row left: "1 new transaction to approve or categorize."; none: no banner. All Accounts with two
   unapproved rows in ZZ Checking and one in ZZ Savings: "3 new transactions…". Loading either page makes no
   `needs=` request and no request the page did not make before this Build (compare the network log).
8. **View.** Set View options to "This Month" with a needing row dated three months ago and a reconciled unapproved
   row hidden by Show Reconciled off. Click `View`: exactly the rows that need attention are listed (both of those
   included; N equals the row count), no Scheduled section, no "hidden by filters" footer, and the chip "Unapproved or
   Uncategorized". The stored View settings are unchanged (API). Remove the chip: the earlier rows return. Reload or
   leave and come back: the filter is off.
9. **Bulk.** Tick the three unapproved rows: the bar shows `Approve` and (with imported rows) `Reject`; `Approve`
   approves all three (API), the icons go, the banner goes when none needs a category.
10. **Modes.** In reconcile mode the column and banner stay and the menu approves. A scheduled row has an empty
    attention cell. A closed account with an unapproved row shows the banner.
11. **EXF-680** (1024×700, All Accounts and ZZ Checking): a split, its lines and both sides of a transfer between two
    on-plan accounts: each cut category cell (`scrollWidth > clientWidth`) has `text-overflow: ellipsis` and a `title`
    with its whole text.
12. **EXF-681** (1024×700): open a transfer row on ZZ Checking and a card payment row on a credit card; with the
    Payee input not focused and cut, its `title` equals its value.
13. **EXF-728** (1024×700, ZZ Checking): defaults, BALANCE on, flags off: every `th` and header button is whole
    (`scrollWidth ≤ clientWidth`) or has `text-overflow: ellipsis` and a `title` with the whole word; CATEGORY is whole
    with BALANCE on; the page does not scroll sideways.
14. **EXF-760** (1024×700, All Accounts, defaults and flags off): as 13, plus CATEGORY ≥ 88 px wide and a category
    cell shows "ZZ Group:" whole; no header's right edge passes its cell's. At 1440×900 every header is whole.
15. **Euro plan** (`EUR`, `123.456,78`, symbol after, `DD.MM.YYYY`): state 1 of "Looking" looks the same with the
    plan's amounts and dates. The Tester reports what the split editor's "Amount remaining to assign" line shows.

### Looking

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh**
screenshot in this Thread (not a file a spec or an earlier step wrote), opens it, and writes one sentence on what is
seen in it. The report lists `state, size, file, sentence` for every one. A state without its two entries is PARTIAL
with the words "not looked at". "A spec is green" is not looking.

The states:
1. An account's register with three unapproved rows, one of them without a category: the banner "3 new transactions
   to approve or categorize." with `View`; the attention column with a circled "i" on those rows and nothing on
   approved rows; the unapproved rows bolder than the others; the amber pill "This needs a category".
2. The pill's tooltip; the circled "i" pressed, its menu open (`Approve Transaction`, `Reject Transaction`).
3. After Approve Transaction on a row that has a category: no icon, normal weight, the banner at 2.
4. After `View`: only the rows that need attention, and the chip that removes the filter; after removing it.
5. One row left ("1 new transaction to approve or categorize."); none left (no banner).
6. All Accounts with the banner counting the rows of two accounts.
7. Three unapproved rows ticked: the bar with `Approve` and `Reject`.
8. At 1024×700 only: the states of EXF-680, EXF-681 and EXF-728 (a cut split or transfer category cell; an open
   row's cut Payee field; the headers with the BALANCE column on), each with its tooltip showing; and All Accounts
   with its headers and category cells (EXF-760).
9. In a Euro, `123.456,78`, After amount, `DD.MM.YYYY` plan: state 1.

## The order of the work

1. The attention column, the bolder rows and the menu with Approve and Reject.
2. The pill's look and the tooltips.
3. The banner on both pages.
4. View and its chip.
5. The four riders with their specs.
6. The narrow-window spec for the whole register with the new column.

The Implementer commits after each part.

## Departures (existing tests whose expectation changes)

The new column shifts cell positions by one; each edit changes only the index:
- `e2e/all-accounts.spec.ts` lines 68, 69, 79: `td:nth-child(5)` → 6, `td:nth-child(3)` → 4 (twice).
- `e2e/register.spec.ts` line 34: `td:nth-child(4)` → 5.
No other expected text changes. `e2e/register-entry.spec.ts:286` (`td` nth 3) now clicks the date cell instead of the
payee cell; its assertions hold unedited.

## Manifest

touches: [apps/web/src/register/**, apps/web/src/pages/account.tsx, apps/web/src/pages/accounts.tsx, packages/schema/src/attention.ts, packages/schema/test/attention.test.ts, apps/worker/test/attention-calls.test.ts, e2e/register-approve*.spec.ts, e2e/register-attention*.spec.ts, e2e/support/approve-seed.ts, e2e/all-accounts.spec.ts, e2e/register.spec.ts, docs/register-approve-design.md, docs/register-approve-spec.md, docs/register-approve-polish.md, docs/README.md]
shared: []
migrations: 0
