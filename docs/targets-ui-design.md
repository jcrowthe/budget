# Targets on the Plan page: design (EXF-508, EXF-514, EXF-592)

One Build, three tickets: **EXF-508** (the Target card's form, REST routes and MCP tools), **EXF-514** (a
target's state in the grid row and the Target card), **EXF-592** (a click on the selected category's name opens
its edit popover). The Lead's scope notes override the tickets. Spec: [targets-ui-spec.md](targets-ui-spec.md). Builds on main
`113ced4`, the targets engine ([targets-engine-design.md](targets-engine-design.md)) and the Plan panel
([plan-panel-design.md](plan-panel-design.md)).

## Source

Notes: `/workspace/scratch/source/targets/notes.md` (exact texts, computed styles, control types, what was
pressed). Captures (cropped right of the sidebar) in the same folder: `empty-card*.png`, `form-<tab>*.png`
(each tab, its dropdown, the calendar, repeat on / 3, balance with Due by date) and `exf592-*.png`.

Seen in the test plan (dark theme, 1600×813, nothing saved):

- **Empty card**: header button "Target" + chevron; bold "How much do you need for {name}?"; "When you create a
  target, we’ll let you know how much money to set aside to stay on track over time." (typographic ’);
  secondary button **Create Target** (32 px, radius 8).
- **Form** (sizes and colours in the notes): static header "Target" (no chevron); segmented control Weekly |
  Monthly | Yearly | Custom; opens on **Monthly** with the amount input focused and empty (unfocused: `$0.00`);
  calculator icon inside the field's right edge.
- **Fields**: Weekly "I need", **"Every"** (native select Sunday…Saturday, default Saturday), "Next month I want
  to". Monthly "I need", "By" (native select: "Last Day of Month", 31st … 1st), "Next month I want to". Yearly
  "I need", "By" (text `MM/DD/YYYY`, calendar icon; default first of next month), "Next year I want to". Custom
  "Amount", "I want to", "Due on" (date), **Repeat** switch (off). Repeat on adds "Every" with two native
  selects (1…11; Month/Year, plural at > 1). "Have a balance of" replaces Due on and Repeat with a **Due by
  date** switch (off); on shows "Due on" with month (January…December) and year (current … +49) selects,
  defaulting to next month.
- **Behaviour dropdown** (custom popup *above* the field with a down-arrow; selected option has a check-circle):
  - Monthly/Yearly: "Set aside another $X" / "Use for: bills, subscriptions, saving over time" / badge "Most
    people choose this"; "Refill up to $X" / "Use for: gasoline, fun money, dining out" / "Sets a Target to have
    $X on hand each month. Whatever you don't spend will get applied toward next month's $X." (Yearly: "each
    year", "next year's").
  - Weekly: "$X/week" in both titles; the refill line reads "Sets a Target to have $X/week on hand each month.
    Whatever you don't spend will get applied towards next month."
  - Custom: "Set aside $X", "Fill up to $X", "Have a balance of $X" with the ticket's help lines, no badge.
  - The labels update when the amount field loses focus.
- **Tab switching** keeps the amount; the Weekly/Monthly/Yearly choice (set aside / refill) and the Custom choice
  are remembered separately.
- **Footer**: **Delete** (red, trash icon, left; shown even for a new target), **Cancel**, **Save Target**.
- **Escape**: from the dropdown it closes only the dropdown; from a native select or the open calendar it
  closes the whole form (as Cancel) and keeps the selection.
- **EXF-592**: a click on the name of the selected category opens the edit popover (name, Hide, Delete,
  Cancel, OK). A click on an unselected name selects it **and** focuses its Assigned input; ↓ moves both;
  the first Escape blurs the input, the second clears the selection.
- **Not visible in the test plan** (the tickets are the specification): every saved state, Save and Delete.

**Differences from the ticket, decided by the source**: the Weekly weekday select is labelled **"Every"** (ticket:
"By"); the weekly refill help line is the source's; the dropdown labels change on blur, not per keystroke.

## Approach

### API (EXF-508, note 2) and the owner's date (note 3)

