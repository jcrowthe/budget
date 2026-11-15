# Assigned inline edit spec (EXF-489)

This is the implementation task list for [assigned-inline-design.md](assigned-inline-design.md). Read that first:
behaviour, error matrix and acceptance cases live there. Follow `docs/conventions.md`.

**Do not edit:**

- `apps/worker/src/routes/months.ts`, `apps/worker/src/mcp/tools/months.ts` and
  `apps/worker/src/services/months.ts`;
- `packages/schema/src/months.ts`, `apps/web/src/api/months.ts` and `apps/worker/test/months.test.ts`;
- `apps/web/src/pages/plan.tsx`, `apps/web/src/shell/**` and `packages/core/src/**`;
- any `paths.always_overlap` file (`package.json`s, lockfile, `vitest.config.ts`, …);
- `apps/worker/test/{openapi,mcp,existing-surface}.test.ts` and `e2e/mcp.spec.ts`.

`setAssigned` and `getPlanMonth` are called, never changed.

## T1. Schemas: `packages/schema/src/month-categories.ts`

Import `z` from `@hono/zod-openapi`, `Month` from `./common/dates`, `Milliunits` from `./common/money` and
`dataEnvelope` from `./common/envelope`.

```ts
export const AssignedMonth: z.ZodString;   // Month + .regex(/^(19|20|21)\d{2}-/, "Year must be between 1900 and 2199")
export const AssignedUpdate = z.object({ assigned: Milliunits }).openapi("AssignedUpdate");
export const MonthCategoryAmounts = z.object({
  id: z.string(), month: Month, assigned: Milliunits, activity: Milliunits, available: Milliunits,
}).openapi("MonthCategoryAmounts");
export const AssignedResult = z.object({ category: MonthCategoryAmounts, ready_to_assign: Milliunits })
  .openapi("AssignedResult");
export const AssignedResultResponse = dataEnvelope(AssignedResult).openapi("AssignedResultResponse");
export type AssignedUpdate / MonthCategoryAmounts / AssignedResult  // z.infer
```

`AssignedMonth` duplicates the private `InputMonth` of `months.ts`, which this Build may not export.

**Verify:** `pnpm check` typechecks.

## T2. Pure logic: `packages/schema/src/assigned-edit.ts` and `packages/schema/test/assigned-edit.test.ts`

This file has no zod and no I/O. It imports only types: `Milliunits` from `./common/money` (`z.infer`) and
`MonthDetail` from `./months`.

```ts
export function evaluateAssigned(text: string, before: number): number;
export function formatAssignedInput(m: number): string;
export function applyAssigned(detail: MonthDetail, categoryId: string, assigned: number): MonthDetail;
```

- **`evaluateAssigned`** follows the design's five steps exactly.
  - Write a small recursive-descent or two-stack evaluator over the normalised string; never use `eval` or
    `Function`.
  - The prefix for continuation is `before / 1000` written with `String()`.
  - Rounding: `const cents = Math.round(Number((Math.abs(r) * 100).toPrecision(12)))`, then
    `sign * cents * 10`. Normalise `-0` to `0`.
  - Return 0 when the result is not finite or `Math.abs(result) > Number.MAX_SAFE_INTEGER`.
- **`formatAssignedInput`:** `Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`
  of `m / 1000`. The default `-` is ASCII hyphen-minus, so this gives `-12.00`.
- **`applyAssigned`:** immutable copy following the design's delta rules (category, its group, `ready_to_assign`
  −delta, `rta_breakdown.assigned_in_month` −delta). If the id is unknown or the delta is 0, return the same
  object.

**Tests** (vitest, project `unit`):

- **Ticket rows.** Each case is (text, before, expected milliunits):
  - `("400", 0, 400000)`, `("400.00+50", 400000, 450000)`, `("+50", 400000, 450000)`
  - `("100.00*2", 100000, 200000)`, `("*2", 100000, 200000)`, `("x2", 100000, 200000)`
  - `("200.00/4", 200000, 50000)`, `("/4", 200000, 50000)`, `("50.00-10", 50000, 40000)`
  - `("0.00*2", 0, 0)`, `("12.345", 0, 12350)`, `("1,234.5", 0, 1234500)`, `("abc", 400000, 0)`
