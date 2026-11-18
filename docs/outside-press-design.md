# Outside press used up: design (EXF-874)

A small Build on the Plan page only. Main at `639e60d`. Spec: [outside-press-spec.md](outside-press-spec.md).

On the Plan page, a press outside the month picker or the month note closes the popover, **but today it also acts on
what is under it**. A click away from the picker can apply an Auto-Assign option; a click away from the note can
select a category row. In the source, that press is used up and focus goes back to the button that opened the popover.
This Build does the same for these two popovers only. Reflect's three popovers are not changed (see "Reflect").

## The source app in this Build (copied from the brief, with the reasons)

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the
Clerk's step 2 (`source.url`).

**What may be read and done, and nothing else:**
- In the Clerk's tab as it stands (the test plan's Plan page): the source's loaded style rules and its already-loaded
  static script files (read without navigating).
- **In a tab of your own on the same address, these presses and no other:** (a) a click on the month button to open
  the month picker; (b) with the picker open, one press on an empty part of the page (the grid's empty space below
  the last row, or the header's empty space), and one press on the month button itself; (c) a click on the month
  note's field to open its popover, and with it open one press on the same empty part of the page; (d) Escape. After
  each press read what is open, where focus is, and whether anything under the pointer changed. Reason: these show
  nothing but the test plan's own month and change nothing in it. Close the tab when done.
- The earlier Build's study of the month picker is in `docs/month-picker-dismiss-design.md` ("Source"): read it
  first; what it already measured need not be measured again.

**What nobody ever does in the source, each with its reason:**
- **Press on a row, a category, an amount, a button of the Inspector, Auto-Assign or any other thing that acts.**
  Reason: the point of this Build is that such a press may act; in the source's test plan it must not be tried on
  anything that can. (The earlier Build's sub-agent clicked a row; that is not repeated.)
- **Type into any field, the month note included; choose another month in the picker; create, edit, assign, move,
  delete or approve anything; change a view or a setting.** Reason: it is the owner's account; the test plan stays as
  it is.
- **Open any account page, All Accounts, Add Account, Bank Connections, Reconcile, Reflect, the plan menu or the
  address `/users/budgets`.** Reason: they show the owner's banks and his other plans.
- **Read or print any text of the sidebar's header or the account menu, or print the sidebar's or the page's whole
  text; keep a screenshot of the source that shows the sidebar** (crop every source capture to the popover).
- **Leave the tab changed.**

**Each step states in its report, for itself only, every action it took in the source app (style rules read, script
files read, each press), or that it opened nothing. Nobody but the Clerk runs the Clerk's commands; a step that runs
them has opened the source and says so.**

## Source (study notes: `/workspace/scratch/source/outside-press/notes.md`)

Studied on 18 Nov 2026 by the Architect's sub-agent. It worked in pages of its own on the test plan's address
(1440×900, briefly 1024×700). Screenshots in the same folder, cropped to the popover or to the month button:
`01-month-picker-open.png`, `02-month-note-open.png`, `03-month-button-after-outside-press.png`,
`04-note-button-after-outside-press.png`.

- **Both popovers sit on a full-window transparent overlay.** The picker's is `.modal-overlay.modal-calendar`; the
  note's is `.modal-overlay.modal-popup` with a note class. Both have z-index 10001, `background: rgba(0,0,0,0)` and
  no `pointer-events` rule. While either is open, the page content gets the `inert` attribute, so hit-testing skips
  it.
- **Outside press, month picker (compared live).** A left press on the empty grid is received by the overlay. The
  picker closes at `mousedown`. `mouseup` then lands on the grid, and **no `click` fires**, because press and release
  have different targets. Nothing under the pointer acts. **Focus is on the month button** (`:focus` true,
  **`:focus-visible` false**, outline `none`: **no visible ring**).
- **Outside press, month note (compared live).** The same thing happens: the overlay takes the press, the note closes
  at `mousedown`, no click, nothing acts. **Focus is on the note button**, again with no visible ring. So **the source
  uses the press up for the note too**.
- **Typed text in the note when closed by an outside press: discarded** (compared by reading the loaded script, not by
  typing). The overlay's action is `modalService.closeModal`. Only `save()` writes the note, and `save()` runs only on
  OK or Enter. Escape runs `cancel()`, which also discards. The clone already discards (the popover unmounts with its
  `text` state; `e2e/month-nav.spec.ts` "9" checks it). **No change.**
- **Press on the month button with the picker open:** the overlay covers the button, so the press closes the picker
  and no click reaches the button. It does not reopen, and focus is on the month button.
- **Escape:** closes the popover, with focus on its button (picker and note).
- **Right press outside:** it closes the picker at `mousedown` (the handler does not check which button). The
  `contextmenu` event then reaches the empty grid under it, and nothing cancels it, so the browser's own menu would
  show there.
- **Scrolling:** with the picker open at 1024×700, a wheel over the scrollable grid did not scroll it (the overlay
  takes the wheel). At 1440×900 the grid does not scroll.

## Approach: a listener that uses the press up (not an overlay)

The hook `useDismiss` gets an option. The month picker and the month note set it; Reflect does not.

```ts
useDismiss(ref, onClose, returnFocus?, { consumeOutsidePress: true })
```

With the option set, the press is handled like this:
1. **The hook listens for `pointerdown` on `window` in the capture phase.** That runs before React's root listeners
   and before every other `document` listener. It still fires on a disabled button (EXF-727).
2. **A press outside the popover and outside its trigger** does four things:
   - calls `stopImmediatePropagation()` on the `pointerdown`;
   - closes the popover;
   - focuses the trigger (`returnFocus.current.focus()`);
   - starts **"the rest of this press is used up"**.
3. **"The rest of this press is used up"** is a single module-level state in `useDismiss.ts`. It outlives the popover,
   which unmounts on close. It adds `window` capture listeners for `mousedown`, `mouseup`, `click`, `auxclick`,
   `contextmenu` and `pointerup`. Each calls `stopImmediatePropagation()`, and `preventDefault()` for all of them
   except `pointerup`. The `pointerup` listener also puts focus back on the trigger if something moved it.
   - Preventing `mousedown`'s default keeps focus and text selection where they are.
   - It **ends** at the next `pointerdown` that is not the starting event, or at the next `keydown`. Both listen on
     `window` in the capture phase, and ending removes every one of its listeners.
   - A new state replaces an old one.
   - So a lone click with no next press is never lost. Example: Enter on the focused month button after the press: the
     `keydown` ends the state before the click.
4. **A press on the trigger** is ignored by the hook, as today. The trigger's own click closes the popover (`toggle`).
   It does not reopen, and the click focuses the button. **No change** (scope note 1: "as today").
5. **Escape** is unchanged.

**Why not an overlay (the source's way):**
- The popovers live inside `.plan-header` (`position: relative; z-index: 10`). An overlay in there stays in the
  header's stacking context, and covering the grid and Inspector would mean moving both popovers into a portal. That
  is a layout change the Designer would have to re-measure at two sizes.
- When an overlay is removed at the press, Chromium sends a touch tap's `click` to the element now under the finger,
  so the press would act on touch.
- `realClick` (`e2e/support/real-click.ts`, not editable) checks that its target is the topmost element. Under an
  overlay, specs could not press the Auto-Assign option at all.

**How it meets scope note 4:**
- **Mouse:** `pointerdown` is stopped. `mousedown` and `mouseup` are stopped with their defaults prevented, so there
  is no focus move and no selection. `click` is stopped and prevented.
- **Touch:** `pointerdown` is stopped. The compatibility `mousedown`/`mouseup` and the tap's `click` all arrive while
  the state is on, and are stopped. A touch that turns into a scroll gives `pointercancel` and no click; the state
  ends at the next press or key.
- **Right press:** `pointerdown` and `mousedown` are stopped, and so is `contextmenu`, with its default prevented. So
  a category row's `onContextMenu` (`rows.tsx:81`, `:225`, the edit popover) does not open, and neither does the
  browser's menu. `auxclick` is stopped.
- **Disabled button under the pointer:** `pointerdown` still reaches `window`, so EXF-727 holds. There is no
  `mousedown` or `click` to stop.
- **Scrolling: unchanged from today.** The page behind the picker still scrolls by wheel, as it does today. The source
  blocks it; this Build keeps the clone's present behaviour (scope note 4) and lists it as a known difference.
- **Hover** under an open popover is unchanged (the source's overlay hides it).

**The app has no touch-event handlers in `apps/web/src/plan` or `apps/web/src/shell`** (grep found none for
`onTouch`/`touchstart`). Only pointer, mouse and click handlers act, and all of them are stopped.

## Reflect: unchanged

`apps/web/src/reflect/FilterPopover.tsx`, `TransactionPopover.tsx` and `DateRange.tsx` call `useDismiss` without the
new fourth argument. Without it, the hook does exactly what it does today: `document` `pointerdown` in the bubble
phase, close, and the press goes on. **`apps/web/src/reflect/**` has no change**, and Reflect was not looked at in the
source. Their specs pass unedited.

## What changes

| file | change |
|---|---|
| `apps/web/src/plan/useDismiss.ts` | 4th parameter `opts?: { consumeOutsidePress?: boolean }`; with it, the `window` capture listener, the focus return and the module-level "rest of the press used up" state; doc comment names EXF-874 |
| `apps/web/src/plan/MonthPicker.tsx` | `useDismiss(ref, onClose, triggerRef, { consumeOutsidePress: true })` |
| `apps/web/src/plan/MonthNotePopover.tsx` | the same call |
| `e2e/outside-press.spec.ts` (new) | acceptance 1–5 |
| docs | this design, the spec, one line in `docs/README.md`; the Designer's `outside-press-polish.md` |

**User-visible:**
- An outside press closes the month picker or the month note and does nothing else. Focus is then on the month button
  or the note button. Like the source, the button shows no visible ring, because a press after a mouse press does not
  match `:focus-visible`.
- A second press acts normally.
- The month note's typed text is discarded, as today and as in the source.

**Not changed:**
- `PlanHeader.tsx` and the stylesheets. `PlanHeader` needs no edit: `triggerRef` is already passed.
- `e2e/month-nav.spec.ts`: its "6" ends with `page.mouse.click(1000, 500)` and `toHaveCount(0)`, and nothing after it
  relied on the click going through. Its "9" closes the note by an outside click and checks the text was discarded,
  which still holds.
- `e2e/month-picker-dismiss.spec.ts`, the Reflect files and specs, `Popover.tsx`.
- Every out-of-bounds file of scope note 7.

No Worker file, no dependency, no request or fetch added, no retry, pause or longer limit.

**D1 calls: no Worker file changes, so no handler's D1 call count changes (0 added); this Build adds no request and
no fetch.**

## Downstream effects

- Nothing else in `apps/web` listens for `pointerdown`/`mousedown` while one of these two popovers is open in a way
  that must see the press:
  - `PlanMenu.tsx:194` (document `mousedown`) and `connection-status-mark.tsx:110` (document capture `pointerdown`)
    close their own menus, which cannot be open at the same time as the picker. Opening the picker is itself a press
    outside them.
  - `ResizeHandle.tsx`'s `onPointerDown` would not start a drag from that press. That is the point.
- A press on the **note button while the picker is open** (or the reverse) is outside the open popover. It is used
  up: the open one closes and the other does not open. The source behaves the same way, because its overlay covers
  both buttons.

## Out of scope

- Reflect's three popovers (scope note 3).
- Blocking scroll and hover under an open popover, and the source's `inert` on the page (known differences above).
- The browser's own context menu after a right press outside. The source would show it over empty space; the clone
  shows nothing (the press has no effect).
- `Popover.tsx` (Activity, Assign, Move, …), which already has its own overlay.

## The order of the work (copied from the brief; the Implementer commits after each part)

1. The month picker: the failing spec, the change, focus back on the month button.
2. The month note, as note 2 decides.
3. The hook's other users unchanged (their specs), the narrow window.

Note 2 decides: the source uses the press up for the note too, so the note gets the same option, and its typed text
stays discarded.

## Acceptance

Sizes are 1440×900 and 1024×700 unless a case says otherwise. Every mouse press in a spec uses `realClick`. A right
press uses a spec-local helper with the same topmost check, because `real-click.ts` is not edited. Each spec makes its
own plan through `POST /api/v1/budgets` (a new plan has the default categories and enabled Auto-Assign options at the
current month M) and deletes it after.

"Auto-Assign POST" means `POST /api/v1/budgets/<id>/months/<M iso>/auto-assign?today=…`
(`apps/web/src/api/autoAssign.ts:25`, `:100`), recorded with `page.on("request")`.

1. **Picker, outside press on an enabled Auto-Assign option (spec, both sizes).**
   - Open `/<id>/budget` and wait until the first `.auto-assign-option` is enabled.
   - Press the month button: dialog "Choose month" is visible.
   - Press that option.
   - Expected: the dialog count is 0, the month button is focused, the option is still enabled, and no Auto-Assign
     POST has been recorded.
   - Then press the option again. Expected: `expect.poll` sees exactly **1** Auto-Assign POST, and its response is
     awaited.
   - **Fails on `639e60d`** at the `toBeFocused` line (the click focused the option and sent the POST).
   - **Compare (source):** the test plan's Plan page at 1440×900; open the picker and press the empty grid below the
     last row. The picker closes, nothing under the pointer acts, and focus is on the month button (the press goes on
     empty space only, per the source rules).
2. **Picker, touch tap on the option (spec, 1440×900, `hasTouch: true`).**
   - As case 1, but the outside press is `page.touchscreen.tap` at the option's centre.
   - Expected: the dialog count is 0, no Auto-Assign POST, and the month button is focused.
   - A second tap sends exactly 1 POST.
   - **Fails on `639e60d`.** Not compared.
3. **Picker, right press on a category row (spec, 1440×900).**
   - With the picker open, right-press the name of **the target row**: the first `.category-row` whose `.category-name` box lies wholly below the open popover's box (so the pointer is not over the popover).
   - Expected: the dialog count is 0, **no dialog at all** (`getByRole("dialog")` count 0, so the edit popover did not
     open), that row has `aria-selected="false"`, and the month button is focused.
   - **Fails on `639e60d`** (the "Edit Category" popover opens).
   - **Compare (source):** a right press on empty space closes the picker (see Source).
4. **Month note, outside press on a category row (spec, both sizes).**
   - Press the `.month-note` button; the textbox "Month note" is focused. Fill it with `ZZ-TEST draft`.
   - Press the `.category-name` button of the target row (as in case 3, below the open note's box; the topmost check of `realClick` passes at both sizes).
   - Expected: the "Month note" dialog count is 0, the row has `aria-selected="false"`, the `.month-note` button is
     focused, and it reads `Enter a note...` (draft discarded).
   - Press the same name again: the row has `aria-selected="true"`.
   - **Fails on `639e60d`** at the `aria-selected="false"` line.
   - **Compare (source):** the test plan's Plan page; open the note and press the empty grid. The note closes, nothing
     acts, and focus is on the note button. (Typing is not compared live: the source script discards it.)
5. **Picker, press on the month button (spec, both sizes; a guard, passes on `639e60d`).**
   - Open the picker and press the month button.
   - Expected: the dialog count is 0, the button has `aria-expanded="false"`, and it is focused.
   - **Compare (source):** the same; the picker closes and does not reopen.
6. **EXF-727 holds and the hook's other users are unchanged.** These pass unedited:
   - `e2e/month-picker-dismiss.spec.ts`;
   - `e2e/month-nav.spec.ts` (whole, with "6" and "9");
   - the Reflect specs `reflect-frame`, `reflect-followups`, `spending-breakdown`, `spending-trends`,
     `income-expense`, `income-expense-narrow`, `age-of-money`, `net-worth`;
   - `pnpm check`.

   `git diff 639e60d -- apps/web/src/reflect` is empty.
7. **Escape unchanged:** `e2e/month-nav.spec.ts` "6" and "9" (Escape closes, and the trigger is focused).

### Looking (the Tester's main work; copied from the brief)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh**
screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it. The report lists `state, size,
file, sentence`. **Two states, four screenshots, every one opened; take no others unless something looks wrong.**

1. The Plan page just after a press outside the open month picker that landed on an Auto-Assign option: the picker
   gone, the focus ring on the month button, and nothing assigned.
2. The Plan page just after a press outside the open month note that landed on a category row: the note's popover
   gone, the row not selected.

**Architect's note on state 1:** in the source, after such a press the month button has focus but **no visible ring**
(`:focus-visible` false, outline `none`; `03-month-button-after-outside-press.png`). The clone matches that. So the
Tester confirms focus with `document.activeElement` (it is the month button). The sentence says whether a ring is seen
(none expected, as in the source), and does not report its absence as a fault.

## Actions in the source by the Architect's step

All through one sub-agent:
- **In the Clerk's tab, read only, no navigation:** read `document.styleSheets`, listed the loaded scripts, and
  fetched the already-loaded script files to read them.
- **In two pages of its own on the test plan's address,** each closed at the end:
  - The month button, pressed to open the picker four times.
  - One wheel over the grid with the picker open, at each size.
  - A left press on empty grid space (560,860), twice.
  - One right press on the same empty space.
  - One press on the month button with the picker open.
  - Escape once, with the picker open at 1024×700.
  - The note button, pressed to open the note three times; with it open, a left press on the empty space twice, and
    Escape once.
  - Capture-phase event loggers, on its own pages only.
  - Four screenshots, cropped to the popover or the month button.
- Nothing typed, no month chosen, nothing under the pointer acted (0 rows selected throughout).
- The Architect itself opened nothing in the source and ran none of the Clerk's commands.

## Manifest

touches: [apps/web/src/plan/useDismiss.ts, apps/web/src/plan/MonthPicker.tsx, apps/web/src/plan/MonthNotePopover.tsx, e2e/outside-press.spec.ts, docs/outside-press-design.md, docs/outside-press-spec.md, docs/outside-press-polish.md, docs/README.md]
shared: []
migrations: 0