| Operation | Body / query | Returns (`data`) | Tool | Coverage line |
|---|---|---|---|---|
| `PUT /budgets/{budget_id}/categories/{category_id}/target` | `TargetBody`; `?today=YYYY-MM-DD` | `{ target: Target }` | `set_category_target` | `mcp-coverage/targets.ts` (new) |
| `DELETE /budgets/{budget_id}/categories/{category_id}/target` | none | `{ deleted: Target }` (as it was) | `delete_category_target` | `mcp-coverage/targets.ts` |
| `GET /budgets/{budget_id}/months/{month}` | adds `?today=` | unchanged shape | `get_plan_month` (+`today`) | unchanged |
| `GET /budgets/{budget_id}/months/{month}/summary` | adds `?today=` | unchanged | `get_month_summary` (+`today`) | unchanged |

- The target is its own resource: `routes/targets.ts`, `mcp/tools/targets.ts`, `test/mcp-coverage/targets.ts`.
- `TargetBody` = `TargetSet` without the ids, sharing its combination rules (those of EXF-508, plus: weekly
  needs `day_of_week`, custom is never `refill`, fields that do not apply are refused). Each refusal is **422**
  with the messages joined (e.g. "due_date is required for this target", "amount must be greater than 0").
  Unknown or non-UUID plan → 404 "Plan"; category → 404 "Category"; DELETE without a target → 404 "Target".
- **`today`**: an optional real calendar date (`YYYY-MM-DD`, 1900–2199), else 422. Reads compute target
  figures with it (it decides the current month for refill funding and which months come before a new
  target's creation); without it the Worker's `todayUtc()` is used, as now. The summary accepts it for the same
  read and passes it through (its totals do not use target figures today; EXF-519 will). PUT uses it as the
  new target's `created_on` (an edit keeps the stored one). It is trusted: this is the owner's single-user app.
- The web app sends `today=<browser local date>` on every month read and every target write.
- History: the existing services write one `change_log` row per create/update/delete with its actor.
- Tool descriptions: what is returned, `MONEY`, `DATE`, `MONTH`, and one sentence per kind (weekly, monthly,
  yearly, custom set aside / fill up / balance).
- No migration: the `targets` table has every column.

### Engine addition (note 5): `packages/core/src/targets.ts`

Every figure the display needs is already on `CategoryTargetMonth` (including `overall_to_go`) except the bar's
sections. Add one pure function; no existing figure changes:

`targetBar(t: TargetMonth, leftover: Milliunits): { sections: Milliunits[]; fill: Milliunits }`

| Kind | `sections` | `fill` |
|---|---|---|
| monthly set_aside | `L > 0 ? [L, needed] : [needed]` | `L + A` (= `L + funded`) |
| weekly set_aside | `[L]` if `L > 0`, then `amount` × n, n = `needed / amount` | `L + funded` |
| monthly / weekly refill | `[needed]` (weekly: `amount` × n) | `funded` |
| yearly, custom set_aside / fill_up / balance (dated or not), complete | `[definition.amount]` | `max(0, funded)` |

`needed` = 0 gives `sections: []` (one full section). It reproduces EXF-514's 41.2/58.8 %, 28.6 + 4×17.9 %,
15.2 %, 8.3 % and 25 %; Jan 40/165 is 24.24 % (the ticket rounds it to 24.3). No existing figure was found
wrong against the tickets.

### Wording (note 4): `packages/schema/src/target-wording.ts` (pure, no React)

Inputs: the category's `CategoryTargetMonth`, its `carried`, `assigned`, `activity`, `available`, and the shown
month. Outputs, every string exactly as EXF-514 quotes it (money `$1,200.00`, minus U+2212):

- `targetStatusText(c)` → `{ amount: string | null; text: string }` (amount drawn bold, then the rest).
  Underfunded: `{to_go_this_month} [more ]needed {when}`; "more" always for set-aside kinds (weekly/monthly/
  yearly/custom `set_aside`), and for refill, fill-up and balance only when `funded > 0`. `{when}`: monthly
  cadence "by the {ordinal day of period_due_date}"; weekly "this month"; dated kinds "by {Month} {ordinal}"
  when `due_this_month`, else "this month". `eventually`: `{overall_to_go} [more ]needed eventually`. `funded`
  and `complete`: "Funded", or "Funded. Spent {spent} of {carried + assigned}" when activity < 0. `on_track`:
  "On Track" (+ ". Spent … of …" likewise). Available < 0 keeps today's "Overspent. …" label.
- `targetPill(c)` → `{ tone: "zero" | "positive" | "negative" | "cautious"; icon: "clock" | "check" |
  "clockCheck" | null; title }`: negative available → today's red pill and title; `underfunded` → cautious +
  clock + "Assign {to_go} more to fund your {needed} monthly target." (monthly, weekly, refill) / "Assign
  {to_go} more to stay on track towards funding your {T} target." (yearly, custom set aside / fill up, not due
  this month) / "Assign {to_go} more to stay on track towards reaching your {T} target." (balance) / "Your {T}
  target is due this month, and you're short by {to_go}. Assign another {to_go} to fund your target." (dated
  kinds due this month); `funded` → positive + check + "You've funded your {T} target for the month!" (monthly
  kinds) / "You've funded your {T} target!" (others, and `complete`); `on_track` → positive + clockCheck +
  "You're on track to fund your {T} target by {Month} of {Year}." / "…to reach your {T} target by …"
  (balance); `eventually` and no target → today's pill by amount (grey at $0.00) and today's title. A funded or
  on-track pill at $0.00 stays grey with no icon (not observed).
