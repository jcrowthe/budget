# Credit engine design (EXF-532, EXF-535)

This design gives each credit account (Credit Card, Line of Credit) a **payment category** in the system group
"Credit Card Payments". Funded card spending moves into that category. An overspent category splits into a
**credit** part (yellow: it becomes card debt) and a **cash** part (red: it is taken from next month's Ready to
Assign). On the Plan page this means the yellow and red pills and the inspector's three messages. Interfaces,
error texts and tasks are in [credit-engine-spec.md](credit-engine-spec.md).

## Source

Studied in a sub-agent; notes are in `/workspace/scratch/source/credit-engine/notes.md`, with the raw rules
and computed styles in the same folder. The test plan has no card and nothing overspent. Here is what could be
seen:
- **Stylesheet, dark theme:**
  - pill `.negative`: #bf2e3b on #fff
  - pill `.cautious`: #f6c91d on #0c0d22 (hover #daac00)
  - `.cautious.credit svg`: the label colour, with a right margin of .35rem (a `credit_card` sprite; its size
    can't be seen)
  - `.inspector-message.negative`: #4c0814 on #fff
  - `.inspector-message.cautious`: #362c05 on #fff (radius .5em, padding 1rem, line-height 1.5, bold amount)
  - separate `.overspent-cash` and `.overspent-credit` chip rules (left for EXF-500)
- **Live:** the `.zero` pill is 22px tall, padding 2px 7px, 14px/500. The Available Balance card lists "Cash
  Left Over From Last Month", "Assigned This Month", "Cash Spending" and "Credit Spending" (14px, #c4c5cf).
  The clone already has these lines.

**The earlier Architect's step in the source** (the Clerk's tab `18843FD0…`, over CDP): it read stylesheet
rules and computed styles, hovered one ordinary category's pill, and ticked and unticked that row's checkbox
(the app opened the Assigned cell; nothing was typed). Captures: `shot1_uncropped.png` (plain
`page.screenshot`, 1600×813, deleted) and `shot1_grid_inspector_cropped.png` (kept). The viewport was 1600×813
before and after. Nothing was saved, and neither theme nor size changed. No menu, Bank Connections, Add
Account, account or other plan was opened.

## Decisions (all "not compared")

**Decided by the Lead:**
- Renaming a card renames its payment category; closing it keeps the category.
- The group comes first. The group and its categories refuse rename, hide and delete, and no category can be
  added to the group (422). A target on a payment category is refused until EXF-538.
- Two cards in one overspent category share the credit part in proportion to each card's net spending (a
  card at ≤ 0 takes none), by largest remainder, with ties to the lower account id.
- A cash↔card transfer is a payment. A card↔card transfer moves the amount between the two payment
  categories.
- A card row in a payment category is that category's activity, not credit spending.
- An uncategorized card row stays in Uncategorized.
- Auto-Assign leaves payment categories out of Underfunded, Reduce Overfunding, Spent Last Month and Average
  Spent.

**Decided by the Architect:**
- Deleting a card whose payment category has history (a non-zero Assigned or a live row) is refused with 409
  `payment_category_has_history`. Otherwise that money would silently go back to Ready to Assign.
- `reassign_to` cannot be a payment category (422 `invalid_reassign_target`).
- A payment category's `cash_spending` and `credit_spending` are 0.
- The message box sits at the top of the Available Balance card body. The icon is our own 14×14
  `CreditCardIcon`.
- The month read puts the system group first whatever its `sort_order`.
- **A partly covered mixed category loses its cash part first.** Rule 2's `X = min(−A, S)` holds the credit
  part at S while −A > S. Rule 5's wording ("credit first") was never observed for a partial cover. The Lead
  accepts this reading (C4).

## Approach

### Data: `20261116101100_credit_payment_categories.sql` (additive)

It adds nullable `category_groups.kind`, `categories.kind` and `categories.account_id`, and two unique partial
indexes over live rows: one system group per plan, and one payment category per account. Two idempotent
`INSERT … SELECT` statements then backfill the plans that exist. A system group (sort = lowest − 1) is added
per plan with a live card. A payment category is added per live card, closed ones included, named like the card
and sorted in account order. Ids are version-4 UUIDs made in SQL. A hand-made "Credit Card Payments" group stays
ordinary. The backfill writes no history, because a migration has no actor. The backfill test arranges
"before" by hard-deleting the `kind` rows of plans built through REST, then runs the `INSERT`s twice (T1, T11).

