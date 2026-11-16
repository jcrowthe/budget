# Plan views, snooze and Auto-Assign design (EXF-500, EXF-516, EXF-519)

One Build for three tickets that need each other: view chips on the Plan grid (EXF-500), snoozing a target for
the current month (EXF-516), and one-click Auto-Assign (EXF-519). Spec:
[plan-views-autoassign-spec.md](plan-views-autoassign-spec.md).

## Source

Notes and 17 cropped captures: `/workspace/scratch/source/plan-views-autoassign/` (`notes.md` has every
measurement; `captures.log` lists each capture taken and deleted). The test plan has no targets and $0.00
everywhere, so the Overspent chip, the footer, filtered subtotals, the snooze switch, pill and toast, the Assign
popover (disabled at RTA $0.00) and non-zero previews are **not compared: not visible in the test plan**; they
follow the tickets.

Observed:
- **Chips**: a row under the header (bg `#15172D`, bottom border `rgba(255,255,255,.1)`), left-aligned at 15 px,
  6 px apart: All, Underfunded, Overfunded, Money Available, Snoozed (then a views-menu icon, not built). 12 px/500,
  24 tall, padding 3/12, radius 5, white, 1 px border; unselected transparent border on `#3C3E53` (hover
  `#56596C`); selected border `#7583FF` on `#292C6C` (hover `#383CA3`). `title` = label.
- **Empty view**: header row and groups gone; centred column (40 px under the toolbar, gap 16, max 512): a picture
  (source art, not copied), a 14/500 `#C4C5CF` message, a secondary "View All" (16/500, 32 tall, padding 6/16,
  radius 8, `rgba(117,131,255,.2)`, hover .27, `#F1F1FF`). Messages: Underfunded "You don't currently have any
  underfunded categories."; Overfunded "You don't currently have any overfunded targets."; Money Available "You
  don't currently have categories with money available."; Snoozed "You don't currently have categories with
  snoozed targets in this month.". Underfunded/Overfunded add a link "Um, why is this view always empty?" (not
  clicked; left out). "Category Group" is disabled (`#383CA3`, default cursor).
- **Auto-Assign card**: lightning 16 + "Auto-Assign" 14/600 `#F1F1FF` + 12 px chevron right after the title; body
  padding 16 under a rule `rgba(255,255,255,.08)`. Buttons full width, 32 tall, padding 0 16, radius 8,
  `rgba(60,62,83,.6)` (hover .8), `#A3ACFF`, label 14/500 left, amount 600 right (its `title` = the amount); 2 px
  between buttons, 16 px between groups. Tooltips are native `title`s, the same in every scope; Underfunded and
  the two Last Month buttons have none; the others carry the ticket's text ("$0.00" in Reset Available's).
  Position: 2nd card with nothing selected (after the month summary), 3rd with one (after Available Balance and
  Target, before Notes), 2nd with two (after the selection summary). In an empty view the body is "This view has
  no categories." and a ghost "View All Categories".
- **Options**: nothing or two selected: Underfunded | Assigned Last Month, Spent Last Month, Average Assigned,
  Average Spent | Reset Available Amounts, Reset Assigned Amounts. One selected (no target): no Underfunded,
  "Reset Available Amount", "Reset Assigned Amount". **Underfunded shows at $0.00 plan-wide and for two**; Reduce
  Overfunding never showed at $0.00.

## Decisions where ticket and source differ

1. Underfunded is hidden only for **one** category whose gap is 0 (live source), not whenever $0.00 (ticket).
   Reduce Overfunding is hidden at 0 in every scope.
2. Overfunded = a target not snoozed with the engine's `overfunded > 0` (Lead), not "Available exceeds target".
3. The parameter is `view` everywhere. 4. Averages cover at most 12 months (not compared).

## Approach

### One definition of each view: `packages/schema/src/plan-views.ts` (pure)

`PlanView = all | overspent | underfunded | overfunded | money_available | snoozed`. A **visible** category (not
hidden, group not hidden) is in a view when (`t = c.target`, `active = t && t.status !== "snoozed"`):

