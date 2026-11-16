# Plan menu: implementation spec (EXF-571, EXF-470, EXF-454)

Design: [plan-menu-design.md](plan-menu-design.md). This spec covers the tasks in order, each with its files,
symbols and how to verify it. **Carry-over Build:** tasks 1–11 are done on the merged branch (`378b72b`); do not
redo them. The work left is task 12.

## Rules for every task

- Do not touch these files: `apps/web/src/plan/**`, the account/register/category files listed in the design's
  scope, and every `paths.always_overlap` file (configs, package.json, lockfile, `apps/worker/src/env.ts`).
- No `pnpm add`: React 19 already has `createPortal` in `react-dom`.
- Colours and sizes come only from `tokens.css` variables.
- Own icons only. Never the source's name, logo or art. Nobody opens the source app in this Build.
- Also off limits: `apps/worker/src/mcp/tools/**` and any REST-vs-tools test (EXF-572). No MCP tool for `/me`.
- Browser specs for menu rows use the real-mouse helper (task 9), never a locator `.click()` on a menu row.
- Use `{ exact: true }` names in new locators.

## Task 1: `/me` schema, route and test

`packages/schema/src/me.ts`:

```ts
export const Me = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), email: z.string() }),
  z.object({ kind: z.literal("service"), name: z.string() }),
]).openapi("Me");
export const MeResponse = dataEnvelope(Me).openapi("MeResponse");
export type Me = z.infer<typeof Me>;
```

`apps/worker/src/routes/me.ts`: default export
`new OpenAPIHono<AppEnv>().openapi(createRoute({ method: "get", path: "/me", tags: ["Identity"], responses: { 200, 403 (ErrorBody) } }), handler)`.

- The handler reads `const id = c.get("identity")`.
  - For `id.kind === "user"`, it returns `{ data: { kind: "user", email: id.email ?? "" } }`.
  - Otherwise it returns `{ data: { kind: "service", name: id.actor.replace(/^service:/, "") } }`.
- Do not change `middleware/access.ts` or `env.ts`.

`apps/worker/test/me.test.ts`, written in the style of `access.test.ts` and `budgets.test.ts`:

- `json("/api/v1/me")` with the default local token returns `{ kind: "user", email: "tester@localhost" }`.
- A service token, built exactly as `access.test.ts` "records a known service token under its name" does
  (`ACCESS_SERVICE_TOKENS` map → "ci-token"), returns `{ kind: "service", name: "ci-token" }`.
- No token returns 403.
- `apiPaths()` (from `surface.ts`) contains `/api/v1/me`.

Verify with `pnpm check`. The derived `openapi.test.ts` picks up the route on its own.

## Task 2: Web identity read

`apps/web/src/api/me.ts`:

```ts
export const getMe = async (): Promise<Me> => (await apiFetch("/api/v1/me", { schema: MeResponse })).data;
export const useMe = () => useQuery({ queryKey: ["me"], queryFn: getMe, staleTime: Number.POSITIVE_INFINITY });
export const identityLabel = (me: Me | undefined) => me ? (me.kind === "user" ? me.email : me.name) : "";
```

## Task 3: Pure modules (no React runtime imports, only `import type`)

These modules use only `import type`, so a Node-side Playwright spec can import them.

`apps/web/src/shell/planMenuEntries.ts`:

```ts
export const REGISTRABLE = ["new-plan","plan-settings","manage-payees","edit-flags","display-options",
  "export-plan","fresh-start","bank-connections","keyboard-shortcuts","view-all-plans"] as const;
export type RegistrableEntryId = (typeof REGISTRABLE)[number];
export type BuiltInEntryId = "open-plan" | "log-out";
export type PlanMenuEntryId = RegistrableEntryId | BuiltInEntryId;
export type PlanMenuContext = { budgetId: string | null; navigate: (to: string) => void };
export type PlanMenuAction =
  | { entry: RegistrableEntryId; run: (ctx: PlanMenuContext) => void }
  | { entry: RegistrableEntryId; Dialog: ComponentType<{ budgetId: string | null; onClose: () => void }> };
export type PlanMenuActionModule = { action?: PlanMenuAction };
export type IconKey = "plus-circle"|"folder"|"wrench"|"arrows-circle"|"flag"|"paint-roller"
  |"document-down"|"leaf"|"bank"|"keyboard"|"logout"|"document";
export type EntryDef = { id: PlanMenuEntryId; label: string; icon: IconKey; needsPlan: boolean };
export type MenuSection = { heading: string | null; entries: EntryDef[] };
export const PLAN_MENU: MenuSection[];      // [ {null,[new-plan, open-plan]}, {"Current Plan",[6]}, {"Account",[2]}, {null,[log-out]} ]
export const VIEW_ALL_PLANS: EntryDef;      // { id: "view-all-plans", label: "View All Plans", icon: "folder", needsPlan: false }
export function collectPlanMenuActions(mods: Record<string, PlanMenuActionModule>): Map<RegistrableEntryId, PlanMenuAction>;
export type ResolvedEntry = EntryDef & { enabled: boolean; action?: PlanMenuAction };
export function resolveEntry(def: EntryDef, actions: Map<RegistrableEntryId, PlanMenuAction>, hasPlan: boolean): ResolvedEntry;
```

