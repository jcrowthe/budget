# Month picker dismiss and Activity amount column: implementation spec (EXF-727 with EXF-745)

Design: [month-picker-dismiss-design.md](month-picker-dismiss-design.md). The design is authoritative for the cause,
the measurements, the acceptance cases and the source rules. Work in the order below and commit after each part.
Every click a spec makes uses `realClick(page, locator)` from `e2e/support/real-click.ts` (import it; never edit it).
Locators use `{ exact: true }`. Specs make their own plan through the API and delete it in `afterEach`.

## Ground

**In bounds:**
- `apps/web/src/plan/useDismiss.ts`, `apps/web/src/plan/activity-popover.tsx`, `apps/web/src/plan/activity-popover.css`
- the new `e2e/month-picker-dismiss.spec.ts`, `e2e/activity-amount.spec.ts` and `e2e/support/activity-amount-seed.ts`
- the three `docs/month-picker-dismiss-*` files and one line in `docs/README.md`

**Out of bounds:**
- everything in note 8 of the brief: `apps/worker/**`, `apps/web/src/{shell,account,pages,register,api}/**`,
  `packages/**`, `playwright.config.ts` and every `paths.always_overlap` file, `e2e/support/real-click.ts`,
  `scripts/e2e-load*`
- `apps/web/src/reflect/**`: it needs no edit, because the fix is in the hook
- `e2e/month-nav.spec.ts` and `e2e/activity-popover*.spec.ts`: run them, do not edit them

Any edit to an existing test's expectation or wait is a departure: list it in the report.

## Part 1: EXF-745 (failing spec first, then the fix)

### 1a. Seed: `e2e/support/activity-amount-seed.ts`

Use `call` from `./register-seed` (as `plan-formats-seed.ts` does) or the `call`/`testName` pattern of
`activity-popover-seed.ts`. API only.

```ts
export const AMOUNT_MONTH: string; // "2026-11-01"; specs fix the clock at 2026-11-16T12:00:00 (as activity-popover specs)
export type AmountSeed = { id: string; categoryId: string; account: string };
/** A plan with one account "ZZ Checking" (balance 0, 2026-11-02), group "ZZ Group", category "ZZ Wide",
 *  and approved transactions in ZZ Wide on 2026-11-10..12: -888_880, +88_888_880, -888_888_880 milliunits,
 *  payee "ZZ Payee". */
export async function seedAmounts(request: APIRequestContext): Promise<AmountSeed>;
/** Adds one approved transaction of `amount` milliunits to ZZ Wide on 2026-11-13. */
export async function addAmount(request: APIRequestContext, s: AmountSeed, amount: number): Promise<void>;
export const removeAmountPlan: (request: APIRequestContext, s: { id: string }) => Promise<unknown>;
```

The plan name comes from `testName("activity-amount")`.

### 1b. Spec: `e2e/activity-amount.spec.ts` (design acceptance 5 and 6)

`for (const size of [{width:1440,height:900},{width:1024,height:700}])` → `test.describe` with
`test.use({ viewport: size, timezoneId: "UTC" })` and `page.clock.setFixedTime(new Date("2026-11-16T12:00:00"))`.
Then go to `/${id}/budget/202611` and open ZZ Wide's Activity with
`realClick(page, page.locator(".category-row", { hasText: "ZZ Wide" }).locator(".activity-button"))`. Wait for
`.activity-note` count 0.

**Test "5. amounts of 8, 10 and 12 wide characters are whole":**
- For each of `−$888.88`, `$88,888.88`, `−$888,888.88` (U+2212), find the amount cell
  `dialog.locator(".activity-table td.num", { hasText: <text> })` (exact text via `toHaveText`).
- Read `{ scrollWidth, clientWidth, title }` with `evaluate` and expect `scrollWidth <= clientWidth` and
  `title === text`.
- The popover's rect lies within `innerWidth` and `innerHeight` (as `activity-popover-narrow.spec.ts` does).

**Test "6. a 14-character amount is cut with an ellipsis and a title":**
- `patchPlan` (from `./support/plan-formats-seed`) with
  `{ currency_format: { iso_code: "EUR", example_format: "123.456,78", symbol_placement: "after" } }`.
- `addAmount(-8_888_888_880)`, then open the popover.
- The cell with text `−8.888.888,88€` has `scrollWidth > clientWidth`, computed `textOverflow === "ellipsis"` and
  `whiteSpace === "nowrap"`, `title === "−8.888.888,88€"`, and the same height as the `−888.888,88€` cell's row.
- The `−888.888,88€` cell has `scrollWidth <= clientWidth`.

**Run it once on the present code** (`pnpm e2e e2e/activity-amount.spec.ts`): test 5 must fail at the
`scrollWidth <= clientWidth` expectation for `−$888,888.88` (103 > 96). Quote that line in the report. Commit the
spec with the fix, or before it.

### 1c. Fix

- `activity-popover.css`: `.activity-table .col-amount { width: 104px; }`, with a comment: `EXF-745: twelve wide
  characters ("−$888,888.88" 95 px, "−888.888,88€" 96 px, Figtree 500 14px tabular) plus 8 px of padding; the
  account, payee and memo columns give way.`
