# Card payments and the Plan page at 1024 px: implementation spec

The design and the acceptance cases are in [card-payments-design.md](card-payments-design.md). Amounts are
milliunits. Run `pnpm check` after each task group. No migration and no dependency.

**Out of bounds** (another Build holds them):
- `apps/web/src/register/**`, `pages/account.tsx`, `pages/accounts.tsx`, `apps/web/src/reflect/**`,
  `api/scheduledTransactions.ts`;
- `services/transactions.ts`, `services/plaid-sync.ts`, `scheduled.ts`, anything named `scheduled-transactions`,
  `packages/schema/src/recurrence.ts`;
- `e2e/register*.spec.ts`, `e2e/age-of-money.spec.ts`, `e2e/income-expense-narrow.spec.ts`;
- every `paths.always_overlap` file, `apps/web/src/shell/**`, `router.tsx`, `api/client.ts`, `app.ts`,
  `mcp/server.ts`.

`mcp-timestamps.test.ts` gets exactly one line (T5).

## Interfaces

### Core: `packages/core/src/card-payment.ts` (new)

```ts
export type CardPaymentState = "paid_off" | "overpaid" | "enough" | "overspent_categories" | "underfunded";
export interface CardFlow {            // one card, one month (month = YYYY-MM-01)
  accountId: string; month: Month;
  starting: Milliunits;               // Starting Balance rows (counted in Prior even in their own month)
  outflows: Milliunits;               // ≤ 0, other rows < 0
  inflows: Milliunits;                // ≥ 0, other rows > 0
  paid: Milliunits;                   // ≥ 0, the part of inflows with a transfer account
}
export interface CardPayment {
  state: CardPaymentState; underfunded: Milliunits; overspent_categories: Milliunits;
  current_balance: Milliunits; prior_balance: Milliunits; spending_and_outflows: Milliunits;
  interest_charges: Milliunits; payments_and_inflows: Milliunits; available: Milliunits; paid: Milliunits;
}
/** flows: every CardFlow of ONE card (any months); month: the month shown. */
export function cardPayment(flows: readonly CardFlow[], month: Month, available: Milliunits,
  overspentCategories: Milliunits): CardPayment;
```

**Rules:**
- prior = Σ(starting + outflows + inflows) over months < month, plus `starting` of month.
- spending = outflows(month), payments = inflows(month), interest = 0, current = prior + spending + interest +
  payments.
- underfunded = max(0, −current − available).
- state, in this order: available < 0 → `overpaid`; current ≥ 0 → `paid_off`; underfunded = 0 → `enough`;
  overspentCategories > 0 → `overspent_categories`; else `underfunded`.
- Use `addMilliunits`, and never produce −0 (`neg`).

### Core: `budget-engine.ts`
- `EngineInput.cardFlows?: CardFlow[]`.
- `MonthCategoryDetail.payment: CardPayment | null`.
- `MonthState` gains `creditParts: Map<accountId, Milliunits>`, Σ over ordinary categories of `shares.get(k)`,
  which is already computed in `timeline`.
- `computeMonth`: for a category with `kind === "credit_card_payment"`,
  `payment = cardPayment(flowsOf(accountId), month, s.available, state.creditParts.get(accountId) ?? 0)`. For
  others, `null`. Group the flows by account once in `prepare`.
- `services/months.ts`'s `_sameShape` check must keep compiling.

### Schema
- `packages/schema/src/months.ts`:
  - `CardPayment` zod object (`.openapi("CardPayment")`), all `Milliunits` plus
    `state: z.enum([...5])`;
  - `MonthCategoryDetail.payment: CardPayment.nullable()`;
  - export `type CardPayment`.