The table rows and the `needsPlan` values come from design §3: true for the six Current Plan entries and
`bank-connections`.

**`collectPlanMenuActions`**

- Iterates the map's keys in sorted order and skips modules without `action`.
- Throws `Error("plan menu: unknown entry <id> in <file>")` when the id is not in `REGISTRABLE`. This also
  covers `open-plan` and `log-out`.
- Throws `"plan menu: <id> registered twice (<file>, <file>)"` on a duplicate.

**`resolveEntry`**

- `open-plan` and `log-out` are always `enabled: true`. The caller decides whether Open Plan is shown.
- Every other entry has `enabled = actions.has(id) && (!def.needsPlan || hasPlan)`.

`apps/web/src/shell/menuPlacement.ts`:

```ts
export type Rect = { left: number; top: number; right: number; bottom: number };
export const MENU_GAP = 8, MENU_EDGE = 16, VIEW_MARGIN = 8;
export function placeMenu(button: Rect, vh: number): { left: number; top: number; maxHeight: number };
export function placeSubmenu(menu: Rect, row: Rect, size: { width: number; height: number }, vw: number, vh: number): { left: number; top: number; maxHeight: number };
```

**`placeMenu`** returns `left = button.left`, `top = button.bottom + 8`, `maxHeight = vh − top − 16`.

**`placeSubmenu`**

- Horizontal:
  - Start with `left = row.right` (the Open Plan row's right edge; overlaps the menu's 4 px padding).
  - If `left + w > vw − 8`, use `left = menu.left − w`.
  - If that is `< 8`, use `left = max(8, vw − 8 − w)`.
- Vertical:
  - `top = row.top`, then `top = min(top, vh − 8 − h)` and `top = max(8, top)`.
  - `maxHeight = vh − 16`.

## Task 4: Registry glob and the first action

`apps/web/src/shell/planMenuActions.ts`:

```ts
export const planMenuActions = collectPlanMenuActions(
  import.meta.glob<PlanMenuActionModule>("../menu-actions/*.{ts,tsx}", { eager: true }));
```

`apps/web/src/menu-actions/new-plan.tsx`:
`export const action: PlanMenuAction = { entry: "new-plan", Dialog: NewPlanDialog };`.
`NewPlanDialog` is imported from `../shell/NewPlanDialog` and its props stay unchanged.

Verify that `pnpm check` typechecks it: a misspelt `entry` must be a type error.

## Task 5: `recentOtherPlans`

`apps/web/src/shell/useCurrentPlan.ts` adds:

```ts
/** Other plans, most recently opened first (never opened last; ties keep list order); at most n. */
export function recentOtherPlans(plans: Budget[], currentId: string | undefined, n = 5): Budget[];
```

Use a stable sort on `last_opened_at` descending; `null` sorts after any string.

## Task 6: Icons

`apps/web/src/shell/icons.tsx` adds new own-art 16×16 icons, each with `viewBox="0 0 16 16"`,
`fill="currentColor"`, `aria-hidden`, and `{...p}` spread like the existing ones:

- `WrenchIcon`, `ArrowsCircleIcon`, `FlagIcon`, `PaintRollerIcon`, `DocumentDownIcon`, `LeafIcon`,
  `KeyboardIcon`, `LogoutIcon`.

Reuse `PlusCircleIcon`, `FolderIcon`, `DocumentIcon`, `BankIcon` and `ChevronRightIcon`.

`PlanMenu.tsx` holds a `Record<IconKey, (p) => JSX>` map.

## Task 7: `PlanMenu.tsx` (rewrite)

```ts
export function PlanMenu(props: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  openedByKeyboard: boolean;            // focus first enabled row (true) or the menu element (false)
  initialFocus?: "first" | "last";
  onClose: (opts: { focusButton: boolean }) => void;
  onDialog: (action: Extract<PlanMenuAction, { Dialog: unknown }>) => void;
}): ReactPortal;
```

**Rendering.** `createPortal(<>{menu}{submenu}</>, document.body)`.

