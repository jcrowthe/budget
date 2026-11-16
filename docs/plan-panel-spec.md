# Plan selection and right panel: implementation spec (EXF-498, EXF-523, EXF-521, EXF-586)

Design: [plan-panel-design.md](plan-panel-design.md). Source notes: `/workspace/scratch/source/plan-inspector/notes.md`.
Follow `docs/conventions.md`. Money is milliunits; a month is `YYYY-MM-01`. Out of bounds: see the Lead's note 8.
Do not touch any file in `paths.always_overlap`. No new dependency.

## Worker and schema

### T1. Migration and table
- `apps/worker/migrations/20261116100400_category_note.sql`: `ALTER TABLE categories ADD COLUMN note TEXT;`
- `apps/worker/src/db/schema/categories.ts`: `note: text("note")` (nullable). Delete `.e2e-state` afterwards.
- Verify: `test/schema-drift.test.ts` passes.

### T2. Schemas (in `packages/schema/src/`)
- `categories.ts`:
  - `CATEGORY_NOTE_MAX = 5000`;
  - `Category` gains `note: z.string().nullable()`;
  - `CategoryUpdate` gains `note: z.string().max(CATEGORY_NOTE_MAX).nullable().optional()` (null counts for
    the existing refine).
- `months.ts`:
  - `MonthCategoryDetail` gains `note: z.string().nullable()`;
  - add `MonthTotals` (`leftover`, `assigned`, `activity`, `available`, all `Milliunits`) and
    `MonthTotalsResponse = dataEnvelope(MonthTotals)`, both with `.openapi` names.
- `month-categories.ts`: add `CategoryMonth` (`leftover`, `assigned`, `cash_activity`, `credit_activity`,
  `available`, all `Milliunits`; `note: z.string().nullable()`), `CategoryMonthResponse`, and the types.
- New `month-totals.ts` (pure functions):
  - `monthTotals(d: MonthDetail, ids?: readonly string[]): MonthTotals`. Without ids it sums every
    `!hidden` category in a `!hidden` group; with ids, exactly those found, hidden or not. leftover is Σ
    `carried`; the other fields are sums of the same field.
  - `categoryMonth(d, id): CategoryMonth | null` returns `{ leftover: carried, assigned,
    cash_activity: activity, credit_activity: 0, available, note }`.
- Add `note: null` to the `MonthCategoryDetail` literals in `packages/schema/test/assigned-edit.test.ts` and
  `e2e/plan-grid.fixtures.ts`. The web parses the month strictly.
- New `packages/schema/test/month-totals.test.ts`:
  - hidden categories and groups are left out without ids, and counted when listed;
  - available = leftover + assigned + activity;
  - an unknown id gives null.

### T3. Category note: repository and service
- `repositories/categories.ts`:
  - `categoryJson()` and `categoryJsonHidden()` add `'note', note`;
  - `updateIfStmt` can set `note`.
- `services/categories.ts`:
  - `categoryToApi` adds `note: row.note ?? null`.
  - `updateCategory` parses `note` and sets
    `after.note = patch.note === undefined ? before.note : (patch.note?.trim() || null)`. "Changed" and
    "logged" include the note, and the row update sets it. Keep the guarded single batch (log row first, then
    the row) and the retry loop.
- Every `CategoryRow` literal (`createCategory`, `addCategory`, `services/default-categories.ts`) gets
  `note: null`.

### T4. Month read and summary service (`services/months.ts`)
- Shape check: compare the core shape with the schema shape minus `note`:
  `type EngineShape = Omit<MonthDetail,"groups"> & { groups: (Omit<MonthGroupDetail,"categories"> & { categories: Omit<MonthCategoryDetail,"note">[] })[] }`
  and `Same<CoreMonthDetail, EngineShape>`.
- `loadInput` also returns the category rows, or a `Map<id, note>`, without changing `EngineInput`.
  `getPlanMonth` maps every group's categories to `{ ...c, note: notes.get(c.id) ?? null }`. `listPlanMonths`
  is unchanged.
