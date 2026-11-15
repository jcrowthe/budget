# Plan grid: implementation spec (EXF-487)

Design: [plan-grid-design.md](plan-grid-design.md). Its Source section gives every measurement and colour, and
its Acceptance section lists the cases the tests below codify.

**Do not edit:**
- `apps/web/src/shell/**`, `router.tsx`, `api/client.ts`
- `packages/**`
- `apps/worker/src/services/months.ts` and `routes/**`, `mcp/**`, the repositories
- `openapi.test.ts`, `mcp.test.ts`, `e2e/mcp.spec.ts`
- every `paths.always_overlap` file

No migration. No new dependency.

## T1. Default categories (Worker)

**New `apps/worker/src/services/default-categories.ts`:**

```ts
export const DEFAULT_CATEGORIES: readonly { group: string; categories: readonly string[] }[];
export function defaultCategoryStmts(db: Db, budgetId: string, actor: string, now: string): BatchItem[];
```

- `DEFAULT_CATEGORIES` lists exactly the design's names and code points, in order: Bills (3), Needs (4),
  Wants (4). Write the emoji with `\u{…}` escapes or paste them, but make sure that `⚡️`, `🍽️`, `🏝️` and
  `❗️` keep U+FE0F.
- Group rows: `CategoryGroupRow` with `id` = `crypto.randomUUID()`, `budgetId`, `name`, `sortOrder` = the index
  (0, 1, 2), `hidden: false`, `collapsed: false`, `createdAt` and `updatedAt` = `now`, `deletedAt: null`.
- Category rows: `CategoryRow` with `groupId`, `sortOrder` = the index within its group, `hidden: false`, and
  the same timestamps.
- Statement order: for each group, `groupsRepo.insertIfSortStmt(db, g)`, then
  `changeLogInsert(db, { budgetId, actor, action: "create", entityType: "category_group", entityId: g.id, before: null, after: groupToApi(g) })`.
  Then, for each of its categories, `categoriesRepo.insertIfSortStmt(db, c)`, then
  `changeLogInsert(db, { …, entityType: "category", entityId: c.id, after: categoryToApi(c) })`.
- `groupToApi` and `categoryToApi` come from `./categories`. Type the return value the way
  `buildCreateBatch`'s items are typed (Drizzle batch items, `BatchItem<"sqlite">`) so it spreads into
  `db.batch`.

**`services/budgets.ts`, `createBudget`:**
`await db.batch([...buildCreateBatch(db, row, log), ...defaultCategoryStmts(db, row.id, actor, now)])`.
- `buildCreateBatch` keeps its signature, so the atomicity test still compiles.
- Nothing else changes: the response is still the `Budget`, and the route and MCP tool are untouched.

**Verify** in `apps/worker/test/budgets.test.ts`:
- The existing log queries add `AND entity_type = 'budget'`: in "creates, lists, patches…" and in
  `logActions`.
- New `describe("default categories (EXF-487)")`:
  1. POST a plan, then GET `/api/v1/budgets/{id}/months/<current UTC month>`. `groups.map(name)` equals
     `["Bills","Needs","Wants"]`, and the category names per group equal `DEFAULT_CATEGORIES` (import it).
     Every amount is 0, `sort` runs 0…n, and `hidden` and `collapsed` are false.
  2. change_log for the plan, `ORDER BY rowid`: 15 rows, all `create`, actor `user:tester@localhost`. The
     first row is the budget, then 3 `category_group` and 11 `category` rows. Each category's
     `after_json.group_id` is a group id from the same plan.
  3. MCP `create_budget` (reuse the rpc helper pattern from `months.test.ts`, or call `createBudget(env, "mcp:x", …)`):
     15 rows with actor `mcp:x`.
  4. Atomicity: build `[...buildCreateBatch(db, row, validLog), ...defaultCategoryStmts(db, id, "t", now), changeLogInsert(db, {…, action: "bogus" as "create"})]`.
     The batch rejects, and the plan has no `budgets`, `category_groups` or `categories` rows.

## T2. Existing tests that assumed an empty new plan

- `apps/worker/test/months.test.ts`:
  - Add `const grp = (d: Detail, id: string) => d.groups.find((g) => g.id === id)`.
  - Replace each `X.groups[0]` with `grp(X, s.group.id)` (lines ~100, 113, 129).
  - In "writes one history row per change", the base becomes `20`, and the comment becomes "budget + 14
    defaults + account + group + 3 categories".
  - Leave everything else as it is. The `row()` helper finds "Groceries", which does not clash with
    "🛒 Groceries".
