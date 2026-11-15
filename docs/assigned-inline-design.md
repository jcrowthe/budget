# Assigned inline edit design (EXF-489)

This Build makes the Assigned cell of every category row in the Plan grid editable. You click it, type an amount
or simple arithmetic, and commit with Enter, Tab, ↑/↓ or a click elsewhere. It also adds the REST route and the
MCP tool that set one category's Assigned amount for a month. Both go through the existing `setAssigned` service.
After a commit the grid shows the new Assigned and Available, the group subtotals and Ready to Assign at once,
with no reload.

## Source

The source was studied live in the "Test Budget" Plan: dark theme, current month, viewport 1600×813. Study notes
and screenshots (grid only, sidebar cropped) are in `/workspace/scratch/source/assigned-inline/`. The files are
`notes.md`, `01-hover-closed.png`, `02-open-selected.png`, `03-open-zoom3x.png`, `04-typed-plus50.png` and
`05-typed-400-zoom3x.png`. Nothing was committed in the source: every edit was discarded with Escape. Commit
behaviour (keys, arithmetic, effects) comes from the ticket, as the Lead directs.

- **Closed / hover.** A right-aligned 116×24 box (1px transparent border, 4px radius) in the 132×44 cell; the
  amount is a focusable `<button>` (14px/500, tabular, zero `#c4c5cf`, else `#fff`, `cursor: text`). Hover: 1px
  `#7583ff` border, `#0c0d22` background, and an 18×22 calculator icon (+ − × ÷ glyph, fill `#727484`) fades in
  at the box's left.
- **Open.** A plain `<input type="text">` replaces the amount: border `#545bfe` (`#7583ff` while hovered), no
  focus ring, transparent input, 0 3px padding, white right-aligned text; value "0.00" (no currency sign), fully
  selected; the icon stays (`tabindex=-1`, `aria-hidden`).
- **Typing.** A digit replaces the selection; an operator typed first appends (`0.00+50`); nothing is evaluated
  while typing. Escape discards and focus goes to `<body>`.
- **Row.** Checkbox → name (focusable `<button>`) → Assigned → Activity → Available pill (`<button>`, `disabled`
  at $0.00). Group subtotals are not editable. The source also checks the row and paints it `#1b1d48`; this grid
  has no selected style yet, so that is EXF-498's (Lead note 6).
- **Commit behaviour (ticket).** Keys and arithmetic as listed in the ticket; negative amounts allowed; Ready to
  Assign moves by the opposite of the change.

## Approach

1. **API.** A new route file and a new tool file call a new small service, `setAssignedAndRead`. It runs
   `setAssigned` (unchanged, writes the history row), then `getPlanMonth` (unchanged), and returns the
   category's month numbers and the month's `ready_to_assign`. The read is a second query after the write's
   batch, not atomic with it. A concurrent write between the two shows up in the answer, which is acceptable for
   a single-user app. The schemas go in a new `packages/schema/src/month-categories.ts`.
2. **Pure editing logic** goes in `packages/schema/src/assigned-edit.ts`: the parser, the input formatter, and
   the optimistic month update. It lives there, not in `apps/web/src/plan/`, because the root
   `vitest.config.ts` only runs `packages/*/test/**`, `scripts/test/**` and the Worker. Adding the web app to it
   would edit an `always_overlap` file. `packages/schema` has a unit-test folder, is importable from web and
   Worker (`@budget/schema/assigned-edit`), and is not `packages/core` (held by another Build).
3. **Grid.** A new `AssignedCell` component renders the closed box and the open input. `PlanGrid` owns which
   category is being edited (one at a time) and the visible order of categories for ↑/↓. `rows.tsx` passes
   these through. The category name becomes a focusable (inert) button, as in the source, so Shift+Tab has
   somewhere to go.
4. **Cache.** A commit writes the new numbers into the cached month at once (optimistic), sends the PATCH, then
   invalidates every cached month of the plan. A failure puts the old value back and shows a short alert.

## What changes

### REST: `PATCH /api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}`

**Request.** The body is `AssignedUpdate`: `{ "assigned": <integer milliunits> }`. Negative amounts are
allowed. The route honours `Idempotency-Key` (global middleware).

**Response 200.** `AssignedResultResponse`:

