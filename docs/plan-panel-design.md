# Plan selection and right panel: design (EXF-498, EXF-523, EXF-521, EXF-586)

One Build, four tickets, one pull request:

- **EXF-498**: selecting categories in the Plan grid (name click, checkboxes, group and header checkboxes,
  keyboard).
- **EXF-523**: the right panel with nothing selected (the month summary) or with two or more (the selection
  summary), plus the drag handle that resizes the panel.
- **EXF-521**: the category inspector when exactly one category is selected: header with pencil, the Available
  Balance card and the Notes card. Adds a category note (column, PATCH, MCP) and a category-month read.
- **EXF-586**: a defect. After a plan switch, the grid shows the previous plan's month until the new one loads.
  Previous data is now kept only within one plan.

The Lead's scope notes override the tickets where they differ.

## Source

Study notes: `/workspace/scratch/source/plan-inspector/notes.md` (exact texts, computed styles, behaviour, and a
log of the controls used). Cropped captures, no sidebar, in the same folder: `01-nothing-selected.png`,
`02-one-selected-inspector.png`, `02b-pencil-tooltip.png`, `02c-one-selected-notes-card.png`,
`03-two-selected.png`, `04-group-checkbox-selected.png`, `05-tooltip-assigned-row.png`,
`06-resize-handle-hover.png`, `06b-resize-handle-rest.png`, `07-all-selected-header-checkbox.png`.

What the source shows (dark theme, test plan, every figure $0.00). Exact sizes and colours are in the notes:

- **Selection.** A name click replaces the selection. A checkbox toggles one row; a group checkbox adds its
  categories. The header checkbox clears a partial selection, and from empty selects all ("Uncheck all"). A
  selected category row is #1B1D48; checked and partial boxes are #545BFE (check or dash). Escape clears,
  Ctrl+A selects all, ↓ with nothing selected picks the first category, ↑/↓ move (skipping group rows), and
  Shift+↑/↓ select a range from a fixed anchor. All keys act only with focus on the page. The selection
  survives a month change.
- **Panel.** It is 33% of the content area (442 of 1340 px), #0C0D22, with a 1px left border, and scrolls on its
  own. The resize handle is a 3 px ew-resize strip; on hover an 8×40 #7583FF pill shows, 12 px left of the border.
- **Cards.** #15172D, radius 8, 16 px apart. The header is a full-width button with `aria-expanded`: h2 14 px/600
  #F1F1FF plus a chevron. Rows show label left and value right (14 px, 500 and 600, #C4C5CF).
- **Nothing selected.** The "November's Summary" card has four rows with the exact EXF-523 tooltips (about 2 s
  hover delay; 12 px on #3C3E53, max 288 wide).
- **Two or more.** An h2 "N Categories Selected" (21 px/700), the names in grid order joined by ", ", then the
  same card over the selection.
- **One.** An h1 name (21 px/700, ellipsis) and a #727484 pencil (aria-label "Edit category: {name}", tooltip
  "Edit Category"). Then the cards Available Balance (chevron, pill on the right, four rows, no tooltips),
  Target, Auto-Assign and Notes. Notes is not collapsible and shows "Enter a note..." in a block at least 64 px
  tall.
- **Not visible in the test plan** (judge against the tickets): non-zero figures and pill colours, a note's
  content, note editing, a collapsed card, dragging the handle, the pencil's popover.

## Approach

### Selection (EXF-498)

- `plan/selection.ts` holds pure functions over `{ selected: string[]; anchor; cursor }` and a hook
  `useSelection()`. The state lives in the Plan page component, rendered with `key={budgetId}`, so changing plan
  or reloading clears it, and a month change keeps it. In the grid, a row counts as selected only if it is still
  a visible category, so a deleted or hidden one drops out on its own.
- "All categories" means every category that is not hidden, in a group that is not hidden, collapsed groups
  included. Uncategorized is never selectable. ↑/↓ walk the rows in visible order (collapsed groups skipped),
  as the Assigned editor already does.
- **Name click**: selects only that category; the edit popover no longer opens from the name. Focus stays on
  the name. (Difference: the source also opens the row's Assigned editor. We don't, because the page shortcuts
  must work outside fields, and an open editor would take the next arrow key.)
