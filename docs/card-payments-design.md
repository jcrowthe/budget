# Card payments and register leftovers: design (EXF-539, EXF-635, EXF-636, EXF-637, EXF-630)

One Build, five tickets, all in the account page, the register and the transactions service:
- **EXF-539:** the credit account page's Payment pill and Record Payment, "Payment from" payees, the payment
  display rule, the own-payment-category refusal, and `POST …/accounts/{account_id}/payments` with `pay_credit_card`.
- **EXF-635:** shift+click selects a range; shift+↑/↓ extends it.
- **EXF-636:** Move to Account on All Accounts.
- **EXF-637:** a bulk refusal names the row, never its id.
- **EXF-630:** three leftovers in the transactions service and its counting test.

No engine change, no migration, no shared module. Tasks and signatures: [card-payments-spec.md](card-payments-spec.md).

## Source

Studied in a sub-agent: `/workspace/scratch/source/exf-539-register/notes.md`, captures `01-baseline`,
`02-range-selected`, `03-more-menu`, `04-final-cleared` (`.png`, cropped), raw rules in `css-rules.txt`. The test
plan's All Accounts register only (dark, 1600×813 as found).
- **Range:** tick row 2, shift+click row 5's box: rows 2–5 are ticked (both ends, display order; three accounts).
  The bar reads `× 4 Transactions | Categorize Flag | More`. The header shows the signed sum over
  "Selected Total (4)". There is no other range marker.
- **More on All Accounts (4 rows, 3 accounts):** Mark as Uncleared / Match, Unmatch (disabled) / Duplicate /
  Memo... / Export 4 Transactions / Delete. **There is no Move to Account in that state.** A Move submenu rule
  exists in the stylesheet, so some other state offers it (not tried). **The clone departs on purpose:** the brief
  and EXF-636 ask for Move on All Accounts, also for rows of different accounts.
- **Styles** of the bar, selected rows, checkboxes and menu match what the clone already has.

**What was done in the source.** The sub-agent:
- matched the Clerk's tab by its target id and did not navigate;
- ticked row 2's box, shift+clicked row 5's box and clicked the bar's More button;
- pressed Escape once and unticked the four rows (0 left ticked);
- read styles, read-only;
- took 4 plain `page.screenshot` captures, at 1600×813 before and after each, deleting each raw image right after
  cropping off the sidebar.

It saved nothing and clicked no menu item, wrote nothing into the page, and changed no theme, setting or size. It
opened neither the plan menu, Bank Connections, Add Account, an account, Plan, Reflect, nor another plan.
**The Architect did not open the source.**

**Not compared:** everything in EXF-539, the Move submenu, shift+↑/↓, the refusal text, and everything at 1024×700.

## Decisions

From the Lead's brief:
- A payment stays an on-plan transfer between a cash account and a credit account, with no category stored.
- `?record-payment` opens the payment row.
- Paying from a card or a tracking account is out of this Build.

The Architect's:

- **D1. Pill colour.** The pill shows the card's payment category Available for the current local month. It is
  grey (`is-zero`) at exactly 0, green (`is-positive`) above 0 and red (`is-negative`) below 0. The colours are
  the Plan grid's, repeated as `account-header.css` variables because `plan/**` is held elsewhere.
- **D2. Prefill.** Record Payment opens a new row dated today, focus on Payee, payee and category empty. Inflow is
  set to the Available **only when it is above 0**. At 0 or below it stays empty: there is nothing to pay, and a
  negative would be an outflow. The button is disabled until the month has loaded or failed.
- **D3. Display rule** (`paymentDisplay`, pure). It applies to a transfer row where both accounts are on-plan and
  exactly one is `creditCard`/`lineOfCredit` (the card). **Both** rows read payee `Payment: <other account>` (the
  ⇆ link stays) and category `Credit Card Payments: <card>` as plain text. Card↔card and card↔tracking rows are
  unchanged. REST, MCP, CSV, sorting and search keep the stored values.
- **D4. Picker labels.** In "Payments and Transfers", when the row's account is a credit account, each on-plan
  non-credit account reads `Payment from <account>`. Every other entry keeps `To/From <account>`, including cards
  on a cash register. Typed text matches the label shown.
  - Picking "Payment from X" sets the payee text to that label, and Category shows
    `Credit Card Payments: <card>`, disabled; nothing is sent for it.
  - Editing a payment row shows the same texts.