- Menu: `<div className="menu" role="menu" id="plan-menu" aria-label="Plan" tabIndex={-1} style={{left, top, maxHeight}}>`.
  Its content, section by section from `PLAN_MENU`:
  - a separator `<div role="separator" className="menu-separator">` before every section after the first;
  - the section's heading `<div className="menu-heading">` when it has one;
  - one row per entry.
- Rows:
  - An enabled action row is `<button type="button" role="menuitem" tabIndex={-1}>` with the icon, a
    `<span className="label">` and `data-entry={id}`.
  - A disabled row is the same `<button>` with `aria-disabled="true"`, without `disabled`, so the hit test and
    styling still work. Its `onClick` does nothing.
  - Open Plan is rendered only when `recentOtherPlans(...)` is non-empty. It has `aria-haspopup="menu"`,
    `aria-expanded={sub}`, `aria-controls="plan-submenu"` and a trailing `ChevronRightIcon className="chevron"`.
  - Log Out is `<a role="menuitem" tabIndex={-1} href="/cdn-cgi/access/logout">`.
- Submenu, when `sub` is true: `<div className="menu submenu" role="menu" id="plan-submenu" aria-label="Plans">`,
  containing:
  - `.menu-heading` "Recent Plans";
  - one `<Link role="menuitem" tabIndex={-1} to={`/${p.id}/budget`} onClick={() => close(false)}>` per plan,
    with `DocumentIcon` and the name;
  - a separator;
  - the `VIEW_ALL_PLANS` row, resolved like the others (disabled today).

**Positioning.**

- `useLayoutEffect` with `placeMenu(anchorRef.current.getBoundingClientRect(), innerHeight)`.
- For the submenu: measure its `offsetWidth` and `offsetHeight` after the first render (render it with
  `visibility: hidden` until placed), then call `placeSubmenu(menuRect, openRowRect, size, innerWidth,
  innerHeight)`.
- Recompute on window `resize` and on the menu's `scroll`.

**Selection.** `select(entry)`:

- Disabled: return.
- Open Plan: open the submenu.
- `run` action: `close(true)`, then `action.run({ budgetId, navigate })`.
- `Dialog` action: `close(false)`, then `onDialog(action)`.

**Dismissal.**

- On document `mousedown`, close (`focusButton: false`) unless the target is inside the anchor, the menu or the
  submenu. The anchor's own click toggles the menu.
- The Escape and Tab keys follow the design's keyboard table.

**Keyboard.** One `onKeyDown` per menu, as in design §2.

- `focusables(container)` returns the `[role=menuitem]:not([aria-disabled=true])` elements in DOM order.
- ArrowDown/ArrowUp wrap; Home/End.
- ArrowRight or Enter/Space on Open Plan opens the submenu, then focuses its first focusable row.
- In the submenu, ArrowLeft and Escape close it and focus Open Plan. Call `e.stopPropagation()` so the
  document-level Escape does not also close the menu.

**Hover.**

- `onMouseEnter` of Open Plan: clear the timer and set `sub = true`.
- `onMouseEnter` of any other first-level row: `timer = setTimeout(() => setSub(false), 200)`.
- `onMouseEnter` of the submenu: clear the timer.
- Clear the timer on unmount.

**Initial focus.**

- `openedByKeyboard`: focus the first focusable row, or the last when `initialFocus === "last"`.
- Otherwise focus the menu element.

## Task 8: `Sidebar.tsx`, plan button, styles

**`Sidebar.tsx`**

- State: `menu: null | { keyboard: boolean; focus: "first" | "last" }` and
  `dialog: { Dialog, key } | null`.
- Use a `buttonRef`. Remove the `newPlan` state and the inline `<NewPlanDialog>`; the New Plan dialog now comes
  from the registered action.
- Render `{dialog ? <dialog.Dialog budgetId={plan?.id ?? null} onClose={() => setDialog(null)} /> : null}`.
- Close handler: `setMenu(null)`; when `focusButton` is true, `buttonRef.current?.focus()`.
- Keep the `?add-accounts=connections` code as is.

**Plan button:**

```tsx
<button ref={buttonRef} type="button" className="plan-button" aria-haspopup="menu" aria-expanded={!!menu}
  aria-controls={menu ? "plan-menu" : undefined} aria-label={plan?.name ?? "Budget"}
  aria-describedby={label ? "plan-identity" : undefined}
  onClick={(e) => setMenu(m => m ? null : { keyboard: e.detail === 0, focus: "first" })}
  onKeyDown={/* ArrowDown → open keyboard "first"; ArrowUp → open keyboard "last" (preventDefault) */}>
  <Logo className="logo" />
  <span className="plan-text"><span className="name">…</span>{label ? <span id="plan-identity" className="identity">{label}</span> : null}</span>
  <CaretIcon />
</button>
```

