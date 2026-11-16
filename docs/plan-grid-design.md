# Plan grid: the month grid of category groups and categories (EXF-487)

## Feature

The middle of the Plan screen: a toolbar, a header row, then one row per category group and per category for
the month in the URL. The columns are Assigned, Activity and Available. Groups show subtotals. Categories show a
progress bar with a status label and an Available pill. Groups collapse, and a Progress Bars toggle switches to
compact rows. A new plan is now created with three default groups and eleven categories. There is no new REST
path and no new MCP tool.

## Source

Study notes: `/workspace/scratch/source/plan-grid/notes.md`. Screenshots in the same folder, with the sidebar
cropped out: `grid-overview.png`, `toolbar.png`, `group-row-hover.png`, `category-row-hover.png`, `pills.png`,
`group-collapsed.png`, `all-collapsed.png`, `progress-bars-off.png`. It was observed on 2026-11-15 on the Test
Budget plan, dark theme, at a 1600×813 viewport. Every month of that plan is $0.00, so the non-zero pill
colours, the stripes and the label texts were read from the source's stylesheet and string table, not seen live.
Do not copy `icons-symbols.svg.txt` into the clone: that file is the source's art. The clone draws its own icons.

- **Layout.** At 1340px of content width the grid section is 898px (883px plus a ~15px scrollbar) and the
  right panel is 442px. It has a 1px top-to-bottom left border in the separator colour. Above the grid sits a
  37px row of view chips; that row belongs to EXF-500 and is not drawn here.
- **Toolbar.** 48px high, background `#15172d`, 8px left padding, 1px bottom separator (`rgba(255,255,255,.1)`).
  - Buttons sit next to each other with no gap: `⊕ Category Group`, `↶ Undo`, `↷ Redo`, `⟲ Recent Moves`. Each
    is 32px high, padding 4px 8px, radius 8px, 14px/500, colour `#a3acff`, with a 13px icon and an 8px gap.
    Hover background is `rgba(117,131,255,.2)`.
  - Undo and Redo are `disabled`, coloured `#383ca3`.
  - Tooltips: "Add Category Group" and "Previous 34 days of assigning and moving money".
  - At the right, 16px from the edge, is a segmented control (`role=tablist`, 61.6×32, padding 2px, track
    `rgba(114,116,132,.32)`, radius 8px). It holds two icon tabs, 28.8×28, padding 4px 8px, radius 6px, with
    title and aria-label "Progress Bars On" / "Progress Bars Off". The selected tab has background `#1f2038`,
    a 1px `rgba(255,255,255,.08)` outline and icon colour `#9b9caa`. The unselected icon is `#727484`.
- **Header row.** 40px, background `#0c0d22`, 1px bottom separator.
  - Cells left to right: 14px margin, 16px chevron column, 27px checkbox column (padding 0 2px 0 8px), name
    (flex, padding-left 6px), then ASSIGNED, ACTIVITY and AVAILABLE at 15% each, then a 16px margin.
  - The number columns are right-aligned. Paddings: Assigned 0 4px 0 16px, Activity 0 0 0 6px, Available
    0 6px 0 16px.
  - Labels are 12px/500, uppercase, letter-spacing 0.6px, colour `#c4c5cf`. AVAILABLE is 700.
  - Title tooltips: ASSIGNED "Add money to each category in this column. This is the fun part. Until the money
    runs out."; ACTIVITY `It's the "We spent how much on WHAT?!" column.`; AVAILABLE "Do I have enough to buy
    that handmade didgeridoo? With this column, now you know."
  - The chevron reads "Collapse all" (chevron down) while at least one group is open, and "Expand all"
    (chevron right) when every group is collapsed.
  - The checkbox is a 17×17 `role=checkbox` button "Check all" with a 13×13 inner box: 1px `#727484` border,
    radius 3px.
