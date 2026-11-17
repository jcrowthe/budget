# Card payments and the Plan page at 1024 px (EXF-537, EXF-622, EXF-623, EXF-624, EXF-616, EXF-646)

Two parts:
- **EXF-537:** the PAYMENT button and dialog, payment pill colours, the payment inspector (five Payment states,
  Total Underfunded, Overspent Categories, Current Balance, Available for Payment), `payment` on the month reads,
  and the tool `get_card_payment_status`.
- **One narrow layout:** a panel wide enough for its cards (EXF-646, EXF-623), the grid giving up the width with
  names readable and the pill whole (EXF-622), and an Auto-Assign card with the source's rows (EXF-624, reversed
  by the Lead) and height (EXF-616).

Interfaces and tasks: [card-payments-spec.md](card-payments-spec.md). Builds on
[credit-engine-design.md](credit-engine-design.md).

## Source

Read by the earlier Thread (notes and three crops were in its box under
`/workspace/scratch/source/plan-cc-payments-1024/`; the values are kept here and in the polish list). Test plan:
no credit account, nothing overspent, tab 1600×813 dark.
- **Inspector:** `.budget-inspector{width:33%;min-width:300px}`, no media query: **300 px** at 1024. The page
  minimum `50rem` scrolls the page sideways at 1024; the table keeps `min-width:562px`.
- **Row:** name ellipsizes, a flex gap, then the status text (nowrap, ellipsis). Pill 22 px tall, padding
  2px 7px; the clone's `4px 7px 2px` (`plan-grid.css`) gives the same 22 px and stays.
- **Auto-Assign card:** rows 32 px, 2 px apart, groups 16 px apart; **352 px** with nothing ticked (7 rows,
  Underfunded listed even at $0.00), **304 px** with one ticked (6 rows, singular), **352 px** with three.
- **One ticked:** the Available Balance header holds title, chevron and pill on one row (54.8 px).
- Not rendered on the plan (stylesheet only): the payment cell's 12px/600 text, the credit card inspector cards.

**This carry-over opens nothing in the source** (see Carry-over).

## Decisions

**Taken out by the Lead** (also in the pull request):
- **Record Payment** (state Enough) opens `/<plan>/accounts/<account id>?record-payment` (EXF-674 item 1): the
  account page, merged with EXF-539 as `49012cd`, opens the payment row for that parameter and then drops it.