### Lifecycle and locks: `services/credit-payments.ts` (new)

The new service returns unexecuted statements, each with its `change_log` row and the actor, which run in the
account's own batch. Create (`insertAccountWithStartingBalance`, which serves Add Account, `create_account` and
bank accounts, plus the `createAccount` seam) adds the group when the plan has none, then the category. Rename
renames the category. Delete soft-deletes it under `noHistory`, and the group stays. The locks are
`PaymentLocked`, checked in the services so that REST and MCP agree, all 422: `payment_group_locked` (rename, hide
or delete the group, or add a category to it), `payment_category_locked` (rename, hide or delete) and
`payment_category_target`. Collapsing, notes, assigning, moves, covers and Auto-Assign stay allowed.

### Arithmetic: `packages/core/src/budget-engine.ts` (pure)

`classifyTransaction` stays the one place for counting rules. Off-plan rows are ignored. For an on-plan row:
1. **Transfer between two on-plan accounts.**
   - On card K, it adds **−amount** to K's payment activity. A payment of 200 from checking has a +200 row on
     the card, so the payment activity falls by 200. A cash advance raises it. Card↔card moves the amount
     between the two cards.
   - On a cash account, it counts nowhere (unchanged).
2. **Inflow to Ready to Assign** (any account): counts in Ready to Assign.
3. **Into a payment category** (any account): that category's activity.
4. **Into an ordinary category C:** on card K, credit activity of (C, K); on cash, cash activity of C.
5. **Anything else:** Uncategorized, as today. A card's Starting Balance stays out (in the read).

**Per month, ordinary categories first:**
- `activity = cash + Σ_K credit(K)`
- `available A = max(prev, 0) + assigned + activity`
- `cash_spending = cash`, `credit_spending = Σ_K credit(K)` (signed)
- `S = max(0, −credit_spending)`
- If A < 0: credit part `X = min(−A, S)` and cash part `Y = −A − X`. Otherwise both are 0.
- `overspent = {cash: Y, credit: X}` when A < 0, else null.
- `state`: `cash_overspent` if Y > 0, else `credit_overspent` if X > 0, else `ok`.
- X is split into X_K by largest remainder over `s_K = max(0, −credit(K))`, computed with BigInt.
  X ≤ S ≤ Σs_K, so no card takes more than it spent.
- `Funded(C,K) = −credit(K) − X_K`. A refund makes it negative, which lowers K's payment category.

**Then each payment category P_K:**
- `activity = direct rows + Σ_C Funded(C,K) + transfers(K)`
- A negative Available is all cash (red).

A card with no live payment category funds nothing (the services prevent that case).

**Cash overspending of M** = Σ Y + max(−Uncategorized available, 0). It is charged to M+1 as today, so
`cash_overspending_previous` counts only cash parts. Credit parts never touch Ready to Assign, and nothing
carries a negative Available.

**Identity checked by the property test**, for every month M:

`CashBalances + CreditIntoPlan = ReadyToAssign + Σ Available + CreditParts + AssignedLater + UncategorizedAvailable`

- **CashBalances:** rows on on-plan cash accounts dated ≤ M.
- **CreditIntoPlan:** rows on cards dated ≤ M that are inflows to Ready to Assign, rows into payment
  categories, or uncategorized rows.
- **CreditParts:** Σ `overspent.credit` in M.
- **AssignedLater:** assignments in months after M.
- **UncategorizedAvailable:** `uncategorized.available`, or 0.

The Lead's sentence lacks **CreditIntoPlan**: cashback to Ready to Assign, card rows put straight into a
payment category, and uncategorized card rows move plan money without moving cash. Without that term the
equation fails whenever such rows exist.

The groups in the read come out with the system group first, then by sort.

### Activity read: `repositories/plan-activity.ts` (new)

`planActivity` is one SQL query, summed per month. It groups by category, inflow flag, on_budget, type,
**the account id when the account is a card**, and an on-plan transfer flag (on a transfer row the category
is nulled). It drops the cash side of on-plan transfers, split parents and card Starting Balances.

