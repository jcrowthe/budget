# EXF-493 implementation spec: month navigation, picker and note

Read `docs/month-nav-design.md` first; it holds the behaviour, the acceptance cases and the manifest. This
file is the task list. Follow `docs/conventions.md`. Do not touch any file outside the manifest. In
particular, never touch the shell (`apps/web/src/shell/**`), the grid files (`plan/rows.tsx`, `PlanGrid.tsx`,
`plan-grid.css`, `AvailablePill.tsx`, `Toolbar.tsx`, `collapse.ts`, `progressBars.ts`, `format.ts`,
`icons.tsx`), `packages/core/src/**`, the accounts and transactions repositories and services, or any file
in `paths.always_overlap`. No migration.

## T1. Schema: `packages/schema/src/months.ts`

- Export the existing month input as `export const InputMonth` (no other change to it).
- `export const MONTH_NOTE_MAX = 5000;`
- `MonthNoteSet.note` becomes `z.string().max(MONTH_NOTE_MAX).nullable()`; it was 500.
- New schemas, each with `.openapi(name)`, and their `z.infer` types:

```ts
MonthNoteUpdate   = z.object({ note: z.string().max(MONTH_NOTE_MAX).nullable() })            // "MonthNoteUpdate"
MonthNote         = z.object({ month: Month, note: z.string().nullable() })                  // "MonthNote"
MonthNoteResponse = dataEnvelope(MonthNote)                                                  // "MonthNoteResponse"
MonthRange        = z.object({ first_month: Month, last_assigned_month: Month.nullable() })  // "MonthRange"
MonthRangeResponse = dataEnvelope(MonthRange)                                                // "MonthRangeResponse"
```

Verify: `pnpm -r typecheck`.

## T2. Repository: new `apps/worker/src/repositories/month-range.ts`

```ts
export interface MonthFacts { firstAssigned: string | null; lastAssigned: string | null;
                              firstNote: string | null; firstTransaction: string | null }
export async function monthFacts(db: Db, budgetId: string): Promise<MonthFacts>
```

- Use one `db.get`/`select` of four scalar subqueries, built with drizzle `sql` over the table objects from
  `db/schema/month-categories`, `db/schema/months` and `db/schema/transactions`. Import the tables only, not
  their repositories.
  - `min(month)` and `max(month)` from `month_categories` where `budget_id = ? and assigned <> 0`;
  - `min(month)` from `months` where `budget_id = ? and note is not null`;
  - `min(substr(date, 1, 7)) || '-01'` from `transactions` where `budget_id = ? and deleted_at is null`.
    This is null when there are no rows; guard it so the result is null, not `'-01'`. For example, use
    `case when count(*) = 0 then null else … end`.
- Read only; no statements.

## T3. Service: `apps/worker/src/services/months.ts`

- `setMonthNote`:
  - After `MonthNoteSet.parse`, normalise once: `const note = v.note?.trim() || null;`.
  - Use `note` in `upsertNoteStmt`, in the change_log `after`, and in the return value.
  - Keep `before` as `before?.note ?? null`.
  - Keep the return type `{ month, note }`, which is now the stored value.
- New `getMonthRange`:

```ts
export async function getMonthRange(env: Env, budgetId: string): Promise<MonthRange>
```

  - Read the plan with `budgetsRepo.findActive`; when it is missing, throw `NotFound("Plan")`. Do not use
    `requirePlan`: you need the row.
  - `created = toMonth(plan.createdAt)`, with `toMonth` from `@budget/core/month`.
  - `first_month` = the minimum (by string comparison) of the non-null values among `created`,
    `firstAssigned`, `firstNote` and `firstTransaction`.
  - `last_assigned_month` = `lastAssigned`.

Verify: the T6 tests.

## T4. Routes: `apps/worker/src/routes/months.ts`

Append two `.openapi(...)` calls to the existing chain. Keep the `defaultHook` (it gives 422) and the
`errors` map.

