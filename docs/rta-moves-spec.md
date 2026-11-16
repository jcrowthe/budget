# Ready to Assign pill and moving money: spec (EXF-491, EXF-492)

Design: [rta-moves-design.md](rta-moves-design.md). Follow `docs/conventions.md`. No migration. Do not touch the
out-of-bounds files (Lead's note 8): `apps/web/src/shell/**`, `apps/web/src/register/**`, `apps/web/src/account/**`,
`apps/web/src/pages/**`, the other MCP tool files, `apps/worker/test/{openapi,mcp,existing-surface}.test.ts`,
`e2e/mcp.spec.ts`, and every `paths.always_overlap` file. Verify each task with `pnpm check`; the e2e tasks
with `pnpm e2e e2e/rta.spec.ts e2e/moves.spec.ts`, plus `e2e/categories.spec.ts e2e/assigned.spec.ts
e2e/plan-grid.spec.ts` after tasks 6 to 10.

## 1. Schemas

**`packages/schema/src/months.ts`**: `MoneyMove` gains `kind: z.enum(["move", "cover"]).optional()` (read as
`v.kind ?? "move"`; optional, not `.default`, so existing callers of the inferred type still compile). Its
refinements stay.

**New `packages/schema/src/moves.ts`**:

```ts
export const READY_TO_ASSIGN = "ready_to_assign" as const;
export const MoveSide = z.string().min(1).openapi({ description: 'A category id, or "ready_to_assign"' });
export const MoveCreate = z.object({ from: MoveSide, to: MoveSide, amount: Milliunits.positive() })
  .refine(v => v.from !== v.to, { message: "from and to must differ" })
  .openapi("MoveCreate");            // both "ready_to_assign" is caught by from !== to
export const CoverCreate = z.object({ from: MoveSide }).openapi("CoverCreate");
export const MoveResult = z.object({
  move_id: z.uuid(), month: Month, amount: Milliunits,
  from: MonthCategoryAmounts.nullable(), to: MonthCategoryAmounts.nullable(),   // null = Ready to Assign
  ready_to_assign: Milliunits,
}).openapi("MoveResult");
export const MoveResultResponse = dataEnvelope(MoveResult).openapi("MoveResultResponse");
export type MoveCreate, CoverCreate, MoveResult = z.infer<…>;
```

`MonthCategoryAmounts` is imported from `./month-categories`.

**`packages/schema/src/assigned-edit.ts`**: add

```ts
/** A move of `amount` in `moveMonth` (null side = Ready to Assign) applied to one cached month. */
export function applyMove(detail: MonthDetail, moveMonth: string, from: string | null, to: string | null,
  amount: number): MonthDetail
```

- When `detail.month === moveMonth`: `applyAssigned(d, from, old − amount)`, then
  `applyAssigned(d, to, old + amount)`, for the non-null sides, reading `old` from the current detail. The net
  effect on RTA is 0 for a category-to-category move and ±amount otherwise.
- When `detail.month < moveMonth` and exactly one side is null: `ready_to_assign += s·amount` and
  `rta_breakdown.assigned_in_future += s·amount`, where s = +1 if `to` is null and −1 if `from` is null.
- Otherwise the detail is returned unchanged.
- A side id missing from the detail is a no-op for that side (`applyAssigned` already does this).

Tests go in `packages/schema/test/assigned-edit.test.ts`: the same month, a cat↔cat move, a cat→RTA move, an
earlier month, a later month (unchanged), and a hidden category, whose Available changes but whose group
subtotal does not (follow `applyAssigned`).

## 2. Service: `moveMoney` and history (`apps/worker/src/services/months.ts`)

- Signature: `moveMoney(env, actor, input: MoneyMove): Promise<{ move_id: string; cells: MonthCategory[] }>`.
- `const moveId = crypto.randomUUID()` is made once, before the retry loop.
- Each log row's `after.move` becomes `{ id: moveId, month: v.month, from_category_id, to_category_id, amount,
  kind: v.kind }`.
- Extract the statement building into an exported test seam:

  ```ts
  export function buildMoveBatch(db: Db, v: MoneyMove, moveId: string,
    reads: { id: string; delta: number; before: number | undefined }[], now: string)
    : { stmts: [...]; logCount: number; out: MonthCategory[] }
  ```

  It holds the same `allHold` guard, the logs first, then the writes, with the second write guarded on
  `changes() > 0`. `moveMoney` calls it, and success stays "the first write changed a row".
- `months.test.ts` keeps passing unchanged; it ignores the return value. Do not edit `docs/budget-engine-design.md`.

## 3. Service wrappers (new `apps/worker/src/services/moves.ts`)

```ts
export async function moveAndRead(env, actor, input: { budget_id; month; from; to; amount }): Promise<MoveResult>
export async function coverAndRead(env, actor, input: { budget_id; month; category_id; from }): Promise<MoveResult>
```

`moveAndRead`:

1. If `budget_id` is not a UUID, throw `NotFound("Plan")`.
2. Map each side: `"ready_to_assign"` becomes null; a non-UUID becomes `NotFound("Category")`.
3. If both sides are null or the same, throw `HTTPException(422, { message })`. The route has normally caught
   this already; MCP has not.
4. `const { move_id } = await moveMoney(env, actor, { budget_id, month, from_category_id, to_category_id,
   amount, kind })`.
5. Read `getPlanMonth(env, budget_id, month)` and map each non-null side to `{ id, month, assigned, activity,
   available }`.
6. Return `{ move_id, month, amount, from, to, ready_to_assign }`.

`coverAndRead`:

1. Check the UUIDs as above.
2. Read `getPlanMonth`. If the category is missing, throw `NotFound("Category")`.
3. If `available >= 0`, throw 422 "Category is not overspent".
4. If `from === category_id`, throw 422 "Cannot cover a category from itself".
5. Call `moveAndRead` with `{ from, to: category_id, amount: −available, kind: "cover" }`, threading `kind`
   through an internal parameter.

The moved amount comes from that read. A concurrent write between the read and the move only changes how much
is covered; the batch itself is still guarded.

Validation that `MoneyMove.parse` would reject (a bad month for MCP) surfaces as ZodError, which the server
turns into 400 or a tool error. Give the MCP tools their own `inputSchema` (`InputMonth`, `Milliunits.positive()`)
so that it is rejected before the service runs.

## 4. Route (new `apps/worker/src/routes/moves.ts`)

Copy the structure of `routes/month-categories.ts`, including the `defaultHook` that maps to 422.

| method, path | params | body | 200 | errors |
|---|---|---|---|---|
| POST `/budgets/{budget_id}/months/{month}/moves` | `budget_id` (string min 1), `month` (`InputMonth`) | `MoveCreate` | `MoveResultResponse` "The moved amounts and Ready to Assign" | 403, 404, 409, 422 |
| POST `/budgets/{budget_id}/months/{month}/categories/{category_id}/cover` | + `category_id` | `CoverCreate` | `MoveResultResponse` | 403, 404, 409, 422 |

- Both use `tags: ["Months"]`.
- Handlers pass `c.get("identity").actor` to `moveAndRead` or `coverAndRead`.
- `Idempotency-Key` needs nothing: the middleware handles every write.

## 5. MCP tools (new `apps/worker/src/mcp/tools/moves.ts`)

```ts
export const tools: McpToolDef[] = [
  { name: "move_money", inputSchema: z.object({ budget_id: z.string().min(1), month: InputMonth,
      from: z.string().min(1), to: z.string().min(1), amount: Milliunits.positive() }),
    run: (i, { env, actor }) => moveAndRead(env, actor, i) },
  { name: "cover_overspending", inputSchema: z.object({ budget_id, month: InputMonth,
      category_id: z.string().min(1), from: z.string().min(1) }),
    run: (i, { env, actor }) => coverAndRead(env, actor, i) },
];
```

Descriptions (exact wording is free; the content is not):

- **move_money**: "Move money in one plan month from a category or Ready to Assign to another category or Ready to
  Assign. `from`/`to`: a category id or "ready_to_assign" (not both, not equal). `amount`: positive integer
  milliunits (1000 = one currency unit); moving more than the category's Available is allowed. `month`: YYYY-MM-01.
  Returns move_id, the amount, each category side's month amounts (assigned, activity, available; null for Ready
  to Assign) and the month's ready_to_assign. One atomic change, recorded in history as one move."
- **cover_overspending**: "Cover an overspent category in one plan month: moves exactly its negative Available
  (in integer milliunits, 1000 = one currency unit) from `from` (a category id or "ready_to_assign") so its
  Available becomes 0. `month`: YYYY-MM-01. Fails if the category is not overspent. Returns the same shape as
  move_money."

## 6. Worker tests (new `apps/worker/test/moves.test.ts`)

Seed as in `month-categories.test.ts` (`createBudget`, default categories).

- **Surface**: `expect(await apiPaths()).toEqual(expect.arrayContaining([MOVES, COVER]))` and
  `expect(await listedToolNames()).toEqual(expect.arrayContaining(["move_money", "cover_overspending"]))`.
- **REST**:
  - cat→cat leaves RTA equal, and the response equals the read model;
  - cat→RTA raises RTA by the amount;
  - RTA→cat lowers RTA by the amount;
  - moving more than Available is allowed, and the source goes negative;
  - cover: assign −70000 to Fun and 275000 to Groceries, cover from Groceries → Fun 0, Groceries 205000, amount
    70000;
  - cover from `"ready_to_assign"` works.
- **History**:
  - a two-sided move writes two `month_category` rows with the same `after.move.id`, `month`, `amount` and
    `kind:"move"`, and the actor `user:tester@localhost`;
  - a one-sided move writes one row;
  - a cover writes `kind:"cover"`.
- **MCP parity**: through `mcpRpc("tools/call", …)` on a twin plan, the same numbers, and rows with actor
  `mcp:…`.
- **Errors**: design acceptance case 18, each status and envelope (`error.id`, `error.name`, `error.detail`).
- **Atomicity**: call `buildMoveBatch`, append a batch item D1 rejects (for example a query-builder insert into
  `change_log` with a duplicate primary key or a NOT NULL column left null), and run `db.batch`. It must throw, and
  afterwards both cells and the change_log count are unchanged.
- **Coverage**: if `apps/worker/test/mcp-coverage/` exists on main when you rebase, add
  `apps/worker/test/mcp-coverage/moves.ts` in that folder's format, mapping both REST operations to both tools.
  If it does not exist, say so in your report.

## 7. Web API

**`apps/web/src/api/monthCache.ts`**: move the per-plan queue here from `api/assigned.ts`.

```ts
/** Runs writes of one plan one after another, in call order. */
export function inOrder<T>(budgetId: string, fn: () => Promise<T>): Promise<T>
```

`useCommitAssigned` uses it, with unchanged behaviour.

**New `apps/web/src/api/moves.ts`**:

```ts
export const postMove = (budgetId, month, body: MoveCreate): Promise<MoveResult>      // POST …/moves, idempotencyKey
export const postCover = (budgetId, month, categoryId, from: string): Promise<MoveResult>
export function useMoveMoney(budgetId: string, onError: (e: unknown) => void):
  (m: { month: Month; from: string; to: string; amount: number; cover?: { categoryId: string } }) => Promise<void>
