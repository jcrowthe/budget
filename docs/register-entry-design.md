# Register entry design (EXF-517, EXF-507)

Add and edit transactions inline in the register, with a `payees` table, the payee picker, the category
dropdown, date keys and amount arithmetic. One Build, two tickets. Spec: [register-entry-spec.md](register-entry-spec.md).
The Lead's scope notes override the tickets where they differ.

## Source

**Not studied live: forbidden by the Lead for this Build** (the source's test plan has no open account, so the
add row could only be seen by changing the owner's account). The two tickets, written by discovery from the live
source, are the specification; no screenshot of the source is kept, and nobody in this Build opens it. Every
"compare" below is against the ticket text and the clone's own look (`apps/web/src/register/`, the popovers of
`apps/web/src/plan/`, `apps/web/src/shell/tokens.css`).

The tickets' observed behaviour is restated, as built, in the Approach below; where the clone decides something
the tickets leave open (Enter in an open list, Escape, negative amounts, blank calendar cells) it says so.

## Approach

### Data: payees (EXF-507)

New table `payees`: `id` TEXT PK, `budget_id`, `name`, `hidden` (0), `system` (`starting_balance` |
`manual_adjustment` | `reconciliation_adjustment` | NULL), `created_at`, `updated_at`, `deleted_at`.
`transactions.payee_id` TEXT NULL is added. One migration, `apps/worker/migrations/20261116100100_payees.sql`
(sorts after `20261116100000`).

- **Names compare exactly, case-sensitive, after trimming.** Unique per plan among non-deleted, non-system
  payees (partial unique index `payees_budget_name`); one system payee per kind per plan (partial unique index
  `payees_budget_system`). Why case-sensitive: the ticket saves typed text "exactly as typed", and the backfill
  must keep each existing row's text unchanged, which a case-insensitive merge of "ACME"/"Acme" would break. The
  picker matches case-insensitively, so `d4 corner` + Tab still picks "D4 Corner Market" and near-duplicates
  only arise from typing a full different-case name over the create item.
- **System payees** never match a typed name: a user payee named "Starting Balance" is ordinary and distinct.
- **Backfill** (in the migration, idempotent: `WHERE NOT EXISTS` / `WHERE payee_id IS NULL`): per plan, one
  system payee `starting_balance` (name "Starting Balance") when any row has that text; one ordinary payee per
  other distinct non-empty `payee_name` (deleted transactions included: a payee outlives its transactions);
  every row with text gets its `payee_id` ("Starting Balance" text → the system payee). Ids are v4-shaped from
  `randomblob`. No `change_log` rows (a migration has no actor, as `20261116100000` did).
- `transactions.payee_name` stays as a column: every writer keeps it equal to the payee's name at write time (a
  rollback of the Worker still shows names). **Reads take the name from the payee**
  (`coalesce(payees.name, transactions.payee_name)`), so a later rename (EXF-510) shows everywhere.

### The Starting Balance rule

Today `activityByMonth`, the service's lock (`isCreditStartingBalance`) and the web's `categoryCell` recognise a
credit Starting Balance by the payee **text**. They now recognise `payees.system = 'starting_balance'` (with no
category, no Ready to Assign flag, credit type, as before). Behaviour is unchanged for every existing test; a
payee-less credit transaction still counts (null-safe `coalesce(p.system,'')`).
- `addUnlinkedAccount` (`services/accounts.ts`) links the new Starting Balance to the plan's system payee, inserting
  it in the same batch when missing (`INSERT … WHERE NOT EXISTS`, with its own guarded `change_log` row), and the
  transaction's `payee_id` is a subquery on the system payee, so two racing account creates share one.
- **Removed:** the 422 "This payee name is reserved" refusal on credit accounts. A typed "Starting Balance" on a
  credit card is an ordinary payee; its uncategorised row counts as uncategorised activity and shows "This needs
  a category".
- Reads gain `payee_id` (on `Transaction`) and `payee_system` (on `TransactionDetail`), so the web can lock the
  credit Starting Balance's payee and category and draw "Category not needed" by the system payee.

### API and MCP