- `month-categories.ts`: `CategoryMonth.payment: CardPayment.nullable()`.
- `month-totals.ts`: `categoryMonth` copies `payment: c.payment`.
- `auto-assign.ts`:
  - `AUTO_ASSIGN_STRATEGIES` gains `"paid_last_month"` and `"average_paid"`, in that order, after
    `average_spent`.
  - `AutoAssignPreview` gains `paid_last_month` and `average_paid`.
  - `MonthFigures` gains `paid: number`. `historyFigures` also returns `last_paid` and `average_paid` (same months
    and `meanCent`; paid ≥ 0, no `spending()`).
  - `AutoAssignInput` gains `last_paid`, `average_paid` and `payment_underfunded` (0 unless the service sets it).
  - `PAYMENT_SKIPS` = `reduce_overfunding`, `spent_last_month`, `average_spent`. New
    `ORDINARY_SKIPS = ["paid_last_month","average_paid"]`: an ordinary category keeps its Assigned there.
  - `autoAssignResult`:
    - `underfunded` for a payment category returns `assigned + payment_underfunded`;
    - `paid_last_month` returns `last_paid`, and `average_paid` returns `average_paid`.
  - New `hiddenAmounts(cs: readonly HiddenInput[]): { underfunded; reduce_overfunding }`, where
    `HiddenInput = { assigned; target; payment: boolean; payment_underfunded }`:
    - underfunded = Σ over non-payment categories of `active(c)?.to_go_this_month ?? 0`, plus Σ
      `payment_underfunded`;
    - reduce_overfunding = Σ over non-payment categories of `removable`.
  - `autoAssignPreview` uses `hiddenAmounts` for those two fields. `paid_last_month` and `average_paid` are sums
    over payment categories only.
  - `autoAssignOptions(p, scope: "one" | "many" | "payment", hidden?: {underfunded; reduce_overfunding})`:
    - The row set is decided by `hidden ?? p`: Underfunded and Reduce Overfunding are left out when 0, in every
      scope (EXF-624).
    - `"payment"`: group 2 is Assigned Last Month, **Paid Last Month**, Average Assigned, **Average Paid** (no
      Spent rows). Group 3 has no Reduce Overfunding. Labels are singular.
    - Titles for the new rows: Paid Last Month `null`; Average Paid "Assign your historical average paid to this
      card."
  - New `autoAssignHeight(options): number` = 88 + 32·n + 2·(n − g) + 16·(g − 1), where g is the number of
    non-empty groups (the unit test pins it; e2e does not import packages, so specs use the numbers 352/304/386).
  - New `monthHiddenInputs(detail: MonthDetail, ids: string[]): HiddenInput[]`. It sets `payment_underfunded` to
    `c.payment.underfunded` only when `ids.length === 1` and that category is a payment category. The web uses
    it; the service builds the same values from its own reads.

### Worker
- **`repositories/card-flows.ts` (new):** `cardFlows(db, budgetId, before: string): Promise<CardFlow[]>`. One
  `select … group by account_id, substr(date,1,7)`:
  - joins `accounts` (live, `type in CREDIT_ACCOUNT_TYPES`, closed included) and left-joins `payees`;
  - filters `transactions.budget_id = ?`, `countsInBalance()` (live, `parent_transaction_id is null`) and
    `date < before`;
  - `starting = sum(case when payees.system='starting_balance' then amount else 0 end)`;
  - `outflows` and `inflows` sum the other rows with amount < 0 and amount > 0;
  - `paid` sums the other rows with amount > 0 and `transfer_account_id is not null`;
  - wrap null-able booleans in `coalesce`, as `plan-activity.ts` does.
- **`services/months.ts`:** `loadInput(db, id, before, full = false)`. When `full` is true it adds `cardFlows` to
  the same `Promise.all` and passes `cardFlows` into the input. `getPlanMonth` and `getPlanMonths` pass `true`;
  `listPlanMonths` passes nothing.
- **`services/month-categories.ts`:** new `getCardPaymentStatus(env, budgetId, month, accountId)`. It does one
  `getPlanMonth` and finds the category with `account_id === accountId`. If there is none, it throws
  `NotFound("Account")`. It returns `{ account_id, category_id, name, ...payment }`.
- **`services/auto-assign.ts` `loadScope`:**
  - figures gain `paid: p?.payment?.paid ?? 0`;
  - `payment_underfunded = ids.length === 1 && c.payment ? c.payment.underfunded : 0`.
- **`mcp/tools/month-categories.ts`:** new tool `get_card_payment_status`.
  - Input: `{ budget_id: Id, month: AssignedMonth, account_id: Id }`.
  - Description: `${MONTH} ${MONEY}`, "Returns { account_id, category_id, name, state, underfunded,
    overspent_categories, current_balance, prior_balance, spending_and_outflows, interest_charges,
    payments_and_inflows, available, paid }", the five states, and the two formulas.
  - `get_month_category`'s description gains `payment`.
- **`mcp/tools/months.ts`:** `get_plan_month`'s description gains "payment categories also carry payment (…,
  null for others)".