- `activity-popover.tsx`: the amount `<td>` gets `title={fmt.money(t.amount)}`. Use the plan's formatter only; never
  format by hand.

**Verify:**
- `pnpm e2e e2e/activity-amount.spec.ts e2e/activity-popover.spec.ts e2e/activity-popover-narrow.spec.ts`: all pass.
- `pnpm check` passes.

**Commit:** `EXF-745: Activity popover amount column holds twelve wide characters, with a title`.

## Part 2: EXF-727 runs (done by the Architect)

The logs and the cause are in the design. To see them again, apply `/workspace/scratch/e2e-727/probe.patch` to a
scratch copy only; never commit it. Nothing for the Implementer to commit in this part.

## Part 3: EXF-727 (failing spec first, then the fix)

### 3a. Spec: `e2e/month-picker-dismiss.spec.ts` (design acceptance 1–3)

Helpers as in `month-nav.spec.ts`: `newPlan` through `POST /api/v1/budgets` with `testName("month-picker-dismiss")`,
delete in `afterEach`, and M+1 from the local date (`key` yyyymm, `iso`, `label` "Mon YYYY" en-US). Then:

```ts
const picker = (page: Page) => page.getByRole("dialog", { name: "Choose month", exact: true });
const next = (page: Page) => page.getByRole("button", { name: "Next month", exact: true });
const monthButton = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
```

**For both sizes (`test.describe` per size with `test.use({ viewport })`):**
- **"1. a click on a disabled button outside closes the month picker":**
  - Go to `/${id}/budget/${M1.key}` and expect `next` to be disabled.
  - `realClick` the month button and expect the picker to be visible.
  - `realClick(page, next(page))` and expect the picker `toHaveCount(0)`.
  - Expect the URL still `/${id}/budget/${M1.key}`, the h1 text still `M1.label` and `next` still disabled.
- **"3. a click on a disabled button outside closes the month note":** the same steps with the `.month-note`
  button. The dialog it opens is `getByRole("dialog", { name: "Month note", exact: true })`.

**At 1440×900 only:**
- **"2. a press on an Auto-Assign option still loading closes the month picker":**
  - Before `goto`, hold the preview answer with no timer:
    ```ts
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await page.route(`**/api/v1/budgets/${id}/months/${M1.iso}/auto-assign?**`, async (route) => {
      if (route.request().method() === "GET") await held;
      await route.fallback();
    });
    ```
  - Go to M+1. `const option = page.locator(".auto-assign-option").first()` and expect it to be disabled.
  - `realClick` the month button, then `realClick(page, option)`, and expect the picker `toHaveCount(0)`.
  - `release()`, expect `option` to be enabled, and expect the picker still `toHaveCount(0)`.
  - The route only delays the real server's answer; it is not a stand-in.

**Run it once on the present code:** all three must fail at their `toHaveCount(0)` line after the outside click.
Quote the lines in the report. The Architect's throwaway probe failed the same way for 1 and 3.

### 3b. Fix: `apps/web/src/plan/useDismiss.ts`

- Listen for `pointerdown` instead of `mousedown`: `document.addEventListener("pointerdown", down)`, the matching
  `removeEventListener`, and `down = (e: PointerEvent)`.
- Keep the `inside` / `trigger` test and the Escape handling exactly as they are.
- Doc comment: `/** Closes a popover on Escape (focus goes back to the trigger) and on a press outside it. The press is
  pointerdown: a disabled button gets no mousedown (EXF-727). */`

**Verify:**
- `pnpm e2e e2e/month-picker-dismiss.spec.ts e2e/month-nav.spec.ts` passes.
- The hook's Reflect users: `FilterPopover` and `DateRange` sit in the frame of every report, and
  `TransactionPopover` sits in the reports. Run `pnpm e2e e2e/reflect-frame.spec.ts e2e/reflect-followups.spec.ts
  e2e/spending-breakdown.spec.ts e2e/spending-trends.spec.ts e2e/income-expense.spec.ts
  e2e/income-expense-narrow.spec.ts e2e/age-of-money.spec.ts` and list the result.
- `pnpm check` passes.

**Commit:** `EXF-727: outside press closes the month picker and the hook's popovers on a disabled button
(pointerdown)`.

## Part 4: forty repeats and the narrow window

- `bash scripts/e2e-load.sh exf727-after on e2e/month-nav.spec.ts:127 --repeat-each=40`: 40 of 40. Report the
  `summary.md` table line.
- `bash scripts/e2e-load.sh exf727-new on e2e/month-picker-dismiss.spec.ts --repeat-each=10`: all pass.
- Narrow window: the 1024×700 cases of both new specs pass. Nothing this Build touches is cut without an ellipsis and
  a `title` (amount cells: case 6), and the picker and the popover lie inside the window (case 5 rect; the picker is
  checked by `month-nav.spec.ts`).

**Commit:** any doc update (the design's "Built" notes, if the Implementer adds one).

## Report checklist (the Implementer's part)

- The failing line of each new test before its fix (Parts 1b and 3a).
- The forty repeats line.
- The specs of the hook's other users.
- Any existing test edited, with its reason (expected: none).
- No dependency added, no retry, pause or longer limit, no out-of-bounds file changed (`git diff --stat
  origin/main`).
- Actions in the source: none expected for the Implementer.