1. `PATCH /budgets/{budget_id}/months/{month}`
   - `params`: `budget_id` as today, and `month: InputMonth.openapi({ param: … })`, so a year outside
     1900–2199 is a 422 from the hook, not a 400 from the service.
   - Body: `MonthNoteUpdate`, `required: true`.
   - The handler calls `setMonthNote(c.env, c.get("identity").actor, { budget_id, month, note })` and returns
     `c.json({ data: result }, 200)`.
   - Response: `200: json(MonthNoteResponse, "The stored note")` plus `errors`.
2. `GET /budgets/{budget_id}/month-range`
   - Params: `budget_id`.
   - Response: `200: json(MonthRangeResponse, "Facts for the month navigation limits")` plus `errors`.
   - The handler returns `{ data: await getMonthRange(c.env, budget_id) }`.

Hono matches `/months/{month}` and `/month-range` independently; their first segment after `budget_id`
differs. Verify: `curl` on `pnpm dev` (`/api/v1/openapi.json` lists both), or the T6 tests.

## T5. MCP tool: `apps/worker/src/mcp/tools/months.ts`

Append to `tools`:

```ts
{ name: "set_month_note",
  description: "Set or clear the free-text note of one plan month. An empty or whitespace-only note clears it. Max 5000 characters.",
  inputSchema: z.object({ budget_id: z.string().min(1), month: InputMonth, note: MonthNoteUpdate.shape.note }),
  run: (input, { env, actor }) => setMonthNote(env, actor, input) }   // returns { month, note }
```

## T6. Worker tests: new `apps/worker/test/month-nav.test.ts`

- Use the `json` and `call`/`authed` helpers from `test/helpers.ts`, and `apiPaths`, `listedToolNames` and
  `mcpRpc` from `test/surface.ts`.
- Seed with the services: `createBudget`, `createAccount`, `createCategoryGroup` / `createCategory` (or the
  default categories a new plan gets), `setAssigned` and `createTransaction`. Look at
  `apps/worker/test/months.test.ts` `seed()`.
- To delete a transaction, if no service exists, run `UPDATE transactions SET deleted_at = ? WHERE id = ?`
  through `env.DB` in the test.
- Name plans `ZZ-TEST <uuid>`.

Cases (design acceptance 5 (Worker part), 11 and 12):

- **surface:** `apiPaths()` contains `/api/v1/budgets/{budget_id}/month-range` and
  `/api/v1/budgets/{budget_id}/months/{month}`, and the `patch` operation exists on the latter in
  `apiDocument().paths`. `listedToolNames()` contains `set_month_note`.
- **PATCH:**
  - `{note:"  hi  "}` → 200 with `{month, note:"hi"}`.
  - Exactly one new change_log row: `entity_type='month'`, `entity_id=month`, `action='update'`, actor
    `user:tester@localhost`, `before_json` note null, `after_json` note `"hi"`. Check the column names in
    `db/schema/change-log.ts`.
  - `GET …/months/{month}` returns `note:"hi"`.
  - `{note:"   "}` → `note:null`, and the GET returns null.
  - `{note:null}` → null.
  - Errors: 5001 chars → 422; 5000 chars → 200; month `2026-10-02` → 422; month `2300-01-01` → 422; a
    missing body field → 422; an unknown plan UUID → 404.
  - Two different months keep independent notes.
- **Idempotency:** the same `Idempotency-Key` twice gives one change_log row.
- **MCP:**
  - `tools/call set_month_note` with `{budget_id, month, note:"x"}` → `structuredContent` `{month, note:"x"}`.
  - The change_log row's actor starts with `mcp:`, and its shape is the same as the REST row.