- `e2e/months.spec.ts`: rename the test to "month read model: new plan over REST and MCP, bad month is 422".
  Replace `groups: []` with `ready_to_assign: 0, uncategorized: null` in `toMatchObject`, and add
  `expect(data.groups.map((g) => g.name)).toEqual(["Bills", "Needs", "Wants"])` and
  `expect(data.groups.flatMap((g) => g.categories)).toHaveLength(11)`.
- **Verify:** `pnpm check` passes.

## T3. Month API module (web)

**New `apps/web/src/api/months.ts`:**

```ts
export const getMonth = async (budgetId: string, month: Month): Promise<MonthDetail> // apiFetch(`/api/v1/budgets/${budgetId}/months/${month}`, { schema: MonthDetailResponse }).data
export const useMonth = (budgetId: string, month: Month) => useQuery({ queryKey: ["month", budgetId, month], queryFn: …, placeholderData: keepPreviousData })
```

`Month` comes from `@budget/core/month`, and the schema from `@budget/schema/months`. Do not use `.strict()`:
unknown keys must be stripped.

## T4. Local-state helpers

**`apps/web/src/plan/collapse.ts`:**

```ts
const key = (budgetId: string) => `budget.planGrid.collapsed.${budgetId}`;
export function loadCollapsed(budgetId: string, groups: { id: string; collapsed: boolean }[]): Record<string, boolean>; // saved value ?? group.collapsed
export function saveCollapsed(budgetId: string, changes: Record<string, boolean>): void;            // merge into the stored JSON; EXF-494 swaps this for the PATCH
export function useCollapsedGroups(budgetId: string, groups: MonthGroupDetail[] | undefined): {
  isCollapsed(id: string): boolean;
  setCollapsed(ids: string[], collapsed: boolean): void; // updates React state, then calls saveCollapsed once
};
```

- Bad or missing JSON counts as `{}`. Wrap localStorage access in try/catch: storage can throw.
- The state is keyed by group id, so a month change keeps the collapses.
- Put a top-of-file comment naming `saveCollapsed` as the EXF-494 swap point.

**`apps/web/src/plan/progressBars.ts`:**

```ts
export function loadProgressBars(): boolean;          // localStorage "budget.progressBars" !== "off" (default On)
export function saveProgressBars(on: boolean): void;  // "on" | "off"; EXF-472 replaces both
export function useProgressBars(): [boolean, (on: boolean) => void];
```

## T5. Formatting and rules (`apps/web/src/plan/format.ts`)

```ts
export const money: (m: Milliunits) => string;  // formatMoney(m).replace("-", "−")
export function spentFunded(c: { activity: number; assigned: number; carried: number }): { spent: number; funded: number };
// spent = activity < 0 ? -activity : 0; funded = assigned + carried
export function statusLabel(c: MonthCategoryDetail): string | null;
// available<0 && spent>0 -> `Overspent. ${money(spent)} of ${money(funded)}`
// spent>0 && available===0 -> "Fully Spent"; spent>0 && available>0 -> `Spent ${money(spent)} of ${money(funded)}`; else null
export type Segment = { kind: "spent" | "funded" | "overspent"; pct: number };
export function barSegments(c: MonthCategoryDetail): Segment[];
// spent>funded: [{spent, funded/spent*100}, {overspent, rest}]; spent>0: [{spent, spent/funded*100}, {funded, rest}]
// funded>0: [{funded,100}]; else []. Drop segments with pct 0; clamp each pct to 0..100.
export const pillTitle: (available: number) => string;
// >0: `${money(a)} Available to plan your spending—or click to move it to another category!` (U+2014)
// <0: `${money(a)} A green category is a happy category. Make this category happy by adding funds from surplus categories.`
// 0: ""
```

## T6. Components (`apps/web/src/plan/`)

Use the class names below. The tests select by role and label first, and by these classes only for geometry.

- **`icons.tsx`**: our own 24-unit `fill="currentColor"` glyphs. Do **not** use the paths in the scratch file
  `icons-symbols.svg.txt`.
  - Exports: `ChevronDownIcon`, `ChevronRightSmallIcon` (or reuse `ChevronRightIcon` from `shell/icons`, import
    only), `UndoIcon`, `RedoIcon`, `ClockBackIcon`, `BarsOnIcon` (two stacked rounded bars), `BarsOffIcon`
    (three lines), `CheckIcon`.
  - The ⊕ reuses `PlusCircleIcon` from `shell/icons` (import only).
