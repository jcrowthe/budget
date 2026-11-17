# Register: approve, reject, attention and the banner (implementation spec)

Design: [register-approve-design.md](register-approve-design.md) (read its "source app", "Looking", D1 calls and order
of the work first). EXF-463 screens with EXF-680, EXF-681, EXF-728, EXF-760. No Worker change, no migration, no
dependency, no shared module. Ground: `apps/web/src/register/**`, `apps/web/src/pages/account.tsx`,
`apps/web/src/pages/accounts.tsx`, `packages/schema/src/attention.ts`, tests and docs. `apps/web/src/account/**`,
`apps/web/src/api/accounts.ts` and `apps/web/src/shell/**` are **read-only** here (import from them, never edit).
Commit after each part; run `pnpm check` before each commit; run only this Build's specs and the specs named per part
(`pnpm e2e <specs>`), never the full suite.

## Part 0: pure helpers (commit with part 1)

`packages/schema/src/attention.ts` (no React, no formatter):

```ts
export type AttentionTx = { approved: boolean; category_id: string | null; inflow_to_ready_to_assign: boolean;
  subtransactions?: readonly unknown[]; transfer_account_id: string | null; payee_system?: string | null };
/** The Worker's needsAttention() SQL, row by row. */
export function needsAttention(tx: AttentionTx, account: { on_budget: boolean },
  transferAccount: { on_budget: boolean } | null): boolean;
/** Unapproved, imported, not a transfer: the bar's Reject rule for one row (barActions). */
export function canReject(tx: { approved: boolean; import_id: string | null; source: string | null;
  transfer_account_id: string | null }): boolean;
/** Sum of needs_attention_count over the given (open) accounts. */
export function attentionTotal(accounts: readonly { needs_attention_count?: number }[]): number;
/** "1 new transaction to approve or categorize." / "N new transactions to approve or categorize." */
export function attentionBannerText(n: number): string;
export const ATTENTION_FILTER_LABEL = "Unapproved or Uncategorized";
export const NEEDS_CATEGORY_TIP = "Assign a category to this transaction so you'll know what you spent your money on.";
export const NEEDS_APPROVAL_LABEL = "This transaction needs approval";
```

`needsAttention`: `!tx.approved || (account.on_budget && !tx.category_id && !tx.inflow_to_ready_to_assign &&
!(tx.subtransactions?.length) && !(tx.transfer_account_id && transferAccount?.on_budget) &&
tx.payee_system !== "starting_balance")`. A transfer whose other account is unknown counts as "not on plan" exactly
as the SQL's `exists` does. Make `barActions` (`register-selection.ts` is outside the ground: **do not edit it**) and
`canReject` agree by test, not by import.

Tests: `packages/schema/test/attention.test.ts` (each branch of `needsAttention`, `canReject`, singular/plural,
`attentionTotal` with a missing count).

Worker test `apps/worker/test/attention-calls.test.ts` (copy the `counting()` helper of
`register-view-calls.test.ts`; use `bulk-helpers.ts`):
- **Agreement:** a plan with an on-plan and an off-plan account, rows of every branch (unapproved categorized,
  approved uncategorized, Ready to Assign, split with an uncategorized line, transfer to on-plan, transfer to
  off-plan, Starting Balance, deleted). The ids of `listAccountTransactions(..., { needs })` equal the ids of the plain
  list filtered by `needsAttention`; their count equals `getAccount(...).needs_attention_count`; the same for the plan
  list over all accounts.
- **Calls** (10 and 100 rows, same number both times, and exactly): account list with `include=running_balance` 5,
  with `needs` 5; plan list 4, with `needs` 4; `listAccounts` 5; `getAccount` 5; approve 1 row and 99 rows 6;
  reject 1 imported row and 99 rows 4 (imports made as in `bulk-call-count.test.ts`, `setSql(... import_id ...)`).
  If a number differs, record the measured one in the design's D1 table and say so in the report.