| view | rule |
|---|---|
| all | always |
| overspent | `available < 0` |
| underfunded | `available < 0` or (`active` and `t.to_go_this_month > 0`) |
| overfunded | `active` and `t.overfunded > 0` |
| money_available | `available > 0` |
| snoozed | `c.target_snoozed` |

`viewCategories(d, view)`; `viewDetail(d, view)`: groups with at least one match, only those categories, group
`assigned/activity/available` re-summed over them, `uncategorized: null`; for `all` it returns `d` unchanged. RTA
and its breakdown never change. Used by the grid (subtotals, footer, empty state, Overspent count), the panel
summary, both month reads' `view`, the previews and plan-wide Auto-Assign (REST, MCP, card, popover).

### Snooze in core: `packages/core/src/targets.ts` (shared; only this file and its test)

`TargetDefinition` gains optional `snoozed_months?: readonly Month[]`. `computeTargetMonth` computes every figure
as now and sets `status: "snoozed"` when the month is listed; its returned `definition` never carries
`snoozed_months`. A target that is not snoozed gives identical output, and the existing tests pass unchanged.
`budget-engine.ts` is not edited: it spreads the whole `EngineTarget` into the definition it passes, so the
Worker adds `snoozed_months` in `loadInput`. Cost to Be Me (EXF-525) would still see a snoozed target's figures;
nothing else is needed for EXF-516 acceptance 6.

### Data: `apps/worker/migrations/20261116100700_target_snoozes.sql` (additive)

`target_snoozes(budget_id, category_id, month, created_at)`, PK `(category_id, month)`, index `budget_id`. A row
= snoozed in that month; unsnooze deletes it; next month has no row, so the target is active again with no write.
Deleting a target deletes its category's rows in the same batch.

### Worker

- **Month read**: `getPlanMonth(env, id, month, today, view = "all")` loads the plan's snoozes, passes
  `snoozed_months` per target, sets `target_snoozed` (row for this month and a target), then `viewDetail`.
  `getMonthSummary(…, categoryIds?, today, view?)` totals `viewCategories`; `category_ids` with `view` is a 422.
