# Plan menu: reachable submenu, full entry list, colours (EXF-571, EXF-470, EXF-454)

## Feature

The plan menu opens from the plan button at the top of the sidebar.

- **EXF-571.** The Open Plan submenu was `position: absolute` inside `nav.sidebar` (`overflow-y: auto`), which
  clipped it, so no mouse could reach another plan. Now the menu and submenu render outside the sidebar, fully
  visible, every row clickable with a real mouse.
- **EXF-470.** The full menu structure, the signed-in identity on the plan button, and an action registry.
- **EXF-454.** The menu's width and the hover and active colours match the measured source values.

## Source

**Carry-over Build: nobody opens the source app** (forbidden by the Lead). Everything below was measured by the
first Build (`p_5ee85fce…`); its study notes stayed in that box and are not copied. That study used the plan
"Test Budget" at 1600×813 in the dark app theme; the clone follows the dark theme, as in `scaffold-design.md`.

The submenu's look comes from the EXF-470 ticket: a "Recent Plans" heading, up to 5 plans with a document icon,
a separator, then a folder icon and "View All Plans".

Summary of the source:

- **Plan button.** Box 8,8 243×46, radius 8, hover `#1b1d48`. Logo 24 px at x 16; at x 48 the plan name
  (18px/600, white, ellipsis) over the email (12px/500, white at 0.7); a 12 px caret-down at the right.