- New `getMonthSummary(env, budgetId, month, categoryIds?: string[]): Promise<MonthTotals>`:
  - `getPlanMonth`, then 404 `NotFound("Category")` when any id is not in the read;
  - otherwise `monthTotals(detail, ids)`.
- `services/month-categories.ts`: new `getMonthCategory(env, budgetId, month, categoryId): Promise<CategoryMonth>`.
  A non-uuid budget id gives 404 Plan and a non-uuid category id 404 Category, as `setAssignedAndRead` does.
  Then `categoryMonth(await getPlanMonth(...), id)`, with 404 Category when null.

### T5. Routes
- `routes/months.ts`: `GET /budgets/{budget_id}/months/{month}/summary`.
  - Params: `budget_id` as the GET month route, `month: InputMonth`. Query: `category_ids: z.string().optional()`.
  - Handler: when `category_ids` is present, split on ",", trim and dedupe. An empty part or an empty list
    returns 422 `"category_ids must list category ids separated by commas"`; more than 500 returns 422.
  - Responses: 200 `MonthTotalsResponse` ("Totals of the month over the categories") plus `errors`.
  - The path does not clash with `/months/{month}`.
- `routes/month-categories.ts`: chain `GET /budgets/{budget_id}/months/{month}/categories/{category_id}` →
  200 `CategoryMonthResponse` (`budget_id`/`category_id` `z.string().min(1)`, `month: AssignedMonth`).
- `routes/categories.ts`: no change beyond what the schema gives (`CategoryUpdate` now carries `note`). Check
  that `categoryError` maps a 422 from the schema.
- Verify: `apiPaths()` contains `/budgets/{budget_id}/months/{month}/summary`, and the openapi document has
  `get` on `/budgets/{budget_id}/months/{month}/categories/{category_id}`.

### T6. MCP tools and coverage
- `mcp/tools/months.ts`:
  - Add `get_month_summary`: `{ budget_id: Id, month: InputMonth, category_ids: z.array(Id).min(1).max(500).optional() }`
    → `getMonthSummary`.
    Description: "Totals of one month of a plan: with category_ids, exactly those categories (hidden ones
    included); without, every category that is not hidden and not in a hidden group. ${MONTH} ${MONEY} Returns
    { leftover, assigned, activity, available }: leftover is the positive Available carried from the previous
    month; available = leftover + assigned + activity. An unknown category id is an error."
  - Update `get_plan_month`'s description: categories also carry `carried`, `target` and `note`.
- `mcp/tools/month-categories.ts`: add `get_month_category`: `{ budget_id: Id, month: AssignedMonth, category_id: Id }`
  → `getMonthCategory`.
  Description: "One category's figures for one month of a plan. ${MONTH} ${MONEY} Returns { leftover, assigned,
  cash_activity, credit_activity, available, note }: leftover is carried from the previous month;
  credit_activity is 0 until credit card spending exists, so all activity is cash_activity; available =
  leftover + assigned + cash_activity + credit_activity; note is the category's note (the same in every month)
  or null."
- `mcp/tools/categories.ts`: add `set_category_note`: `{ budget_id: Id, category_id: Id, note: z.string().max(5000).nullable() }`
  → `{ category: await updateCategory(env, actor, input) }`.
  Description: "Set or clear a category's note: plain text, the same in every month, at most 5000 characters.
  Line breaks inside are kept and the ends are trimmed; an empty or whitespace-only note, or null, clears it.
  Returns {category} with id, group_id, name, sort, hidden and note." Add "and note" to the Returns of the
  other category tools that return `{category}`.
- `apps/worker/test/mcp-coverage/months.ts` adds:
  ```
  "GET /budgets/{budget_id}/months/{month}/summary": { tool: "get_month_summary" },
  "GET /budgets/{budget_id}/months/{month}/categories/{category_id}": { tool: "get_month_category" },
  ```
