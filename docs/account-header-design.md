# Account header, All Accounts register, stored updated_at (EXF-484, EXF-534, EXF-570)

One Build, three tickets. They touch the same pages and transactions files.

- **EXF-570**: `transactions.updated_at` becomes a stored column. The other two read the data layer it changes, so it comes first.
- **EXF-484**: the account page header. That is the name, star, type badge, "Not Yet Reconciled", pencil, Reconcile, and the balance row with tooltips. It also adds starring (PATCH), a plan summary, and the MCP tools `get_account`/`update_account`.
- **EXF-534**: the All Accounts page. It has a title, the balance row, the register toolbar, and the register table with an ACCOUNT column. It is backed by a plan-wide transactions list (REST, and MCP `list_transactions` without `account_id`).

Spec: [account-header-spec.md](account-header-spec.md). Where the Lead's scope notes differ from the tickets, the notes win.

## Source

Studied live on 2026-11-16: plan "Test Budget", dark theme, 1600×813, every account closed. Notes and screenshots (cropped right of the 260px sidebar) are in `/workspace/scratch/source/account-header/`: `notes.md` (exact values, §1–4), `01`/`02` (account header), `03`–`07` (pencil, Reconcile, three balance tooltips), `08`/`09`/`11` (All Accounts), `12` (tracking badge).

- **Top row**: padding 16px, background `#15172d`, height 83.2px. Name 24px/700 (line-height 28.8px, ellipsis, `title`). Info row 8px below: 12px/500 `#c4c5cf` items 16px apart, each a 12px icon + 4px gap: banknote + "Checking" (tracking: rising chart + "Tracking Account: Asset"), padlock + "Not Yet Reconciled". Right, 8px apart: pencil 48×32 (radius 8px, padding 6px 16px, background `rgba(117,131,255,.2)`, hover `#7583ff45`, 16px icon `#f1f1ff`) and "Reconcile" (32px, radius 8px, `#545bfe`, hover `#7583ff`, white 16px/500).
- **Star**: absent on a closed account (all the source has). Source CSS: grey `#727484`, gold `#f8d655`. The ticket (open accounts): outline grey, filled gold when starred, after the name.
- **Rule** 1px `rgba(255,255,255,.1)`. **Balance row**: padding 16px, `#15172d`, 72px. Block = amount (18px/600, line-height 21.6px, min-height 24px) over label (12px/500, line-height 16px, `#c4c5cf`, 12px icon, 4px gap). "+"/"=" 18px/600 `#c4c5cf`, padding 0 16px. Cleared label icon: filled disc with a C cut out; Uncleared: outlined circle with a C; Working: none. Amounts ≥ 0 green `#77ba21`, negative white. Blocks `tabindex=0`; tab order pencil, Reconcile, cleared, uncleared, working.
- **Tooltips**: background `#3c3e53`, text `#ededf5`, 12px, radius 6px, padding 8px, max-width 288px, shadow `0 2px 5px rgba(0,0,0,.15)`, 8px below the trigger; balance ones left-aligned to the block, pencil/Reconcile right-aligned. Pencil and balances fade in after ~1.9s; Reconcile at once: "Reconcile" (12px/500) then key caps "shift" "E" (14px/500, `rgba(255,255,255,.15)`, radius 4px, padding 0 4px, 20px). Texts as the ticket; pencil "Edit Account".
- **All Accounts**: title only (top row 60.8px), no info row, star or buttons; same rule and balance row. Toolbar identical to an account page but for "Search All Accounts"; no Link Account (the register already draws it so).
- **All Accounts table**: checkbox, flag, image, **ACCOUNT** (133.9px of 1340 ≈ 10%, like OUTFLOW/INFLOW, taken from CATEGORY), DATE, PAYEE, CATEGORY, MEMO, OUTFLOW, INFLOW, cleared. ACCOUNT cell plain 14px/500 white; tracking rows "Category not needed" (`#c4c5cf`). Default DATE ▼; every header sortable; accounts interleave.

## Approach

Follow `docs/conventions.md`: files only, services take `(env, actor, input)`, and each write is one `db.batch` with its `change_log` row. Shared modules are not touched (`history/**`, `api/client.ts`, `shell/**`, `router.tsx`, `packages/core/**`).

### EXF-570: stored `updated_at`

**Migration** `apps/worker/migrations/<UTC YYYYMMDDHHMMSS>_transactions_updated_at.sql`. Take the timestamp with `date -u +%Y%m%d%H%M%S` when you write the file. It has to sort after every migration on `origin/main` at rebase time. It contains two statements:

