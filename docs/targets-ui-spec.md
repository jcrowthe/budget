# Targets on the Plan page: implementation spec (EXF-508, EXF-514, EXF-592)

Design: [targets-ui-design.md](targets-ui-design.md). It holds the rules and the exact strings; this file holds
the tasks. Follow `docs/conventions.md`. Run `pnpm check` after each group of tasks; run only your own specs with
`pnpm e2e e2e/targets-*.spec.ts e2e/plan-selection.spec.ts e2e/plan-panel.spec.ts e2e/assigned.spec.ts`.
Never edit the out-of-bounds files of the Lead's note 9, `paths.always_overlap`, `openapi.test.ts`,
`mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`, `mcp-descriptions.test.ts` or
`e2e/mcp.spec.ts`. No new dependency. No migration.

## 1. Core: `targetBar` (`packages/core/src/targets.ts`)

```ts
export interface TargetBar { sections: Milliunits[]; fill: Milliunits }
export function targetBar(t: TargetMonth, leftover: Milliunits): TargetBar
```

Rules: the design's table. `n = needed_this_month / definition.amount` for weekly (an integer by construction).
`fill` is never negative. Do not touch `computeTargetMonth` or any other export.

Verify, in `packages/core/test/targets.test.ts` (computing `t` with `computeTargetMonth` from the engine
design's examples): monthly set aside Dec L 70000 A 0 → `{ sections: [70000, 100000], fill: 70000 }`; Nov A
40000, L 0 → `{ [100000], 40000 }`; weekly 25000 Saturday (created 2026-11-15) Dec L 40000 →
`[40000, 25000×4]`, Jan L 40000 → `[40000, 25000×5]`; Nov L 0 → `[25000, 25000]`; refill Nov L 50000 A 50000 →
`{ [100000], 100000 }`; yearly 1200000 Nov A 100000 → `{ [1200000], 100000 }`; balance 600000 by 2027-04, V
150000 → `{ [600000], 150000 }`; balance with V −10000 → fill 0; weekly created on 2026-11-29 → `sections: []`.

## 2. Schema (`packages/schema/src/targets.ts`)

- Split `TargetSet` into a field shape and one exported refinement `checkTargetCombination(v, ctx)`;
  keep `TargetSet`'s behaviour and messages. Add `TargetBody = z.object(fields).superRefine(check)
  .openapi("TargetBody")` (no ids) and its input type. Give `amount` the message "amount must be greater than 0".
- `Today = IsoDate.refine(real calendar date 1900–2199, "today must be a real date, YYYY-MM-DD")`.
- `TargetResponse = dataEnvelope(z.object({ target: Target }))`, `TargetDeletedResponse =
  dataEnvelope(z.object({ deleted: Target }))`.

Verify in `packages/schema/test/targets.test.ts`: `TargetBody` accepts each valid kind of the design and refuses
weekly fill_up, weekly without day_of_week, monthly with due_date, yearly without due_date, custom refill,
custom balance with due_date or repeat, custom set_aside without due_date, amount 0, day_of_week 7,
repeat.every 12; `Today` refuses `2026-02-30` and `26-11-01`.

## 3. Wording (`packages/schema/src/target-wording.ts`, new, pure)

```ts
type TargetCategory = Pick<MonthCategoryDetail, "carried" | "assigned" | "activity" | "available"> &
  { target: CategoryTargetMonth | null };
export const targetMoney: (m: number) => string;            // "$1,200.00", minus U+2212 (same as web `money`)
export const ordinal: (n: number) => string;                // 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd 31st
export function targetStatusText(c: TargetCategory): { amount: string | null; text: string } | null;
export function targetPill(c: TargetCategory): { tone: "zero"|"positive"|"negative"|"cautious";
  icon: "clock"|"check"|"clockCheck"|null; title: string };
export function targetHeading(t: CategoryTargetMonth): { heading: string; subheading: string };
export function targetMessage(c: TargetCategory): { tone: "cautious"|"positive"; text: string;
  assign: number | null } | null;
export function targetDonut(c: TargetCategory): number | null;
export function targetBreakdown(c: TargetCategory): { label: string; amount: number; rule: boolean }[];
export const targetEmptyText: (name: string) => { question: string; body: string };
export type FormTab = "weekly" | "monthly" | "yearly" | "custom";
export function behaviorOptions(tab: FormTab, amount: number): { value: TargetBehavior; title: string;
  use: string; tagline: string | null; badge: string | null }[];
```

- `targetStatusText` returns null without a target, for `snoozed`, and when available < 0 (the row then keeps
  `statusLabel`). `text` excludes the bold amount: `{ amount: "$60.00", text: " more needed by the 10th" }`;
  `{ amount: null, text: "Funded. Spent $30.00 of $100.00" }`.
- `targetPill` without a target (or `eventually`, or available < 0) returns the current pill: tone by sign and
  the current `pillTitle` text (move it here from `plan/format.ts` and re-export it there).
- Dates are formatted in UTC from ISO strings: "Oct 31 2027", "Apr 2027", "October of 2027", "December 31st".

Verify with `packages/schema/test/target-wording.test.ts`: one `it.each` table, each row `{ name, target
(definition + figures), carried, assigned, activity, available, month }` → the expected strings. The rows must
produce every string quoted in EXF-514 (list them in the file in the ticket's order, with a comment naming the
ticket line), the form copy of the design's Source section, and these extra cases: available < 0 → null status
text and the red pill; `complete` → "Funded", no donut, no message; weekly funded → no donut; funded at $0.00 →
grey pill; repeat every 1 month → "… Every Month". Build the figures with the real `computeTargetMonth` only in
core's test; here write the figures literally (schema does not import core).

## 4. Form state (`packages/schema/src/target-form.ts`, new, pure)

```ts
export interface TargetDraft {
  tab: FormTab; amount: number; periodic: "set_aside" | "refill";
  custom: "set_aside" | "fill_up" | "balance"; dayOfWeek: number; dayOfMonth: number | null;
  yearlyDate: string; customDate: string;             // MM/DD/YYYY as typed
  repeat: boolean; every: number; unit: "month" | "year";
  dueBy: boolean; dueMonth: number; dueYear: number;  // 0..11, full year
}
export function newDraft(today: string): TargetDraft;
export function draftFromTarget(def: TargetDefinition, today: string): TargetDraft;
export function draftToBody(d: TargetDraft, today: string):
  { body: TargetBody } | { errors: { amount?: string; date?: string } };
export const WEEKDAYS: readonly string[];           // Sunday..Saturday
export function dayOfMonthOptions(): { value: number | null; label: string }[]; // Last Day of Month, 31st..1st
export function yearOptions(today: string): number[];                            // 50, from today's year
export function unitOptions(every: number): { value: "month" | "year"; label: string }[];
```

Dates parse with `parseEntryDate` and format with `formatEntryDate` (`date-entry.ts`). Verify in
`packages/schema/test/target-form.test.ts`: `newDraft("2026-11-15")` (dates `12/01/2026`, Saturday, last
day, dueMonth 11 / 2026); `newDraft("2026-12-31")` → `01/01/2027`, dueMonth 0 / 2027, years 2026…2075;
round trip `draftToBody(draftFromTarget(def))` returns the same body for one definition of every kind;
amount 0 → amount error; `13/45/2026` → date error; balance with dueBy off → `due_month: null`; repeat off →
`repeat: null`; `unitOptions(1)` Month/Year, `unitOptions(3)` Months/Years.

## 5. Worker

1. `services/targets.ts`: `deleteTarget` returns the deleted `Target` (`targetToApi(before)`). Nothing else.
2. `services/months.ts`: `getMonthSummary(env, budgetId, month, categoryIds?, today = todayUtc())` passes
   `today` to `getPlanMonth`.
3. `routes/targets.ts` (new, tag "Targets"): `PUT` and `DELETE /budgets/{budget_id}/categories/{category_id}/target`
   (params as in `routes/categories.ts`; PUT body `TargetBody`, query `{ today: Today.optional() }`). Non-UUID
   ids → 404 "Plan"/"Category" (as `month-categories.ts` does). The `defaultHook` returns 422 with the joined
   messages; also catch a `ZodError` from the service and answer 422 (the global handler would say 400).
   PUT → 200 `{ data: { target } }` with `setTarget(env, actor, { budget_id, category_id, ...body },
   { today })`; DELETE → 200 `{ data: { deleted } }`. Declare 403/404/409/422.
4. `routes/months.ts`: the month GET and the summary GET take `query: { today: Today.optional() }` (summary
   alongside `category_ids`) and pass it on.
5. `mcp/tools/targets.ts` (new): `set_category_target` (input: `budget_id`, `category_id` as `Id`, the
   `TargetBody` fields, `today` optional) → `{ target }`; `delete_category_target` (`budget_id`,
   `category_id`) → `{ deleted }`. Descriptions: "Returns { target } …", `MONEY`, `DATE`, `MONTH`, that it
   creates or replaces and keeps the first creation date, that `today` (default: the server's UTC date) sets
   the creation month, and one sentence per kind: weekly (amount per `day_of_week`, 0 = Sunday), monthly (by
   `day_of_month`, null = last day), yearly (by `due_date`, every year), custom set_aside/fill_up (by
   `due_date`, optional `repeat` every 1–11 months or years), custom balance (reach `amount` by `due_month`, or
   eventually with none).
6. `mcp/tools/months.ts`: `get_plan_month` and `get_month_summary` take `today` (`DATE` in the description:
   "today decides the current month for target figures; default the server's UTC date").
7. `test/mcp-coverage/targets.ts` (new): `"PUT /budgets/{budget_id}/categories/{category_id}/target": { tool:
   "set_category_target" }` and `"DELETE …/target": { tool: "delete_category_target" }`.

Verify with `apps/worker/test/target-routes.test.ts`: `apiPaths()` contains the target path; `listedToolNames()`
contains both tools; PUT creates (200, `created_month`), PUT again replaces and keeps `created_on`, DELETE
returns the old target and a second DELETE is 404; one 422 per refusal of task 2 through REST with a non-empty
`error.detail`; `today=2026-02-30` → 422; unknown category 404; `change_log` rows `create`/`update`/`delete`
with `user:` actor (REST) and `mcp:` actor (MCP tool calls); MCP `set_category_target` then REST month read
deep-equals MCP `get_plan_month` with the same `today`; last evening: PUT `?today=2026-11-30` → `created_month`
`2026-11-01`, Nov read has `target` non-null with `today=2026-11-30`; refill 100000, Nov assigned 70000, Dec
read: funded = Dec assigned with `today=2026-11-30`, = 70000 + Dec assigned with `today=2026-12-01`;
summary with `today` equals summary without it.

## 6. Web API

- `api/months.ts`: `getMonth` appends `?today=${localToday()}` (import `localToday` from `./accounts`; do not
  edit that file). Query keys unchanged.
- `api/targets.ts` (new): `putTarget(budgetId, categoryId, body)`, `deleteTarget(budgetId, categoryId)` (with
  `?today=`, `Idempotency-Key`, `TargetResponse` / `TargetDeletedResponse`); `useSaveTarget(budgetId)` and
  `useDeleteTarget(budgetId)`: `onMutate: beginWrite`, `onSettled: endWrite`. No optimistic write.

## 7. Web Plan page (`apps/web/src/plan/**`)

1. `icons.tsx`: the icons listed in the design (own 16 px SVGs; caret 9 px; calendar 12 px).
2. `Popover.tsx`: optional `placement?: "below" | "above"` (default below). Above: box bottom = anchor top − 15,
   arrow on the bottom edge pointing down; flips below when there is no room. Existing callers unchanged.
3. `shortcuts.ts`: add `.target-form` to `IGNORED`.
4. `format.ts`: `Segment.kind` gains `"cautious"`; `pillTitle` re-exported from `target-wording`.
5. `ProgressBar.tsx`: props `sections: { pct: number; parts: Segment[] }[]`; renders `<figure class=
   "progress-bar">` with one `.progress-section` (width pct) per section, each with its parts. `barSegments`
   becomes one 100 % section. New `targetSections(c)` in `format.ts`: from `targetBar(c.target, c.carried)`,
   distribute `fill` over the sections left to right; inside the fill, the first `spent` milliunits are kind
   `spent`, the rest `cautious` when status is `underfunded`, else `funded`. Each `.progress-section` has
   `data-pct` (one decimal) for tests.
6. `rows.tsx` `CategoryRow`: when `c.target` is set and `bars` on, the status is `<span class="status-label">
   <strong>{amount}</strong>{text}</span>` from `targetStatusText` (fallback `statusLabel`); the bar uses
   `targetSections`. `AvailablePill` takes optional `tone`, `icon`, `title` (from `targetPill`); class
   `available-pill cautious` = `--statusCautious` on `--categoryBalanceCautiousLabel`; the icon (14 px) precedes
   the amount. Display pills (inspector) take the tone too.
7. **EXF-592**: `CategoryRow`'s name button calls `onNameClick(anchor)`. In `PlanGrid`: if
   `selection.ids` is exactly `[c.id]` → `setPop({ kind: "edit-category", categoryId: c.id, anchor })`; else
   `onSelection(() => selectOnly(c.id))`.
8. `panel/PlanPanel.tsx`: pass `month` to `CategoryInspector`; `collapsed` gains `target`.
9. `panel/TargetCard.tsx` (new), rendered by `CategoryInspector` before `NotesCard` with
   `key={category.id}`. State: `mode: "closed" | "form"`, the draft, `pendingSince: number | null`. Shows:
   - closed, no target: `PanelCard` "Target" (collapsible, id `panel-target`) with `<strong>` question, `<p>`
     body, secondary button **Create Target** → form with `newDraft(localToday())`, amount input focused.
   - closed, target: `PanelCard` "Target" + `TargetRingIcon`; heading (`h3`) and subheading; donut (SVG, 64 px,
     `role="img"`, `aria-label="{n}% funded"`, centre text `{n}%`) when `targetDonut` is a number; the message box
     (`role="status"`, class by tone) with **Assign** when `assign` is set; the breakdown rows (a `<hr>` before
     rows with `rule`); secondary **Edit Target** → form with `draftFromTarget`.
   - form: `TargetForm`. Save → `draftToBody`; errors show under the field (`aria-invalid`, `role="alert"`);
     else `useSaveTarget` and set `pendingSince = Date.now()`. Delete → with a target `useDeleteTarget`, else
     close. Cancel → close. While pending all controls are disabled and the card has `aria-busy="true"`; when
     the month query's `dataUpdatedAt > pendingSince` and the mutation has succeeded, close the form. A failed
     mutation shows "Couldn't save the target." / "Couldn't delete the target." and re-enables the form.
   - Assign → `useCommitAssigned(budgetId, month, onError)` with `(c.id, c.assigned, c.assigned + assign)`;
     disabled until `dataUpdatedAt` passes the click time.
10. `panel/TargetForm.tsx` (new), root `<div class="target-form">`: tablist (four `role="tab"` buttons,
    `aria-selected`, ←/→ move); `dl` blocks with `dt` labels and controls per the design's Source section.
    Amount: `TargetAmountField` — input `aria-label="Target Amount"`; unfocused it shows `money(amount)`;
    focused it shows the raw text (empty for 0); on blur `evaluateAssigned(text, amount)` sets the draft
    amount; the inert calculator button of `AssignedCell` (reuse `Calculator`; export it). Native `<select>`s
    with `aria-label`s "Select Day of Week", "Select Day of Month", "Select Interval", "Select Unit of Time",
    "Select Month", "Select Year". Escape on the root (not `defaultPrevented`) → `preventDefault()` + Cancel.
    Footer `.target-actions`: Delete (trash, left), Cancel, Save Target; `flex-wrap` so that at a 280 px panel
    Delete wraps above and Cancel + Save stay on one line.
11. `panel/BehaviorDropdown.tsx` (new): a button (`aria-haspopup="listbox"`, label from its `dt`, caret) showing
    the selected option's title; opens a `Popover` (`placement="above"`, width = the button's width, label
    "I want to" or the dt text) with `role="listbox"` and `role="option"` items (`aria-selected`), title, "Use
    for: …" line, tagline, badge, check-circle on the selected one, 1 px rules. Click or Enter chooses; ↑/↓ move;
    Escape closes only the popup (`preventDefault`, focus back on the button).
12. `panel/TargetDateField.tsx` + `panel/TargetCalendar.tsx` (new): text input `placeholder="MM/DD/YYYY"`
    (`aria-label` = its label), calendar icon button (`tabIndex=-1`); a click on the input opens a 256 px
    `Popover` (`placement="above"`, `role="dialog"`, label "Calendar"): "Previous month" / "Next month" buttons,
    title from `monthTitle`, Su–Sa, the `monthGrid` days (other months `--labelTertiary`), the field's date
    filled `--buttonPrimaryBackground`. A day click sets the text and closes. Escape → closes the calendar and
    cancels the form (source).
13. `panel/Switch.tsx` (new): `<button role="switch" aria-checked>` 40×24 track, knob r 10, label text after.
14. `panel/target.css` (new; imported by `TargetCard`): the custom properties of the design in `:root` and the
    measured sizes and colours of the design's Source section (card padding 16, segmented control, inputs,
    buttons, popup, badge, switch). No raw colours outside the `:root` block.

## 8. Docs

- `docs/plan-panel-design.md`: in "Name click", say that a click on the name of the one selected category opens
  its edit popover (EXF-592), and add under it: "Deliberate difference (EXF-592 point 2): the source also
  focuses the row's Assigned input when a row is selected by click or ↑/↓. We don't: the editor commits on
  blur and on ↑/↓, so every arrow press would become a possible write, and Escape and Ctrl+A would need to
  tell an unedited field from one being typed in." Remove "opening the Assigned editor on a name click or ↓"
  from Out of scope only if you reword it the same way.
- `docs/README.md`: one line for the design (already added by the Architect).

## 9. E2E

Shared: `e2e/targets.fixtures.ts` — `seedTargetPlan(request, label)` (reuse `seedPlan` from
`plan-panel.fixtures.ts`), `putTarget(request, plan, cat, body, today)`, `assign(request, plan, month, cat,
milli)`, `spend(request, plan, account, cat, milli, date)`, `mcpCall(request, tool, args)`, `realMouse(page,
locator)` (centre, `elementFromPoint` topmost, `page.mouse.click`), `utcToday(clockMs)`. Every spec: `test.use({
timezoneId: "UTC" })` (except the last-evening spec), `page.clock.setFixedTime(T0)` with `T0 = Date.now()` taken
once per test, and all `today` values from `T0`. After a click that writes, `expect.poll` the API before reading
it.

- `e2e/targets-form.spec.ts`: design cases 1–6 and 16 (also at 1024×700).
- `e2e/targets-display.spec.ts`: cases 8–12 and 14. Use `day_of_month: 10` for monthly targets so strings do
  not depend on the month's length; yearly `due_date` = the last day of month M+11 (k = 12, needed 100.00);
  read section widths from `data-pct`.
- `e2e/targets-today.spec.ts`: case 7 (`timezoneId: "America/Los_Angeles"`; hold the PUT with
  `page.waitForRequest` and read its `today`).
- `e2e/plan-selection.spec.ts`: case 15; remove name clicks on an already selected single category in "keys
  typed in a field leave the selection alone" (lines 112 and 121 today) or replace them with the expected
  popover; run every Plan spec and fix any other such click the same way.

## 10. Carry-over tasks (design "Carry-over", cases 18–23)

The code is merged and `pnpm check` passes. Run the specs first (Done when). Then add only these:

1. **`today` refusals** (case 18): `apps/worker/test/target-routes.test.ts`, one `it.each` over `["nope",
   "2026-11-1", "2026-02-30", "2300-01-01"]` × {GET month, GET summary, PUT target}: status 422 and `error.detail`
   containing "today must be a real date". MCP `get_plan_month` / `set_category_target` with `today: "nope"`:
   `isError` true. After the bad PUT, the month read has `target: null`. Accepted extremes: PUT with
   `?today=1990-01-15` → `created_month` `1990-01-01`; a new category with `2150-06-30` → `2150-06-01`.
2. **Split** (case 22): same file. Seed like `splits.test.ts` (account via `POST …/accounts`, categories
   found by name in the month read). PUT a monthly set_aside 100000 target on Groceries, PATCH Assigned
   100000, `POST /api/v1/budgets/{bid}/transactions` with `amount: -100000, subtransactions: [{amount:
   -60000, category_id: groceries}, {amount: -40000, category_id: dining}]` (expect 201). Read the month with
   `today`: Groceries `activity` −60000, `target.funded` 100000, `target.status` "funded", and
   `targetStatusText(groceries)` from `@budget/schema/target-wording` gives `{ amount: null, text: "Funded.
   Spent $60.00 of $100.00" }`. A second plan with a plain −60000 Groceries transaction: `toEqual` the same
   `target` object (ids aside). Do not touch transactions files.
3. **Tool text** (case 21): `apps/worker/src/mcp/tools/targets.ts`, split the "Kinds: …" sentence into one
   sentence per kind (weekly; monthly; yearly; custom set aside / fill up; custom balance). Keep the
   `MONEY`, `DATE` and `MONTH` text and "Returns { target }". `mcp-descriptions.test.ts` must still pass; never
   edit it.
4. **Assign follows everywhere** (case 19): `e2e/targets-display.spec.ts`, "Assign meets the target…": read the
   Ready to Assign amount before the click, then without reload expect it lower by exactly $60.00. Also expect
   the inspector's Assigned row and Available row, and the grid pill, to read `$100.00`. No code change is
   expected: `TargetCard` already calls `useCommitAssigned`.
5. **Plan switch** (case 20): new test in `e2e/targets-display.spec.ts`. Copy `onlyOurPlans` and `switchTo`
   from `e2e/plan-switch.spec.ts` (do not edit it or import from it); two `seedPlan`s, `removePlan` both in
   `afterEach`, `page.unrouteAll` first. If it fails, the fix goes in `apps/web/src/plan/panel/**` only:
   the card's data must come from `useMonth`, whose `keepPreviousInPlan` already drops another plan's month.
6. **Narrow** (case 23): extend "at 1024 by 700…" in `e2e/targets-form.spec.ts` with the listed controls; pick
   the calendar day and the options with `realClick`, then check the stored body with `expect.poll`
   (`{cadence: "custom", behavior: "balance", due_month}` for the last one).
7. **Stable clicks**: in `e2e/targets.fixtures.ts`, re-export `realClick` from `./support/register-seed`
   instead of `./support/real-click` (it waits until the box is still). Neither support file is edited.

Verify: `pnpm check`; `pnpm e2e e2e/targets-form.spec.ts e2e/targets-display.spec.ts e2e/targets-today.spec.ts
e2e/plan-selection.spec.ts e2e/plan-grid.spec.ts e2e/month-nav.spec.ts e2e/plan-panel.spec.ts
e2e/assigned.spec.ts --repeat-each=3`.

## Done when

`pnpm check` passes; the specs above pass with `--repeat-each=3`; the out-of-bounds files are unchanged
(`git diff --stat origin/main -- apps/web/src/register apps/web/src/account apps/web/src/shell
apps/web/src/reflect apps/web/src/api/transactions.ts apps/web/src/api/payees.ts apps/web/src/api/accounts.ts
apps/web/src/api/reports.ts` is empty); the report lists the strings count of `target-wording.test.ts`.