- **D5. Own payment category.** A row or split line on credit account K whose category is K's own payment
  category (`kind = credit_card_payment`, `account_id = K`) gets **422 `own_payment_category`**:
  `A transaction on <K> can't use its own payment category. Choose a spending category, or use Record Payment to pay <K> from a cash account.`
  - The check sits in the rules every write runs: create, PATCH, splits, bulk categorize and move (via
    `prepare`), and scheduled create and update.
  - MCP returns it as a tool error with the same text.
  - The entry row shows `Couldn't save the transaction. <text>` and stays open (the existing path).
  - Cash rows into a payment category, and card rows into another card's payment category, stay allowed.
- **D6. `POST /budgets/{budget_id}/accounts/{account_id}/payments`** takes `{ from_account_id, amount?, date?, memo? }`
  and answers 201 `{ amount, from_transaction, to_transaction }`.
  - `account_id`: 404 when unknown; 422 `not_a_credit_account` when not a credit account; 422 `account_closed`
    when closed.
  - `from_account_id`: must be on-plan, not a credit account, and not the card, else 422 `invalid_payment_source`
    ("Pay a card from an on-plan cash account (checking, savings or cash)"). 422 `account_closed` when closed.
  - `date`: defaults to today (UTC).
  - `amount` (> 0): defaults to the payment Available in `date`'s month. When that is ≤ 0, or the card has no
    payment category: 422 `nothing_to_pay`, "<card>'s payment category has nothing available to pay; send an amount".
  - The pair is written by the existing `createTransfer` (cash −amount, card +amount): two rows and their two
    `change_log` rows with the actor, in one batch.
  - MCP: `pay_credit_card(budget_id, card_account_id, from_account_id, amount?, date?, memo?)`.
- **D7. `?record-payment`.** On a credit account's page, once the month is loaded, it opens the payment row, then
  removes the parameter with `replace`, so a reload does not reopen it. On any other account it is only removed.
- **D8. Ranges.** Each list keeps an anchor: the last row clicked, ticked or unticked without Shift. The real rows
  and the Scheduled section are separate lists. "Display order" is the sorted list the table publishes.
  - Shift+click on a box adds anchor…target (both included) to the selection.
  - Shift+click on a row makes the selection exactly that range. It never opens editing, and it closes an open
    entry row as a plain click does.
  - With no anchor in that list, shift+click acts as a plain click.
  - Shift+↑/↓ (registry id `select-multiple`, already in the shortcuts dialog) moves a cursor (it starts at the
    anchor and stops at the ends) and selects anchor…cursor. It does nothing with no selection or with an entry open.
  - Shift+mousedown starts no text selection.
  - Ctrl+click is unchanged.
- **D9. Move on All Accounts.** `barActions().move` is always true. On All Accounts the submenu lists the open
  accounts in sidebar order, minus the account that holds every selected row (when one does). The account page is
  unchanged. The server already moves rows from several accounts in one request.
- **D10. Refusals on screen.** REST and MCP keep `Transaction <id>: <reason>`. The bar's alert passes the detail
  through `bulkRefusalText(detail, labelOf)`.
  - The prefix becomes `<payee text> on <MM/DD/YYYY> (<signed amount>): `, and the reason's first letter is
    capitalised. The payee text is what the payee cell shows (D3 text, `Transfer: X` or the payee name).
  - A row with no payee text reads `The transaction on <date> (<amount>)`.
  - An id that is not in the rows reads `1 of the selected transactions`.
  - The bulk move's tracking reasons become plain words:
    `<T> is a tracking account, so its transactions can't have a category. Remove the category first.` (split:
    `… can't be split. Make it a plain transaction first.`).

## Approach

**Worker**
- **`services/card-payments.ts` (new):** `payCreditCard` runs the plan check, then one `accountsRepo.list` (both
  accounts validated from it). Only without `amount` does it call `getPlanMonth(env, budgetId, monthOf(date), date)`
  (called, not changed). Then it calls `createTransfer(cash → card)`.
- **New route and tool files:** `routes/card-payments.ts` and `mcp/tools/card-payments.ts`, collected by the globs.
- **D5 helper:** `refuseOwnPaymentCategory(account, category)` in `services/transactions.ts`, called by:
  - `validate`: its category comes from `findActive`, or from `Reads.categories`, which gains `kind` and
    `accountId` (`categoryNamesMany` selects them);
  - `transaction-splits.ts` `validateLines`;
  - `scheduled-transactions.ts` `checkRules` (`repositories/scheduled-transactions.ts` `categoryNames` selects them).
  No new query.
- **EXF-630:** `linksOf` uses `linesByParent`. `detailsOf` reads only lines (`listLines({parentIds})`, then
  `linesByParent`), so approve makes one call fewer. Results, errors and history are unchanged.
- **`transactions-bulk.ts`:** only the two D10 texts change.