- **`mcp/tools/auto-assign.ts`:** the strategy text lists the two new strategies. The sentence "left out of
  underfunded…" becomes: "…left out of reduce_overfunding, spent_last_month and average_spent, and of underfunded
  unless the payment category is the only category in scope; paid_last_month and average_paid change only
  payment categories."
- **Coverage:** `apps/worker/test/mcp-coverage/months.ts` gains `export const toolsWithoutOperation = {
  get_card_payment_status: "Keyed by account: the payment object of GET
  /budgets/{budget_id}/months/{month}/categories/{category_id} for the card's payment category" }`.

### Web
- **`format.ts` `categoryPill`, for payment categories:** tone is `negative` if available < 0, `cautious` if
  `payment?.underfunded > 0`, `positive` if available > 0, else `zero`. Icon `null`. Title `paymentPillTitle`.
- **`rows.tsx`:**
  - Payment rows pass no `ProgressBar` in bars mode.
  - `GroupRow` with `g.kind`: the Available cell renders `<button className="payment-help">` (QuestionCircleIcon
    12 px + "PAYMENT") above the total, with accessible name "PAYMENT".
  - `.category-name`: `flex: 0 0 auto; max-width: 100%`.
  - `.status-label`: `flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space:
    nowrap`, and `title` = the full status text.
- **New `PaymentHelpDialog.tsx`:** a modal with the DeleteDialog pattern (`role="dialog"`, `aria-modal`, labelled
  by its h2 "Using Credit Cards"), the design's two paragraphs, a **Show More** toggle (aria-expanded) and a
  **Got it!** button. Escape and Got it! close it and return focus to the button.
- **New `panel/PaymentInspector.tsx`**, rendered by `CategoryInspector` when `c.kind === "credit_card_payment"`.
  Cards in order:
  - **Payment** (`section.panel-card.payment-card`, no roll-up; title "Payment"). Copy, with `{name}` = `c.name`
    and `{x}` = `money()` of a positive amount:
    - `paid_off`: `CheckCircleFillIcon`, h3 "Your {name} is paid off!", p "Being debt free is a wonderful thing."
    - `overpaid`: `WarningTriangleIcon` (negative colour), p "You sent more to {name} than you had set aside for
      the payment."
    - `enough`: h3 "You have enough money to pay off your current balance!", p "You can make this payment
      anytime.", button **Record Payment** → `navigate(accountPath(budgetId, c.account_id))`.
    - `overspent_categories`: icon + h3 "Overspent Categories", bar, p "Cover {overspent_categories} in overspent
      categories in order to pay off your current balance.", button **Cover Overspent Categories** →
      `onView("overspent")`.
    - `underfunded`: `WarningTriangleIcon` + h3 "Underfunded", bar, p "You need to assign {underfunded} more to
      pay off your current balance."
    - Bar: `.payment-bar` track `--budgetBarBackground`, fill width `clamp(0, available / −current, 1)` in
      `--budgetBarUnderfunded`, height .25rem, margin 1rem 0. Buttons: width 100%, max-width 25rem.
  - **Total Underfunded** (if underfunded > 0) and **Overspent Categories** (if overspent_categories > 0): static
    cards, title left and `money()` right.
  - **Current Balance**: a `PanelCard` (collapsible, open at first). `right` = `signed(current_balance)`. Body:
    Prior Balance; `h3.this-month` "Activity This Month" (600, margin-top 16px); Spending and Outflows; Interest
    Charges; Payments and Inflows (`signed()`).
  - **Available for Payment**: a `PanelCard` (collapsed at first). `right` = the display pill (payment tone).
    Roll-up padding `16px 8px 16px 16px`. Body: Cash Left Over From Last Month, Assigned This Month, Activity.
  - Then the `autoAssign` node and `NotesCard`.
  - Collapsed state lives in `PlanPanel`'s `collapsed` object (`balance`, `paymentBalance`, `forPayment`).
- **`PlanPanel` and `pages/plan.tsx`:** `PlanPanel` gains `onView: (v: PlanView) => void`; `pages/plan.tsx` passes
  `setView`. `pages/plan.tsx` calls `usePlanLayout(bodyRef)` and spreads its attributes on `.plan-body`.
