# Plan views, snooze and Auto-Assign spec (EXF-500, EXF-516, EXF-519)

Design: [plan-views-autoassign-design.md](plan-views-autoassign-design.md). Follow `docs/conventions.md`; run
`pnpm check` after each task. Never edit `openapi.test.ts`,
`mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`, `mcp-descriptions.test.ts`, `e2e/mcp.spec.ts`
or any file in the Lead's note 10 (import from `mcp/tool-text.ts`, `shell/planPaths.ts`,
`e2e/support/register-seed.ts`; do not edit them).

## 1. Core snooze (`packages/core/src/targets.ts`, `packages/core/test/targets.test.ts`)

```ts
export interface TargetDefinition { /* unchanged fields */ snoozed_months?: readonly Month[] }
export function computeTargetMonth(def, ctx): TargetMonth | null
// figures exactly as now; status = "snoozed" when def.snoozed_months?.includes(ctx.month) (any other status
// replaced); returned `definition` is def without `snoozed_months` (omit the key, do not set undefined).
```
Tests (new `describe("snooze")`, existing tests untouched): example 1 Nov A 40000 snoozed in Nov → status
`snoozed`, `to_go_this_month` 60000, needed 100000, `definition` has no `snoozed_months` key; same def in Dec →
`underfunded`; a funded target snoozed → `snoozed`; `computeMonth` with an `EngineTarget` carrying
`snoozed_months` yields `snoozed` (proves `budget-engine.ts` needs no change). Verify: `git diff --stat
packages/core` shows only these two files; every pre-existing test passes unchanged.

## 2. Schema modules (`packages/schema/src/`)

**`months.ts`**: `MonthCategoryDetail` gains `target_snoozed: z.boolean()`.

**`plan-views.ts`** (new):
```ts
export const PLAN_VIEWS = ["all","overspent","underfunded","overfunded","money_available","snoozed"] as const;
export const PlanView = z.enum(PLAN_VIEWS).openapi("PlanView"); export type PlanView
export function inView(c: MonthCategoryDetail, view: PlanView): boolean          // the design's table
export function viewCategories(d: MonthDetail, view: PlanView): MonthCategoryDetail[] // visible only, grid order
export function viewDetail(d: MonthDetail, view: PlanView): MonthDetail // "all" → d itself (same reference)
export function overspentCount(d: MonthDetail): number                  // viewCategories(d,"overspent").length
export const VIEW_CHIP_LABEL: Record<Exclude<PlanView,"overspent">, string> // "All","Underfunded",…
export const overspentLabel = (n: number) => `${n} Overspent`;
export const VIEW_EMPTY_TEXT: Record<Exclude<PlanView,"all">, string>
// overspent (not observed): "You don't currently have any overspent categories."; the four others per design
export const VIEW_HIDDEN_FOOTER = "Some categories are hidden by your current view.";
export const VIEW_NO_CATEGORIES = "This view has no categories.";
```
Tests `test/plan-views.test.ts`: each view over a fixture with hidden group and category, overspent, (snoozed)
underfunded, (snoozed) overfunded, positive and zero rows; `viewDetail` drops empty groups and re-sums subtotals
(EXF-500: 655/−110/870 in All → 0/−50/−50 in Overspent); `all` returns the same object.

**`month-totals.ts`**: add `viewTotals(d, view) = monthTotals(d, viewCategories(d, view).map(c => c.id))`;
test it in `month-totals.test.ts`.

**`targets.ts`**:
```ts
export const TargetSnoozeBody = z.object({ snoozed: z.boolean() }).openapi("TargetSnoozeBody");
export const TargetSnooze = z.object({ month: Month, category_id: z.uuid(), snoozed: z.boolean() }).openapi("TargetSnooze");
export const TargetSnoozeResponse = dataEnvelope(TargetSnooze).openapi("TargetSnoozeResponse");
```