```

`useMoveMoney` does the following:

1. `await beginWrite(qc, budgetId)`.
2. For every cached query `["month", budgetId, *]`, apply `applyMove(d, m.month, side(from), side(to), amount)`,
   where `side("ready_to_assign")` is null.
3. Run `inOrder(budgetId, () => cover ? postCover(…) : postMove(…))`.
4. On error, apply the inverse (`applyMove` with the sides swapped) to the same caches, then call `onError`.
5. Finally, `endWrite`.

For a cover, the amount is `−available` taken from the cache, and the server computes its own.

**`apps/web/src/api/months.ts`**: add

```ts
export const useMonthList = (budgetId: string, from: Month, to: Month | null) =>
  useQuery({ queryKey: ["month-list", budgetId, from, to], enabled: !!to && to >= from, … })
```

It reads `GET …/months?from&to` with `MonthListResponse`. It is used by Fix This.

## 8. Picker and popover (`apps/web/src/plan/CategoryPicker.tsx`, `Popover.tsx`)

**CategoryPicker**: add optional props.

- `readyToAssign?: number`.
  - When it is set, render an option first under "Plan Categories", before the groups: id `${listId}-rta`, text
    "Inflow: Ready to Assign", its amount with the same `picker-available` classes.
  - It is part of `flat` for the keyboard, it is filtered by `needle` against "inflow: ready to assign", and it is
    picked as `READY_TO_ASSIGN`.
  - `selectedName` for that value is "Inflow: Ready to Assign".
- `include?: (c: MonthCategoryDetail) => boolean`, applied next to `exclude`.
- **List placement**: on open, measure the input's rect.
  - When the room below (`innerHeight − rect.bottom − 8`) is under 240 and the room above is larger, add
    `is-up` (`bottom: 100%; margin: 0 0 4px`).
  - Set `max-height` to `min(240, room on that side)` (inline style).
- DeleteDialog passes none of the new props; its behaviour is unchanged.

**Popover**: add optional `dismissOnOutside?: boolean` (a `mousedown` on `.popover-overlay` whose target is the
overlay itself calls `onClose`) and `gap?: number` (default 15, replacing the fixed `ARROW_H` offset in `top`).

## 9. Ready to Assign box (EXF-491)

New files in `apps/web/src/plan/`:

**`ReadyToAssign.tsx`**: `export function ReadyToAssign({ budgetId, month }: { budgetId: string; month: Month })`.

- Reads `useMonth(budgetId, month).data`. Before data arrives, it renders an empty `.rta-box` placeholder.
- Markup:
  - `div.rta-box.is-positive|is-zero|is-negative` (ref = breakdown anchor), holding
    `button.rta-summary[aria-label="View Ready to Assign Breakdown"][aria-haspopup=dialog]` with
    `span.rta-amount` (`money(rta)` and `InfoCircleFillIcon`) and `span.rta-label`.
  - On the right: `button.rta-button` "Assign" + `CaretDownIcon` (positive); "Fix This" (negative); or
    `button.rta-check[disabled][aria-label="All Money Assigned"]` with `CheckCircleFillIcon` (zero).
- State: `open: null | "breakdown" | "assign" | "fix"`, closed on a month change (as `PlanHeader` does), and
  `notice: string | null`, which clears after 5 s and renders `div.rta-notice[role=alert]` under the box.
- Writes go through `useMoveMoney(budgetId, onError)`. The errors are "Couldn't assign the money." and "Couldn't
  un-assign the money.".

**`RtaBreakdown.tsx`**: `({ detail, anchor, onClose })`.

- Uses `Popover` (width 540, gap 8, `dismissOnOutside`, label "Ready to Assign Breakdown").
- Block and line rules: design "Breakdown popover".
- Month names come from `new Date(month).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })` for M
  and M−1 (`addMonths`).
- Signed formatting: `signed(m)` = "+" + `money(m)` when m > 0, `money(m)` when m < 0 (U+2212 already), and
  "+$0.00" for 0 in the block headers. The total uses "$0.00" at 0.

**`AssignPopover.tsx`**: `({ detail, budgetId, month, anchor, onClose, move })`.

- Uses `Popover` (width 320, label "Assign").
- Tabs: `div[role=tablist]` with `button[role=tab]` "Auto" (`aria-disabled="true"`, `disabled`, title "Coming
  soon") and "Manually" (`aria-selected="true"`). The panel is `div[role=tabpanel]`.
- Then `label` "Assign:", `input.move-amount[aria-label="Amount"]` (autofocus, select all), `label` "To:", and
  `CategoryPicker` (`label="To"`, no RTA entry).
- Buttons Cancel and Assign. Use the existing popover button classes from `NamePopover`.
- `amount = evaluateAssigned(text, detail.ready_to_assign)`. Assign is enabled when `to !== null && amount > 0`.
- Assign calls `move({ month, from: READY_TO_ASSIGN, to, amount })` and then `onClose()`.
- Enter in the amount field calls Assign when it is enabled. On blur, the field reformats to
  `formatAssignedInput(amount)`.

**`FixThisPopover.tsx`**: `({ detail, budgetId, month, anchor, onClose, move })`.

- Uses `Popover` (width 320, label "Un-assign money from"), with the heading text "Un-assign money from".
- Months:
  - `range = useMonthRange(budgetId).data`;
  - `last = range?.last_assigned_month`;
  - `list = useMonthList(budgetId, addMonths(month, 1), min(last, addMonths(month, 120)))`;
  - options are `[month, ...list.months.filter(s => s.assigned !== 0).map(s => s.month)]`.
- `MonthDropdown`, local to the file:
  - a `button[aria-haspopup=listbox]` showing `monthLabel(chosen)` and a caret, which opens a
    `div[role=listbox][aria-label="Month"]` of `div[role=option]` rows;
  - the rows use mousedown-preventDefault and click-to-pick;
  - arrow keys and Enter work; Escape closes the list only (stopPropagation, as the picker does).
- Picker: `useMonth(budgetId, chosen).data?.groups`, with `include={c => c.available > 0}` and `label="Category"`.
  It resets when the month changes.
- OK is enabled when a category is picked. It calls
  `move({ month: chosen, from: cat, to: READY_TO_ASSIGN, amount: −detail.ready_to_assign })`.

**`PlanHeader.tsx`**: drop the `children` prop and render `<ReadyToAssign budgetId={budgetId} month={month} />`
inside `.plan-header-totals`. Opening a header popover (month picker, note) and the box popovers are independent;
each closes on a month change.

**`icons.tsx`**: add `SubtractCircleFillIcon`, `InfoCircleFillIcon`, `CheckCircleFillIcon`. Draw your own simple
SVG paths; copy no source art. `CaretDownIcon` exists in `monthNavIcons.tsx`.

**`plan-header.css`**: local tokens in its `:root` block (`--calloutPositiveProminentBackground: #346011`,
`--calloutNegativeProminentBackground: #6a1020`, `--rtaButtonPositive: #508316` / hover `#77ba21`,
`--rtaButtonNegative: #bf2e3b` / hover `#ce5e66`, `--helpboxBackground: rgba(117,131,255,.2)`). `.rta-box` flex,
space-between, padding 8px 16px 12px, radius 8, the three state colours; `.rta-amount` 21px/700 lh 25.2px;
`.rta-label` 14px/500 lh 16.8px; info icon 16px, opacity 0, 1 on hover (always in `.is-negative`);
`.rta-button` height 32, radius 8, padding 4px 16px, margin-left 40px, white, caret 8px margin-left .7rem;
`.rta-check` 30×34, no background, 30px icon #9B9CAA opacity .8, margin-left 40px. Breakdown and Assign tabs: the
values in the design's Source section, colours through the existing tokens (`--backgroundSecondaryElevated`,
`--borderSubtle`, `--labelSecondary`, `--buttonPrimaryBackground`, `--actionPrimaryActive`).