- **New `planLayout.ts`:**
  - `PANEL_MIN = 320`, `GRID_MIN = 428` (440 in the first draft; see polish P2), `NARROW_BELOW = 562`, `FOLD_BELOW = 620`.
  - `planLayout(body, grid) → { fold: body < FOLD_BELOW, narrow: grid < NARROW_BELOW }`.
  - `usePlanLayout(ref)` uses one ResizeObserver on the body and its `.plan-grid` child, and returns
    `{ "data-fold"?: "", "data-narrow"?: "" }`.
  - When folded, `PlanPanel` renders `aside` with `hidden`.
- **`panelWidth.ts`:** `MIN_PANEL_WIDTH = 320`.
- **`plan-panel.css` `.plan-inspector`:** `width: clamp(var(--panel-min), var(--panel-width, 33%),
  max(var(--panel-min), min(60%, calc(100% - var(--grid-min)))))`, with `--panel-min: 320px` and `--grid-min:
  428px` (polish P2) declared on `.plan-body` (plan-grid.css). Add `.plan-body[data-fold] .plan-inspector { display: none }`.
- **`plan-grid.css`:**
  - `.plan-grid { min-width: 0; overflow: auto }`, and its `[role=treegrid]` gets `min-width: var(--grid-min)`.
  - Under `.plan-body[data-narrow]`:
    - `.cell-assigned { padding-left: 4px; min-width: 6.5rem }`;
    - `.cell-activity { padding-left: 4px; min-width: 5.25rem }`;
    - `.cell-available` keeps `min-width: 7.5rem`.
- **Measured widths** (Figtree, 14px, tabular): "−$1,977.77" 75.6, "$1,360.00" 66.8, "Assigned Last Month" 132.4,
  "Reset Assigned Amounts" 158.3, "Available Balance" (600) 110.7, "Available for Payment" (600) 139.1.
- **`AutoAssignOptions.tsx`:**
  - `const detail = useMonth(budgetId, month).data`.
  - ids = `scope.categoryIds` or `viewCategories(detail, scope.view)`.
  - If `detail` is loaded and ids is empty → the empty message at once. scope = `"payment"` when one id is a
    payment category, `"one"` for one id, else `"many"`.
  - `hidden = hiddenAmounts(monthHiddenInputs(detail, ids))`.
  - While the preview loads: `autoAssignOptions(BLANK, scope, hidden)` disabled with "–". After it loads:
    `autoAssignOptions(preview, scope, hidden)`.
  - Without `detail` (never on the Plan page): today's placeholder.
- **`plan-views.css`:**
  - remove `.auto-assign-list { min-height }`;
  - `#panel-auto-assign { padding-bottom: 16px }`;
  - `.auto-assign-option { gap: 4px }`, `> span { min-width: 0; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap }`, `> strong { flex: none }`.