## Part 1: attention column, bolder rows, menu

`register/icons.tsx`: `InfoCircleIcon` (16×16 viewBox, stroked circle and an "i", `currentColor`). No art from the
source.

`register/AttentionMenu.tsx`:
```ts
export function AttentionCell(props: { budgetId: string; tx: TransactionDetail }): JSX.Element
```
Renders the button only when `tx.approved === false`: `type="button"`, `className="attention-button"`,
`aria-label={NEEDS_APPROVAL_LABEL}`, `aria-haspopup="menu"`, `aria-expanded`, `onClick` toggles the menu. The menu is
`<Popover anchor placement="below" width={200} label="Approval" onClose>` with `<ul className="bulk-list">` and two
`button.bulk-item[role=menuitem]`: `Approve Transaction`, `Reject Transaction` (`aria-disabled="true"` and
`title="Only an imported transaction can be rejected"` when `!canReject(tx)`; a disabled item does nothing). Choosing
calls `useApproveReject(budgetId).mutateAsync({ action, ids: [tx.id] })` once (ignore clicks while pending); success
closes the menu; failure keeps it open with `<p role="alert" className="attention-menu-error">` =
`err instanceof ApiError ? bulkRefusalText(err.detail, () => "This transaction") : err.message`. On close, focus the
icon button. Every handler calls `e.stopPropagation()` so the row never selects or opens.

`register/RegisterTable.tsx`:
- `<col className="col-attention" />` after `col-check`; `<th className="cell-attention" aria-label="Approval">` with
  `InfoCircleIcon`; `colCount` + 1.
- Data row: `<td className="cell-attention"><AttentionCell …/></td>` after `cell-check`; `<tr>` class adds
  `is-unapproved` when `!tx.approved`. Split line rows: an empty `td.cell-attention` and `is-unapproved` from the
  parent.
- Table class adds ` has-account` when `plan` (All Accounts).

`register/EntryRow.tsx`: an empty `<td className="cell-attention" />` after `cell-check`; `colCount` + 1; the
`SplitLines` `lead` + 1. `register/SplitLines.tsx`: no change beyond what `lead` gives (check the remaining row's
first cells line up). `register/ScheduledSection.tsx`: an empty `td.cell-attention` after `cell-check` (and its
`colSpan`s come from `colCount`).

`register/register.css`:
```css
.register-table .col-attention { width: 24px; }
.register-table th.cell-attention, .register-table td.cell-attention { padding: 0; text-align: center; overflow: visible; }
.register-table th.cell-attention { border-right: 0; color: var(--register-icon-muted); }
.register-table tbody tr.is-unapproved td { font-weight: 600; }
.attention-button { /* 20×20, no border, transparent, color var(--actionPrimary), inline-flex centred, cursor pointer */ }
.attention-button:focus-visible { outline: 0; box-shadow: 0 0 0 2px var(--actionPrimary); border-radius: 50%; }
.attention-menu-error { margin: 4px 12px 8px; color: var(--labelNegative); font-size: var(--font-size-sm); white-space: normal; }
```

Departures (index only): `e2e/all-accounts.spec.ts` lines 68 (`col(page, 5)` → 6), 69 (`col(page, 3)` → 4), 79
(`nth-child(3)` → 4); `e2e/register.spec.ts` line 34 (`nth-child(4)` → 5). Nothing else in existing specs.

Spec `e2e/register-approve.spec.ts` (+ `e2e/support/approve-seed.ts`), part 1 tests: design cases 1, 2, 3, 4
(approve via `expect.poll` on the API row; reject via the route in "Seeds" below; the 409 refusal; the disabled
Reject on a non-imported row), each at 1440×900 and one of them at 1024×700. `realClick` from
`e2e/support/real-click.ts` for every click; `{ exact: true }` names.

