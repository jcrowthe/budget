# Register View options spec (EXF-529, EXF-724, EXF-722)

Design: [register-view-design.md](register-view-design.md) (decisions D1–D12, acceptance cases 1–14, the source rules and "Looking"). Read `docs/conventions.md` first. No migration, no shared module, no dependency. New files carry `view-settings` or `register-view` in their names. Every browser click uses `realClick` from `e2e/support/real-click.ts`; names are `{ exact: true }`; specs make their own plan through the API.

## T0 Measure EXF-724 before changing anything (D12)

- With `pnpm dev`, a throwaway script under `/workspace/scratch/` (not the repository; `playwright-core` from the repo's node_modules is fine) seeds a plan through the API with one checking account of 10 rows and one of 500 rows, opens the account page, enters reconcile mode (Reconcile → No → a balance → Enter → Next if the Difference step shows), and for a clear and an unclear click measures, with `performance.now()` in the page and a `MutationObserver`: click → icon class change, → `[data-balance=cleared] .acct-amount` text change, → `.reconcile-text` change. Five runs each; report median and max per case. Repeat after T12. The numbers go in the report; the script is not committed.

## T1 Schema `packages/schema/src/view-settings.ts` (new; D2, D3)

- `VIEW_PRESETS = ["this_month","last_month","latest_3_months","this_year","last_year","all_dates","custom"] as const`; `ViewPreset = z.enum(VIEW_PRESETS).openapi("ViewPreset")`.
- `AllAccountsViewSettings = z.object({ preset, range_from: Month.nullable(), range_to: Month.nullable(), show_reconciled: z.boolean(), show_flags: z.boolean(), show_images: z.boolean() }).openapi(...)`.
- `AccountViewSettings = AllAccountsViewSettings.extend({ account_id: z.string(), show_running_balance: z.boolean() })`.
- `AccountViewSettingsUpdate = z.strictObject({...every field of AccountViewSettings except account_id}).partial()`; `AllAccountsViewSettingsUpdate` likewise without `show_running_balance` (strict: sending it is a 422).
- `VIEW_DEFAULTS = { preset: "all_dates", range_from: null, range_to: null, show_reconciled: false, show_running_balance: false, show_flags: true, show_images: true }`.
- `mergeViewSettings(current, patch): Result | { error: string }` (pure): applies D2's rules (non-custom preset clears the range; a range without preset means custom; preset other than custom with a range → error; custom without both months after the merge → error).
- Responses: `AccountViewSettingsResponse = dataEnvelope(z.object({ view_settings: AccountViewSettings }))`, `AllAccountsViewSettingsResponse` likewise.
- `packages/schema/src/transactions.ts`: `TransactionListResponse`'s rows become `TransactionDetail.extend({ running_balance: Milliunits.optional() })` (name it `RegisterTransaction`, `.openapi("RegisterTransaction")`); `TransactionDetail` itself is unchanged.

## T2 Pure register logic `packages/schema/src/register-view.ts` (new; D6, D7, D10) with `packages/schema/test/register-view.test.ts`

- `presetRange(preset, today: string /* YYYY-MM-DD */, firstMonth: string): { from: string; to: string }` — months as `YYYY-MM-01`; This Month = today's month; Last Month; Latest 3 Months = two months back … this month; This Year Jan–Dec; Last Year; All Dates = `firstMonth` … this month + 120 months. `custom` is not a preset here.
- `effectiveRange(settings, today, firstMonth): { from: string; to: string } | null` — null for `all_dates` (no limit), else the preset's range or the custom months.
- `yearOptions(firstMonth, today): number[]` — `min(firstYear, thisYear − 1)` … `thisYear + 10`.
- `registerVisible<T extends { date: string; cleared: string }>(rows: T[], settings, today, firstMonth, reconcileMode: boolean): { rows: T[]; hidden: number }` — D7 (the date range is skipped when `reconcileMode`).
- Tests: each preset on 2026-11-17 gives the source's months (design, Source); January wrap (Last Month of 2027-01-10 = 2026-12); All Dates To = 2036-11-01; years 2025…2036 for first month 2026-11-01; hiding by reconciled and by range; reconcile mode keeps an out-of-range uncleared row and still hides a reconciled one; From later than To hides all.

## T3 Repository `apps/worker/src/repositories/view-settings.ts` (new; D1)

- `viewSettingsKey(scope: string /* account id | "all_accounts" */) => "view_settings:" + scope`.
- `find(db, budgetId, key): Promise<string | undefined>` — one select on `ui_state` by primary key, returns `value`.
- Writes reuse `upsertStmt` from `repositories/ui-state.ts` (it names its columns with `.values`).

## T4 Service `apps/worker/src/services/view-settings.ts` (new; D1–D4)

- `getAccountViewSettings(env, budgetId, accountId): Promise<AccountViewSettings>` — `budgetsRepo.findActive` (404 Plan), `accountsRepo.findActive` (404 Account; closed is fine), `find`; parse the JSON with the schema, falling back to `VIEW_DEFAULTS` per invalid value. **3 calls.**
- `getAllAccountsViewSettings(env, budgetId)` — **2 calls.**
- `updateAccountViewSettings(env, actor, budgetId, accountId, patch: unknown)` — parse with the strict update schema (ZodError → 422 through the route's hook), read as above, `mergeViewSettings` (error → 422 `unprocessable_entity` with its text), then **one** `db.batch([upsertStmt(...), changeLogInsert(db, { budgetId, actor, action: existed ? "update" : "create", entityType: "view_settings", entityId: accountId, before, after })])`. Returns the merged settings without another read. **4 calls.**
- `updateAllAccountsViewSettings(env, actor, budgetId, patch)` — same with `entityId: "all_accounts"`. **3 calls.**
- The stored JSON holds the settings fields only (no `account_id`).

## T5 Route `apps/worker/src/routes/view-settings.ts` (new)

- Copy `routes/ui-state.ts`'s shape (422 default hook, `ErrorBody` 403/404/422). Tag "View settings".
- `GET`/`PUT /budgets/{budget_id}/accounts/{account_id}/view_settings` and `GET`/`PUT /budgets/{budget_id}/view_settings/all_accounts`; PUT reads `c.get("identity").actor`. Answers `{ data: { view_settings } }` 200.

## T6 MCP `apps/worker/src/mcp/tools/view-settings.ts` (new), coverage, timestamps

- Tools `get_account_view_settings` (`budget_id`, `account_id`), `update_account_view_settings` (+ the update fields), `get_all_accounts_view_settings` (`budget_id`), `update_all_accounts_view_settings`. Each returns the REST `data` (`{ view_settings }`). Descriptions: "Returns { view_settings: { preset, range_from, range_to, show_reconciled, … } }", the preset values, the merge rules of D2 in one sentence, `MONTH` for the range fields, that the settings only change what the register shows.
- `apps/worker/test/mcp-coverage/view-settings.ts`: the four `"METHOD /path": { tool }` lines.
- `apps/worker/test/mcp-timestamps.test.ts`: four `CALLS` entries (use the context's plan and checking account; an update with `{ show_flags: false }`). Keep every other line on a rebase.

## T7 Running balance (D5)

- `repositories/transactions.ts` `listDetailForAccount(db, budgetId, accountId, sinceDate?, needs?, opts?: { runningBalance?: boolean })`: when asked, left-join a subquery (Drizzle `.as("rb")`) `select id, sum(amount) over (order by date asc, amount desc, created_at desc, id desc rows between unbounded preceding and current row) as running_balance from transactions where budget_id = ? and account_id = ? and deleted_at is null and parent_transaction_id is null` on `rb.id = transactions.id`, selecting `rb.running_balance`. Same single statement; no extra call. `TransactionDetailRow` gains `runningBalance?: number`.
- `services/transactions.ts` `listAccountTransactions(..., opts.include?: "running_balance")`: passes it on; each row gets `running_balance` only when asked.
- `routes/transactions.ts`: account list query gains `include: z.enum(["running_balance"]).optional()`; the response schema is the T1 list schema.
- `mcp/tools/transactions.ts` `list_transactions`: `include: z.enum(["running_balance"]).optional()`; with no `account_id` and `include` set → tool error ("running_balance needs account_id"); description adds one sentence (each row's account balance after it, oldest first in the table's same-day order, counting rows `since_date` leaves out).

## T8 Worker tests (new)

- `apps/worker/test/view-settings.test.ts`: case 9 in full (defaults; merges; each 422; 404 Plan/Account incl. another plan's account and a deleted one; closed account 200; change_log rows with actor and before/after; All Accounts independent of an account; `GET /ui-state` does not list the keys); the surface: `apiPaths()` contains the four paths, `listedToolNames()` the four tools.
- `apps/worker/test/register-view-balance.test.ts`: case 4's numbers to the milliunit (500000, 530000, 510000, −90000), the same-day tie, `since_date` and `needs` not changing a row's balance, a deleted row and split lines not counted (a split counts once, by its parent), and the list without `include` has no `running_balance` key.
- `apps/worker/test/register-view-calls.test.ts`: copy `counting()` from `bulk-call-count.test.ts` (do not import or edit it); assert GET account 3, GET all 2, PUT account 4, PUT all 3, and the account list with `include=running_balance` 5 for 10 rows and for 1,000 rows (rows inserted through one batch), and 5 without `include`.

## T9 Web data `apps/web/src/api/view-settings.ts` (new), `apps/web/src/api/transactions.ts`

- `useViewSettings(budgetId, scope: string /* account id | "all" */)`: key `["view-settings", { budgetId, scope }]` (**object** second element: never matched by `queryKey.includes(budgetId)`), `staleTime: Infinity`, `retry: false`.
- `useSaveViewSettings(budgetId, scope)`: `onMutate` sets the cache to the merged draft (use `mergeViewSettings`), PUT, `onError` restores, `onSuccess` writes the answer. Invalidates nothing else.
- `listTransactions(budgetId, accountId)` adds `?include=running_balance`; the key is unchanged (one request for the account list, D6).

## T10 Toolbar and popover `apps/web/src/register/register-view.tsx` + `register-view.css` (new; D10, D11)

- `RegisterToolbar` takes `viewButton: ReactNode` (or `onView` + a ref) for the right group; the View button keeps its classes, loses `data-ticket`, gets `aria-haspopup="dialog"` and `aria-expanded`, and its tooltip moves from `title` to `Tooltip` (`apps/web/src/account/Tooltip.tsx`, placement above; add right alignment there only if needed). It stays in the right group at every width (never in More).
- `ViewOptionsPopover({ anchor, scope: "account" | "all", settings, firstMonth, today, onSave, onClose })`: `Popover` with `placement="below"`, `width={632}`, `role="dialog"` (add `"dialog"` to `Popover`'s `role` type; the biome comment stays), label "View Options". Heading "View Options"; six pill buttons (`aria-pressed` on the active one; none for `custom`); "From:" `<select aria-label="From month">` January…December + `<select aria-label="From year">`, "To:" likewise (`To month`, `To year`); the selects show `effectiveRange` (All Dates: first month … this month + 10 years); changing one sets the draft to `custom` with both months; checkboxes as `Box`-style `role="checkbox"` buttons named by their labels, in the design's order, Running Balance only for `account`; Cancel, Apply (primary).
- Pills: `onSave({ preset })` then close. Apply: `onSave(draft fields)` then close. Cancel/Escape/outside/View again: close only.
- Styles from the source notes §2 with `tokens.css` variables only (active pill: the accent background, white text; Cancel secondary; Apply primary).
- `firstMonth` = earlier of the plan's `created_at` month (`useCurrentPlan().plan`) and the oldest row's month in the list the page holds; `today` = `localToday()`.

## T11 Register: filter, footer, columns (D6–D9)

- `Register.tsx`: reads `useViewSettings(budgetId, account?.id ?? "all")`, provides `RegisterViewContext` `{ settings, showFlags, showBalance: !!account && settings.show_running_balance, save }` (exported from `register-view.tsx`), renders the popover from the toolbar's View button.
- `RegisterTable.tsx`: `rows` = `registerVisible(sorted, settings, today, firstMonth, reconcile?.step === "mode").rows`; the table waits for the settings (`aria-busy`, "Loading transactions…"); with `hidden > 0`, a last `<tbody className="register-footer">` with one full-width cell: `<p>Some transactions are hidden by filters.</p>` and a secondary `View All` button → `save({ preset: "all_dates", show_reconciled: true })`; with every row hidden and no scheduled row, that footer replaces "No transactions". Columns: no `col-flag`/`cell-flag` when `!showFlags`; `col-balance` + `<th className="num cell-balance">BALANCE</th>` after INFLOW and `<td className="num cell-balance">` with `screenMoney(tx.running_balance)` (`is-negative` below zero) when `showBalance`; `colCount` follows. Split-line rows get an empty balance cell.
- `EntryRow.tsx`, `ScheduledSection.tsx`, `SplitLines.tsx`: read the context; omit the flag cell when hidden, add an empty `cell-balance` when shown, fix `colCount`/`colSpan`.
- `register.css`: `.col-balance { width: 10% }`; `.cell-balance.is-negative { color: var(--labelNegative) }` (not when the row is checked: `--labelPrimary`); amount columns keep a minimum width so "−$99,999.99" fits at 1024×700 (D11).

## T12 EXF-724 fix (D12)

- `useSetCleared(budgetId, key)`: `mutationKey: ["set-cleared", budgetId]`; `onMutate` finds the row in `key`'s data (amount, account_id, old cleared), cancels and updates `["accounts", budgetId, account_id]` and the list's `balances` (cleared ± amount, uncleared ∓ amount; reconciled rows never toggle), returns all previous values; `onError` restores them; `onSettled` unchanged.
- `ReconcileBar.tsx`: `const busy = useIsMutating({ mutationKey: ["set-cleared", account.budget_id] }) > 0 || useIsFetching({ queryKey: ["accounts", account.budget_id, account.id] }) > 0`; the finishing button is `disabled={rc.pending || busy}`.

## T13 Specs

- `e2e/support/view-settings.ts` (new): `setViewSettings(request, plan, scope /* account id | "all" */, patch)` through the API.
- `e2e/register-view.spec.ts` (new), 1440×900: cases 1, 2, 3, 4, 5, 6, 7, 8, 14. Case 2 seeds rows dated today and two months back (`localToday` arithmetic in the spec). Case 4 checks the four BALANCE texts and the computed colour of the negative cell equals `--labelNegative`. After each Apply/pill/View All, `expect.poll` on the PUT's answer (`page.waitForResponse`) before asserting. Case 8 counts PUT requests (0).
- `e2e/register-view-narrow.spec.ts` (new): case 11 at 1024×700 (View inline: its box inside the toolbar and `elementFromPoint` hits it; popover box inside the viewport; BALANCE on with amounts up to −$99,999.99: every `td.num` has `scrollWidth <= clientWidth`; a long payee cut has `title`), and cases 1 and 7's popover at 1024×700.
- `e2e/reconcile.spec.ts`: add `setViewSettings(..., { show_reconciled: true })` before `goto` in "Yes reconciles at once…" and "No: the difference…"; add the EXF-724 test (case 12) and the two EXF-722 tests (case 13, T14).
- `e2e/reconcile-narrow.spec.ts` and `e2e/register-bulk.spec.ts` ("a reconciled row asks first…"): the same `setViewSettings` line before opening the page. Any other spec failing in the full run because a reconciled row is hidden gets that line and is named in the report.
- **EXF-724 test (case 12):** seed with `seedWorked`, enter reconcile mode with the No path; then `page.route("**/api/v1/budgets/**", r => setTimeout(() => r.continue(), 500))` (delay only; count PATCHes in the handler); click the cleared icon of the −100.00 transfer, then `expect(amount(page, "cleared")).toHaveText("$655.50", { timeout: 300 })`, the uncleared amount and the bar sentence likewise; assert the finishing button `toBeDisabled()` straight after the click and `toBeEnabled()` after the PATCH and the account GET answered; exactly 1 PATCH and no `view_settings` request. Then unclear ZZ Fuel: the "$20.00 higher" sentence within 300 ms. **Run it once before T12** and quote the failing line in the report.

## T14 EXF-722 tests (in `e2e/reconcile.spec.ts`)

- `let release!: () => void; const held = new Promise<void>(r => (release = r)); await page.route("**/accounts/*/reconcile", async r => { await held; await r.continue(); })`. Open Reconcile (`seedWorked`, the savings account), Yes; press Escape (second test: `realClick` on the account name heading outside the popover); `expect(popover(page)).toHaveCount(0)`; `release()`; `await page.waitForResponse(/\/reconcile$/)`; then `expect(popover(page)).toHaveCount(0)` (poll for 1 s with `expect(...).toHaveCount(0)` after a `waitForTimeout(500)`), header `/^Reconciled a few seconds ago$/`, and `rowsOf` shows the Starting Balance row `reconciled`.
- Remove the guard once (`setStep(() => (yes ? "done" : "idle"))` in `ReconcileContext.tsx`), run both, quote the failing line, restore, rerun green. No product change remains.

## Done when

- `pnpm check` passes; `pnpm e2e e2e/register-view.spec.ts e2e/register-view-narrow.spec.ts e2e/reconcile.spec.ts e2e/reconcile-narrow.spec.ts e2e/reconcile-minus-sign.spec.ts e2e/register-bulk.spec.ts e2e/register.spec.ts e2e/register-entry.spec.ts e2e/register-flags.spec.ts e2e/all-accounts.spec.ts e2e/scheduled-transactions.spec.ts e2e/splits.spec.ts` passes.
- The report gives T0's numbers before and after, the two quoted failing lines (EXF-724, EXF-722), the counting test's numbers, the specs changed for hidden reconciled rows, and `git diff --stat origin/main` showing no file outside the design's Manifest, no shared module, no `package.json`/lockfile change.