- **Snooze**: `PUT /budgets/{budget_id}/months/{month}/categories/{category_id}/target-snooze?today=`, body
  `{ snoozed }` → `{ data: { month, category_id, snoozed } }`. 404 unknown plan or category. 422, nothing stored:
  no target ("This category has no target to snooze.") or `month ≠ toMonth(today ?? UTC date)` ("You can only
  snooze targets in the current month."). Same state: no write, no row. Otherwise one batch: `change_log`
  (`entity_type "target_snooze"`, `entity_id "{category_id}:{month}"`, `update`, before/after
  `{month, category_id, snoozed}`, actor) and the insert or delete.
- **Auto-Assign** (`services/auto-assign.ts`): `GET /budgets/{budget_id}/months/{month}/auto-assign?category_ids=
  a,b | view=…&today=` → `{ data: AutoAssignPreview }`; `POST` same path `{ strategy, category_ids?, view?, today? }`
  → `{ data: { month, strategy, changed: MonthCategory[] } }`. Scope: `category_ids` (1–500 active categories,
  hidden allowed, unknown → 404) or else `viewCategories(month, view ?? "all")`, so plan-wide never touches a hidden
  category; both → 422. History comes from the month reads: `getPlanMonths` in `services/months.ts` runs
  `computeMonth` for M and each of the 12 months before it on **one** `loadInput`; no query of `transactions`.
  **First month** of a category = the earlier of its `created_at` month and the first month of that window with
  non-zero Assigned or activity. **Averages** = mean over `max(first, M−12) … M−1`, a month with nothing counting
  0, rounded to the cent (halves away from zero); no such month → 0. **Last month** = M−1; spending =
  `max(0, −activity)`. **Apply**: one `db.batch`; per category whose Assigned changes, a `change_log` row
  (`month_category`, `"{cat}:{month}"`, before `{month, category_id, assigned}`, after the same plus
  `auto_assign: {id, strategy}`, one `id` per run, actor) and a guarded cell write (`setIfHoldsStmt`). The first
  statement is guarded by "every cell still holds what was read", later ones by `changes() > 0`. A lost race
  writes nothing; the service recomputes up to 5 times, then 409. A second concurrent request recomputes from the
  new figures (Underfunded then adds 0). Unchanged categories get no row. RTA may go negative.
- **MCP**: `snooze_target` (in `tools/targets.ts`), `preview_auto_assign` and `auto_assign` (new
  `tools/auto-assign.ts`); `view` on `get_plan_month` and `get_month_summary`. Descriptions: what is returned,
  `MONEY`/`MONTH`/`DATE`, one sentence per strategy saying **adds to** or **sets** Assigned, and that
  `auto_assign` changes money at once.
- **Coverage**: `mcp-coverage/months.ts`: `GET`/`POST /budgets/{budget_id}/months/{month}/auto-assign` →
  `preview_auto_assign` / `auto_assign`. `mcp-coverage/targets.ts`: `PUT …/categories/{category_id}/target-snooze`
  → `snooze_target`.

### Auto-Assign arithmetic: `packages/schema/src/auto-assign.ts` (pure)

Per category: `A` assigned, `L` carried, `X` activity, `target`, `last_assigned`, `last_spent`,
`average_assigned`, `average_spent`.

| strategy | | new Assigned | preview (sum over scope) |
|---|---|---|---|
| underfunded | adds | `A + (active ? to_go_this_month : 0)` | sum of gaps |
| assigned_last_month | sets | `last_assigned` | resulting Assigned |
| spent_last_month | sets | `last_spent` | resulting Assigned |
| average_assigned | sets | `average_assigned` | resulting Assigned |
| average_spent | sets | `average_spent` | resulting Assigned |
| reduce_overfunding | adds a negative | `A − r`, `r = active ? min(overfunded, max(A, 0)) : 0` | sum of `r` |
| reset_available | sets | `−(L + X)` | resulting Available (0) |
| reset_assigned | sets | `0` | resulting Assigned (0) |

An overspent category without a target adds nothing to Underfunded. Every worked example of EXF-519 follows from
this table and is a unit test (spec task 2). `autoAssignOptions(preview, scope: "one" | "many")` returns the
buttons in order with group, label, amount, title and visibility: group 1 Underfunded; group 2 Assigned Last Month,
Spent Last Month, Average Assigned, Average Spent; group 3 Reduce Overfunding (its place not compared), Reset
Available Amount(s), Reset Assigned Amount(s). Singular labels for "one".

### Web

- **View state** in `PlanContent` (`useState<PlanView>("all")`): not saved (All after a reload or plan switch),
  kept across months. The selectable ids given to selection and panel are `viewCategories(detail, view)`. In
  Overspent, when the count drops to 0 the view returns to All (not compared).
- **`ViewChips`** between `PlanHeader` and the body, as observed: All, `⚠ N Overspent` (only when N > 0; N =
  visible categories with Available < 0; bg `--statusNegative`, our own warning-triangle; "1 Overspent"), then the
  rest. Buttons with `aria-pressed`. No filter icon (EXF-502).
- **Grid**: in a view, renders `viewDetail(data, view).groups`, hides Uncategorized and `HiddenCategoriesRow`,
  `Toolbar` gets `addGroupDisabled`. With rows: footer "Some categories are hidden by your current view." and a
  secondary "View All". Without: no column header row; the message and "View All" (no picture).
- **Panel**: month summary over `viewCategories` with nothing selected, over the selection otherwise.
  `AutoAssignCard` placed as observed; collapse held in `PlanPanel` state.
- **Assign popover**: the **Auto** tab is enabled ("Manually" stays the default; not compared) and shows the
  plan-wide list for the view; a click applies and closes the popover.
- **`AutoAssignOptions`** (card and tab) shows the Worker's preview (`useAutoAssignPreview`, key
  `["auto-assign", budgetId, month, scope]`). `endWrite` in `api/monthCache.ts` also invalidates
  `["auto-assign", budgetId]`, so every write refreshes previews; the month refetch updates grid, RTA, summary and
  inspector.
- **Double click**: `useAutoAssign(budgetId, month)` posts through `beginWrite`/`inOrder`/`endWrite`. A small store
  keyed by plan and month is `busy` from the click until the month query's `dataUpdateCount` moves past its value
  after the POST succeeded (cleared on failure, with "Couldn't auto-assign."). Every Auto-Assign button of that
  month, card and tab, is disabled while busy: `TargetCard`'s Assign fix, shared.
