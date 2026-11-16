# Card payments and the Plan page at 1024 px (EXF-537, EXF-622, EXF-623, EXF-624, EXF-616, EXF-646)

Two parts:
- **EXF-537:** the PAYMENT button and dialog, payment pill colours, the payment category inspector (five Payment
  states, Total Underfunded, Overspent Categories, Current Balance, Available for Payment), `payment` on the REST
  month reads, and the tool `get_card_payment_status`.
- **One narrow layout:** panel wide enough for its cards (EXF-646, EXF-623), the grid giving up the width with names
  readable and the pill whole (EXF-622), and an Auto-Assign card that hides $0.00 rows (EXF-624) and keeps the
  source's height (EXF-616).

Interfaces and tasks are in [card-payments-spec.md](card-payments-spec.md). It builds on
[credit-engine-design.md](credit-engine-design.md) (payment categories, `overspent`, `state`).

## Source

The study ran in a sub-agent. Notes and three cropped captures are in
`/workspace/scratch/source/plan-cc-payments-1024/` (`notes.md`, `01-nothing-ticked.png`, `02-one-ticked.png`,
`03-three-ticked.png`). The test plan has no credit account and nothing overspent, and the tab is 1600×813, dark.
What could be seen (rules quoted in the notes):
- **Inspector:**
  - `.budget-inspector{width:33%;min-width:300px}`, and no screen media query for the inspector or grid. At 1024
    the rules give **300 px**.
  - `.content-min-break{min-width:50rem}` makes the page scroll sideways (36 px at 1024).
  - The table keeps `min-width:562px` in a 500 px `overflow:auto` box, so its Available column is partly
    off-screen at 1024.
- **Row:** the name truncates with an ellipsis, then comes a flex-grow gap, then the status text (nowrap,
  ellipsis). The pill is 22 px tall, padding 2px 7px.
- **Auto-Assign card (live):** rows 32 px, 2 px apart, groups 16 px apart.
  - **352 px** with nothing ticked (7 rows: 1 | 4 | 2).
  - **304 px** with one ticked (6 rows: no Underfunded, singular "Amount").
  - **352 px** with three ticked.
- **One category ticked:** the Available Balance header holds title, chevron and pill on one row (54.8 px).
- **Not on the plan:** rules for the payment cell (12px/600, letter-spacing .05rem), the
  `.budget-inspector-credit-card-*` cards, the next-payment card (bar .25rem), and Available for Payment's
  roll-up padding `1rem .5rem 1rem 1rem`.

**The Architect's step in the source** (the Clerk's tab `4457F37F…`, through the sub-agent):
- It read stylesheets and measured boxes.
- It ticked one category (Escape when its Assigned cell opened) and unticked it.
- It ticked three and unticked them; one Escape with no cell open cleared the selection.
- Captures: three plain `page.screenshot({path})` calls after `bringToFront()`, 1600×813 before and after each,
  cropped, originals deleted.
- Nothing typed, saved or hovered; no Auto-Assign press; zero rows left ticked; no theme or size change; nothing
  written into the page; no plan menu, Bank Connections, Add Account, All Accounts, account or other plan.

## Decisions

**Taken out by the Lead** (also in the pull request):
- **Record Payment** (state Enough) is shown and opens the card's account page `/<plan>/accounts/<account id>`.
  The payment row it should open is EXF-539, whose files (account page, register) another Build holds.