- **Group row.** 40px, background `#15172d`, no borders, no hover background.
  - Chevron 10×10 `#c4c5cf`, aria-label "Collapse <name> categories" or "Expand <name> categories".
  - Checkbox labelled with the group name.
  - Name 16px/600 `#f1f1ff`, padding 0 4px.
  - On row hover a ⊕ "Add Category" button (14px icon, `#7583ff`) appears at once (no fade, on purpose) 2px right of the name.
  - Subtotals are plain text, 14px/500 `#f1f1ff`, tabular figures. They are never dimmed and never a pill.
- **Category row.** 44px with bars on, 36px with bars off. Background `#0c0d22`, 1px top separator across the
  full width, no hover change.
  - Name 16px/500 white (14px with bars off), padding 2px 4px, ellipsis.
  - Bars on: the name line holds the name on the left and the status label on the right (14px/500 `#c4c5cf`,
    every state). Under it is a 4px bar, inset 4px on each side, starting 31px below the row top. Its track is
    `#3c3e53` and it is fully rounded.
  - Bars off: the bar and the label leave the DOM, and the three number columns widen from 15% to 18%.
- **Bar fill** (no target). Here *spent* = −activity when activity < 0, else 0, and *funded* = assigned +
  carried, where `carried` is already ≥ 0.
  - spent > funded: a striped green segment (`funded/spent`) followed by a red striped "overspent" segment.
  - Otherwise, when spent > 0: a striped green "spent" segment (`spent/funded`) followed by solid green
    `#77ba21`.
  - Otherwise, when funded > 0: solid green across the whole bar.
  - Otherwise: the empty track.
  - The stripes are `repeating-linear-gradient(135deg, A, A 5px, B 5px, B 6px)`. Spent uses A `#346011` and
    B `#1d300d`; overspent uses A `#912333` and B `#4c0814`.
- **Status label** (no target), with the same *spent* and *funded*:
  - available < 0 and spent > 0: "Overspent. $X of $Y" (X = spent, Y = funded).
  - spent > 0 and available = 0: "Fully Spent".
  - spent > 0 and available > 0: "Spent $X of $Y".
  - Anything else: no label.
- **Assigned and Activity.** 14px/500, tabular figures, right-aligned. Zero is dimmed to `#c4c5cf`; anything
  else is white. Negative amounts are not red. Assigned sits in a 116×24 box (1px transparent border, radius
  4px, padding 3px) that EXF-489 turns into the input.
- **Available pill.** A button with padding 2px 7px, radius 1000px, 14px/500, no minimum width, right-aligned
  and vertically centred.
  - Zero: background `#3c3e53`, text `#9b9caa`, `disabled`, no title.
  - Positive: background `#77ba21`, text `#0c0d22`, hover `#508316`. Title "<amt> Available to plan your
    spending—or click to move it to another category!" (em dash).
  - Negative: background `#bf2e3b`, text `#fff`, hover `#912333`. Title "<amt> A green category is a happy
    category. Make this category happy by adding funds from surplus categories."
  - A negative amount uses U+2212 before the currency symbol: "−$50.00".
- **Uncategorized Transactions** was not present in any month. From the source's CSS: it is a category-style
  row above every group, its label is coloured `#daac00`, and its pill cannot be clicked.
- **Collapse.** A collapsed group switches to a right chevron; its subtotals stay and its categories go.
  Ctrl+↑ collapses every group and Ctrl+↓ expands every group. When the rows stop overflowing, the scrollbar
  goes and the table widens by ~15px.
- **Loading.** The source shows a full-page splash and then a complete grid, with no row skeleton.

## Approach

1. **Plan page layout.** `pages/plan.tsx` becomes a column filling the main area: the existing `PageHeader`,
   then `.plan-body`, a row made of `<PlanGrid>` (flex 1, min-width 562px, its own vertical scroll) and an empty
   `<aside className="plan-inspector">` (width 442px, flex none, left separator). The right-hand panel is
   area 2; this Build leaves it empty. The month logic already in the page stays as it is, and the page passes
   `budgetId` and the resolved `month` to the grid.