- `targetHeading(def, period_due_date)` → `{ heading, subheading }`: "Set Aside Another {T} Each Month|Week|
  Year", "Refill Up to {T} Each Month|Week|Year", "Set Aside Another {T}" / "Fill Up to {T}" (custom; with
  repeat add " Every Month|Year" or " Every {n} Months|Years"), "Have a Balance of {T}". Subheadings: "By the End
  of the Month" / "By the {ordinal} of the Month" (monthly), "By {Weekday}" (weekly), "By {Mon D YYYY}" (yearly
  and custom dated: the period's due date, else `due_date`), "By {Mon YYYY}" or "Eventually" (balance).
- `targetMessage(c)` → `{ tone: "cautious" | "positive"; text; assign: Milliunits | null } | null`:
  underfunded monthly kinds "Assign {to_go} [more ]to meet your target" ("more" when `funded > 0`), dated kinds
  "Assign {to_go} [more ]this month to stay on track" ("more" when `assigned > 0`), with `assign = to_go`;
  funded "You've met your target!"; on track "You're on track to meet your target!"; null for `eventually` and
  `complete`.
- `targetDonut(c)` → percent or null: null for `complete` and for funded weekly/monthly kinds.
- `targetBreakdown(c)` → rows `[label, Milliunits][]` with a rule before "To Go": monthly/weekly set aside
  "Amount to Assign This Month" (`amount_this_month`), "Assigned So Far" (`funded`), "To Go"
  (`to_go_this_month`); refill "Needed This Month", "Funded", "To Go"; yearly/custom set aside "Total to Assign
  by {Mon D YYYY}" (T), "Assigned So Far", "To Go" (`overall_to_go`); balance "Balance Needed by {Mon YYYY}" or
  "Balance Needed", "Current Balance" (`funded`), "To Go"; fill up and yearly refill "Needed by {Mon D YYYY}",
  "Funded", "To Go".
- Form copy: `targetEmptyText(name)`, `behaviorOptions(tab, amount)` (titles, help, tagline, badge as in Source).

Its unit test is a table: kind, definition, month figures and month → every string EXF-514 quotes (12 status
texts, 9 pill titles, 8 headings, 8 subheadings, 6 messages, 10 breakdown labels) plus the form copy above.

### Form state: `packages/schema/src/target-form.ts` (pure)

The draft (tab, amount, the two remembered behaviours, every field), its defaults from the browser's date, the
prefill from a saved definition and the conversion to `TargetBody` with the form's errors ("Enter an amount
greater than $0.00.", "Enter a valid date."; not observed: Save cannot be pressed in the source). Spec task 4.

### Web (EXF-508, EXF-514)

- The month read sends `?today=` (browser local date at fetch time; query keys unchanged). `api/targets.ts`
  writes targets inside `beginWrite`/`endWrite`, so every cached month of the plan is refetched after a write.
- `plan/panel/TargetCard.tsx` sits between Available Balance and Notes, keyed by category id (another selection
  discards a draft): **empty** (collapsible), **form** (static header) or **view** (collapsible; donut, message
  with **Assign**, breakdown, **Edit Target**). After Save or Delete the form stays disabled (`aria-busy`)
  until the next month read arrives; a failure keeps it with "Couldn't save the target." (`role="alert"`).
  Delete on a new draft just closes the form.