- **New colours** (in `plan-panel.css` `:root`, source dark values): `--budgetBarUnderfunded: #f6c91d`,
  `--budgetBarBackground` (use the clone's existing track colour if one exists, else `#3c3e53`),
  `--calloutWarningAccent: #f6c91d`, `--calloutNegativeAccent: #bf2e3b`. Icons are our own (`icons.tsx`); no new
  icon files.

## Tasks

**T1. Core.** Write `card-payment.ts` and wire it into `budget-engine.ts`.
- New `packages/core/test/card-payment.test.ts`:
  - each state and its boundary (available 0 with current 0 → `paid_off`; underfunded exactly 0 → `enough`);
  - Starting Balance dated in the month counts in prior;
  - the identity over 200 seeded random flow sets.
- Existing core tests that deep-equal a category gain `payment: null`.

**T2. Schema.** Months, month-categories, month-totals, auto-assign.
- Unit tests in `packages/schema/test/auto-assign.test.ts`:
  - `hiddenAmounts`;
  - `autoAssignOptions` hides 0 rows in all three scopes;
  - the "payment" list order;
  - `autoAssignHeight` gives 352 for 7/3, 304 for 6/2 and 386 for 8/3;
  - `paid` history figures.
- Fixtures in `packages/schema/test/*` and `e2e/plan-grid.fixtures.ts` gain `payment: null`.

**T3. Repository and services.** `card-flows.ts`, `loadInput(full)`, `getCardPaymentStatus`, the Auto-Assign
scope.

**T4. Worker tests.** New `apps/worker/test/card-payments.test.ts`, through REST (helpers from
`credit-engine.test.ts` / `account-helpers.ts`): design cases 1–9 and 11. Each case also asserts the identity and
the underfunded formula.

**T5. MCP.**
- Add the tool and update the three descriptions.
- Add the coverage `toolsWithoutOperation` line.
- In `apps/worker/test/mcp-timestamps.test.ts` add **one line**: `NOT_CALLED.get_card_payment_status = "returns
  amounts only, no timestamp; the fixture has no credit account"`. Do it in the object literal; nothing else in
  that file changes.

**T6. D1 calls.** In `apps/worker/test/credit-call-count.test.ts`:
- 8 → **9** for `getPlanMonth` and `getPlanMonths`; `listPlanMonths` stays 6;
- add `getMonthCategory` = 9 and `getCardPaymentStatus` = 9;
- all at SIZES 10 and 100 (1 and 10 cards), with each count equal across sizes.

**T7. Grid.** Pill colours, the PAYMENT button and `PaymentHelpDialog`, no bar on payment rows, the name and
status rule.

**T8. Inspector.** `PaymentInspector`, `onView` and the colours.

**T9. Layout.** `planLayout.ts`, `usePlanLayout`, the CSS above and `MIN_PANEL_WIDTH`. At 1440×900 check by hand
that the panel stays 33% and nothing is narrow or folded.

**T10. Auto-Assign UI.** `AutoAssignOptions` rows from month data, the CSS, the empty view at once, and the
popover's Auto tab (same component).

**T11. `e2e/support/real-click.ts`:** `still` also requires `b.height === next.height`. This is the only change to
that file.

**T12. Specs.**
- New `e2e/card-payments.spec.ts` (design cases 13–16, 1440×900).
  - Seed through the API: one plan with the cards "ZZ Enough", "ZZ Clear", "ZZ Debt" (Starting Balance −1,200.00),
    "ZZ Over" and "ZZ Spent" (the overspent_categories state of design case 3, $30.00), using the rows of design
    cases 1–5.
  - Use `realClick` on checkboxes, `getByRole(..., { exact: true })`, and `expect.poll` after Record Payment's
    navigation and after Cover.
- New `e2e/plan-narrow.spec.ts` (design cases 19–22 at 1024×700).
  - Measure with `scrollWidth`/`clientWidth` and `getBoundingClientRect`.
  - The first-word width comes from a `Range` over the first word of the name's text node.
  - The sidebar case sets `localStorage['sidebar-preferred-width']='600'` through `page.addInitScript` before
    `goto`.
- `e2e/auto-assign-layout.spec.ts` gains:
  - design case 17's heights (352, 304, 386 ±1);
  - the empty Snoozed view with the preview held (MutationObserver count 0);
  - a selection whose month data hides Underfunded;
  - the Assign popover's Auto tab on an empty view.
- `e2e/auto-assign.spec.ts` case 11, a **departure (EXF-624)**: `plan` drops "Underfunded".
  - Replace the `$0.00` check with `toHaveCount(0)`.
  - The gap checks become: 2 px between boxes 0–1, 1–2 and 2–3; 16 px between boxes 3 and 4.
  - Nothing else in that file changes.
- `credit-overspending.spec.ts`, `plan-panel.spec.ts`, `plan-grid.spec.ts`, `plan-selection.spec.ts`: change only
  numbers that measure the 1024 layout, and list each one as a departure in the pull request.
- Run every new or changed spec with `pnpm e2e <specs>` and `--repeat-each=3`.
- The Tester looks at the 1024×700 screenshots of the plan-wide card, an ordinary inspector, a payment inspector,
  the EXF-622 rows and the sidebar-600 page.

**T13. Docs.**
- In `docs/credit-engine-polish.md`, replace the P7 entry's text after its tag with: "`.cell-available` keeps
  `min-width: 7.5rem` (acceptance case 23 overrides the polish); the pill still has `max-width: 100%; min-width:
  0; overflow: hidden`, the amount span `min-width: 0; overflow: hidden`, the icon `flex: none`. T14.4 checks the
  pill's scrollWidth against its clientWidth, that it lies inside its cell, does not overlap Activity, and that the
  icon is inside the pill."
- The Designer writes `docs/card-payments-polish.md`.
- `docs/README.md` already has this Build's design line; add one line each for the spec and polish only if they
  are missing.

## Verify
- `pnpm check` is green.
- The new specs and the touched specs pass with `--repeat-each=3`.
- `git diff --name-only origin/main` stays within the design's Manifest.
- None of the out-of-bounds files changed, except the one `mcp-timestamps.test.ts` line.