**`target-wording.ts`**: `targetPill` icon union gains `"snooze"`; for `status === "snoozed"` return
`{ tone: available > 0 ? "positive" : available === 0 ? "zero" : "negative", icon: available < 0 ? null :
"snooze", title: pillTitle(available) }`. Add:
```ts
export const SNOOZE_LABEL = "Snooze target for this month";
export const SNOOZE_TIP_TITLE = "Snooze Target";
export const SNOOZE_TIP_BODY = "When you snooze a Target, Budget will treat the category as if it didn't have a Target (which means the category won't show as underfunded). At the start of next month, your Target will reactivate, well-rested and in a very good mood!";
export const SNOOZE_ONLY_CURRENT = "You can only snooze targets in the current month.";
export const SNOOZE_KEYBOARD_TIP = "Keyboard Tip: Press shift Z to snooze a category's target";
```
Add rows to the table test (`target-wording.test.ts`) for the snoozed pill (40000 → positive/snooze/"$40.00
Available to plan your spending—or click to move it to another category!") and that `targetStatusText`,
`targetDonut`, `targetMessage` are null for snoozed while `targetBreakdown` is unchanged.

**`ui-state.ts`**: `UI_STATE_FIELDS.snooze_tip_seen: z.boolean()`.

**`auto-assign.ts`** (new):
```ts
export const AUTO_ASSIGN_STRATEGIES = ["underfunded","assigned_last_month","spent_last_month","average_assigned",
  "average_spent","reduce_overfunding","reset_available","reset_assigned"] as const;
export const AutoAssignStrategy = z.enum(AUTO_ASSIGN_STRATEGIES).openapi("AutoAssignStrategy");
export const AutoAssignPreview = z.object({ category_count: z.number().int(), underfunded: Milliunits,
  assigned_last_month: Milliunits, spent_last_month: Milliunits, average_assigned: Milliunits,
  average_spent: Milliunits, reduce_overfunding: Milliunits, reset_available: Milliunits,
  reset_assigned: Milliunits }).openapi("AutoAssignPreview");
export const AutoAssignPreviewResponse = dataEnvelope(AutoAssignPreview)
export const AutoAssignBody = z.object({ strategy: AutoAssignStrategy, category_ids: z.array(z.uuid()).min(1).max(500).optional(),
  view: PlanView.optional() }).refine(not both, "Give category_ids or view, not both").openapi("AutoAssignBody");
export const AutoAssignResult = z.object({ month: Month, strategy: AutoAssignStrategy, changed: z.array(MonthCategory) })
export const AutoAssignResultResponse = dataEnvelope(AutoAssignResult)

export interface MonthFigures { month: string; assigned: number; activity: number }
export interface AutoAssignInput { id: string; assigned: number; carried: number; activity: number;
  target: CategoryTargetMonth | null; last_assigned: number; last_spent: number;
  average_assigned: number; average_spent: number }
/** previous: the months before M in order (at most 12 used), firstMonth: the category's first month. */
export function historyFigures(month: string, previous: MonthFigures[], firstMonth: string):
  Pick<AutoAssignInput, "last_assigned"|"last_spent"|"average_assigned"|"average_spent">
export function autoAssignResult(c: AutoAssignInput, s: AutoAssignStrategy): number   // new Assigned
export function autoAssignPreview(cs: AutoAssignInput[]): AutoAssignPreview
export interface AutoAssignOption { strategy; group: 1|2|3; label: string; amount: number; title: string | null }
export function autoAssignOptions(p: AutoAssignPreview, scope: "one" | "many"): AutoAssignOption[] // visible only
```
Rules are the design's table. `historyFigures`: last = the entry for M−1 (0 when absent); window = months
`max(firstMonth, M−12) … M−1` (absent months 0); mean rounded to the cent, halves away from zero
(`Math.sign(x) * Math.round(Math.abs(x) / n / 10) * 10`); spending = `max(0, −activity)`. Labels: "Underfunded",
"Assigned Last Month", "Spent Last Month", "Average Assigned", "Average Spent", "Reduce Overfunding", "Reset
Available Amount"/"Amounts", "Reset Assigned Amount"/"Amounts". Titles (null for the first three): EXF-519's
texts exactly ("…all of your categories to $0.00, making…"). Hide Underfunded when `scope==="one" && amount===0`,
Reduce Overfunding when `amount===0`.

Tests `test/auto-assign.test.ts`, one `it` per worked example of EXF-519, with `CategoryTargetMonth` literals
whose `to_go_this_month`/`overfunded` are the engine's (targets-engine-design examples 1 and 6):
- Dec previews (L 70000, A 0, to_go 100000; Nov A 100000 X −30000): 100000/100000/30000/100000/30000, reset 0/0;
- the click chain: spent→30000 (avail 100000); assigned_last→100000 (170000); average_spent→30000;
  average_assigned→100000; reset_available→−70000 (avail 0); reset_assigned→0; underfunded from 0 (to_go
  100000)→100000; from 30000 (to_go 70000) preview 70000 → 100000;
- reduce: A 150000 overfunded 50000 → preview 50000, result 100000; A 250000 overfunded 150000 → 150000;
  balance A 150000 overfunded 46660 → 46660; refill with L 150000 A 0 overfunded 50000 → r 0;
- averages: Jan (Nov 100000/Dec 30000, first Nov) → 65000, spent 30000/0 → 15000; weekly 50000/0 → 25000,
  10000/0 → 5000; first month 14 months back → only the last 12 averaged; first = M → 0;
- multi: two with to_go 100000 → 200000; snoozed target → underfunded 0 and reduce 0;
- `autoAssignOptions`: order and groups; singular/plural; Underfunded hidden for one at 0, shown for many at 0;
  Reduce hidden at 0; titles.

## 3. Migration and table

`apps/worker/migrations/20261116100700_target_snoozes.sql`:
```sql
CREATE TABLE target_snoozes (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (category_id, month)
);
CREATE INDEX target_snoozes_budget ON target_snoozes(budget_id);
```
`apps/worker/src/db/schema/target-snoozes.ts` (Drizzle, matching; `schema-drift.test.ts` checks). Delete
`.e2e-state` locally after adding it.

## 4. Repository `apps/worker/src/repositories/target-snoozes.ts`

```ts
listForBudget(db, budgetId): Promise<{ categoryId: string; month: string }[]>
find(db, budgetId, categoryId, month): Promise<boolean>
insertStmt(db, row)            // INSERT … ON CONFLICT DO NOTHING
deleteStmt(db, budgetId, categoryId, month)
deleteForCategoryStmt(db, budgetId, categoryId, guard?: SQL)  // used by deleteTarget, guard `changes() > 0`
```

## 5. Month read with snooze and view (`services/months.ts`, `routes/months.ts`, `mcp/tools/months.ts`)

- `loadInput(..., withTargets)` also loads `snoozesRepo.listForBudget` when `withTargets` and sets each target's
  `snoozed_months`. `EngineShape` omits `"note" | "target_snoozed"`.
- `getPlanMonth(env, budgetId, month, today = todayUtc(), view: PlanView = "all")`: adds `target_snoozed:
  c.target?.status === "snoozed"` beside `note`, then returns `viewDetail(result, view)`.
- New `getPlanMonths(env, budgetId, months: Month[], today): Promise<MonthDetail[]>`: one `loadInput` (activity up
  to the latest month + 1), `computeMonth` per month, same mapping (no view).
- `getMonthSummary(env, budgetId, month, categoryIds?, today, view?)`: with `view`, `viewTotals`.
- Route `GET /budgets/{budget_id}/months/{month}` and `/summary`: query `view: PlanView.optional()` with a
  description; summary with both `category_ids` and `view` → 422 "Give category_ids or view, not both".
- Tools `get_plan_month`, `get_month_summary`: `view: PlanView.optional()`; description adds "view (all,
  overspent, underfunded, overfunded, money_available, snoozed) narrows to the categories the Plan page's view
  shows; default all." and mentions `target_snoozed`.

