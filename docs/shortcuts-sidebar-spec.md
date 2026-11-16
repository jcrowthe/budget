# Spec: keyboard shortcuts, sidebar collapse and resize, not-found sidebar (EXF-473, EXF-474, EXF-614)

The design is in `docs/shortcuts-sidebar-design.md`, with the rules and acceptance cases A1–A16. The values the build needs are
here. The study notes, kept in the Architect's box only, are in `/workspace/scratch/source/shortcuts-sidebar/`.

**Do not edit:**
- `apps/web/src/{plan,register,account,api,reflect}/**`, the Worker, `packages/**`, and `paths.always_overlap`;
- `e2e/support/real-click.ts` and `e2e/plan-grid.fixtures.ts`.

No dependency and no migration.

The pure modules (`registry.ts`, `keys.ts`, `sidebarState.ts`, `menuPlacement.ts`) import nothing from React, the
DOM or `import.meta`, so Playwright specs can import them, as `plan-menu-registry.spec.ts` does.

## T1. Registry and keys (pure): `shortcuts/registry.ts`, `shortcuts/keys.ts`

```ts
export const THEN = { then: true } as const;
export type Cap = string | typeof THEN;
export type SectionId = "universal" | "plan" | "account" | "date-picker";
export const SHORTCUT_SECTIONS: { id: SectionId; title: string }[]; // Universal, Plan Actions, Account Actions, Date Picker
export type Shortcut = { id: ShortcutId; section: SectionId; description: string; caps: readonly Cap[]; combos?: readonly string[] };
export const SHORTCUTS: readonly Shortcut[];   // ticket order, `as const satisfies`
export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
export function shortcutById(id: ShortcutId): Shortcut;
```

**Content:**
- Descriptions and caps are as in EXF-473, without the "(… also works)" notes.
- Caps are lower-case for named keys (`shift`, `ctrl`, `escape`, `delete`, `tab`, `click`) and upper-case for
  letters. `↑/↓` is one cap. Flag is `shift` `F` `THEN` `0‑6` (U+2011). The date picker's navigation is four caps:
  `↑` `↓` `←` `→`.

**Ids and combos:**

| Section | id: combos |
|---|---|
| Universal | `open-help`: `?` · `toggle-sidebar`: `shift+.` · `select-all`: `ctrl+a` · `deselect-all`: `escape` · `math-operations`: none · `undo`: `ctrl+z` · `redo`: `ctrl+shift+z`, `ctrl+y` |
| Plan | `snooze-target`: `shift+z` · `toggle-groups`: `ctrl+arrowup`, `ctrl+arrowdown` · `plan-move`: `arrowup`, `arrowdown` · `plan-extend`: `shift+arrowup`, `shift+arrowdown` |
| Account | `add-transaction`: `shift+n` · `approve`: `a` · `approve-all`: `shift+l` · `reject`: `shift+r` · `categorize`: `k` · `split`: `s` · `enter-now`: `e` · `match`: `m` · `unmatch`: `shift+u` · `toggle-cleared`: `c` · `duplicate`: `shift+d` · `flag`: none · `make-repeating`: `shift+t` · `delete`: `delete`, `backspace` · `reconcile`: `shift+e` · `focus-search`: `ctrl+shift+f` · `select-group`: none · `select-multiple`: `shift+arrowup`, `shift+arrowdown` · `move-transactions`: `arrowup`, `arrowdown` · `next-field`: none · `previous-field`: none |
| Date Picker | `date-navigate`, `date-next-day`, `date-previous-day`, `date-today`, `date-month-start`, `date-month-end`, `date-year-start`, `date-year-end`: none |

```ts
export type KeyLike = { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  repeat?: boolean; isComposing?: boolean; defaultPrevented?: boolean };
export type Combo = { key: string; ctrl: boolean; shift: boolean; shiftFree: boolean; code?: string };
export function isMacPlatform(nav: { platform?: string; userAgentData?: { platform?: string } }): boolean;
export function capLabel(cap: string, mac: boolean): string;   // "ctrl" -> "⌘" on mac
export function parseCombo(text: string): Combo;
export function comboMatches(c: Combo, ev: KeyLike): boolean;
export function pickShortcut(ev: KeyLike, ctx: { bound: ReadonlySet<ShortcutId>; inField: boolean; modalOpen: boolean }): ShortcutId | null;
```