```sql
ALTER TABLE transactions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE transactions SET updated_at = max(created_at, coalesce((SELECT max(c.created_at) FROM change_log c
  WHERE c.entity_type = 'transaction' AND c.entity_id = transactions.id AND c.budget_id = transactions.budget_id), created_at));
```

**Not null.** SQLite only allows `ADD COLUMN … NOT NULL` with a non-null default, so the column is `NOT NULL DEFAULT ''`. The backfill then fills every existing row. The Drizzle column is `text("updated_at").notNull()` with **no** Drizzle default, so TypeScript makes every writer set it. The `''` default can only be reached by raw SQL that omits the column, and a test asserts no row holds it. The backfill gives exactly what the API derived before (`max(change_log) if later than created_at, else created_at`), so the values do not change.

**Writers** set `updated_at` to the same `now` they use for the row, in the same batch as the history row:

- `createTransaction` and `addTransaction` (insert: `updatedAt = createdAt`);
- `updateTransaction` (`updateIfHoldsStmt` sets `updatedAt: now`);
- `deleteTransaction` (`softDeleteIfHoldsStmt` sets `deletedAt` and `updatedAt` to the same `now`);
- the Starting Balance in `addUnlinkedAccount` (`insertIfStmt`, which lists the columns by position, gains `updatedAt` last, after `deletedAt`: an added column comes last in the table).

`changeLogInsert` stamps its own `created_at` a few ms after the service's `now`, and `history/**` is shared. So the column is the service's write time. Tests bracket it between the times before and after the request.

**Reads** take `row.updatedAt`. `lastChangedAt` (the grouped `change_log` query) is deleted, and `transactionDetailToApi(row)` loses its second argument. No response shape changes.

**`category-reassign.ts`** (EXF-494/495) is not on `origin/main` at `2fcde22`. Check again before the final commit and after every rebase: `git ls-tree origin/main apps/worker/src/repositories/category-reassign.ts`. If it is there, its update statement also sets `updatedAt` (one `now` for the batch), with a test. If it is not, say so in the report.

### EXF-484: API

| Method, path | Body / query | 2xx |
| -- | -- | -- |
| `PATCH /budgets/{budget_id}/accounts/{account_id}` | `AccountUpdateRequest` `{starred: boolean}` (strict) | 200 `{data:{account}}` (after) |
| `GET /budgets/{budget_id}/account-summary` | | 200 `{data:{balances:{cleared,uncleared,working}}}` |

- **Summary path.** It is `/account-summary`, a separate segment, so `/accounts/summary` can only ever be the account route. That route answers 404 "Account not found" because "summary" is not an account id. A test asserts this.
- **Summary scope.** It sums every **open**, non-deleted account: credit, loans and tracking included, closed excluded. The repository function `openAccountsBalances` is the only computation, and both the summary and the plan-wide list (EXF-534) use it.
- **PATCH.**
  - Read `before`. If the value already matches, nothing is written and the route answers 200 with the account.
  - Otherwise one batch: `[changeLogInsertIf(update, account, before→after, guard), setStarredIfStmt(guard)]`. The guard is "same id, not deleted, `starred` and `closed` as read". A lost race retries 5 times, then answers `Conflict` 409.
  - The history row is action `update` on entity type `account`, with `before` and `after` as the `Account` API shape, and the actor `user:…` or `mcp:…`.
  - `starred: true` on a closed account answers 422 `unprocessable_entity` "A closed account cannot be starred", with no write and no log. `starred: false` on a closed account is allowed.
  - Unknown plan or account: 404. An empty body or unknown key: 422.
- `last_reconciled_at` is not added (EXF-533).
- **MCP** (`mcp/tools/accounts.ts`):
  - `get_account {budget_id, account_id}` returns `{account}`;
  - `update_account {budget_id, account_id, starred?}` returns `{account}`, through the same service as PATCH;
  - a refusal is an `isError` result with the same message.

### EXF-534: API

| Method, path | Query | 2xx |
| -- | -- | -- |
| `GET /budgets/{budget_id}/transactions` | `since_date`, `sort=account\|date\|payee\|category\|memo\|outflow\|inflow`, `dir` (default `date`,`desc`) | 200 `{data:{transactions: PlanTransaction[], balances}}` |