2. **Data.** A new `api/months.ts` exposes `getMonth` and `useMonth(budgetId, month)` over `apiFetch` with
   `MonthDetailResponse`. The query key is `["month", budgetId, month]` and it uses
   `placeholderData: keepPreviousData`, so a month change keeps the old rows until the new ones arrive (no
   jump). Zod objects strip unknown keys, so the `target` field that EXF-511 will add cannot break parsing.
3. **Grid** (`apps/web/src/plan/`): a treegrid of divs, structured like the source (`role=treegrid`,
   `role=row`, `role=columnheader`, `role=rowheader`, `role=cell`). The header (toolbar plus labels) is
   `position: sticky`. Hidden groups and hidden categories are not rendered. Group subtotals come from the read
   model, which already leaves hidden categories out (budget-engine rule 6). Order follows the read model
   (`sort`, then `id`).
4. **Collapse state** (Lead note 1): `plan/collapse.ts`. The grid starts from each group's `collapsed`
   in the read model, overlaid by the browser's saved value. The browser keeps one localStorage key per plan,
   `budget.planGrid.collapsed.<budgetId>`, holding a JSON object `{ <groupId>: boolean }`. All writes go through
   **`saveCollapsed(budgetId, changes)`**. **EXF-494 swaps that single function** for a PATCH
   `/category_groups/{gid} {collapsed}` per change (and then drops the overlay in `loadCollapsed`); the
   component code does not change. Collapse all and expand all act on every rendered group. Ctrl/⌘+↑ and
   Ctrl/⌘+↓ are handled by a `keydown` listener on `window` that the grid installs while it is mounted. The
   listener ignores events whose target is an input, a textarea or a contenteditable element, and calls
   `preventDefault`. EXF-473 moves the binding into its registry.
5. **Progress bars** (Lead note 7): `plan/progressBars.ts`, with `loadProgressBars()` (default `true`) and
   **`saveProgressBars(on)`**, stored under the localStorage key `budget.progressBars` (per browser, not per
   plan, because the EXF-472 setting is per user). A `useProgressBars()` hook wraps them. **EXF-472 replaces
   these two functions** (or the hook) with its settings query and mutation.
6. **Inert controls** (Lead note 7), drawn as in the source with no action:
   - Category Group and Recent Moves are enabled buttons with no handler. Undo and Redo are `disabled`.
   - The group ⊕ "Add Category" button has no handler.
   - Checkboxes (`role=checkbox`) toggle only their own `aria-checked` and check mark, in local state.
     EXF-498 owns selection.
   - Assigned is a plain value in its box. EXF-489 makes it editable; the hover border and calculator come
     with it.
   - The positive and negative pills are enabled buttons with their tooltip and hover colour but no handler.
     The move-money and cover popovers come later.
   - Activity is plain text. The EXF-509 popover adds the link styling.
7. **Money text.** `plan/format.ts`: `money(m)` = `formatMoney(m)` with its leading `-` replaced by `−`
   (U+2212). `packages/core` is not changed. EXF-468 later swaps in the plan's own format.