**Web**
- **`account/usePaymentAvailable.ts`:** `useMonth(budgetId, localMonth)`, the same query key the Plan page and the
  entry row use, then `paymentCategoryOf(month, accountId)`.
- **`account/PaymentBalance.tsx`:** sits in `.acct-balances-right` after `<SelectedTotal/>`. The source's total has
  `margin-right: 1rem`, so something follows it. It shows the pill (signed `formatMoney`, D1 class) over
  `ⓘ Payment`. The ⓘ is our own 12px icon, with the tooltip `Available in Credit Card Payments: <card> this month`.
  While loading it stays empty but keeps its height.
- **Toolbar:** `Record Payment` (card icon) after File Import, for credit accounts only. It is disabled when the
  account is closed or the month is loading.
- **`Register`:** `openPayment()` (D2), the `?record-payment` effect (D7), and `Open` add carries
  `payment: { inflow }`.
- **`EntryRow`:** takes `prefillInflow`, focuses Payee, passes `transferLabel` to `PayeeField`, and passes
  `fixedText` to `CategoryField`.
- **`RegisterTable` and `ScheduledSection`:** D3 cells and D8 handling. `Box.onClick` receives the event.
- **`selection.tsx`:** holds the anchor and cursor, `selectRange` and `extend`. `ActionBar` binds `select-multiple`,
  passes `moveTo` on both pages (D9) and maps errors (D10).
- **1024×700:** if the toolbar with its extra button overflows, the search input shrinks first (192 → at least
  120px). Then File Import, Undo and Redo hide their text visually through a container query, keeping the icon,
  the accessible name and the `title`.

### D1 calls

Read from the code; a batch counts as one call. The tests fix the measured figures.
- **Payment with `amount`:** about 9 calls (the plan and the accounts list, plus `createTransfer`'s 7: plan, from,
  to, batch, and two `detailOf`). Without `amount`, `getPlanMonth`'s 8 are added, about 17. A test asserts equal
  counts for 1 card / 10 rows and 4 cards / 100 rows, each ≤ 20.
- **Account page:** one `GET …/months/<month>` per visit, shared through react-query with the Plan page and the entry
  row (8 calls on the server). There is no request per card or per row, and only credit pages mount the hook.
- **Bulk move from several accounts:** one read of all accounts, one batch. The new case (10 rows from one account
  against 100 from three, with splits and transfers) asserts equal counts, ≤ 20.
- **EXF-630:**
  - Categorize now targets a second category (the ticket measured 9 calls at both sizes).
  - Approve goes from 8 to 7 calls, asserted with that note.
  - Every op stays equal at 10 and 100 rows, ≤ 20.
- **D5:** +0 calls.

## Downstream effects

These assertions change because the tickets require it; they are listed as departures:
- `e2e/register-bulk.spec.ts`: All Accounts now offers Move to Account (line ≈423), and the tracking refusal uses
  the D10 text (≈219).
- `transactions-bulk-rules.test.ts:85` gets the new reason text.
- `register-selection.test.ts`: `move` is true on "all".

`mcp-timestamps.test.ts` gets one line: `pay_credit_card` in `NOT_CALLED` (the seed has no credit card). Its result
has `create_transfer`'s shape, and `card-payments.test.ts` checks its timestamps and description. At a rebase, keep
the other Build's line too.

## Out of scope

- Paying from a card or a tracking account.
- Changing the stored rows.
- Sort, search or CSV by the display text.
- Ctrl+click toggling.
- The Plan inspector's button (the Lead adds `?record-payment`).
- Link Account.
- The light theme.

## Acceptance

Browser cases use `realClick`, a plan made through the API, and a clock fixed at 2026-11-16, at 1440×900 unless
stated. Seed: Visa `ZZ-TEST Visa` (creditCard, balance 0), Checking `ZZ-TEST Checking` (balance 1000000), Groceries
assigned 335000 in Nov. Worker amounts are in milliunits.

1. **[539 figures, Worker]** A Visa row of −335000 in Groceries gives payment `available` 335000 and Visa balance
   −335000.
   - POST payments `{from: Checking, amount: 200000}` → 201; the payment becomes 135000 and the balance −135000.
   - Then `{amount: 185000}` → payment −50000 (`cash_overspent`), balance +50000.
   - Each POST writes 2 `change_log` create rows with the `user:` actor. The pair is cash −amount and card +amount,
     with `category_id` null, linked both ways.
2. **[D6 default]** On a fresh seed:
   - POST with neither amount nor date pays 335000 dated today (UTC), and the payment becomes 0.
   - Again → 422 `nothing_to_pay`, nothing written.
   - MCP `pay_credit_card` with `amount: 1000` creates the same pair with the `mcp:` actor.