- **Rows**: every non-deleted transaction of every non-deleted account of the plan, **open and closed**. Each is a `PlanTransaction` = `TransactionDetail` + `account_name`.
- **Balances**: `openAccountsBalances`, which ignores `since_date`. They equal `account-summary`.
- **Sort**: `sortTransactions` with the new `"account"` column (key `account_name`, same tie rules). The account list's `sort` enum is unchanged.
- **MCP** `list_transactions`: `account_id` becomes optional. Without it the tool returns the plan-wide `{transactions, balances}`, deep-equal to the REST `data`.

### Web

- **`apps/web/src/account/`** (new): `AccountHeader.tsx` (`AccountHeader`, `AllAccountsHeader`, `BalanceRow`), `Tooltip.tsx`, `icons.tsx` (Budget's own SVGs: cash, card, chart-up, chart-down, lock, pencil, star outline/filled) and `account-header.css`. Colours with no token are custom properties at its top: `--account-star-off: #727484`, `--account-star-on: #f8d655`, `--account-rule: rgba(255,255,255,.1)`, `--account-tooltip-label: #ededf5`, `--account-tooltip-shadow`, `--account-secondary-hover: rgba(117,131,255,.27)`, `--account-tooltip-delay: 1.9s`. Classes use the prefix `acct-`, so no old shell rule applies.
- **Header** `header.acct-head`: `.acct-head-top` = left `h1` (name, `title`) + `button.acct-star` (aria-label "Toggle Starred", `aria-pressed`; **not rendered when `closed`**), `.acct-info` (badge icon + `ACCOUNT_BADGE[type]`; lock + "Not Yet Reconciled"); right `.acct-actions` = `button.acct-edit` (aria-label and tooltip "Edit Account", `data-ticket="EXF-486"`) and `button.acct-reconcile` "Reconcile" (tooltip "Reconcile" + `<kbd>shift</kbd><kbd>E</kbd>`, `data-ticket="EXF-533"`), neither with a handler; shift+E unbound. Then `hr.acct-rule` and `BalanceRow`: `div.acct-balances` (`role=group`, "Balances") with three `div.acct-balance[data-balance=cleared|uncleared|working]` (`tabindex=0`, `aria-describedby` its tooltip) holding `span.acct-amount` (`.is-negative` below 0) and `span.acct-label`, with `i.acct-op` "+"/"=" between. Amounts use `formatMoney`; while loading they are empty and the row keeps 72px.
- **Badge icon**: checking/savings/cash → cash; creditCard/lineOfCredit → card; otherAsset → chart-up; otherLiability (and loan types, not creatable yet, with `ACCOUNT_TYPE_LABEL`) → chart-down.
- **Tooltip**: mounted only while the trigger is hovered or focused (`role=tooltip`, linked by id); fades in after `--account-tooltip-delay` (balances, pencil) or at once (Reconcile); Escape, blur or leave hides it.
- **Starring**: `useSetStarred(budgetId, accountId)` (`api/accounts.ts`) PATCHes `{starred}` with an `Idempotency-Key`, flips `starred` optimistically in `["accounts", budgetId, accountId]` and in the list `["accounts", budgetId]`, rolls back on error, and invalidates `["accounts", budgetId]` (prefix of both) when settled, so the sidebar's STARRED group follows without editing the sidebar.
- **Pages**: `account.tsx` = `<AccountHeader account>` + `<Register budgetId account>` (old inline header removed; loading = empty `acct-head`). `accounts.tsx` = `<AllAccountsHeader budgetId>` (reads `useAccountSummary`, key `["account-summary", budgetId]`) + `<Register budgetId>`.
- **Register, extended not copied**: `Register`/`RegisterTable({budgetId, account?})`; no account = plan mode: toolbar name "All Accounts" ("Search All Accounts"), rows from `usePlanTransactions(budgetId)` (key `["transactions", budgetId, "all"]`), table aria-label "All Accounts transactions", an `ACCOUNT` column (`col-account`, 10%) between checkbox and DATE sortable like the others, CATEGORY always shown with each row's category cell judged by that row's account (from `useAccounts`), so tracking rows read "Category not needed"; default date desc. `useSetCleared(budgetId, queryKey)` takes the list's key; when settled it still invalidates every query containing `budgetId` (both lists, summary, account, sidebar). Account mode is unchanged.

## Downstream effects

- **EXF-486** wires `.acct-edit` (Edit Account dialog) and extends `AccountUpdateRequest` and `update_account` with name, note and closed. Closing must also unstar.
- **EXF-533** wires Reconcile and shift+E, adds `last_reconciled_at`, and replaces "Not Yet Reconciled" with the age text.
- **EXF-530** makes Undo revert a star toggle.
- The **credit area** adds the Payment pill to `BalanceRow`'s right end.
- **EXF-517** gives All Accounts' add row an account field. Its rows appear in `["transactions", budgetId, "all"]`.
- **EXF-528** wires the `Account: <name>` search. **EXF-529** adds the View options without Running Balance. **EXF-463** adds the banner. Area 7 adds Scheduled Transactions.
- EXF-477 (import) and EXF-462 (Plaid) must set `updated_at` on insert. Drizzle's not-null type enforces it.
- **Shell rules this Build leaves unused** (leave them; a shell Build removes them):
  - in `shell/global.css`: `.account-header`, `.account-header h1`, `.account-badge`, `.account-balances`, `.account-balance`, `.account-balance .amount`, `.account-balance .label`, `.account-balances .operator`, `.page-header.accounts`;
  - `PageHeader`'s `"accounts"` variant.

## Out of scope

- Actions of the pencil, Reconcile, shift+E and Undo of starring.
- The Payment pill, `last_reconciled_at`, and the loan header (area 6).
- Closing or reopening an account.
- On All Accounts: the add row and its account picker, the `Account:` search, View options, the Scheduled Transactions group, the new-transactions banner, flags, images and the footer "Some transactions are hidden by filters".
- A sticky header top: the header scrolls and the register toolbar stays sticky, as today.
- The out-of-bounds files of Lead note 10: `shell/**`, `packages/core/**`, `packages/schema/src/budgets.ts`, the budgets files, `scripts/**`, the plan and category files, and every `paths.always_overlap` file.

## Acceptance

**Clone**: data through the API in a fresh `ZZ-TEST …` plan (`POST /api/v1/budgets`, `…/accounts`, `…/transactions`), 1600×813.
**Source** (compare cases): plan "Test Budget", dark, 1600×813; expand the sidebar's CLOSED group and open "D3 Checking Main" (Checking) or "D3 Tracking Probe" (Asset), or click "All Accounts". **Look and hover only** (never the star, pencil, Reconcile or Add Transaction); collapse CLOSED afterwards. The source has only closed accounts: the star and non-zero amounts come from the ticket.

1. **[EXF-484] Checking header (compare).** Checking "ZZ Chk", balance 250000: `h1` "ZZ Chk", a grey outline "Toggle Starred" button (`aria-pressed=false`); under it the cash icon + "Checking" and a lock + "Not Yet Reconciled"; at the right the pencil ("Edit Account") and a primary "Reconcile". Sizes and colours as the Source section. Source: "D3 Checking Main" (no star: closed).
2. **[EXF-484] Worked example.** Account with 250000 (cleared Starting Balance), then POST +312500 cleared and −250000 uncleared: the row reads `$562.50` + `-$250.00` = `$312.50`; cleared and working amounts `rgb(119, 186, 33)`, uncleared `rgb(255, 255, 255)`. Toggle the −250000 row's "C": `$312.50` + `$0.00` = `$312.50`, all green, no reload.
3. **[EXF-484] Tooltips (compare).** Hovering (or tab-focusing) each balance block shows a `role=tooltip` with the ticket's text word for word after the delay; the pencil shows "Edit Account"; Reconcile shows "Reconcile" + key caps "shift" "E" at once. Source: hover the same on "D3 Checking Main"; compare place, width, colours.
4. **[EXF-484] Badges (compare).** Asset: "Tracking Account: Asset" + chart-up; Liability: "Tracking Account: Liability" + chart-down; Credit Card: "Credit Card" + card. Source: "D3 Tracking Probe".
5. **[EXF-484] Starring.** Click the star: at once filled gold `rgb(248, 214, 85)`, `aria-pressed=true`, and the sidebar shows a STARRED group with the account; still so after a reload. Click again: grey outline, STARRED gone. `change_log` has two `update` rows on `account` with actor `user:…`.
6. **[EXF-484] All Accounts header (compare).** Plan with Checking 250000, Credit Card 150000 (stored −150000), Asset 5000000: `h1` "All Accounts" with no star, badge, lock, pencil or Reconcile; `$5,100.00` + `$0.00` = `$5,100.00`, the sum of the open accounts' balances. Source: "All Accounts" (top row 60.8px, same balance row).
7. **[EXF-484] Closed.** Worker: `closed = 1` in D1 → `PATCH {starred:true}` 422 with no log; `{starred:false}` 200. Browser: `page.route` answers `GET …/accounts/{id}` with `closed: true` → no "Toggle Starred" button.
8. **[EXF-484] API, MCP, summary.** PATCH and `update_account` write the same history shape (actors `user:…`, `mcp:…`); `get_account` deep-equals REST GET; `account-summary` equals the sums of the open accounts' three balances and excludes a closed account with a balance; `GET …/accounts/summary` is 404 "Account not found"; unknown plan/account 404; empty body 422; an Idempotency-Key replays the PATCH.
9. **[EXF-534] All Accounts register (compare).** Two accounts with rows on different dates: headers checkbox, ACCOUNT, DATE, PAYEE, CATEGORY, MEMO, OUTFLOW, INFLOW, cleared; ACCOUNT cells name each row's account; newest first (DATE ▼); an Asset row's category reads "Category not needed"; toolbar Add Transaction, File Import, Undo, Redo, View, "Search All Accounts"; no Link Account, Reconcile or BALANCE column. Source: "All Accounts" (order, header style, ACCOUNT ≈ OUTFLOW width).
10. **[EXF-534] Sorting.** ACCOUNT click: ▼ on ACCOUNT only, names descending; again ▲; DATE restores newest first. The active `th` has `aria-sort`; `GET …/transactions?sort=account&dir=asc` gives the same order.
11. **[EXF-534] Totals and toggle.** All Accounts balances equal `account-summary`. Toggling an uncleared row's "C" there changes the totals without a reload; the sidebar row keeps its working balance; that account's page shows the row cleared and the new cleared/uncleared amounts.
12. **[EXF-534] REST = MCP.** `list_transactions {budget_id}` deep-equals `GET …/transactions` data; rows include a closed account's rows, exclude a deleted transaction, carry `account_name`; balances exclude the closed account.
13. **[EXF-570] updated_at.** After POST, `updated_at == created_at`; after a PATCH of the amount and after a PATCH of `cleared`, it lies between the times before and after the request and exceeds the previous value; MCP and REST rows agree; the Starting Balance of `POST …/accounts` has `updated_at == created_at`; no row has `''`.
14. **[EXF-570] No change_log read.** With `env.DB` wrapped to record `prepare()` SQL, neither `GET …/accounts/{id}/transactions` nor `GET …/transactions` runs SQL mentioning `change_log`; `lastChangedAt` is no longer exported.
15. **[EXF-570] Backfill.** The migration's UPDATE (from `env.TEST_MIGRATIONS`) over rows with `updated_at = ''` gives: no history → `created_at`; one later row → its time; three → the newest; one older than `created_at` → `created_at`; each equal to the old derivation.
16. **No regressions.** `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `e2e/mcp.spec.ts` unchanged and green; `accounts.test.ts` asserts `/account-summary`, the `patch` on `/accounts/{account_id}` and the two tools; `transactions.test.ts` the `get` on `/budgets/{budget_id}/transactions`; `e2e/register.spec.ts` and `e2e/accounts.spec.ts` change only their balance locators; `schema-drift.test.ts`, `pnpm check`, `pnpm e2e` pass.

## Manifest

touches: [apps/worker/migrations/*_transactions_updated_at.sql, apps/worker/src/db/schema/transactions.ts, packages/schema/src/transactions.ts, packages/schema/src/register.ts, packages/schema/src/accounts.ts, packages/schema/test/register.test.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/services/transactions.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/services/accounts.ts, apps/worker/src/routes/accounts.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/repositories/category-reassign.ts, apps/worker/test/transactions.test.ts, apps/worker/test/accounts.test.ts, apps/worker/test/account-star.test.ts, apps/worker/test/plan-transactions.test.ts, apps/worker/test/transactions-updated-at.test.ts, apps/web/src/account/**, apps/web/src/register/**, apps/web/src/pages/account.tsx, apps/web/src/pages/accounts.tsx, apps/web/src/api/transactions.ts, apps/web/src/api/accounts.ts, e2e/account-header.spec.ts, e2e/all-accounts.spec.ts, e2e/register.spec.ts, e2e/accounts.spec.ts, docs/account-header-design.md, docs/account-header-spec.md, docs/README.md]
shared: []
migrations: 1

`apps/worker/src/repositories/category-reassign.ts` is touched only if EXF-494/495 has landed on main by the final rebase (Lead note 2).