8. **Colours.** Use `tokens.css` variables where one exists. The rest are declared in a `:root` block at the
   top of `plan/plan-grid.css` and used only through `var()`, never as a raw colour inside a rule. A later Build
   moves them into `tokens.css`:

   | property | value | use |
   |---|---|---|
   | `--separatorStandard` | `rgba(255,255,255,0.1)` | row and header separators, panel border |
   | `--labelHeading` | `#f1f1ff` | group name and subtotals |
   | `--labelAction` | `#a3acff` | toolbar buttons |
   | `--actionPrimaryDisabled` | `#383ca3` | disabled Undo and Redo |
   | `--labelWarning` | `#daac00` | Uncategorized Transactions label |
   | `--segmentedTrack` | `rgba(114,116,132,0.32)` | progress toggle track |
   | `--categoryBalanceZeroLabel` | `#9b9caa` | zero pill text, selected toggle icon |
   | `--categoryBalancePositiveLabel` | `#0c0d22` | positive pill text |
   | `--categoryBalancePositiveHover` | `#508316` | positive pill hover |
   | `--categoryBalanceNegativeLabel` | `#fff` | negative pill text |
   | `--categoryBalanceNegativeHover` | `#912333` | negative pill hover |
   | `--budgetBarFundedSpending` / `--budgetBarFundedSpendingStripe` | `#346011` / `#1d300d` | spent stripes |
   | `--budgetBarOverspending` / `--budgetBarOverspendingStripe` | `#912333` / `#4c0814` | overspent stripes |

   Existing tokens used: `--backgroundPrimary` (rows, header), `--backgroundSecondary` (toolbar, group rows),
   `--backgroundTertiary` (selected toggle), `--inputBackground` (zero pill, bar track), `--inputBorder`
   (checkbox border, unselected toggle icon), `--statusPositive` and `--statusNegative` (pills, solid bar),
   `--labelSecondary` (header labels, chevrons, zero amounts, status labels), `--actionPrimary` (⊕),
   `--buttonSecondaryBackground` (toolbar hover), `--borderSubtle` (toggle outline).
9. **Default categories** (Lead note 2). A new `services/default-categories.ts` holds the list (exact names
   below) and `defaultCategoryStmts(db, budgetId, actor, now)`.
   - It returns, in order, for each group: `groupsRepo.insertIfSortStmt(row)` and its `changeLogInsert`
     (`create`, `category_group`, `after: groupToApi(row)`), then for each of the group's categories
     `categoriesRepo.insertIfSortStmt(row)` and its `changeLogInsert` (`create`, `category`,
     `after: categoryToApi(row)`). The sort guard always holds for a brand-new plan, because statements in a
     D1 batch see the earlier ones.
   - Sorts are 0, 1, 2 for groups and 0…n−1 within a group, the same as `createCategoryGroup` and
     `createCategory` would give. `hidden` and `collapsed` are false. `budgetId` is the plan id and the actor is
     the creating actor.
   - `createBudget` runs `[...buildCreateBatch(...), ...defaultCategoryStmts(...)]` as **one** `db.batch`. A new
     plan therefore writes 15 `change_log` rows: the budget, 3 groups and 11 categories.
   - Existing plans are not backfilled. The SQL comes only from the repositories' builders.
   - Names, with exact code points: "Bills": "🏠 Rent/Mortgage", "📱 Phone & Internet", "⚡️ Utilities"
     (U+26A1 U+FE0F); "Needs": "🛒 Groceries", "🚘 Transportation", "💆 Health & Personal Care",
     "😌 Emergency fund"; "Wants": "🍽️ Dining out" (U+1F37D U+FE0F), "🍿 Entertainment", "🏝️ Vacation"
     (U+1F3DD U+FE0F), "❗️ Stuff I forgot to plan for" (U+2757 U+FE0F). These match the source's DOM.

## What changes

- **Web.**
  - `pages/plan.tsx` gets the body layout.
  - New `plan/PlanGrid.tsx`, `plan/Toolbar.tsx`, `plan/rows.tsx`, `plan/AvailablePill.tsx`,
    `plan/ProgressBar.tsx`, `plan/format.ts`, `plan/collapse.ts`, `plan/progressBars.ts`, `plan/icons.tsx`
    (our own glyphs: chevron down and right, undo, redo, clock-back, bars on and off, check), and
    `plan/plan-grid.css`, imported by `PlanGrid.tsx`.
  - New `api/months.ts`.
  - It may import `PlusCircleIcon` from `shell/icons.tsx` but does not edit it.
- **Worker.** `services/budgets.ts` (`createBudget` adds the defaults) and the new
  `services/default-categories.ts`. The repositories do not change: their builders are enough.