`loadInput` now uses it. `txRepo.activityByMonth` stays, unused (another Build holds `transactions.ts`). The
number of queries is unchanged; see C2.

### Read model and tools

Groups gain `kind`. Categories gain `kind`, `account_id`, `cash_spending`, `credit_spending`, `overspent` and
`state`, in the REST month reads, `get_plan_month`, the views and Auto-Assign. `get_month_category` fills
`credit_activity`. There is no new operation. Tool descriptions change as in spec T9.

### Auto-Assign and views

`AutoAssignInput.payment` keeps `assigned` unchanged under the four strategies the Lead names. The preview
sums those four over the other categories only. The Overspent view already counts every `available < 0`, so
`plan-views.ts` is unchanged.

### Plan page (`apps/web/src/plan/**`)

- **Pill:** when `available < 0`, `state` picks the look. `credit_overspent` is yellow (`cautious credit`,
  with the `card` icon). Cash and mixed are red (`negative`).
- **Inspector:** Cash Spending and Credit Spending show the signed values. A
  `.inspector-message.{cautious|negative}` box holds the ticket's three sentences word for word, with the amounts
  as positive `money()` values ("$65.00").
- **The system group and payment rows:** the group comes first, with no "Add Category" button, and its name opens
  nothing. A payment row's name opens nothing. The inspector hides the pencil and the Target card, and the delete
  picker leaves payment categories out.
- **CSS** (`plan-panel.css`): `--calloutNegativeSubtleBackground: #4c0814`,
  `--calloutWarningSubtleBackground: #362c05`, `--calloutSubtleLabel: #fff`. The yellow pill reuses
  `.cautious`: the clone's `--statusCautious` (#daac00) is the source's hover colour, and its rest colour is
  #f6c91d. Target pills share that colour, so the choice is the Designer's.

## Downstream effects

- Once a plan has a card, every month read, the register's category picker and Reflect's lists (where a
  payment category has rows) show the group. No out-of-bounds file changes.
- `transfers.test.ts` "on-plan to on-plan changes nothing" is split: cash↔cash still changes nothing, while
  cash→card changes only that card's payment category.
- `e2e/plan-grid.fixtures.ts` and the schema tests' `cat()` gain the new fields.
- EXF-537, EXF-538 and EXF-539 build on `kind`, `account_id` and the payment activity.

## Out of scope

- The PAYMENT header, the payment rows' look and the payment inspector (EXF-537).
- Payment targets (EXF-538).
- Record Payment and the register's Payment pill (EXF-539).
- Register rules on categories.
- The "Overspent. $70.00 of $50.00" bar label.
- The chip's credit colour.
- Loans.

## Acceptance

Worker tests go through REST. Amounts are milliunits; Nov is 2026-11-01 and Dec is 2026-12-01. "Payment" means
the card's payment category.

