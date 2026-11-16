# Age of Money and the Spending Trends marker: implementation spec (EXF-553, EXF-615)

Read [age-of-money-design.md](age-of-money-design.md) first: it holds the definition, the screen and the acceptance
cases this spec refers to (`case n`). Conventions: [conventions.md](conventions.md).
- No migration and no new dependency.
- Do not edit `packages/core/**`, the transactions repository, service, routes or tools, `apps/web/src/shell/**`,
  `mcp/tool-text.ts`, or any `paths.always_overlap` file.
- Never edit `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`,
  `mcp-descriptions.test.ts` or `e2e/mcp.spec.ts`.

## Task 1: the arithmetic (`packages/schema/src/age-of-money.ts`)

The file is pure TypeScript with no imports beyond `./report-range` (`monthOfDate`, `addMonthsTo`).

```ts
export const AOM_WINDOW = 10;
export interface AgeRow {           // one row as the repository returns it, in its order (date, created_at, id)
  date: string;                     // YYYY-MM-DD
  amount: number;                   // milliunits, signed
  account_id: string;
  transfer_account_id: string | null;
}
export interface OutflowAge { date: string; age: number }   // age in days, not rounded
export interface AgeOfMoneyResult { current_days: number | null; months: { month: string; days: number }[] }

export function daysBetween(from: string, to: string): number;            // UTC calendar days, to − from
export function outflowAges(rows: readonly AgeRow[], cash: ReadonlySet<string>, today: string): OutflowAge[];
export function valueAt(ages: readonly OutflowAge[], date: string): number | null;
export function computeAgeOfMoney(rows: readonly AgeRow[], cash: ReadonlySet<string>, today: string): AgeOfMoneyResult;
export function aomTopTick(maxDays: number): number;
export function daysLabel(n: number): string;
```

**`outflowAges`:**
1. Keep the rows with `cash.has(account_id)`, `amount !== 0`, `date <= today`, and not
   (`transfer_account_id !== null && cash.has(transfer_account_id)`).
2. Sort stably by `date`. Within one date, positive rows come before negative ones; otherwise keep the input order.
3. Walk the rows once:
   - a positive row pushes the bucket `{ date, left: amount }`;
   - a negative row needs `need = -amount`. While `need > 0` and the queue has a bucket at `head`, take
     `t = min(need, left)`, add `t * daysBetween(bucket.date, row.date)` to `weighted`, and subtract `t` from both
     `left` and `need`. Move `head` on when `left === 0`;
   - the age is `weighted / -amount`. Any leftover `need` adds 0 to `weighted` and still counts in the divisor;
   - push `{ date, age }`.
4. `daysBetween` uses `Date.UTC` on the parts, so there are no time-zone shifts.

**`valueAt(ages, date)`:**
- `k` = the number of ages dated `<= date`;
- `null` when `k < 10`;
- otherwise `Math.floor(sum(ages[k-10..k-1]) / 10 + 0.5 + 1e-9)`. This is half up; the epsilon absorbs binary noise
  at exactly .5.

**`computeAgeOfMoney`:**
- `ages = outflowAges(...)`;
- with fewer than 10 ages: `{ current_days: null, months: [] }`;
- otherwise, for each month `m` from `monthOfDate(ages[9].date)` to `monthOfDate(today)` inclusive:
  - `end` is the smaller of `today` and the last day of `m`;
  - push `{ month: m, days: valueAt(ages, end) }`, which is never null here;
  - use a single forward pointer, not a rescan per month;
- `current_days` is the last month's `days`.

**`aomTopTick(max)`:**
- `max <= 0` gives `10`;
- otherwise `step = Math.max(1, 10 ** Math.floor(Math.log10(max)) / 5)` and the result is
  `Math.ceil(max / step) * step`.

**`daysLabel(n)`:** `n === 1 ? "1 day" : \`${n} days\``.