## 10. Move and Cover (EXF-492)

**`AvailablePill.tsx`**: add the prop `onOpen?: (anchor: HTMLButtonElement) => void`, called on click. Remove the
"No click action yet" comment. The disabled rule stays (`amount === 0 || !interactive`).

**`rows.tsx`**: `CategoryRow` gets `onPill: (anchor: HTMLElement) => void` and passes it to the pill.
`UncategorizedRow` is unchanged (`interactive={false}`).

**`PlanGrid.tsx`**:

- Extend `Open` with `{ kind: "move" | "cover"; categoryId: string; anchor: HTMLElement }`.
- `onPill` sets it from `c.available > 0 ? "move" : "cover"`.
- `const move = useMoveMoney(budgetId, () => setNotice("Couldn't move the money."))`.
- `renderPopover` renders `MovePopover` or `CoverPopover` with `data` (the viewed month), `categoryId` and
  `anchor`.

**`MovePopover.tsx`**: `({ detail, month, categoryId, anchor, onClose, move })`.

- Uses `Popover` (320, label "Move money").
- `label` "Move" and `input.move-amount[aria-label="Amount"]` prefilled `formatAssignedInput(c.available)`
  (autofocus, select all); `label` "To"; `CategoryPicker` with `readyToAssign={detail.ready_to_assign}`,
  `exclude={new Set([categoryId])}` and `label="To"`.
