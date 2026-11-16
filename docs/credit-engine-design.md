# Credit engine design (EXF-532, EXF-535)

This design gives each credit account (Credit Card, Line of Credit) a **payment category** in the system group
"Credit Card Payments". Funded card spending moves into that category. An overspent category splits into a
**credit** part (yellow: it becomes card debt) and a **cash** part (red: it is taken from next month's Ready to
Assign). On the Plan page this means the yellow and red pills and the inspector's three messages. Interfaces,
error texts and tasks are in [credit-engine-spec.md](credit-engine-spec.md).

## Preflight

The preflight failed on its own platform files. Its output, word for word (rerun by the Architect):

```
/workspace/.exfab/bin/preflight.sh: line 2: /workspace/.exfab/bin/lib.sh: No such file or directory
tee: /preflight.md: Permission denied
PREFLIGHT FAILED:
- /request.json is missing: the intake step did not write it.
```

`/workspace/.exfab/bin/lib.sh` and `/workspace/.exfab/bin/source_check.sh` are missing, so `$X` was empty.
`/workspace/.exfab/request.json` exists and lists both tickets. Nothing was recreated. Profile values come from
`clone.profile.json`. The browser was up, and the Clerk's tab was on the test plan's Plan page.

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

**What this step did in the source.** All of it happened in the Clerk's tab `18843FD0…` over CDP, from the
sub-agent:
- It read stylesheet rules and computed styles.
- It hovered the first ordinary category's pill.
- It clicked that row's checkbox to tick it, then again to untick it. On the tick, the app opened the row's
  Assigned cell by itself. Nothing was typed and the value did not change.

**Captures:**
- `shot1_uncropped.png`: `page.screenshot({path})`, no options, tab in front, 1600×813. Deleted.
- `shot1_grid_inspector_cropped.png`: the same image with the sidebar cropped off. Kept.

The viewport was 1600×813 both before and after. This step saved nothing, changed neither the theme nor the
tab's size, and opened neither the plan menu, nor Bank Connections, nor Add Account, nor an account, nor
another plan.

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
- **When a mixed category is partly covered, the cash part falls first.** Rule 2's `X = min(−A, S)` holds
  the credit part at S while −A > S. Rule 5 and the Lead's note ("credit part first") disagree, but no partial
  mixed cover was observed: step 10 is a full cover and gives +40 under both readings. The observed formula
  wins, and it makes cases 6 to 9 exact. Covering an all-credit category moves each 1.00 to the payment
  category (step 9), and covering only cash leaves the card alone (EXF-535 AC4).

## Approach

### Data: `20261116101100_credit_payment_categories.sql` (additive)

The migration adds nullable `category_groups.kind` (`credit_card_payments`), `categories.kind`
(`credit_card_payment`) and `categories.account_id`, and two unique partial indexes over live rows:
- one system group per plan;
- one payment category per account.

Then two idempotent `INSERT … SELECT` statements backfill existing plans:
1. a system group, at sort = lowest − 1, for each plan with a live credit account and no live system group;
2. a payment category for each live credit account (closed included) without one. It takes the account's
   name and is sorted in account order.

Ids are version-4 UUIDs built in SQL. A plan without cards gets nothing. A group the owner named "Credit Card
Payments" by hand keeps `kind` null and stays ordinary. **The backfill writes no history rows**, since a
migration has no actor.

**Backfill test, "before":** as in `payees-migration.test.ts`:
1. Build plan P1 through REST, with a Credit Card, a Line of Credit, a deleted card, a checking account and a
   hand-made ordinary "Credit Card Payments" group. Build plan P2 with checking only.
2. Hard-delete P1's rows with `kind IS NOT NULL`. This is the pre-migration state.
3. Run the migration's `INSERT` statements (from `env.TEST_MIGRATIONS`) twice.

### Lifecycle and locks: `services/credit-payments.ts` (new)