**Tests** `packages/schema/test/age-of-money.test.ts` (case 1). Build rows with a small helper. Account ids: `chk`
and `sav` are in the set; `card` and `loan` are not.
- **Worked example:**
  - rows: `sav` +500000 on 2026-05-15; `chk` +2000000 on 06-01; +3000000 on 07-15, 08-15, 09-15 and 10-15;
  - outflows on `chk`: 07-10 −120000; 07-22 −45000; 08-05 −80500; 08-20 −25000; 09-03 −60250; 09-12 −99990;
    09-20 −15000; 10-01 −250000 with `transfer_account_id: "loan"`; 10-07 −30000; 10-09 −150000; 10-25 −40000;
  - the ages, rounded to 2 places, are `[56, 68, 82, 97, 111, 120, 128, 125.69, 128, 130, 146]`;
  - `computeAgeOfMoney(rows, set, "2026-10-31")` gives `{ current_days: 114, months: [{ month: "2026-10-01", days: 114 }] }`;
  - with `"2026-11-15"`: `[Oct 114, Nov 114]`, current 114 (Nov has no outflow, so the value repeats);
  - with `"2026-10-09"`: `[Oct 105]`; with `"2026-10-08"`: `{ null, [] }`.
- **Fewer than 10:** 9 outflows give `{ null, [] }`, and `valueAt` gives null.
- **Internal transfer:** add `chk` −300000 to `sav` and `sav` +300000 from `chk` to the example, on 10-02. The
  ages are unchanged (11 of them).
- **Split counted once:** the repository passes only the parent (−100000), so a parent among 9 other outflows gives
  exactly 10 ages, and the parent's age is weighted over 100000.
- **Buckets run out:** `chk` +10000 on 01-01, then ten outflows of −2000 from 01-02 to 01-11.
  - Ages: the first five are 1…5 days, each covered in full (the bucket is used up after the 5th). The next five are
    0, with nothing covered.
  - Value: mean (1+2+3+4+5)/10 = 1.5, so **2**.
  - Also one outflow of −15000 against a +10000 bucket 10 days old: age (10000·10)/15000 = 6.67.
- **Same-day inflow:** `chk` +100000 on 01-01, then −100000 on 01-05 (age 4, which empties the bucket).
  - On 01-10 an outflow −50000 is listed **before** an inflow +50000, both dated 01-10. Then −10000 follows on
    01-12.
  - Expected ages: 4, then 0 (the same-day bucket pays it), then **0** on 01-12, because that bucket is used up.
  - Had the 01-10 inflow not been available to the 01-10 outflow, the 01-12 age would be 2.
- **Rows after today:** a row dated after `today` changes nothing.
- **Month with no outflow:** 10 outflows in Jan, none in Feb, `today` 03-15: three months with equal `days`.
- **Other accounts:** `card` −20000 rows are ignored.
- `aomTopTick`: 141 → 160, 122 → 140, 114 → 120, 100 → 100, 7 → 7, 0 → 10.
- `daysLabel`: 1 → `1 day`, 0 → `0 days`, 122 → `122 days`.

Verify: `pnpm vitest run packages/schema/test/age-of-money.test.ts` (or `pnpm check`).

## Task 2: the schemas (`packages/schema/src/reports.ts`)

Add, next to the Net Worth schemas:
```ts
export const AgeOfMoneyQuery = z.object({ today: Today.optional() });
export const AgeOfMoneyMonth = z.object({ month: Month, days: z.number().int() }).openapi("AgeOfMoneyMonth");
export const AgeOfMoney = z.object({ current_days: z.number().int().nullable(), months: z.array(AgeOfMoneyMonth) })
  .openapi("AgeOfMoney");
export const AgeOfMoneyResponse = dataEnvelope(AgeOfMoney).openapi("AgeOfMoneyResponse");
export type AgeOfMoney = z.infer<typeof AgeOfMoney>;  export type AgeOfMoneyQuery = z.infer<typeof AgeOfMoneyQuery>;
```