- `GET /api/v1/budgets/{budget_id}/payees?q=&include_hidden=` → `{ data: { payees: Payee[] } }`, `Payee` =
  `{ id, name, hidden, system, last_category_id }`. Non-deleted payees, system ones included (marked), hidden only
  with `include_hidden=true`; `q` = case-insensitive substring (JS `toLowerCase`); sorted case-insensitively by
  name, then name, then id. `last_category_id` = the `category_id` of the payee's latest non-deleted transaction
  (date desc, created_at desc, id desc), null when that row has none or its category is deleted.
- Transaction create and update accept `payee_id` (string | null) or `payee_name` (string | null), not both
  (422). `payee_name` trimmed; empty → no payee; an exact match among the plan's non-deleted non-system payees
  (hidden included) is used; otherwise a payee is created **in the same batch** as the transaction with its own
  `change_log` row (`entity_type 'payee'`, `action 'create'`). `payee_id` must be a non-deleted payee of the plan
  (422 "Payee not found in this plan"); a system payee is refused (422 "System payees are set by the app") unless
  it is the row's current payee. A unique-index race retries (the retry finds the payee). On update the new
  payee's insert and log are guarded by the same `holds(before)` as the update.
- MCP `list_payees` (new file `mcp/tools/payees.ts`) calls the same service. `create_transaction` and
  `update_transaction` take their inputs from the schemas, so `payee_id` and `payee_name` reach them; the
  fields carry `.describe()` text in `packages/schema/src/transactions.ts`. **`mcp/tools/transactions.ts` is
  edited only if EXF-572 is on main** (folder `apps/worker/test/mcp-coverage/` exists at rebase): then add
  `apps/worker/test/mcp-coverage/payees.test.ts` per `docs/conventions.md` and update the two descriptions;
  otherwise leave the file alone and say so in the report.
- `transfer_account_id` is EXF-526: not here.

### Web: the entry row (EXF-517)

All in `apps/web/src/register/`; pure logic in `packages/schema/src/` with unit tests.

- **Opening.** `Register` owns `open: null | { mode: "add" } | { mode: "edit", id, focus, openCategory? }`.
  "Add Transaction" and `shift+N` (document keydown; not when focus is in an input, textarea, select or
  contenteditable, nor while an `[aria-modal="true"]` element exists; no Ctrl/Meta/Alt) open the add row. Opening
  a row closes any open one without saving.
- **Add row** is the first body row, whatever the sort, with its checkbox ticked: (All Accounts: account),
  date, payee, category (absent on a tracking account's register), memo, outflow, inflow, cleared icon
  (uncleared, toggles the draft, not tabbable). A second row under it, right-aligned: "Cancel" (subtle), "Save"
  and "Save and add another" (primary); an inline message area at its left. Focus starts in the date field with
  its text selected and the calendar open; in All Accounts it starts in the account field with its list open.
- **Keys in the row.** Tab/Shift+Tab follow the field order, then the buttons. Enter in an input: if it is a
  picker whose list is open and whose text was typed or arrow-moved since opening, it picks the highlighted item
  only; otherwise it saves (add: Save and add another; edit: Save). Escape anywhere in the row cancels it (add:
  discard; edit: close with the old values).
- **Date field** (placeholder none, text `MM/DD/YYYY`): the keys of EXF-517 act on the field's date (the parsed
  text, else the last valid date, else today) and replace the text; any other key types. On blur the text is
  parsed (`parseEntryDate`) and reformatted, or left as typed when it does not parse. The **calendar** opens
  while the field has focus: title `Nov 2026`, ‹ › (aria-labels "Previous month", "Next month"), `Su`…`Sa`
  header, day buttons (blank cells outside the month), today ringed, the field's date filled; clicking a day sets
  it and keeps focus in the field. No "Repeat" select (EXF-497).
- **Payee field** (placeholder "payee"): a combobox over the plan's payees (one query, hidden included, filtered
  client-side by `payeeMenu`).
  - Nothing typed: header "Saved Payees", the visible non-system payees alphabetically, or the hint "Start typing
    to add a payee." when there are none.
  - Typed text: top item `Create "<text>" Payee` with a plus icon, or `1 matching payee is hidden` /
    `N matching payees are hidden` when the text exactly equals hidden payees' names; under the create item the
    line `"<text>" will be created as a payee.` when no saved payee matches; then "Saved Payees" filtered by
    case-insensitive substring. The first match is highlighted, else the top item.
  - Tab or Enter picks the highlighted item: a saved or hidden payee sets `{id, name}`; the create item keeps the
    text (`payee_name`, created on save). Picking a payee whose `last_category_id` is set fills an **empty**
    category. Clicking an option picks it. Editing the text after a pick drops the id.
  - Footer "Manage Payees", drawn disabled (`aria-disabled`, `data-ticket="EXF-510"`). No "Payments and
    Transfers" section (EXF-526). System payees never listed.