3. **[D6 refusals]** Each writes nothing, and MCP gives a tool error with the same text:
   - from a second card, or from a tracking account → 422 `invalid_payment_source`;
   - `account_id` = Checking → 422 `not_a_credit_account`;
   - from a cash account opened at 0 and closed → 422 `account_closed`;
   - an unknown card → 404;
   - `amount: 0` → 422.
4. **[539 AC5, D5]** Each of these gives 422 `own_payment_category` with the D5 text and writes nothing:
   - POST a Visa row with Visa's payment category;
   - PATCH a Visa row to it;
   - a Visa split line with it;
   - bulk categorize (detail starts `Transaction <id>: `);
   - bulk move of a Checking row categorized to it into Visa;
   - a scheduled create on Visa with it;
   - MCP `create_transaction`.

   A Checking row with that category → 201. A Visa row with a second card's payment category → 201.
5. **[539 AC1, D1]** The Visa header shows "Credit Card", the three balances, and a pill `$335.00` (`is-positive`)
   over "Payment".
   - Pay 335.00 through the API and reload: `$0.00` (`is-zero`).
   - Pay 50.00 more: `−$50.00` (`is-negative`).
   - A Line of Credit shows the block; Checking does not.
6. **[539 AC2, D2]** The Visa toolbar reads Add Transaction, File Import, Record Payment, Undo, Redo, View, in order.
   Checking has no Record Payment.
   - Click it: a new row dated 11/16/2026 with Inflow `335.00`, Payee focused and empty, Category empty.
   - With Available 0: Inflow is empty.
7. **[539 AC3, D3, D4]** In that row, "Payments and Transfers" lists "Payment from ZZ-TEST Checking", and a tracking
   account reads "To/From …".
   - Pick it: Category reads "Credit Card Payments: ZZ-TEST Visa", disabled.
   - Save (`expect.poll` on the POST): the row shows "Payment: ZZ-TEST Checking" with the ⇆ button and that
     category, and the pill reads `$0.00`.
   - On Checking, the other row reads "Payment: ZZ-TEST Visa" with the same category, and its payee list shows
     "To/From ZZ-TEST Visa".
8. **[539 AC4]** Record Payment with Inflow 200.00 from Checking: the pill reads `$135.00` and Working `−$135.00`.
   Again with 185.00: the pill reads `−$50.00` (`is-negative`) and Working `$50.00`.
9. **[539 AC5, browser]** A Visa row with category "Credit Card Payments: ZZ-TEST Visa", then Save: the row stays
   open, the alert reads "Couldn't save the transaction. A transaction on ZZ-TEST Visa can't use its own payment
   category. …", and the API list is unchanged.
10. **[539]** Visa's Starting Balance row shows "Category not needed".
11. **[Lead note 2, D7]**
    - `/<plan>/accounts/<visa>?record-payment` opens the payment row (Inflow `335.00`) and the URL loses the
      parameter. A reload opens no row.
    - On Checking with the parameter: no row opens, and the parameter is removed.
12. **[635 example]** Display order A −40.00, B −30.00, C −30.00, D −20.00, E −17.34, F −10.00.
    - Click F's date cell, then shift+click A's: 6 ticked, "6 Transactions", and "−$147.34" over
      "Selected Total (6)".
    - A plain click on C selects only C.
    - Then tick B's box and shift+click E's box: B–E ticked, "4 Transactions".
    - A plain box click toggles one row.
13. **[635, All Accounts and Scheduled]**
    - On All Accounts with rows of two accounts, tick the 2nd row and shift+click the 5th row's box: rows 2–5 are
      ticked.
    - Tick a scheduled row, then shift+click a real row's box: only that real row is ticked.
    - Tick one scheduled row and shift+click another: both, and the rows between them, are ticked.
14. **[635 keys]** Select C, then shift+↓ ×2: C, D, E ("3 Transactions"). Then shift+↑ ×3: B and C. With an entry
    row open, shift+↓ changes nothing.
15. **[635 AC4]** Cases 12 and 13 hold at 1024×700.
16. **[636]** On All Accounts, tick a Checking row and a Savings row, then More › Move to Account.
    - The submenu lists the open accounts in sidebar order: Checking and Savings included, closed accounts absent.
    - Pick a third account: both rows move, and each account's sidebar balance and the All Accounts working total
      follow (`expect.poll` on the API).
    - With rows of one account selected, that account is absent from the submenu.
    - At 1024×700 the submenu stays inside the window.
