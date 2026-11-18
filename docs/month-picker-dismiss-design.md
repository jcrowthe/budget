# Month picker dismiss and Activity amount column: design (EXF-727 with EXF-745)

A small Build on the Plan page only. Main at `b0240a5`. Spec: [month-picker-dismiss-spec.md](month-picker-dismiss-spec.md).

- **EXF-727.** A click outside the month picker sometimes leaves it open (`e2e/month-nav.spec.ts` "6 month picker",
  `:157`). **Cause, from the logged runs below:** the press lands on a **disabled** button (an Auto-Assign option
  whose preview has not arrived yet). Chromium dispatches no `mousedown` to a disabled form control, so `useDismiss`,
  which listens for `mousedown` on `document`, never runs. **The fix is in the app** (`useDismiss` listens for
  `pointerdown`), because a person meets it.
- **EXF-745.** The Activity popover's amount column is 96 px and cuts a twelve-character amount. It becomes 104 px,
  and the amount cell gets a `title`.

## The source app in this Build (copied from the brief, with the reasons)

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the
Clerk's step 2 (`source.url`). The owner made that plan for this work.

**What may be read and done, and nothing else:**
- In the Clerk's tab as it stands (the test plan's Plan page): the source's loaded style rules and its static script
  files that are already loaded (read without navigating).
- **In a tab of your own on the same address:** probe elements with the source's classes. With the mouse, **open the
  month picker of the test plan's Plan page and one category's Activity popover**, to see how each closes on a click
  outside and to measure the popover's amount column. Reason: both are parts of the test plan's own Plan page and
  show nothing but the test plan's months and its own transactions. If you chose another month, choose the first one
  again before you close the tab. Close the tab when done.

**What nobody ever does in the source, each with its reason:**
- **Type into any field; create, edit, assign, move, delete or approve anything; change a view or a setting.**
  Reason: it is the owner's account; the test plan must stay as it is for the next step.
- **Open any account page, All Accounts, Add Account, Bank Connections, Reconcile, Reflect, the plan menu or the
  address `/users/budgets`.** Reason: they show the owner's banks and other plans, or (Reconcile) once signed the
  whole session out.
- **Read or print any text of the sidebar's header or the account menu, or print the sidebar's or the page's whole
  text.** Reason: the plan's name and the signed-in address are there; a Designer's sidebar read once put the
  account's email into a transcript.
- **Keep a screenshot of the source that shows the sidebar:** crop every source capture to the picker or the
  popover itself.
- **Leave the tab changed:** set every override back; the Clerk's tab stays on the test plan's Plan page.

**Each step states in its report, for itself only, every action it took in the source app (style rules read, script
files read, probe elements, each thing opened), or that it opened nothing. Nobody but the Clerk runs the Clerk's
commands; a step that runs them has opened the source and says so.**

## Source (study notes: `/workspace/scratch/source/month-picker-dismiss/notes.md`)

Studied on 18 Nov 2026 by the Architect's sub-agent, in a tab of its own on the test plan (screenshots
`month-picker-1440.png`, `month-picker-1024x700.png` in the same folder, cropped to the picker).

- **Month picker.** Opening it adds a transparent full-window overlay (`.modal-overlay.modal-calendar`,
  z-index 10001) holding a 224×197 dialog centred under the month button. It is the same at 1440×900 and 1024×700,
  and inside the window at both sizes. **It closes on the `mousedown` of any press outside**: on empty grid, **on a
  disabled button** (the disabled redo button: it closes, and the button gets only `pointerup`) and on the month
  button itself (closes and does not reopen). The overlay takes the press, so **the click does not act on what is
  under it** (a row under it is not selected; with the picker closed the same click selects the row). Escape closes
  it, and focus goes to the month button.