- **Negative and continuation cases:**
  - `("-10", 50000, -10000)`, `("-12.00+5", -12000, -7000)`, `("0-25", 0, -25000)`, `("-12.345", 0, -12350)`
- **Normalisation:** `("$1,000", 0, 1000000)`, `("2×3", 0, 6000)`, `("9÷3", 0, 3000)`, `("5−2", 0, 3000)`,
  `(" 4 0 ", 0, 40000)`
- **Precedence:** `("2+3*4", 0, 14000)`, `("10/4", 0, 2500)`, `("1/3", 0, 330)`, `("2/3", 0, 670)`, `(".5", 0, 500)`,
  `("5.", 0, 5000)`
- **Zero results:** `("", 0, 0)`, `("1.2.3", 0, 0)`, `("5/0", 0, 0)`, `("4+", 0, 0)`, `("1e5", 0, 0)`, `("++1", 0, 0)`
- **`formatAssignedInput`:** 0 → `0.00`, 400000 → `400.00`, 1234500 → `1,234.50`, −12000 → `-12.00`, 12345 → `12.35`
  (display only).
- **`applyAssigned`** on a hand-built two-group `MonthDetail` (made-up values): setting a category from 100000 to
  250000 moves its `assigned`/`available`, its group's `assigned`/`available`, `ready_to_assign` and
  `assigned_in_month` by ±150000. The other group and the other categories are deep-equal to before, and the input
  object is not mutated. An unknown id returns the input.

**Verify:** `pnpm vitest run --project unit packages/schema/test/assigned-edit.test.ts`.

## T3. Service: `apps/worker/src/services/month-categories.ts`

```ts
export async function setAssignedAndRead(
  env: Env, actor: string,
  input: { budget_id: string; month: string; category_id: string; assigned: number },
): Promise<AssignedResult>;
```

1. Check `budget_id` against a UUID regex (or `z.uuid().safeParse`); if it fails, throw `new NotFound("Plan")`.
   Check `category_id` the same way and throw `new NotFound("Category")`.
2. `await setAssigned(env, actor, input)`.
3. `const m = await getPlanMonth(env, input.budget_id, input.month)`.
4. Find the category in `m.groups.flatMap(g => g.categories)`. If it is absent, throw `NotFound("Category")`.
5. Return `{ category: { id, month: m.month, assigned, activity, available }, ready_to_assign: m.ready_to_assign }`.

Both the route and the tool call this function; neither calls `setAssigned` directly.

## T4. Route: `apps/worker/src/routes/month-categories.ts`

- **Structure.** Copy the structure of `routes/months.ts`: a `json()` helper, an `errors` object
  (403/404/409/422 with `ErrorBody`), and an `OpenAPIHono<AppEnv>` whose `defaultHook` returns
  `apiError(c, 422, "unprocessable_entity", issues)`. Use tags `["Months"]`.
- **Route.** One `createRoute`: `method: "patch"`, `path: "/budgets/{budget_id}/months/{month}/categories/{category_id}"`.
- **Params:**
  - `budget_id`: `z.string().min(1)`;
  - `month`: `AssignedMonth`;
  - `category_id`: `z.string().min(1)`;
  - each with `.openapi({ param: { name, in: "path" } })`.
- **Body:** `AssignedUpdate`, required.
- **Responses:** 200 `AssignedResultResponse`, plus the errors.
- **Handler:**

  ```ts
  c.json({ data: await setAssignedAndRead(c.env, c.get("identity").actor,
    { ...c.req.valid("param"), ...c.req.valid("json") }) }, 200)
  ```

**Verify:** `GET /api/v1/openapi.json` lists the path. Without editing the old tests, `openapi.test.ts` and
`existing-surface.test.ts` still pass (they derive from the glob).

## T5. MCP tool: `apps/worker/src/mcp/tools/month-categories.ts`

```ts
export const tools: McpToolDef[] = [{
  name: "set_assigned",
  description: "Set a category's Assigned amount for one month of a plan (milliunits; negative allowed). Returns the category's month amounts and the month's new Ready to Assign.",
  inputSchema: z.object({ budget_id: z.string().min(1), month: AssignedMonth, category_id: z.string().min(1), assigned: Milliunits }),
  run: async (input: {...}, { env, actor }) => setAssignedAndRead(env, actor, input),
}];
```