## Task 3: the read (`apps/worker/src/repositories/reports.ts`)

```ts
export async function ageOfMoneyRows(db: Db, budgetId: string, today: string): Promise<AgeRow[]>;
```
Use the Drizzle builder, not a raw `sql` string with aliases, so that `countsInBalance()` (imported from
`./transactions`) renders against `transactions`:
- `select({ date, amount, account_id: transactions.accountId, transfer_account_id: transactions.transferAccountId })`;
- `.from(transactions).innerJoin(accounts, eq(accounts.id, transactions.accountId))`;
- `where`:
  - `eq(transactions.budgetId, budgetId)`, `countsInBalance()`;
  - `lte(transactions.date, today)`, `ne(transactions.amount, 0)`;
  - `eq(accounts.budgetId, budgetId)`, `isNull(accounts.deletedAt)`, `eq(accounts.onBudget, true)`;
  - `inArray(accounts.type, CASH_TYPES)`, where `CASH_TYPES = ACCOUNT_TYPES.filter((t) => accountGroup(t) === "cash")`
    from `@budget/core/account-types`;
- `orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id))`.

Write a doc comment headed "THE AGE OF MONEY ROWS (one place)" that states the set and the row rule. This is one
query per call.

## Task 4: the service (`apps/worker/src/services/reports.ts`)

```ts
export async function getAgeOfMoney(env: Env, budgetId: string, q: AgeOfMoneyQuery): Promise<AgeOfMoney>;
```
1. Call `requirePlan`, then set `today = q.today ?? utcToday()`.
2. The set is the ids from `repo.reportAccounts` with `onBudget && accountGroup(type) === "cash"`. Closed accounts
   are included.
3. Return `computeAgeOfMoney(await repo.ageOfMoneyRows(db, budgetId, today), set, today)`.

## Task 5: the route (`apps/worker/src/routes/reports.ts`)

Add one `.openapi(createRoute({ method: "get", path: "/budgets/{budget_id}/reports/age-of-money", … }))`, with:
- `query: AgeOfMoneyQuery`;
- `responses: { 200: json(AgeOfMoneyResponse, "Age of Money now and by month"), ...errors }`.

The handler returns `{ data: await getAgeOfMoney(...) }`. Copy the Net Worth route's shape.

## Task 6: the tool, coverage and timestamps

`apps/worker/src/mcp/tools/reports.ts`: add
`{ name: "get_age_of_money", inputSchema: z.object({ budget_id: Id, today: Today.optional() }), run }`. `Today` comes
from `@budget/schema/reports`, as `months.ts` does. `run` calls `getAgeOfMoney(env, budget_id, { today })`. Import
`dates` and `MONTH` from `../tool-text`. The description, verbatim:

> Age of Money: how many days, on average, money sits in the plan's cash accounts between coming in and going out, for "how long does my money last?". Only on-plan cash accounts count (checking, savings, cash; closed ones included); credit, loan and tracking accounts are outside, so a payment or transfer to one of them is an outflow, while a transfer between two cash accounts is ignored. Each outflow spends the oldest money first (first in, first out); its age is the amount-weighted number of days since that money came in, and the value on a date is the mean age of the last 10 outflows up to that date, rounded to whole days. Returns { current_days, months: [{ month, days }] }: current_days is the current month's value, and it is null with months empty until the plan has 10 outflows; months run oldest first from the month of the 10th outflow to the current month, each the value at the month's end (the current month: as of today). ${MONTH} ${dates("today")} today decides the current month; default: the server's UTC date.

Also:
- `apps/worker/test/mcp-coverage/reports.ts`: add `"GET /budgets/{budget_id}/reports/age-of-money": { tool: "get_age_of_money" },`.
- `apps/worker/test/mcp-timestamps.test.ts`: add `["get_age_of_money", (c) => ({ budget_id: c.bid })],` to `CALLS`,
  right after `get_income_expense`. Nothing else changes.