**Rules:**
- `shiftFree`: no `shift` part and a single non-alphanumeric key.
- `shift+.` carries `code: "Period"` and also accepts `key ">"`.
- Shift must equal `shiftKey` unless `shiftFree`. The key matches `ev.key.toLowerCase()` or `ev.code === code`.
- `alt` never matches.
- `ctrl` means `ctrlKey || metaKey`; a modifier the combo does not name refuses.
- `pickShortcut` applies the five guards, then returns the first bound match in registry order.

**Verify:** `e2e/shortcuts-registry.spec.ts` (Playwright, no `page`):
- The 40 rows, as `${title}|${description}|${caps, THEN as "then"}`, equal a literal list typed from the ticket.
  The ids are unique.
- `isMacPlatform`: true for `MacIntel` and `macOS`, false for Linux and `Win32`, and `userAgentData` wins.
- `capLabel`: `ctrl` becomes `⌘` on mac only.
- `comboMatches`:
  - `?`: Shift is ignored, Ctrl refuses.
  - `shift+.`: `>`, and `:` with `code Period`, match; a plain `.` does not.
  - `ctrl+a`: `metaKey` matches, Ctrl+Shift does not.
  - `a`: Shift refuses, Alt refuses.
- `pickShortcut`: returns `null` when the id is unbound, and for each of the five guards.

## T2. Dispatcher: `shortcuts/dispatcher.ts`

```ts
export type ShortcutHandler = (e: KeyboardEvent) => void;
export function useShortcut(id: ShortcutId, handler: ShortcutHandler, enabled?: boolean): void;
export function useShortcutDispatcher(): void;   // once, in ShortcutsHost
export const MODAL_SELECTOR = '[role="dialog"], [role="menu"], [aria-modal="true"], dialog[open]';
export const FIELD_SELECTOR = "input, textarea, select, [contenteditable]";
```

- **Handlers.** A module-level `Map<ShortcutId, ShortcutHandler[]>`, with each handler kept in a ref. `useShortcut`
  pushes in `useEffect` and removes on cleanup, and the last one mounted wins. When the id has no combos it throws
  `shortcut <id> has no key combination`.
- **Listener.** One `window` `keydown` listener, bubble phase.
  - `inField`: `target.closest(FIELD_SELECTOR)` or `isContentEditable`.
  - `modalOpen`: `!!document.querySelector(MODAL_SELECTOR)`.
  - `bound`: the ids that have at least one handler.
  - With a result from `pickShortcut`: `preventDefault()`, then call the handler. Otherwise do nothing at all.

## T3. Caps, tooltip, dialog, host, menu action

- **`shortcuts/KeyCaps.tsx`.** `KeyCaps({ caps, variant: "dialog" | "tooltip" })` renders `span.key-caps.{variant}`
  with:
  - `<kbd class="key-cap">` holding `capLabel(cap, mac)` for each cap;
  - `<span class="key-cap then">then</span>` for `THEN`.

  `mac` is computed once at module level.
- **`shortcuts/ShortcutTooltip.tsx`.**
  `ShortcutTooltip({ id, align = "center", children: (p: TriggerProps) => ReactElement })`.
  - `TriggerProps` is the same as in `plan/panel/PanelTooltip.tsx`.
  - It wraps the trigger in `span.shortcut-tip-anchor` (relative, inline-flex).
  - While hovered or focused it renders
    `<span role="tooltip" class="shortcut-tooltip is-{align}"><span class="desc"/><KeyCaps variant="tooltip"/></span>`.
  - Escape hides it and calls `stopPropagation`.