Import `z` from `"zod"` as `tools/months.ts` does. `AssignedMonth` and `Milliunits` come from `@budget/schema/…`.

## T6. Worker tests: `apps/worker/test/month-categories.test.ts`

- **Seeding.** Seed with `createBudget` (it creates the 11 default categories). Read ids via
  `GET …/months/<m>`.
- **Requests.** Use `json()` from `./helpers` (look at how `budgets.test.ts` sends a PATCH body) and `mcpRpc` from
  `./surface`.
- **Cases.** Write one `it` per design acceptance case: **15** (REST incl. the full 404/422 matrix and −5000),
  **16** (MCP parity, `isError` on an unknown category) and **17** (surface).
- **`change_log` checks.** Query `change_log` with
  `env.DB.prepare("SELECT actor, entity_type, action, entity_id, before_json, after_json FROM change_log WHERE budget_id = ? AND entity_type = 'month_category'")`.
  Check one row per call, actor `user:tester@localhost` for REST and `mcp:user:tester@localhost` for MCP, and
  `before_json.assigned` and `after_json.assigned` set.
- **Another plan's category.** Create a second plan and PATCH plan A's URL with plan B's category id. Expect 404.

**Verify:** `pnpm vitest run --project worker apps/worker/test/month-categories.test.ts` (use the Worker project
name from `apps/worker/vitest.config.ts`).

## T7. Web API: `apps/web/src/api/assigned.ts`

```ts
export const setAssignedAmount: (budgetId: string, month: Month, categoryId: string, assigned: number) => Promise<AssignedResult>;
export function useCommitAssigned(budgetId: string, month: Month, onError: (e: unknown) => void):
  (categoryId: string, before: number, after: number) => Promise<void>;
```

- **`setAssignedAmount`:** `apiFetch(path, { method: "PATCH", body: { assigned }, idempotencyKey:
  crypto.randomUUID(), schema: AssignedResultResponse })`, then `.data`.
- **`useCommitAssigned`:** `useQueryClient()` plus a `useCallback` that does, in order:
  1. If `after === before`, return.
  2. `await qc.cancelQueries({ queryKey: key, exact: true })`, where `key = ["month", budgetId, month]`.
  3. `qc.setQueryData<MonthDetail>(key, d => d && applyAssigned(d, categoryId, after))`.
  4. Start the request without awaiting it: `setAssignedAmount(...).catch(e => { revert; onError(e) })
     .finally(() => qc.invalidateQueries({ queryKey: ["month", budgetId] }))`. Here `revert` sets the data with
     `applyAssigned(d, categoryId, before)` only if that category's cached `assigned === after`.
- **Optional.** You may also patch the category's `assigned`/`available` and `ready_to_assign` from the answer
  before invalidating. That is not required.

## T8. Icon: `apps/web/src/plan/icons.tsx`

Add `CalculatorIcon`. It is your own artwork on the existing 24-unit `base`: a 2×2 grid of small `+`, `−`, `×` and
`÷` glyphs as filled paths, `aria-hidden`. Use no source artwork.

## T9. Cell: `apps/web/src/plan/AssignedCell.tsx`

```ts
export function AssignedCell(props: {
  name: string;               // category name, for the input's aria-label
  assigned: number;
  editing: boolean;
  onOpen: () => void;
  onClose: (how: "enter" | "escape" | "tab" | "shiftTab" | "next" | "prev" | "blur") => void;
  onCommit: (after: number) => Promise<void>;  // PlanGrid binds categoryId and before
}): JSX.Element
```

- **Closed.** Render `<div className="assigned-box" onClick={onOpen}>` containing:
  - `<button type="button" className="calculator-button" tabIndex={-1} aria-hidden onMouseDown={e => e.preventDefault()}>`
    with `<CalculatorIcon/>` inside;
  - `<button type="button" className={amountClass(assigned)} onClick={onOpen}>{money(assigned)}</button>`.

  Export `amountClass` from `rows.tsx`, or move it to `format.ts` (both files are in the manifest; prefer
  `format.ts`).