- **Menu.** `div role=menu` portalled to `<body>`, `position: fixed`, top z-index. `left` = button left (8),
  `top` = button bottom + 8 (y 62), height to 16 px above the window bottom, scrolls. Background `#1f2038`,
  radius 4, padding 4, shadow `0 16px 64px rgba(0,0,0,.2)`, 0.2 s opacity fade.
  Width: `min-width: 15rem (240px); max-width: 30rem`, shrink-to-fit; the widest cloned row ("Manage Bank
  Connections") needs 228 px, so **240 px**. The 243 px seen before is 240 plus a classic 15 px scrollbar: the
  source's longer menu (834 px of content) overflows. The ticket's 240 px was right.
- **Rows.** `role=menuitem` buttons, 32.8 px (padding 8px 12px, line height 16.8), gap 12, radius 4. Icon 16 px
  `#9b9caa`; label 14px/500 white. Hover background `#292b3d`, colours unchanged, no transition. Heading
  12px/600 `#c4c5cf`, padding 8px 12px, sentence case. Separator 1 px `rgba(255,255,255,.08)`, margin 4px 12px.
  Disabled rule (unused in source): colour `#9b9caa`, no hover background.
- **Entries, source order.** New Plan; Open Plan ›; Current Plan (Plan Settings, Manage Payees, Edit Flags,
  Display Options, Export Plan, Make a Fresh Start); Share YNAB (Refer a Friend, Gift, Hide Amounts, Together);
  Account (Account Settings, Manage Bank Connections, Join a Workshop, Keyboard Shortcuts); Log Out; Legal
  (three links). Glyphs in the notes.
- **Behaviour.** The button toggles; Escape closes and refocuses the button; an outside click closes (no
  overlay). Opening leaves focus on the page; no arrow-key navigation.
- **Sidebar items.** Plan/Reflect/All Accounts: transparent, hover `#1b1d48`, selected `#1c1f58` (also on
  hover), text white, no `:active` rule. Add Account `rgba(255,255,255,.15)`, `.2` on hover and pressed.

## Approach

### 1. Positioning (EXF-571)

`PlanMenu` renders through `createPortal(…, document.body)`, so nothing of the menu stays inside `nav.sidebar`
and it can never widen or scroll the sidebar. No portal exists in the web app yet and `apps/web/src/plan/` is off
limits, so the shell gets its own pure helper, `apps/web/src/shell/menuPlacement.ts` (no React).

- **Menu.** `position: fixed`; `left = button.left`, `top = button.bottom + 8`; `max-height = innerHeight − top
  − 16`, `overflow-y: auto`; `min-width: 240px; max-width: 480px`. (The source sets an explicit height; the
  clone's shorter menu would then show an empty panel, so it uses `max-height`.)
- **Submenu.** A second fixed element, a sibling of the menu in the same portal (never its child: the menu's
  `overflow` would clip it). `placeSubmenu(menu, row, size, vw, vh)` places it from the menu's and the **Open
  Plan row's** rects: **`left = row.right`, `top = row.top`**. It starts at the row's right edge, so it overlaps
  the menu's 4 px right padding, and level with the row's top. At 1440×900 (menu left 8, 240 wide, no
  scrollbar): left **244** (8 + 240 − 4), top = the Open Plan row's top. That is 4 px left of and 4 px below
  the first Build's `left = menu.right`, `top = row.top − 4`. Both elements are `.menu` (`--z-menu`) and the
  submenu comes later in the portal, so it paints over the padding it overlaps. **Flip** to `left = menu.left −
  width` when `row.right + width > innerWidth − 8`; if that is `< 8` too, **shift** to `max(8, innerWidth − 8 −
  width)` (overlapping the menu). Vertically `top` is clamped into `[8, innerHeight − 8 − height]`,
  `max-height: innerHeight − 16`, scrolling.
- **Recompute** in `useLayoutEffect` on open, on window `resize` and on the menu's `scroll`.
- **Stacking.** `--z-menu: 25`: above page content (plan header 10), below dialogs (30). A 0.2 s opacity
  fade-in animation (no effect on hit testing).
- **Outside click** means outside the button, the menu **and** the submenu (not in the menu's DOM node).

### 2. Keyboard and pointer model

This follows the WAI-ARIA menu button pattern. The source has no keyboard model; the Lead requires one.

- **Plan button.** It has `aria-haspopup="menu"`, `aria-expanded` and `aria-controls`. Its accessible name is
  the plan name, given by `aria-label` (or "Budget" when no plan is open). Its `aria-describedby` points to the
  identity line. This keeps existing locators such as `getByRole("button", { name })` working.
- **Opening.**
  - A mouse click (`event.detail > 0`) opens the menu and focuses the menu element (`tabIndex=-1`); no row is
    highlighted, as in the source.
  - Enter, Space or ArrowDown on the button opens it and focuses the first enabled row. ArrowUp focuses the
    last.
- **Inside the menu.** Every row has `tabIndex=-1`, and focus moves with the keys:

  | Key | Action |
  |---|---|
  | ArrowDown / ArrowUp | Next or previous **enabled** row, wrapping; disabled rows are skipped |
  | Home / End | First or last enabled row |
  | Enter / Space | Activates the focused row |
  | ArrowRight or Enter on Open Plan | Opens the submenu and focuses its first enabled row |
  | ArrowLeft or Escape in the submenu | Closes the submenu and refocuses Open Plan |
  | Escape in the menu | Closes the menu; focus returns to the plan button |
  | Tab | Closes the menu; focus returns to the plan button |

- **Pointer.**
  - Hovering Open Plan opens the submenu at once. Hovering another first-level row closes it after 200 ms,
    unless the pointer enters the submenu first. A path from Open Plan into the submenu never shuts it.
  - Clicking Open Plan opens the submenu (it does not toggle).
  - Clicking a disabled row does nothing, and the menu stays open.
  - Selecting an enabled row closes the menu first, then performs the row's action.
- **Focus styling.** A focused row (`:focus-visible`) gets the hover background `--menuHover` and no outline.

### 3. Entries and the action registry (EXF-470, Lead notes 2–4)

**The entry list.** The order, ids and icons live in a pure module, `apps/web/src/shell/planMenuEntries.ts`:

| Section | id | Label | Icon (own art) | Today |
|---|---|---|---|---|
| — | `new-plan` | New Plan | plus in circle (exists) | enabled (registered action) |
| — | `open-plan` | Open Plan › | folder (exists) + chevron | built in; shown only when another plan exists |
| Current Plan | `plan-settings` | Plan Settings | wrench | disabled (EXF-468) |
| | `manage-payees` | Manage Payees | arrows in circle | disabled (EXF-510) |
| | `edit-flags` | Edit Flags | flag | disabled (EXF-480) |
| | `display-options` | Display Options | paint roller | disabled (EXF-472) |
| | `export-plan` | Export Plan | document with down arrow | disabled (EXF-476) |
| | `fresh-start` | Make a Fresh Start | leaf | disabled (EXF-478) |
| Account | `bank-connections` | Manage Bank Connections | bank (exists `BankIcon`) | disabled (EXF-460) |
| | `keyboard-shortcuts` | Keyboard Shortcuts | keyboard | disabled (EXF-473) |
| — | `log-out` | Log Out | door with arrow | built in: `<a href="/cdn-cgi/access/logout">` |
| submenu | `view-all-plans` | View All Plans | folder | disabled (EXF-471) |

- **Separators** come after Open Plan (or after New Plan when Open Plan is hidden), after the Current Plan
  group, and after the Account group.
- **Not cloned:** Share YNAB (including Hide Amounts), Account Settings, Join a Workshop, and Legal.

**Registry rule.** A feature enables its entry by adding one file `apps/web/src/menu-actions/<id>.ts(x)`
exporting `action: PlanMenuAction`; `apps/web/src/shell/planMenuActions.ts` collects them with
`import.meta.glob("../menu-actions/*.{ts,tsx}", { eager: true })`. An action is `{ entry, run(ctx) }`
(navigate, download) or `{ entry, Dialog }` (the `Sidebar` renders it after the menu closes, with `{ budgetId,
onClose }`). An entry with an action is enabled; otherwise it has `aria-disabled="true"`, colour
`--labelTertiary`, `cursor: default`, no hover background, and the arrow keys skip it. `needsPlan` entries (the
Current Plan six and bank-connections) stay disabled while no plan is open. `collectPlanMenuActions` throws on an
unknown id, a duplicate, or a built-in id (`open-plan`, `log-out`). Registered today: only
`menu-actions/new-plan.tsx` (`{ entry: "new-plan", Dialog: NewPlanDialog }`), which replaces the Sidebar's
hand-wired New Plan state and is the worked example. The rule goes into `docs/conventions.md`.

**Open Plan (note 5).** `recentOtherPlans(plans, currentId, 5)` in `useCurrentPlan.ts` (next to
`pickLastOpened`): other plans by `last_opened_at` descending, never-opened last, ties in server order, at most 5.
Open Plan is hidden when it is empty. The submenu (`role=menu`, `aria-label="Plans"` as today): "Recent Plans"
heading; one react-router `<Link role="menuitem" to="/<id>/budget">` per plan (document icon, ellipsised name);
a separator; "View All Plans" (disabled).

### 4. Identity: `GET /api/v1/me` and the plan button (note 7)

- `packages/schema/src/me.ts`: `Me` = `{ kind: "user", email }` | `{ kind: "service", name }`;
  `MeResponse = dataEnvelope(Me)`. Route `apps/worker/src/routes/me.ts` reads `c.get("identity")` from the
  unchanged middleware: a user gets its email, a service its actor without `service:`. Never `actor` or token
  fields; no identity is already a 403. **No MCP tool**: `/me` describes the caller, not plan data, and
  EXF-572's REST-vs-tools test excludes it by design (see Carry-over changes). Web: `useMe()` in `apps/web/src/api/me.ts` (`["me"]`,
  `staleTime: Infinity`).
- **Plan button:** logo, a column with `.name` (18px/600) over `.identity` (12px/500, `--labelMuted`, ellipsis:
  the email or service name), caret. Height stays 46; while `/me` loads the line is absent and the name centred.
  Padding `5px 8px 5px 0`, logo margin `0 8px`, as in the source (logo x 16, text x 48, unchanged).

### 5. Colours and sizes (EXF-454)

The source was compared value by value with `tokens.css` and `global.css` at main 82aac3a.

**Equal (no change):** sidebar background `#121330`; nav hover `#1b1d48` (`--sidebarHover`); nav selected
`#1c1f58` (`--sidebarActive`, wins on hover by rule order); nav text white; Add Account `.15`/`.2`; plan button
hover `#1b1d48`; menu background `#1f2038` (`--backgroundTertiary`); row hover `#292b3d` (`--menuHover`); icon
`#9b9caa` (`--labelTertiary`); heading `#c4c5cf` (`--labelSecondary`); separator `rgba(255,255,255,.08)`
(`--borderSubtle`); shadow, radius; menu top 62 and left 8.

**Differences, both changed:**

| What | Source | Clone before | After |
|---|---|---|---|
| Menu width | `min-width 240px`, `max-width 480px`, shrink-to-fit → **240 px** (243.03 only with a 15 px scrollbar) | fixed `calc(260px − 17px)` = 243 px | `min-width: var(--menu-min-width)` (240px), `max-width: var(--menu-max-width)` (480px) |
| Menu row height | 32.8 px (padding 8 + line height 16.8) | fixed `height: 33px` | `height: auto`, 32.8 px |

**New tokens** for the new pieces, with no colour changes:

- `--menu-min-width: 240px`, `--menu-max-width: 480px`, `--menu-edge: 16px`, `--z-menu: 25`;
- `--menuDisabledLabel: var(--labelTertiary)`, the source's `--labelTertiary`, `#9b9caa`.

**Pressed state.** No `:active` rule in the source; the clone's hover rules already match. Nothing to add.

### 6. Favicon (note 9)

Today `/favicon.ico` falls through to the SPA's HTML.

- Add `apps/web/public/favicon.ico`: a 32×32 PNG of the existing own-art `favicon.svg` in an ICO container.
- Add `<link rel="icon" href="/favicon.ico" sizes="32x32">` in `apps/web/index.html`, before the SVG link.
- The Worker already serves `public/` through `ASSETS`.

## Carry-over changes

This Build merges the cancelled first Build's branch (fast-forward to `378b72b` on main `2d1982e`) and changes:

1. **Submenu placement** (§1; the first Build's one polish item, already in `378b72b`, kept). Tests:
   `e2e/plan-menu-registry.spec.ts` "placement" derives its expected `{ left, top }` from the `row` input;
   `expectSubmenuReachable` (`e2e/plan-menu.spec.ts`) drops the "starts right of the menu" check, asserts
   left = row right and top = row top (±0.5), and real-mouse-checks every submenu row before clicking plan A.
2. **REST and MCP.** No MCP tool for `GET /api/v1/me`. The owner's rule (a tool for every REST operation) is
   enforced by EXF-572's test, which lists `/me` as excluded by design: it describes the caller. This Build
   touches neither `apps/worker/src/mcp/tools/**` nor that test.
3. **Merge with main.** Nothing else, unless `pnpm check` or a full e2e run fails because of main's changes
   since `82aac3a` (account header, All Accounts register, `transactions.updated_at`); then only that fix,
   recorded here.

## Downstream effects

- An e2e step that picks a plan from Open Plan needs it among the **5 most recently opened other plans** (the
  e2e database is shared by workers): `e2e/plans.spec.ts` (EXF-569) and `e2e/plan-urls.spec.ts` (~line 265)
  mark the target opened (`PATCH /api/v1/budgets/{id}` `{ opened: true }`) just before opening the menu.
- `e2e/shell-compare.spec.ts` "plan menu matches the source" moves to the new entries, 240 px and 32.8 px rows.
- The plan button's accessible name stays the plan name; existing locators keep working.
- Later Builds (EXF-468, 510, 480, 472, 476, 478, 460, 473, 471) each add one file in `menu-actions/`.
- EXF-460 replaces the Sidebar's `?add-accounts=connections` stopgap with a `bank-connections` action.

## Out of scope

The targets behind the disabled entries; the collapsed sidebar's logo button (EXF-474); sidebar resize; the light
theme; the Share, Legal, Account Settings and workshop entries; archived plans; any use of the source app.

## Acceptance

"Mouse-click X": `page.mouse.move` to the centre of X's box; assert X's box is inside the viewport and
`document.elementFromPoint` there is X or inside X; then `page.mouse.click` there. Never a locator `.click()` on a
menu row. Set-ups use the API with `ZZ-TEST` names. Local identity: `e2e@localhost` (e2e), `dev@localhost` (dev).

1. **(EXF-571) Submenu by mouse, 1440×900.** Set-up: plans A and B; mark A opened; open `/<B>/budget`.
   Mouse-click the plan button; move to Open Plan's centre. Expected: the submenu is visible, fully inside the
   viewport, its left = Open Plan's right (244) and its top = Open Plan's top, each ±0.5; every submenu row
   passes the elementFromPoint check; `nav.sidebar` has `scrollWidth === clientWidth`, `scrollLeft 0`.
   Move horizontally into the submenu, then mouse-click A's row: URL `/<A>/budget`, sidebar button name A.
2. **(EXF-571) Case 1 at 1024×700.** Same results.
3. **(EXF-571) 640×700, A with a 60-character name.** The submenu is fully inside the window (`left ≥ 8`); A's
   row passes the mouse-click check and opens A.
4. **(EXF-571) 1024×480.** The menu's bottom ≤ `innerHeight − 16` and it scrolls; after a mouse wheel over it,
   Log Out passes the elementFromPoint check (not clicked); the submenu still opens fully inside the window.
5. **(EXF-571) Keyboard.** Focus the plan button, Enter: focus on New Plan. ArrowDown → Open Plan; ArrowDown →
   Log Out (disabled rows skipped); ArrowUp → Open Plan. ArrowRight: submenu open, focus on its first plan.
   ArrowLeft: submenu closed, focus on Open Plan. ArrowRight then Escape: only the submenu closes. Escape: menu
   closed, focus on the plan button. Reopen, Tab: closed, focus on the button. Reopen, ArrowDown, ArrowRight,
   Enter: the first plan opens.
6. **(EXF-470) Entries** (≥2 plans). `menuitem` names in order (exact): New Plan, Open Plan, Plan Settings,
   Manage Payees, Edit Flags, Display Options, Export Plan, Make a Fresh Start, Manage Bank Connections, Keyboard
   Shortcuts, Log Out. Headings "Current Plan", "Account"; 3 `role=separator`; one 16 px `svg` icon per row.
   Only New Plan, Open Plan, Log Out lack `aria-disabled="true"`; disabled rows have colour `rgb(155, 156, 170)`,
   `cursor: default`, a transparent background on hover; mouse-clicking Edit Flags leaves the menu open and the
   URL unchanged.
7. **(EXF-470) Recent plans.** Stub `GET /api/v1/budgets` (`page.route`): the open plan plus 7 others (5 with
   distinct `last_opened_at`, 2 null). The submenu: "Recent Plans", the 5 most recent (most recent first) each
   linking `/<id>/budget`, no null plan, a separator, "View All Plans" with `aria-disabled="true"`.
8. **(EXF-470) Single plan.** Stub the list with only the open plan: no Open Plan row; New Plan is followed by
   the separator.
9. **(EXF-470) Close paths.** The button again closes; Escape closes and the button has focus; a mouse click on
   the page header closes; New Plan opens the New Plan dialog and the menu is gone.
10. **(EXF-470) Log Out** is an `<a>` with `href="/cdn-cgi/access/logout"` and passes the elementFromPoint
    check. Not clicked.
11. **(EXF-470) Registry** (Node-side spec). A throwaway map `{ entry: "edit-flags", run: spy }`: Edit Flags
    resolves enabled and invoking it calls the spy with the context; from a map without it, disabled again; an
    unknown id, a duplicate and `log-out` throw.
12. **(EXF-470) Identity.** `GET /api/v1/me` (e2e token) answers `{ data: { kind: "user", email:
    "e2e@localhost" } }`; the plan button shows `e2e@localhost` under the name, 12px/500, `rgba(255, 255, 255,
    0.7)`. Worker tests: user → email; service token → its name; no token → 403; the path is documented.
13. **(EXF-454) Measurements, 1440×900.** Menu 240 px wide, left 8, top = button bottom + 8; rows 32.8 ± 0.1;
    New Plan hover `rgb(41, 43, 61)`, label white; Plan `rgb(28, 31, 88)` (also hovered); Reflect hover
    `rgb(27, 29, 72)`; Add Account `rgba(255, 255, 255, 0.15)`, hover `0.2`. The Tester saves clone screenshots
    of each state.
14. **Favicon.** `GET /favicon.ico`: 200, `image/` content type, body starts `00 00 01 00`; `index.html` links it.
15–17. **Compare with the source: not compared, forbidden by the Lead in this Build.** The measurements in
    §Source and §5 stand in for the source; cases 1 and 13 assert them in the clone.
18. **Submenu vs ticket** (Tester, clone only). Matches EXF-470: heading, up to 5 plans with document icons,
    separator, "View All Plans", in the first-level menu's look.

## Manifest

touches: [apps/web/src/shell/PlanMenu.tsx, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/useCurrentPlan.ts, apps/web/src/shell/tokens.css, apps/web/src/shell/global.css, apps/web/src/shell/icons.tsx, apps/web/src/shell/planMenuEntries.ts, apps/web/src/shell/planMenuActions.ts, apps/web/src/shell/menuPlacement.ts, apps/web/src/menu-actions/**, apps/web/src/api/me.ts, packages/schema/src/me.ts, apps/worker/src/routes/me.ts, apps/worker/test/me.test.ts, apps/web/public/favicon.ico, apps/web/index.html, e2e/plan-menu.spec.ts, e2e/plan-menu-registry.spec.ts, e2e/support/menu.ts, e2e/plans.spec.ts, e2e/plan-urls.spec.ts, e2e/shell-compare.spec.ts, e2e/shell.spec.ts, docs/conventions.md, docs/plan-menu-design.md, docs/plan-menu-spec.md, docs/plan-menu-polish.md, docs/README.md]
shared: [apps/web/src/shell/** (PlanMenu, Sidebar, useCurrentPlan, tokens.css, global.css, icons.tsx and three new pure shell modules: the menu, its submenu and the plan button live in the shell; this Build is the only one holding the shell)]
migrations: 0