- `apps/worker/test/mcp-coverage/categories.ts`: the PATCH line becomes
  `{ tool: ["rename_category", "set_category_hidden", "set_category_note"], note: "the rename, hide and note tools split the one PATCH; none changes anything else" }`.
- Verify: `mcp-coverage.test.ts` and `mcp-descriptions.test.ts` pass, unedited.

### T7. Worker tests (new files only)
- `apps/worker/test/month-summary.test.ts`:
  - Seed an inflow, Assigned in month M for two categories, a transaction in M, and a hidden category with
    money.
  - REST without ids gives the visible sums, with available = leftover + assigned + activity; with
    `category_ids`, just those. `get_month_summary` matches both.
  - Errors: an unknown id returns 404, `category_ids=` returns 422, and an unknown plan returns 404.
  - Category month, the EXF-521 examples: in M, assigned 100 and spent −30 give available 70; in M+1, leftover
    70, plus 30 assigned gives 100. `get_month_category` equals REST, and `credit_activity` is 0.
  - `apiPaths()` and `listedToolNames()` contain the new paths and tools.
- `apps/worker/test/category-note.test.ts`:
  - PATCH `{note:"a\nb"}` stores it, and the month read carries it in any month.
  - `"  "` and `null` clear it; 5001 characters return 422. `set_category_note` gives the same result.
  - Each change writes one change_log row with its `user:` or `mcp:` actor and before/after note.
  - Atomicity: a failing log statement writes nothing (follow `category-delete.test.ts`).
  - Rename and hide keep the note.
  - `listedToolNames()` contains `set_category_note`.

## Web

### T8. Placeholder helper (EXF-586)
- New `apps/web/src/api/placeholder.ts`:
  ```ts
  /** placeholderData that keeps the previous data only within one plan (EXF-586). */
  export function keepPreviousInPlan<T>(budgetId: string): (prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }) => T | undefined
  ```
  Return `prev` only when `prevQuery?.queryKey.includes(budgetId)`.
- `api/months.ts` `useMonth`: `placeholderData: keepPreviousInPlan(budgetId)`.
- `api/bank-connections.ts` `useInstitutionSearch`: the same.
- Verify: `grep -rn keepPreviousData apps/web/src` returns nothing.
- `docs/conventions.md` already has the Placeholders rule (added with this plan); `placeholder.ts` makes it true.

### T9. Note write (`api/categories.ts`)
- Add `setCategoryNote(budgetId, categoryId, note)` → PATCH `{ note }` with an idempotency key, parsed with
  `CategoryResponse`.
- Add `useSetCategoryNote(budgetId)` with
  `mutationFn({ categoryId, before, note })`:
  - `onMutate`: `await beginWrite(qc, budgetId)`; the normalized value is `note.trim() || null`;
    `qc.setQueriesData<MonthDetail>({ queryKey: ["month", budgetId] }, d => d && withCategoryNote(d, id, value))`.
  - `onError`: put `before` back only in caches that still hold `value`.
  - `onSettled`: `endWrite(qc, budgetId)`.
  - `withCategoryNote` is a small pure helper in the same file.
- Variables carry the category id, so a selection change during the save does not retarget it.

### T10. Selection and shortcuts
- New `plan/selection.ts`:
  ```ts
  export type Selection = { ids: readonly string[]; anchor: string | null; cursor: string | null };
  export const EMPTY: Selection;
  selectOnly(id): Selection                       // ids [id], anchor = cursor = id
  toggle(s, id): Selection                        // add/remove; anchor = cursor = id only if anchor was null
  toggleMany(s, ids): Selection                   // all in s → remove them, else add the missing ones
  headerClick(s, all): Selection                  // any of all selected → EMPTY, else selectAll(all)
  selectAll(all): Selection                       // anchor/cursor kept if still in all, else null
  step(s, order, dir: 1 | -1): Selection          // from cursor ?? last selected in order; none → order[0] (↓) / last (↑); clamps at ends; selectOnly
  extend(s, order, dir): Selection                // no anchor → as step; else cursor moves by dir (clamped), ids = order slice anchor..cursor
  visibleSelection(s, all): string[]              // s.ids ∩ all, in `all` order
  checkState(ids, selected: Set<string>): boolean | "mixed"
  export function useSelection(): [Selection, (f: (s: Selection) => Selection) => void]
  ```
  - `all` is every non-hidden category in a non-hidden group, in grid order, collapsed groups included.
  - `order` is the grid's existing `order` (visible rows, collapsed skipped).