- **`shortcuts/KeyboardShortcutsDialog.tsx`.** `({ onClose }: { budgetId?: string | null; onClose(): void })`,
  portalled to `body`:
  ```
  div.dialog-backdrop
    div.dialog.shortcuts [role=dialog, aria-modal=true, aria-labelledby]
      div.dialog-head
        h2  "Keyboard Shortcuts"
        button.icon-button [aria-label="Close"] > CloseIcon
      div.shortcuts-scroll [tabIndex=-1]
        section*  (h3 + ul > li > span.desc + KeyCaps)
      div.dialog-footer
        button.primary  "OK"
  ```
  - `opener = useState(() => document.activeElement)[0]`.
  - On mount: `scroll.focus({ preventScroll: true })`.
  - A capture-phase `document` keydown listener:
    - Escape → `preventDefault`, `stopPropagation`, `onClose()`;
    - Tab / Shift+Tab cycle between ✕ and OK.
  - On unmount: focus `opener` if it is an `HTMLElement` that `isConnected`.
  - Add `overflowed` to the dialog while `scrollHeight > clientHeight`.
- **`shortcuts/ShortcutsHost.tsx`.** It runs `useShortcutDispatcher()` and
  `useShortcut("open-help", () => setOpen(true))`, and renders the dialog while it is open. `AppShell` renders
  `<ShortcutsHost />` once, after `<main>`.
- **`shortcuts/shortcuts.css`** (tokens from T5; values from the notes):

  | Selector | Rules |
  |---|---|
  | `.dialog.shortcuts` | `width: 640px; max-width: calc(100vw - 32px); padding: 0; box-shadow: var(--shadowMenu)`; open animation opacity 0 / `scale(.8)` → 1 over .15s |
  | header | 48px high, padding 0 16, `border-bottom: 1px solid var(--borderSubtle)` |
  | `h2` | 18/600 |
  | ✕ | 16px icon in `--actionPrimary` |
  | `.shortcuts-scroll` | `max-height: calc(100vh - 8rem); overflow: auto; padding: 16px 16px 0; font: 500 14px/1.5 var(--font); outline: none` |
  | `h3` | 16/600, margin 0 |
  | `ul` | `column-count: 2; column-gap: 24px; margin: 14px 0; padding: 0 0 16px; list-style: none` |
  | `li` | `display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--borderSubtle); break-inside: avoid` |
  | `.key-caps` | `display: flex; gap: 4px` |
  | dialog `.key-cap` | inline-flex, centred, min 28×28, padding 0 8, `--radius-xs`, `--keyCapBackground`, 14px, `font-family: inherit` |
  | `.key-cap.then` | transparent background |
  | footer | padding 16, end-aligned; `.overflowed` adds `border-top: 1px solid var(--separatorStandard)` |
  | OK | 32 high, padding 6px 16px, radius 8, `--buttonPrimaryBackground`, hover `--actionPrimary`, 16/500 |
  | `.shortcut-tooltip` | `position: absolute; bottom: calc(100% + 8px); width: max-content; max-width: 18rem; display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: var(--radius-md); background: var(--tooltipBackground); color: var(--tooltipLabel); box-shadow: var(--tooltipShadow); font-size: 12px; font-weight: 400; z-index: var(--z-tooltip); pointer-events: none; animation: tip-in .2s .5s both` (opacity 0 → 1) |
  | `.is-center` | `left: 50%; transform: translateX(-50%)` |
  | `.is-start` | `left: 0` |
  | tooltip caps | min 20×20, padding 0 4, radius 4, `--keyCapTooltipBackground`, 14/400 |
- **`menu-actions/keyboard-shortcuts.tsx`.**
  `export const action: PlanMenuAction = { entry: "keyboard-shortcuts", Dialog: KeyboardShortcutsDialog };`

## T4. Sidebar state: `shell/sidebarState.ts` (pure) and `shell/useSidebarState.ts`