- **Assigned click**: selects only that category and opens the editor as today. When the editor moves to the
  next or previous row (↑/↓/Enter in the cell), the selection follows.
- **Checkbox**: toggles one category; the anchor is set only when there was none. **Group checkbox**: if all its
  categories are selected it removes them, otherwise it adds them. It shows checked, mixed or unchecked.
  **Header checkbox**: with any selection it clears; from empty it selects all. Its label is "Check all", or
  "Uncheck all" when everything is selected. Mixed is exposed as `aria-checked="mixed"` (the source says
  "false"; "mixed" is the correct ARIA value).
- **Right-click** a category or group row: opens its edit popover. Group-name clicks still open the group
  popover as today.
- **Shortcuts** (`plan/shortcuts.ts`, one `usePlanShortcuts` hook bound on `window` while the Plan page is
  mounted; EXF-473 moves it into its registry): ↓/↑ move a single selection (with none: ↓ picks the first and ↑
  the last); Shift+↓/↑ select the range anchor…cursor; Ctrl/⌘+A selects all; Escape clears. They are ignored
  when the target is an input, textarea, select or contenteditable, or sits inside a `[role=dialog]` or
  `[role=menu]`, or when the event was already handled. The existing Ctrl/⌘+↑/↓ collapse binding moves into the
  same module unchanged.

### The right panel (EXF-523, EXF-521)

`plan/PlanPanel.tsx` replaces the empty `aside.plan-inspector` (`aria-label="Inspector"` kept) and renders one
of three modes from the cached month (`useMonth`) and the selection. Every figure is derived on the client with
the pure functions the Worker uses (`@budget/schema/month-totals`). The panel follows optimistic edits and moves
at once, sends no request of its own, and cannot race `monthCache`. It adds no query, so the placeholder rule
of note 6 has nothing to apply to.

- **Totals**: `leftover = Σ carried`, `assigned = Σ assigned`, `activity = Σ activity`,
  `available = Σ available`. Each category already has `available = carried + assigned + activity` (core
  engine), so available = leftover + assigned + activity holds exactly. With no selection, the sums run over
  every category that is not hidden, in a group that is not hidden (no filters until EXF-500). With a
  selection, they run over the selected categories.
- **Month summary card**: title "{Month}'s Summary" with the full English month name and a straight
  apostrophe. Four rows, each a focusable element with a tooltip on hover or focus (CSS delay 1.9 s; Escape
  hides it). The texts are exactly those of EXF-523, with `{Month}` the shown month and `{Previous}` the month
  before it.
- **Selection summary**: h2 "N Categories Selected", the names line, then the same card over the selection.
- **Inspector**: an h1 name; a pencil button `aria-label="Edit category: {name}"` (title "Edit Category") that
  opens the existing `NamePopover` (edit-category) anchored at the pencil. The pencil and the grid's right-click
  share one `onEditCategory(id, anchor)` raised from `PlanGrid` to the page.
  - **Available Balance card**: the pill on the right is the grid's pill look and title, but display-only (a
    span). Its rows:
    - Cash Left Over From Last Month = `carried`;
    - Assigned This Month = `assigned`, signed ("+$40.00", "−$40.00", "$0.00");
    - Cash Spending = `activity`, signed;
    - Credit Spending = $0.00. Credit spending is not built (EXF-532), so all of a category's activity is
      cash. The REST read returns `credit_activity: 0` for the same reason.
  - **Notes card**: h2 "Notes", then a button-like block showing the note (`white-space: pre-wrap`) or the
    placeholder "Enter a note...". Clicking it shows a textarea (aria-label "Note", maxLength 5000, focused,
    caret at the end). Blur saves if the trimmed text differs from the stored note; an empty result clears
    the note. Escape cancels without saving and does not clear the selection (not observed in the source).
    Enter inserts a newline.
- **Cards**: one `PanelCard` (header button with `aria-expanded`, `aria-controls`, chevron, optional right
  slot). Collapse is React state in the panel; a reload resets it, and it is not persisted.