**`tokens.css`.** Add `--menu-min-width: 240px; --menu-max-width: 480px; --menu-edge: 16px; --z-menu: 25;
--menuDisabledLabel: var(--labelTertiary);`. Change no existing value.

**`global.css`**

- `.plan-button`: padding `5px 8px 5px 0`; remove `gap`; `.logo` gets `margin: 0 var(--space-2)`.
- `.plan-text`: flex 1, column, `min-width: 0`.
- `.name`: as today.
- `.identity`: 12px/500, line-height 1.2, `--labelMuted`, ellipsis/nowrap.
- `.plan-button svg:last-child`: `margin-left: auto`.
- `.menu`:
  - `position: fixed`;
  - remove the `top`/`left`/`width` rules;
  - `min-width: var(--menu-min-width)` and `max-width: var(--menu-max-width)`;
  - `overflow-y: auto`, `z-index: var(--z-menu)`, `display: flex; flex-direction: column`;
  - `animation: menu-fade .2s` (`@keyframes menu-fade { from { opacity: 0 } }`);
  - keep the background, radius, padding and shadow.
- `.menu [role=menuitem]`, which replaces `.menu button` so the `<a>` and `Link` rows match:
  - flex, gap 12, padding 8px 12px, **no fixed height**, radius 4;
  - 14px/500, `line-height: var(--line-height)`, colour `--labelPrimary`;
  - `text-decoration: none`, `white-space: nowrap`, transparent background, no border, `cursor: pointer`;
  - `outline: none` on focus.
- Hover and focus: `:hover:not([aria-disabled=true])`, `:focus-visible` and `[aria-expanded=true]` get
  `--menuHover`.
- `[aria-disabled=true]`: colour `--menuDisabledLabel`, `cursor: default`.
- The `.label`, svg and chevron rules stay as today, retargeted to `[role=menuitem]`.
- `.menu-heading`: replaces `.submenu-heading` and keeps its values.
- `.menu-separator`: `border-top: 1px solid var(--borderSubtle)`, `margin: 4px 12px`, `flex: none`.
- `.submenu`: `max-height` is set inline. Delete the old absolute rules and `.menu-item-wrap`.

Verify:

- `.sidebar` keeps `overflow-y: auto`.
- No rule still positions the menu inside the sidebar.
- `pnpm dev`, then at 1440×900 hover Open Plan: the submenu is fully visible to the right of the menu.

## Task 9: E2E specs

**Helper** `mouseClick(page, target, { click = true })` in `e2e/support/menu.ts`: asserts the box is inside the
window, moves the mouse to its centre, asserts `target.contains(document.elementFromPoint(x, y))`, then clicks.

To reach a submenu row, move horizontally from Open Plan's centre into the submenu: to
`(submenu.x + 20, openPlanCentreY)`, then call `mouseClick` on the row.

**Set-up.**

- Create plans with `request.post("/api/v1/budgets")` and `authHeaders()`, named with `testName()`.
- Mark a plan opened with `PATCH /api/v1/budgets/{id}` `{ opened: true }` right before `page.goto`, so it is
  in the top 5 despite parallel workers.

**`e2e/plan-menu.spec.ts`** covers acceptance cases 1–10, 12 and 14 of the design:

- `test.describe` blocks with `test.use({ viewport })` for 1440×900, 1024×700, 640×700 and 1024×480.
- Stub the plan list for cases 7 and 8 with `page.route("**/api/v1/budgets", …)`: fetch the real response,
  replace `data.budgets`, and fulfil.
- Case 4: `page.mouse.wheel(0, 400)` over the menu, then `mouseClick(logOut, { click: false })`.
- Case 12: `request.get("/api/v1/me")`, then the button text, then `getComputedStyle` of `.identity`.
- Case 14: `request.get("/favicon.ico")` with auth headers; check the status, the content type and the first 4
  bytes.

**`e2e/plan-menu-registry.spec.ts`** is a Node-only spec with no `page`; it imports from
`../apps/web/src/shell/planMenuEntries` and `../apps/web/src/shell/menuPlacement`.

- Case 11: build the registry from `{ "./x.ts": { action: { entry: "edit-flags", run: spy } } }`, resolve
  Edit Flags, call its `run`, and check the spy. Resolve again from `{}` and check `enabled === false`. Check
  that unknown, duplicate and `log-out` ids throw.
- `placeSubmenu`: right placement, flip, shift (`left ≥ 8`) and vertical clamp, with literal rects.