```ts
export const SIDEBAR_DEFAULT = 260, SIDEBAR_COLLAPSED = 56, SIDEBAR_MAX = 600, SNAP_AT = 150, NARROW_AT = 220;
export const KEY_COLLAPSED = "sidebar-is-collapsed", KEY_WIDTH = "sidebar-preferred-width";
export type SidebarSaved = { collapsed: boolean; preferred: number };
export function readSidebarState(get: (k: string) => string | null): SidebarSaved;
export function clampWidth(w: number): number;              // round, clamp 56..600
export function releaseWidth(live: number): SidebarSaved;   // <=150 -> {true, 260}; else {false, round(live)}
export function isNarrow(w: number): boolean;               // 150 < w <= 220
export function useSidebarState(): {
  collapsed: boolean; width: number;  // live while dragging, else collapsed ? 56 : preferred
  showRail: boolean;                  // dragging ? live <= 150 : collapsed
  narrow: boolean; dragging: boolean; transitioning: boolean;
  toggle(): void; onResizerMouseDown(e: React.MouseEvent): void; endTransition(): void;
};
```

**`readSidebarState`:**
- `collapsed` is `"true"` only.
- `preferred` is an integer in 151..600, else 260.
- A `get` that throws gives the defaults.

**`useSidebarState`:**
- **Initial state:** `useState(() => readSidebarState((k) => localStorage.getItem(k)))`. No effect reads storage.
- **Saving:** in `toggle` and on release only, each write wrapped in try/catch.
- **`toggle`:** flips `collapsed`, sets `transitioning`, and arms a 300 ms fallback timeout that calls
  `endTransition`.
- **Drag:**
  - Mousedown (button 0): `preventDefault`, record `startX` and `startWidth = width`, add `sidebar-resizing` to
    `<html>`, and listen for `document` mousemove/mouseup, `documentElement` mouseleave and `window` blur.
  - Move: `live = clampWidth(startWidth + clientX - startX)`.
  - End: `releaseWidth(live)`, save, and clean up.

**Verify:** pure tests at the top of `e2e/sidebar-collapse.spec.ts`, at these boundary values:
- `readSidebarState`: nothing saved, `"true"`, `"400"`, `"100"`, `"700"`, `"abc"`, and a throwing get;
- `releaseWidth`: 150, 151 and 400.4;
- `clampWidth`: 20 and 900;
- `isNarrow`: 150, 151, 220 and 221.

## T5. Sidebar markup, styles, icons, menu placement

- **`tokens.css`:** the nine tokens in the design.
- **`icons.tsx`:** `SidebarCloseIcon` and `SidebarOpenIcon`, 24×24 with `currentColor`, each one even-odd path.
  - A rounded rectangle from y 2 to 22, radius 2, with a hollow left panel from x 2 to 7.
  - A solid triangle: the base at x 18 and the tip at x 12 for close, mirrored for open.
- **`Sidebar.tsx`:**
  ```
  nav.sidebar [aria-label=Sidebar, style={{"--sidebar-width": `${width}px`}},
               is-collapsed(showRail) | is-narrow | is-resizing | is-transitioning,
               onTransitionEnd(width) -> endTransition]
    plan button  |  button.rail-logo (Logo, aria-label, aria-haspopup=menu)
    div.sidebar-scroll
      .nav
      SidebarAccounts
      card
      Add Account
    div.sidebar-bottom
      ShortcutTooltip toggle-sidebar > button.sidebar-collapse [aria-label="Expand/Collapse Sidebar"] > SidebarCloseIcon
        (rail: align start, button.sidebar-expand, same aria-label, SidebarOpenIcon)
    div.sidebar-resizer [aria-hidden, onMouseDown] > span.sidebar-resizer-indicator
    menus and dialogs as today
  ```
  - One `buttonRef` serves the plan button or the rail logo.
  - `toggle` also closes the menu.
  - `useShortcut("toggle-sidebar", toggle)`.
  - In the rail, each `NavLink` has an `aria-label`, shows its icon only and has no `title`.