- **Width**: default 33% of `.plan-body`. The handle (`role="separator"`, `aria-label="Resize panel"`,
  focusable, ←/→ by 16 px) drags with pointer capture to a px width clamped to 280 px … 60%. CSS renders
  `min(max(var(--panel-width), 280px), 60%, 100% − 562px)`, so the grid keeps its 562 px minimum and the panel
  never covers the Assigned column (about 202 px at 1024×700). **Persistence**: `sessionStorage`
  (`budget.planPanelWidth`), this tab's session only. It is not stored on the server: that would add a ui-state
  operation and its MCP line for pure layout, and a pixel width from one window is wrong in another.
- **Loading**: with no month data (first load, or a plan switch), the panel renders the empty aside with
  `aria-busy="true"`.

### Category note and the API (EXF-521, EXF-523)

- **Migration** `apps/worker/migrations/20261116100400_category_note.sql`:
  `ALTER TABLE categories ADD COLUMN note TEXT;` (nullable, additive). Drizzle gets `note: text("note")`.
- **The category** (`Category` schema, `categoryToApi`, `categoryJson()` SQL for log rows) gains
  `note: string | null`. `CategoryUpdate` accepts `note: string (≤ 5000) | null`. The value is trimmed at both
  ends, inner newlines are kept, and an empty or whitespace-only note clears it to null. 5000 is the month
  note's cap (`CATEGORY_NOTE_MAX`). A note change is the existing guarded single batch: the change_log row
  (`entity_type "category"`, `action "update"`, before/after with the note) comes first, then the row update
  with its actor.
- **Month read**: `MonthCategoryDetail` gains `note`, attached by `getPlanMonth` after `computeMonth`;
  `packages/core` is unchanged (its shape check omits `note`).
- **Shared arithmetic**: `packages/schema/src/month-totals.ts` (`monthTotals`, `categoryMonth`), for both
  the Worker and the web app.