- New `plan/shortcuts.ts`:
  ```ts
  export function usePlanShortcuts(h: { onStep(dir): void; onExtend(dir): void; onSelectAll(): void; onClear(): void; onCollapseAll(collapsed: boolean): void }): void
  ```
  - Binds `keydown` on `window`, with the handlers kept in a ref.
  - Ignored when `e.defaultPrevented`, with Alt held, or when the target is in `input, textarea, select,
    [contenteditable], [role=dialog], [role=menu]`.
  - ↓/↑ step; Shift+↓/↑ extend; Ctrl or ⌘ + A selects all; Ctrl or ⌘ + ↑/↓ collapse (moved from `PlanGrid`);
    Escape clears. A handled key calls `preventDefault()`.
  - Header comment: "EXF-473 moves these bindings into the shortcut registry."

### T11. Grid (`plan/rows.tsx`, `plan/PlanGrid.tsx`)
- `Checkbox({ label, checked: boolean | "mixed", onChange })`:
  - `aria-checked` gets `true`, `false` or `"mixed"`;
  - shows `CheckIcon` when true and the new `SubtractIcon` when mixed;
  - checked and mixed boxes: background and border `var(--buttonPrimaryBackground)`.
- `CategoryRow` gains `selected: boolean`, `onSelect(how: "only" | "toggle")`, `note` (via `c.note`):
  - the row gets `aria-selected={selected}` and class `is-selected` (background `var(--rowSelected)`);
  - a name click calls `onSelect("only")`; delete the EXF-498 comment and the `onEditName` call there;
  - the checkbox calls `onSelect("toggle")`;
  - the name `title` is `c.note ? `${c.name}\n${c.note}` : c.name`;
  - right-click on the row (move `onContextMenu` from `.cell-name` to the row div) opens the edit popover
    anchored at the name.
- `GroupRow` gains `checked`, `onCheck`, and a row `onContextMenu` that opens the group popover at the
  group-name button. The group-name click is unchanged.
- `PlanGrid` props gain `selection`, `onSelection(f)` and
  `editRequest: { id; anchor: HTMLElement; at: number } | null`.
  - The header checkbox shows `checkState(all)` and calls `headerClick`. Its label is "Uncheck all" when all
    (non-empty) are selected, else "Check all".
  - A group checkbox shows `checkState` of the group's visible ids and calls `toggleMany`.
  - An Assigned click (`onOpen`) also does `selectOnly`; `closeCell` "next" and "prev" select the new row.
  - An effect on `editRequest?.at` opens `edit-category`.
  - `usePlanShortcuts` is wired from `order` and `all`; the old Ctrl+↑/↓ effect goes.
  - While `!data`, no rows render and `aria-busy` stays.

### T12. Page (`pages/plan.tsx`)
- `PlanPage` keeps its URL logic and renders `<PlanContent key={budgetId} budgetId month />`.
- `PlanContent`:
  - holds `useSelection()` and the `editRequest` state;
  - renders `PlanHeader`, then `.plan-body` (with a ref) containing `PlanGrid` and
    `<PlanPanel budgetId month selected={visibleSelection(...)} onEditCategory={(id, anchor) => setEditRequest({ id, anchor, at: Date.now() })} bodyRef />`;
  - computes `all` from the cached month (`useMonth`), with the same rule as T10.