- **`global.css`:**

  | Selector | Rules |
  |---|---|
  | `.sidebar` | `display: flex; flex-direction: column; overflow: visible` (the scroll moves) |
  | `.sidebar-scroll` | `flex: 1; min-height: 0; overflow-y: auto` |
  | `.sidebar.is-transitioning` | `transition: var(--sidebar-transition); overflow: hidden` |
  | `.sidebar.is-resizing` | `overflow: hidden` |
  | `.add-account` | `width: calc(var(--sidebar-width) - 36px)` |
  | `.sidebar-bottom` | `flex: none; display: flex; align-items: center; justify-content: flex-end; height: 28px; padding: 12px 0; box-sizing: content-box; border-bottom: 1px solid var(--borderSubtle)` |
  | `.sidebar-collapse`, `.sidebar-expand` | 32×24, padding 0, no border or background, `--labelPrimary`, opacity .8 (1 on hover and focus-visible), pointer; the icon is aligned to the start |
  | `.sidebar-collapse` | `margin-right: calc(var(--space-2) + var(--sidebar-resizer))` |
  | `.is-collapsed .sidebar-bottom` | column, centred, `height: auto` |
  | `.rail-logo` | 39×47, margin 8px 5px 8px 8px, radius 6, a centred 24px Logo, hover `--sidebarHover` |
  | `.is-collapsed .nav` | `margin: 0 5px 4px 8px` |
  | `.is-collapsed .nav a` | 39×40, padding 0, centred |
  | `.is-narrow .nav-accounts .value` | `display: none` |
  | `.sidebar-resizer` | `position: absolute; inset: 0 0 0 auto; width: var(--sidebar-resizer); cursor: ew-resize; z-index: 1` |
  | `.sidebar-resizer-indicator` | `position: fixed; top: calc(50% + 1.25rem); margin-left: 8px; width: 8px; height: 40px; border-radius: 100px; background: var(--actionPrimary); opacity: 0; transition: opacity .25s; pointer-events: none`; opacity 1 on `.sidebar-resizer:hover` and `.is-resizing` |
  | `html.sidebar-resizing, html.sidebar-resizing *` | `user-select: none; cursor: ew-resize` |
- **`menuPlacement.ts`:** `placeMenuBeside(button: Rect, railRight: number, vh: number)` returns
  `{ left: railRight + MENU_GAP, top: button.top, maxHeight: max(0, vh - button.top - MENU_EDGE) }`.
- **`PlanMenu.tsx`:** a new prop `placement?: "below" | "beside"`.
  - With `"beside"` it uses `placeMenuBeside(rect, a.closest("nav")?.getBoundingClientRect().right ?? rect.right, innerHeight)`.
  - Sidebar passes `"beside"` when `showRail`.
- **Verify:**
  - `plan-menu-registry.spec.ts` "placement": `placeMenuBeside({left:8,top:8,right:47,bottom:55}, 56, 700)` →
    `{left:64, top:8, maxHeight:676}`.
  - `shell-compare` and `sidebar-groups` stay green unedited.

## T6. Not-found sidebar: `shell/Sidebar.tsx`