- Buttons Cancel and OK. `amount = evaluateAssigned(text, c.available)`; OK is enabled when `to && amount > 0`.
- OK calls `move({ month, from: categoryId, to, amount })` and `onClose()`.

**`CoverPopover.tsx`**: `({ detail, month, categoryId, anchor, onClose, move })`.

- Uses `Popover` (320, label "Cover overspending").
- Text "Cover overspending from", then `CategoryPicker` (`readyToAssign`, `include={c => c.available > 0}`,
  `autoFocus`, `label="From"`). There is no amount field.
- OK is enabled when `from` is set. It calls `move({ month, from, to: categoryId, amount: −c.available,
  cover: { categoryId } })` and `onClose()`.

**`plan-grid.css`**: `.move-popover` (padding 16; labels `margin-bottom: 8px`; `.move-amount` full width, padding 8,
`1px solid var(--inputBorder)`, `--inputBackground`, left-aligned, `margin-bottom: 16px`; actions flex
`justify-content: flex-end`), and `.picker-list.is-up`.

## 11. End-to-end specs

Both specs:

- Create and delete their plan in `beforeEach` and `afterEach`, as `e2e/assigned.spec.ts` does.
- Seed through the API: `POST /api/v1/budgets/{id}/accounts` `{ name: "ZZ-TEST Checking", type: "checking",
  balance }` for the inflow, and `PATCH …/categories/{id}` for Assigned.