17. **[636 counting]** Moving 10 rows of one account, and 100 rows of three accounts (with splits and transfers),
    make equal calls, ≤ 20, and every row lands in the target.
18. **[637]** On Checking, select "ZZ Fee" (−45.00, 11/10/2026, categorized), then More › Move to Account ›
    ZZ Asset (tracking).
    - The alert reads exactly "ZZ Fee on 11/10/2026 (−$45.00): ZZ Asset is a tracking account, so its transactions
      can't have a category. Remove the category first.", with no UUID.
    - Nothing changes.
    - REST `detail` still starts `Transaction <id>: `.
19. **[630]**
    - Categorize targets a second category; equal at 10 and 100 rows.
    - Approve is asserted at 7 calls. Run on main first, it fails reading 8; quote that line.
    - `linksOf` uses `linesByParent`.
    - Other Worker tests pass unchanged, apart from the D10 text line.
20. **[D6 calls]** `payCreditCard` makes equal calls for 1 card / 10 rows and 4 cards / 100 rows, with and without
    `amount`, each ≤ 20. Report the figures.
21. **[1024×700]** Card `ZZ-TEST Visa Signature Rewards`, balances near −$12,345.67, pill `−$12,345.67`, 2 rows
    ticked (Selected Total shown).
    - Each `.acct-balance` and the pill: `scrollWidth ≤ clientWidth`, amount and label one line each, right edge
      inside `.acct-balances`.
    - Each toolbar button: right edge inside `.register-toolbar`, text on one line.
    - The Move submenu: inside the viewport.

    The Tester also looks at the screenshot itself.
22. **Compare, live** (source: the test plan's All Accounts, dark, the tab as found): tick the 2nd row and
    shift+click the 5th row's box. Both apps tick rows 2–5 and show "4 Transactions" and "Selected Total (4)".
    Untick afterwards. Everything else is not compared.

## Manifest

touches: [packages/schema/src/card-payments.ts, packages/schema/src/register-selection.ts, packages/schema/src/payees.ts, packages/schema/test/card-payments.test.ts, packages/schema/test/register-selection.test.ts, packages/schema/test/payees.test.ts, apps/worker/src/services/card-payments.ts, apps/worker/src/routes/card-payments.ts, apps/worker/src/mcp/tools/card-payments.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/transactions-bulk.ts, apps/worker/src/services/transaction-splits.ts, apps/worker/src/services/scheduled-transactions.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/scheduled-transactions.ts, apps/worker/test/card-payments.test.ts, apps/worker/test/own-payment-category.test.ts, apps/worker/test/bulk-call-count.test.ts, apps/worker/test/bulk-helpers.ts, apps/worker/test/transactions-bulk-rules.test.ts, apps/worker/test/mcp-coverage/accounts.ts, apps/worker/test/mcp-timestamps.test.ts, apps/web/src/account/**, apps/web/src/register/**, e2e/card-payments.spec.ts, e2e/register-range.spec.ts, e2e/register-bulk.spec.ts, e2e/support/card-seed.ts, docs/card-payments-design.md, docs/card-payments-spec.md, docs/card-payments-polish.md, docs/README.md]
shared: []
migrations: 0

## Build notes

Measured by `apps/worker/test/bulk-call-count.test.ts`:
- `payCreditCard`: 10 calls with `amount`, 18 without (the design estimated about 9 and 17: `createTransfer` re-reads the
  plan and both accounts). Equal for 1 card / 10 rows and 4 cards / 100 rows.
- Bulk move: equal for 10 rows of one account and 100 rows of three (splits and transfers in both), and for plain rows
  alone. Plain rows make one call fewer than rows with transfers or splits, at either size.
- Approve: 7 calls (was 8). Categorize targets a second category and stays equal at 10 and 100 rows.

Departures:
- **The toolbar threshold** is a container query at 900px of the toolbar's own width: File Import, Undo and Redo keep
  their icon, name and title and hide their text. At 1024×700 the toolbar fits with Record Payment; at 1440 nothing hides.
- **Sub-list differences.** `Reads.categories` carries `kind` and `accountId`; the scheduled update also checks the
  category when only the account changes.
- **Existing assertions changed** (the tickets require it): `register-bulk.spec.ts` (Move to Account on All Accounts,
  in the menu list and in the tracking refusal text, which names `ZZ Fee on <date> (-$4.50)` for the seed's -4.50 row),
  `transactions-bulk-rules.test.ts` (new reason text), `register-selection.test.ts` (`move` true on "all").
- `extend` returns the cursor's id (the design said `void`), so the bar can scroll that row into view.
- The 1024×700 spec pays the card twice what was spent, so the pill reads `-$12,345.67` (the widest figure).