```json
{ "data": { "category": { "id": "<uuid>", "month": "2026-11-01", "assigned": 400000,
                          "activity": 0, "available": 400000 },
            "ready_to_assign": -400000 } }
```

Values come from `getPlanMonth` after the write, so `available` includes carry-over and activity.

**Errors.** All use the standard `{ error: { id, name, detail } }` envelope.

| Case | Status |
|---|---|
| Unknown plan, deleted plan, or non-UUID `budget_id` | **404** `not_found` |
| Unknown category, deleted category, category of another plan, or non-UUID `category_id` | **404** `not_found` |
| `month` not a first day (`2026-11-15`), malformed, or year outside 1900–2199 | **422** `unprocessable_entity` |
| `assigned` missing, not a number, not an integer (`1.5`), or not a safe integer | **422** `unprocessable_entity` |
| Malformed JSON | 400 (framework) |
| Lost the guarded-write race five times | 409 `conflict` (from `setAssigned`) |

The route has its own `defaultHook` that returns 422 on validation failures, like `routes/months.ts`. It checks
UUIDs itself and throws `NotFound`, so `setAssigned`'s `z.uuid()` parse never turns a bad id into a 400.

**History.** There is one `change_log` row per call: `entity_type 'month_category'`, `action 'update'`,
`entity_id '<category_id>:<month>'`, before/after `{month, category_id, assigned}`. The actor is the request's
(`user:<email>`). This is all existing `setAssigned` behaviour.

### MCP: `set_assigned`

The input is `{ budget_id: string, month: <first day>, category_id: string, assigned: <integer milliunits> }`.
It returns the same object as the REST `data` (`{ category, ready_to_assign }`). It calls the same service with
the server's actor (`mcp:<identity actor>`), so its history row differs from REST only in the actor. A missing
plan or category is a tool error (`isError`) whose text contains "not found".

### Pure logic (`@budget/schema/assigned-edit`)

- `evaluateAssigned(text: string, before: Milliunits): Milliunits`:
  1. Remove every comma and all whitespace. Map `x`, `X` and `×` to `*`, `÷` to `/`, and `−` (U+2212) to `-`.
     Remove one leading `$` if present.
  2. If the text then starts with `+`, `*` or `/`, prefix the amount before the edit, written as a decimal
     ("400"). A leading `-` is a negative number, not a continuation: the field's own text starts with `-`
     whenever the amount before was negative ("-12.00+5" must give −7.00). The ticket's "50.00 then -10 →
     40.00" happens in the cell: an operator typed over the fully selected value appends to it, so the parser
     sees `50.00-10`. *(The Lead's note listed `-` among the continuing operators. This is the one deliberate
     difference, made for the negative-value case.)*
  3. Grammar: `expr := term (('+'|'-') term)*`, `term := factor (('*'|'/') factor)*`,
     `factor := '-'? number`, `number := \d+(\.\d*)? | \.\d+`. Precedence is standard and evaluation runs left to
     right. There are no parentheses.
  4. Empty text, text that does not match the whole grammar, division by zero, a non-finite result, or a result
     beyond ±(2^53−1) milliunits all give **0**.
  5. Rounding goes to cents, half away from zero (half up for positives): `12.345` gives 12350, and `-12.345`
     gives −12350. The result is in milliunits (always a multiple of 10).
- `formatAssignedInput(m: Milliunits): string`: the field's initial text. It uses en-US grouping, exactly two
  decimals and an ASCII `-`: 0 gives `0.00`, 400000 gives `400.00`, 1234500 gives `1,234.50`, −12000 gives
  `-12.00`.
- `applyAssigned(detail: MonthDetail, categoryId: string, assigned: Milliunits): MonthDetail` returns a new
  object. With `delta = assigned − old`:
  - The category's `assigned` and `available` change by +delta.
  - Its group's `assigned` and `available` change by +delta.
  - `ready_to_assign` changes by −delta, and `rta_breakdown.assigned_in_month` changes by −delta (it is stored
    negated).
  - An unknown id returns `detail` unchanged.
  - Target fields are not recomputed: the refetch brings them.

### Web API (`apps/web/src/api/assigned.ts`)

- `setAssignedAmount(budgetId, month, categoryId, assigned)` sends the PATCH with a fresh `Idempotency-Key` and
  parses `AssignedResultResponse`.