### T13. Panel (new files under `apps/web/src/plan/panel/`, CSS in `panel/plan-panel.css`)
Sizes and colours come from the design's Source section and the notes. Use variables only.
- `PlanPanel.tsx`: `aside.plan-inspector` (keeps `aria-label="Inspector"`), `style={{ "--panel-width": px or "33%" }}`.
  - Without month data: only the handle, with `aria-busy="true"`.
  - Otherwise the handle plus `.panel-content` (padding 16/16/48/12, scrolls), in one of three modes:
    - 0 selected: `SummaryCard` with `monthTotals(d)`;
    - 1 selected: `CategoryInspector`;
    - 2 or more: `div.panel-multi` (an h2 "{n} Categories Selected" and a p with the names joined by ", "),
      then `SummaryCard` with `monthTotals(d, ids)`.
  - Collapse state lives here: `useState({ summary: false, balance: false })`.
- `PanelCard.tsx` `{ id, title, collapsed?, onToggle?, right?, children }`.
  - With `onToggle`: `section.panel-card`, then `button.card-roll-up[aria-expanded][aria-controls]` holding the
    h2, a chevron (down when open, right when collapsed) and `right` (pushed to the right), then the body
    `div#id`, hidden when collapsed.
  - Without `onToggle`: a static header (Notes).
- `SummaryCard.tsx`: title `${longMonth(month)}'s Summary`.
  - Rows `.panel-row` (label left, `money()` value right): "Left Over from Last Month", `Assigned in ${M}`,
    "Activity", "Available" (`.is-total`).
  - Each row has `tabIndex={0}` and is wrapped in `PanelTooltip` with the exact EXF-523 texts. `M` is
    `longMonth(month)`, and `P` (in the Left Over text) is `longMonth(addMonths(month, -1))`.
- `PanelTooltip.tsx`: the pattern of `account/Tooltip.tsx`, copied, not imported.
  - Hover or focus opens it; Escape hides it; `role="tooltip"` with `aria-describedby`.
  - Look: 12 px `--panelTooltipLabel` on `--inputBackground`, padding 8, radius 6, max 288, below the row and
    left-aligned, `transition: opacity .1s var(--panelTooltipDelay)`.
- `CategoryInspector.tsx`: `h1.panel-title` (ellipsis) and a pencil button.
  - The pencil has `aria-label` `Edit category: ${name}`, title "Edit Category", `PencilIcon`, and calls
    `onEdit(e.currentTarget)`.
  - Then the "Available Balance" `PanelCard` with `right={<AvailablePill amount={available} display />}`.
    Rows:
    - Cash Left Over From Last Month = `money(carried)`;
    - Assigned This Month = `signed(assigned)`;
    - Cash Spending = `signed(activity)`;
    - Credit Spending = `signed(0)`.
  - Then `NotesCard`.
- `NotesCard.tsx`:
  - At rest: `button.note-display` (min-height 64, `pre-wrap`) showing the note or "Enter a note...".
  - A click switches to a `textarea` (aria-label "Note", maxLength 5000, autoFocus, caret at the end).
  - Blur: if `value.trim() || null` differs from the stored note, call
    `useSetCategoryNote.mutate({ categoryId, before, note: value })`; then switch back.
  - Escape: `stopPropagation`, revert, switch back.
  - On failure: `role="alert"` "Couldn't save the note."
- `ResizeHandle.tsx` and `panelWidth.ts`:
  - `usePanelWidth()` returns `[px | null, set]`, kept in `sessionStorage["budget.planPanelWidth"]`.
  - The handle is `div.panel-resizer`: `role="separator"`, `aria-orientation="vertical"`,
    `aria-label="Resize panel"`, `tabIndex={0}`, `aria-valuenow`. It is 3 px wide at the left edge, full
    height, `cursor: ew-resize`.
  - Its `.panel-resizer-indicator` is 8×40 `--actionPrimary`, radius 100, margin-left −12 px, centred,
    `pointer-events: none`. Its opacity goes from 0 to 1 on `:hover`, `:focus-visible` and `.is-dragging`.
  - Dragging uses pointer capture: width = `body.right − clientX`, clamped to [280, 0.6 × body], stored on
    pointerup.
  - ←/→ change the width by ±16 px.