- **Range:**
  - A new plan → `first_month` = the creation month (`toMonth(created_at)` read back from the DB) and
    `last_assigned_month: null`.
  - A note in an earlier month → that month; clearing the note → back to the creation month.
  - `setAssigned(…, 0)` in an earlier month → unchanged; a non-zero assignment there → that month.
  - A transaction dated before everything → its month; after soft-deleting it → back to the previous value.
  - `setAssigned` in two later months → `last_assigned_month` = the later one.
  - An unknown plan → 404.

Verify: `pnpm vitest run --project worker apps/worker/test/month-nav.test.ts`. Check the project name in
`apps/worker/vitest.config.ts`; `pnpm check` runs everything.

## T7. Web API: `apps/web/src/api/months.ts` (add; keep `getMonth` and `useMonth` unchanged)

```ts
export const getMonthRange = (budgetId: string): Promise<MonthRange>          // GET /api/v1/budgets/{id}/month-range
export const useMonthRange = (budgetId: string) =>
  useQuery({ queryKey: ["month-range", budgetId], queryFn: () => getMonthRange(budgetId) })
export const setMonthNote = (budgetId: string, month: Month, note: string | null): Promise<MonthNote>
  // PATCH /api/v1/budgets/{id}/months/{month}, body {note}, idempotencyKey: crypto.randomUUID()
export function useSetMonthNote(budgetId: string, month: Month)
  // useMutation({ mutationFn: (note) => setMonthNote(...),
  //   onMutate: (note) => qc.setQueryData<MonthDetail>(["month", budgetId, month], d => d && { ...d, note }),
  //   onError: () => qc.invalidateQueries({ queryKey: ["month", budgetId, month] }),
  //   onSuccess: () => { invalidate ["month", budgetId, month] and ["month-range", budgetId] } })
```

## T8. Pure helpers: new `apps/web/src/plan/monthNav.ts`

```ts
export function monthLabel(month: Month): string            // "Nov 2026" (moved from pages/plan.tsx: en-US, short, UTC)
export const MONTH_SHORT: readonly string[]                 // ["Jan", …, "Dec"]
export interface NavLimits { earliest: Month; furthest: Month }
export function navLimits(range: MonthRange | undefined, current: Month): NavLimits | null
  // null when range is undefined; earliest = min(range.first_month, current);
  // furthest = addMonths(max(current, range.last_assigned_month ?? current), 1)
export const canPrev = (month: Month, l: NavLimits | null) => !!l && month > l.earliest;
export const canNext = (month: Month, l: NavLimits | null) => !!l && month < l.furthest;
export const inLimits = (m: Month, l: NavLimits | null) => !!l && m >= l.earliest && m <= l.furthest;
export const NEXT_DISABLED_TITLE = "Before you can move to next month, you need to assign money this month.";
```

`addMonths` comes from `@budget/core/month`; you only import it.

## T9. Icons: new `apps/web/src/plan/monthNavIcons.tsx`

`ChevronCircleLeftIcon`, `ChevronCircleRightIcon` and `CaretDownIcon`. Each takes `{ className?, size? }`
and renders an `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">`.

- The chevron icons are a circle (stroke `currentColor`, width 1.5) and a chevron path (stroke
  `currentColor`, round caps).
- The caret is a filled rounded triangle (`fill="currentColor"`).
- Draw them yourself; never copy the source's sprite.

## T10. Dismiss hook: new `apps/web/src/plan/useDismiss.ts`

```ts
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void,
                           returnFocus?: RefObject<HTMLElement | null>): void
```

- On document `keydown` Escape: `onClose()`, then `returnFocus?.current?.focus()`.
- On document `mousedown` outside `ref`: `onClose()`. Ignore mousedowns inside `returnFocus`, so the
  trigger's own click can toggle the popover.
- Clean up on unmount. This is the same pattern as `shell/PlanMenu.tsx`; do not import it.

## T11. Picker: new `apps/web/src/plan/MonthPicker.tsx`