- `useCommitAssigned(budgetId, month, onError)` returns `commit(categoryId, before, after): Promise<void>`,
  resolving once the optimistic write is in the cache (steps in spec T7). On error it re-applies `before` only
  if the cache still shows `after` (an inverse update, so a later edit of another category survives), then calls
  `onError`. On settle it invalidates `["month", budgetId]`: every cached month of the plan, because Assigned in
  one month changes later months' rollover and RTA, and `assigned_in_future` changes earlier months' RTA.

### Grid (user-visible)

- **Category rows.** The Assigned cell is an `AssignedCell`.
  - **Closed:**
    - A `.assigned-box` holds the calculator icon button: `tabindex=-1`, `aria-hidden`, opacity 0 except on
      hover/editing, and inert (its `mousedown` is prevented so it never steals focus).
    - Next to it is a focusable `<button class="amount[ zero]">` showing `money(assigned)`. It keeps the
      `.amount` class, so `e2e/plan-grid.spec.ts`'s 22-amount count still holds.
    - Clicking the box or the amount, or pressing Enter/Space on the amount button, opens the cell.
  - **Open:**
    - The amount button is replaced by an `<input type="text" aria-label="Assigned for <category name>"
      autocomplete="off" spellcheck=false>`.
    - Its value is `formatAssignedInput(assigned)`, and it is focused with all text selected.
    - The box gets the `is-editing` class: border `--inputBorderActive` `#545bfe`, or `#7583ff` while hovered,
      background `#0c0d22`, and the icon visible.