- **Category field** (placeholder "category"): `CategoryField.tsx`, our own (not the plan's picker). Data: the
  month read model (`useMonth` from `api/months.ts`, read only) for the month of the draft date (today when it does
  not parse). List: group "Inflow" with "Ready to Assign" and the month's `ready_to_assign`; then every group
  (hidden included) with its categories and Available, coloured like `.picker-available`. Search
  (`categoryMenu`): case-insensitive substring on category or group name; a matching group lists all its
  categories; no match → "No categories found with that name." First match highlighted; Enter or Tab picks;
  blur without a pick restores the shown value. The value shows as `<Group>: <Category>` or
  `Inflow: Ready to Assign`. Footer buttons "Payment/Transfer" (EXF-526) and "Split" (EXF-524) drawn disabled.
  No "New Category" or `Create "<text>" Category`. In All Accounts, a tracking account chosen in the account
  field empties and disables the category field.
- **Account field** (All Accounts only, placeholder "account"): the open accounts in sidebar order
  (`sidebarSections` sections cash, credit, loans, tracking), filter by substring, Tab/Enter picks.
- **Amount fields** (placeholders "outflow", "inflow"): on focus a calculator icon at the left; typing a
  non-empty value in one clears the other; on blur `evaluateAmountEntry` gives milliunits ≥ 0 shown with
  `formatAmountEntry` (`1,234.50`), or empty for `abc`, `0`, a zero result or division by zero. A negative
  result keeps its absolute value in the same field (`-5` in Outflow → `5.00` in Outflow). Saving evaluates the
  texts itself, so Enter without a blur is right. Stored amount = inflow − outflow.
- **Saving.** Add → `POST …/transactions` with `cleared` from the draft (default `uncleared`), `approved: true`,
  `memo` (trimmed, empty → omitted), payee (`payee_id` | `payee_name` | none), `category_id` or
  `inflow_to_ready_to_assign: true`. Edit → `PATCH` with only changed fields. A date that does not parse refuses
  with "Enter a date like 11/15/2026." (role alert) and focuses the date; in All Accounts no account refuses with
  "Choose an account.". Nothing else blocks: an empty row saves as $0.00 with no payee. While saving, the buttons
  are disabled; a failure shows `Couldn't save the transaction. <detail>` and keeps the draft. On success every
  query whose key includes the plan id is invalidated (transactions, `["accounts", budgetId]`,
  `["account-summary", budgetId]`, `["month", budgetId, …]`, `["payees", budgetId]`), as `useSetCleared` does.
- **Editing.** A click on a row's cell selects only that row; a click on a row that is already selected, or a
  double-click on any row, opens it in edit mode with focus in the clicked cell's field (the checkbox, cleared
  button and pill keep their own clicks). Buttons "Cancel" and "Save". A reconciled row never opens. A credit
  account's Starting Balance (`payee_system === "starting_balance"`, credit type) opens with payee, category and
  (All Accounts) account disabled, titled "A credit account's Starting Balance keeps its payee and category.".
- **The pill** "This needs a category" becomes a button: it opens that row in edit mode with the category field
  focused and its list open.
- **Dropdowns and the calendar** render in a portal on `document.body` (`register/Dropdown.tsx`), `position:
  fixed`, below the field or above it when there is no room, height capped to the window, z-index above the
  sticky toolbar, re-placed on scroll and resize; options take `mousedown` with `preventDefault` so the field
  keeps focus. Every option must be the topmost element at its centre (`document.elementFromPoint`), also at
  1024×700 and for a row near the bottom.

### Look