- **Tests.**
  - `apps/worker/test/budgets.test.ts`: the change_log queries filter `entity_type = 'budget'`, plus new
    default-category cases.
  - `apps/worker/test/months.test.ts`: the seeded group is found by id, not `groups[0]`, and the base log count
    goes from 6 to 20.
  - `e2e/months.spec.ts`: a new plan has the three default groups.
  - New `e2e/plan-grid.spec.ts` and `e2e/plan-grid.fixtures.ts`.
- **User-visible.** The Plan page shows the grid. New plans start with eleven categories. For REST and MCP
  clients, `POST /budgets` and `create_budget` now also create those groups and categories, which show up in
  `get_plan_month`.

## Downstream effects

- **EXF-494** gives "Category Group" and the group ⊕ their handlers (`Toolbar.tsx`, `GroupRow` in
  `rows.tsx`) and replaces `saveCollapsed` / `loadCollapsed` in `plan/collapse.ts` with the server PATCH. The
  read model's `collapsed` then becomes the only source.
- **EXF-489** replaces the Assigned value in `CategoryRow` (the `.assigned-box` element) with the input.
- **EXF-491 / EXF-493** fill the `PageHeader` (Ready to Assign, month arrows). The grid already follows the
  URL month.
- **EXF-498** gives the checkboxes meaning (`Checkbox` in `rows.tsx`) and adds row click selection.
- **EXF-521 / EXF-523** render into `aside.plan-inspector`.
- **EXF-472** replaces `plan/progressBars.ts`. **EXF-473** moves the Ctrl/⌘+↑/↓ binding out of
  `PlanGrid.tsx`.
- **EXF-511 (targets)** adds target labels and bar colours in `CategoryRow` / `ProgressBar`. The no-target
  rules live in `plan/format.ts` (`statusLabel`, `barSegments`).
- **Every test** that creates a plan now gets 3 groups and 11 categories. Any test that counts a plan's
  change_log rows or reads `groups[0]` must account for them.

## Out of scope

The view chips row; the right-hand panel's contents; month navigation; the Ready to Assign pill; editing
Assigned; selection; the move and cover popovers; the activity popover; the Hidden Categories pseudo-row; target
labels and yellow pills; the light theme; the "alternative" pill style; plan currency formats; any REST or MCP
surface; any migration; backfilling existing plans.

## Acceptance

The tests run at the Playwright default viewport (1280×720). **Fixture F** (`plan-grid.fixtures.ts`, stubbed
on `**/api/v1/budgets/*/months/*`):

- Group Bills:
  - Rent: carried 0, assigned 230.00, activity −60.00, available 170.00.
  - Phone: 0, 0, −50.00, −50.00.
  - Utilities: 0, 40.00, −40.00, 0.
  - A hidden category, 10.00 assigned.
  - Subtotals 270.00 / −150.00 / 120.00.
- Group Needs:
  - Groceries: carried 25.00, assigned 100.00, activity −30.00, available 95.00.
  - Emergency fund: all zero.
  - One category also carries an extra `target: null` field.
  - Subtotals 100.00 / −30.00 / 95.00.
- A hidden group.
- `uncategorized`: activity −12.34, available −12.34.

**Fixture F0** is F with `uncategorized: null`.

**Compare cases** reproduce the source live: this Thread's tab, Test Budget, `/budget` (current month), dark
theme, the same viewport for both apps, Progress Bars On and every group expanded unless the case says
otherwise.

1. **Default plan (AC8).** Create a plan with `POST /api/v1/budgets`, then GET its current month. The groups
   are Bills, Needs and Wants, with the eleven exact names in order and every amount 0. change_log for the plan
   has 15 rows, all `create`, with the request's actor: 1 budget, 3 category_group, 11 category. Repeat with
   MCP `create_budget`: the same, with actor `mcp:…`.
2. **Default grid (compare).** Open the new plan's `/budget`. It has 3 group rows and 11 category rows in the
   source's order. Every Assigned and Activity cell is "$0.00" in `--labelSecondary`, every pill is "$0.00"
   with bg rgb(60,62,83), text rgb(155,156,170) and is `disabled`, there are no status labels, and the bars
   show only the empty track. Source: Test Budget `/budget` (all $0.00) looks the same.