1. **[532 AC1, AC6]** POST Credit Card "Visa" → the Nov read's `groups[0]` is `{name "Credit Card Payments",
   kind "credit_card_payments"}`, holding `{name "Visa", kind "credit_card_payment", account_id <Visa>}`.
   `change_log` has `create` rows for both with the actor. A Line of Credit made through MCP `create_account`
   joins the same group. A checking account adds nothing.
2. **[532 AC1, Lead]**
   - Renaming the card renames the category, with a log row.
   - Closing keeps the category.
   - Reopen, then delete the card (Starting Balance only) → the category is gone, with a log row; the group
     stays.
   - If the payment has Assigned 1000, DELETE answers 409 `payment_category_has_history` and nothing is
     written.
3. **[Lead]** These answer 422 with the spec's error names and write nothing; MCP gives tool errors for the
   same calls:
   - PATCH the group's name or hidden, or DELETE the group;
   - POST a category into the group;
   - PATCH a payment's name or hidden, or DELETE it;
   - PUT a target on it;
   - `reassign_to` a payment.

   The group's `collapsed` and a payment's `note` still answer 200.
4. **[532 AC2] Example A** (after case 6, same plan):
   - Pay 200.00 from Checking → payment activity and available 135000; balance −135000.
   - Pay 185.00 more → −50000 / −50000, `cash_overspent`; balance 50000.
   - Dec: payment available 0, and Dec `ready_to_assign` is 50000 lower than before that payment.
5. **[532 AC2, AC5] Example B** (LOC; Groceries assigned 300000):
   - −100000 → payment 100000.
   - +30000 → Groceries `credit_spending` −70000; payment 70000; balance −70000.
   - +15000 to Ready to Assign → `ready_to_assign` +15000; payment 70000; balance −55000.
   - +777770 to Ready to Assign → balance **722770** (the ticket prints +727.77; its own steps give
     −70.00 + 15.00 + 777.77 = +722.77, a misprint the Lead accepts); payment 70000.
6. **[535 AC1] Steps 1–11.**
   - Payment activity after each step: 120000, 170000, 170000, 170000, 190000, 210000, 210000, 210000,
     255000, 295000, 335000.
   - Categories:
     - Dining −30000 `credit_overspent` {cash 0, credit 30000}.
     - Empty −25000 `cash_overspent`, then −65000 {25000, 40000}, then −75000 {35000, 40000}.
     - Mixed and Order −20000 `credit_overspent`.
     - Step 8: Dining −45000; balance −335000.
     - Step 9: Groceries 255000 assigned / 135000 available; Dining 95000 / 0.
     - Step 11: Empty, Order and Mixed are 0, `ok`.
   - Dec after step 6: Dining, Empty, Mixed and Order 0; Groceries 180000; payment 210000; balance −320000.
7. **[535 AC2]** Mixed (cash first) and Order (credit dated 11-10, cash 11-12) give equal `available`,
   `overspent` and `state`, and each adds 20000 to the payment.
8. **[535 AC3]**
   - Checking −10.00 Empty lowers Dec `ready_to_assign` by exactly 10000; Nov is unchanged.
   - Visa −5.00 Dining leaves Dec unchanged.
9. **[535 AC4]** From step 8:
   - Covering Dining moves 45000 into the payment.
   - Assigning 35000 to Empty (−75000 → −40000) leaves the payment unchanged.
10. **[532 AC2, AC3] Example C** ("Debt Card", 1200000):
    - Balance −1200000; `ready_to_assign` unchanged; payment 0.
    - Assign 100000 → 100000.
    - Pay 100000 from Checking → activity −100000, available 0, balance −1100000.
    - −12000 Interest (assigned 20000) → payment 12000, Interest 8000, balance −1112000.
11. **[Lead, 535 AC6] Core, two cards:**
    - A −30000, B −10000, C assigned 0 → A 30000 / B 10000.
    - C assigned 10001 → A 22499 / B 7500.
    - A −10000, B −10000, C assigned 1 → the lower id takes 10000.
    - A −30000, B +5000 → X 25000 on A; A funds 5000, B −5000.
12. **[Lead] Core rules:**
    - A net refund gives no credit part.
    - A negative payment is 0 next month and appears in `cash_overspending_previous`.
    - Card↔card: the paid card −100, the paying card +100.
    - A cash advance gives +50.
    - A cash or card row into a payment is its activity, not credit spending.
    - An uncategorized card row stays in Uncategorized.
13. **[Lead, 535 AC7]** The identity holds every month for ≥ 200 seeded random plans: 1–3 cash accounts,
    1–3 cards, a tracking account, 6 months and every kind of row above. Every part is ≥ 0.
14. **[Lead, 532 AC8] Backfill:**
    - P1 gets one `kind` group and two payments, named for its two cards.
    - The hand-made group is unchanged, and the deleted card gets nothing.
    - P2 is unchanged.
    - A second run changes nothing.
15. **[535]**
    - `get_plan_month` equals REST for case 6, and `MonthDetailResponse` parses it.
    - `get_month_category` for Dining after step 8 gives credit −95000 and cash 0.
16. **[Lead] Auto-Assign:** a payment assigned 5000 in Oct goes to 5000 under Assigned Last Month, and is left
    unchanged and out of the preview sum under Spent Last Month.
17. **[535 AC5, browser] `e2e/credit-overspending.spec.ts`** (clock 2026-11-16, plan seeded through the API):
    - Credit row: `.available-pill.cautious.credit` "−$30.00" with `svg[data-icon=card]`.
    - Cash and mixed rows: `.negative`, no icon.
    - Each row's exact message after `realClick` on its checkbox.
    - The mixed row's lines read "−$25.00" and "−$40.00".
    - The chip reads "3 Overspent".
    - The same holds at 1024×700.
18. **[Lead, browser]**
    - "Credit Card Payments" is the first group.
    - It has no "Add Category" button, and its name opens no dialog.
    - The "Visa" name opens no dialog.
    - There is no "Edit category: Visa" button and no Target card.
19. **[535 AC8]** `e2e/plan-switch.spec.ts` passes unchanged.
20. **Compare, live:** on the test plan's Plan page (dark, viewport as found, one ordinary category ticked),
    the clone's Available Balance card shows the same four lines in the same order.

    Everything else is not compared: the yellow pill and its icon, the mixed state, the messages and their
    boxes, line values, the group's look, partial covers, and every decision above.

## Carry-over (EXF-532, EXF-535, second Build)

The earlier branch (`a8ed5b7`) was merged into this Thread on main `8ec621e` (`f3d393c`). The design above stands.
The Architect did not open the source app in this step. Tasks for what follows are in the spec's **T14**.

**C1. The merge.** It was clean: 55 files, +3,422 −122 against main. `packages/schema/test/register.test.ts` keeps
main's line and the branch's new `cat()` and group fields. Main did not change `activityByMonth` or anything that
builds a month read. The Architect ran `pnpm check` on `f3d393c`: exit 0, 112 files, 1,532 tests. No browser
spec was run.

**C2. D1 calls** (conventions, "Services: D1 calls"; read from the code; a batch is one call):
- **Month read** (`getPlanMonth`: the REST month, `get_plan_month`, month totals, `get_month_category`, moves):
  8 calls, the plan plus 7 parallel reads in `loadInput`. `getPlanMonths` also makes 8, and month lists
  (`listPlanMonths`, any range) make 6. This Build adds 0: `planActivity` is one query, as `activityByMonth` was.
- **Create a card** (`insertAccountWithStartingBalance`, `createAccount` seam): +1 `findPaymentGroup`. Because
  `create_accounts_from_bank` calls the create once per linked account, **this read grows with the request's
  accounts. Fix:** drop the read from both paths, so `paymentCreateStmts` always emits its group insert. That
  insert is already guarded by "no live payment group in the plan", and its log row is guarded on the row
  existing. `services/account-links.ts` already reads per account, but that is not this Build's work and it is
  not edited.
- **Rename a card:** +0, because the statements go into the account's batch. **Delete a card:** +2 per attempt
  (`findPaymentCategory` and `historyOf`, each one query).
- **Locks:** +0, because they test `kind` on the row the handler already reads.

None of these grows with accounts, categories, months or rows once the fix is in. The counting test is
`apps/worker/test/credit-call-count.test.ts`, which copies `counting()` from `bulk-call-count.test.ts` (T14.1–2).

**C3. Example B, step 4.** The balance is 722770, as case 5 now says. The test and the build note stay.

**C4. A partly covered mixed category loses its cash part first.** The Lead accepts this. The core test that
shows it (Empty at step 8, assigned 35000 → `{cash 0, credit 40000}`) gets that rule in its name. The Worker
test "covering only the cash part…" covers a cash-only category, so it is renamed for that, and a new Worker
test with the rule in its name is added (T14.3).

**C5. The narrow window.** A new browser test runs at 1024×700 with the largest amounts in the tickets'
examples (1,200.00 from C, 777.77 from B). For the yellow pill with its icon, the red pill, the three messages
and the Cash Spending and Credit Spending lines, it checks: `scrollWidth ≤ clientWidth`, the element's box is
inside its parent's box, and it does not overlap its neighbour (T14.4). If a check fails, the fix is CSS in
`apps/web/src/plan/**`. The squeezed category name (EXF-622) is not this Build's.

**C6. Backfill with names taken.** The group insert runs per `DISTINCT budget_id` that has no live `kind` group.
The category insert joins only the `kind = 'credit_card_payments'` group. Neither compares names, and the only
unique indexes are the two partial ones (`budget_id` where `kind` is set, and `account_id`). So two cards named
like an ordinary group and an ordinary category still get one system group and one payment category each. The
test lacks this case, and T14.5 adds it.

**C7. Out of bounds.** `git diff --name-only origin/main` over the files the Lead lists printed nothing.
Carry-over work stays within the manifest.

**Acceptance added by the carry-over:**

21. **[C2]** For 10 and for 100 categories (with 1 and 10 cards), the month read makes 8 calls,
    `getPlanMonths` 8 and `listPlanMonths` 6. Creating a card makes as many calls as creating a checking
    account, with 0 cards in the plan and with 10. Renaming or deleting a card, and a refused lock, make equal
    counts at 10 and at 100.
22. **[C4]** A Worker test and a core test show that a partly covered mixed category loses its cash part first.
    The values are in T14.3.
23. **[C5, browser, 1024×700]** No checked element overflows its box or overlaps its neighbour (T14.4).
24. **[C6]** Cards "ZZ Bills" and "ZZ Rent" sit next to an ordinary group "ZZ Bills" holding "ZZ Rent". The
    backfill gives one `kind` group and two payment categories, and the ordinary rows are unchanged. A second run
    changes nothing.

## Build notes (Implementer)

- **Ticket arithmetic:** example B step 4 prints a balance of +727.77. Its own steps give -70.00 + 15.00 + 777.77 = +722.77, and the Worker test asserts 722770. The payment Available stays 70.00.
- **Property test:** 250 seeded plans in `packages/core/test/credit-engine.test.ts`. Dropping `- X_K` from Funded makes 254 tests fail; it was restored.
- **Tests written with the code:** the engine, lifecycle and backfill tests were written together with their code. Only the Funded mutation was run failing first.

## Manifest

touches: [apps/worker/migrations/20261116101100_credit_payment_categories.sql, apps/worker/src/db/schema/categories.ts, apps/worker/src/db/schema/category-groups.ts, apps/worker/src/repositories/plan-activity.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/repositories/category-groups.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/services/credit-payments.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/categories.ts, apps/worker/src/services/category-delete.ts, apps/worker/src/services/default-categories.ts, apps/worker/src/services/targets.ts, apps/worker/src/services/auto-assign.ts, apps/worker/src/services/months.ts, apps/worker/src/routes/categories.ts, apps/worker/src/routes/category-groups.ts, apps/worker/src/routes/targets.ts, apps/worker/src/routes/accounts.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/mcp/tools/categories.ts, apps/worker/src/mcp/tools/category-groups.ts, apps/worker/src/mcp/tools/targets.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/auto-assign.ts, apps/worker/test/credit-engine.test.ts, apps/worker/test/credit-payments.test.ts, apps/worker/test/credit-migration.test.ts, apps/worker/test/credit-call-count.test.ts, packages/schema/test/register.test.ts, apps/worker/test/transfers.test.ts, packages/core/src/budget-engine.ts, packages/core/test/budget-engine.test.ts, packages/core/test/credit-engine.test.ts, packages/schema/src/months.ts, packages/schema/src/month-totals.ts, packages/schema/src/auto-assign.ts, packages/schema/test/plan-views.test.ts, packages/schema/test/month-totals.test.ts, packages/schema/test/assigned-edit.test.ts, packages/schema/test/auto-assign.test.ts, apps/web/src/plan/**, e2e/plan-grid.fixtures.ts, e2e/credit-overspending.spec.ts, docs/credit-engine-design.md, docs/credit-engine-spec.md, docs/budget-engine-design.md, docs/README.md]
shared: [packages/core/src/budget-engine.ts — card classification, the credit/cash split, payment category activity and the new read-model fields (Lead's note 2); account-types.ts and targets.ts unchanged]
migrations: 1

**Outside the earlier list:** `services/credit-payments.ts` (statements and locks in one place),
`transfers.test.ts` (changes by design), `month-totals.ts` (fills `credit_activity`),
`packages/schema/test/register.test.ts` (fixture fields), and the Carry-over's
`apps/worker/test/credit-call-count.test.ts`. Unchanged: `plan-views.ts`, `packages/schema/src/categories.ts`,
`apps/web/src/api/months.ts`, `services/account-links.ts`.