Edit row background `--register-row-selected`; inputs 28px tall, `--inputBackground`, 1px `--inputBorder`,
radius `--radius-xs`, focus ring 1px `--actionPrimary`; dropdown/calendar like `.popover`
(`--backgroundSecondary`, `--shadowMenu`, `--radius-lg`), option hover `--menuHover`, active option
`--sidebarActive`, headers 12px/600 uppercase `--labelSecondary`. New custom properties, in `register.css` only:
`--register-entry-row: var(--register-row-selected)` and `--register-today-ring: var(--actionPrimary)`. New icons
in `register/icons.tsx`: `CalculatorIcon`, `ChevronLeftIcon`, `ChevronRightIcon` (PlusCircleIcon exists).

## Downstream

- EXF-526 adds transfer payees, the "Payments and Transfers" section, `transfer_account_id`, and wires
  "Payment/Transfer". EXF-524 wires "Split". EXF-510 wires "Manage Payees", hiding and renaming payees (rename
  must keep `transactions.payee_name` in step or stop writing it). EXF-463 adds the attention column, the amber ⓘ
  and the banner, and "Approve" in place of Save on unapproved rows. EXF-497 adds the calendar's Repeat select.
  EXF-486 and EXF-533 create the other two system payees through `payeesRepo.systemPayee…`.

## Out of scope

Transfers, splits, Manage Payees, creating categories from the dropdown, the attention column and banner,
repeat, approving, remembered-category settings (EXF-515), undo (EXF-530).

## Acceptance

Compare cases: **not compared: forbidden by the Lead; the tickets are the specification.** Clone only, e2e
server, dark theme, 1600×900 unless stated. "Seed" = a ZZ-TEST plan with a
checking account "ZZ Checking" ($2,500.00 on 11/01/2026), a credit card "ZZ Card" ($1,500.00 owed), a tracking
asset, a group "D4 Register" with category "D4 Groceries" assigned $200.00 in Nov 2026.

1. (517) On ZZ Checking, focus the page body, press Shift+N. A row appears above the others with its checkbox
   ticked, the date field focused showing today's local date `MM/DD/YYYY` fully selected, and a calendar titled
   with the current month (`Nov 2026`) with ‹ ›, `Su`…`Sa` and today ringed. Shift+N typed inside the memo field
   types "N". The "Add Transaction" button opens the same row.
2. (517) In the date field type `11/15/2026`, then press `m` → `11/01/2026`; retype, `M` (Shift+M) → `11/30/2026`;
   `y` → `01/01/2026`; `r` → `12/31/2026`; `Y` → `12/31/2026`; from 11/15: `-` `-` → `11/13/2026`; `+` `+` →
   `11/17/2026`; `=` → next day; `↓` → +7 days; `↑` → −7; `t` → today. Typing `11/3` and Tab → `11/03/<this year>`;
   `1/2/27` → `01/02/2027`; `3` → `03/01/<this year>`; `garbage` stays, and Save shows "Enter a date like
   11/15/2026." and creates nothing. Clicking ›, then a day, sets that day.
3. (517, 507-2) Type `D4 Corner Market` in payee: the list shows `Create "D4 Corner Market" Payee` highlighted and
   `"D4 Corner Market" will be created as a payee.`; Tab keeps the text. Choose D4 Groceries, outflow 10, Save. In
   a new add row, type `D4 Cor`: "D4 Corner Market" is listed under Saved Payees and highlighted; Tab picks it and
   the empty category shows `D4 Register: D4 Groceries`. `GET …/payees` lists it once.
4. (517) In the category field type `d4 gro` → "D4 Groceries" listed and highlighted; `zzzz` → "No categories
   found with that name."; `d4 reg` lists every category of D4 Register; `inflow` lists Ready to Assign with the
   month's amount. Footer "Payment/Transfer" and "Split" are disabled.
5. (517) Outflow `12.34+5` then Tab → `17.34`; saved, the API row has `amount: -17340`. Table: `100/4`→`25.00`,
   `3*2.5`→`7.50`, `10-2.5`→`7.50`, `(2+3)*2`→`10.00`, `1,234.5`→`1,234.50`, `5+`→`5.00`, `-5` in outflow →
   `5.00` in outflow, `abc` and `0` → empty. Typing in inflow empties outflow. A focused amount field shows the
   calculator icon.
6. (517) Enter in the memo saves the row and opens a new add row with the same date, focus in the date. "Save"
   saves and closes. "Cancel" and Escape discard (row count unchanged, no POST).