- **"Create a Debt Payoff Target"** and its sentences ("Can't cover the overspent categories?", "Don't have more
  money to assign?") wait for EXF-538 (targets on payment categories). No dead button.
- **Help links** ("Why am I seeing this warning?", "Why does overspending affect my payment?", "Why is my payment
  underfunded?", "View Help Topic"): the app has no help pages. The dialog keeps its text, Show More and Got it!.
- "A target replaces the Payment card" cannot happen yet (targets stay refused, `payment_category_target`).

**Decided by the Architect, not observed in the source:**
- **Balance figures** (the account balance rule `countsInBalance`, the card's rows to the month's end): Prior =
  rows before the month plus the Starting Balance even when dated in it; Spending and Outflows = the month's other
  negative rows; Payments and Inflows = its other positive rows; Interest Charges = 0; Current = their sum.
- **State**, first match: `overpaid` (Available < 0), `paid_off` (Current ≥ 0), `enough` (Underfunded = 0),
  `overspent_categories` (the card's credit overspending this month > 0, its share Σ X_K of the credit engine),
  else `underfunded`. `Underfunded = max(0, −Current − Available)`.
- **Pill colours of payment rows:** red if Available < 0; yellow (`cautious`, no icon) if Underfunded > 0, even
  at $0.00; green if Available > 0; grey otherwise.
- **"Cover $X in overspent categories"** uses X = `overspent_categories`. "Cover Overspent Categories" switches
  the grid to the Overspent view (EXF-500).
- **Available for Payment's ">"** rolls its card open to show the payment category's Cash Left Over From Last Month,
  Assigned This Month and Activity.
- **Auto-Assign for payment categories** (one function for REST, tools and screen): **Underfunded** adds the Total
  Underfunded only when the payment category is the only one in scope (plan-wide and multi-category leave payment
  categories out, the Lead's EXF-532 rule). New strategies **`paid_last_month`** (last month's `paid`: positive
  rows with a transfer account) and **`average_paid`** (mean `paid` over the Average Assigned months, to a cent);
  ordinary categories are unchanged by them. One payment category lists: Underfunded (hidden at $0.00), Assigned
  Last Month, Paid Last Month, Average Assigned, Average Paid, Reset Available Amount, Reset Assigned Amount.
- **Narrow layout** (not compared):
  - **Panel minimum 320 px**, wider than the source's 300. At 300, the card-icon pill header needs 247 of 236 px,
    and "Assigned Last Month" + "$1,200.00" + a 4 px gap needs 203.7 of 204 px. At 320 they get 256 and 224.
  - **Grid content minimum 428 px** (polish P2). Under a 562 px grid box the number columns are sized from the
    month's figures (`columnWidths.ts`, polish P5), and the name column gets the rest: **140 px** at 1024×700 with
    the default sidebar on case 21's plan (headless, no scrollbar width).
  - The target text gives way first: the name keeps its width (capped by the cell); the status ellipsizes or
    wraps to a clipped second line (polish P3), with the full text in `title`.
  - **With a 15 px scrollbar** (a headed browser with classic scrollbars) the grid's client box is 429 px and the
    name column **125 px**; the number columns keep their widths. Names longer than that ellipsize, the first
    word included ("🏠 Rent/Mortga…"); nothing overlaps and nothing scrolls sideways (case 21c).
- **Sidebar dragged wide:** a Plan body under 620 px folds the panel away (`hidden`); at sidebar 600 in a 1024
  window (body 424 px) the grid scrolls sideways inside its own box, never the page. Between 620 and 760 px the
  panel stays 320 px and the grid's box scrolls. `shell/**` is unchanged.
- **Auto-Assign height (EXF-616):** rows from the cached month through the preview's pure function, amounts from
  the preview; height = 88 + 32·rows + 2·(rows − groups) + 16·(groups − 1) (352, 304, 386 px, the source's
  arithmetic); an empty view shows its message at once.

## Approach

Spec for symbols. Core (shared): pure `card-payment.ts`; `budget-engine.ts` takes `cardFlows` and sets `payment`.
Worker: `repositories/card-flows.ts` (one grouped query in `loadInput` of `getPlanMonth`/`getPlanMonths`), the
tool, the two strategies and `hiddenAmounts()` shared with the web. Web: PAYMENT button and dialog, pill colours,
`PaymentInspector`, `PlanPanel.onView`, `planLayout.ts` (ResizeObserver sets `data-fold`/`data-narrow` on
`.plan-body`; container queries would trap the fixed popovers), `columnWidths.ts`, `AutoAssignOptions` rows from
`useCachedMonth` (one month read per page), `real-click.ts` compares height.

**D1 calls** (a batch is one call; none grows with cards, categories or months; `credit-call-count.test.ts` at
10 and 100 categories): `getPlanMonth` **9** (was 8; also the REST month, `get_plan_month`, the summary, moves and
the month-category read), `getPlanMonths` **9**, `listPlanMonths` **6**, `get_card_payment_status` **9**, the
Auto-Assign preview **10**, the plan export **16** (was 15: it reads `getPlanMonths`).

## Downstream effects
- `payment` is required on the month reads: fixtures and deep-equal tests gain `payment: null`; four tool
  descriptions gain the new fields and strategies; `docs/credit-engine-polish.md` P7 says what the code does now.
- **1440×900 unchanged:** panel 33% (389 > 320), not narrow, not folded. At 1024 the panel is 320 px; a spec
  whose 1024 numbers change lists it as a departure.

## Out of scope
EXF-674 items 2–7 (its own Build; the stale EXF-539 index line included), payment targets and Debt Payoff
(EXF-538), help pages, interest detection, loans, the sidebar's width rules, and the source's page-wide sideways scroll.

## Carry-over (Builds `p_27170c2d…` 2026-11-16, then this one 2026-11-17)

Second carry-over: the branch head `b680a59` (on main `49012cd`; 57 files, +3,154/−125) merged unchanged; no
redesign, no new case. **The Architect of each carry-over opened and pressed nothing in the source app**, and no
later step does: case 25 uses the recorded readings, everything else is "not compared: built from the ticket".

**Fits main** (read on 2026-11-17): main's EXF-539 opens the payment row for `?record-payment`
(`register/Register.tsx`, `wantsPayment`, then drops it), which case 26 relies on. `git diff --name-only
origin/main...HEAD` holds none of the Lead's point-7 files and no `paths.always_overlap` file, every changed file
is inside the Manifest, no dependency. Known issue, not ours to edit: main's `docs/README.md` line 66 is a stale
EXF-539 entry (that Build renamed its docs to `record-payment-*.md`, line 67) whose link now lands on this design.

What the Lead's points need:
1. **Implementer:** `pnpm check`, then `pnpm e2e` **once** in the foreground; report the totals. A failure is read
   in the code it exercises and explained, never called load unread.
2. **Reviewer:** review `49ad5f6..HEAD` (the first review ended at `49ad5f6`): `c0cf241` (`useCachedMonth`'s
   placeholder; `columnWidths.ts`/`plan-grid.css` name room) and `a567633..b680a59`. Old-code run:
   `git checkout 49ad5f6 -- apps/web/src/api/months.ts apps/web/src/plan/columnWidths.ts
   apps/web/src/plan/plan-grid.css`, `pnpm e2e e2e/auto-assign-layout.spec.ts e2e/plan-narrow.spec.ts`, quote the
   failing lines (cases 28 and 21), then `git checkout HEAD -- <same files>`. HEAD stays on the branch.
   - 2b. Case 26 on the old link: in the working tree set `PaymentInspector.tsx`'s Record Payment `onClick` back to
     `navigate(accountPath(budgetId, c.account_id as string))`, run `pnpm e2e e2e/card-payments.spec.ts -g "26."`,
     quote the failing line, `git checkout HEAD -- apps/web/src/plan/panel/PaymentInspector.tsx`.
   - 2c. `e2e/month-nav.spec.ts` "6 month picker": read `apps/web/src/plan/MonthPicker.tsx` and its opener in
     `PlanHeader.tsx` (outside-click and open/close handlers). A person can meet it → fix under
     `apps/web/src/plan/**` with a test; spec only → fix `e2e/month-nav.spec.ts`; elsewhere → known issue.
3. **Designer:** case 25 against the recorded readings (`card-payments-polish.md`, Source), and every state at
   1440×900 and 1024×700. **Tester:** every case, 21c and 26–28 included, at both sizes, a screenshot per state.
   Judge again: the paid-off card's title "Payment" (15), names at 1024 (21, 21c), the pill (25c).
4. **Leftovers (confirmed in the files):** `docs/plan-export-design.md` says 16 D1 calls and why; the index line
   says 428; the scrollbar caveat is case 21c.
5. **Rebase:** if the plan import's `plan-export-calls.test.ts`/`mcp-timestamps.test.ts` change lands first, keep
   both sides in the timestamp test; in the export test keep theirs and set `CALLS` to what the code then makes,
   saying the number.
6. **EXF-674 item 1 (done):** Record Payment goes to `` `${accountPath(budgetId, id)}?record-payment` ``
   (`PaymentInspector.tsx`); case 26. `e2e/record-payment.spec.ts` holds only the two enabled-button waits; a later
   Build changes its minus signs, so nothing else in it is touched.
7. **Third carry-over (2026-11-17, after main's plan import `8b3e9a7`):** no redesign. Main's new
   `apps/worker/test/plan-export-now.test.ts` expects 15 D1 calls; with the card-flows read it is 16: change only that
   expectation and the title ("with 16 D1 calls"). Read `e2e/reflect-frame.spec.ts` "548-6 account filter sections"
   (failed once under load): fix the spec only if a wait is missing; a cause in `apps/web/src/reflect/**` is a known
   issue, not changed. Then acceptance at 1440×900 and 1024×700, and the gate.

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
    - Enough with "You can make this payment anytime." and **Record Payment** (case 26);
    - "Cover $30.00 in overspent categories in order to pay off your current balance." with Total Underfunded
      $30.00 and Overspent Categories $30.00; **Cover Overspent Categories** makes the Overspent chip pressed;
    - "You need to assign $1,200.00 more to pay off your current balance." with Total Underfunded $1,200.00.

    No "Why …" link, "View Help Topic" or "Create a Debt Payoff Target" appears.
16. **[537 AC4]** For ZZ Debt, Current Balance reads −$1,200.00. Opened, it lists Prior Balance −$1,200.00,
    Spending and Outflows $0.00, Interest Charges $0.00, Payments and Inflows $0.00. Available for Payment shows the
    pill; its ">" opens the three lines. The card's Auto-Assign lists Underfunded $1,200.00, Assigned Last Month,
    Paid Last Month, Average Assigned, Average Paid, Reset Available Amount, Reset Assigned Amount.
17. **[EXF-616]** At 1440×900 the Auto-Assign card is 352±1 px with nothing ticked on a plan with an underfunded
    target (7 rows), 304±1 px with one funded category (6 rows), 386±1 px when Reduce Overfunding also shows. With
    the preview held by `page.route`, the height while held equals the height after and the Notes card's top does
    not move. With the Snoozed view empty, the message and View All Categories show while the preview is held and
    a MutationObserver counts 0 `.auto-assign-option`; the same in the Assign popover's Auto tab.
18. **[EXF-624, reversed by the Lead after the source was seen]** On a plan whose targets are all funded, nothing
    ticked: Underfunded $0.00 is listed (352 px) and Reduce Overfunding is not, in the card and in Ready to Assign >
    Assign > Auto; with one category ticked Underfunded is hidden (304 px). Several ticked: as main did ("not
    compared" beyond the source's 352 px with three ticked).
19. **[EXF-623, 1024×700]** With Underfunded $1,360.00 and Assigned Last Month $2,400.00 (plan-wide), in the
    plan-wide card, an ordinary inspector and a payment inspector, every option button is 32 px tall with
    `scrollHeight ≤ clientHeight`, its label has `scrollWidth ≤ clientWidth + 1`, its amount ends inside the button
    minus its padding, and it does not overlap the next button.
20. **[EXF-646, 1024×700]** One category at −$1,200.00 credit-overspent (card icon) ticked: the panel is 320±1
    px; the Available Balance header is ≤ 56 px tall with the pill's top inside the title's line; every text node
    in the panel's cards is inside its card (`scrollWidth ≤ clientWidth + 1`). The same for a payment inspector in
    the overspent_categories state (the longest copy).
21. **[EXF-622, 1024×700]** A plan with the default categories (emoji names such as "🏠 Rent/Mortgage"), a group
    "Monthly Bills" with "Rent/Mortgage" (monthly 1,200.00) and "Groceries" (refill), and two cards, bars on. On
    every category row and group row the first word after a leading emoji ends inside the name's content box. A
    status label is beside the name or wrapped to the clipped line under it (polish P3), never over it, with the
    full text in `title`. Pills, Assigned and Activity keep `scrollWidth ≤ clientWidth`; the PAYMENT cell is whole;
    the grid's `scrollWidth ≤ clientWidth`. 21b: at 1440×900 the names and status texts show in full.
    - 21c **[15 px scrollbar]**: the same, with `.plan-grid { box-sizing: border-box; border-right: 15px solid }`
      injected (headless Chromium hides scrollbars; the grid's client box goes 444 → 429 px as in a headed
      browser). Name column 125 px. Each name that does not fit ellipsizes inside its cell, no label overlaps a
      name, pills stay whole, the grid does not scroll sideways; the first word is not asserted (measured here:
      "🏠 Rent/Mortgage", "🚘 Transportation", "🍿 Entertainment" lose 15, 10 and 9 px of it).
22. **[sidebar 600, 1024×700]** With `localStorage['sidebar-preferred-width']='600'` set before load,
    `.plan-body` is 424±1 px, the panel is hidden, the document does not scroll sideways and `.plan-grid` has
    `scrollWidth > clientWidth`; scrolled to its right end, the pill of "Rent/Mortgage" is wholly inside the grid's
    box and `realClick` on its checkbox ticks it. Collapsing the sidebar brings the panel back.
23. **[1440 unchanged]** Every existing spec at 1440×900 passes; `auto-assign.spec.ts` gains only the two new
    preview fields in case 19 (EXF-624 reversed by the Lead after the source was seen). The panel is 33% at 1440.
24. **[real-click]** `realClick` waits until x, y, width **and height** are still.
25. **Compare (recorded readings; the source is not opened in this carry-over):** the clone at 1600×813 dark, on a
    plan with one underfunded target, against the earlier Thread's readings of the source (Source above, polish):
    - (a) The Auto-Assign card: 352 px with nothing ticked, 304 px with one ordinary category ticked (press Escape
      when its Assigned cell opens), 352 px with three ticked. Rows are 32 px tall, 2 px apart, with 16 px between
      groups.
    - (b) With one ticked: the Available Balance header has title, chevron and pill on one row.
    - (c) A category row's name and pill sizes (22 px tall pill; the source's padding is 2px 7px, the clone's
      `4px 7px 2px` gives the same height).

26. **[EXF-674 item 1]** In the Enough state ("ZZ Enough", Available $120.00), `realClick` on **Record Payment**:
    the path becomes `/<plan>/accounts/<ZZ Enough id>`, the search becomes empty, and the payment row is open with
    Date focused, Date "11/16/2026" and Inflow "120.00".
27. **[one month read]** Loading the Plan page makes exactly one month read
    (`/api/v1/budgets/<id>/months/YYYY-MM-01`); ticking a category and opening Assign > Auto add none
    (`e2e/plan-requests.spec.ts`).
28. **[month switch]** With one category ticked, switching month keeps the one-category list (304 px, singular
    labels) while the new month loads; the plan-wide list never shows (`auto-assign-layout.spec.ts`).

**Not compared: built from the ticket** (the source has no card, nothing overspent, its tab is never resized,
and this carry-over opens nothing in it): the PAYMENT button and
dialog, the payment pills, the five states, Total Underfunded, Overspent Categories, Current Balance, Available for
Payment, the payment Auto-Assign rows, every layout at 1024 px or with a wide sidebar (only its stylesheet's 300 px
minimum and 800 px page minimum were read), and every decision above.

## Manifest

touches: [packages/core/src/budget-engine.ts, packages/core/src/card-payment.ts, packages/core/test/**, packages/schema/src/months.ts, packages/schema/src/month-categories.ts, packages/schema/src/month-totals.ts, packages/schema/src/auto-assign.ts, packages/schema/test/**, apps/worker/src/repositories/card-flows.ts, apps/worker/src/services/months.ts, apps/worker/src/services/month-categories.ts, apps/worker/src/services/auto-assign.ts, apps/worker/src/routes/month-categories.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/auto-assign.ts, apps/worker/test/card-payments.test.ts, apps/worker/test/credit-call-count.test.ts, apps/worker/test/credit-engine.test.ts, apps/worker/test/auto-assign.test.ts, apps/worker/test/mcp-coverage/months.ts, apps/worker/test/mcp-timestamps.test.ts, apps/worker/test/month-summary.test.ts, apps/worker/test/plan-export-calls.test.ts, apps/web/src/plan/**, apps/web/src/pages/plan.tsx, apps/web/src/api/months.ts, e2e/card-payments.spec.ts, e2e/plan-narrow.spec.ts, e2e/plan-requests.spec.ts, e2e/auto-assign-layout.spec.ts, e2e/auto-assign.spec.ts, e2e/plan-grid.fixtures.ts, e2e/support/real-click.ts, e2e/credit-overspending.spec.ts, e2e/plan-panel.spec.ts, e2e/plan-grid.spec.ts, e2e/plan-selection.spec.ts, e2e/record-payment.spec.ts, e2e/month-nav.spec.ts, docs/card-payments-design.md, docs/card-payments-spec.md, docs/card-payments-polish.md, docs/README.md, docs/credit-engine-polish.md, docs/plan-export-design.md, apps/worker/test/plan-export-now.test.ts, e2e/reflect-frame.spec.ts]
shared: [packages/core/src/budget-engine.ts — cardFlows input, per-card credit parts and the payment field of the read model; packages/core/src/card-payment.ts — the pure payment state beside the engine (Lead's note 8)]
migrations: 0

`apps/web/src/plan/**` includes `columnWidths.ts` and `MonthPicker.tsx` (2c). `e2e/record-payment.spec.ts`: the
two waits only; `e2e/month-nav.spec.ts`: only if 2c fixes the spec. `mcp-timestamps.test.ts` gains one `NOT_CALLED` entry and
`plan-export-calls.test.ts` its count (15 → 16); `month-summary.test.ts` one `payment: null`. No dependency.