## Task 7: the Worker test (`apps/worker/test/age-of-money.test.ts`)

Use `examplePlan`, `plan`, `account`, `post`, `base`, `data` and `TODAY` from `./report-example`, and `json` from
`./helpers`. Use `apiPaths`, `listedToolNames` and `mcpRpc` from `./surface`, with the `mcp()` helper copied from
`spending-trends.test.ts`.
- **Case 2:** the example at `today=2026-11-15`, `2026-10-31`, `2026-10-09` and `2026-10-08`, with `toEqual` on the
  exact objects. Then the tool with `today: "2026-11-15"` deep-equals the REST `data`.
- **Case 3: plan Z.**
  - Accounts: `account(bid, "Z Checking", "checking", 1000000, "2026-01-01")`, `"Z Savings"` savings 0 and
    `"Z Card"` creditCard 0, both on 2026-01-01.
  - Rows:
    - `post` Checking −50000 with `transfer_account_id: card` on 01-03;
    - −10000 on each of 01-11 … 01-18;
    - a split on 01-20, `amount: -100000`, with `subtransactions: [{ amount: -60000 }, { amount: -40000 }]` (add
      category ids if the API requires them, as `spending-trends.test.ts` does);
    - −300000 with `transfer_account_id: sav` on 01-21;
    - on the Card: −20000 on 01-25.
  - Expect `{ current_days: 13, months: [{ month: "2026-01-01", days: 13 }] }` at `today=2026-01-31`.
- **Case 12:**
  - `apiPaths()` contains `/api/v1/budgets/{budget_id}/reports/age-of-money`;
  - `listedToolNames()` contains `get_age_of_money`;
  - an unknown plan id gives 404;
  - `today=2026-02-30` gives 422.

## Task 8: the web API (`apps/web/src/api/reports.ts`)

```ts
export const useAgeOfMoney = (budgetId: string, today: string) => useQuery({
  queryKey: ["age-of-money", budgetId, today], placeholderData: keepPreviousInPlan(budgetId),
  queryFn: async (): Promise<AgeOfMoney> => (await apiFetch(`/api/v1/budgets/${budgetId}/reports/age-of-money?today=${today}`, { schema: AgeOfMoneyResponse })).data });
```

## Task 9: the screen (`apps/web/src/reflect/`, `apps/web/src/pages/reflect.tsx`)

**`AgeOfMoneyReport.tsx`** reads `budgetId` and `today` from `useReportState()` and `useAgeOfMoney`, and renders
inside `<div className="aom-report">`. Use `useId` for the heading id.
```
section.aom-card[aria-label="Age of Money chart"]
  div.aom-top > div.aom-current > div.aom-current-title "Current" + div.aom-current-value[data-testid=aom-current]
  data === undefined: nothing more
  months.length ? <AgeOfMoneyChart months={data.months}/>
                : div.aom-empty-area > div.aom-empty[role=status] > h2.aom-empty-title "Spend more money!" + p (design text)
section.aom-info[aria-labelledby=<id>] > h2#<id> "Understanding Age of Money" + div.aom-info-content > p, p
```
- The "Current" value is `daysLabel(current_days)`, or `—` (U+2014) when null. While `data` is undefined it shows
  nothing; never another plan's value.
- Copy is word for word from the design (the info card's two paragraphs are the ticket's).

**`AgeOfMoneyChart.tsx`** has the shape of `NetWorthChart`:
- `ResizeObserver` width, minimum 320; `HEIGHT = 320`, `PAD = { left: 72, right: 16, top: 16, bottom: 48 }`;
- `top = aomTopTick(max(days))`, `y(d) = PAD.top + plotH − d / top · plotH`, `col = plotW / n`,
  `cx(i) = left + col·(i + .5)`.