7. (517) Save an untouched add row: a row with today's date, no payee, outflow and inflow empty ($0.00) and the
   amber pill "This needs a category" appears; `cleared` is `uncleared`, `approved` true. Clicking the pill opens
   the row with the category list open and focused.
8. (517) Double-click the 17.34 row's outflow: the row opens with focus in outflow. Type `20`, Enter: the row
   shows 20.00, Working Balance drops by 2.66 more, and the sidebar's ZZ Checking balance matches, without a
   reload. Escape on an edited row restores the old values. A single click on an unselected row ticks only it;
   a second click opens it. A reconciled row (set via DB in a Worker test; via the API it cannot be) never opens.
9. (517) REST `POST`/`PATCH` and MCP `create_transaction`/`update_transaction` with the same input give the same
   rows; each writes `change_log` rows with its actor (`user:…`, `mcp:…`), and a new payee adds a `payee` row in
   the same batch.
10. (Lead) On All Accounts, Add Transaction: the account field is first and focused with the open accounts in
    sidebar order; pick ZZ Checking, outflow 5, Save: the row shows `ZZ Checking` in ACCOUNT and appears in ZZ
    Checking's register. A tracking account picked disables the category.
11. (Lead) After saving a D4 Groceries outflow of 10.00 on an account page, the sidebar balance is lower by 10.00,
    and the Plan page for that month shows D4 Groceries Activity −10.00 and Available 190.00, without a reload.
12. (507-4) With a payee "ZZ Hidden" set `hidden = 1` (Worker test via DB; e2e via the helper in the spec, or
    noted as covered by the unit test of `payeeMenu` if the local D1 cannot be written while serving): it is not
    listed; typing `ZZ Hidden` shows `1 matching payee is hidden`; picking it and saving stores that payee's id,
    and it stays hidden.
13. (507-5) Typing `Start` offers only `Create "Start" Payee`; no system payee is ever listed; the API lists the
    system payee with `system: "starting_balance"`.
14. (507-7) Migration backfill (Worker test re-running the migration's INSERT/UPDATE statements on rows written
    with `payee_id` NULL): text kept on reads; one payee per distinct name per plan; "Starting Balance" rows point
    at the plan's single system payee; credit-account Starting Balance tests pass unchanged; the old reserved-name
    test now expects 201 and the row counts as uncategorised activity.
15. (507-8) `GET …/payees` and MCP `list_payees` return the same payees for the same `q`/`include_hidden`;
    `apiPaths()` contains `/api/v1/budgets/{budget_id}/payees` and `listedToolNames()` contains `list_payees`.
16. (Lead) Mouse: for the payee list, category list, account list and the calendar, the e2e test moves the mouse
    to an option's centre, checks `document.elementFromPoint` is that option (or inside it), and clicks with
    `page.mouse`: at 1600×900, at 1024×700, and with the edited row the last row of a 25-row register scrolled to
    the bottom (the list opens above). Nothing is clipped.
17. (517) A credit card's Starting Balance opens with payee and category disabled; changing its outflow saves.

## Manifest

touches: [apps/worker/migrations/20261116100100_payees.sql, apps/worker/src/db/schema/payees.ts, apps/worker/src/db/schema/transactions.ts, packages/schema/src/payees.ts, packages/schema/src/transactions.ts, packages/schema/src/register.ts, packages/schema/src/date-entry.ts, packages/schema/src/amount-entry.ts, packages/schema/test/payees.test.ts, packages/schema/test/register.test.ts, packages/schema/test/date-entry.test.ts, packages/schema/test/amount-entry.test.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/services/payees.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/accounts.ts, apps/worker/src/routes/payees.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/payees.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/test/payees.test.ts, apps/worker/test/payees-migration.test.ts, apps/worker/test/transactions.test.ts, apps/worker/test/accounts.test.ts, apps/worker/test/mcp-coverage/payees.test.ts, apps/web/src/register/**, apps/web/src/api/transactions.ts, apps/web/src/api/payees.ts, e2e/register-entry.spec.ts, e2e/payee-picker.spec.ts, e2e/support/d1.ts, e2e/register.spec.ts, e2e/all-accounts.spec.ts, docs/register-entry-design.md, docs/register-entry-spec.md, docs/README.md]
shared: []
migrations: 1