- **Assign** commits `assigned + to_go_this_month` through `useCommitAssigned` and stays disabled until the next
  month read (no double add).
- Escape in the form: in the dropdown it closes the dropdown only; in the calendar or elsewhere it cancels the
  form; it never clears the selection (page shortcuts ignore `.target-form`).
- Grid row: with `c.target`, the status text, pill (tone `cautious`, icon, `title`) and bar come from the
  wording module and `targetBar` (fills green, yellow while underfunded; spending as today's stripes from the
  left). Without a target nothing changes. The inspector's display pill takes the same tone.

### EXF-592

- **Point 1, built**: in `PlanGrid`, a name click when the selection is exactly that category opens its
  edit popover anchored at the name (same `edit-category` popover as right-click and the pencil). Any other
  name click selects only that category and opens nothing.
- **Point 2, a deliberate difference** (recorded in `plan-panel-design.md`): selecting does not open Assigned.
  The editor commits on blur and on ↑/↓, so following the source would turn every arrow press into a possible
  write and would need the shortcuts to tell an "unedited" input from a field being typed in (Ctrl+A, Escape).

### Custom properties and icons

In `plan/panel/target.css` `:root`: `--statusCautious: #daac00`, `--categoryBalanceCautiousLabel: #0c0d22`,
`--calloutCautiousBackground: rgba(218, 172, 0, 0.2)`, `--calloutPositiveBackground: rgba(119, 186, 33, 0.2)`,
`--switchOffTrack: rgba(114, 116, 132, 0.2)`, `--calloutBadgeBackground: #292c6c`, `--popupBackground: #1f2038`.
Cautious colours = the app's warning label colour (not compared). Icons
(own SVG, `plan/icons.tsx`): `ClockIcon`, `ClockCheckIcon`, `TrashIcon`, `CaretDownIcon`, `CalendarIcon`,
`ChevronLeftIcon`, `ChevronRightIcon`, `TargetRingIcon`; `CheckCircleFillIcon` is reused.

## Downstream effects

- `e2e/plan-selection.spec.ts`: clicks on an already selected name now open the popover; the spec drops those
  redundant clicks and gains the EXF-592 cases.
- No read-model shape changes. EXF-519, EXF-516, EXF-505 and EXF-538 build on `target-wording.ts` and `targetBar`.

## Out of scope

Snooze and its switch (EXF-516); Auto-Assign cards and Underfunded (EXF-519); grid filters (EXF-500); upcoming
scheduled transactions on the pill (EXF-505); credit card payment targets (EXF-538); the calculator popover;
following the source's "select opens Assigned".

## Acceptance

Own plan per case (`ZZ-TEST …`, default categories, 500.00 on an account), 1280×720, current month, clock fixed
at the test's start, `timezoneId: "UTC"` unless stated; date-dependent strings computed from the date the
browser sends. **Compare** = the test plan's Plan page (`source.url`), dark theme, window as is, one category
selected, **Create Target**, then **Cancel** only. Real-mouse clicks (topmost check) for every popup control,
also at 1024×700.

1. **(EXF-508) Empty card.** Select Rent/Mortgage: card "Target", "How much do you need for 🏠 Rent/Mortgage?",
   the explanation line, **Create Target**. *Compare*: source, select one category.
2. **(EXF-508) Defaults.** Create Target: Monthly selected, amount input focused and empty, By "Last Day of
   Month", dropdown "Set aside another $0.00"; blur shows `$0.00`. *Compare*: source, Create Target.
3. **(EXF-508) Tabs, labels, balance, repeat.** Each tab shows exactly the fields, labels, options and defaults
   of the Source section. Type 100 and blur: "Set aside another $100.00"; the open dropdown lists the options
   with help, tagline and badge exactly (Weekly "$100.00/week", Yearly "each year"/"next year's"). Custom → Have a
   balance of: no Due on or Repeat; Due by date on → month and year selects (next month; 50 years). Custom →
   Set aside → Repeat on: "Every [1] [Month|Year]"; 3 → "Months|Years". *Compare*: source, the same steps.
4. **(EXF-508) Save, reload, edit.** Monthly 100, By 10th, Refill → Save Target; poll the API until stored:
   `{cadence: monthly, behavior: refill, amount: 100000, day_of_month: 10}`. Reload, select: heading "Refill Up
   to $100.00 Each Month", "By the 10th of the Month". Edit Target: Monthly, "10th", "Refill up to $100.00",
   amount `$100.00`. Same round trip for Yearly (date picked in the calendar), Custom repeat 3 Months, Custom
   balance with Due by date.