- **Group and Uncategorized rows** are unchanged and not editable.
- **Keys and pointer while open.** "Commit" means `evaluateAssigned(text, before)`. No request is sent when the
  text is still the initial text, or when the result equals `before`. A guard ref makes sure only the first
  closing path of an open cell commits.

  | Input | Effect |
  |---|---|
  | Digit/other char | Normal typing (replaces the selection when all is selected) |
  | `+ - * / x X` while the whole non-empty value is selected | Collapse the selection to the end first, so the char is appended (`400.00+50`) |
  | Enter | Commit, close; focus goes to `<body>` |
  | Escape | Discard, close; focus to `<body>`; `stopPropagation` (EXF-498's second Escape clears selection) |
  | Tab | `preventDefault`; commit, close, then focus this row's Available pill once it is enabled (see below) |
  | Shift+Tab | `preventDefault`; commit, close, focus this row's category-name button |
  | ↓ / ↑ | `preventDefault`; commit, then open the next/previous visible category (across groups, skipping group rows, collapsed groups' and hidden categories); at the last/first category commit and close |
  | Blur (click elsewhere) | Commit, close |

  **Tab focus.** `PlanGrid` keeps a focus request `{categoryId, target: "available"}`. It sets the request after
  `commit()` resolves. The row's effect focuses the pill when the request matches the row and the pill is not
  disabled, then clears the request. Opening any cell clears it, and it expires after 1 s. If the pill stays
  disabled (Available still $0.00), focus stays on `<body>`. The source would go to the next focusable control
  there; that is a documented minor gap.
- **Category name.** It becomes `<button type="button" class="category-name">`. It is inert until EXF-494's
  rename popover, and its look is unchanged (button chrome reset in CSS).
- **Failure.** A `role="alert"` message, "Couldn't save the assigned amount.", appears in `.grid-notice` at the
  top of the grid body. It shows for 5 s or until the next commit. The cell shows the old value again.
- **Months.** Editing works the same in past, current and future months. `month` is the `PlanGrid` prop.

### CSS (`plan-grid.css`)

- New custom properties in the top block: `--inputBorderActive: #545bfe` and `--iconFillSecondary: #727484`.
- New and changed rules:
  - `.category-row .assigned-box`: flex, space-between, align centre, padding 0, cursor auto.
  - Hover and `.is-editing` box states.
  - `.calculator-button`: 18×22, opacity transitions, no chrome.
  - `.assigned-input`: transparent, no border, no outline, 0 3px padding, inherit 14px/500 tabular,
    `--labelPrimary`, right-aligned, `width: 100%`, `min-width: 0`.
  - `.assigned-box .amount`: button reset, 3px padding, `cursor: text`, flex 1, right-aligned.
  - `button.category-name`: reset.
  - `.grid-notice`.
- The uncategorized row's box keeps its current look.

## Downstream effects

- **EXF-491 (Ready to Assign pill)** reads `ready_to_assign` from the same cached month, so it updates
  optimistically without further work.
- **EXF-504 (Undo/Redo) and the moves ticket** attach to `useCommitAssigned`: one call per commit, with `before`
  and `after`, is the undoable action and the Recent Moves entry. Each PATCH writes exactly one `change_log` row
  to rebuild them from. The clock icon belongs in `AssignedCell`'s box, right of the amount.
- **EXF-498 (row selection)** can mark the row selected from `PlanGrid`'s `editing` id, and owns the second
  Escape.
- **EXF-494 (rename)** gives the category-name button its action.
- **EXF-493 (month navigation)** passes a different `month` to `PlanGrid`; nothing here depends on the header.

## Out of scope

- Ready to Assign pill and its red over-assigned state (EXF-491).
- Clock icon, Recent Moves, Undo/Redo, acceptance line 6 (moves ticket, EXF-504).
- Selected-row styling and checkbox meaning (EXF-498).
- The calculator popover (the icon is drawn but inert).
- Plan currency formats (EXF-468).
- Month navigation and header (EXF-493).
- Every file in the spec's "Do not edit" list (Lead notes 2 and 7).

## Acceptance

Unless stated otherwise:

- Each case uses a fresh plan created through the API (`ZZ-TEST …`), opened at `/<id>/budget` (current month).
- `RTA(m)` means `ready_to_assign` from `GET /api/v1/budgets/<id>/months/<m>`.
- "Rent" is `🏠 Rent/Mortgage` and "the Rent input" is `getByRole("textbox", { name: "Assigned for 🏠 Rent/Mortgage" })`.

1. **Open.** Click Rent's Assigned amount.
   - **Expected:** the Rent input is focused with value `0.00`, `selectionStart` 0 and `selectionEnd` 4.
   - The box has class `is-editing`, a 1px border of `rgb(84, 91, 254)` (pointer moved off the cell), and box-shadow `none`.
   - The calculator icon has opacity 1.
   - No other row has an input.
2. **Compare: open cell (live source).** Source state: "Test Budget" Plan, dark theme, current month, viewport
   1600×813. Click any category's Assigned amount, observe, then press **Escape**.
   - Clone: same viewport, a fresh plan, Rent's cell open.
   - **Expected:** both show a 116×24 box with a 4px radius, the calculator icon at its left, and right-aligned
     white `0.00` fully selected. The colours are those in case 1, with no focus ring.
3. **Compare: hover (live source).** Same source state; hover a category's Assigned amount without clicking.
   Clone: hover Rent's amount.
   - **Expected:** both show a 1px `rgb(117, 131, 255)` border, `rgb(12, 13, 34)` background and the calculator
     icon visible (opacity 1). The amount cursor is `text`.
4. **Enter commits 400.** Note `R0 = RTA(current)`. Open Rent, type `400`, press Enter.
   - **Expected, without reload:**
     - Rent's Assigned reads `$400.00` and its Available pill reads `$400.00` (class `positive`).
     - The Bills group row's `.num` cells read `$400.00`, `$0.00`, `$400.00`.
     - `document.activeElement` is `body`.
     - The API shows Rent `assigned` 400000, and `RTA(current) = R0 − 400000`.
5. **Arithmetic.** On Rent at 400.00, open it and type `+50`.
   - **Expected:** the field shows `400.00+50`; after Enter Rent reads `$450.00`.
   - Then, each starting from the stated value and committed with Enter:
     - set `100`, then `*2` gives `$200.00`;
     - `/4` gives `$50.00`;
     - `-10` gives `$40.00`;
     - `x2` gives `$80.00`.
   - On Phone & Internet at 0.00, `*2` + Enter gives `$0.00` and sends no PATCH.
6. **Parsing.** Commit each value on Rent and read it back from the API.
   - **Expected:**
     - `12.345` gives `assigned` 12350, displayed `$12.35`.
     - `1,234.5` gives 1234500, displayed `$1,234.50`.
     - `abc` gives 0, displayed `$0.00`.
     - `0-25` gives −25000, displayed `−$25.00`, with Rent's pill class `negative`.
7. **Escape discards.** On Rent at `$40.00`, open, type `999`, press Escape.
   - **Expected:** it still reads `$40.00`, no PATCH request was made (counted with `page.on("request")`), the API
     value is unchanged, and focus is on `body`.
8. **Tab and Shift+Tab.**
   - Open Rent, type `400`, press Tab.
     - **Expected:** Rent's Available pill (`$400.00`) is focused and the value is committed.
   - Open Rent again, press Shift+Tab.
     - **Expected:** Rent's category-name button is focused and no PATCH request was sent (unchanged).
9. **Arrows across groups.**
   - Open `⚡️ Utilities` (last in Bills), type `10`, press ↓.
     - **Expected:** Utilities reads `$10.00`; the `🛒 Groceries` input is open, focused, value `0.00` fully selected.
   - Press ↑.
     - **Expected:** the Utilities input is open with `10.00`.
   - Escape. Collapse Needs, open Utilities, press ↓.
     - **Expected:** the `🍽️ Dining out` input opens.
   - Open `❗️ Stuff I forgot to plan for`, type `5`, press ↓.
     - **Expected:** it reads `$5.00` and no input is open.
10. **Click elsewhere commits.** Open Rent, type `75`, click the ASSIGNED column header.
    - **Expected:** Rent reads `$75.00` and the API value is 75000.
11. **Unchanged sends nothing.** Open Rent and press Enter without typing, then open again and press ↓.
    - **Expected:** zero PATCH requests.
12. **Failure restores.** Intercept PATCH `**/months/*/categories/*` with a 500 using `page.route`. Open Rent
    (`$0.00`), type `400`, press Enter.
    - **Expected:** the cell returns to `$0.00` (the pill too), and the alert "Couldn't save the assigned amount."
      is visible.
13. **Past and future months.** Open `/<id>/budget/<YYYYMM of last month>`, set Rent to `30` + Enter. Repeat on
    next month with `60`.
    - **Expected:** the API shows Rent `assigned` 30000 in last month and 60000 in next month, and 0 in the current
      month. Each grid shows its value at once.
14. **Group rows.** Click the Bills group's Assigned subtotal.
    - **Expected:** no textbox appears anywhere and the value is unchanged. Uncategorized (when present) has no
      input either (existing fixture F covers the row).
15. **REST.** Worker test, against a seeded plan.
    - PATCH 400000 answers 200 with `category {id, month, assigned 400000, activity, available}` and
      `ready_to_assign`, each equal to `GET …/months/<m>` afterwards.
    - One `change_log` row has actor `user:tester@localhost`, `entity_type 'month_category'`, and before/after
      assigned values.
    - −5000 is accepted.
    - Every 404 and 422 row of the error table above answers as listed.
16. **MCP parity.** Worker test: `set_assigned` on another category answers the same shape and values as GET.
    - Its `change_log` row has actor `mcp:user:tester@localhost`.
    - An unknown category returns `isError`.
    - E2e: REST and MCP on the same plan give equal `category` and `ready_to_assign` for equal input.
17. **Surface.** In `month-categories.test.ts`, `apiPaths()` contains
    `/api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}` and `listedToolNames()` contains
    `set_assigned`.
18. **Parser units.** `packages/schema/test/assigned-edit.test.ts` passes with every case listed in spec T2
    (ticket rows, negatives, normalisation, precedence, zero results, `formatAssignedInput`, `applyAssigned`).
19. **No regression.** `e2e/plan-grid.spec.ts` passes unchanged, and `pnpm check` passes.

## Manifest

touches: [apps/web/src/plan/AssignedCell.tsx, apps/web/src/plan/rows.tsx, apps/web/src/plan/PlanGrid.tsx, apps/web/src/plan/plan-grid.css, apps/web/src/plan/icons.tsx, apps/web/src/api/assigned.ts, packages/schema/src/month-categories.ts, packages/schema/src/assigned-edit.ts, packages/schema/test/assigned-edit.test.ts, apps/worker/src/routes/month-categories.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/services/month-categories.ts, apps/worker/test/month-categories.test.ts, e2e/assigned.spec.ts, e2e/plan-grid.spec.ts, docs/assigned-inline-design.md, docs/assigned-inline-spec.md, docs/README.md]
shared: []
migrations: 0