Tests `apps/worker/test/plan-views.test.ts`: `?view=` per view on seeded data (REST and the tool give the same),
subtotals re-summed, hidden excluded, summary with view equals the sum of the listed categories, both → 422,
`target_snoozed` false without a row. Assert the new query params appear in `apiDocument()`.

## 6. Snooze write (`services/targets.ts`, `routes/targets.ts`, `mcp/tools/targets.ts`)

```ts
export class SnoozeRefused extends Error {}
export async function setTargetSnooze(env, actor, input: { budget_id; month; category_id; snoozed: boolean },
  opts: { today?: string } = {}): Promise<TargetSnooze>
```
Order: requirePlan (404), category active (404), target exists (else `SnoozeRefused("This category has no target
to snooze.")`), `month === toMonth(today ?? todayUtc())` (else `SnoozeRefused("You can only snooze targets in the
current month.")`). Current state from `find`; equal → return. Else `db.batch([changeLogInsert(...), insertStmt |
deleteStmt])` with `entityType: "target_snooze"`, `entityId: \`${category_id}:${month}\``, `action: "update"`.
`deleteTarget`: append `snoozesRepo.deleteForCategoryStmt(db, …, sql\`changes() > 0\`)` after the target delete.
Route `PUT /budgets/{budget_id}/months/{month}/categories/{category_id}/target-snooze` (`InputMonth`, query
`today: Today.optional()`, body `TargetSnoozeBody`, 200 `TargetSnoozeResponse`, `SnoozeRefused` → 422
`snooze_refused`). Tool `snooze_target` `{ budget_id, month, category_id, snoozed, today? }`; its description says
a snoozed category counts as having no target (not underfunded, left out of Auto-Assign Underfunded and Reduce
Overfunding) until next month, only the current month (from `today`) and only with a target, `${MONTH} ${DATE}`,
and "Returns { month, category_id, snoozed }". Coverage line in `mcp-coverage/targets.ts`.