- **Snooze**: in the Target card below Edit Target (when there is a target), `Switch` "Snooze target for this
  month" (`aria-checked` = `target_snoozed`) and a (?) icon whose `PanelTooltip` reads "Snooze Target" (bold) and
  EXF-516's text (in the spec, "Budget" for the source's name), plus "You can only snooze targets in the current month." outside `localCurrentMonth()`, where the
  switch is disabled. It is also disabled from a toggle until the month is read again (no optimistic write). The
  breakdown stays; donut and message are already empty for `snoozed`. Grid: no status text (already so);
  `targetPill` for `snoozed` gives tone positive (Available > 0; zero/negative otherwise), icon `"snooze"` (our own
  "zᶻ" SVG) and `pillTitle(available)`. The progress bar is unchanged (not compared).
- **Shift+Z** (`usePlanShortcuts` `onSnooze`, ignored in inputs and dialogs like the others): toggles when exactly
  one category is selected, it has a target and the month is current; otherwise nothing. **Tip**: after the first
  toggle by any path, while `ui_state.snooze_tip_seen` is not true, a toast at the bottom centre "Keyboard Tip:
  Press shift Z to snooze a category's target" with × ("Close"); showing it saves `snooze_tip_seen: true` (one new
  `UI_STATE_FIELDS` key, per plan like the sidebar's collapsed groups).
- **Custom properties** (on `.plan-page` in `plan/plan-views.css`; `shell/tokens.css` is out of bounds):
  `--viewChipBackground #3C3E53`, `--viewChipBackgroundHover #56596C`, `--viewChipSelectedBackground #292C6C`,
  `--viewChipSelectedBackgroundHover #383CA3`, `--viewChipSelectedBorder #7583FF`,
  `--autoAssignButtonBackground rgba(60,62,83,.6)`, `--autoAssignButtonBackgroundHover rgba(60,62,83,.8)`,
  `--disabledPrimaryLabel #383CA3`. **Icons** (`plan/icons.tsx`, our own): `LightningIcon`,
  `WarningTriangleIcon`, `SnoozeIcon`, `QuestionCircleIcon`.

## Downstream effects

`MonthCategoryDetail` gains required `target_snoozed` (`EngineShape` in `services/months.ts` omits it like
`note`). `e2e/rta.spec.ts` asserted a disabled Auto tab: it now asserts enabled, Manually still selected.
`deleteTarget` also deletes snoozes.

## Out of scope

Custom views and the views menu (EXF-502); Cost to Be Me and expected income (EXF-525); Assigned in Future Months
(EXF-527); upcoming transactions on the pill (EXF-505); credit card payment categories and targets (EXF-532,
EXF-537, EXF-538); Undo (not on the Plan page: a run cannot be undone yet); the empty-state link and picture.

## Acceptance

Seeds go through REST with `today` = the fixed date; the browser clock is fixed at 12:00 on the 15th of the
current UTC month M. Clicks use `realClick`, at 1440×900 and 1024×700. Compare cases: the source test plan's Plan
page, dark, window as it is (1600×813), current month.

1. **(EXF-500) Chips, compare.** Source: All, nothing selected. Clone: nothing overspent. → All (selected),
   Underfunded, Overfunded, Money Available, Snoozed; no filter icon; sizes and colours as in Source.
2. **(EXF-500) Overspent.** Two categories at −10.00 and −5.00, others ≥ 0. → "2 Overspent" between All and
   Underfunded; clicked, it lists exactly those two, a group without one is gone, subtotals sum only listed
   rows. Cover one → "1 Overspent"; cover both → no chip, All selected.
3. **(EXF-500) Money Available.** Rows at 50.00, 0.00, −5.00. → Only 50.00; footer "Some categories are hidden by
   your current view."; its "View All" brings every row back with All selected.
4. **(EXF-500) Empty views, compare.** Source: click Underfunded, Overfunded, Money Available, Snoozed, each
   time back with View All. Clone: a new all-$0.00 plan. → Each view's message and "View All", no column header
   row, "Category Group" disabled; the Auto-Assign card shows "This view has no categories." and "View All
   Categories", which returns to All.