- **Open.**
  - The box gets class `assigned-box is-editing`.
  - It renders the same calculator button and
    `<input className="assigned-input" type="text" aria-label={`Assigned for ${name}`} autoComplete="off" spellCheck={false}>`.
  - The input holds its own `useState(text)`, initialised to `formatAssignedInput(assigned)` when it mounts.
  - Use a ref callback or effect on mount to run `el.focus(); el.select()`.
  - Keep `initial` in a ref and `done = useRef(false)`.
  - `finish(how, commit: boolean)`:
    1. If `done.current` is set, return; otherwise set it.
    2. If committing, the text differs from `initial`, and `after = evaluateAssigned(text, assigned)` differs from
       `assigned`, call `const p = onCommit(after)`.
    3. Call `onClose(how)`.
    4. For `tab`, PlanGrid needs to know when the optimistic write is done: pass `p` along, for example
       `onClose(how, p)` (extend the signature as you see fit).
- **`onKeyDown`** follows the design's key table:
  - Operator append: `if ("+-*/xX".includes(e.key) && el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0) el.setSelectionRange(len, len)`,
    without `preventDefault`.
  - Enter, Escape, Tab, Shift+Tab, ArrowDown and ArrowUp each call `preventDefault()` and then `finish`.
  - Escape also calls `stopPropagation()`.
- **`onBlur`** calls `finish("blur", true)`.

## T10. Rows and grid: `rows.tsx` and `PlanGrid.tsx`

- **`rows.tsx`.** `CategoryRow` gets new props: `editing`, `onOpen`, `onClose`, `onCommit`, and
  `focusRequest: "available" | "name" | null` with `onFocusDone`.
  - Render `<AssignedCell …/>` in `.cell-assigned`.
  - Hold refs to the name button and the pill. `AvailablePill` gets an optional `ref`: React 19 passes `ref` as a
    prop. Check the React version in `apps/web/package.json`; on React 18 use `forwardRef`.
  - The name becomes `<button type="button" className="category-name" title={c.name}>`.
  - Effect on `[focusRequest, c.available]`:
    - for `"name"`, focus the name button and call `onFocusDone()`;
    - for `"available"`, if `!pill.disabled`, focus it and call `onFocusDone()`.

  `GroupRow` and `UncategorizedRow` are unchanged, apart from `amountClass` if moved.
- **`PlanGrid.tsx`:**
  - **State:** `const [editing, setEditing] = useState<string | null>(null)`,
    `const [focusReq, setFocusReq] = useState<{ id: string; target: "available" | "name"; at: number } | null>(null)`
    and `const [notice, setNotice] = useState<string | null>(null)`.
  - **Order:** `order` = ids of visible categories in render order: not-hidden groups, `!isCollapsed`, not-hidden
    categories (exactly the rows rendered).
  - **Commit:** `const commit = useCommitAssigned(budgetId, month, () => setNotice("Couldn't save the assigned amount."))`.
  - **Per row:**
    - `onOpen` runs `setEditing(c.id); setFocusReq(null); setNotice(null)`.
    - `onCommit` runs `(after) => commit(c.id, c.assigned, after)`.
    - `onClose(how, p)`:
      - `next`/`prev`: set `editing` to the neighbour in `order`, or `null` at the ends.
      - Otherwise set `editing` to `null`.
      - `tab`: once `p` (or `Promise.resolve()`) resolves, `setFocusReq({ id, target: "available", at: Date.now() })`.
      - `shiftTab`: `setFocusReq({ id, target: "name", … })` at once.
  - **Focus requests** older than 1000 ms are ignored: pass `null` to the row.
  - **Month change:** when `month` changes, reset `editing` to `null`.
  - **Notice:** when `notice` is set, render `<div className="grid-notice" role="alert">{notice}</div>` as the
    first child of `.grid-body`. Clear it with a 5 s timeout effect.
  - The existing Ctrl+↑/↓ handler already ignores inputs; leave it.

## T11. CSS: `apps/web/src/plan/plan-grid.css`

Add `--inputBorderActive: #545bfe;` and `--iconFillSecondary: #727484;` to the top `:root` block. The design
"CSS" list gives the rules. Values:

- **Box.** `.category-row .assigned-box` uses `display:flex; align-items:center; justify-content:space-between;
  padding:0`, keeping the existing width, height, border and radius.
  - **Hover:** `.category-row .assigned-box:hover` gets `border-color: var(--actionPrimary)` and
    `background: var(--backgroundPrimary)`.
  - **Editing:** `.assigned-box.is-editing` gets `border-color: var(--inputBorderActive)`, the same background
    and `box-shadow: none`. On hover `.assigned-box.is-editing:hover` keeps `var(--actionPrimary)`.
- **Calculator button.** `.calculator-button` is `flex:none; width:18px; height:22px; padding:0; border:0;
  background:none; opacity:0; color:var(--iconFillSecondary); cursor:pointer`.
  - It has `opacity:1` under `.assigned-box:hover` and `.is-editing`.
  - The svg is `width:16px; height:16px; margin:2px 0 0 2px`.
  - On `.calculator-button:hover`, the colour is `var(--actionPrimary)`.
- **Amount button.** `.assigned-box .amount` is `flex:1; min-width:0; padding:3px; border:0; background:none;
  font:inherit; font-size:var(--font-size-sm); font-weight:500; color:var(--labelPrimary); text-align:right;
  cursor:text`.
  - Keep `.amount.zero` winning for the zero colour `#c4c5cf`: check specificity, as `plan-grid.spec.ts` asserts
    `rgb(196, 197, 207)`.
- **Input.** `.assigned-input` is `flex:1; min-width:0; width:100%; height:22px; padding:0 3px; border:0;
  outline:none; background:transparent; color:var(--labelPrimary); font:inherit; font-size:var(--font-size-sm);
  font-weight:500; font-variant-numeric:tabular-nums; text-align:right`.
- **Name button.** `button.category-name` is `border:0; background:none; color:inherit; font-family:inherit;
  line-height:inherit; text-align:left; cursor:default`. Leave padding and font-size to the existing
  `.category-name` rule.
- **Notice.** `.grid-notice` is `padding: var(--space-2) var(--space-3); background: var(--statusNegative);
  color: #fff` (use the existing token names from `tokens.css`; add no raw colour except in the `:root` block),
  `font-size: var(--font-size-sm)`.
- **Uncategorized row.** Its `.assigned-box` must look as before: scope the new flex rules to
  `.category-row:not(.uncategorized-row)` if needed.

## T12. E2e: `e2e/assigned.spec.ts`

- **Setup.** Use `beforeEach`/`afterEach` plan create/delete and the `open`, `catRow`, `groupRow` and `css`
  helpers, copied from `plan-grid.spec.ts` (do not import from it).
  - Read the API with `request.get(…, { headers: await authHeaders() })`.
  - Count PATCHes with `page.on("request", r => r.method() === "PATCH" && /\/categories\//.test(r.url()))`.
  - Wait for each commit's response (`page.waitForResponse`) before reading the API.
- **Cases.** One `test` per design acceptance case 1, 4–14, plus a REST/MCP parity test for case 16's e2e line
  (copy `rpc()` from `months.spec.ts`).
- **Months.** Month paths come from `YYYYMM` of last, current and next month in local time, as `plan-grid.spec.ts`
  computes `ISO`.
- **Case 1.** Move the mouse off the cell (`page.mouse.move(0, 0)`) before reading the border colour.
- **Compare cases.** Cases 2 and 3 are for the Tester (live source). The spec only asserts the clone's own
  values, from case 1 and the hover values in case 3.
- Edit `e2e/plan-grid.spec.ts` only if an assertion about the plain Assigned cell really breaks, and say which.

**Verify:** `pnpm e2e e2e/assigned.spec.ts e2e/plan-grid.spec.ts` (with `--repeat-each=3` once for flakiness),
then `pnpm check`.

## T13. Docs

The design and spec are committed by the Architect, and `docs/README.md` already has its line. Change nothing
else in the README.

## Done when

- `pnpm check` is green.
- Both e2e specs pass with `--repeat-each=3`.
- `git diff --name-only origin/main` is a subset of the design's Manifest `touches`, and no file from the
  "Do not edit" list appears.