- **Activity popover.** Not opened live: every Activity of the test plan is 0 in the three months the picker allows,
  and a zero Activity does not open the popover. From the loaded style rules: `.modal-budget-activity .modal
  {width: 32em}` (512 px, the clone's width too); cells are `nowrap` with an ellipsis; the columns are equal shares
  (`.ynab-table-5-col` 20 %, no pixel widths), so the source's amount column is about a fifth of the table (≈ 98 px).
  Amounts are right-aligned.

**What this Build matches:** a press outside closes the picker even when it lands on a disabled button (EXF-727).
**Known difference, out of scope:** in the source the outside press is swallowed by the overlay. In the clone,
`useDismiss` lets the click go on to what is under it (before and after this Build; in spec 6 it can apply "Assigned
Last Month"). Changing that changes five popovers (the picker, the month note, three in Reflect): it needs a ticket of
its own (proposed to the Lead).

## EXF-727: the runs and the logs

**The probe** (temporary and never committed; saved as `/workspace/scratch/e2e-727/probe.patch`):
- In the page, capture-phase listeners on `document` log every `pointerdown`, `mousedown`, `pointerup`, `mouseup`
  and `click`, with the target, its button's `disabled` state and `elementFromPoint` at that moment.
- `useDismiss` logs each run of its handler, with its decision and when its listener is added.
- `PlanHeader` logs every change of `open` with its cause (toggle by the month button, the picker's `onClose`, the
  month effect).
- `AutoAssignOptions` logs when its preview arrives.
- An `afterEach` writes the log per run to `/workspace/scratch/e2e-727/logs/`.

All runs used `scripts/e2e-load.sh <label> on e2e/month-nav.spec.ts:134` (the test's line with the probe in place).
That means the made load (four busy loops) on a box with a 5-CPU quota and 31 GiB of memory.

| label | repeats | workers | failed | slowest answer |
|---|---|---|---|---|
| rec1 | 20 | 4 | 0 | 321 ms |
| rec2 | 40 | 4 | **1** (repeat 38) | 423 ms |
| rec3 | 40 | 4 | 0 | 367 ms |
| rec4 | 60 | 4 | 0 | 488 ms |
| rec5 | 80 | 8 | 0 | 501 ms |
| rec6 | 150 | 4 | 0 | 387 ms |
| rec-delay | 3 | 3 | **3** | GET `months/<M1>/auto-assign` held 1.5 s by `page.route` |

So natural load gave **1 failure in 390 repeats** (rarer than the 3 in 20 of Build `p_72cf…`). For more logged
failures, the ticket's other route was used: one API answer delayed (only the Auto-Assign preview of M+1, held 1.5 s,
then passed to the real server). That gave **3 of 3**, all with the same path.

**The failing run under load (rec2, repeat 38; times in ms from page start):**
```
2587.0 OPEN-STATE toggle(picker) by month-button click: none -> picker
2588.8 DISMISS-LISTENER added
2588.9 OPEN-STATE committed: picker
2598.2 CAPTURE pointerdown at 1000,500 target=BUTTON.auto-assign-option [disabled=true label=Assigned Last Month–]
2598.5 CAPTURE pointerup   at 1000,500 target=BUTTON.auto-assign-option [disabled=true ...]
       (no mousedown, no mouseup, no click; no DISMISS-HANDLER line)
2606.6 SPEC after mouse.click; picker=true
2629.0 AUTOASSIGN preview=arrived            (the option becomes enabled 31 ms after the press)
       (no further event or state change: the picker stays open until the 5 s expect gives up)
```
**The three delayed runs** (rec-delay, repeats 0–2) show the same thing. Listener added; press 11, 11 and 68 ms after
the picker opened, each logged as `pointerdown` + `pointerup` on the disabled "Assigned Last Month–" option. There is
no `mousedown`, no handler run and no state change. The preview arrives 1.1 s later and the picker still stays open.

**Every passing run (389):** the same press logs `pointerdown`, `mousedown`, `pointerup`, `mouseup` and `click` on the
**enabled** option. Then `DISMISS-HANDLER ran … inside=false trigger=false -> close` and `OPEN-STATE picker onClose
-> none`. The click then applies "Assigned Last Month" (see the known difference above).

**Checked apart from the app** (`/workspace/scratch/probe/disabled.mjs`, Playwright's Chromium 159): a mouse click on
a `<button disabled>` dispatches only `pointerdown` and `pointerup` to the document (in both the capture and bubble
phases). It dispatches no `mousedown`, `mouseup` or `click`. On an enabled button all five arrive.

**Cause in one sentence:** when the press outside the picker lands on a disabled button (here an Auto-Assign option
still loading its preview), Chromium dispatches no `mousedown`, so `useDismiss`'s `mousedown` listener on `document`
never runs and the picker stays open.

**Ruled out by the logs:**
- The listener comes late: it is added 9 ms before the press in the failing run.
- Something stops the event: there is no `mousedown` even in the capture phase.
- The picker closed and was opened again: there is no state change after "committed: picker".
- The element was replaced between press and release: the same disabled button is hit at `pointerdown` and at
  `pointerup`.

**A person meets it.** At the furthest month (M+1) the "Next month" arrow is disabled. Open the month picker, click
that arrow: the picker stays open. The same happens with any disabled button outside (an Auto-Assign option while its
preview loads or while an Auto-Assign runs). It happens with the month note popover too, and with Reflect's three
`useDismiss` popovers whenever a disabled control lies outside them. Checked on present code with a throwaway spec
(`/workspace/scratch/e2e-727/probe-disabled.spec.ts`): picker and note both fail `expect(dlg).toHaveCount(0)` after
`realClick` on the disabled arrow. With `pointerdown`, both pass, and spec 6 with the preview held passes 3 of 3.

**The fix:** `apps/web/src/plan/useDismiss.ts` listens for `pointerdown` instead of `mousedown`. `pointerdown` fires on
disabled controls, comes before `mousedown` for every mouse, pen and touch press, and keeps the same `inside` /
`trigger` test. It matches the source, which closes at the press even on a disabled button. No retry, pause or longer
limit, and no change to spec 6.

**Downstream:** the five users of `useDismiss` (`MonthPicker`, `MonthNotePopover`, Reflect's `FilterPopover`,
`TransactionPopover`, `DateRange`) all gain this. None of them, and no element inside them, handles
`mousedown`/`pointerdown` itself: grep of `apps/web/src/plan/*.tsx` and `apps/web/src/reflect/*.tsx`. The only
`onMouseDown` there are `preventDefault` calls in `AssignedCell`, `FixThisPopover` and `CategoryPicker`, which are not
inside these popovers. The plan's `Popover.tsx` (Activity, Assign, Move, …) closes through its own overlay `div`,
which is never disabled, so it is unaffected. `apps/web/src/reflect/**` needs no edit.

## EXF-745: the Activity amount column

**Measured on the clone** (`b0240a5`, throwaway spec, Figtree Variable 500 14px, `tabular-nums`, cell padding 4+4).
The popover is 512 px at both sizes (left 334 at 1024×700, inside the window), and the table is 487.5 px. Columns:
Account 91.0, Date 88, Payee 106.2, Memo 106.3, Amount 96. Text widths in the amount cell:

| amount | chars | text px | scrollWidth / clientWidth today |
|---|---|---|---|
| `−$888.88` | 8 | 65.0 | 96 / 96 |
| `$88,888.88` | 10 | 86.0 | 96 / 96 |
| `−$888,888.88` | 12 | 95.0 | **103 / 96** (cut) |
| `−888.888,88€` (EUR, `123.456,78`, after) | 12 | 96.0 | **104 / 96** (cut) |
| `−8.888.888,88€` | 14 | ≈ 106 | cut |

No amount cell has a `title` today.

**The fix:**
- `.activity-table .col-amount { width: 104px; }`, which is 96 px of text plus 8 px of padding. Every twelve-character
  amount in either measured format then fits, with `scrollWidth ≤ clientWidth`.
- The amount `<td>` gets `title={fmt.money(t.amount)}`, like the grid's amounts and the popover's other cells.
- A longer amount stays `nowrap` and is cut with the existing ellipsis.

**What gives way: the account, payee and memo columns**, 8 px between them. The popover stays 512 px (the source's
32em, and it has no spare width). The table stays 487.5 px and Date stays 88. Account 30 % and Payee/Memo 35 % share
295.5 px instead of 303.5: Account ≈ 88.6, Payee ≈ 103.4, Memo ≈ 103.4. Their names keep the ellipsis and `title` they
already have. The same holds at 1024×700, where the popover keeps its size and place.

## What changes

| file | change |
|---|---|
| `apps/web/src/plan/useDismiss.ts` | `mousedown` → `pointerdown` (listener, its removal, the handler's event type, the doc comment) |
| `apps/web/src/plan/activity-popover.css` | `.col-amount` 96 → 104 px, with a comment naming EXF-745 |
| `apps/web/src/plan/activity-popover.tsx` | amount `<td>` gets `title={fmt.money(t.amount)}` |
| `e2e/month-picker-dismiss.spec.ts` (new) | EXF-727 cases (acceptance 1–3) |
| `e2e/activity-amount.spec.ts` (new) | EXF-745 cases (acceptance 5–6) |
| `e2e/support/activity-amount-seed.ts` (new, optional) | the plan behind the EXF-745 spec, through the API only |
| docs | this design, the spec, `docs/README.md` one line; the Designer's `month-picker-dismiss-polish.md` |

**Not changed:** spec 6 of `e2e/month-nav.spec.ts`, its expectations and its waits; `e2e/activity-popover*.spec.ts`;
every file out of bounds (note 8 of the brief); no Worker file; no dependency. **D1 calls: no Worker file changes, so
no handler's D1 call count changes (0 added); this Build adds no request and no fetch.**

## Out of scope

- The outside click acting on what is under it (the source swallows it): a separate ticket, see Source.
- The source's equal-share column layout of the Activity table. The clone keeps its own widths and only the amount
  column grows.
- Making the Auto-Assign options enabled while their preview loads.

## The order of the work (copied from the brief; the Implementer commits after each part)

1. EXF-745: the failing spec, the fix.
2. EXF-727: the failing runs with their logs (the Architect made them; the cause is above).
3. The fix where the cause is, with its failing test first; the specs of the hook's other users.
4. Forty repeats under the made load; the narrow window.

## Acceptance

Sizes are 1440×900 and 1024×700 unless a case says otherwise. Every click in a spec uses `realClick`
(`e2e/support/real-click.ts`). "M+1" is the month after the local current month, the furthest the plan allows. The
Tester uses the clone's dev server (`pnpm dev`, :5173) with a plan of its own made through the API.

1. **Picker, disabled button outside (EXF-727, spec, both sizes).** New plan; open `/<id>/budget/<M+1 yyyymm>`. "Next
   month" is disabled. Click the month button: dialog "Choose month" is visible. Click the disabled "Next month"
   arrow: the dialog count is 0 within the default 5 s. The URL and the month heading stay M+1, and "Next month" is
   still disabled. **Fails on `b0240a5`** at the `toHaveCount(0)` line. **Compare (source):** the test plan's Plan
   page; open the picker, press the disabled redo button: the picker closes.
2. **Picker, Auto-Assign option while its preview loads (EXF-727, spec, 1440×900).** New plan; the spec holds the GET
   of `…/months/<M+1 iso>/auto-assign` with a promise it resolves itself (`page.route`, then `route.fallback()`; no
   stand-in body, no timer). Open M+1 and wait for an `.auto-assign-option` that is disabled. Open the picker, click
   that disabled option: the dialog count is 0. Then release the held answer: the options become enabled and the
   dialog stays closed. **Fails on `b0240a5`.**
3. **Month note, disabled button outside (EXF-727, spec, both sizes).** As case 1 with the month note button: the
   dialog opened by "Enter a note..." closes on a click on the disabled "Next month" arrow. **Fails on `b0240a5`.**
4. **Spec 6 under load (EXF-727).** `bash scripts/e2e-load.sh <label> on e2e/month-nav.spec.ts:127 --repeat-each=40`:
   40 of 40 pass. (Natural failures are about 1 in 390 here, so cases 1–3 are the proof; this is the regression
   check.) The specs of the hook's other users pass: `e2e/month-nav.spec.ts` whole (the note popover), and the
   Reflect specs `reflect-frame`, `reflect-followups`, `spending-breakdown`, `spending-trends`, `income-expense`,
   `income-expense-narrow`, `age-of-money`.
5. **Activity amounts whole (EXF-745, spec, both sizes).** The spec creates a plan through the API: one category, its
   own account, three approved transactions in the current month of −888.88, +88,888.88 and −888,888.88. Open the
   category's Activity popover: the amount cells read `−$888.88`, `$88,888.88`, `−$888,888.88` (U+2212). For each,
   `scrollWidth ≤ clientWidth`, and each has a `title` equal to its text. **Fails on `b0240a5`** for `−$888,888.88`
   (103 > 96). The popover lies wholly inside the window (`getBoundingClientRect` within `innerWidth`/`innerHeight`).
6. **Activity amount cut with ellipsis (EXF-745, spec, both sizes).** The same plan switched with PATCH to
   `currency_format { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" }`, with a transaction
   of −8,888,888.88. Its cell reads `−8.888.888,88€` (14 characters), `scrollWidth > clientWidth`, computed
   `text-overflow: ellipsis`, `white-space: nowrap`, a single line (cell height equals the other rows'), and `title`
   `−8.888.888,88€`. In the same plan `−888.888,88€` (12) has `scrollWidth ≤ clientWidth`.
7. **Existing specs still pass:** `e2e/activity-popover.spec.ts`, `e2e/activity-popover-narrow.spec.ts`,
   `e2e/month-nav.spec.ts`, and `pnpm check`.

### Looking (the Tester's main work)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh**
screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it. The report lists `state,
size, file, sentence`. **Three states, six screenshots, every one opened; take no others unless something looks
wrong.**

1. The month picker open on the Plan page.
2. The Plan page just after a click outside the picker (the picker gone, and what the click did to the thing under
   it). The click is on the disabled "Next month" arrow at M+1 (case 1's fault): the picker is gone, the month is
   still M+1 and the arrow still disabled.
3. A category's Activity popover with amounts of eight, ten and twelve characters (EXF-745), the plan of case 5. All
   three are whole on one line, the names keep their ellipsis, and the popover is inside the window.

## Actions in the source by the Architect's step

All through one sub-agent, in one page of its own on the test plan's address, closed at the end. The Clerk's tab was
not touched.
- Viewports on its own page: 1440×900 and 1024×700, set back to 1600×813.
- Style rules read: the picker/overlay/modal rules, the "activity" and `ynab-table`/`*-column` rules, `:root`.
- Elements probed: rects, classes and computed styles only (header calendar buttons, Activity cell buttons, rows,
  `elementsFromPoint`, the picker).
- A capture-phase event logger was set on its own page.
- Month picker opened about nine times, and closed by presses on empty grid, on the disabled redo button and on the
  month button, by Escape, and by picking Oct 2026, Dec 2026 and then Nov 2026 (the first month restored).
- One click on a row's name cell with the picker closed. It selected the row and focused its amount field; two Escapes
  undid it and nothing was typed.
- One click on a zero Activity amount: no popover.
- Two screenshots, cropped to the picker.
- No script files were read.
- The Architect ran none of the Clerk's commands.

## Manifest

touches: [apps/web/src/plan/useDismiss.ts, apps/web/src/plan/activity-popover.tsx, apps/web/src/plan/activity-popover.css, e2e/month-picker-dismiss.spec.ts, e2e/activity-amount.spec.ts, e2e/support/activity-amount-seed.ts, docs/month-picker-dismiss-design.md, docs/month-picker-dismiss-spec.md, docs/month-picker-dismiss-polish.md, docs/README.md]
shared: []
migrations: 0