5. **(EXF-508) Delete.** In the form, Delete: no confirmation, the empty card returns, the row's status text
   and target pill go, the API has no target, and Assigned and Available are unchanged.
6. **(EXF-508) API.** Refusals → 422 with a readable detail; the tools create and delete; `change_log` rows
   create/update/delete carry `user:` (REST) or `mcp:` (MCP) actors.
7. **(EXF-508, note 3) Last evening.** `timezoneId: "America/Los_Angeles"`, clock fixed at 05:00 UTC on the
    first day after the current UTC month M (21:00 or 22:00 local on M's last day). Create a monthly 100 target
    in M: the PUT and the month GET carry `today=<M's last day>`, `created_month` is M, and M's row shows
    "$100.00 more needed by the {last day}". Worker test: `PUT …?today=2026-11-30` gives `created_month`
    `2026-11-01` and November has the target; a refill target's December read gives funded `A` with
    `today=2026-11-30` and `L + A` with `today=2026-12-01`.
8. **(EXF-514) Monthly 40.** Monthly 100 on the 10th, assign 40: "$60.00 more needed by the 10th" (amount
    bold), one section filled 40 % yellow, cautious pill with clock and title "Assign $60.00 more to fund your
    $100.00 monthly target.", inspector "40%" and "Assign $60.00 more to meet your target".
9. **(EXF-514) Assign.** Click Assign: Assigned 100.00, then "Funded", green pill with check, "You've met
    your target!", no donut. Spend 30: "Funded. Spent $30.00 of $100.00".
10. **(EXF-514) Yearly.** Yearly 1,200 due at the end of month M+11, assign 100: "On Track", 8%, green pill
    with clock-check, title "You're on track to fund your $1,200.00 target by {Month of M+11} of {year}."
11. **(EXF-514) Eventually.** Custom balance 60, no date: grey pill, "$60.00 needed eventually", subheading
    "Eventually", no message box.
12. **(EXF-514) Sections.** Monthly 100 with 70 left over: two sections 41.2 % / 58.8 % (±0.1). Weekly: one
    section per counted weekday after the leftover section.
13. **(EXF-514) Wording.** `target-wording.test.ts` covers every string quoted in EXF-514 (case 7 and Lead's 8).
14. **(EXF-514) MCP = screen.** `set_category_target` through `/mcp`, then `get_plan_month` with the browser's
    `today`: the row's status text and the inspector's breakdown equal the strings built from that read.
15. **(EXF-592) Name click.** One selected: a real-mouse click on its name opens "Edit Category"; a click on
    another name selects it and opens nothing; with two selected, a name click selects only it, no popover.
    *Compare*: source, click a selected name, then Cancel.
16. **(all) Narrow.** At 1024×700 every form control passes the topmost-element check and the footer buttons
    are visible; Save works.
17. **(all) Unchanged.** The existing selection, panel, Assigned, month and MCP specs and tests pass.

## Manifest

touches: [packages/core/src/targets.ts, packages/core/test/targets.test.ts, packages/schema/src/targets.ts, packages/schema/src/target-wording.ts, packages/schema/src/target-form.ts, packages/schema/test/target-wording.test.ts, packages/schema/test/target-form.test.ts, packages/schema/test/targets.test.ts, apps/worker/src/services/targets.ts, apps/worker/src/services/months.ts, apps/worker/src/routes/targets.ts, apps/worker/src/routes/months.ts, apps/worker/src/mcp/tools/targets.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/test/mcp-coverage/targets.ts, apps/worker/test/target-routes.test.ts, apps/web/src/plan/**, apps/web/src/api/months.ts, apps/web/src/api/targets.ts, e2e/targets-form.spec.ts, e2e/targets-display.spec.ts, e2e/targets-today.spec.ts, e2e/targets.fixtures.ts, e2e/plan-selection.spec.ts, docs/plan-panel-design.md, docs/targets-ui-design.md, docs/targets-ui-spec.md, docs/README.md]
shared: [packages/core/src/targets.ts: adds the pure `targetBar` (bar sections and fill) for the display, with its tests in packages/core/test/targets.test.ts; no existing figure changes]
migrations: 0