5. **(EXF-500) Reload.** Snoozed, then reload. → All.
6. **(EXF-500, EXF-516) Summary follows the view.** S: monthly target 100.00, 40.00 assigned, snoozed; others
   25.00. Snoozed view. → Panel "Assigned in {Month}" $40.00; `GET …/summary?view=snoozed` assigned 40000;
   `GET …/months/{M}?view=snoozed` one group with only S, group assigned 40000.
7. **(EXF-516) Snooze.** Yearly set-aside 200.00 due the last day of M+1, 40.00 assigned. → "$60.00 more needed
   this month", yellow pill with clock, card Underfunded $60.00. Toggle "Snooze target for this month" → no status
   text; green pill with snooze icon, title "$40.00 Available to plan your spending—or click to move it to another
   category!"; breakdown kept, switch on; no Underfunded in the card; not in Underfunded view; Snoozed lists it
   alone. Toggle back → all restored, Underfunded $60.00.
8. **(EXF-516) Shift+Z and tip.** New plan, case 7's category checked; Shift+Z → snoozed and the toast "Keyboard
   Tip: Press shift Z to snooze a category's target"; × closes it. Shift+Z → unsnoozed, no toast. After a reload,
   no toast again.
9. **(EXF-516) Other months.** M+1 → switch off and disabled, tooltip ends "You can only snooze targets in the
   current month."; with M snoozed, M+1 shows the target active (status text present, Snoozed view empty).
10. **(EXF-516) Refusals.** `PUT …/months/{M+1}/…/target-snooze?today={M}-15`, and in M for a category with no
    target → 422 with the messages above, `target_snoozed` still false; MCP `snooze_target` → tool error. A
    snooze adds one `change_log` row with the actor (Worker test). Delete the target and set it again → not
    snoozed.
11. **(EXF-519) Card, compare.** Source: nothing selected, one checked, two checked (hover each button). Clone:
    same three states, new plan. → Groups, order, 32 px buttons, 2/16 px gaps; singular labels only for one;
    Underfunded $0.00 plan-wide and for two, absent for one; Reduce Overfunding absent; `title`s of Average
    Assigned, Average Spent, Reset Available, Reset Assigned are the ticket's.
12. **(EXF-519) First worked example.** W: monthly set-aside 100.00 created in M; 100.00 assigned in M; outflow
    30.00 in M; view M+1, select W. → Underfunded $100.00, Assigned Last Month $100.00, Spent Last Month $30.00,
    Average Assigned $100.00, Average Spent $30.00, Reset Available Amount $0.00, Reset Assigned Amount $0.00.
    Clicking in turn (waiting for each re-read): Spent Last Month → Assigned 30.00, Available 100.00, "$70.00 more
    needed by the {last day}"; Assigned Last Month → 100.00, 170.00, "Funded"; Average Spent → 30.00; Average
    Assigned → 100.00; Reset Available Amount → −70.00, Available 0.00, "$170.00 more needed…"; Reset Assigned
    Amount → 0.00; Underfunded → 100.00. Assign 30.00 by hand → Underfunded $70.00, click → 100.00. Grid, RTA,
    inspector and previews follow without a reload.
13. **(EXF-519) Reduce Overfunding.** Case 12's target, 150.00 in M → preview $50.00, click → 100.00; M+1 with
    250.00 → $150.00. Unit test: the balance example → 46 660.
14. **(EXF-519) Multi-select.** Two categories, monthly targets of 100.00, nothing assigned, both checked →
    Underfunded $200.00; click → each 100.00; selection summary Assigned $0.00 → $200.00.
15. **(EXF-519) Popover.** RTA > 0, nothing selected; Assign → Auto → the panel card's options and amounts,
    plural labels; Underfunded applies and closes the popover.
16. **(EXF-519) View-scoped, snoozed, hidden.** U: target 60.00, nothing assigned; S: target 100.00, 50.00
    assigned, snoozed; H: hidden, target 25.00, 5.00 assigned; O: no target, 10.00 assigned. Underfunded view
    lists U alone; card Underfunded $60.00; click → U 60.00, S, H, O unchanged. `POST …/auto-assign
    {strategy:"reset_assigned", view:"money_available"}` → U, S, O at 0, H at 5.00; `changed` = U, S, O.