- `notFound = !!budgetId && !isLoading && !error && !plan`.
- When it is true:
  - the name and `aria-label` (and the rail logo's `aria-label`) read "No Plan Open";
  - do not render `.nav`, `SidebarAccounts`, the card, Add Account or the connections dialog.
- The menu, its dialogs, the identity line and the bottom bar stay.
- Pages without a `budgetId` are unchanged.

## T7. Browser specs

Every case below is the design's case of the same number; this list only adds how to test it.

Rules:
- Each spec makes its own plan through the API and runs in a fresh context (empty `localStorage`).
- Clicks and hovers use `realClick` (imported) or `page.mouse`. Drags use `mouse.down`, then
  `mouse.move(…, {steps: 5})`, then `mouse.up`.
- After a toggle, wait with `expect.poll(width)`.
- Use exact names.
- Call `unrouteAll({ behavior: "ignoreErrors" })` in `afterEach` where routes are used.

Helpers: `sidebar` (the "Sidebar" navigation), `width()` (its rect width), and `toggleBtn` (its button
"Expand/Collapse Sidebar").

**`e2e/shortcuts.spec.ts`:**
- **A1.** Click an empty point of the page header with the mouse, then press `?`.
  - The `h3` are the four titles. There are 40 `li`, and their text is built from `SHORTCUTS`. Flag has
    `.key-cap.then`.
  - Repeat on `/<id>/accounts` and `/<id>/reflect`.
- **A3.**
  - Close with OK, with ✕ and with Escape.
  - Then: `toggleBtn.focus()`, `?`, Escape → `toggleBtn` is focused.
- **A4.** Through New Plan, type `a?b`.
- **A5.** Through realClick on the plan button.
- **A6.** As described in the design.
- **A7.** Use a new context with `storageState: ".e2e-state/auth.json"` and an init script that defines
  `Navigator.prototype.platform` as `"MacIntel"`.
- **A9.** realClick a category name, then:
  - ↓ moves the selection;
  - Shift+. collapses the sidebar and leaves the selected row as it was.

**`e2e/sidebar-collapse.spec.ts`** (the pure T4 tests first):
- **A10.**
  - `toggleBtn` is 32×24 with its right edge at 248.
  - After a 700 ms hover, the `role=tooltip` text and caps are right, and the tooltip sits above the button.
- **A11.**
  - The tiles are 39×40 at x 8.
  - `main.main` has left 56.
  - The expand button's tooltip shows.
  - Shift+. toggles both ways.
- **A12.**
  - Route `**/api/v1/budgets` to wait on a gate promise.
  - An `addInitScript` runs a `requestAnimationFrame` loop. On the first frame where `nav.sidebar` exists, it stores
    `{ w, rail: !!document.querySelector(".rail-logo") }` in `window.__first`.
  - Reload, read `__first`, then open the gate.
- **A13** at 1024×700 (`test.use({ viewport })`), with one account seeded through the API:
  - targets as in the design, with ±1 px;
  - the window-leave case uses `page.evaluate` to dispatch `mouseleave` on `document.documentElement` between two
    moves;
  - `getSelection().toString()` is `""`.
- **A14.**
  - The menu "Plan" has left ≥ 56.
  - Each tile changes the URL and becomes `.active`.
- **A16.**
  - `scrollWidth` is 1024.
  - The sidebar's right edge is the main area's left edge.
  - `elementFromPoint(300, 350)` is in the sidebar.
  - A category row is selected by realClick (new plans have default categories).
  - The register table is visible.

**`e2e/sidebar-not-found.spec.ts` (A15):**
- Create a plan with one account, then delete the plan.
- Collect:
  - requests whose URL contains the id, except `isNavigationRequest()`;
  - console `error` messages and `pageerror`.
- On each of the four addresses: the heading, the link, "No Plan Open", and 0 Plan/Reflect/All Accounts links, 0
  "No Accounts" and 0 "Add Account".
- Rail: 0 links.
- The menu: New Plan is enabled and Plan Settings is `aria-disabled`.
- Both collections end as `[]`.

**Existing specs:**
- `plan-menu.spec.ts` case 6: add Keyboard Shortcuts to the enabled names.
- `plan-menu-registry.spec.ts`: the T5 placement assertions.
- `shell*.spec.ts` and `sidebar-groups.spec.ts`: edit only an assertion about something that changed, and name it
  in the report.

## T8. Checks

1. Run `pnpm check`.
2. Run `pnpm e2e e2e/shortcuts-registry.spec.ts e2e/shortcuts.spec.ts e2e/sidebar-collapse.spec.ts e2e/sidebar-not-found.spec.ts e2e/shell.spec.ts e2e/shell-compare.spec.ts e2e/sidebar-groups.spec.ts e2e/plan-menu.spec.ts e2e/plan-menu-registry.spec.ts e2e/plan-urls.spec.ts`.
3. Run the unedited key-handling specs (A9): `pnpm e2e e2e/plan-selection.spec.ts e2e/target-snooze.spec.ts e2e/plan-panel.spec.ts e2e/plan-grid.spec.ts e2e/register.spec.ts e2e/register-entry.spec.ts e2e/splits.spec.ts`.
4. Run the new specs with `--repeat-each=3`.
5. Check that `git diff --stat origin/main` touches nothing outside the design's Manifest.