- Use exact locators (`{ exact: true }`).
- Click every popover button, trigger and picker row through a helper:

  ```ts
  async function realClick(page: Page, loc: Locator) {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox(); if (!b) throw new Error("not visible");
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    expect(await loc.evaluate((el, [px, py]) => { const h = document.elementFromPoint(px, py);
      return !!h && (h === el || el.contains(h)); }, [x, y])).toBe(true);
    await page.mouse.move(x, y); await page.mouse.click(x, y);
  }
  ```

**`e2e/rta.spec.ts`** covers design cases 1 to 9 and the RTA half of 21 (Assign and Fix This at 1440×900 and
1024×700). The colour checks use `getComputedStyle`.

**`e2e/moves.spec.ts`** covers cases 10 to 16, 20 (`page.route` on `**/moves` answering 500), and the pill half
of 21: the last visible category in the grid at both sizes, where the picker rows reached are the first one and
the last one after scrolling the list.

Run `pnpm e2e e2e/rta.spec.ts e2e/moves.spec.ts e2e/categories.spec.ts e2e/assigned.spec.ts
e2e/plan-grid.spec.ts e2e/month-nav.spec.ts` before you hand over.

## 12. Report

The routes and tools as built, the move history shape, the picker props, the disabled Auto tab (EXF-519), the
coverage folder status, and the manifest check (`git diff --stat origin/main` lists only Manifest files).
