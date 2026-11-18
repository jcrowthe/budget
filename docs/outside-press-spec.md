# Outside press used up: implementation spec (EXF-874)

Design: [outside-press-design.md](outside-press-design.md) (the why, the source, the acceptance cases). Main at
`639e60d`. Ground: `apps/web/src/plan/useDismiss.ts`, `MonthPicker.tsx`, `MonthNotePopover.tsx`, the new
`e2e/outside-press.spec.ts`, the docs. Nothing in `apps/web/src/reflect/**`, `apps/worker/**`, `e2e/support/**` or
`e2e/month-nav.spec.ts` changes.

## Interface

```ts
// apps/web/src/plan/useDismiss.ts
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  returnFocus?: RefObject<HTMLElement | null>,
  opts?: { consumeOutsidePress?: boolean },
): void;
```

- **Without `opts`, or with `consumeOutsidePress` false: today's behaviour, byte for byte in effect.** That means
  `document` `keydown` and `document` `pointerdown` (bubble phase); an outside press closes and goes on. Reflect relies
  on this.
- **With `consumeOutsidePress: true`:**
  - `keydown` is unchanged (Escape closes and focuses `returnFocus`).
  - `pointerdown` is listened for on `window` with `{ capture: true }`. The handler:
    - returns when `e.target` is inside `ref` or inside `returnFocus` (today's test: the trigger's own click
      toggles);
    - otherwise calls `e.stopImmediatePropagation()`, `close.current()`, then
      `swallowRestOfPress(e, returnFocus?.current ?? null)`, then `returnFocus?.current?.focus()`.
  - Remove with the same `capture: true` in the cleanup.
  - Read `opts?.consumeOutsidePress` into a boolean const before the effect; the deps become
    `[ref, returnFocus, consume]`.

```ts
// module-level, not exported
function swallowRestOfPress(start: PointerEvent, focusTo: HTMLElement | null): void;
```

- One module-level `let end: (() => void) | null`. A call first runs `end?.()` (a new state replaces an old one).
- It adds on `window`, capture phase:
  - `mousedown`, `mouseup`, `click`, `auxclick`, `contextmenu`: `e.preventDefault(); e.stopImmediatePropagation();`
  - `pointerup`: `e.stopImmediatePropagation()`, and when `focusTo` is connected and
    `document.activeElement !== focusTo`, `focusTo.focus()`.
  - `pointerdown`: when `e !== start`, end the state (do not stop this event).
  - `keydown`: end the state (do not stop it).
- Ending removes all eight listeners and sets `end = null`. No timer, no `setTimeout`, no `requestAnimationFrame`.
- It is not a hook, so its name does not start with `use`.

**Doc comment of `useDismiss`:** add one sentence. With `consumeOutsidePress` (the Plan header's picker and note,
EXF-874), the outside press only closes. It never reaches what is under it (mouse, touch, right press), and focus goes
back to the trigger, as in the source.

## Tasks (commit after each part, in this order)

### Part 1: the month picker

1. **Write `e2e/outside-press.spec.ts` with cases 1, 2, 3 and 5 (below) and run it on the unchanged code.** It must
   fail. Quote the failing line of case 1 (`toBeFocused`, or the POST count) and of cases 2 and 3 in the report. Case 5
   passes (it is a guard: say so).
2. Change `useDismiss.ts` as in "Interface".
3. In `MonthPicker.tsx`: `useDismiss(ref, onClose, triggerRef, { consumeOutsidePress: true });`
4. Verify: `pnpm e2e e2e/outside-press.spec.ts e2e/month-picker-dismiss.spec.ts e2e/month-nav.spec.ts`; all pass.
   Commit.

### Part 2: the month note

1. Add case 4 to the spec. Run it before the note change (it fails at `aria-selected="false"`: quote it).
2. In `MonthNotePopover.tsx`: `useDismiss(ref, onClose, triggerRef, { consumeOutsidePress: true });` Nothing else
   changes: `save` still focuses the trigger, and typed text is still discarded on close.
3. Verify the same three specs pass. Commit.

### Part 3: the other users, the narrow window

1. `pnpm e2e e2e/reflect-frame.spec.ts e2e/reflect-followups.spec.ts e2e/spending-breakdown.spec.ts
   e2e/spending-trends.spec.ts e2e/income-expense.spec.ts e2e/income-expense-narrow.spec.ts e2e/age-of-money.spec.ts
   e2e/net-worth.spec.ts`: all pass unedited.
2. `git diff 639e60d --stat -- apps/web/src/reflect e2e/month-nav.spec.ts e2e/month-picker-dismiss.spec.ts
   e2e/support` is empty.
3. `pnpm check` passes. Commit (docs only, if nothing else changed).

## `e2e/outside-press.spec.ts`

Shape like `e2e/month-picker-dismiss.spec.ts`:
- its own `newPlan` (`POST /api/v1/budgets`, name `testName("outside-press")`), with `afterEach` deleting it;
- `import { realClick } from "./support/real-click"`;
- a `for (const size of [{1440,900},{1024,700}])` block with `test.use({ viewport: size })` for the two-size cases;
- every locator `exact: true`;
- no `test.setTimeout`, no `waitForTimeout`, no retry.