- **"Create a Debt Payoff Target"** and its sentences ("Can't cover the overspent categories?", "Don't have more
  money to assign?") wait for EXF-538 (targets on payment categories). No dead button.
- **Help links** ("Why am I seeing this warning?", "Why does overspending affect my payment?", "Why is my payment
  underfunded?", "View Help Topic"): the app has no help pages. The dialog keeps its text, Show More and Got it!.
- "A target replaces the Payment card" cannot happen yet (targets stay refused, `payment_category_target`).

**Decided by the Architect, not observed in the source:**
- **Balance figures** use the account balance rule (`countsInBalance`) on the card's rows up to the month's last
  day:
  - Prior Balance = rows before the month, plus the Starting Balance even when it is dated in the month;
  - Spending and Outflows = the month's other negative rows;
  - Payments and Inflows = its other positive rows;
  - Interest Charges = 0;
  - Current Balance = their sum.
- **State**, checked in this order:
  1. `overpaid` if Available < 0;
  2. else `paid_off` if Current ≥ 0;
  3. else `enough` if Underfunded = 0;
  4. else `overspent_categories` if this card's credit overspending in the month > 0;
  5. else `underfunded`.

  `Underfunded = max(0, −Current − Available)`. **overspent_categories** is the card's share of the month's
  credit parts (Σ X_K of the credit engine).
- **Pill colours of payment rows:** red if Available < 0; yellow (`cautious`, no icon) if Underfunded > 0, even
  at $0.00; green if Available > 0; grey otherwise.
- **"Cover $X in overspent categories"** uses X = `overspent_categories`. "Cover Overspent Categories" switches
  the grid to the Overspent view (EXF-500).
- **Available for Payment's ">"** rolls its card open to show the payment category's Cash Left Over From Last Month,
  Assigned This Month and Activity.
- **Auto-Assign for payment categories** (REST, the tools and the screen use one function):
  - **Underfunded** adds the Payment card's Total Underfunded, but **only when the payment category is the only
    category in scope**. The plan-wide and multi-category Underfunded keep leaving payment categories out, as the
    Lead decided for EXF-532.
  - **Paid Last Month** sets Assigned to last month's `paid`. `paid` is the part of Payments and Inflows made of
    transfers into the card from another account (positive rows with a transfer account).
  - **Average Paid** is the mean of `paid` over the months that Average Assigned uses, rounded to a cent.
  - These are the new strategies `paid_last_month` and `average_paid`; ordinary categories are unchanged by them.
  - With one payment category the list is: Underfunded (hidden at $0.00), Assigned Last Month, Paid Last Month,
    Average Assigned, Average Paid, Reset Available Amount, Reset Assigned Amount.
- **Narrow layout** (not compared):
  - **Panel minimum 320 px**, wider than the source's 300. At 300, the card-icon pill header needs 247 of 236 px,
    and "Assigned Last Month" + "$1,200.00" + a 4 px gap needs 203.7 of 204 px. At 320 they get 256 and 224.
  - **Grid content minimum 440 px.** Under a 562 px grid box the number columns use fixed minimums, and the name
    column gets the rest: 63 px at 1024×700 with the default 260 px sidebar.
  - The target text gives way first: the name keeps its width (capped by the cell), and the status ellipsizes,
    with the full text in `title`.
- **Sidebar dragged wide:**
  - A Plan body under 620 px folds the panel away (`hidden`). At sidebar 600 in a 1024 window (body 424 px), the
    grid scrolls 16 px sideways inside its own box and the page does not.
  - Between 620 and 760 px the panel stays at 320 px and the grid's box scrolls.
  - `shell/**` is unchanged.
- **Auto-Assign height (EXF-616):**
  - The rows come from the cached month, through the same pure function as the preview; amounts come from the
    preview.
  - Height = 88 + 32·rows + 2·(rows − groups) + 16·(groups − 1), which is 352, 304 or 386 px, the source's
    arithmetic.
  - An empty view shows its message at once.

## Approach

Interfaces, symbols and task order are in the spec; this is the shape.
- **Core (shared, note 8):**
  - new pure `card-payment.ts` (`cardPayment`);
  - `budget-engine.ts`: `EngineInput.cardFlows`, per-card credit parts, and `payment` on each category (null for
    ordinary ones).
- **Worker:**
  - new `repositories/card-flows.ts`, one grouped query, added to `loadInput` for `getPlanMonth` and
    `getPlanMonths`;
  - `payment` (the ticket's nine fields plus `paid`) on `MonthCategoryDetail` and `CategoryMonth`;
  - the tool `get_card_payment_status` (in `toolsWithoutOperation`; no timestamp, one line in
    `mcp-timestamps.test.ts`'s `NOT_CALLED`, which must list every tool);
  - Auto-Assign: `paid_last_month`, `average_paid`, and `hiddenAmounts()` shared with the web.
- **Web:**
  - the PAYMENT button and dialog, the payment pill colours, and `PaymentInspector`;
  - `PlanPanel.onView`;
  - `planLayout.ts`, a ResizeObserver hook setting `data-fold` and `data-narrow` on `.plan-body` (Plan popovers are
    `position: fixed` without a portal, so CSS container queries would trap them);
  - `AutoAssignOptions` takes its rows from the cached month;
  - `real-click.ts` compares height.

**D1 calls** (conventions; read from the code as planned; a batch is one call):
- Month read `getPlanMonth`: **9** (was 8): the plan plus 8 parallel reads, card flows added. This also serves
  the REST month, `get_plan_month`, the summary, moves and the **month-category read** (REST and
  `get_month_category`: **9**).
- `getPlanMonths`: **9**. `listPlanMonths`: **6** (unchanged).
- `get_card_payment_status`: **9**.
- Auto-Assign preview: **10** (getPlanMonths plus the category list).
- None grows with cards, categories or months. `credit-call-count.test.ts` asserts these at 10 and 100 categories
  (1 and 10 cards).

## Downstream effects
- `MonthCategoryDetail.payment` is required: fixtures and deep-equal tests gain `payment: null`. Four tool
  descriptions gain the new fields and strategies.
- **At 1440×900 nothing changes:** the panel stays at 33% (389 > 320), the grid is wider than 562 (not narrow) and
  the panel does not fold. `e2e/auto-assign.spec.ts` case 11 keeps expecting "Underfunded $0.00" with nothing
  ticked: EXF-624 was reversed by the Lead after the source was seen (case 19 only gains the two new preview fields).
- At 1024 the panel is 320 px. A spec whose 1024 numbers change lists the change as a departure.
- `docs/credit-engine-polish.md` P7 is rewritten to say what the code does now.

## Out of scope
Record Payment's register row (EXF-539), payment targets and Debt Payoff (EXF-538), help pages, interest
detection, loans, the sidebar's width rules, and the source's page-wide sideways scroll.

## Acceptance

Worker tests go through REST. Nov is 2026-11-01. "P" is the card's `payment` from
`GET /api/v1/budgets/{id}/months/{month}/categories/{payment category id}`. Every case also asserts
`prior + spending + interest + payments = current`, `interest_charges = 0` and
`underfunded = max(0, −current − available)`.

1. **[537 table 1]** Credit Card "ZZ Debt Card" with Starting Balance −1200000 dated 2026-11-02, nothing assigned →
   P = {state `underfunded`, underfunded 1200000, overspent_categories 0, current −1200000, prior −1200000,
   spending 0, payments 0, available 0}.
2. **[table 2]** Visa; Groceries assigned 300000; Visa −120000 Groceries → `enough`, current −120000, spending
   −120000, available 120000, underfunded 0, prior 0.
3. **[table 3]** Groceries assigned 170000 and Visa −170000 Groceries; Dining assigned 0 and Visa −30000 Dining →
   `overspent_categories`, overspent_categories 30000, underfunded 30000, current −200000. Adding Visa Dining rows
   of −40000, −20000 and −35000 gives 70000, 90000 and 125000 for both figures.
4. **[table 4]** Nov: Groceries assigned 210000 with Visa −210000 Groceries, and Visa −110000 Dining (assigned 0).
   The Dec read → `underfunded`, underfunded 110000, overspent_categories 0, current −320000, prior −320000,
   available 210000.
5. **[table 5]** Groceries assigned 335000 and Visa −335000 Groceries, then a transfer of 385000 from Checking to
   Visa → `overpaid`, available −50000, payments 385000, paid 385000, current 50000, underfunded 0.
6. **[table 6]** Dec after case 5 → `paid_off`, available 0, current 50000, prior 50000.
7. **[inflows]** On a card: a +15000 refund in Groceries and a +30000 inflow to Ready to Assign → payments 45000,
   paid 0.
8. **[month read]** In case 3's Nov month read, the payment category's `payment` equals P, and every ordinary
   category has `payment: null`. An ordinary category's month-category read has `payment: null`.
9. **[MCP]** `get_card_payment_status(bid, Nov, visa)` equals `{account_id, category_id, name "Visa", ...P}` for
   case 3. A checking account id and an unknown id give tool errors. `mcp-coverage` and `mcp-descriptions` pass.
10. **[D1]** Month read 9, `getPlanMonths` 9, `listPlanMonths` 6, month-category read 9 and the tool 9, at 10 and
    100 categories with 1 and 10 cards.
11. **[Auto-Assign]**
    - Case 1's payment alone: the preview's underfunded is 1200000. POST `underfunded` → assigned 1200000 → P
      `enough`.
    - The plan-wide preview of the same plan: underfunded 0.
    - An Oct transfer of 100000 into Visa: Nov `paid_last_month` 100000, and POST sets Assigned 100000.
      `average_paid` = meanCent over the Average Assigned months.
    - An ordinary category under `paid_last_month` is unchanged.
12. **[EXF-624, unit; reversed by the Lead after the source was seen]** `autoAssignOptions` lists Underfunded at 0
    for "many" and leaves it out for "one" and "payment"; Reduce Overfunding is left out at 0 for all three. The
    "payment" list is the seven labels above.

Browser specs (clock 2026-11-16, plans made through the API, `realClick`, `{ exact: true }` names) at 1440×900
unless stated:

13. **[537 AC1]** The Credit Card Payments group row's Available cell shows the button "PAYMENT" above the total.
    Clicking it opens the dialog "Using Credit Cards" with the sentence; Show More reveals the second paragraph;
    Got it! closes it.
14. **[pills]** Payment rows "ZZ Enough", "ZZ Clear", "ZZ Debt" and "ZZ Over" (cases 2, a card with no rows, 1, 5)
    have the classes `positive`, `zero`, `cautious` (with text "$0.00") and `negative`.
15. **[537 AC2, AC3, AC5]** Ticking each payment row shows exactly one Payment state with its copy and the card's
    name:
    - "Your ZZ Clear is paid off!" + "Being debt free is a wonderful thing.";
    - "You sent more to ZZ Over than you had set aside for the payment.";
    - Enough with "You can make this payment anytime." and **Record Payment**, which opens
      `/<plan>/accounts/<id>`;
    - "Cover $30.00 in overspent categories in order to pay off your current balance." with Total Underfunded
      $30.00 and Overspent Categories $30.00; **Cover Overspent Categories** makes the Overspent chip pressed;
    - "You need to assign $1,200.00 more to pay off your current balance." with Total Underfunded $1,200.00.

    No "Why …" link, "View Help Topic" or "Create a Debt Payoff Target" appears.
16. **[537 AC4]** For ZZ Debt, Current Balance reads −$1,200.00. Opened, it lists Prior Balance −$1,200.00,
    Spending and Outflows $0.00, Interest Charges $0.00, Payments and Inflows $0.00. Available for Payment shows the
    pill; its ">" opens the three lines. The card's Auto-Assign lists Underfunded $1,200.00, Assigned Last Month,
    Paid Last Month, Average Assigned, Average Paid, Reset Available Amount, Reset Assigned Amount.
17. **[EXF-616]** At 1440×900, the Auto-Assign card is:
    - 352±1 px with nothing ticked on a plan with an underfunded target (7 rows);
    - 304±1 px with one fully funded category (6 rows);
    - 386±1 px when Reduce Overfunding also shows.

    With the preview held by `page.route`, the height while held equals the height after, and the Notes card's top
    does not move. With the Snoozed view empty, the message and View All Categories show while the preview is held,
    and a MutationObserver counts 0 `.auto-assign-option` drawn. The same holds in the Assign popover's Auto tab.
18. **[EXF-624, reversed by the Lead after the source was seen]** On a plan whose targets are all funded, nothing
    ticked: Underfunded $0.00 is listed (352 px) and Reduce Overfunding is not, in the card and in Ready to Assign >
    Assign > Auto; with one category ticked Underfunded is hidden (304 px). Several ticked: as main did ("not
    compared" beyond the source's 352 px with three ticked).
19. **[EXF-623, 1024×700]** With Underfunded $1,360.00 and Assigned Last Month $1,200.00, in the plan-wide card,
    an ordinary inspector and a payment inspector, every option button:
    - is 32 px tall with `scrollHeight ≤ clientHeight`;
    - has a label with `scrollWidth ≤ clientWidth + 1`;
    - has an amount whose right edge is inside the button minus its padding;
    - does not overlap the next button.
20. **[EXF-646, 1024×700]** One category at −$1,200.00 credit-overspent (card icon) is ticked:
    - the panel is 320±1 px;
    - the Available Balance header is ≤ 56 px tall, with the pill's top inside the title's line;
    - every text node in the panel's cards has its box inside its card (`scrollWidth ≤ clientWidth + 1`).

    The same holds for a payment inspector in the overspent_categories state (the longest copy).
21. **[EXF-622, 1024×700]** Group "ZZ Bills": "ZZ Rent" (monthly 1,200.00, nothing assigned) and "ZZ Phone"
    (refill up to 60.00), with bars on. Each name's `clientWidth` is ≥ the width of its first word (a Range over
    it). The status label's left edge is ≥ the name's right edge, and the label ellipsizes with the full text in
    `title`. The grid's `scrollWidth ≤ clientWidth`. The Available pills keep `scrollWidth ≤ clientWidth`. At
    1440×900 both names show in full (`scrollWidth ≤ clientWidth`) with their status text whole.
22. **[sidebar 600, 1024×700]** `localStorage['sidebar-preferred-width']='600'` is set before load:
    - `.plan-body` is 424±1 px, the Inspector panel is hidden, and the document does not scroll sideways;
    - `.plan-grid` has `scrollWidth > clientWidth`;
    - after scrolling the grid to its right end, the Available pill of "ZZ Rent" lies wholly inside the grid's box;
    - `realClick` on its checkbox ticks it.

    Collapsing the sidebar brings the panel back.
23. **[1440 unchanged]** Every existing spec at 1440×900 passes untouched, except `auto-assign.spec.ts` case 11's
    first expectation (case 18 reverses it; listed as a departure). The panel is 33% of the body at 1440.
24. **[real-click]** `realClick` waits until x, y, width **and height** are still.
25. **Compare, live:** the source's test plan Plan page in dark, at the tab's own 1600×813, against the clone at
    1600×813 dark on a plan with one underfunded target.
    - (a) The Auto-Assign card: 352 px with nothing ticked, 304 px with one ordinary category ticked (press Escape
      when its Assigned cell opens), 352 px with three ticked. Rows are 32 px tall, 2 px apart, with 16 px between
      groups.
    - (b) With one ticked: the Available Balance header has title, chevron and pill on one row.
    - (c) A category row's name and pill sizes (22 px tall pill, 2px 7px padding).

**Not compared** (the source has no card, nothing overspent, and its tab is never resized): the PAYMENT button and
dialog, the payment pills, the five states, Total Underfunded, Overspent Categories, Current Balance, Available for
Payment, the payment Auto-Assign rows, every layout at 1024 px or with a wide sidebar (only its stylesheet's 300 px
minimum and 800 px page minimum were read), and every decision above.

## Manifest

touches: [packages/core/src/budget-engine.ts, packages/core/src/card-payment.ts, packages/core/test/**, packages/schema/src/months.ts, packages/schema/src/month-categories.ts, packages/schema/src/month-totals.ts, packages/schema/src/auto-assign.ts, packages/schema/test/**, apps/worker/src/repositories/card-flows.ts, apps/worker/src/services/months.ts, apps/worker/src/services/month-categories.ts, apps/worker/src/services/auto-assign.ts, apps/worker/src/routes/month-categories.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/auto-assign.ts, apps/worker/test/card-payments.test.ts, apps/worker/test/credit-call-count.test.ts, apps/worker/test/credit-engine.test.ts, apps/worker/test/auto-assign.test.ts, apps/worker/test/mcp-coverage/months.ts, apps/worker/test/mcp-timestamps.test.ts, apps/web/src/plan/**, apps/web/src/pages/plan.tsx, e2e/card-payments.spec.ts, e2e/plan-narrow.spec.ts, e2e/auto-assign-layout.spec.ts, e2e/auto-assign.spec.ts, e2e/plan-grid.fixtures.ts, e2e/support/real-click.ts, e2e/credit-overspending.spec.ts, e2e/plan-panel.spec.ts, e2e/plan-grid.spec.ts, e2e/plan-selection.spec.ts, docs/card-payments-design.md, docs/card-payments-spec.md, docs/card-payments-polish.md, docs/README.md, docs/credit-engine-polish.md]
shared: [packages/core/src/budget-engine.ts — cardFlows input, per-card credit parts and the payment field of the read model; packages/core/src/card-payment.ts — the pure payment state beside the engine (Lead's note 8)]
migrations: 0

Of note 9's files only `mcp-timestamps.test.ts` changes, by one line (the new tool in `NOT_CALLED`). No dependency
is added.
