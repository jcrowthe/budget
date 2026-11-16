# Plan month navigation, month picker and month note (EXF-493)

## Feature

This builds the left part of the Plan page header:

- ‹ and › arrows;
- the month label "Nov 2026 ▾", which opens a month picker;
- a Today button, shown only on other months;
- under the label, a one-line month note that opens a note popover.

It also adds the small API behind it:

- `PATCH .../months/{month}` to set the note;
- the MCP tool `set_month_note`;
- a facts read for the navigation limits.

The Ready to Assign pill (EXF-491), the view chips (EXF-500) and the "Add Member" button are not built here.

## Source

Study notes: `/workspace/scratch/source/month-nav/notes.md`. The screenshots `01-…png` to `12-…png` are in the same directory, cropped to exclude the sidebar. They were observed on 2026-11-15 on the Test Budget plan (dark theme, 1600×813), when the current month was Nov 2026. Summary:

- **Layout.** The header is 88px tall on `#15172d`, and its left block is `flex: 0 0 30%` with 8px padding. In order:
  - **‹ button.** 40×30, no background or border. The circle is part of the 30px chevron-in-ring icon, drawn in `actionPrimary` (#7583ff).
  - **Date column.** Flex column with 0 8px padding:
    - **Month button.** "Nov 2026", 21px/700, line-height 75%, white, then a 12px caret ▾ in `actionPrimary` with a 4px gap.
    - **Note button.** 14px/500 in `labelSecondary`, `max-width: 7rem` (112px), centred, `nowrap` with an ellipsis, underlined on hover. `title` holds the full note. The placeholder is exactly `Enter a note...`.
  - **› button.** The same as ‹.
  - **Today.** A secondary button, 16px after ›: 32px high, padding 6px 16px, radius 8px, 16px/500, background `rgba(117,131,255,.2)`, text #f1f1ff.
- **Arrow states.**
  - Hover: `actionPrimaryActive` (#a3acff).
  - Disabled: `actionPrimaryDisabled` (#383ca3), with no opacity change and the default cursor.
  - A disabled › has `title="Before you can move to next month, you need to assign money this month."`. A disabled ‹ has no title.
  - Disabled arrows are skipped by Tab.
- **Limits observed today.** For a plan whose data is all in Nov 2026, the range was Oct 2026 to Dec 2026. A month typed into the URL outside the range redirects to the current month.
- **URLs.**
  - Every arrow, picker or Today navigation pushes `/budget/YYYYMM`. Today pushes `/budget/202611`; it does not use bare `/budget`.
  - Back and Forward walk the months visited.
  - The title never includes the month.
- **Picker.**
  - Shape: 224px (`#1f2038`, radius 6.4px, shadow `0 16px 64px rgba(0,0,0,.2)`), centred 15px under the date column with a 30×15 up arrow in the gap.
  - Year row "‹ 2026 ›" (17.6px/700; 40×32 ghost buttons titled `Previous Year`/`Next Year`, never disabled), 1px separator below.
  - Month grid: 4 columns × 3 rows, labelled `Jan`…`Dec`, each with `aria-label="Nov 2026"`. Each month is 46.75×40.66 with a 2px margin, radius 4px, 14px/600.
  - Month states:
    - Viewed month: background #545bfe, white text.
    - Current month (when not viewed): background #292b3d, text #7583ff.
    - Out of range: text #9b9caa, not clickable.
    - Hover: background #292b3d.
  - The picker opens on the viewed month's year. A year with no allowed month shows all 12 months dim.
  - Clicking an enabled month navigates and closes the picker. Escape (focus goes back to the label) and an outside click also close it.
- **Note popover.**
  - Shape: 224px wide, under the note line, with an up arrow and the same surface as the picker.
  - Textarea: placeholder `Enter a note...`, 44px tall at first, auto-grows up to 168px, `resize: vertical`. Padding 4px 8px, border 1px #727484, radius 4px, background #3c3e53, 14px/500.
  - OK button at the bottom right: #545bfe, 32px, radius 8px, padding 6px 16px. Its hover background is #7583ff.
  - Focus goes to the textarea when the popover opens.
  - Keys and clicks:
    - Enter, or OK: saves the **trimmed** text.
    - Shift+Enter: inserts a newline.
    - Escape: cancels, and focus returns to the note line.
    - Outside click: closes without saving.
  - No saved note exists in range, so truncation was read from the CSS rather than seen.

## Approach

### 1. API (Worker)

- **`PATCH /api/v1/budgets/{budget_id}/months/{month}`**, in `routes/months.ts`.
  - Body `MonthNoteUpdate` `{ note: string (≤ 5000) | null }`.
  - Responds 200 with `{ data: { month, note } }`; 404 for an unknown plan; 422 for a bad month, year, body or length.
  - It calls the existing `setMonthNote(env, actor, …)`. `Idempotency-Key` already works through the global middleware.
- **`setMonthNote` normalises** the note: `note?.trim() || null`. An empty or whitespace-only note is stored as `null` (the note is cleared), and other notes are stored trimmed, as the source saves `trim(text)`.
  - The history row is unchanged: `entity_type "month"`, `entity_id <month>`, `action "update"`, with before and after `{ month, note }`.
  - It returns the stored value.
  - The schema cap `MonthNoteSet.note` goes from 500 to **5000** characters, applied to the raw string. The source has no limit.
- **MCP `set_month_note(budget_id, month, note)`**, in `mcp/tools/months.ts`. It uses the same service with the server's `mcp:<actor>` and returns `{ month, note }`.
- **Limits read: `GET /api/v1/budgets/{budget_id}/month-range`** returns `{ data: { first_month, last_assigned_month } }`.
  - Why this path: a sibling of `/months` rather than `/months/range`. It can never be parsed as `/months/{month}`, and it does not match the e2e stub glob `**/api/v1/budgets/*/months/*` that `plan-grid.spec.ts` installs.
  - **`first_month`** is the minimum of:
    - the UTC month of `budgets.created_at`;
    - the earliest `month_categories.month` with `assigned <> 0`;
    - the earliest `months.month` with `note IS NOT NULL`;
    - the earliest `substr(transactions.date,1,7)` with `deleted_at IS NULL`.

    Because the creation month is included, it is never later than the month the plan was created.
  - **`last_assigned_month`** is the latest `month_categories.month` with `assigned <> 0`, or `null` when there is none.
  - **Where it is computed:**
    - Reads: one SQL statement of four scalar subqueries in a **new** `repositories/month-range.ts` (`monthFacts`). The transactions and month-categories repositories are not touched.
    - Service: `getMonthRange` in `services/months.ts`.
  - It reports facts only, with no "today": no MCP tool is needed for it.

### 2. Rule applied in the browser (`plan/monthNav.ts`, pure)

`current = localCurrentMonth()`, from `shell/planPaths.ts`, unchanged.

- `earliest = min(first_month, current)`. This is normally `first_month`; the `min` covers a plan created minutes ago whose UTC creation month is already the next month.
- `furthest = addMonths(max(current, last_assigned_month ?? current), 1)`.
- **‹** is enabled iff the range is loaded and `month > earliest`.
- **›** is enabled iff the range is loaded and `month < furthest`.
- A picker month `m` is enabled iff `earliest ≤ m ≤ furthest`.
- Months are ISO strings, so they compare as strings.
- While the range is loading, or if its request failed, both arrows are disabled and every picker month is disabled.
- **A URL month outside the range still loads** (Lead's note 2). Only the arrows and the picker are limited.

### 3. Header component (`plan/PlanHeader.tsx` + `plan/plan-header.css`)

`pages/plan.tsx` renders `<PlanHeader budgetId month>` instead of `<PageHeader variant="plan" title>`. PlanHeader renders its own `<header className="page-header plan plan-header">`, keeping the shell's classes, so the background, the 88px height and the `.page-header.plan h1` font stay as they are and `shell-compare.spec.ts` keeps passing. The shell is not edited.

```
header.page-header.plan.plan-header
 ├ div.plan-header-calendar            (flex: 0 0 30%, padding 8px, position: relative)
 │  ├ button.month-arrow.prev  aria-label="Previous month"
 │  ├ div.plan-header-date
 │  │  ├ h1 > button.month-button  aria-haspopup="dialog" aria-expanded   "Nov 2026" + <CaretDownIcon aria-hidden>
 │  │  └ button.month-note  title=<note|"">   note | "Enter a note..."
 │  ├ button.month-arrow.next  aria-label="Next month"  (title=<the source's text> when disabled)
 │  ├ button.today-button "Today"      (only when month !== current)
 │  ├ <MonthPicker/>                    (when open)
 │  └ <MonthNotePopover/>               (when open)
 └ div.plan-header-totals              ← EXF-491 renders the Ready to Assign pill here (PlanHeader `children`)
```

- The page keeps **exactly one `h1`**, whose text is the month label. The caret SVG is `aria-hidden` and has no text, so `getByRole("heading", { level: 1 })` still has the text `Nov 2026`, and `plan-urls.spec.ts` needs no change.
- **EXF-491** passes the Ready to Assign pill as `children` of `<PlanHeader>`, which renders it in `div.plan-header-totals`. That div is `flex: 0 1 auto` and is rendered even when empty.
- **EXF-500**: the view chips row sits **below** the header, above the grid (source screenshot 10). It attaches in `pages/plan.tsx` between `<PlanHeader/>` and `div.plan-body`, where a comment marks the spot.
- **Navigation.** The arrows, picker and Today all call `usePlanMonth().setMonth(m)`, which pushes `/<id>/budget/YYYYMM`. Today pushes the current month's URL, as the source does. `pages/plan.tsx` already calls `rememberMonth`, so the remembered month and Back/Forward work unchanged.
- **Note data.** The note comes from `useMonth(budgetId, month).data?.note`: the same query the grid uses, so there is no extra request. While that query has no data, the note line shows the placeholder.
- **Popovers.**
  - They close on Escape (focus returns to their trigger) and on an outside `mousedown`, through a small own hook `plan/useDismiss.ts`.
  - Each popover is rendered with `key={month}` and is closed when the month changes.
  - Both are `role="dialog"` with an `aria-label` (`Choose month`, `Month note`).
- **Stacking.** Header `position: relative; z-index: 10` (grid sticky head is 2, shell menus 20/30); popovers are absolute inside `.plan-header-calendar`.
- **Picker** (`plan/MonthPicker.tsx`).
  - State: `year` starts at the viewed month's year.
  - Year buttons: `aria-label`/`title` `Previous Year` and `Next Year`, never disabled.
  - Month buttons: 12 `button.picker-month`, text `Jan`…, `aria-label="<Mon> <yyyy>"`.
  - State classes: `is-selected` for the viewed month; `is-current` (with `aria-current="date"`) for the current month; `disabled` (a real attribute) for out-of-range months.
  - Clicking an enabled month calls `setMonth`, then closes the picker.
- **Note popover** (`plan/MonthNotePopover.tsx`).
  - Textarea `aria-label="Month note"` with placeholder `Enter a note...`, auto-focused, initial value = the stored note.
  - On input it sets `height = clamp(scrollHeight, 44, 168)`.
  - Keys and buttons: Enter without Shift saves (`preventDefault`); OK saves; Escape cancels.
  - **Save** = `trim() || null`.
    - Unchanged from the stored note: just close, with no request and no history row.
    - Otherwise: close, then run the mutation `useSetMonthNote`. It writes the note optimistically into `["month", budgetId, month]` (`setQueryData`); on success it invalidates `["month", budgetId, month]` and `["month-range", budgetId]` (a note can move the first month earlier); on error it invalidates the month query, which rolls the note back.
- **Icons** (`plan/monthNavIcons.tsx`, the clone's own drawings in `currentColor`): `ChevronCircleLeftIcon` and `ChevronCircleRightIcon` (a ring plus a chevron), and `CaretDownIcon` (a rounded filled triangle).
- **Label.** `monthLabel(month)` ("Nov 2026", en-US short month, UTC) moves from `pages/plan.tsx` into `plan/monthNav.ts`.

### 4. Custom properties (top of `plan/plan-header.css`; no token exists yet)

`tokens.css` lacks these, so they are declared in `:root` with the source's names and dark values, as `plan-grid.css` does: `--actionPrimaryActive: #a3acff`, `--actionPrimaryDisabled: #383ca3` and `--separatorStandard: rgba(255, 255, 255, 0.1)` (both the same name and value as in `plan-grid.css`), `--backgroundPrimaryElevated: #1f2038`, `--backgroundSecondaryElevated: #292b3d`, `--buttonPrimaryBackgroundActive: #7583ff`, `--buttonSecondaryBackgroundActive: rgba(117, 131, 255, 0.27)`.

Everything else uses existing tokens: `--actionPrimary`, `--labelPrimary`, `--labelSecondary`, `--labelTertiary`, `--buttonPrimaryBackground`, `--buttonSecondaryBackground`, `--buttonSecondaryLabel`, `--inputBackground`, `--inputBorder`, `--shadowMenu`, and the radius and space scales. There are no raw colours inside rules.

## What changes

- **Schema** (`packages/schema/src/months.ts`):
  - `MonthNoteSet.note` max goes to 5000.
  - New: `MonthNoteUpdate`, `MonthNote`, `MonthNoteResponse`, `MonthRange`, `MonthRangeResponse`, and a `MONTH_NOTE_MAX` constant.
- **Worker:**
  - `routes/months.ts`: two routes.
  - `mcp/tools/months.ts`: one tool.
  - `services/months.ts`: `setMonthNote` normalises the note; new `getMonthRange`.
  - New `repositories/month-range.ts`.
- **Web:**
  - `api/months.ts`: `getMonthRange`, `useMonthRange`, `setMonthNote`, `useSetMonthNote`.
  - `pages/plan.tsx`: uses `PlanHeader`.
  - New files in `plan/`: `PlanHeader.tsx`, `MonthPicker.tsx`, `MonthNotePopover.tsx`, `monthNav.ts`, `monthNavIcons.tsx`, `useDismiss.ts`, `plan-header.css`.
- **Tests:** new `apps/worker/test/month-nav.test.ts` and new `e2e/month-nav.spec.ts`.
- **User-visible:**
  - The Plan header gets the arrows, picker, Today and note.
  - `PATCH .../months/{month}` and `GET .../month-range` appear in `/api/v1/openapi.json`.
  - `set_month_note` appears in MCP `tools/list`.

## Downstream effects

- **EXF-489** (assigning): after a successful assign or move it must invalidate `["month-range", budgetId]`, so that › opens one more month. Until then, a refetch on page load or window focus picks the change up.
- **EXF-491** fills `PlanHeader`'s `children`.
- **EXF-500** inserts the chips row in `pages/plan.tsx`.
- The `PageHeader` import leaves `pages/plan.tsx`, but `PageHeader` itself is unchanged for the other pages.
- `plan-urls-design.md` said EXF-493 would redirect out-of-range URL months to the current month. **The Lead overrode that**: they load.

## Out of scope

- The Ready to Assign pill, the view chips and Add Member.
- The light theme: the clone has dark tokens only.
- Assigning UI.
- Keyboard arrow navigation inside the picker: the source has none either.
- An MCP tool for the limits read.

## Differences from the source kept on purpose

1. **Earliest month.** The live source allowed one month **before** the plan's first data month (Oct for data in Nov). The ticket's older observation shows the arrows and the picker disagreeing. The Lead's rule is used for both: earliest = the plan's first month.
2. **Out-of-range URL months** load as typed. The source redirects them to the current month.
3. **Accessible names.** The arrows are `Previous month` and `Next month`; the source's are `previous month budget` and `next month budget`.
4. **Disabled picker months** are real `disabled` buttons, skipped by Tab. The source leaves them focusable but inert.

## Acceptance

`<id>` is a plan created by the test via `POST /api/v1/budgets` with the name `ZZ-TEST <random>`. `M` is the current local month as `YYYYMM`, and `M±n` are the months around it; `label(X)` is `"Mon YYYY"`. **Compare** cases: open this Thread's source tab on Test Budget (`/542b334b-696e-4418-937a-5e2c21a8b45c/budget`, dark theme, the same viewport for both apps) and compare. Look only, and **never save a note there** (Escape only).

1. **Arrows and URL.** Open `/<id>/budget`.
   - Click › → the URL is `/<id>/budget/M+1`, the h1 is `label(M+1)`, and the grid's month request is for `M+1`.
   - Click ‹ → `/<id>/budget/M`, h1 `label(M)`.
   - Hard-load `/<id>/budget/M-3` → the h1 is `label(M-3)` and the URL stays.
2. **Back/Forward.** From `/<id>/budget`:
   - Click › (to M+1), then Today (to M), then ›.
   - Back → M; Back → M+1; Back → `/<id>/budget`.
   - Forward → M+1.
   - Each step shows the URL month in the h1, with no reload (a `window` marker survives).
   - The sidebar Plan link points at the shown month.
3. **Today (compare).**
   - On `/<id>/budget` there is no `Today` button.
   - On `/<id>/budget/M+1` and `/<id>/budget/M-2` it is visible; clicking it gives `/<id>/budget/M` and hides it.
   - Source: Today is absent on Nov 2026 and present on Dec 2026, 16px right of ›.
4. **Limits on a new plan.**
   - The range read returns `first_month = M` and `last_assigned_month = null`.
   - On M, ‹ is disabled.
   - On M+1, › is disabled and has the title `Before you can move to next month, you need to assign money this month.`
   - Hard-loading M+3 still loads (h1 `label(M+3)`): › is disabled and ‹ is enabled.
5. **Assignment opens a month.**
   - Browser: stub `GET **/month-range` with `last_assigned_month = M+1`. On M+1, › is enabled; clicking it reaches M+2, where › is disabled.
   - Worker: after `setAssigned` in a month L later than M, `GET …/month-range` gives `last_assigned_month = L`.
6. **Picker (compare).** On `/<id>/budget`, click the month button:
   - A dialog `Choose month` shows the year of M.
   - The month M has the `is-selected` and `is-current` classes. Months before M and after M+1 are disabled; M+1 is enabled.
   - `Next Year`: every month of that year is disabled when M+1 is in an earlier year.
   - `Previous Year`: every month is disabled.
   - Return to M's year and click M+1 → the URL is `/<id>/budget/M+1` and the dialog is gone.
   - Open it again and press Escape → it closes, and focus is on the month button.
   - Open it and click the grid → it closes.
   - Source: the same layout, 224px wide with the up arrow, Oct/Nov/Dec enabled. Compare the selected and current-month colours on Oct 2026.
7. **Header look (compare).** On M, compare with the source on Nov 2026 (screenshot 02):
   - the arrow size (40×30) and colour (`rgb(117,131,255)`);
   - the month font (21px/700) and the caret;
   - the note line (14px, `rgb(196,197,207)`, `Enter a note...`, max-width 112px).

   The disabled › colour is `rgb(56,60,163)`.
8. **Note saved with Enter persists.** On M:
   - Click `Enter a note...` → a `Month note` dialog opens with the textarea focused.
   - Type `ZZ-TEST note for this month, long enough to be cut` and press Enter → the dialog closes, and the note line shows the text: one line, `text-overflow: ellipsis`, `scrollWidth > clientWidth`, `title` = the full text.
   - Reload → still shown.
   - Go to M+1 → `Enter a note...`. Back to M → the note is shown.
   - `GET /api/v1/budgets/<id>/months/<M as ISO>` returns that `note`.
9. **Note: other keys.**
   - Shift+Enter inserts a newline and keeps the dialog open.
   - Escape after typing closes the dialog with the note unchanged, and focus is on the note line.
   - Clicking outside also discards.
   - Typing more lines grows the textarea up to 168px.
   - OK saves.
   - Replacing the text with spaces and pressing Enter → `Enter a note...` returns and the API `note` is `null`.
10. **Note popover (compare).** Open the note popover on an empty month in both apps. Compare its width (224px), the textarea (44px, `rgb(60,62,83)`, border `rgb(114,116,132)`), the OK button, and the position under the note line. Leave the source popover with Escape.
11. **REST and history (Worker).**
    - `PATCH …/months/2026-10-01 {note:"  hi  "}` → 200 `{data:{month:"2026-10-01", note:"hi"}}`, and one change_log row (`entity_type month`, `entity_id 2026-10-01`, actor `user:…`, before `{note:null}`, after `{note:"hi"}`).
    - `{note:""}` → `note: null`.
    - 5001 characters → 422. A non-month (`2026-10-02`) → 422. Year 2300 → 422. An unknown plan → 404.
    - The MCP `set_month_note` writes the same shaped row with the actor `mcp:…`.
    - `apiPaths()` contains `/api/v1/budgets/{budget_id}/month-range` (the PATCH shares `/months/{month}`). `listedToolNames()` contains `set_month_note`.
12. **First month (Worker).** On a new plan, `first_month` is the creation month.
    - A note in an earlier month X → `first_month = X`. Clearing it → back to the creation month.
    - An assignment of 0 in an earlier month doesn't count; a non-zero one does.
    - A transaction dated earlier → its month. Once deleted, it no longer counts.
    - `last_assigned_month` is the max non-zero month, or null.

## Manifest

touches: [apps/web/src/pages/plan.tsx, apps/web/src/plan/PlanHeader.tsx, apps/web/src/plan/MonthPicker.tsx, apps/web/src/plan/MonthNotePopover.tsx, apps/web/src/plan/monthNav.ts, apps/web/src/plan/monthNavIcons.tsx, apps/web/src/plan/useDismiss.ts, apps/web/src/plan/plan-header.css, apps/web/src/api/months.ts, packages/schema/src/months.ts, apps/worker/src/routes/months.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/services/months.ts, apps/worker/src/repositories/month-range.ts, apps/worker/test/month-nav.test.ts, e2e/month-nav.spec.ts, docs/month-nav-design.md, docs/month-nav-spec.md, docs/README.md]
shared: []
migrations: 0