Verify: `pnpm check`; `pnpm e2e e2e/register-approve.spec.ts e2e/all-accounts.spec.ts e2e/register.spec.ts
e2e/register-view.spec.ts e2e/register-bulk.spec.ts e2e/register-entry.spec.ts e2e/splits.spec.ts
e2e/transfers.spec.ts e2e/scheduled-transactions.spec.ts e2e/reconcile.spec.ts e2e/register-flags.spec.ts`.

### Seeds (`e2e/support/approve-seed.ts`)

`seedApprove(request, opts?)` creates its own plan (`testName()` / `ZZ-TEST` name), ZZ Checking and ZZ Savings (on
plan, cash), "ZZ Group: ZZ Food", two approved categorized rows, and three rows with `approved: false` in ZZ
Checking (two categorized, one without `category_id`); returns ids. Options: `savingsUnapproved` (one more in ZZ
Savings), `old` (an unapproved row dated three months back), `reconciledUnapproved` (create cleared with `approved:
false`, then reconcile the account through `POST …/accounts/{id}/reconcile` as `e2e/support/reconcile-seed.ts` does),
`euro` (create the plan with `currency_format` EUR / `123.456,78` / symbol after and `date_format` `DD.MM.YYYY` as
`e2e/support/plan-formats-seed.ts` does). Use `call()` from `register-seed.ts`. Never assume other plans.

`stubReject(page, request, plan, mode: "delete" | 409)`: `rewriteList(page, t => ids.has(t.id) ? { import_id:
"zz-imp-" + t.id, source: "plaid" } : null)` and `page.route(/\/transactions\/reject$/)`: for `"delete"`, `DELETE
/api/v1/budgets/{plan}/transactions/{id}` through `call()` for each posted id, then fulfil 200 `{ data: {
transactions: [] } }`; for `409`, fulfil `{ error: { id: "x", name: "transaction_approved", detail: "An approved
transaction cannot be rejected" } }`. Record each posted body for the "one request" assertions.

## Part 2: pill look and tooltips

`register.css` `.needs-category`: `font-size: var(--font-size-sm); font-weight: 600;` (height, padding, radius,
colours unchanged). `RegisterTable.tsx`:
- the pill button and the split-line pill span: `title={NEEDS_CATEGORY_TIP}`;
- the category cell with a category keeps its title "<Group>: <Category>" (assert it); the cut-cell titles of
  EXF-680 are part 5, so its test can fail first.
- Cleared: no change (assert the existing title in the spec).

Spec: design cases 5 and 6 in `register-approve.spec.ts` (computed styles: `background-color`, `color`,
`font-size`, `font-weight`, `padding-left`, `padding-right`, `border-radius`).

## Part 3: banner

`register/AttentionBanner.tsx`:
```ts
export function AttentionBanner(props: { count: number | undefined }): JSX.Element | null
```
Returns null for `!count`. Markup: `<div className="attention-banner" role="region" aria-label="New transactions">`,
`<InfoCircleIcon />`, `<p>{attentionBannerText(count)}</p>`, `<button type="button" className="attention-banner-view"
onClick={() => setOn(true)}>View</button>` (from `useAttentionFilter`, part 4; in part 3 render the button without
an effect, then wire it).

CSS: `display: flex; align-items: center; gap: var(--space-2); box-sizing: border-box; width: 100%; min-height: 40px;
padding: 0 var(--space-3); background: var(--buttonPrimaryBackground); color: var(--labelPrimary); font-size:
var(--font-size-sm); font-weight: 500;` the `p` `flex: 1; margin: 0; min-width: 0; overflow: hidden; text-overflow:
ellipsis; white-space: nowrap` with `title` = its text; the View button transparent, `1px solid var(--labelPrimary)`,
radius `var(--radius-xs)`, height 28 px, padding 0 12 px, weight 600, `color: inherit`.

Pages:
- `pages/account.tsx`: inside the `SelectionProvider` and the `AttentionFilterProvider`, before `<AccountHeader>`:
  `<AttentionBanner count={account?.needs_attention_count} />` (both branches).