```ts
export function MonthPicker(props: { month: Month; current: Month; limits: NavLimits | null;
  onPick: (m: Month) => void; onClose: () => void; triggerRef: RefObject<HTMLButtonElement | null> })
```

- `<div className="month-picker" role="dialog" aria-label="Choose month">`, using `useDismiss(ref, onClose,
  triggerRef)`.
- `year` state starts at `Number(month.slice(0, 4))`.
- Year row `div.month-picker-years`:
  - `button.month-picker-year-nav` with `aria-label`/`title` `Previous Year` (`ChevronCircleLeftIcon`
    size 24);
  - `span.month-picker-year` `{year}`;
  - the `Next Year` button.
- Grid `div.month-picker-months`: 12 `button.picker-month`.
  - `m = \`${year}-${pad(i+1)}-01\``, text `MONTH_SHORT[i]`, `aria-label={monthLabel(m)}`.
  - Classes `is-selected` when `m === month` and `is-current` when `m === current`;
    `aria-current="date"` on current.
  - `disabled={!inLimits(m, limits)}`.
  - `onClick={() => { onPick(m); onClose(); }}`.
- `<span className="popover-arrow" aria-hidden="true"/>`: a CSS triangle, or an inline svg in
  `var(--backgroundPrimaryElevated)`.

## T12. Note popover: new `apps/web/src/plan/MonthNotePopover.tsx`

```ts
export function MonthNotePopover(props: { note: string | null; onSave: (note: string | null) => void;
  onClose: () => void; triggerRef: RefObject<HTMLButtonElement | null> })
```

- `<div className="month-note-popover" role="dialog" aria-label="Month note">`, using `useDismiss(ref,
  onClose, triggerRef)`. Escape and outside clicks discard.
- The textarea:
  - `textarea.month-note-input` with `aria-label="Month note"`, `placeholder="Enter a note..."`, `autoFocus`
    and `rows={2}`;
  - value state initialised to `note ?? ""`;
  - `onInput`: `el.style.height = "auto"; el.style.height = Math.min(Math.max(el.scrollHeight, 44), 168) + "px"`.
- `onKeyDown`: Enter without Shift (and not `isComposing`) → `preventDefault()` and `save()`.
- `button.month-note-ok` "OK" → `save()`.
- `save()`: `const next = text.trim() || null; onClose(); if (next !== (note ?? null)) onSave(next);`
  Then focus the trigger.
- Do not use the global `.primary` class: it carries `margin-top`.

## T13. Header: new `apps/web/src/plan/PlanHeader.tsx` + `apps/web/src/plan/plan-header.css`

```ts
export function PlanHeader(props: { budgetId: string; month: Month; children?: ReactNode })
```

- Data:
  - `const current = localCurrentMonth();`
  - `const range = useMonthRange(budgetId);`
  - `const limits = navLimits(range.data, current);`
  - `const note = useMonth(budgetId, month).data?.note ?? null;`
  - `const { setMonth } = usePlanMonth();`
  - `const saveNote = useSetMonthNote(budgetId, month);`
- State: `open: "picker" | "note" | null`. Reset it to null when `month` changes (an effect on `month`).
- Markup: as the tree in design §3.
  - `prev` button: `onClick={() => setMonth(addMonths(month, -1))}`, `disabled={!canPrev(month, limits)}`.
  - `next` button: the same with `+1` and `canNext`; `title={canNext ? undefined : NEXT_DISABLED_TITLE}`.
  - Today (`button.today-button`) is rendered when `month !== current` and calls `setMonth(current)`.
  - The month button toggles the picker.
  - The note button opens the note popover; it shows `note ?? "Enter a note..."` with `title={note ?? ""}`.
  - `div.plan-header-totals` renders `{children}`, with the comment
    `{/* EXF-491: the Ready to Assign pill is passed as children */}`.