3. **Geometry (compare).**
   - Toolbar 48px, header row 40px, group rows 40px, category rows 44px.
   - Pill border-radius 1000px, 14px/500.
   - Group row bg rgb(21,23,45), name 16px/600.
   - The four toolbar buttons, with their labels, are in source order; Undo and Redo are disabled.
   - The toggle's "Progress Bars On" tab is selected.
   - The grid is narrower than the main area, with an empty right panel 442px wide.
   - Source: the same measurements on `/budget`.
4. **Values and labels (AC1, AC3).** Stub F and open `/budget`.
   - Rent: "$230.00", "−$60.00", green pill "$170.00" (bg rgb(119,186,33), text rgb(12,13,34)), label
     "Spent $60.00 of $230.00", title starting "$170.00 Available to plan your spending".
   - Phone: red pill "−$50.00" (bg rgb(191,46,59), text white, U+2212), label "Overspent. $50.00 of $0.00",
     bar segment `overspent` at 100%.
   - Utilities: "Fully Spent" and a grey disabled pill.
   - Groceries: "Spent $30.00 of $125.00".
   - Emergency fund: no label, an empty bar and a grey pill.
   - Clicking the zero pill does nothing; it is `disabled`.
5. **Subtotals and hidden (AC2).** With F: the Bills row shows "$270.00", "−$150.00", "$120.00" as plain text
   (no pill) and Needs shows "$100.00", "−$30.00", "$95.00". The hidden category and the hidden group are absent.
   The page loads without an error, despite the extra `target` field.
6. **Uncategorized (AC6).** With F there is a first row above Bills labelled "Uncategorized Transactions" in
   rgb(218,172,0), Assigned "-", Activity "−$12.34" and a red pill "−$12.34" that is disabled. With F0 that row
   is absent.
7. **Collapse (AC4).**
   - Click Bills' chevron. Its 3 category rows go, the group row and its subtotals stay, and the chevron's label
     becomes "Expand Bills categories". Reload: still collapsed.
   - Click the header "Collapse all": every group is collapsed and the header reads "Expand all". Click it:
     everything is expanded and the header reads "Collapse all".
   - Press Ctrl+ArrowUp: everything collapses. Ctrl+ArrowDown: everything expands.
   - Compare: the source's collapse of one group looks the same. Put it back.
8. **Progress bars (AC5).**
   - Click "Progress Bars Off": no bar and no status label remain in the DOM, category rows are 36px with a
     14px name, number columns are 18% of the grid width, and the Off tab is selected.
   - Reload: still off. Click On: 44px rows and the bars return.
   - Compare: the source with Progress Bars Off. Put it back on.
9. **States.**
   - Stub the month with a 500: "Couldn't load this month." and a "Try again" button appear, with the toolbar
     and header still shown. Remove the stub and click Try again: the rows appear.
   - With a stub that answers `groups: []`: toolbar and header, no rows, no error.
   - A delayed stub: the toolbar and header show at once and the grid has `aria-busy="true"`.
10. **Month in the URL.** Open `/budget/<other YYYYMM>`: the request is for `<YYYY-MM-01>` of that month. On
    `/budget` it is for the current local month.
11. **Branding (AC7).** The grid's text contains no source app name. The OpenAPI path list and the MCP tool list
    are unchanged (AC9): `openapi.test.ts`, `mcp.test.ts` and `e2e/mcp.spec.ts` pass untouched.

## Manifest

touches: [apps/web/src/pages/plan.tsx, apps/web/src/plan/**, apps/web/src/api/months.ts, apps/worker/src/services/budgets.ts, apps/worker/src/services/default-categories.ts, apps/worker/test/budgets.test.ts, apps/worker/test/months.test.ts, e2e/months.spec.ts, e2e/plan-grid.spec.ts, e2e/plan-grid.fixtures.ts, docs/plan-grid-design.md, docs/plan-grid-spec.md, docs/README.md]
shared: []
migrations: 0