- **`AvailablePill.tsx`**: `<AvailablePill amount interactive?>` renders `button.available-pill.<zero|positive|negative>`.
  - `disabled` when `amount === 0 || interactive === false`; `title={pillTitle(amount)}` when interactive.
  - The text is `money(amount)`.
  - No onClick: the move and cover popovers come later.
- **`ProgressBar.tsx`**: `<ProgressBar segments>` renders `figure.progress-bar[role=group]` > `div.progress-track` >
  one `div.progress-segment[data-kind]` per segment with `style={{ width: pct + "%" }}`.
- **`rows.tsx`**:
  - **`Checkbox({label})`**: `button[role=checkbox][aria-checked][aria-label]`, with local state only.
  - **`GroupRow`**: `div.grid-row.group-row[role=row][aria-level=1][aria-expanded]`. It contains:
    - the chevron `button.collapse-button[aria-label="Collapse|Expand <name> categories"]`;
    - a Checkbox;
    - the name `span.group-name[title]`;
    - `button.add-category[aria-label="Add Category"]` (opacity 0, and 1 on `.group-row:hover` or
      `:focus-visible`);
    - three `div.num` cells with `money()` text.
  - **`CategoryRow({c, bars})`**: `div.grid-row.category-row[role=row][aria-level=2]`. Its cells are
    `.cell-margin`, `.cell-collapse` (empty), `.cell-checkbox`, `.cell-name[role=rowheader]`, `.cell-assigned`,
    `.cell-activity`, `.cell-available`, `.cell-margin`.
    - The name cell holds `div.name-line` > `span.category-name[title]` + `span.status-label`, with a
      `<ProgressBar>` under it. With `bars` false, the label and the bar are not rendered.
    - Assigned is `div.assigned-box` > `span.amount` (EXF-489 replaces it).
    - Zero amounts get class `zero`, which dims them.
  - **`UncategorizedRow({u})`**: the same structure as a category row, with class `uncategorized-row`. Its name
    is "Uncategorized Transactions" (`--labelWarning`), Assigned is "-", Activity is `money(u.activity)`, and it
    uses `<AvailablePill amount={u.available} interactive={false}>`. It has no bar and no label.
- **`Toolbar.tsx`**: `div.grid-toolbar[role=row]` with these buttons:
  - `button.toolbar-button` "Category Group" (`title="Add Category Group"`);
  - "Undo" `disabled`;
  - "Redo" `disabled`;
  - "Recent Moves" (`title="Previous 34 days of assigning and moving money"`);
  - right-aligned `div.segmented[role=tablist]` with two `button[role=tab][aria-selected][aria-label][title]`
    ("Progress Bars On", "Progress Bars Off") that call `setBars`.
- **`PlanGrid.tsx`**: `({ budgetId, month })`.
  - It calls `useMonth`, `useCollapsedGroups` and `useProgressBars`, and renders
    `section.plan-grid` (with class `bars-on` when bars are on) > `div[role=treegrid][aria-label="Plan"][aria-busy]`.
  - The header is `div.grid-head[role=rowgroup]` (sticky) with the Toolbar and the labels row
    `div.grid-row.header-row[role=row]`:
    - the header chevron `button.collapse-button` with `aria-label` and `title` "Collapse all" or
      "Expand all";
    - a Checkbox "Check all";
    - `[role=columnheader]` cells CATEGORY, ASSIGNED, ACTIVITY and AVAILABLE (`<strong>`), with the design's
      titles.
  - The body is `div.grid-body[role=rowgroup]`. When `uncategorized` is set, the `UncategorizedRow` comes first.
    Then each non-hidden group gets a `GroupRow`, and unless it is collapsed, its non-hidden categories get
    `CategoryRow`s.
  - "All collapsed" means every rendered group is collapsed. The header chevron calls
    `setCollapsed(allIds, !allCollapsed)`.
  - A `useEffect` adds a `keydown` listener on `window`:
    - `(e.ctrlKey || e.metaKey) && e.key === "ArrowUp"` → collapse all; `ArrowDown` → expand all;
      `preventDefault()`;
    - skip when the target is an `input`, a `textarea` or `[contenteditable]`;
    - remove the listener on cleanup.
  - States:
    - loading with no data: the head only, `aria-busy="true"`;
    - error: `div.grid-error[role=alert]` with "Couldn't load this month." and `button` "Try again" →
      `refetch()`;
    - `groups: []`: the head only.
