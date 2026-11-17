# Activity popover design (EXF-509, with EXF-720 and EXF-714)

Three tickets in one Plan-page Build:

- **EXF-509**: an ordinary category's Activity amount opens a popover that lists the transactions behind it for the
  viewed month. A new read backs it: REST `GET /api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/transactions`
  and the MCP tool `list_category_transactions`.
- **EXF-720**: the `Got it!` button of the "Using Credit Cards" dialog gets the app's primary button style.
- **EXF-714**: three tests for the "one ticked category vs a view that holds one" rule of Auto-Assign. Tests
  only; no behaviour changes.

Spec: [activity-popover-spec.md](activity-popover-spec.md). The Designer's list will go in `activity-popover-polish.md`.

## The source app in this Build

The source app is the owner's real account. The only plan anyone may open is the test plan at
`https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`.

**What may be looked at:** the test plan's Plan page. If a category row there has a non-zero Activity amount,
a click on it opens the source's Activity popover. It may be measured and captured, then closed with its Close
button or Escape. If no row has activity in the month shown, the month arrows may be used to look for one (a
month switch saves nothing). If none is found, the popover is "not compared: built from the ticket", and that is
a complete and acceptable answer.

**What nobody ever does in the source, each with its reason:**
- **Create, edit or delete anything (an account, a transaction, a category, a target, an assigned amount), or
  type into any field.** Reason: it is the owner's account. One Designer who made accounts "to have something to
  compare" went through screens the owner has not released.
- **Press a button that saves or moves on in a flow (Next, Finish, Save, Create, Assign, any Auto-Assign
  option).** Reason: a Designer pressed Next in a source flow and the whole session signed out 31 seconds later.
  Every Build stopped until the owner signed in again.
- **Open an account's page, the plan menu, Bank Connections, Reflect, settings, or any other plan.** Reason:
  they show the owner's data or are not released, and nothing of this Build is there.
- **Leave the tab changed:** a size or theme override is set back, a ticked row is unticked, and the tab ends on
  the test plan's Plan page. Reason: two earlier Designers left the tab at a wrong size, and the next step's check
  then failed.

The "Using Credit Cards" dialog and the Auto-Assign card with a payment row cannot be shown by the source's test
plan, because it has no credit card. **Nobody looks for them there.** The `Got it!` button takes the app's own
primary button style.

**Each step states in its report, for itself only, every action it took in the source app (clicks and overrides
included), or that it opened nothing.**

## Source

Study notes: `/workspace/scratch/source/activity-popover/notes.md`, with the raw CSS rules in
`source-css-popover.txt` and screenshots `00-start.png`, `01-hover-zero-activity.png`,
`02-plan-zero-activity-{1440x900,1024x700}.png` and `03-final.png`. They hold the Architect's study agent's full
action log: a hover on one $0.00 amount, month arrows Oct ↔ Dec 2026 and back to Nov, and a CDP viewport override
at 1440×900 and 1024×700 that was cleared afterwards. The tab was left on the test plan's Plan page,
`/budget/202611`.

- **Popover: not compared, built from the ticket.** Every month the test plan allows (Oct to Dec 2026) has $0.00
  Activity on every row, so no popover could be opened.
- **Observed in the Activity cell.** The amount is a `<button>` with a native `title` of the form
  `(<amount>) View this category's monthly activity. <flourish>`, cursor pointer. A zero amount gets
  `aria-disabled="true"` and cursor default. Category amounts are 14px/500 in `labelSecondary`; amounts end in an
  ellipsis when cut.