- CSS:
  - `.plan-inspector` replaces its fixed 442 px in `plan-grid.css` with `position: relative; display: flex;
    flex: none; width: min(max(var(--panel-width), 280px), 60%, calc(100% - 562px))`.
  - Cards, rows, the multi block and headings follow the notes.
  - `:root` custom properties: `--rowSelected: #1b1d48`, `--panelTooltipLabel: #ededf5`,
    `--panelTooltipShadow: 0 2px 5px rgba(0, 0, 0, 0.15)`, `--panelTooltipDelay: 1.9s`.
- `plan/format.ts`:
  - `signed(m)` is "+" + `money(m)` when m > 0, else `money(m)`;
  - `longMonth(m)` moves here from `RtaBreakdown.tsx`, which then imports it.
- `plan/icons.tsx`: `PencilIcon` (16 px) and `SubtractIcon` (the dash). Draw your own paths.
- `AvailablePill`: a `display` prop renders a non-focusable `span` with the same classes and the same
  `pillTitle`.

## E2E (new specs make their own plan; `{ exact: true }` names; `expect.poll` before reading the server)

### T14. New and updated specs
- Real mouse (`realClick` from `support/real-click.ts`, or `mouseClick` from `support/menu.ts`): checkboxes,
  chevrons, pencil, note field, the handle (`page.mouse` down/move/up) and right-clicks
  (`page.mouse.click(x, y, { button: "right" })`), each after the topmost-element check. Seed with
  `support/plan-seed.ts` or direct API calls.
- `e2e/plan-selection.spec.ts`: Acceptance 1–7, plus a 1024×700 test. There, the checkboxes and the summary
  chevron pass the topmost check, and the Assigned header ends left of the panel.
- `e2e/plan-panel.spec.ts`: Acceptance 8–17 and 19.
  - Tooltips: hover, then wait for `getByRole("tooltip")` with the exact text.
  - Notes: blur, then `expect.poll` on `GET …/months/{m}` until the note is `"line one\nline two"`.
- `e2e/plan-switch.spec.ts` (Acceptance 18):
  - Create X and Y through the API. Go to Y, wait for its grid, then go to X, so Y comes first under "Recent
    Plans".
  - Route `**/api/v1/budgets/${Y}/months/*` with a 2 s delay before `continue()`.
  - Open the plan menu as `e2e/plan-menu.spec.ts` lines 60–92 do (plan button → hover "Open Plan" → into
    "Plans" → Y's row, all with `mouseClick`). Do not import from or edit that spec.
  - Check right after the click and again about 1 s later:
    - `.category-row` count 0;
    - no "$40.00" and no "Note X" on the page;
    - the Inspector aside empty of "$40.00";
    - no `.cell-assigned` button or input.
  - Then $0.00 rows appear.
  - Next, a 1 s delay on Y's next month and a click on the next-month arrow: `.category-row` stays > 0
    throughout.
- `e2e/categories.spec.ts` (lines 108, 146, 176) and `e2e/categories-hidden.spec.ts` (line 35): open the
  popover with a right-click on the row. Add one test: a name click sets `aria-selected="true"` and opens no
  popover; the pencil opens "Edit Category".
- `e2e/plan-grid.spec.ts` lines 91–95: the panel is 33% of `.plan-body` ±2 px, the grid is > 562, and the panel
  contains "'s Summary".

## Docs
- `docs/README.md`: the index line is already in (Architect).
- `docs/conventions.md`: the Placeholders bullet is already in (Architect).

## Done when
- `pnpm check` passes.
- `pnpm e2e e2e/plan-selection.spec.ts e2e/plan-panel.spec.ts e2e/plan-switch.spec.ts e2e/categories.spec.ts e2e/categories-hidden.spec.ts e2e/plan-grid.spec.ts e2e/assigned.spec.ts e2e/moves.spec.ts e2e/rta.spec.ts e2e/month-nav.spec.ts --repeat-each=2`
  passes.
- `git diff --name-only origin/main` lists only files in the design's Manifest.