The new service returns unexecuted statements, each with its `change_log` row and the caller's actor:
- **Create.** `insertAccountWithStartingBalance` (Add Account, `create_account` and accounts made from a bank
  connection) and the `createAccount` test seam append the system group, when the plan has none, and the
  payment category. Both are guarded on the new account existing, in the same batch.
- **Rename.** `updateAccount` renames the category in the same batch, before the account row, under the same
  guard.
- **Delete.** `deleteAccount` soft-deletes the category under the account delete's guard plus `noHistory`.
  The group stays.

Locks (class `PaymentLocked`) are checked in the services, so REST and MCP agree:
- `payment_group_locked` (422): rename, hide or delete the group, or add a category to it.
- `payment_category_locked` (422): rename, hide or delete a payment category.
- `payment_category_target` (422): set a target on a payment category.

Still allowed: collapsing the group, a payment category's note, assigning, moves, covers and Auto-Assign. No
move or reorder operation exists, so nothing there needs refusing.

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

How it follows (cumulative to M):
- Σ Available + ReadyToAssign = Inflows + CashCatAct + Transfers + Direct − AssignedLater − X_M − Σ_{m<M} UncatNeg.
  - Uncarried negatives cancel the charged cash parts, except past X.
  - Σ Funded cancels the card category activity, except X.
- CashBalances = Inflows_cash + CashCatAct + Direct_cash + Uncat_cash + Transfers.
- UncategorizedAvailable = Uncat + Σ_{m<M} UncatNeg.

The groups in the read come out with the system group first, then by sort.

### Activity read: `repositories/plan-activity.ts` (new)

`planActivity` is one SQL query, summed per month. It groups by category, inflow flag, on_budget, type,
**the account id when the account is a card**, and an on-plan transfer flag (on a transfer row the category
is nulled). It drops the cash side of on-plan transfers, split parents and card Starting Balances.

`loadInput` now uses it. `txRepo.activityByMonth` stays, **unused**, because `transactions.ts` belongs to
another Build. **Queries per month read:**
- one month: 8 before, 8 after (plan, groups, categories, assignments, notes, activity, targets, snoozes);
- month lists: 6 before, 6 after.

### Read model and tools

- **Groups** gain `kind`. **Categories** gain `kind`, `account_id`, `cash_spending`, `credit_spending`,
  `overspent` and `state`. All of these reach the REST month reads, `get_plan_month`, the views and
  Auto-Assign.
- **`get_month_category`** now fills `credit_activity`.
- **No new operation.** The Category and CategoryGroup resources are unchanged.
- **Tools whose descriptions change** are listed in the spec (T9). They are `get_plan_month` and
  `get_month_category`, which gain the credit/cash sentence, plus the account, category, group, target and
  Auto-Assign tools.

### Auto-Assign and views

`AutoAssignInput.payment` keeps `assigned` unchanged under the four strategies the Lead names. The preview
sums those four over the other categories only. The Overspent view already counts every `available < 0`, so
`plan-views.ts` is unchanged.

### Plan page (`apps/web/src/plan/**`)

- **Pill:** when `available < 0`, `state` picks the look. `credit_overspent` is yellow (`cautious`) with the
  `card` icon and class `credit`. Cash or mixed is red (`negative`).
- **Inspector:**
  - Cash Spending and Credit Spending show `signed(cash_spending)` and `signed(credit_spending)`.
  - A `.inspector-message.cautious` or `.inspector-message.negative` box holds the ticket's three sentences
    word for word, amounts as `money()` of the positive parts ("$65.00").
- **The system group and payment rows:**
  - The group shows first.
  - It has no "Add Category" button, and its name opens nothing.
  - A payment row's name opens no edit popover.
  - The inspector hides the pencil and the Target card for a payment category.
  - The delete dialog's picker leaves payment categories out.