- **Read from the source's CSS, not seen rendered.** The popover box is 32em wide on `backgroundTertiary`
  (#1f2038) with radius 0.4rem, an arrow of 30×15 and a transparent overlay. The title is white and the subtitle
  0.8rem `labelSecondary`. Cells are nowrap with an ellipsis. The plan's `Popover` already draws this box and
  arrow (`apps/web/src/plan/Popover.tsx`).
- **Our departures, by the brief.** A zero amount, a group row and the payment/uncategorized rows stay plain text,
  not buttons ("zero is not clickable"; Looking: "a zero Activity cell (not a button)"). The tooltip ends after
  "activity." with no flourish word. The CSS shows date headings in the source's list; we follow the ticket's
  observed ACCOUNT | DATE | PAYEE | MEMO | AMOUNT table.

## Approach

### The read (Worker, new files only)

`GET /api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/transactions` answers:

```
{ data: { category_id, month, activity, total_count, transactions: [
    { id, subtransaction_id, account_id, account_name, date, payee_name, memo, amount } ] } }
```

- **`id`** is the transaction's id; for a split line it is the parent's, so it addresses `get_transaction`.
  **`subtransaction_id`** is the line's id, or null. Amounts are signed milliunits and dates are ISO.
- **`activity`** is the sum of **every** counted row, including those not sent. **`total_count`** is their
  number.

**What counts: exactly the engine's rows.** The engine's activity for an ordinary (non-payment) category C in
month M is the sum of the `planActivity` rows (`apps/worker/src/repositories/plan-activity.ts`) that
`classifyTransaction` turns into `category` or `credit` for C. Unfolded, that is every transaction row `t` with:

- `t.budget_id` = the plan, `t.deleted_at is null`, `t.category_id` = C, `M ≤ t.date < M+1 month`;
- its account is not deleted and is on-plan (`a.on_budget = 1`); a closed account still counts;
- `t.inflow_to_ready_to_assign = 0`;
- not a transfer to another on-plan account: `not (t.transfer_account_id is not null and coalesce(ta.on_budget,0) = 1)`,
  with `ta` the transfer account and its deleted state not checked, as in `planActivity`. A categorized transfer
  to a tracking account counts;
- not a split parent with a live line: `not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)`.
  Split lines are rows of their own and count in their own category. As in `planActivity`, the parent's deleted
  state is not checked.

Scheduled transactions (their own table) are never listed. Card rows in C count (credit spending is part of C's
Activity). The new repository writes this as one SQL statement that mirrors `planActivity`, which is read, not
changed; the sum test locks the two together.

Payee: `coalesce(py.name, t.payee_name, pp.name, p.payee_name)` (the line's own, else the parent's, as
`spendingRows` does). A row with a transfer account shows `transferPayeeName(ta.name)` ("Transfer : <account>").
Memo is the row's own `t.memo`.

**Order:** newest date first, then as the register orders rows of one date (`sortTransactions` in
`packages/schema/src/register.ts`): signed amount ascending, `created_at` ascending, then id. Split lines of one
transaction break the last tie by `split_index`. Written in SQL:
`order by t.date desc, t.amount asc, t.created_at asc, coalesce(t.split_index, -1) asc, t.id asc`.

**Bound: 500 rows (`CATEGORY_ACTIVITY_LIMIT`).**
- **Why.** One category in one month is a few dozen rows even for heavy use. 500 rows is about 100 KB of JSON and a
  plain table that renders without virtualisation, and it keeps a pathological plan (an import of years into one
  month) from producing a multi-MB response and a frozen popover.
- **How.** The statement adds `count(*) over ()` and `sum(t.amount) over ()` (window functions run before
  `LIMIT`), so `total_count` and `activity` are over all rows while at most 500 are sent.
- **No silent cut.** When `total_count > transactions.length`, the popover says "N more transactions not shown."
  The MCP description says the same.

**Which categories:**
- **404 Plan:** an unknown plan, or a non-UUID plan id.
- **404 Category:** the category is not an active category of that plan (deleted, in a deleted group, another
  plan's, or not a UUID), as `getMonthCategory` answers.
- **422:** a month that `AssignedMonth` refuses (the route's `defaultHook`, as in `month-categories.ts`).
- **422, name `payment_category`:** a credit card payment category. The detail is "A credit card payment
  category's Activity is moved by the plan from card spending and payments; its transactions are not listed." Its
  Activity adds card spending the engine moves into it and the card's transfers (`funded`, `transferByCardMonth`
  in `budget-engine.ts`), so no list of rows sums to it. Note 4 of the brief: these cells stay as they are.
- **Hidden categories** answer normally.

**D1 calls: 3, whatever the number of rows:**
1. `budgetsRepo.findActive` (the plan);
2. the category: `select id, name, kind from categories join category_groups … where id = ? and budget_id = ? and both not deleted`;
3. the rows statement above.

`apps/worker/test/category-activity-calls.test.ts` counts them with the counting `env` of
`reconcile-calls.test.ts` (copied into the test, not imported from it) for 10 and for 100 transactions, and expects
**3** for both.

**MCP:** `list_category_transactions({ budget_id, month, category_id })` calls the same service and returns its
`data`. The description uses `MONEY`, `MONTH` and `dates("date")`, and says: "Returns { category_id, month,
activity, total_count, transactions: [{ id, subtransaction_id, account_id, account_name, date, payee_name, memo,
amount }] }". It also states the bound and the `payment_category` tool error. The result holds no timestamp; its
`CALLS` entry goes in `mcp-timestamps.test.ts`. Coverage goes in a new resource file
`apps/worker/test/mcp-coverage/category-activity.ts`.

### The popover (web)

- **The cell (`apps/web/src/plan/rows.tsx`, `CategoryRow` only).** When `c.kind === null` and `c.activity !== 0`,
  the cell's content is `<button type="button" class="activity-button">` wrapping today's span. The button's
  `title` is ``(${money(c.activity)}) View this category's monthly activity.`` and `aria-haspopup="dialog"`; a
  click calls the new `onActivity(anchor)` prop.
  - An unstyled inline-block (spec T8): the row's height and the cell's width do not change.
  - A zero amount, a payment category, the Uncategorized row and group rows keep today's plain span.
  - The click does not change the selection.
- **The grid (`PlanGrid.tsx`).** A new `Open` kind is `{ kind: "activity"; categoryId; anchor }`, so opening it
  closes any other popover, as today. `renderPopover` finds the category in `data` (the page's month read: the
  name comes from there, with no second fetch). It renders `ActivityPopover`, or nothing if the category is gone.
- **The popover (`apps/web/src/plan/activity-popover.tsx`, `ActivityPopover`).**
  - It uses the plan's `Popover` (`label="Activity"`, `className="activity-popover"`, `width={512}`,
    `dismissOnOutside`). Escape closes it and focus returns to the amount, through `Popover`. A mousedown outside
    closes it. `Close` is a `popover-button is-primary` and returns focus to the amount.
  - Inside: the title "Activity", the category name, and a fixed-layout table ACCOUNT | DATE | PAYEE | MEMO |
    AMOUNT in a `div.activity-list` that scrolls.
  - Cells are nowrap with an ellipsis; account, payee and memo carry `title` with their full text.
  - Date: `formatEntryDate` (`@budget/schema/date-entry`, MM/DD/YYYY). Amount: `money` from `plan/format.ts`
    (U+2212 minus, no `+`), coloured by `amountClass`, plus `labelNegative` when negative.
  - Column widths: DATE 88px, AMOUNT 96px; ACCOUNT, PAYEE and MEMO share the rest 30/35/35.
  - States: "Loading…", "The transactions could not be loaded.", "No transactions".
  - When `total_count > transactions.length`, a `p.activity-more` reads "N more transactions not shown."