- Elements, in this order:
  1. `line.aom-grid` at the top tick, and `line.aom-grid.aom-base` at 0;
  2. `text.aom-ytick`: `0 days`, then `daysLabel(top)`, with `textAnchor="end"` at `x = left − 8`;
  3. `path.aom-area` (n ≥ 2): `M cx0,y0 L … L cx(n−1),base L cx0,base Z`;
  4. `path.aom-line`;
  5. per month, `text.aom-xlabel` with `tspan.aom-xmonth` (`MONTH_NAMES[m].slice(0,3)`, e.g. `Oct`) and
     `tspan.aom-xyear` (`2026`, `dy="1.2em"`, same x), skipping per the design's 40px rule;
  6. `line.aom-guide` (only for the hovered month) from `PAD.top` to the baseline at `cx(i)`;
  7. per month, `circle.aom-marker[data-month]` with r=4, class `selected` when hovered;
  8. per month, `rect.aom-hover[data-month]`: x `left + col·i`, width `col`, y `PAD.top`, height `plotH`,
     `fill="transparent"`, with `onMouseEnter`/`onMouseLeave` and **no onClick**. Add the same biome-ignore comment
     as `NetWorthChart`.
- Tooltip: `div.aom-tooltip[role=tooltip]`, positioned `left: cx(i)`, `top: y(days) + 12`,
  `transform: translateX(-50%)`. It holds `span.aom-tip-arrow`, `div.aom-tip-month` (`monthLabel`) and
  `div.aom-tip-days` (`daysLabel`).

**`age-of-money.css`**, imported by `AgeOfMoneyReport`:
- the custom properties of the design on `.aom-report`;
- every size, colour and font from the design's Screen section;
- `.aom-chart { position: relative }`;
- `.aom-line { fill: none; stroke: var(--aom-line); stroke-width: 4; stroke-linejoin: round; pointer-events: none }`;
- `.aom-marker { fill: var(--aom-line); stroke: var(--aom-ring); stroke-width: 8; pointer-events: none }` and
  `.aom-marker.selected { fill: var(--aom-selected) }`;
- `.aom-grid, .aom-guide { stroke-dasharray: 2 2 }`;
- the tooltip and arrow as specified, with `pointer-events: none` and `z-index: 3`;
- the arrow is `border-left/right: 15px solid transparent; border-bottom: 15px solid var(--backgroundTertiary)`, at
  `top: -15px; left: 50%; transform: translateX(-50%)`;
- `.aom-report { display: flex; flex-direction: column; gap: 16px }`, with no extra page margin;
- use only `tokens.css` variables or the new `--aom-*` ones. No raw colours outside the custom property
  definitions.

**`pages/reflect.tsx`:** replace the placeholder branch with `<AgeOfMoneyReport />` for `age-of-money`, and delete
the `This report is not built yet.` element. Also delete `.reflect-placeholder` from `reflect.css` if nothing else
uses it (grep first).

Verify: `pnpm dev`, open a plan's `/reflect/age-of-money`, and run the e2e spec of task 11.

## Task 10: EXF-615 (`apps/web/src/reflect/TrendsChart.tsx`, `spending-trends.css`, `e2e/spending-trends.spec.ts`)

1. **Write the spec first** (cases 9 and 10, `test("615-1 …")` and `test("615-2 …")` in `spending-trends.spec.ts`).
   - Set up with `seedSpendingExample`, `setRange(request, id, "spending-trends", "2026-09-01", "2026-09-01")` and
     `openReport`.
   - Hover:
     - take the box of `.st-marker[data-month="2026-09-01"]` and its centre `(cx, cy)`;
     - check `elementFromPoint(cx, cy)` and `(cx, cy + 5)` are that marker;
     - `page.mouse.move` to each in turn and expect the tooltip lines `["Sep 2026", "$175.24", "Total Spending"]`,
       using the file's existing `tip(page)` helper.
   - 615-2:
     - `segmentPoint(page, "2026-09-01", "uncategorized")` then `page.mouse.click`. Expect
       `getByRole("dialog", { name: "Uncategorized Transactions–SEP 2026", exact: true })`, and close it with
       `realClick` on `Close`;
     - then `page.mouse.click(cx, cy + 3)`, after checking `elementFromPoint` is the marker: the same dialog. Close
       it;
     - then `segmentPoint(…, "2026-09-01", <D8 Group id>)` and click: the H1 drill heading, asserted as 550-4 does.
   - **Run 615-1 and 615-2 against the unchanged code and keep the failing output for the report**: before the fix,
     615-1 fails at the lower edge and 615-2 fails at the marker click.