**Existing specs.** Change only what the new menu requires:

- `e2e/shell-compare.spec.ts`, "plan menu matches the source":
  - the item list becomes the design's case-6 list (with ≥2 plans present: the spec already creates one plan;
    add a second with `request` if Open Plan is needed);
  - the width becomes `toBe(240)`;
  - the row height becomes `toBeCloseTo(32.8, 1)`;
  - hover with `page.mouse.move` to the centre of New Plan.
- `e2e/plans.spec.ts` (EXF-569): before opening the menu to switch back to A, `PATCH` A `opened`. Replace the
  two `menuitem` locator clicks (Open Plan, A) with `mouseClick`. Nothing else.
- `e2e/plan-urls.spec.ts`, around lines 184 and 265: the same two changes, and only where a submenu row is
  clicked. C10's `getByRole("menu", { name: "Plans" })` keeps working.
- `e2e/shell.spec.ts`: change it only if it fails.

Verify with `pnpm e2e e2e/plan-menu.spec.ts e2e/plan-menu-registry.spec.ts e2e/shell-compare.spec.ts
e2e/plans.spec.ts e2e/plan-urls.spec.ts`, then the same with `--repeat-each=3` for `plan-menu.spec.ts`.

## Task 10: Favicon

1. Render `apps/web/public/favicon.svg` to a 32×32 PNG with Playwright's Chromium. Run this one-off script in
   `/workspace/scratch`, not in the repository: `page.setContent(<img src=data:svg>)` and
   `screenshot({ omitBackground: true, clip })`.
2. Write `apps/web/public/favicon.ico`: an ICONDIR (`00 00 01 00 01 00`), one 16-byte entry (`20 20 00 00 01 00
   20 00 <size LE32> <offset 22 LE32>`), then the PNG bytes.
3. In `apps/web/index.html`, add `<link rel="icon" href="/favicon.ico" sizes="32x32" />` above the SVG link.

Verify with design case 14.

## Task 11: Docs

- Add one paragraph to `docs/conventions.md`, after the steps list, headed **Plan menu entries**:

  > The plan menu's entries are fixed in `apps/web/src/shell/planMenuEntries.ts`. An entry is enabled by adding
  > one file `apps/web/src/menu-actions/<entry-id>.ts(x)` that exports
  > `action: PlanMenuAction` (`{ entry, run(ctx) }` or `{ entry, Dialog }`). The shell collects it with
  > `import.meta.glob`; never edit the shell to enable an entry. Unregistered entries are shown disabled.

- `docs/README.md`: the design's line is already added by the Architect. Keep every line on rebase.

## Task 12: Carry-over (the only open work)

1. **Check change 1 is in place** (it is, in `378b72b`): `apps/web/src/shell/menuPlacement.ts` `placeSubmenu`
   has `left = row.right`, `top = row.top`, no `SUB_OFFSET`, and the flip, shift and clamp unchanged.
2. **`e2e/plan-menu-registry.spec.ts`, test "placement".** Replace the literal expectation with one derived from
   the inputs: `toEqual({ left: row.right, top: row.top, maxHeight: 900 - 2 * VIEW_MARGIN })` (import
   `VIEW_MARGIN`); this is `{ left: 244, top: 100, maxHeight: 884 }`. Keep the flip, shift and clamp asserts.
3. **`e2e/plan-menu.spec.ts`, `expectSubmenuReachable`.** Keep: no "submenu x ≥ menu right" assert; inside the
   window; when `aName === undefined`, `s.x` ≈ Open Plan's right and `s.y` ≈ Open Plan's top (`toBeCloseTo(…,
   0)`); the sidebar `scrollWidth === clientWidth`, `scrollLeft === 0`. Add, before clicking plan A: for every
   `sub(page).getByRole("menuitem")` (plans and "View All Plans"), `await mouseClick(page, row, { click: false
   })`, which proves each row is topmost at its centre with the real mouse. Then `mouseClick` on A as now.
   The comments that say "Source (Designer, …)" become "design §1".
4. **Merge fallout.** If `pnpm check` or a full `pnpm e2e` fails because of main's changes, fix only that and
   add one line to the design's "Carry-over changes" item 3 saying what it was.

Verify: `pnpm check`; `pnpm e2e e2e/plan-menu.spec.ts e2e/plan-menu-registry.spec.ts --repeat-each=3`;
then the full `pnpm e2e` (three runs pass for acceptance, at most `e2e/plans.spec.ts:4` flaky).

## Final check

- `pnpm check` passes.
- The task 9 specs pass.
- `git diff --name-only origin/main` lists only files in the design's Manifest, and none of the out-of-bounds
  files.