Helpers (local to the spec):
- `M`: the local current month (`key` yyyymm, `iso`, `label` as `"Nov 2026"`), as in `month-nav.spec.ts`.
- `monthButton = page.getByRole("button", { name: M.label, exact: true })`
- `picker = page.getByRole("dialog", { name: "Choose month", exact: true })`
- `note = page.getByRole("dialog", { name: "Month note", exact: true })`
- `option = page.locator(".auto-assign-option").first()`
- `autoAssignPosts(page, id)`: an array filled by `page.on("request", r => …)` with requests whose method is `POST`
  and whose URL contains `/api/v1/budgets/${id}/months/${M.iso}/auto-assign`. Attach it before `page.goto`.
- `targetRow(page, popover)`: reads `popover.boundingBox()`, then returns the first `.category-row` whose
  `.category-name` box top is greater than the popover's bottom + 4 px. It returns
  `{ row, name: row.locator(".category-name") }`. Fail the test with a clear message when none is found.
- `rightPress(page, loc)`: the same topmost check as `realClick` (`elementFromPoint` at the centre is `loc` or inside
  it), then `page.mouse.move(x, y)`, `page.mouse.down({ button: "right" })`, `page.mouse.up({ button: "right" })`.
  (`real-click.ts` is not edited.)
- `tapCentre(page, loc)`: the same topmost check, then `page.touchscreen.tap(x, y)`.

Cases (numbers as in the design's Acceptance):

1. **(both sizes) "a press on an Auto-Assign option outside the picker only closes it":**
   - `goto /${id}/budget`, then `expect(option).toBeEnabled()`.
   - `realClick(monthButton)`, then `expect(picker).toBeVisible()`.
   - `realClick(option)`.
   - `expect(picker).toHaveCount(0)`; `expect(monthButton).toBeFocused()`; `expect(option).toBeEnabled()`;
     `expect(posts).toHaveLength(0)`.
   - Then `const answered = page.waitForResponse(r => POST auto-assign)`, `realClick(option)`, `await answered`,
     `expect.poll(() => posts.length).toBe(1)`.
2. **(1440×900, `test.use({ hasTouch: true })` in its own describe) "a tap on the option outside the picker only
   closes it":**
   - Open the picker with `realClick`.
   - `tapCentre(option)`.
   - `expect(picker).toHaveCount(0)`, `expect(monthButton).toBeFocused()`, `expect(posts).toHaveLength(0)`.
   - A second `tapCentre(option)` with the response awaited, then `expect.poll(() => posts.length).toBe(1)`.
3. **(1440×900) "a right press on a category row outside the picker only closes it":**
   - Open the picker.
   - `const t = await targetRow(page, picker)`; `rightPress(t.name)`.
   - `expect(picker).toHaveCount(0)`; `expect(page.getByRole("dialog")).toHaveCount(0)` (no "Edit Category");
     `expect(t.row).toHaveAttribute("aria-selected", "false")`; `expect(monthButton).toBeFocused()`.
4. **(both sizes) "a press on a category row outside the month note only closes it":**
   - `realClick(page.locator(".month-note"))`.
   - `expect(page.getByRole("textbox", { name: "Month note", exact: true })).toBeFocused()`, then `.fill("ZZ-TEST
     draft")`.
   - `const t = await targetRow(page, note)`, then `realClick(t.name)`.
   - `expect(note).toHaveCount(0)`; `expect(t.row).toHaveAttribute("aria-selected", "false")`;
     `expect(page.locator(".month-note")).toBeFocused()`; `expect(page.locator(".month-note")).toHaveText("Enter a
     note...")`.
   - `realClick(t.name)`, then `expect(t.row).toHaveAttribute("aria-selected", "true")`.
5. **(both sizes) "a press on the month button closes the picker and it stays closed":**
   - Open the picker; `realClick(monthButton)`.
   - `expect(picker).toHaveCount(0)`, `expect(monthButton).toHaveAttribute("aria-expanded", "false")`,
     `expect(monthButton).toBeFocused()`.

**Reading the target row before the press:** `targetRow` must be called **while the popover is open** (it measures
the popover's box), and before the press.

**Seeing the press is used up:** `posts` is filled synchronously by Playwright's `request` event. The proof is the
second press: requests arrive in order, so had the first press sent a POST, the count after the second would be 2.

## Checks before handing over

- `pnpm check` passes (Biome, types, the repository tests, including the source-name and formatter tests: this Build
  adds no formatting and no copy).
- No file outside the Manifest's `touches` changed: `git diff 639e60d --stat`.
- No dependency was added. No `waitForTimeout`, retry, `setTimeout`, `test.setTimeout` or raised `expect` limit in the
  diff.
- The report quotes the failing lines before each fix, and lists any departure (none is planned).