- `pages/accounts.tsx`: before `<AllAccountsHeader>`: `<AttentionBanner count={attentionTotal(openAccounts)} />` with
  `useOpenAccounts(budgetId)` (`register/openAccounts.ts`); render nothing until `loaded`.
- No new query, no new fetch. `apps/web/src/api/accounts.ts` stays untouched.

Spec: design case 7 (both pages; singular; none), with `page.on("request")` recording every `/api/v1` URL while
the page loads: no URL contains `needs=`, and the number of `GET …/accounts` and `GET …/accounts/{id}` requests
equals the number the same page makes on `main` (measure it once there and write it in the test's comment).

## Part 4: View and the chip

`register/attention-filter.tsx`:
```ts
export function AttentionFilterProvider({ children }: { children: ReactNode }): JSX.Element
export function useAttentionFilter(): { on: boolean; setOn: (on: boolean) => void }  // default { on: false, setOn: noop }
```
Pages wrap banner + register in it (inside the keyed `SelectionProvider`, so changing account or leaving drops it).

`RegisterTable.tsx` (`useMemo` that builds `rows`): when `on`,
`rows = sortTransactions(data.transactions.filter(tx => needsAttention(tx, accountOf(tx), transferOf(tx)) &&
(account || openIds.has(tx.account_id))), sort.column, sort.dir)`, `hidden = 0`; pass `rows={[]}` to
`ScheduledSection` (do not call fewer hooks: keep `useScheduledRows`). `openIds` from `useOpenAccounts` (already in
the component). `view.save` is never called by the filter.

`Register.tsx`: when `on`, between `<ReconcileBar />` and `<RegisterTable>`:
`<div className="attention-filter-row"><button type="button" className="attention-chip" aria-label="Remove filter:
Unapproved or Uncategorized" onClick={() => setOn(false)}><span>{ATTENTION_FILTER_LABEL}</span><CloseSmallIcon
/></button></div>`. CSS: row `padding: var(--space-2) var(--space-3)`, border-bottom `--separatorStandard`; chip as
`.flag-pill` (24 px, radius 24 px, 1 px `--separatorStandard`, `--labelSecondary`, 14 px/500, gap 4 px, padding 0
8 px), hover `--register-menu-hover`.

Spec: design case 8 (View options set through the API as `e2e/support/view-settings.ts` does; assert the stored
settings unchanged by `GET …/view_settings` after toggling); design case 9 (bulk Approve of three real rows, API
poll); design case 10 (reconcile mode via the header's Reconcile flow as `e2e/reconcile.spec.ts` does; a scheduled
row's `td.cell-attention` is empty; a closed account: close it through the API and open its page).

Verify: `pnpm e2e e2e/register-approve.spec.ts e2e/register-view.spec.ts e2e/reconcile.spec.ts
e2e/scheduled-transactions.spec.ts`.

## Part 5: riders (each test first run on the code **before** its fix; quote the failing line in the report)

`e2e/register-attention-narrow.spec.ts`, all at `page.setViewportSize({ width: 1024, height: 700 })`, own plan:
- **EXF-680:** a split (60.00 → 25.00 + 35.00, two categories with long names) and a transfer ZZ Checking ↔ ZZ
  Savings. On All Accounts and on ZZ Checking: for every `td[data-field=category]` whose `scrollWidth >
  clientWidth`: `text-overflow` is `ellipsis` and `title` equals its `textContent` (trimmed; for the split parent
  `"Split (Multiple Categories)..."`). Fix in `RegisterTable.tsx`: the category `td` title is `pay?.category` ??
  the text for `text`, `"Split (Multiple Categories)..."` for `split`, `"Category not needed"` for `notNeeded`, none
  for `needsCategory`; a split line's category `td` gets the text it shows (`"<Group>: <Category>"`, the name alone,
  `"Inflow: Ready to Assign"`), none for its pill.
- **EXF-681:** open the transfer row (double `realClick` on its date cell), focus stays on the date: the Payee input
  (`getByRole("combobox", { name: "Payee", exact: true })`) has `scrollWidth > clientWidth` and `title` = its value.
  Same on a credit card's Record Payment row (`Payment from ZZ Checking`). Fix: `PayeeField.tsx` passes `title={title
  ?? (value.name || undefined)}` to `PickerInput`.
- **EXF-728:** ZZ Checking with BALANCE on (save view settings through the API): for every `thead th` and its
  `.sort-button`: whole (`scrollWidth <= clientWidth`) or `text-overflow: ellipsis` with `title` = the label;
  CATEGORY whole. Also defaults and flags off.
- **EXF-760:** All Accounts, defaults and flags off: as EXF-728, plus the CATEGORY `th` width ≥ 88 px, a category
  cell with "ZZ Group: ZZ Food" shows "ZZ Group:" (its text box's first 9 characters inside the cell: assert
  `clientWidth >= ` the measured width of "ZZ Group:" via a canvas `measureText` in the page with the cell's font),
  each header's right edge ≤ its cell's right edge, and `document.documentElement.scrollWidth <= innerWidth` and the
  `.main` element's `scrollWidth <= clientWidth`.

Fixes in `register.css`:
```css
.register-table th { overflow: hidden; white-space: nowrap; }        /* sort-icon stays inside (absolute, right 8px) */
.sort-button { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; vertical-align: middle; }
.register-table th.num.is-active .sort-button { max-width: calc(100% - 16px); }
@media (max-width: 1279px) {
  .register-table .col-payee, .register-table .col-memo { width: 14%; }
  .register-table.has-balance .col-payee, .register-table.has-balance .col-memo { width: 10%; }
  .register-table.no-flags.has-balance .col-payee, .register-table.no-flags.has-balance .col-memo { width: 11%; }
  .register-table.has-account .col-payee, .register-table.has-account .col-memo { width: 10%; }
  .register-table.has-account.no-flags .col-payee, .register-table.has-account.no-flags .col-memo { width: 12%; }
}
```
Replace the existing `@media (max-width: 1279px)` block (13 %) with this one; keep it after the `no-flags` rules so
equal specificity resolves to it. `RegisterTable.tsx`: `title={h.label}` on each `.sort-button`; `title="BALANCE"`
on the BALANCE `th`. Check flag and cleared header icons still show (their `th`s clip now).

Measure, at 1024×700, every column's width in the six states of the design's table and in the same states at
1440×900; write both tables in the report (and correct the design's table if a value differs by more than 2 px).

## Part 6: narrow-window spec for the whole register

Same file, one test per state: ZZ Checking defaults, BALANCE on, flags off, flags off + BALANCE, All Accounts
defaults and flags off, each with the three unapproved rows (icons shown) and the banner on: every header whole or
cut with ellipsis and title; CATEGORY ≥ 88 px; the attention column 24 px; no horizontal
scroll; the banner's `View` inside the window; the icon's menu inside the window (`boundingBox` within the viewport).
At 1440×900 the same test with every header whole.

Verify: `pnpm e2e e2e/register-attention-narrow.spec.ts e2e/register-view-narrow.spec.ts
e2e/plan-formats-narrow.spec.ts e2e/reconcile-narrow.spec.ts e2e/all-accounts.spec.ts`.

## Docs

- `docs/register-approve-polish.md`: the Designer's list (each item "not compared: built from the ticket") with
  applied status, written by whoever applies it.
- The design's D1 table and widths table are corrected from the measurements if they differ.
- `docs/README.md` already holds the design's line; add nothing else there.

## Report checklist (Implementer)

Per part: the commit, the specs run with their result lines; per rider: the failing line before the fix; every
departure (the four index edits only); the measured width tables; confirmation that `git diff --stat main` lists no
file outside the design's Manifest `touches`, no file of the brief's note 9 out-of-bounds list, no shared module,
and no `package.json`/lockfile change; every action taken in the source app (none expected).