- **Height: always inside the window.** The list's `max-height` is computed when the popover renders and on
  resize:
  `clamp(72, max(spaceAbove, spaceBelow) − ACTIVITY_CHROME, 320)`, where
  `spaceAbove = anchorTop − 15 − 8`, `spaceBelow = innerHeight − anchorBottom − 15 − 8`, and
  `ACTIVITY_CHROME = 150` (title, subtitle, table head, footer and padding).
  - `Popover` puts the box below the anchor, or above when it does not fit below and fits above. The bound
    guarantees one side fits, so the box lies wholly inside the window on any row, the first and the last
    included.
  - More rows scroll inside `.activity-list`; the window never scrolls.
- **Data (`apps/web/src/api/category-activity.ts`).** `useCategoryActivity` (key
  `["category-activity", budgetId, month, categoryId]`, `staleTime: 0`, no placeholder) is mounted only while the
  popover is open: one request per open, none per row. Styles go in `activity-popover.css`, with tokens only.

### EXF-720

- **The fix.** `PaymentHelpDialog.tsx`: `className="popover-button is-primary"` (white on `--buttonPrimaryBackground`
  #545bfe, about 4.8:1). It keeps its focus ring from `.popover-button.is-primary:focus-visible`. Nothing else
  changes: it still closes the dialog and focus returns to PAYMENT.
- **Search of `apps/web/src/plan/**` for other `<button>`s with no class or no app style (Architect, at
  `d005439`).**
  - Three have no `className`: `KeyboardTip.tsx:14` (the ×) and `Toolbar.tsx:54` and `:64` (the Progress Bars
    tabs). All three are styled by their parents (`.keyboard-tip button` in `plan-views.css`; `.segmented button`
    in `plan-grid.css`), so none renders as the browser's default.
  - Every other button's classes have a rule in the app's CSS.
  - `Got it!` is the only `popover-button` with no variant.
  - The Implementer repeats the search at its HEAD and reports the list.

### EXF-714 (tests only)

Three tests, each guarding one `lone` condition, as the ticket lists them. Their setups are in spec T12.

1. **Unit, `monthHiddenInputs`** (`packages/schema/src/auto-assign.ts`): a payment category alone in `ids` counts its
   Total Underfunded with `lone` true and not with false. Guarded change: `lone &&` → `ids.length === 1 &&`.
2. **Worker, preview and apply** (`loadScope` in `apps/worker/src/services/auto-assign.ts`): a view holding only a
   payment category with Total Underfunded > 0, with no `category_ids`, leaves it out; the same category named in
   `category_ids` gets its Total Underfunded. Guarded change: `scope.category_ids !== undefined && ids.length === 1`
   → `ids.length === 1`.
3. **Browser, the Auto-Assign card** (`apps/web/src/plan/AutoAssignOptions.tsx`): with nothing ticked and a chip
   showing one category, the card stays plan-wide (plural labels, Underfunded at $0.00, no Paid Last Month or
   Average Paid); ticking it switches to the one-category card. Guarded change:
   `"categoryIds" in scope && ids?.length === 1` → `ids?.length === 1`.

Each test is run once against its guarded change (quote the failing line), then the change is restored.

## Downstream effects

- The new route and tool files are collected by `import.meta.glob`: no shared module changes, and
  `openapi.test.ts` and `mcp.test.ts` pick them up untouched. `mcp-timestamps.test.ts` gains one `CALLS` line.
- The Activity cell gains a button only for non-zero ordinary categories. `e2e/plan-narrow.spec.ts` and
  `plan-grid.spec.ts` must pass unchanged.

## Out of scope / known issues

- **The Activity of credit card payment categories** (card spending moved by the engine, payments) stays plain
  text, not a button, and the read answers 422 `payment_category` for them. No row list sums to that figure; a
  later ticket may add a breakdown.
- **The Uncategorized row's Activity, group rows and the Ready to Assign figures** are not clickable.
- **Clicking a row in the popover** does nothing; the ticket does not ask for navigation to the register.
- **The source's flourish word** in the tooltip and its date headings are not copied.
- **Out of bounds:** listed at the top of the spec; none of those files change. No migration and no dependency.

## Acceptance

Sizes: 1440×900 and 1024×700. Every case runs on a plan the spec or Tester creates through the API: a plan named
`ZZ-TEST …` holding an on-plan checking account `ZZ Checking`, a tracking account, a category `ZZ Food` in a group
`ZZ Group`, and the rows the case names in November 2026, with the clock at 2026-11-16 UTC.

1. **Button and tooltip.** `ZZ Food` has one −60.00 outflow on 11/15/2026. Its Activity cell holds a button named
   "−$60.00" with title `(−$60.00) View this category's monthly activity.` and cursor pointer. Its row height and
   cell width equal a zero row's.
2. **One row.** Click −$60.00 (`realClick`): a dialog named "Activity" opens below the cell, with the subtitle
   `ZZ Food`, the head ACCOUNT | DATE | PAYEE | MEMO | AMOUNT and one row `ZZ Checking | 11/15/2026 | <payee> | |
   −$60.00`.
3. **Sum and month.** `ZZ Food` has in November: an outflow, a +12.00 refund, a split with one line in `ZZ Food`
   and one in another category, a categorized transfer to the tracking account, and a row on an account closed
   afterwards. It also has a deleted row, an unentered scheduled row in November and a row on 10/31/2026. The
   popover lists exactly the 5 counted rows (the split shows only its `ZZ Food` line). Their amounts sum to the
   Activity cell, newest first.
4. **Read = engine (Worker).** The same plan through REST gives `activity` = the month read's `activity` for the
   category to the milliunit, `total_count` 5, and none of the three excluded rows. MCP
   `list_category_transactions` returns the same `data`.
5. **404/422.** An unknown category gets 404. Another plan's category or plan id in the path gets 404. A bad month
   gets 422. A payment category gets 422 `payment_category`.
6. **D1 calls.** The read makes 3 D1 calls with 10 and with 100 transactions in the category.
7. **Bound.** With 503 rows in the month: 500 rows are sent, `total_count` 503, `activity` is the sum of all 503,
   and the popover's last line reads "3 more transactions not shown."
8. **Zero and others.** A category with $0.00 Activity has no button in its Activity cell (text only). The group
   row's Activity has no button, and neither does a credit card payment category.
9. **Close.** The Close button, Escape and a mousedown outside each close the popover. After Close and Escape,
   focus is on the Activity button.
10. **Long text.** A 120-character payee and memo show cut with "…". Each cell's `title` holds the full text, and
    `scrollWidth > clientWidth` for both.
11. **Many rows.** With 30 rows, the list scrolls inside the popover (`.activity-list` `scrollHeight >
    clientHeight`), `document.scrollingElement.scrollHeight === innerHeight`, and the Close button is visible.
12. **Inside the window.** At 1024×700 and at 1440×900, with 30 rows, the popover's box lies wholly inside the
    window when opened on the first visible category row, a middle row and the last visible row of the grid.
    `e2e/plan-narrow.spec.ts` passes unchanged.
13. **One request.** Loading the Plan page makes no request to `…/transactions`. Opening the popover makes exactly
    one.
14. **EXF-720.** In a `seedCard` plan, click PAYMENT. The `Got it!` button's computed background is
    rgb(84, 91, 254) and its colour rgb(255, 255, 255), contrast ≥ 4.5, at rest, on hover and on focus, at both
    sizes. It closes the dialog and focus returns to PAYMENT. The spec fails on the old file (quote the line).
15. **EXF-714.** The three tests above pass, and each fails once against its guarded change (quote the lines).

### Looking (the Tester's main work)

For each visual acceptance case, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a
**fresh** screenshot in this Thread (not a file a spec or an earlier step wrote), opens it, and writes one
sentence on what is seen in it. The report lists `case, size, file, sentence` for every one. A case without its
two entries is PARTIAL with the words "not looked at". "A spec is green" is not looking. The last two Builds'
acceptance steps took under 80 seconds and let through a button with white text on a near-white background
(EXF-720, fixed here).

The states to look at, at both sizes:
- an Activity amount as a button with its tooltip;
- the popover open with one row;
- with a split line and a refund among several rows;
- with a long payee and a long memo (cut with an ellipsis, the full text in a tooltip);
- with more rows than fit (it scrolls inside the popover; the window does not);
- a zero Activity cell (not a button);
- the popover on the last visible row of the grid (it stays inside the window);
- the "Using Credit Cards" dialog with its readable `Got it!` button.

## Manifest

touches: [docs/activity-popover-design.md, docs/activity-popover-spec.md, docs/activity-popover-polish.md, docs/README.md, packages/schema/src/category-activity.ts, apps/worker/src/repositories/category-activity.ts, apps/worker/src/services/category-activity.ts, apps/worker/src/routes/category-activity.ts, apps/worker/src/mcp/tools/category-activity.ts, apps/worker/test/category-activity*.test.ts, apps/worker/test/mcp-coverage/category-activity.ts, apps/worker/test/mcp-timestamps.test.ts, apps/worker/test/auto-assign.test.ts, packages/schema/test/auto-assign.test.ts, apps/web/src/api/category-activity.ts, apps/web/src/plan/activity-popover.tsx, apps/web/src/plan/activity-popover.css, apps/web/src/plan/rows.tsx, apps/web/src/plan/PlanGrid.tsx, apps/web/src/plan/plan-grid.css, apps/web/src/plan/PaymentHelpDialog.tsx, e2e/activity-popover*.spec.ts, e2e/support/activity-popover-seed.ts, e2e/card-payments.spec.ts, e2e/auto-assign.spec.ts]
shared: []
migrations: 0