2. **Change the code:**
   - in `spending-trends.css`, `.st-marker`'s `pointer-events: none` becomes `pointer-events: visiblePainted`;
   - in `TrendsChart.tsx`, the `circle.st-marker` gets the hit circle's `onMouseEnter`/`onMouseLeave` (factor the
     handler into one `showMarkerTip(m, i)`) and
     `onClick={(e) => pickUnder(m.month, e.clientX, e.clientY)}`;
   - `pickUnder` finds, in `document.elementsFromPoint(x, y)`, the first `Element` with class `st-seg` whose
     `data-month` equals the month. It hides the tip and calls `onPick(series, month, x, y)` with the series resolved
     as the segment's own `onClick` does: factor that into `seriesOf(id)` and reuse it in both places;
   - add a biome-ignore comment like the existing ones;
   - keep `circle.st-hit` and its comment as they are.
3. Run the whole `spending-trends.spec.ts`: 550-3 and 550-6 still pass (case 11).

## Task 11: the Age of Money spec (`e2e/age-of-money.spec.ts`) and the frame spec

Import `test`/`expect` from `./fixtures`, `NOW` and `newPlan`/`addAccount`/`addTx` from `./support/reflect`,
`seedSpendingExample` from `./support/spending-breakdown-seed`, and `realClick` from `./support/register-seed`.
Do not edit those support files.
- Write a local `openAge(page, id)`: `page.clock.setFixedTime(NOW)`, `goto(/${id}/reflect/age-of-money)`, then wait
  for `getByRole("heading", { name: "Understanding Age of Money", exact: true })` and `getByTestId("aom-current")`
  to have non-empty text.
- Before measuring the chart, wait for the last expected marker (`.aom-marker[data-month="2026-11-01"]`).
- Hover helper: `hoverMonth(page, month, dy = 0)`:
  - scroll the chart into view;
  - wait until the marker's box is still;
  - check `elementFromPoint` at (centre x, centre y + dy) is `rect.aom-hover[data-month=month]`;
  - `page.mouse.move`.
- Cases 4, 5, 6, 7 and 8 as the design states them. Case 4's API check uses `request` with `authHeaders` and
  `today=2026-11-15`. Case 7 copies `goClientSide` from `reflect-followups.spec.ts` (do not import from a spec).
  Case 8 uses `page.setViewportSize({ width: 1024, height: 700 })` on the clone's own page.

`e2e/reflect-frame.spec.ts`: replace
`await expect(page.getByText("This report is not built yet.")).toBeVisible();` with
`await expect(page.getByRole("heading", { name: "Understanding Age of Money", exact: true })).toBeVisible();`.
Change nothing else.

Verify: `pnpm e2e e2e/age-of-money.spec.ts e2e/spending-trends.spec.ts e2e/reflect-frame.spec.ts --repeat-each=2`.

## Task 12: the docs index

The Architect has already added the `docs/README.md` line. Nothing to do unless the file names change.

## Report checklist (for the Implementer)

- The route, the tool and the coverage line as built.
- The 615 specs' failure before the change: the test names and the failing assertion.
- That no file outside the design's Manifest changed (`git diff --stat origin/main`).
- `pnpm check` and the three specs passing.