- `import "./plan-header.css"`.
- CSS: put the `:root` custom properties of design §4 at the top, then the rules. The values are in the
  design's Source section and in the study notes. No raw colours inside rules.
  - `.plan-header` overrides the shell padding to `0` and is `position: relative; z-index: 10`.
  - `.plan-header-calendar` is `display: flex; align-items: center; flex: 0 0 30%; padding: var(--space-2);
    position: relative`.
  - `.month-arrow`:
    - `width: 40px; height: 30px; line-height: 0; background: none; border: 0; padding: 0;
      color: var(--actionPrimary); cursor: pointer`;
    - the svg is 30px with `margin-left: 4px`;
    - `:hover:not(:disabled)` → `var(--actionPrimaryActive)`;
    - `:disabled` → `var(--actionPrimaryDisabled)` with `cursor: default` (no opacity).
  - `.plan-header-date`: a column with `padding: 0 var(--space-2)` and centred text.
  - `.plan-header h1`: margin 0, `line-height: 75%`.
  - `.month-button`:
    - inherits the font (21px/700 from the shell's `.page-header.plan h1`);
    - `display: flex; align-items: center; white-space: nowrap; background: none; border: 0; padding: 0;
      color: var(--labelPrimary)`;
    - the caret svg is 12px, `margin-left: 4px`, `color: var(--actionPrimary)`, and
      `var(--actionPrimaryActive)` on hover.
  - `.month-note`:
    - `display: block; width: 100%; max-width: 7rem; padding: 2px 0 0; font-size: var(--font-size-sm);
      font-weight: 500; line-height: var(--line-height); color: var(--labelSecondary)`;
    - `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center`;
    - underline on hover.
  - `.today-button`:
    - `margin-left: var(--space-3); min-height: 32px; padding: 6px var(--space-3); border: 0;
      border-radius: var(--radius-lg)`;
    - `background: var(--buttonSecondaryBackground); color: var(--buttonSecondaryLabel)`;
    - `font-size: var(--font-size-md); font-weight: 500`; hover → `--buttonSecondaryBackgroundActive`;
    - `transition: background-color .15s`.
  - Popovers (`.month-picker`, `.month-note-popover`):
    - `position: absolute; width: 224px; background: var(--backgroundPrimaryElevated);
      border-radius: 6.4px; box-shadow: var(--shadowMenu); z-index: 1`;
    - `top` is 15px below the trigger's bottom, and the popover is horizontally centred on its trigger.
      Compute `left` from the trigger's `offsetLeft` + `offsetWidth/2` - 112 in a `useLayoutEffect`, or with
      a CSS `left` in px measured once.
  - `.popover-arrow`: a 30×15 triangle at `top: -15px`, centred.
  - Picker:
    - `.month-picker-years`: `display: flex; justify-content: space-between; align-items: center;
      margin: 0 12.8px; padding: 4.8px 0; border-bottom: 1px solid var(--separatorStandard)`;
    - year: 17.6px/700;
    - year buttons: 40×32, radius 8px, `color: var(--actionPrimaryActive)`; hover background
      `var(--buttonSecondaryBackground)`.
    - `.month-picker-months`: `display: flex; flex-wrap: wrap; justify-content: center; width: 204px;
      margin: 4.8px 10px`.
    - `.picker-month`: `width: 46.75px; height: 40.66px; margin: 2px; padding: 4px 8px;
      border-radius: var(--radius-xs); font-size: var(--font-size-sm); font-weight: 600;
      color: var(--labelPrimary); background: none; border: 0`.
      - `:hover:not(:disabled)` → `--backgroundSecondaryElevated`.
      - `.is-current` → background `--backgroundSecondaryElevated`, colour `--actionPrimary`.
      - `.is-selected` (after `.is-current` in the file) → background `--buttonPrimaryBackground`, colour
        `--labelPrimary`; hover `--actionPrimaryActive`.
      - `:disabled` → colour `--labelTertiary`, transparent background, `cursor: default`.
  - Note popover:
    - content padding 12.24px 12.24px 0;
    - textarea: `width: 100%; box-sizing: border-box; height: 44px; min-height: 32px; max-height: 168px;
      margin-bottom: 8px; padding: 4px 8px; border: 1px solid var(--inputBorder);
      border-radius: var(--radius-xs); background: var(--inputBackground); color: var(--labelPrimary);
      font: 500 var(--font-size-sm) var(--font); resize: vertical; outline: none`;
    - actions: `display: flex; justify-content: flex-end; padding: 12.24px`;
    - OK: `min-height: 32px; padding: 6px var(--space-3); border-radius: var(--radius-lg); border: 0;
      background: var(--buttonPrimaryBackground); color: var(--labelPrimary); font-size: var(--font-size-md);
      font-weight: 500`; hover background `--buttonPrimaryBackgroundActive`.
- `div.plan-header-totals`: `flex: 0 1 auto`.

## T14. Page: `apps/web/src/pages/plan.tsx`

- Remove the `PageHeader` import and the inline label code.
- Render `<PlanHeader budgetId={budgetId} month={month} />`, followed by the comment
  `{/* EXF-500: the view chips row goes here, between the header and the grid */}`, then `div.plan-body`
  unchanged.
- Keep the `/budget` default, the invalid-month `Navigate`, `rememberMonth` and `usePageTitle("Plan")` as
  they are.

Verify: `pnpm e2e e2e/plan-urls.spec.ts e2e/plan-grid.spec.ts e2e/shell-compare.spec.ts` all pass
unchanged.

## T15. E2E: new `e2e/month-nav.spec.ts`

- Imports: `test` and `expect` from `./fixtures`; `authHeaders` and `testName` from `./support/auth`.
- Create one plan per test (or per `describe` with `beforeAll`) via `POST /api/v1/budgets`, and delete it
  afterwards (see `plan-grid.spec.ts`).
- Compute `M`, `M±n` in local time, as `plan-urls.spec.ts` does; reuse its `monthLabel` and ISO helpers.
- Never assume an empty database.
- Write one test per design acceptance case 1, 2, 3, 4, 5 (browser part), 6, 8 and 9.
  - **Case 5:** `page.route("**/api/v1/budgets/*/month-range", r => r.fulfill({ json: { data: {
    first_month: <M ISO>, last_assigned_month: <M+1 ISO> } } }))` before `goto`.
  - **Case 8:** read `getComputedStyle(note).textOverflow === "ellipsis"` and
    `scrollWidth > clientWidth` with `evaluate`, and check that `title` is the full text. Reload, then
    re-check.
  - **Case 9:** the API `note` is `null` after a whitespace save: `request.get(…/months/<iso>)` with
    `authHeaders()`.
  - **Case 7 (look):** assert the computed colours named in the design on the prev arrow (enabled), on the
    next arrow at M+1 (disabled) and on the note line. Also assert sizes: arrow 40×30 and note `max-width`
    112px.
- Locators:
  - `getByRole("button", { name: "Previous month" })` and `{ name: "Next month" }`;
  - `getByRole("heading", { level: 1 })`;
  - `getByRole("dialog", { name: "Choose month" })`;
  - `getByRole("button", { name: "Dec 2026" })` (built from the computed months);
  - `getByRole("button", { name: "Today" })`;
  - `getByRole("textbox", { name: "Month note" })`.
- Verify: `pnpm e2e e2e/month-nav.spec.ts --repeat-each=3`.

## T16. Finish

- `pnpm check` passes.
- `pnpm e2e e2e/month-nav.spec.ts e2e/plan-urls.spec.ts e2e/plan-grid.spec.ts e2e/shell-compare.spec.ts`
  passes.
- `git diff --name-only origin/main` lists only manifest files.
- Run the design's compare cases (3, 6, 7, 10) against this Thread's source tab with the dev server. Never
  save a note in the source.