| Operation | Returns (`data`) | MCP tool | Coverage line |
|---|---|---|---|
| `GET /budgets/{budget_id}/months/{month}/summary` `?category_ids=a,b` | `{ leftover, assigned, activity, available }` | `get_month_summary` (`category_ids` as a string array) | `mcp-coverage/months.ts` |
| `GET /budgets/{budget_id}/months/{month}/categories/{category_id}` | `{ leftover, assigned, cash_activity, credit_activity, available, note }` | `get_month_category` | `mcp-coverage/months.ts` (it owns the same path's PATCH) |
| `PATCH /budgets/{budget_id}/categories/{category_id}` `{ note }` | `{ category }` (now with `note`) | `set_category_note` (added to the list with `rename_category`, `set_category_hidden`) | `mcp-coverage/categories.ts` |

- `category_ids` is comma-separated, with 1 to 500 distinct ids. An empty value returns 422. An id that is not an
  active category of the plan returns 404 "Category". Listed ids count even when hidden. An unknown plan
  returns 404.
- Each tool description gives its `Returns { … }` and uses `MONEY` and `MONTH` (and says the note is plain
  text, at most 5000 characters, empty clears). `get_plan_month`'s description adds `note` to the category
  fields.

### Plan switch (EXF-586)

- `apps/web/src/api/placeholder.ts` adds `keepPreviousInPlan(budgetId)`, a `placeholderData` function that
  returns the previous data only when the previous query's key contains the same plan id, else `undefined`.
  It replaces `keepPreviousData` in `useMonth` and `useInstitutionSearch` (`api/bank-connections.ts` line 73),
  the only two uses on main.
- Plan page content is keyed by `budgetId`: selection, the open editor, popovers and notices reset on a switch.
- While the new plan's month loads: the grid has no rows (`aria-busy="true"`); the RTA box is its empty `div`;
  the header note is empty; the panel is empty. With no rows, no Assigned cell can be edited. A month change
  inside one plan still keeps the previous month on screen.
- `docs/conventions.md` gains under Product rules: "A query never shows another plan's data as a placeholder:
  use `keepPreviousInPlan` from `apps/web/src/api/placeholder.ts`, never `keepPreviousData`."

## Downstream effects

- Specs that open the category popover by clicking the name (`e2e/categories.spec.ts`,
  `e2e/categories-hidden.spec.ts`) switch to a right-click on the row or the inspector's pencil.
  `e2e/plan-grid.spec.ts` asserts the new default width (33% of `.plan-body`) and that the panel is no longer
  empty.
- `Category` and the category change_log rows gain `note`, and every `CategoryRow` literal gets `note: null`. The
  e2e fixture `e2e/plan-grid.fixtures.ts` and `packages/schema/test/assigned-edit.test.ts` add `note: null`
  to their `MonthCategoryDetail` literals.
- Checkboxes become controlled; checked boxes use `--buttonPrimaryBackground` (#545BFE, as in the source).
- New custom properties (in `plan/plan-panel.css`, `:root`, until a later Build moves them into
  `tokens.css`): `--rowSelected: #1b1d48`, `--panelTooltipLabel: #ededf5`,
  `--panelTooltipShadow: 0 2px 5px rgba(0,0,0,.15)`, `--panelTooltipDelay: 1.9s`. New icons in
  `plan/icons.tsx`: `PencilIcon` (16 px) and `SubtractIcon` (the dash of a mixed checkbox).

## Out of scope

"Cost to Be Me" (EXF-525); the Auto-Assign cards (EXF-519); "Assigned in Future Months" (EXF-527); "For You";
the Target card (EXF-508, EXF-514), with no gap drawn for any of them; grid filters (EXF-500); the shortcut
registry (EXF-473); credit spending (EXF-532); opening the Assigned editor on a name click or ↓.

## Acceptance

Each case uses a fresh plan (`ZZ-TEST …`, default categories, 500.00 inflow via an API account) at 1280×720 in
the current month, unless stated. A **compare** case names the source state to reproduce live: the test plan's
Plan page (`source.url`), dark theme, window as it is, allowed controls only.

1. **(EXF-498) Name click.** Click Rent/Mortgage's name: its checkbox is checked, the row is #1B1D48, and no
   popover opens. Click Utilities's name: only Utilities is checked. *Compare*: source, a name click.
2. **(EXF-498) Checkboxes.** With Rent/Mortgage selected, real-mouse click Phone & Internet's checkbox. The panel
   reads "2 Categories Selected" over "🏠 Rent/Mortgage, 📱 Phone & Internet" (grid order). Click it again: the
   Rent/Mortgage inspector shows. *Compare*: source, the same clicks.
3. **(EXF-498) Group checkbox.** Click the Needs checkbox. Its 4 categories and the group box are checked, the
   header box is `aria-checked="mixed"`, and the panel reads "4 Categories Selected". Uncheck one category: the
   group box is mixed. *Compare*: source, the Needs checkbox.
4. **(EXF-498) Header checkbox.** With a partial selection, a click clears it (month summary). A second click
   checks every visible category: "N Categories Selected", label "Uncheck all". *Compare*: source, twice.
5. **(EXF-498) Keyboard.** Focus on the page (click empty grid space). ↓ selects the first category, and ↓ again
   the second; from the last Bills category, ↓ lands on the first Needs one. Shift+↓ twice selects 3 and
   Shift+↑ leaves 2. Ctrl+A selects all and Escape clears. In the note textarea or an Assigned input, these
   keys leave the selection alone. *Compare*: source, keys with focus on the page.
6. **(EXF-498) Right-click.** On a category row, "Edit Category" opens with its name; on a group row, "Edit
   Category Group".
7. **(EXF-498) Lifetime.** Select two, then next month: both are still selected under the next month's title.
   Reload: none.
8. **(EXF-523) Month summary.** With nothing selected: "{Month}'s Summary" and four rows. Hovering each row shows
   the exact EXF-523 tooltip (Left Over names the previous month). *Compare*: source, hover each row.
9. **(EXF-523) Totals.** Via the API, assign 100.00 to Groceries and 50.00 to Rent/Mortgage, and add a −30.00
   Groceries transaction. The summary shows Left Over $0.00, Assigned $150.00, Activity −$30.00, Available
   $120.00. Hide a category with money: the totals drop by its figures.
10. **(EXF-523, EXF-521) Collapse.** Clicking the summary header sets `aria-expanded="false"` and hides the rows;
    a second click shows them. The same holds for Available Balance.
11. **(EXF-523) Selection totals.** Checkbox Groceries and Rent/Mortgage: "2 Categories Selected", Assigned
    $150.00, Available $120.00. Two categories with nothing assigned show $0.00 everywhere.
12. **(EXF-523) Follows edits.** Enter 25 in an Assigned cell: the summary's Assigned rises by 25.00 with no
    reload. Move 10.00 from a pill: the month totals are unchanged and a selection of the two categories shows
    the move.
13. **(EXF-523) REST = MCP = panel.** `…/summary` with and without `category_ids` equals `get_month_summary` and
    the panel. An unknown id returns 404; an empty `category_ids` returns 422.
14. **(EXF-521) Inspector.** Groceries (assigned 100, spent 30): the h1 is the name, the pencil is "Edit
    category: {name}", the rows are $0.00, +$100.00, −$30.00, $0.00, and the pill is $70.00 (positive colour).
    Next month: Left Over $70.00, and after assigning 30 the pill is $100.00. *Compare*: source, one category
    (layout and texts).
15. **(EXF-521) Pencil.** The pencil opens the edit popover; OK with "ZZ Renamed" renames the h1 and the grid row.
16. **(EXF-521) Notes.** Click "Enter a note...", type "line one", Enter, "line two", then click elsewhere. Poll the
    API until it is stored with the newline. After a reload, the selected category shows two lines, the grid
    name's `title` is "{name}\nline one\nline two", and another month shows the note too. Clearing the note
    brings back the placeholder and the bare-name title.
17. **(EXF-521) Note API.** PATCH `{note}` and `set_category_note` store the same value, each with one change_log
    row and its actor. 5001 characters return 422. `get_month_category` equals the REST read and the panel.
18. **(EXF-586) Plan switch.** Plan X: Checking 250, 40 assigned to its first category, month note "Note X".
    Plan Y: empty. Open Y, then X, and select X's first category. Switch to Y with the real mouse (plan button →
    Open Plan → Y), with Y's month request delayed 2 s. During the delay: no `.category-row`, no "$40.00" or
    "Note X" anywhere, an empty panel, and no Assigned control. Afterwards Y shows $0.00 and no note. In Y, delay
    the next month by 1 s and click the next-month arrow: the current rows stay on screen during the delay.
19. **(EXF-523) Width.** At 1280×720 the panel is 33% of `.plan-body` (±2 px). A 100 px real-mouse drag to the
    left widens it by 100 px, and the width survives a reload. At 1024×700 the Assigned header ends left of the
    panel, and the checkboxes and chevrons pass the topmost-element check. *Compare*: source, hover the handle.
20. **(all) Look.** Colours and sizes match the notes. *Compare*: source, the three panel states.

## Manifest

touches: [apps/worker/migrations/20261116100400_category_note.sql, apps/worker/src/db/schema/categories.ts, packages/schema/src/months.ts, packages/schema/src/month-categories.ts, packages/schema/src/categories.ts, packages/schema/src/month-totals.ts, packages/schema/test/assigned-edit.test.ts, packages/schema/test/month-totals.test.ts, apps/worker/src/services/months.ts, apps/worker/src/services/month-categories.ts, apps/worker/src/services/categories.ts, apps/worker/src/services/default-categories.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/routes/months.ts, apps/worker/src/routes/month-categories.ts, apps/worker/src/routes/categories.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/mcp/tools/categories.ts, apps/worker/test/mcp-coverage/months.ts, apps/worker/test/mcp-coverage/categories.ts, apps/worker/test/month-summary.test.ts, apps/worker/test/category-note.test.ts, apps/web/src/pages/plan.tsx, apps/web/src/plan/**, apps/web/src/api/months.ts, apps/web/src/api/categories.ts, apps/web/src/api/bank-connections.ts, apps/web/src/api/placeholder.ts, e2e/plan-selection.spec.ts, e2e/plan-panel.spec.ts, e2e/plan-switch.spec.ts, e2e/categories.spec.ts, e2e/categories-hidden.spec.ts, e2e/plan-grid.spec.ts, e2e/plan-grid.fixtures.ts, docs/conventions.md, docs/plan-panel-design.md, docs/plan-panel-spec.md, docs/README.md]
shared: []
migrations: 1
