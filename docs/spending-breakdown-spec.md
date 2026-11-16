# Spending Breakdown spec (EXF-549, EXF-548 drill-down, EXF-588, EXF-591)

Tasks for [spending-breakdown-design.md](spending-breakdown-design.md); its rules, figures and acceptance cases are
the reference. Read `docs/conventions.md` and `docs/transfers-splits-design.md` first.

**Constraints:**
- No migration and no `package.json` or lockfile change.
- Do not edit anything in Lead's note 12: the register, account and payees files, `repositories/transactions.ts`,
  `packages/core/src/**`, `apps/web/src/shell/**`, `api/months.ts`, the plan files, or non-Reflect specs. Importing
  from them is fine.
- Never edit `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `mcp-coverage.test.ts`,
  `mcp-descriptions.test.ts` or `e2e/mcp.spec.ts`.

Run `pnpm check` after each task group; use `pnpm e2e e2e/<spec>` for specs.

## 1. Pure modules (`packages/schema/src/`)

### 1a. `reflect-format.ts` (new)
- `cents(m: number): number`: round half away from zero of `m / 10`, returned as an integer with `-0` mapped to `0`.
- `reportMoney(m)`: `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents(m) / 100)`. When
  `cents(m) === 0` it returns `"$0.00"`.
- `debtsMoney(m)`: `"$0.00"` when `cents(m) === 0`, else `"-" + reportMoney(Math.abs(m))`.
- `signedChange(m)`: `+$…`, `−$…` (U+2212) or `$0.00`, decided on `cents`.
- `drillAmount(m)`: `+$20.00`, `-$150.00` (hyphen) or `$0.00`.
- `tickMoney(m)`: whole dollars, `-` only when the rounded dollar is non-zero.
- `usDate("2026-10-21")` gives `"10/21/2026"`.
- `niceTicks(min, max, count = 5)`:
  - the current algorithm, with every candidate step below 1000 skipped (`step = max(1000, f·mag·1000)`);
  - `0` is normalised (`|| 0`);
  - all-zero input returns `[]`;
  - the result is strictly increasing with at most `count` values.

Test `packages/schema/test/reflect-format.test.ts`:
- `0` and `-0` give `$0.00` in every formatter, and `$0` in `tickMoney`;
- `-4` milliunits gives `$0.00`;
- `debtsMoney(-4750000)` is `-$4,750.00`;
- `signedChange(-55000)` is `−$55.00`;
- `niceTicks`:
  - over a sweep (min/max in {0, ±1, ±400, ±999, ±1000, ±1500, ±24049260, ±5000000} and random pairs) it returns no
    duplicates and no duplicate `tickMoney` labels, and the ticks cover [min, max];
  - `niceTicks(0, 400)` is `[0, 1000]`;
  - `niceTicks(0, 24049260)` is `[0, 10000000, 20000000, 30000000]` (4 ticks).

### 1b. `spending-breakdown.ts` (new)
Types:
```ts
interface SpendingRow { id: string; transaction_id: string; subtransaction_id: string | null; account_id: string;
  account_name: string; date: string; created_at: string; split_index: number | null; amount: number;
  payee_name: string | null; memo: string | null; cleared: "uncleared"|"cleared"|"reconciled";
  category_id: string | null; category_name: string | null; category_hidden: boolean; category_order: number;
  group_id: string | null; group_name: string | null; group_hidden: boolean; group_order: number; }