- **`plan-grid.css`** (imported by `PlanGrid.tsx`):
  - Start with the design's `:root` property table. No raw colour inside any other rule.
  - Measurements come from the design's Source section:
    - rows: toolbar 48, header 40, group 40, category 44 (`.bars-on`) and 36;
    - columns: margins 14 and 16, chevron 16, checkbox 27, `.num`, `.cell-assigned`, `.cell-activity` and
      `.cell-available` at 15% (`.bars-on`) and 18%;
    - category name 16px with bars on and 14px with bars off;
    - pill: padding 2px 7px, radius 1000px, 14px/500, `font-variant-numeric: tabular-nums`;
    - bar: 4px high, margin 4px, radius 16px, track `--inputBackground`; stripe gradients as in the design;
      `transition: width .3s ease-out`.
  - Category rows get `border-top: 1px solid var(--separatorStandard)`. Group rows have no border.
- **`pages/plan.tsx`** returns `<div className="plan-page">` with `PageHeader` and
  `<div className="plan-body"><PlanGrid budgetId={budgetId} month={month}/><aside className="plan-inspector" aria-label="Inspector"/></div>`.
  - Styles go in `plan-grid.css`:
    - `.plan-page` is a column with `height: 100%`;
    - `.plan-body` is `flex: 1; min-height: 0; display: flex`;
    - `.plan-grid` is `flex: 1; min-width: 562px; overflow-y: auto`;
    - `.plan-inspector` is `flex: none; width: 442px; border-left: 1px solid var(--separatorStandard)`.
  - Keep the existing month and redirect logic unchanged. The old `<div className="page-body" />` goes.

**Verify:** `pnpm check` passes, and `pnpm dev` shows the grid on a new plan.

## T7. E2E (`e2e/plan-grid.spec.ts` + `e2e/plan-grid.fixtures.ts`)

- **Fixtures.**
  - `plan-grid.fixtures.ts` exports `fixtureF(month)` and `fixtureF0(month)`, both returning `{ data: MonthDetail }`
    with the amounts in the design's Acceptance section (milliunits; made-up ids are fine).
  - Validate both at import with `MonthDetailResponse.parse` imported by relative path
    (`../packages/schema/src/months`).
  - Keep the extra `target: null` key in the raw JSON that gets sent: `parse` strips it, so send the raw object.
  - `stub(page, body, status = 200, delayMs = 0)` wraps `page.route("**/api/v1/budgets/*/months/*", …)`.
- **Setup.** Each test creates its own plan with `POST /api/v1/budgets` (`testName("grid")`, `authHeaders()`)
  and deletes it at the end. A fresh `localStorage` comes from the default context.
- **Tests,** one per design case: 2, 3 (geometry assertions with tolerances of ±1px), 4, 5, 6, 7, 8, 9 and 10.
  Case 1 lives in the Worker tests; for case 11, assert
  `expect(page.locator(".plan-grid")).not.toContainText(/ynab/i)`.
  - Case 4 asserts the pills' computed `background-color` and `color`, and that the Phone pill's text starts
    with `−`.
  - Case 8 asserts the bounding-box heights 44 and 36, `toHaveCount(0)` for `.progress-bar` and `.status-label`,
    and the reload.
  - Case 10 waits for the request with `page.waitForRequest(/\/months\/\d{4}-\d{2}-01$/)` and checks its URL.
- **Verify:** `pnpm e2e e2e/plan-grid.spec.ts e2e/months.spec.ts --repeat-each=3` passes. Do not run the full
  suite: final_gate runs it.

## T8. Docs

`docs/README.md` already has the line for this design (added by the Architect). Add nothing else there.

## Report back

- What is inert (design, Approach 6).
- The two swap functions (`saveCollapsed`, `saveProgressBars`).
- The `:root` properties in `plan-grid.css`.
- The default-category history rows (15 per new plan).
- Any visible difference from the source you could not close. One expected difference: the source widens the
  table by ~15px when its scrollbar disappears, and ours behaves however the browser behaves.
- `git diff --stat origin/main`, to confirm that no excluded file changed.