Tests `apps/worker/test/target-snooze.test.ts`: round trip (REST + tool), `change_log` row with actor, same
state writes nothing, 422 for another month (`today` on a month's last and next first day) and for no target,
next month unaffected, delete target removes snoozes, surface (`apiPaths()`, `listedToolNames()`).

## 7. Auto-Assign service, route, tool

`apps/worker/src/services/auto-assign.ts`:
```ts
export async function previewAutoAssign(env, budgetId, month, scope: { category_ids?: string[]; view?: PlanView }, today?): Promise<AutoAssignPreview>
export async function autoAssign(env, actor, input: { budget_id; month; strategy; category_ids?; view? }, today?): Promise<AutoAssignResult>
export function buildAutoAssignBatch(db, actor, v, runId, cells: { id; before: number | undefined; after: number }[], now) // test seam
```
Both: uuid checks (404), `getPlanMonths(env, id, [M−12 … M], today)`, scope ids (unknown → `NotFound("Category")`),
categories rows (`categoriesRepo.listActive`) for `created_at`, `historyFigures` per category, `AutoAssignInput[]`.
Apply: for up to 5 attempts read each cell's `before` (`monthCatRepo.find`), compute `after` with
`autoAssignResult`, drop unchanged, none left → `{ changed: [] }`; else batch: logs first (`changeLogInsertIf`, the
first guarded by all cells holding — reuse `buildMoveBatch`'s `allHold` shape — the rest by `changes() > 0`), then
writes (`monthCatRepo.setIfHoldsStmt(..., guard sql\`changes() > 0\`)`); success when the last write changed a row;
else recompute (re-read months too); then `Conflict("Assigned amounts")`. Log entry: `entityType
"month_category"`, `entityId "{cat}:{month}"`, before `{month, category_id, assigned: before ?? 0}`, after
`{month, category_id, assigned: after, auto_assign: { id: runId, strategy }}`.

`apps/worker/src/routes/auto-assign.ts`: `GET` (query `category_ids` comma list as in `/summary`, `view`, `today`)
and `POST` (body `AutoAssignBody`, query `today`) on `/budgets/{budget_id}/months/{month}/auto-assign`, tags
`["Months"]`, 422 defaultHook as in `routes/months.ts`. `apps/worker/src/mcp/tools/auto-assign.ts`:
`preview_auto_assign { budget_id, month, category_ids?, view?, today? }` and `auto_assign { budget_id, month,
strategy, category_ids?, view?, today? }`. Both descriptions carry one sentence per strategy from
the design's table ("underfunded **adds** each category's target to-go…", "assigned_last_month **sets** Assigned to
last month's Assigned", …, averages "over the months since the category's first month, at most the last 12"),
the scope rule ("category_ids or view, not both; default all visible categories; hidden ones never touched"),
`MONEY`, `MONTH`, `DATE`. Preview returns `{ category_count, underfunded, …, reset_assigned }` (underfunded and
reduce_overfunding are amounts added or removed, the rest resulting totals). `auto_assign` says it "changes
Assigned at once, with no confirmation" and returns `{ month, strategy, changed }`. Coverage lines in
`mcp-coverage/months.ts`.

Tests `apps/worker/test/auto-assign.test.ts`: the first worked example end to end over REST and MCP (design case
19), each click of the chain, multi-select, view-scoped with snoozed and hidden (case 16), history rows (case 18),
atomicity via `buildAutoAssignBatch` with a failing log entry (nothing written), a concurrent second run adds 0,
422 for both scopes and a bad strategy, 404 unknown id, surface.

## 8. Web API (`apps/web/src/api/`)

- `monthCache.ts` `endWrite`: also `invalidateQueries({ queryKey: ["auto-assign", budgetId] })`.
- `targets.ts`: `putTargetSnooze(budgetId, month, categoryId, snoozed)` (sends `?today=${localToday()}`,
  idempotency key) and `useSnoozeTarget(budgetId)` (`beginWrite`/`endWrite`, no optimistic write).
- `autoAssign.ts` (new):
```ts
export type AutoAssignScope = { categoryIds: string[] } | { view: PlanView };
export function useAutoAssignPreview(budgetId, month, scope, enabled = true) // key ["auto-assign", budgetId, month, scopeKey], keepPreviousInPlan
export function useAutoAssign(budgetId, month): { apply(strategy, scope): void; busy: boolean; failed: boolean }
```
  `busy` lives in a module store (`useSyncExternalStore`) keyed `${budgetId}:${month}`: set at the click, cleared
  when `qc.getQueryState(["month", budgetId, month]).dataUpdateCount` exceeds the value recorded when the POST
  resolved, or on failure. `apply` ignores calls while busy. POST via `inOrder`, `beginWrite` before, `endWrite` in
  `finally`.
- `months.ts`: nothing beyond the schema change (the web filters with `viewDetail` locally).

## 9. Plan page (`apps/web/src/pages/plan.tsx`, `apps/web/src/plan/**`)

- `pages/plan.tsx`: `const [view, setView] = useState<PlanView>("all")`; render `<ViewChips>` at the EXF-500
  comment; `all` (selectable ids) = `viewCategories(detail, view)` ids; pass `view`/`setView` to `PlanHeader`,
  `PlanGrid`, `PlanPanel`. Effect: `view === "overspent" && overspentCount(detail) === 0` → `setView("all")`.
- `plan/ViewChips.tsx` + `plan/plan-views.css` (custom properties on `.plan-page`; measurements in the design).
  Chip: `<button aria-pressed title={label}>`; Overspent: `WarningTriangleIcon` 12 + label, class `is-overspent`.
- `PlanGrid.tsx`: prop `view`, `onViewAll`; `const shown = viewDetail(data, view)`; render `shown.groups`; when
  `view !== "all"`: no `UncategorizedRow`, no `HiddenCategoriesRow`; rows → `<div class="view-footer">` text +
  `<button class="view-all">View All</button>`; no rows → `<div class="view-empty">` message + View All, and the
  header row is not rendered. `Toolbar` prop `addGroupDisabled`. Shortcuts: `onSnooze` (task 10).
- `panel/PlanPanel.tsx`: prop `view`, `onViewAll`; summary `monthTotals(detail, selected.length ? selected :
  viewCategories(detail, view).map(c => c.id))`; `AutoAssignCard` after the summary (none or ≥2 selected) and
  passed into `CategoryInspector` to render after `TargetCard` (one). Collapse key `autoAssign`.
- `panel/AutoAssignCard.tsx`: `PanelCard id="panel-auto-assign" title="Auto-Assign" icon={<LightningIcon/>}`;
  body `<AutoAssignOptions scope=… />`.
- `plan/AutoAssignOptions.tsx`: props `budgetId, month, scope: AutoAssignScope, onViewAll, onApplied?`; reads the
  preview; `category_count === 0` → "This view has no categories." + ghost "View All Categories"; else
  `autoAssignOptions(preview, ids.length === 1 ? "one" : "many")` grouped (`.auto-assign-group`, 16 px apart),
  each `<button class="auto-assign-option" title={title ?? undefined} disabled={busy}>` label + `<strong
  title={money(amount)}>{money(amount)}</strong>`; click → `apply`, then `onApplied?.()`. Error line
  "Couldn't auto-assign." (`role="alert"`).
- `AssignPopover.tsx`: Auto tab enabled (`role="tab"`, `aria-selected`), local tab state default "manual"; the
  Auto panel is `<AutoAssignOptions scope={{ view }} onApplied={onClose} />`. `ReadyToAssign`/`PlanHeader` pass
  `view` through.
- `panel/TargetCard.tsx`: below Edit Target, `<div class="target-snooze">` with `Switch label={SNOOZE_LABEL}
  checked={c.target_snoozed} disabled={month !== localCurrentMonth() || snoozing}` and a `PanelTooltip` on a
  `QuestionCircleIcon` button (aria-label "About snoozing"): bold `SNOOZE_TIP_TITLE`, `SNOOZE_TIP_BODY`, and
  `SNOOZE_ONLY_CURRENT` when not current. `snoozing` follows the `waitingFor`/`dataUpdateCount` pattern of the
  card. Toggling calls a shared `useToggleSnooze(budgetId, month)` (in `plan/snooze.ts`) that also triggers the tip.
- `plan/snooze.ts` + `plan/KeyboardTip.tsx`: `useToggleSnooze` mutates; if `useUiState(budgetId).data
  ?.snooze_tip_seen !== true` it shows the tip (state in `PlanContent`) and saves `{ snooze_tip_seen: true }`.
  Toast: fixed bottom centre, `role="status"`, `SNOOZE_KEYBOARD_TIP`, × with aria-label "Close".
- `AvailablePill.tsx`: `PillIcon` gains `"snooze"` → `SnoozeIcon`. `icons.tsx`: `LightningIcon`,
  `WarningTriangleIcon`, `SnoozeIcon` ("zᶻ": a large and a small Z), `QuestionCircleIcon`, all our own paths.

## 10. Shift+Z (`plan/shortcuts.ts`, `PlanGrid.tsx`)

`Handlers.onSnooze()`; bound on `e.shiftKey && !mod && e.key.toLowerCase() === "z"` (same IGNORED rule).
`PlanGrid` handler: exactly one selected, its category has a target, `month === localCurrentMonth()` → toggle via
`useToggleSnooze` with `!c.target_snoozed`; else nothing.

## 11. e2e (new specs; `realClick` from `e2e/support/register-seed.ts`, topmost check, `{ exact: true }`)

Each spec makes its own plan (`Plan` from `support/plan-seed.ts` or `plan-panel.fixtures.ts`), removes it, fixes
`page.clock.setFixedTime` at 12:00Z on the 15th of the current UTC month and sends that date as `today` in REST
seeds; runs at 1440×900 and 1024×700. After a click that sends a request, `expect.poll` the server (or hold the
request as `plan-switch.spec.ts` does). Shared helpers in `e2e/auto-assign.fixtures.ts`.
- `e2e/plan-views.spec.ts`: design cases 1–6.
- `e2e/target-snooze.spec.ts`: cases 7–10 (10 over REST and MCP).
- `e2e/auto-assign.spec.ts`: cases 11–17 and 19.
- `e2e/rta.spec.ts`: the Auto tab is enabled and "Manually" still `aria-selected="true"` (only that assertion
  changes).