17. **(EXF-519) Double click.** Hold the month re-read after the POST; click Underfunded twice → disabled after
    the first, one POST; after release, Assigned is the target amount, not twice the gap.
18. **(EXF-519) History.** A run over three categories, one already at its result → two `change_log` rows with
    actor, before/after Assigned and one shared `auto_assign.id`; a run changing nothing writes none (Worker).
19. **(EXF-519) REST and MCP.** Case 12's setup: `GET …/auto-assign?category_ids=W` and `preview_auto_assign` →
    `{underfunded:100000, assigned_last_month:100000, spent_last_month:30000, average_assigned:100000,
    average_spent:30000, reduce_overfunding:0, reset_available:0, reset_assigned:0}` (plus `category_count:1`);
    `auto_assign {strategy:"spent_last_month"}` → Assigned 30000.
20. **Averages (unit).** Jan, Nov 100 / Dec 30 → 65 000; spent 30/0 → 15 000; weekly 50/0 → 25 000, 10/0 →
    5 000; a category with 14 months of history averages only the last 12.

## Manifest

touches: [packages/core/src/targets.ts, packages/core/test/targets.test.ts, packages/schema/src/plan-views.ts, packages/schema/src/auto-assign.ts, packages/schema/src/targets.ts, packages/schema/src/months.ts, packages/schema/src/month-totals.ts, packages/schema/src/target-wording.ts, packages/schema/src/ui-state.ts, packages/schema/test/plan-views.test.ts, packages/schema/test/auto-assign.test.ts, packages/schema/test/target-wording.test.ts, packages/schema/test/month-totals.test.ts, apps/worker/migrations/20261116100700_target_snoozes.sql, apps/worker/src/db/schema/target-snoozes.ts, apps/worker/src/repositories/target-snoozes.ts, apps/worker/src/services/months.ts, apps/worker/src/services/targets.ts, apps/worker/src/services/auto-assign.ts, apps/worker/src/routes/months.ts, apps/worker/src/routes/targets.ts, apps/worker/src/routes/auto-assign.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/targets.ts, apps/worker/src/mcp/tools/auto-assign.ts, apps/worker/test/mcp-coverage/months.ts, apps/worker/test/mcp-coverage/targets.ts, apps/worker/test/plan-views.test.ts, apps/worker/test/target-snooze.test.ts, apps/worker/test/auto-assign.test.ts, apps/web/src/plan/**, apps/web/src/pages/plan.tsx, apps/web/src/api/months.ts, apps/web/src/api/monthCache.ts, apps/web/src/api/targets.ts, apps/web/src/api/autoAssign.ts, e2e/plan-views.spec.ts, e2e/target-snooze.spec.ts, e2e/auto-assign.spec.ts, e2e/auto-assign.fixtures.ts, e2e/rta.spec.ts, docs/plan-views-autoassign-design.md, docs/plan-views-autoassign-spec.md, docs/README.md]
shared: [packages/core/src/targets.ts — optional `snoozed_months` input and the `snoozed` status in computeTargetMonth (Lead's note 4; budget-engine.ts untouched)]
migrations: 1

Outside the Lead's list: `packages/schema/src/ui-state.ts`, for the one `snooze_tip_seen` key that remembers the
keyboard tip (the codebase's mechanism for such state). None of note 10's files changes.

## Loading state of the Auto-Assign list (rework)

While a preview is loading, `AutoAssignOptions` draws all eight rows for the scope kind (singular labels for one category) in their final layout, disabled, with a dash for the amount; no figures of another selection are shown (the preview query has no placeholder data). `.auto-assign-list` keeps the height of all eight rows (300px), so the Notes card and the cards below never move: not when the preview arrives, not when Underfunded (one category) or Reduce Overfunding is hidden (blank space stays at the bottom of the card), not when the selection changes between categories. The Assign popover's Auto tab uses the same list, so it keeps one height too. The remaining shift: leaving or entering an empty view (the card shows its short message there); that follows a chip click, not a selection. `e2e/auto-assign-layout.spec.ts` holds the preview read back for one second and compares the Notes card's top edge.
