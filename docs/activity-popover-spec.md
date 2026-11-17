# Activity popover spec (EXF-509, EXF-720, EXF-714)

Design: [activity-popover-design.md](activity-popover-design.md). It holds the counting rule, the bound, the D1
call count, the acceptance cases and the source rules; read it first. Each task below is committed before the
next. The repository's guidance is in `docs/conventions.md` (D1 calls, MCP coverage and descriptions,
`mcp-timestamps`).

Out of bounds (unchanged): every `paths.always_overlap` and `paths.shared_modules` file,
`apps/web/src/{account,register,reflect}/**`, `apps/worker/src/services/{transactions,reconcile,plan-import*,plan-export}.ts`
and their repositories, `apps/worker/src/repositories/plan-activity.ts` (read it; do not change it),
`apps/worker/test/{openapi,mcp}.test.ts`, `e2e/mcp.spec.ts`, `e2e/plan-narrow.spec.ts`, `e2e/support/real-click.ts`.
No migration and no dependency.

## T1. Schema: `packages/schema/src/category-activity.ts`

```ts
import { z } from "@hono/zod-openapi";
export const CATEGORY_ACTIVITY_LIMIT = 500;
export const CategoryActivityRow = z.object({
  id: z.string(),                       // transaction id (a split line's parent)
  subtransaction_id: z.string().nullable(),
  account_id: z.string(),
  account_name: z.string(),
  date: IsoDate,                        // reuse the IsoDate used by reports.ts
  payee_name: z.string().nullable(),
  memo: z.string().nullable(),
  amount: Milliunits,                   // signed
}).openapi("CategoryActivityRow");
export const CategoryActivity = z.object({
  category_id: z.string(), month: Month, activity: Milliunits,
  total_count: z.number().int().nonnegative(),
  transactions: z.array(CategoryActivityRow),
}).openapi("CategoryActivity");
export const CategoryActivityResponse = dataEnvelope(CategoryActivity).openapi("CategoryActivityResponse");
export type CategoryActivity = z.infer<typeof CategoryActivity>;
/** "N more transactions not shown." (1: "1 more transaction not shown."); null when nothing is cut. */
export function activityMoreText(a: Pick<CategoryActivity, "total_count" | "transactions">): string | null;
/** The Activity button's title: `(${amount}) View this category's monthly activity.` */
export function activityTitle(amountText: string): string;
```

Import `IsoDate`, `Month`, `Milliunits` and `dataEnvelope` from wherever `reports.ts` and `months.ts` import them
(the `common/` modules, read only). Unit tests go in `packages/schema/test/category-activity.test.ts`:
`activityMoreText` for 0, 1 and 3 rows cut; `activityTitle("−$60.00")`.
**Verify:** `pnpm check`.

## T2. Worker repository: `apps/worker/src/repositories/category-activity.ts`

- `findActiveCategory(db, budgetId, categoryId): Promise<{ id; name; kind: "credit_card_payment" | null } | null>`
  is one statement: categories joined to category_groups, both `deleted_at is null`, `c.budget_id = ?`.
- `categoryActivityRows(db, budgetId, categoryId, month: Month, limit: number)` is **one** `db.all(sql\`…\`)`
  statement: the WHERE of the design's "What counts" list, the payee coalesce, `ta.name as transfer_name`,
  `count(*) over () as total_count`, `sum(t.amount) over () as activity`, the design's `order by` and
  `limit ${limit}`. Upper date bound: `addMonths(month, 1)` from `@budget/core/month`.
- It returns `{ rows: CategoryActivityRow[]; total: number; activity: number }`. With no rows: total 0, activity 0.
- It maps `id = parent_id ?? id` and `subtransaction_id = parent_id ? id : null`, and
  `payee_name = transfer_name !== null ? transferPayeeName(transfer_name) : payee_name`
  (`@budget/schema/transfers`).
- **Every column is named** in the select. The statement writes nothing.
- A comment names `planActivity` and `classifyTransaction` as the rule it mirrors.

## T3. Service: `apps/worker/src/services/category-activity.ts`

```ts
export class PaymentCategoryRefused extends Error { /* name "PaymentCategoryRefused" */ }
export async function listCategoryActivity(
  env: Env, budgetId: string, month: Month, categoryId: string,
): Promise<CategoryActivity>
```

Steps, in order:
1. A non-UUID plan id is `NotFound("Plan")` (no D1 call), and so is `budgetsRepo.findActive` returning null.
2. A non-UUID category id, or `findActiveCategory` returning null, is `NotFound("Category")`.
3. `kind === "credit_card_payment"` throws `PaymentCategoryRefused` with the design's detail text.
4. Call `categoryActivityRows(…, CATEGORY_ACTIVITY_LIMIT)` and return
   `{ category_id, month, activity, total_count, transactions }`.

That is exactly **3 D1 calls**, run one after the other (the plan check comes first so another plan's id answers
"Plan not found").

## T4. Route: `apps/worker/src/routes/category-activity.ts`

`export default new OpenAPIHono<AppEnv>({ defaultHook })` with the same 422 `defaultHook` and `params` shape as
`routes/month-categories.ts` (`AssignedMonth` for month).
- **Route:** `GET /budgets/{budget_id}/months/{month}/categories/{category_id}/transactions`, tag "Months".
- **Responses:** 200 with `CategoryActivityResponse`; 403; 404 "Plan or category not found"; 422 "Invalid month,
  or a credit card payment category".
- **Error mapping:** the handler catches `PaymentCategoryRefused` and returns
  `apiError(c, 422, "payment_category", e.message)`; anything else is rethrown.

## T5. MCP tool: `apps/worker/src/mcp/tools/category-activity.ts`

`export const tools: McpToolDef[] = [{ name: "list_category_transactions", … }]`.
- **Input:** `z.object({ budget_id: Id, category_id: Id, month: Month })`, using the `Month` input other month
  tools use.
- **Run:** call `listCategoryActivity`. On `PaymentCategoryRefused` it throws `new Error(\`payment_category: ${e.message}\`)`.
- **Description** (checked by `mcp-descriptions.test.ts`). It says:
  - that it lists the transactions behind one category's Activity for one month, exactly the rows the plan
    counts, with `activity` equal to `get_month_category`'s activity;
  - newest first, at most 500 rows, with `total_count` and `activity` over all rows;
  - that split lines are listed (`subtransaction_id` set) and deleted rows, scheduled transactions and transfers
    between on-plan accounts are not;
  - that a credit card payment category is a tool error `payment_category`;
  - `${MONEY} ${MONTH} ${dates("date")}`, and
    `Returns { category_id, month, activity, total_count, transactions: [{ id, subtransaction_id, account_id, account_name, date, payee_name, memo, amount }] }`.
- **Coverage:** a new file `apps/worker/test/mcp-coverage/category-activity.ts` with `toolsWithoutOperation = {}` and
  `"GET /budgets/{budget_id}/months/{month}/categories/{category_id}/transactions": { tool: "list_category_transactions" }`.
  Copy the shape of `mcp-coverage/months.ts`.
- **Timestamps:** `apps/worker/test/mcp-timestamps.test.ts` gets one `CALLS` line,
  `["list_category_transactions", (c) => ({ budget_id: c.bid, month: MONTH, category_id: c.category })]`.

**Verify:** `pnpm check` (openapi, mcp, coverage, descriptions and timestamps tests).

## T6. Worker tests

`apps/worker/test/category-activity.test.ts` (helpers: `test/helpers.ts` `json`, `test/surface.ts`):

- **Sum = engine (the design's acceptance 3 and 4).** One plan holds an on-plan checking account `ZZ Checking`, a
  second on-plan account `ZZ Old`, a tracking account and categories `ZZ Food` and `ZZ Other`. In Nov 2026,
  through REST:
  - an outflow −60.00 on 11/15;
  - a refund +12.00 on 11/14;
  - a split −50.00 on 11/13, with −30.00 to ZZ Food and −20.00 to ZZ Other;
  - a categorized transfer −25.00 from ZZ Checking to the tracking account, category ZZ Food, on 11/12;
  - −7.00 on ZZ Old on 11/11, after which ZZ Old is closed (`PATCH … closed: true` or the existing close route);
  - −9.00 created and then deleted;
  - a scheduled transaction −40.00 with `date_first` 2026-11-28, frequency monthly, made with today = 2026-11-16
    so it is not entered;
  - −15.00 on 2026-10-31 and −16.00 on 2026-12-01.

  Assertions:
  - The read's `total_count` is 5.
  - The rows' amounts are, in order, `[-60000, 12000, -30000, -25000, -7000]` (newest first).
  - `activity` = −110000 = the sum of the rows = `GET …/months/2026-11-01/categories/{ZZ Food}` `activity`
    (`?today=2026-11-16`).
  - The split row has `subtransaction_id` set and `id` = the parent's id. The transfer row's `payee_name` starts
    with "Transfer : ".
  - No row has the deleted, October or December amount.
- **Errors.** Expect 404 for an unknown category id, another plan's category, an unknown plan, and a category of
  plan A requested under plan B's id. Expect 422 for `month` `2026-13-01`. A credit card payment category gives
  422 with `error.name` `payment_category`.
- **Bound.** Make 503 rows in one month. There is no bulk-create route, so the Worker test inserts them in one
  `env.DB.batch` of `insert into transactions (id, budget_id, account_id, date, category_id, amount, memo,
  cleared, approved, inflow_to_ready_to_assign, created_at, updated_at) values (…)`, **naming every column**, as
  other Worker tests seed. Expect 500 rows, `total_count` 503, and `activity` = the sum of all 503.
- **MCP.** `list_category_transactions` returns the same `data` as REST.
- **Surface.** `apiPaths()` contains the path; `listedToolNames()` contains the tool.

`apps/worker/test/category-activity-calls.test.ts`: copy the `counting()` env of `reconcile-calls.test.ts` into
the file. Call `listCategoryActivity(counting.env, …)` for a category with 10 rows and with 100 rows, and expect
`calls()` to be **3** for both.
**Verify:** `pnpm check`.

## T7. Web API: `apps/web/src/api/category-activity.ts`

```ts
export const getCategoryActivity = (budgetId: string, month: Month, categoryId: string) =>
  apiFetch(`/api/v1/budgets/${budgetId}/months/${month}/categories/${categoryId}/transactions`,
           { schema: CategoryActivityResponse }).then((r) => r.data);
export const useCategoryActivity = (budgetId, month, categoryId) =>
  useQuery({ queryKey: ["category-activity", budgetId, month, categoryId],
             queryFn: () => getCategoryActivity(budgetId, month, categoryId), staleTime: 0 });
```

No `placeholderData`.

## T8. Activity button: `apps/web/src/plan/rows.tsx` + `plan-grid.css`

- **`CategoryRow`.** It gets a new prop `onActivity: (anchor: HTMLElement) => void`. When
  `c.kind === null && c.activity !== 0`, the `cell-activity` content becomes a
  `<button type="button" className="activity-button" title={activityTitle(money(c.activity))} aria-haspopup="dialog" onClick={(e) => onActivity(e.currentTarget)}>`
  wrapping the existing `<span className={amountClass(c.activity)}>`. Otherwise the cell is unchanged.
- **`GroupRow` and `UncategorizedRow`** are unchanged.
- **CSS (in `plan-grid.css`, next to `.cell-activity`).**
  - `.activity-button`: `display:inline-block; max-width:100%; margin:0; padding:0; border:0; background:none;
    color:inherit; font:inherit; line-height:inherit; text-align:inherit; cursor:pointer; overflow:hidden;
    text-overflow:ellipsis; white-space:nowrap; vertical-align:top`.
  - `.activity-button:focus-visible { outline: 1px auto var(--actionPrimary); outline-offset: 0 }`.
- **Layout check.** Measure a non-zero row against a zero row at 1024×700 and 1440×900: the same row height, the
  same `cell-activity` box, and the amount's right edge within 1px.

## T9. Popover: `apps/web/src/plan/activity-popover.tsx` + `activity-popover.css`; `PlanGrid.tsx`

```ts
export const ACTIVITY_CHROME = 150;
export function activityListMax(anchor: DOMRect, innerHeight: number): number; // the design's clamp
export function ActivityPopover(props: {
  budgetId: string; month: Month; category: { id: string; name: string };
  anchor: HTMLElement; onClose: () => void;
}): JSX.Element
```

- **The box.** `<Popover anchor width={512} label="Activity" className="activity-popover" dismissOnOutside onClose>`.
  Inside it:
  - `h2.activity-title` "Activity";
  - `p.activity-subtitle` with `{category.name}` and `title`;
  - `div.activity-list` with `style={{ maxHeight: listMax }}`, recomputed on `resize`, holding the
    `table.activity-table` of the design (`th scope="col"`). Each `td` has `title` for account, payee and memo
    when not empty. The date is `formatEntryDate(t.date)` and the amount is `money(t.amount)`, with
    `className={\`num ${amountClass(t.amount)}${t.amount < 0 ? " negative" : ""}\`}`. The React key is
    `t.subtransaction_id ?? t.id`;
  - the state lines (`p.activity-note`) and `p.activity-more` from `activityMoreText`;
  - `div.popover-buttons` holding `span.popover-spacer` and
    `<button type="button" className="popover-button is-primary" onClick={() => { onClose(); anchor.focus(); }}>Close</button>`.
- **CSS** uses token variables only:
  - title: 16px/600 `labelPrimary`;
  - subtitle: 0.8rem `labelSecondary`, nowrap with an ellipsis;
  - table: 100% wide, `table-layout: fixed`, 14px; `th`: 12px/500 uppercase `labelSecondary`, letter-spacing
    0.6px, sticky top with the popover's background;
  - `td`: padding 6px 4px, `border-top: 1px solid var(--separatorStandard)`, nowrap, `overflow: hidden`,
    `text-overflow: ellipsis`;
  - `.num`: right-aligned, tabular-nums; `.negative`: `--labelNegative`;
  - `col` widths per the design;
  - `.activity-list`: `overflow-y: auto`.
- **`PlanGrid.tsx`.**
  - Add `| { kind: "activity"; categoryId: string; anchor: HTMLElement }` to `Open`.
  - Pass `onActivity={(anchor) => setPop({ kind: "activity", categoryId: c.id, anchor })}` to `CategoryRow`.
  - In `renderPopover`, before the move/cover branch: find `c` in `allGroups`. If it is missing or `c.kind !== null`,
    return null; otherwise render `<ActivityPopover budgetId month category={c} anchor={pop.anchor} onClose={close} />`.
- **Verify:** `pnpm check`. Run the T10 specs.

## T10. Browser specs (exact names, `realClick` for Plan-page clicks, both sizes)

- **Seed: `e2e/support/activity-popover-seed.ts`.** API only, `testName(...)` plan names, `ZZ` names, no real
  data. `seedActivity(request, opts)` builds the design's acceptance plan (ZZ Checking, ZZ Old, a tracking account,
  ZZ Group / ZZ Food, ZZ Other, ZZ Empty with $0.00 activity), with options:
  - `{ rows: n }` adds n extra outflows;
  - `{ long: true }` adds a 120-character payee and memo;
  - `{ only: true }` makes just the −60.00 row.

  It also exports `removePlan`. Use a fixed clock (`page.clock.setFixedTime`, 2026-11-16 local noon) and open
  `/<plan>/budget/202611`.
- **`e2e/activity-popover.spec.ts`**, for each of `[{1440,900},{1024,700}]`, covers acceptance 1, 2, 3, 7, 8, 9,
  10, 11 and 13.
  - Acceptance 13 counts requests with `page.on("request")` filtered on `/transactions`.
  - After a click, wait with `expect.poll` on the dialog's row count.
  - Acceptance 8's payment category comes from `seedCard` in `e2e/support/card-seed.ts`.
  - Acceptance 7 in the browser: the Worker test proves the bound. The spec checks the popover's line with
    `page.route` on the read, fulfilling the server's real answer for a 2-row category with `total_count` raised
    by 3. It expects "3 more transactions not shown." It seeds no 503 rows through the browser and writes nothing
    to the database.
- **`e2e/activity-popover-narrow.spec.ts`**, acceptance 12. With 30 rows, and enough categories that the grid
  scrolls (as `plan-narrow.spec.ts` seeds them), open the popover on the first visible, a middle and the last
  visible category row.
  - Assert that `getBoundingClientRect()` of `.activity-popover` satisfies `top ≥ 0`, `left ≥ 0`,
    `bottom ≤ innerHeight` and `right ≤ innerWidth`.
  - Assert that `.activity-list` scrolls and `document.scrollingElement.scrollTop === 0`.
  - The last visible row is the last `.category-row` whose box bottom ≤ the grid body's visible bottom.
- **EXF-720: a new test in `e2e/card-payments.spec.ts`**, "13b. Got it! is a primary button", at both sizes.
  Open the dialog with `seedCard`, then read `getComputedStyle` of `Got it!`:
  - background `rgb(84, 91, 254)`, colour `rgb(255, 255, 255)`, and a WCAG contrast computed in the test ≥ 4.5;
  - the same after `hover()` and after `focus()`;
  - then click it: the dialog closes and PAYMENT is focused.

  Run it once against the old `PaymentHelpDialog.tsx` (stash the fix) and quote the failing line.

**Verify:** `pnpm e2e e2e/activity-popover.spec.ts e2e/activity-popover-narrow.spec.ts e2e/card-payments.spec.ts e2e/plan-narrow.spec.ts e2e/plan-grid.spec.ts`.

## T11. EXF-720 fix and search

- **The fix.** `PaymentHelpDialog.tsx`: `className="popover-button is-primary"`.
- **The search.** Repeat the design's search of `apps/web/src/plan/**`: every `<button` with no `className`, or
  whose classes have no rule in `apps/web/src/**/*.css`.
- **Report.** List the findings. The Architect found `KeyboardTip.tsx:14` and `Toolbar.tsx:54/64`, styled by
  parent selectors, and no other browser-default button. Fix any that the browser renders with its default
  `rgb(239, 239, 239)` background.

## T12. EXF-714 tests (no source change)

The design's three tests go in `packages/schema/test/auto-assign.test.ts`, `apps/worker/test/auto-assign.test.ts`
and `e2e/auto-assign.spec.ts` (new test "20. a view holding one category stays plan-wide").

1. **`packages/schema/test/auto-assign.test.ts`.** `monthHiddenInputs(detail, [payId], true)` gives
   `payment_underfunded` = the category's `payment.underfunded` (> 0), and with `false` gives 0. Guarded change:
   `lone &&` → `ids.length === 1 &&` in `monthHiddenInputs` (`packages/schema/src/auto-assign.ts`).
2. **`apps/worker/test/auto-assign.test.ts`.** Set up a plan with a checking account and a credit card that owes
   1,200.00 (starting balance), with 100.00 assigned to the card's payment category in Nov and no other category
   with money available. Its `money_available` view then holds exactly the payment category: Total Underfunded is
   1,100.00, the view holds one category, and no `category_ids` are sent.
   - Preview with `view=money_available`: `underfunded` = 0. Apply `underfunded` with that view: nothing changes,
     and the assigned amount stays 100.00.
   - With `category_ids=[pay]`: the preview's `underfunded` = 1,100,000, and the apply sets the assigned amount to
     1,200,000.
   - Guarded change: `scope.category_ids !== undefined && ids.length === 1` → `ids.length === 1` in `loadScope`
     (`apps/worker/src/services/auto-assign.ts`).
3. **`e2e/auto-assign.spec.ts`, a new test.** The plan comes from `seedCard`: its Visa payment category holds
   335.00 and no other category has money available.
   - With nothing ticked, click the **Money Available** chip. The grid shows exactly one category (ZZ-TEST Visa).
     The card's labels are the plan-wide ones (plural, as in test 11's `plan` list) with Underfunded at $0.00, and
     there is no Paid Last Month or Average Paid.
   - Tick ZZ-TEST Visa: the card switches to the payment card (Paid Last Month and Average Paid offered, singular
     labels).
   - Guarded change: `"categoryIds" in scope && ids?.length === 1` → `ids?.length === 1` in
     `apps/web/src/plan/AutoAssignOptions.tsx`.

- **Setup.** The Worker test builds its card the way `card-payments.test.ts`'s `world()` does (a `creditCard`
  account opened with balance 1200000, then `setAssigned`/PATCH 100000 on its payment category). It asserts first
  that `viewCategories(money_available)` holds only the payment category: `GET …/months/{m}?view=money_available`
  has one category.
- **The e2e test** uses `seedCard` and asserts the chip's grid holds exactly `ZZ-TEST Visa` before checking the
  card.
- **The guarded changes.** For each test, put back its guarded change (design, EXF-714 list), run the test alone,
  quote the failing line, and restore. `git diff` shows no change to the three source files afterwards.

**Verify:** `pnpm check`; `pnpm e2e e2e/auto-assign.spec.ts`.

## T13. Docs

The design's line in `docs/README.md` is already there. Do not add the polish file; the Designer writes
`docs/activity-popover-polish.md` and its index line.
