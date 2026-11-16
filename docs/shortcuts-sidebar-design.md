# Keyboard shortcuts, sidebar collapse and resize, not-found sidebar (EXF-473, EXF-474, EXF-614)

This change is in the web app only. It adds:
- a shortcut registry, one key dispatcher, the Keyboard Shortcuts dialog and a shortcut tooltip (EXF-473);
- the sidebar's collapse to an icon rail, the expand, and a drag-resize saved in `localStorage` (EXF-474);
- the sidebar shown beside "Plan not found" (EXF-614).

There is no Worker change, no schema change, no migration and no new dependency.

## Source

The notes and crops are in `/workspace/scratch/source/shortcuts-sidebar/`:
- `notes.md` has every measurement and colour, and the dialog's full list as rendered;
- the crops are `dialog-open-top.png`, `dialog-scrolled-bottom.png`, `sidebar-bottom-collapse-hover.png`,
  `rail.png`, `rail-hover-{budget,reports,accounts}.png` and `rail-expand-tooltip.png`.

All of it was read on the test plan's Plan page at 1600×813, in the dark theme. In short:

- **Dialog.**
  - Box: 640 wide, centred, 798 high at 813 (header 48, body up to `calc(100vh - 8rem)`, footer 65). Background
    #1f2038, radius 8. Title "Keyboard Shortcuts" at 18/600. The ✕ button's `aria-label` is "Close".
  - Body: four full-width `h3` (16/600). Each section's `ul` uses `column-count: 2` with a 24px gap. Each row is
    45 high: the description on the left, the caps on the right, and a 1px bottom border.
  - Caps: 28×28 minimum, radius 4, background rgba(114,116,132,.24), 14px. Letters are upper-case; named keys
    (`shift`, `ctrl`, …) are lower-case. "then" is a cap with no background.
  - Footer: one primary OK on the right (#545bfe, 32 high).
  - Behaviour: OK, ✕ and Escape close it, and `?` toggles it. Focus goes to the body on open and to `<body>` on
    close.
  - The list equals the ticket's, except that the source shows **no** "(… also works)" notes. The caps read `ctrl`
    (the browser reports Linux).
- **Collapse button.**
  - `aria-label="Expand/Collapse Sidebar"`, 32×24, at x 216–248 in a 52px bottom bar (plus a 1px border).
  - Opacity .8, and 1 on hover. Its icon is a window with a left panel and a triangle pointing left.
  - Its tooltip is in the markup but **never shows** in the source (a CSS fault). Its CSS says it should sit above
    the button, centred, with background #3c3e53, text #ededf5 at 12px, padding 8, radius 6, and caps of 20px. It
    should appear after .5s with a .2s fade.
- **Collapse.** The width animates 260↔56 with `width .25s ease`. The main area follows. Shift+. does the same.
- **Rail.**
  - Top: the logo button (opens the plan menu; it was not clicked), 39×47.
  - Navigation: Plan, Reflect and All Accounts tiles, 39×40 at x 8, at y 63/107/151.
  - Tiles: active #1c1f58, hover #1b1d48, radius 6; no labels and no tooltips.
  - Bottom: the expand button (the triangle points right). Its tooltip works: it sits above the button, left-aligned,
    and opens to the right.
- **Resizer** (CSS only): 3px at the right edge, `ew-resize`. An 8×40 #7583ff pill shows on hover and while
  resizing.

## Approach

### 1. Registry and dispatcher (`apps/web/src/shortcuts/`)

- **`registry.ts`** is data only. Each of the ticket's 40 rows is `{ id, section, description, caps, combos? }`,
  word for word and in the ticket's order.
  - `caps` is what the dialog shows. `THEN` marks a "then" cap.
  - `combos` is what can be dispatched, for example Redo `["ctrl+shift+z","ctrl+y"]` and Delete
    `["delete","backspace"]`. That is where the ticket's "also works" notes live, since the source does not
    display them.
  - Rows without combos (the Flag chord, `shift` `click`, `tab`, and the date picker's keys, which are typed in its
    field) cannot be bound.
- **`keys.ts`** has pure functions:
  - `isMacPlatform(navigator)`: `userAgentData.platform`, else `platform`, tested against `/mac|iphone|ipad/i`;
  - `capLabel` (`ctrl`→`⌘` on macOS);
  - `parseCombo`, `comboMatches` and `pickShortcut`.
- **`dispatcher.ts`:**
  - `useShortcut(id, handler, enabled?)` registers a handler for a registry id. The last one mounted wins.
  - `useShortcutDispatcher()` installs **one** `window` `keydown` listener (bubble phase). It is mounted once, in
    `AppShell`.
- **The dispatcher does nothing at all** (no `preventDefault`, no `stopPropagation`) when any of these is true:
  - the event has `defaultPrevented`, `repeat` or `isComposing`;
  - the target is in `input, textarea, select, [contenteditable]`;
  - a `[role=dialog]`, `[role=menu]`, `[aria-modal=true]` or `dialog[open]` is in the page;
  - no combo of a **bound** id matches.

  It calls `preventDefault()` only when it runs a handler. Keys it has no handler for therefore reach the Plan page's
  `usePlanShortcuts` (on `window`) and the register's `document` listeners as today. **Those files do not change.**
- **Matching:**
  - `ctrl` means `ctrlKey || metaKey`.
  - A modifier the combo does not name means no match.
  - A one-character symbol without `shift+` (`?`) ignores Shift.
  - `shift+.` matches Shift with `code "Period"` or `key ">"`, so it works on any layout.
- **Bound in this Build:**
  - `open-help` (`?`), by `ShortcutsHost`;
  - `toggle-sidebar` (`shift+.`), by `Sidebar`.

  Nothing else.
- **How a screen binds later.** It calls `useShortcut("snooze-target", snooze, enabled)` and deletes that branch
  from its own listener. The Plan page's and the register's keys move in their own Builds.
- **`?` with a dialog or menu open does nothing** (the Lead's decision; the source toggles).

### 2. Dialog, key caps, tooltip

- **`KeyCaps`** renders `<kbd class="key-cap">` per cap, in a `dialog` or a `tooltip` size.
- **`KeyboardShortcutsDialog`** (props `{ budgetId?, onClose }`, so it can be a plan-menu `Dialog`):
  - It is portalled, with `role="dialog"` and `aria-modal="true"`.
  - Header: `h2` and ✕. Body: four sections, scrollable. Footer: OK.
  - On open it focuses the body with `preventScroll` (the source's 16px scroll on focus is not copied).
  - Escape is handled in the capture phase with `preventDefault` and `stopPropagation`, so the Plan page's Escape
    (clear the selection) does not also run.
  - Tab cycles between ✕ and OK.
  - On close, focus goes back to the element focused at open, if it is still in the page (the Lead's rule; the
    source goes to `<body>`).
- **`ShortcutsHost`** (in `AppShell`) mounts the dispatcher, binds `?` and renders the dialog.
- **`menu-actions/keyboard-shortcuts.tsx`** registers `{ entry: "keyboard-shortcuts", Dialog }`. The entry is
  enabled, also without a plan.
- **`ShortcutTooltip`** (`id`, `align: center | start`) shows the registry's description and caps on hover and on
  focus. It uses the same render-prop shape as `plan/panel/PanelTooltip.tsx`. `account/Tooltip.tsx` (the
  register's key-cap tooltip, already on main) is **not edited**; the two are to be merged later.

### 3. Sidebar (`apps/web/src/shell/`)

- **State.** `sidebarState.ts` is pure:
  - widths: 260 default, 56 collapsed, 600 maximum, snap at 150 or less, narrow at 151–220;
  - keys: `sidebar-is-collapsed` (`"true"`/`"false"`) and `sidebar-preferred-width` (an integer).

  `useSidebarState.ts` is the hook. The state is the same for every plan and is **not** in `ui-state`.
- **First paint.** The hook reads `localStorage` **synchronously in its `useState` initialiser**. `#root` paints
  nothing before React's first commit (there is no server rendering). So the first frame that has the sidebar
  already has the saved width, or the rail, before any data arrives. A12 proves it with the plan list held.
- **Layout.**
  - `nav.sidebar` gets an inline `--sidebar-width`, so the existing `calc(var(--sidebar-width) …)` rules follow.
  - It becomes a flex column: the plan button, then `.sidebar-scroll` (the links, the accounts and Add Account;
    this is where the scroll moves to), then `.sidebar-bottom` with the collapse button.
  - `.sidebar-resizer` is absolute at the right edge, in the margin the rows already leave, so the geometry at 260
    does not change.
  - `.add-account` becomes `calc(var(--sidebar-width) - 36px)`, which is 224 at 260.
  - `.main` stays as it is (`flex: 1; min-width: 0`).
- **Collapse and expand.** The button, the rail's expand button and Shift+. all toggle. A class
  `is-transitioning` gives `width .25s ease` and clips the overflow during the move. Expand restores the preferred
  width.
- **Rail.**
  - Top: a 39×47 button with the app's own `Logo`. Its `aria-label` is the plan's name (or "No Plan Open"). It
    opens `PlanMenu` with `placement="beside"`, placed by the new `placeMenuBeside` at the rail's right edge + 8,
    level with the button.
  - Navigation: the three links as 39×40 icon tiles with `aria-label` and no `title`.
  - Bottom: the expand button with the tooltip aligned to its start.
  - Not rendered: the plan name, the identity, the accounts, the card, Add Account.
  - Bank Connections and the referral banner do not exist in the clone.
- **Drag.**
  - `mousedown` on the resizer calls `preventDefault` (no text selection), and `<html>` gets `user-select: none`.
  - The width is `clamp(startWidth + dx, 56, 600)`, with no transition. The rail layout shows while the width is
    150 or less.
  - The drag ends on `mouseup`, on `mouseleave` of the document element, or on window `blur`.
  - On release: 150 or less → collapsed with preferred 260 (no animation); otherwise preferred = the width.
  - Values are saved on release and on toggle only.
- **151–220** (`is-narrow`): the account and group balances are hidden. The names and the Plan/Reflect/All
  Accounts labels stay.
- **Not applicable:** the source hides the resizer on its plans list page, but no plans list page exists here
  (EXF-471). The referral banner is not in the clone.

### 4. Not-found sidebar (EXF-614)

`notFound = budgetId && !isLoading && !error && !plan` is `PlanScope`'s own condition. The app learns it from
`GET /api/v1/budgets`; there is no per-plan read.

When it is true:
- The plan button reads **"No Plan Open"** and still opens the plan menu (New Plan, Open Plan, Keyboard Shortcuts
  and Log Out enabled).
- There are no Plan, Reflect or All Accounts links, no accounts, no "No Accounts" card, no Add Account, and no
  connections dialog.
- The bottom bar stays. The rail shows only the mark and the expand button.

The account and ui-state reads are already disabled without a plan, and no page mounts. So **no request carries
the missing id**; on a hard load the only one is the document itself. A15 asserts this on the four addresses.

## Downstream effects

- **The main area of every page takes the width the sidebar frees.**
  - The Plan grid has `min-width: 562px` (`plan/plan-grid.css`). At 1024×700 with a 600 sidebar, the main area is
    424 wide, so it scrolls sideways **inside itself** (`.main` overflow). The page does not scroll, and nothing
    overlaps. A window under 822px does the same today.
  - The register and Reflect reflow (Reflect's charts use `ResizeObserver`).
  - No file of the Plan page, the register, the account page or Reflect changes. An overlap found inside one of
    them at 424px goes under known issues, unfixed.
- **Specs:**
  - `plan-menu.spec.ts` case 6: "Keyboard Shortcuts" is now enabled.
  - `plan-menu-registry.spec.ts`: add the `placeMenuBeside` assertions.
  - `shell*.spec.ts` and `sidebar-groups.spec.ts` are edited only where they assert something that changed.

## Out of scope

- Moving the Plan page's or the register's shortcuts into the registry.
- Any binding other than `?` and Shift+. .
- A plans list page.
- Saving the sidebar's state on the server.
- Light theme.
- Merging `account/Tooltip.tsx` into the shared tooltip.

## Custom properties and icons added

- **Tokens:**
  - `--keyCapBackground` rgba(114,116,132,.24)
  - `--keyCapTooltipBackground` rgba(255,255,255,.15)
  - `--tooltipBackground` #3c3e53
  - `--tooltipLabel` #ededf5
  - `--tooltipShadow` 0 2px 5px rgba(0,0,0,.15)
  - `--separatorStandard` rgba(255,255,255,.1)
  - `--sidebar-collapsed` 56px
  - `--sidebar-transition` width .25s ease
  - `--z-tooltip` 40
- **Icons:** `SidebarCloseIcon` and `SidebarOpenIcon`, our own 24×24 drawings: a window with a left panel and a
  triangle pointing left or right.

## Acceptance

**[compare]** cases use this source state: the test plan's **Plan page**, in the Clerk's tab, dark theme, at the
tab's own size (1600×813, never resized), with the sidebar expanded, after a click on an empty part of the page
header. The clone runs in its own page at 1600×813 with its own plan.

1. **[compare] EXF-473 content.**
   - Steps: press `?` and scroll the body.
   - Expected: the title, the four sections in order, and every row's description and caps are equal to the
     source's: `ctrl`, the "then" cap, `0‑6`, and no "also works" text.
2. **[compare] EXF-473 geometry.**
   - Steps: as in 1.
   - Expected: the box is 640×798 and centred, with background rgb(31,32,56) and radius 8. There are two columns
     per section, rows 45 high, caps 28 high on rgba(114,116,132,.24), and OK is 32 high on rgb(84,91,254).
3. **[compare] EXF-473 closing.**
   - Steps: close with OK, then with ✕, then with Escape, reopening with `?` each time.
   - Expected: each one closes the dialog. Clone only: focus returns to the element focused before.
4. **EXF-473 typing.**
   - Steps: open the plan menu, choose New Plan, and type `a?b` in Plan Name.
   - Expected: the field reads `a?b` and no shortcuts dialog opens.
5. **EXF-473 menu entry** (not compared).
   - Steps: open the plan menu with a real mouse and choose Keyboard Shortcuts.
   - Expected: the same dialog opens.
6. **EXF-473 modal open** (not compared, Lead).
   - Steps: open the plan menu and press `?`. Then, with the dialog open, press `?` again.
   - Expected: no dialog over the menu, and still one dialog.
7. **EXF-473 macOS** (not compared).
   - Steps: report the platform as `MacIntel` and open the dialog.
   - Expected: Select All shows `⌘` `A`. The unit tests cover `isMacPlatform` and `capLabel`.
8. **EXF-473 binding** (unit).
   - Expected: `pickShortcut` returns a bound matching id. It returns `null` for an unbound id, a field target, a
     modal open, an extra modifier and a repeat. `useShortcut` on an id without combos throws.
9. **EXF-473 no key swallowed.**
   - Steps: run the Plan and register specs, unedited.
   - Expected: they pass. On the Plan page, ↓ is prevented only by the Plan's own handler.
10. **[compare] EXF-474 collapse button.**
    - Steps: hover the button.
    - Expected: 32×24 at x 216–248, opacity .8→1, the icon as described.
    - Not compared: the tooltip. The clone shows "Expand/Collapse Sidebar" with `shift` `.` above the button after
      .5s (AC6); the source shows none.
11. **[compare] EXF-474 rail.**
    - Steps: click collapse. Then click expand. Then press Shift+. twice.
    - Expected after collapse:
      - about 250 ms to a width of 56;
      - the mark, then three 39×40 tiles at y ≈ 63/107/151, with Plan on #1c1f58;
      - Reflect on hover is #1b1d48, with no tooltip;
      - the expand button's tooltip opens to the right;
      - the main area's left edge is at 56.
    - Expected after expand: 260. Shift+. collapses and expands the same way.
    - **Leave the source expanded.**
12. **EXF-474 first paint.**
    - Steps: collapse and reload with `GET /api/v1/budgets` held. Then set the width to 400 and do the same.
    - Expected: the first frame with the sidebar is 56 wide with the rail, then 400 wide.
13. **EXF-474 drag** (not compared). With a real mouse at 1024×700:
    - to x 400 → 400, kept after a reload;
    - to 200 → balances hidden, labels kept;
    - to 120 → collapsed, and an expand gives 260;
    - beyond 700 → 600;
    - a drag that leaves the window ends there;
    - no text is selected.
14. **EXF-474 rail actions** (not compared).
    - Steps: click the rail's top button, then New Plan; then click each of the three tiles.
    - Expected: the menu opens right of the rail and New Plan is reachable with a real mouse. Each tile navigates
      and becomes active.
15. **EXF-614.**
    - Steps: create a plan with one account and delete it. Open `/<id>/budget`, `/<id>/accounts`,
      `/<id>/accounts/<account id>` and `/<id>/reflect/net-worth`.
    - Expected on each:
      - "Plan not found" and "Go to your plans";
      - the button "No Plan Open" opens the menu;
      - no Plan/Reflect/All Accounts link, no "No Accounts", no Add Account;
      - no non-document request with the id, and no console errors;
      - collapsed, only the mark and the expand button.
16. **EXF-474 narrow window (Lead AC8).**
    - Steps: at 1024×700 with the sidebar at 600, open the Plan page and an account page.
    - Expected:
      - the document's `scrollWidth` is 1024;
      - the sidebar's right edge equals the main area's left edge;
      - x 300 hits the sidebar;
      - a category row is selectable with a real mouse;
      - the register is visible, and wide content scrolls inside the main area.

**Not compared** (outside the source limits, or decided by the Lead): the drag, the snap, 151–220, the resizer
pill, the menu from the rail, the menu entry, `?` with a modal open, focus restore, `⌘`, the first paint, the
collapse button's tooltip, and the not-found sidebar.

## Manifest

touches: [apps/web/src/shell/**, apps/web/src/shortcuts/**, apps/web/src/menu-actions/keyboard-shortcuts.tsx, e2e/shortcuts.spec.ts, e2e/shortcuts-registry.spec.ts, e2e/sidebar-collapse.spec.ts, e2e/sidebar-not-found.spec.ts, e2e/plan-menu.spec.ts, e2e/plan-menu-registry.spec.ts, e2e/shell.spec.ts, e2e/shell-compare.spec.ts, e2e/sidebar-groups.spec.ts, docs/shortcuts-sidebar-design.md, docs/shortcuts-sidebar-spec.md, docs/shortcuts-sidebar-polish.md, docs/README.md]
shared: [apps/web/src/shell/** — the sidebar's rail, resize and not-found state, the plan menu's beside placement, the shortcut host in AppShell, new tokens and icons]
migrations: 0