- **Custom properties**, in `plan-panel.css`:
  - `--calloutNegativeSubtleBackground: #4c0814`
  - `--calloutWarningSubtleBackground: #362c05`
  - `--calloutSubtleLabel: #fff`
- **Pill colour:** the yellow pill reuses `.cautious`. The clone's `--statusCautious` (#daac00) is the
  source's hover colour; the source's rest colour is #f6c91d. Target pills share it, so that choice is left
  to the Designer.

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
   - +777770 to Ready to Assign → balance 727770; payment 70000.
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

## Manifest

touches: [apps/worker/migrations/20261116101100_credit_payment_categories.sql, apps/worker/src/db/schema/categories.ts, apps/worker/src/db/schema/category-groups.ts, apps/worker/src/repositories/plan-activity.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/repositories/category-groups.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/services/credit-payments.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/categories.ts, apps/worker/src/services/category-delete.ts, apps/worker/src/services/default-categories.ts, apps/worker/src/services/targets.ts, apps/worker/src/services/auto-assign.ts, apps/worker/src/services/months.ts, apps/worker/src/routes/categories.ts, apps/worker/src/routes/category-groups.ts, apps/worker/src/routes/targets.ts, apps/worker/src/routes/accounts.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/mcp/tools/categories.ts, apps/worker/src/mcp/tools/category-groups.ts, apps/worker/src/mcp/tools/targets.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/auto-assign.ts, apps/worker/test/credit-engine.test.ts, apps/worker/test/credit-payments.test.ts, apps/worker/test/credit-migration.test.ts, apps/worker/test/transfers.test.ts, packages/core/src/budget-engine.ts, packages/core/test/budget-engine.test.ts, packages/core/test/credit-engine.test.ts, packages/schema/src/months.ts, packages/schema/src/month-totals.ts, packages/schema/src/auto-assign.ts, packages/schema/test/plan-views.test.ts, packages/schema/test/month-totals.test.ts, packages/schema/test/assigned-edit.test.ts, packages/schema/test/auto-assign.test.ts, apps/web/src/plan/**, e2e/plan-grid.fixtures.ts, e2e/credit-overspending.spec.ts, docs/credit-engine-design.md, docs/credit-engine-spec.md, docs/budget-engine-design.md, docs/README.md]
shared: [packages/core/src/budget-engine.ts — card classification, the credit/cash split, payment category activity and the new read-model fields (Lead's note 2); account-types.ts and targets.ts unchanged]
migrations: 1

**Outside the Lead's list:**
- `services/credit-payments.ts` keeps the payment statements and locks in one place.
- `transfers.test.ts` changes by design.
- `month-totals.ts` fills `credit_activity`.

**Unchanged:** `plan-views.ts`, `packages/schema/src/categories.ts` and `apps/web/src/api/months.ts`. No
file from note 9 changes.

## Build notes (Implementer)

- **Ticket arithmetic:** example B step 4 prints a balance of +727.77. Its own steps give -70.00 + 15.00 + 777.77 = +722.77, which is what the Worker test asserts (722770); the payment Available stays 70.00 as the ticket says.
- **Activity read:** `repositories/plan-activity.ts` replaces `activityByMonth` in `loadInput`; `activityByMonth` stays, unused. Queries per month read: 8 before, 8 after (list reads 6 and 6).
- **Property test:** 250 seeded plans in `packages/core/test/credit-engine.test.ts`, checking the identity above plus "each part >= 0 and cash + credit = -available". Dropping `- X_K` from Funded makes 254 tests fail; it was restored.
- **Partial cover of a mixed category:** as decided above, the cash part falls first (a partial cover leaves the credit part and the card alone until the cash part is gone).
- **Tests written with the code:** the engine, lifecycle and backfill tests were written together with their code, not run against the code before the fix. Only the Funded mutation above was run as a failing-first check.
- **Outside the Lead's list:** `packages/schema/test/register.test.ts` (fixture needs the new required fields).