type GroupBy = "category" | "group";
```
Functions, all pure, in milliunits:
- `daysInMonth(m)`, `rangeDays(span)`.
- `centsRound(n: number, d: number)`: n ÷ d rounded half away from zero to a multiple of 10. Use integers only:
  `sign · floor((|n|·2 + 10·d) / (20·d)) · 10`, or an equivalent tested form.
- `sharePct(item, total)`: `floor((200·item + total) / (2·total))`, or 0 when total is 0.
- `filterRows(rows, { excludedCategoryIds, excludedAccountIds })`: `"uncategorized"` drops null-category rows.
- `newestFirst(a, b)`: date desc, created_at desc, split_index asc (null first), id asc.
- `computeBreakdown({ rows, span, groupBy, group }: …)` returns `SpendingBreakdown` (type from `reports.ts`). The
  `rows` are already filtered; `group` is `{ id, name } | null` (the drill). It follows the design's Arithmetic
  section exactly:
  - item ids are category id, group id, or `"uncategorized"`;
  - the Uncategorized item's name is `Uncategorized`;
  - `group_name` is set only for categories in Categories mode.
- `breakdownCsv(rows, span)` and `transactionsCsv(rows)`: as in the design's Export CSVs section.
  - Start with `"﻿"`, join with `"\n"`, no trailing newline.
  - Reuse `csvAmount` from `net-worth.ts` for the summary.
  - Dollars for the transactions CSV: `$` + `csvAmount(|amount|)`, with outflow = `amount < 0 ? -amount : 0` and
    inflow = `amount > 0 ? amount : 0`.
  - The month header uses `monthLabel`.

Test `packages/schema/test/spending-breakdown.test.ts`:
- Build the ticket example as counted rows (the rows the SQL would return: no RTA, no Starting Balance, no on↔on
  transfer).
- Assert every figure in the design's "Ticket figures" list, for Jun–Nov, May–Nov, Sep–Nov and Nov (today 2026-11-15),
  in both modes and in the drill.
- Assert `largest_outflow` = `{ payee_name: "Transfer : D8 Car Loan", amount: 250000 }`.
- Assert the two CSV example rows of the ticket, byte for byte, plus the BOM, LF and no trailing newline.
- Split case S (lines as rows, parents absent): Food 95000/48, Uncategorized 65000/33, Fun 40000/20, most frequent
  Food with 3, largest outflow `S Market` 60000 with the parent's `transaction_id`.
- Ties: `most_frequent` and ranking ties; an all-inflow category is not listed; an empty input gives total 0,
  `most_frequent` null, `largest_outflow` null and `items` `[]`.
- `rangeDays` on Feb 2028 (29), and on Dec 2026 – Jan 2027.

### 1c. `zip.ts` (new)
- `crc32(bytes: Uint8Array): number`: table-driven, polynomial 0xEDB88320.
- `storeZip(files: { name: string; data: Uint8Array }[], date: string /* YYYY-MM-DD */): Uint8Array`:
  - For each file, a local header `0x04034b50` with version 20, flags `0x0800` (UTF-8), method 0, DOS time 0 and the
    DOS date of `date`, then crc, sizes, name length and extra 0, the name, then the data.
  - Then a central directory `0x02014b50` per file (version made by 20, the same fields, the local header offset),
    then the end record `0x06054b50`. All little-endian; no ZIP64 (throw above 0xFFFFFFFF bytes or 0xFFFF files).

Test `packages/schema/test/zip.test.ts`:
- `crc32("123456789")` is `0xCBF43926`; the empty input gives `0`.
- The header signatures are at their offsets.
- **Standard reader:** write the archive to a temp dir (`fs.mkdtemp`), then run
  `spawnSync("python3", ["-I", "-c", script, path])`. The script uses `zipfile`, prints the names and the
  base64 of each file, and runs `testzip()`. Assert the names in order, the bytes equal to the input, and that
  `testzip()` returned `None`.
- Use a BOM CSV and a 70 KB payload. This box has `/usr/bin/python3` and no `unzip`, so the reader is Python's
  `zipfile`.

### 1d. `reports.ts` (edit)
Add, next to the Net Worth schemas, reusing `IdList`, `Today`, `Month` and `MAX_REPORT_MONTHS`:
- `SpendingGroupBy = z.enum(["category","group"])`.
- `SpendingBreakdownQuery`: `start_month?`, `end_month?`, `excluded_category_ids`, `excluded_account_ids`, `group_by`
  (default `category`), `group_id?` (string 1–64), `today?`. Refinements as on `NetWorthQuery`.
- `SpendingBreakdown` and `SpendingBreakdownResponse`, with the fields of the design's Interfaces section. Name each
  object with `.openapi("SpendingBreakdown")`, `"SpendingItem"`, `"SpendingMostFrequent"` and
  `"SpendingLargestOutflow"`. All amounts are `z.number().int()`.
- `ReportTransactionsQuery`:
  - `start_month` and `end_month` (required, start ≤ end, ≤ 1200 months);
  - `category_id?`, `group_id?`, `uncategorized: z.enum(["true"]).optional()`;
  - `excluded_account_ids: IdList`;
  - refine: exactly one selector, with the message "Give exactly one of category_id, group_id or uncategorized=true".
- `ReportTransaction` and `ReportTransactionsResponse` (`{ data: { transactions } }`).

## 2. Worker

### 2a. `repositories/reports.ts`
`spendingRows(db, budgetId, { start: Month, endBefore: string /* first day after the range */ }):
Promise<SpendingRow[]>` is **one query** with the design's rule. In SQL terms:
- `transactions t` inner-joins `accounts a` (`a.id = t.account_id`, `a.budget_id = ?`, `a.deleted_at is null`,
  `a.on_budget = 1`).
- Left joins:
  - `transactions p` on `t.parent_transaction_id`;
  - `accounts ta` on `t.transfer_account_id`;
  - `payees py` on `t.payee_id` and `payees pp` on `p.payee_id`;
  - `categories c` on `t.category_id` and `category_groups g` on `c.group_id` (deleted ones still join).
- Where:
  - `t.budget_id = ?`, `t.deleted_at is null`, `t.date >= start`, `t.date < endBefore`;
  - `(t.parent_transaction_id is null or p.deleted_at is null)`;
  - `not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)`;
  - `not (t.transfer_account_id is not null and coalesce(ta.on_budget, 0) = 1)`;
  - `t.inflow_to_ready_to_assign = 0`;
  - `coalesce(py.system, '') <> 'starting_balance'`.
- Map each row:
  - `payee_name` = `transferPayeeName(ta.name)` when there is a transfer, else
    `coalesce(py.name, t.payee_name, pp.name, p.payee_name)`;
  - `transaction_id` = `coalesce(t.parent_transaction_id, t.id)` and `subtransaction_id` = the id when it is a line;
  - `cleared` = `coalesce(p.cleared, t.cleared)`;
  - hidden flags, sort orders and names from `c` and `g`;
  - `category_order` and `group_order` = 0 when there is no category.

Also add `findCategoryOrGroup(db, budgetId, kind, id)`: does the id exist for the plan (deleted rows included)? It
returns the name.

Import nothing from `repositories/transactions.ts`. Leave `monthlySums` as it is unless the other Build's "counts in
balance" condition is on main when you rebase.

### 2b. `services/reports.ts`
- `getSpendingBreakdown(env, budgetId, q)`:
  - require the plan;
  - span = the query's months, or `resolveRange("this_month", null, rangeFacts(today))`;
  - `group_id`: `findCategoryOrGroup("group")`, or `NotFound("Category group")`;
  - rows = `filterRows(await repo.spendingRows(...), excluded)`, which `computeBreakdown` consumes.
- `listReportTransactions(env, budgetId, q)`:
  - resolve the selector (404 `Category` or `Category group`);
  - select the rows: `category_id ===`, `group_id ===`, or `category_id === null`;
  - filter out `excluded_account_ids`;
  - sort `newestFirst`;
  - map to `ReportTransaction`.
- `exportSpendingBreakdown(env, budgetId, q)` returns `{ filename, bytes }`:
  - `today = q.today ?? utcToday()`;
  - the rows come from the same span and filters, ignoring `group_by` and `group_id`;
  - bytes = `storeZip([{ name: csv1, data: utf8(breakdownCsv) }, { name: csv2, data: utf8(transactionsCsv(rows sorted
    newestFirst)) }], today)`.

### 2c. `routes/reports.ts`
Three `createRoute`s in the existing style:
- `GET /budgets/{budget_id}/reports/spending-breakdown`;
- `…/spending-breakdown/export`: `200` with `content: { "application/zip": { schema: z.string().openapi({ format:
  "binary" }) } }`, sent with `c.body(bytes, 200, { "Content-Type": "application/zip", "Content-Disposition":
  'attachment; filename="…"' })`;
- `GET /budgets/{budget_id}/reports/transactions`.

### 2d. MCP `mcp/tools/reports.ts`
Add `get_spending_breakdown` and `list_report_transactions` with the design's inputs:
- `Id` for every id;
- `Month` for months, both required; check start ≤ end and ≤ 1200 months the way `get_net_worth` does;
- `group_by: z.enum(["category","group"]).optional()`;
- `uncategorized: z.literal(true).optional()`;
- arrays `z.array(Id).max(2000)`;
- throw a tool error unless exactly one selector is given.

Descriptions: at least 80 characters, starting with the example question ("how much did I spend by category from June
to November?"). Include `MONEY`, the sign sentence, `MONTH`, `DATE` (`list_report_transactions`), `Returns { … }`
with the main fields, and the two rule sentences from the design. Both tools call the same service functions.

Coverage: three lines in `apps/worker/test/mcp-coverage/reports.ts`, worded as in the design.

### 2e. Test `apps/worker/test/spending-breakdown.test.ts` (new)
- **Seeding** goes through REST, as `reports.test.ts` does:
  - the ticket example: transfers with `transfer_account_id`; D8 Hidden hidden with PATCH after its row;
  - plan S: splits through `subtransactions`.
- **REST checks:**
  - `spending-breakdown?start_month=2026-06-01&end_month=2026-11-01&today=2026-11-15`: total 950740, items in order with
    `share_pct`, averages, `most_frequent`, `largest_outflow`;
  - May–Nov averages;
  - `group_by=group`; `group_id` drill;
  - `excluded_category_ids=uncategorized` drops 15000;
  - excluding D8 Checking gives total 0 and nulls;
  - neither month given: This Month (55000);
  - one month only, or start after end: 422; unknown `group_id`: 404.
- **Plan S:** design cases 9 and 10 through REST and MCP (`mcpRpc("tools/call")`).
  - The MCP result deep-equals the REST `data`.
  - Neither the transactions read nor `get_spending_breakdown` holds the −200000 transfer or the −100000 parent.
- **`reports/transactions`:**
  - Food gives 6 rows newest first, with the `+20000` refund and memo `refund`;
  - `uncategorized=true`; a selector conflict gives 422; another plan's category gives 404; `excluded_account_ids`
    gives `[]`.
- **Export:**
  - status 200, `application/zip`, the filename;
  - parse the archive in the test (a small local-header walker: name, size, data at offset+30+name length);
  - assert the two names, the Food and Uncategorized summary rows, the Loan Pmt transactions row, the hidden-category
    row, the BOM, no `\r` and no trailing `\n`;
  - split plan: 6 transaction rows.
- **Surface:**
  - `expect(await apiPaths()).toEqual(expect.arrayContaining([...the three paths]))`;
  - `expect(await listedToolNames()).toEqual(expect.arrayContaining(["get_spending_breakdown","list_report_transactions"]))`.

## 3. Web

### 3a. `apps/web/src/api/reports.ts`
- `useNetWorth`: `placeholderData: keepPreviousInPlan(budgetId)` (EXF-588). Remove the `keepPreviousData` import.
- `useSpendingBreakdown(budgetId, span, excludedCats, excludedAccts, groupBy, groupId, today)`:
  - key `["spending-breakdown", budgetId, span, excludedCats, excludedAccts, groupBy, groupId, today]`;
  - `keepPreviousInPlan(budgetId)`.
- `useReportTransactions(budgetId, span, selector: { category_id } | { group_id } | { uncategorized: true },
  excludedAccts)`: key `["report-transactions", budgetId, …]`, `keepPreviousInPlan(budgetId)`.
- Extract `downloadFile(url, filename)` from `downloadNetWorthCsv` and add `downloadSpendingBreakdownZip(budgetId,
  span, excludedCats, excludedAccts, today)`, which saves `budget-reflect-spending-breakdown-<today>.zip`.

### 3b. Formatting (`reflect/format.ts`)
- Re-export `reportMoney as money`, `debtsMoney`, `signedChange`, `tickMoney`, `drillAmount` and `usDate` from
  `@budget/schema/reflect-format`; keep `percent` and `changeClass`.
- `NetWorthChart.tsx` imports `niceTicks` from there (delete the local copy) and keeps its exported name by
  re-exporting it.
- Check that every Reflect money string goes through these.

### 3c. Frame (`ReportFrame.tsx`, `state.ts`, `CategoryFilter.tsx`, `DateRange.tsx`, `FilterPopover.tsx`)
- `ReportFrame` props:
  - `heading?: ReactNode`, rendered inside the `<h1>` instead of `title`;
  - `categoryGroupId?: string | null`, put on `ReportState` as `categoryGroupId`.
- `CategoryFilter`: when `categoryGroupId` is set, `nodes` = only that group's node, with no Uncategorized node. The
  label, the count and `excludedAfterDone` then work over those ids. Add `scopeToGroup(nodes, groupId)` in
  `filters.ts`.
- `FilterPopover`: `maxList = Math.min(304, Math.max(120, window.innerHeight - pos.top - 150))`; `.filter-list` gets
  `overflow-y: scroll`. The width stays 450.
- `DateRange`'s `DateMenu`:
  - render it through `createPortal(document.body)` with `position: fixed`;
  - `left = clamp(labelCentre − 120, 8, innerWidth − 248)`, `top = label.bottom + 15`, recomputed on resize;
  - the arrow's left = labelCentre − left − 15;
  - z-index above the sidebar (the filter popover's 40);
  - keep `useDismiss` with the trigger as anchor, the menu roles, and the Custom panel and month grid inside it.

### 3d. `pages/reflect.tsx`
- `ReflectPage` renders `<ReportPage key={`${budgetId}:${report}`} …>`.
- `spending-breakdown` renders `<SpendingBreakdownPage />`, which owns `ReportFrame` for that slug. The other slugs
  are unchanged, and Spending Trends and Income v Expense keep the placeholder and the disabled Export.

### 3e. New components (`apps/web/src/reflect/`)
- **`SpendingBreakdownPage.tsx`:**
  - state `mode: GroupBy` (initially `category`) and `drill: { id, name } | null`;
  - passes `heading` (the breadcrumb while drilled), `categoryGroupId={drill?.id}` and
    `onExport={(s) => downloadSpendingBreakdownZip(...)}`;
  - the body is `<SpendingBreakdownReport mode drill onMode onDrill />`.
- **`SpendingBreakdownReport.tsx`:**
  - reads `useReportState()` and `useSpendingBreakdown(…, drill ? "category" : mode, drill?.id)`;
  - `noCategories` = every listed category leaf excluded (`categoryItems(useMonth(...))`, scoped like the filter);
  - renders the left column (donut card, metrics card) and the list card, as the design's Screen section says;
  - holds `hoverId` and `popover: { title, selector, x, y } | null`.
- **`SpendingDonut.tsx`** (SVG):
  - `items`, `colors`, `hoverId`, `onHover`, `onPick(item, x, y)`;
  - arcs from angles in list order (start −π/2, clockwise); a full ring for one item or none;
  - each slice is `<path class="sb-slice" data-id data-px data-py>`, where `data-px/py` are the SVG coordinates of
    the slice's mid-angle point at radius (R + r) / 2, so a spec can aim at it;
  - outside labels as `<text class="sb-label">` with two `<tspan>`;
  - pointer handlers carry a `biome-ignore` (as `NetWorthChart` does), since the list holds the same actions for the
    keyboard.
- **`SpendingList.tsx`:**
  - the header row; `<button class="sb-row" aria-label="<name> <amount> <pct>%">`;
  - the bar `style={{ width: \`${share}%\`, background: color }}`;
  - the empty texts;
  - onClick passes the click point (`e.clientX/Y`, or the row centre when `e.detail === 0`).
- **`TransactionPopover.tsx`:**
  - built like `FilterPopover` (portal, fixed, `useDismiss`, resize listener, `role="dialog"`, `aria-label={title}`);
  - placement and size as in the design;
  - a table with a sticky `thead`;
  - each `tr` has `tabIndex={0}`, with onClick and Enter calling `navigate(accountPath(budgetId, row.account_id))`;
  - the footer has a `reflect-btn secondary` "Close";
  - "Loading…" while pending.
- **`sliceColor(rank)`** (in `SpendingDonut.tsx`): `var(--sb-slice-${rank+1})` for ranks 0–7, else
  `var(--sb-slice-other)`.
- **`spending-breakdown.css`:**
  - custom properties first (`.reflect` scope): the eight slice colours, `--sb-slice-other`, `--sb-empty-ring`;
  - then the layout, the cards (reuse the `.nw-card` look: `--backgroundSecondary`, padding 24, radius lg), the
    segmented control, the metrics grid, the rows, the bars, the callout, the breadcrumb, the popover;
  - `@media (max-width: 1279px)`: the columns stack;
  - tokens only, besides those custom properties.

## 4. e2e

- **Edit `e2e/reflect-frame.spec.ts`:** at line ~323, after the Net Worth export the spec clicks **Spending Trends**
  (not Spending Breakdown) and expects Export disabled. Change nothing else.
- **Edit `e2e/net-worth.spec.ts`:** lines 130 and 217 expect `nw-debts` to read `$0.00`. Add one assertion that the
  Nov chart tooltip with the loan unticked reads Debts `$0.00` (design case 16).
- **New `e2e/support/spending-breakdown-seed.ts`:**
  - `seedSpendingExample(request)` returns `{ plan, ids }`; `seedSplitPlan(request)` returns the same for plan S;
  - everything goes through the REST API, with names `ZZ-TEST …` for plans (`newPlan` from `support/reflect.ts`);
  - `donutPoint(page, id)` converts `data-px/py` with the SVG's bounding rect and checks `elementFromPoint`.
  - Use `realClick` from `support/register-seed.ts` for controls.
- **New `e2e/spending-breakdown.spec.ts`:**
  - design cases 1–11, each in a new plan;
  - `page.clock.setFixedTime(NOW)` (2026-11-15 12:00, from `support/reflect.ts`);
  - set Custom ranges through the date menu with the mouse;
  - wait for the report response with `page.waitForResponse` or `expect.poll` before reading;
  - run the popover and click cases at 1600×900 and 1024×700;
  - the ZIP case saves the download to `test.info().outputPath()` and reads it with `spawnSync("python3", ["-I", "-c",
    …])`.
- **New `e2e/reflect-followups.spec.ts`:** design cases 12–16.
  - Hold Y's report read: `page.route(\`**/api/v1/budgets/${y}/reports/net-worth*\`)` awaits a promise, released after
    the checks.
  - Navigate client-side: `page.evaluate(u => { history.pushState(null, "", u); dispatchEvent(new
    PopStateEvent("popstate")) }, url)`.
  - Check X's figures absent at 0s, 1s and 2s.

## 5. Docs
- In `docs/reflect-design.md`, change "5 whole-dollar y ticks (`$20,000`, `-$5,000`)" to "at most 5 whole-dollar y
  ticks, never below a $1 step (4 for the example: `$0`…`$30,000`)", and the `-$0.00` Debts mentions to `$0.00`
  (EXF-591).
- Add one line to `docs/README.md` for this design.

## 6. Carry-over tasks (merged onto main `4da55a7`; design "Carry-over")

- **6a. `localToday`.** In `apps/web/src/reflect/ReportFrame.tsx`, import `localToday` from `../api/today`, not
  `../api/accounts`. Change nothing in `api/accounts.ts` or `api/today.ts`. Verify: `grep -rn "api/accounts"
  apps/web/src/reflect` prints nothing.
- **6b. The placeholder option under test.**
  - New `packages/schema/src/placeholder.ts`: export `keepPreviousInPlan<T>(budgetId: string): (prev: T | undefined,
    prevQuery?: { queryKey: readonly unknown[] }) => T | undefined`, the body and doc comment moved unchanged from
    `apps/web/src/api/placeholder.ts`.
  - `apps/web/src/api/placeholder.ts` becomes `export { keepPreviousInPlan } from "@budget/schema/placeholder";` with
    a one-line comment. Every caller (`api/reports.ts`, `api/months.ts`, `api/bank-connections.ts`) keeps its import
    untouched.
  - New `packages/schema/test/placeholder.test.ts`: design case 17. Assert with `toBeUndefined()` and `toBe(prev)`.
    Do not import TanStack in `packages/schema`, which has no such dependency.
  - Add one line to the top comment of `e2e/reflect-followups.spec.ts`: the 588-1 cases prove the outcome. The
    page's remount (`key={budgetId:report}`) protects it first, and the option is unit-tested in
    `packages/schema/test/placeholder.test.ts`.
  - Verify: `pnpm vitest run packages/schema/test/placeholder.test.ts` passes. Temporarily return `prev` without the
    plan check: it fails. Put the body back.

## Verify before handing over
- `pnpm check` is green.
- `pnpm e2e e2e/spending-breakdown.spec.ts e2e/reflect-followups.spec.ts e2e/reflect-frame.spec.ts
  e2e/net-worth.spec.ts --repeat-each=2` is green.
- `git diff --stat origin/main` touches only the Manifest's globs.
