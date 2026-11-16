# Transfers and splits spec (EXF-526, EXF-524)

Tasks for the Implementer, in order. Behaviour and acceptance are in
[transfers-splits-design.md](transfers-splits-design.md). Transfers first (§1–§7 transfer parts, then §8 transfer
UI), then splits. Run `pnpm check` after each section; never edit the out-of-bounds files of Lead notes 11 and 15
(`services/months.ts`, `packages/core/src/**`, any accounts/categories/months/reports file, `apps/web/src/plan/**`,
`apps/web/src/shell/**`, `paths.always_overlap`). Importing from them is fine.

## 1. Migration and table

- `apps/worker/migrations/20261116100500_transfers_splits.sql`: four `ALTER TABLE transactions ADD COLUMN`
  (`transfer_account_id TEXT`, `transfer_transaction_id TEXT`, `parent_transaction_id TEXT`, `split_index
  INTEGER`), `CREATE INDEX transactions_transfer ON transactions(transfer_transaction_id)`, `CREATE INDEX
  transactions_parent ON transactions(parent_transaction_id)`. Delete `.e2e-state` after adding it.
- `apps/worker/src/db/schema/transactions.ts`: the four columns **after `payeeId`** (`transferAccountId`,
  `transferTransactionId`, `parentTransactionId`, `splitIndex`) and the two indexes.
- Verify: `schema-drift.test.ts` passes.

## 2. Schemas (`packages/schema/src`)

**`transfers.ts`** (new):
```ts
export type CategoryRule = "category" | "not_needed" | "none";
export function transferCategoryRule(side: { on_budget: boolean }, other: { on_budget: boolean } | null): CategoryRule;
export const TRANSFER_PAYEE_PREFIX = "transfer:";
export const transferPayeeId = (accountId: string) => `transfer:${accountId}`;
export const transferPayeeName = (name: string) => `Transfer : ${name}`;   // payee name, title
export const transferPayeeLabel = (name: string) => `To/From ${name}`;      // picker label
export const transferCellText = (name: string) => `Transfer: ${name}`;      // saved row text
```
Rule: `!side.on_budget` → `none`; `other && other.on_budget` → `not_needed`; else `category`. Test
`packages/schema/test/transfers.test.ts`: the six rows of the design's table.

**`split.ts`** (new), all milliunits:
```ts
export const splitSum = (lines: readonly number[]) => number;
export const splitRemaining = (total: number, lines: readonly number[]) => number;      // total − sum
export function splitRemainingColumns(r: number): { outflow: number; inflow: number }; // r<0 → {−r,0}; r>0 → {0,r}
export function autoDistribute(total: number, lines: readonly number[]): number[];
export function unbalancedText(total: number, sum: number): string;
```
`autoDistribute`: sum ≠ 0 → each but the last `Math.round(line * total / sum / 10) * 10`, last = total − others;
sum = 0 → equal parts by the same rounding, remainder on the last. `unbalancedText` uses `formatMoney`:
`The total is ${f(total)}, but the splits add up to ${f(sum)}. How would you like to handle the unassigned ${f(total - sum)}?`
Test `packages/schema/test/split.test.ts`: (−100000; −60000, −25000) → [−70590, −29410]; remaining columns for
100/60+25, 100/60+50, 100/60+40 as in the design; three lines with a rounding remainder; sum 0; mixed signs keep
the total; the exact dialog sentence for −100000/−85000.

**`transactions.ts`**:
- `SubTransactionInput = z.object({ amount: Milliunits, payee_id, payee_name, category_id, inflow_to_ready_to_assign:
  z.boolean().optional(), memo }).strict()` (reuse `requestFields` members).
- `requestFields` gains `transfer_account_id: z.string().min(1).nullable().optional().describe("The other account
  of a transfer: the server creates or keeps its paired row (opposite amount, same date and memo).")` and
  `subtransactions: z.array(SubTransactionInput).max(50).optional().describe("Split lines (at least two) whose
  amounts add up to amount; on update [] turns a split back into a plain transaction.")`. Add both to
  `updateFields`.
- `SubTransaction = z.object({ id, amount, payee_id, payee_name, category_id, category_name, category_group_name,
  inflow_to_ready_to_assign, memo }).openapi("SubTransaction")`.
- `TransactionDetail` extends with `transfer_account_id: z.string().nullable()`, `transfer_transaction_id:
  z.string().nullable()`, `transfer_account_name: z.string().nullable()`, `subtransactions: z.array(SubTransaction)`.
  `Transaction` is **unchanged** (accounts' Starting Balance response uses it).

**`payees.ts`**: `Payee` gains `transfer_account_id: z.string().nullable()`. `payeeMenu(payees, text, opts?: {
currentAccountId?: string | null; transfers?: boolean })` (default `transfers: true`): `saved` and hidden matching
skip entries with `transfer_account_id`; new `transfers: Payee[]` (entries with `transfer_account_id`, not
`currentAccountId`, sorted with `compareNames`, filtered by case-insensitive substring of the payee name or of
`To/From <name>` where `<name>` = name without the `Transfer : ` prefix; empty when `transfers: false`);
`transfersHeading: "Payments and Transfers"`. `active` indexes `[top?, ...transfers, ...saved]`: with text, first
saved match, else first transfer, else 0; nothing typed, −1. Extend `packages/schema/test/payees.test.ts`.

**`register.ts`**: `SortableTx` gains optional `transfer_account_id` and `subtransactions`. `categoryText` returns
`Split (Multiple Categories)...` when `subtransactions?.length`. `categoryCell(tx, account, transferAccount?: {
on_budget: boolean } | null)`: split → `{ kind: "split" }`; text; `!account.on_budget` → notNeeded; transfer whose
`transferCategoryRule` is `not_needed` → notNeeded; credit Starting Balance → notNeeded; else needsCategory. Extend
`register.test.ts`.

## 3. Repositories

**`repositories/transactions.ts`**:
- `TransactionRow = Omit<Sel, LinkCols> & Partial<Pick<Sel, LinkCols>>` (`Sel = typeof transactions.$inferSelect`,
  `LinkCols` = the four new fields). `insertIfStmt` appends `${r.transferAccountId ?? null}, …, ${r.splitIndex ??
  null}` in table order. `services/accounts.ts` must compile untouched.
- `balancesByAccount`, `openAccountsBalances`: add `isNull(transactions.parentTransactionId)`.
- `activityByMonth`: left join `ta = alias(accounts, "ta")` on `ta.id = transactions.transferAccountId`; add
  conditions `not (t.transfer_account_id is not null and accounts.on_budget = 1 and coalesce(ta.on_budget, 0) = 1)`
  and `not exists (select 1 from transactions l where l.parent_transaction_id = transactions.id and l.deleted_at is
  null)`. Lines need nothing else.
- `detailSelect` / `listDetailForPlan`: left join `ta`; exclude lines; `TransactionDetailRow` gains
  `transferAccountName`; when `transferAccountId` is set, `payeeName` = `transferPayeeName(ta.name)`.
- `listLines(db, budgetId, filter: { accountId?: string; parentId?: string; sinceDate?: string })` → line rows with
  category and group names, payee name (`coalesce(payees.name, payee_name)`), ordered by `split_index`; the
  service groups them by `parentTransactionId`. `findDetail` excludes lines and attaches its lines.
- `holdsAt(db, row)`: `holds` plus `updated_at = row.updatedAt`; include `transferAccountId` and
  `transferTransactionId` in `holdsCondition` (null-safe `same`).
- Statements (unexecuted, each takes a `guard: SQLWrapper`): `insertIfStmt` (exists), `updateIfStmt(db, id, set,
  guard)`, `softDeleteLinesIfStmt(db, parentId, at, guard)`, `syncLinesIfStmt(db, parentId, { accountId, date,
  cleared, approved, updatedAt }, guard)`, `softDeleteIfStmt(db, id, at, guard)`, and `writtenAt(db, id, at)` (a
  `SELECT 1` where `id = ? and updated_at = at`).

**`repositories/payees.ts`**: in `listForPlan`'s last-category subquery add `and t.parent_transaction_id is null
and not exists (select 1 from transactions l where l.parent_transaction_id = t.id and l.deleted_at is null)`.

## 4. Services

**`services/payees.ts`**: `listPayees` appends, for `accountsRepo.list(db, budgetId, { includeClosed: false })`,
`{ id: transferPayeeId(a.id), name: transferPayeeName(a.name), hidden: false, system: null, last_category_id: null,
transfer_account_id: a.id }` before the `q` filter and sort; `payeeToApi` sets `transfer_account_id: null`.
`resolvePayee`: an id starting with `transfer:` → 422 "Use transfer_account_id for a transfer".

**`services/transaction-pairs.ts`** (new): pure planning for transfers.
```ts
export type PairPlan = {
  self: TransactionRow;                  // merged row of the side requested
  other?: { kind: "update" | "insert" | "delete"; row: TransactionRow }[]; // 0–2 entries (re-link: delete + insert)
};
export function mirror(self: TransactionRow, other: TransactionRow): TransactionRow; // −amount, date, memo, accounts, link ids
export function newOtherSide(self: TransactionRow, otherAccountId: string, now: string): TransactionRow;
```
Helpers check: other account open and in the plan, ≠ `self.accountId`; payee fields with a transfer (422);
category per `transferCategoryRule` for `self` (not_needed: sent non-null → 422 "A transfer between on-plan
accounts takes no category", otherwise cleared); reconciled other side touched → `TransactionRefused(409,
"transaction_reconciled", "The other side of this transfer is reconciled")`.

**`services/transaction-splits.ts`** (new): `validateLines(db, budgetId, parent, lines, account)` → resolved line
rows (`parentTransactionId`, `splitIndex`, account/date/cleared/approved from the parent) and the payee rows to
create (one per distinct new name); 422 messages: "A split needs at least two lines", "The splits add up to X but
the amount is Y" (`formatMoney`), "A split transaction's category is in its lines", "A tracking account's
transactions cannot be split", "A transfer cannot be split", per line "Category not found in this plan" and the
category-and-flag message.

**`services/transactions.ts`**:
- `transactionDetailToApi(row, lines)` fills the four new fields (`subtransactions` `[]` when none); `logShape`
  adds `transfer_account_id`, `transfer_transaction_id`, `subtransactions`.
- `listAccountTransactions`, `listPlanTransactions`, `getTransaction` attach lines (one `listLines` query per call,
  same filter as the rows).
- `addTransaction`: branch on `transfer_account_id` (pair: two inserts + two log rows) and `subtransactions`
  (parent + lines + payee inserts/logs + one log row); plain path unchanged.
- New `createTransfer(env, actor, budgetId, { from_account_id, to_account_id, amount, date, memo?, category_id?,
  cleared? })` → `{ from_transaction, to_transaction }`: `amount` > 0 (422 otherwise); builds both rows through
  the same `pairInsertBatch` as `addTransaction` (from −amount with `cleared`, default uncleared; to +amount,
  uncleared); `category_id` goes to the on-plan side when exactly one side is on-plan, else 422 when given; both
  details read back.
- `mutate` / `prepare`: refuse a line id (`findDetail` excludes lines → 404). Build the list of statements:
  ```
  G = holdsAt(self) [and holdsAt(each existing other)]
  1 payee inserts + their logs      (guard G)
  2 change_log rows: self, each other side touched   (guard G)
  3 line statements: softDeleteLines, insert lines, or syncLines   (guard G)
  4 other side: update | softDelete | insert         (guard G)
  5 self: update or soft delete, guard holdsAt(self) and, when 4 exists, writtenAt(last other id, now)
  ```
  Success = statement 5 changed a row; otherwise retry (`MAX_ATTEMPTS`). Plain rows with no lines and no other
  side keep today's statements. Deleting a split parent: 3 = softDeleteLines; deleting a transfer: 4 = softDelete
  of the other.
- Credit Starting Balance lock: `subtransactions` or `transfer_account_id` present → 409 `starting_balance_locked`.

## 5. Routes, MCP, coverage

- `routes/transactions.ts`: response and request schemas already flow; update the 422/409 descriptions if needed.
  No new path. `routes/payees.ts`: only if a description changes.
- `mcp/tools/transactions.ts`: `create_transaction` / `update_transaction` / `list_transactions` /
  `get_transaction` descriptions mention `transfer_account_id`, `transfer_transaction_id`, `transfer_account_name`
  and `subtransactions` (one sentence each for the two inputs), `${MONEY} ${DATE}`. New tool:
  ```ts
  { name: "create_transfer",
    description: `Move money between two accounts of a plan: creates the paired transactions in one step. amount is the positive amount moved; from_account_id gets -amount and to_account_id +amount, same date and memo. category_id is only for a transfer between an on-plan and a tracking account and goes to the on-plan side. ${MONEY} ${DATE} Returns { from_transaction, to_transaction }, each with id, account_id, amount, transfer_account_id and transfer_transaction_id.`,
    inputSchema: z.object({ budget_id: Id, from_account_id: Id, to_account_id: Id, amount: Milliunits,
      date: IsoDate, memo: z.string().max(500).optional(), category_id: Id.optional(),
      cleared: PlainClearedStatus.optional() }) }
  ```
- `mcp/tools/payees.ts`: description mentions the `Transfer : <account>` entries and `transfer_account_id`.
- `apps/worker/test/mcp-coverage/transactions.ts`: `"POST /budgets/{budget_id}/transactions": { tool:
  ["create_transaction", "create_transfer"] }`.
- Verify: `mcp-coverage.test.ts`, `mcp-descriptions.test.ts` pass unedited.

## 6. Worker tests

- `apps/worker/test/transfers.test.ts`: create pair (both rows, links, opposite amounts, `uncleared` other side,
  two `create` log rows with actor `user:…`; via MCP `create_transfer` actor `mcp:…`); atomicity (stub
  `crypto.randomUUID` so the second row's id collides with an existing row: the batch fails, neither row nor log
  exists); 422s (same account, closed other account, payee fields, category on on↔on, `transfer:` payee id);
  PATCH mirror (amount, date, memo) and not cleared/approved; account move; re-link; un-transfer; plain → transfer;
  DELETE both; reconciled other side (set via DB) refuses mirror/delete with 409 and writes nothing, allows
  cleared; **month figures per rule case** (on↔on, on→tracking with and without category, tracking→on with RTA,
  tracking↔tracking: compare `GET …/months/{month}` before/after: each category `activity`, `uncategorized`,
  `ready_to_assign`); balances per side; payees list has a transfer entry per open account, none for a closed one,
  `q=transfer` finds them; `listedToolNames()` contains `create_transfer`.
- `apps/worker/test/splits.test.ts`: create (lines, sum check, one log row with lines, new line payee created once);
  422s (one line, unbalanced, parent category, tracking account, with transfer); reads (both lists and single, line
  order); a line id is 404; PATCH replace lines, `[]` back to plain, `amount` alone 422, date/cleared carried to
  lines; DELETE takes lines; month figures (lines count with their categories, uncategorized line counts, parent
  counts nothing); balances count the parent once; category deletion with reassignment moves a line's category
  (call the existing categories route); payee last category skips split parents and lines; MCP
  `create_transaction` with lines = REST.
- Update `transactions.test.ts`, `plan-transactions.test.ts`, `payees.test.ts` only where exact shapes now carry the
  new fields or the transfer entries.

## 7. Web API

- `api/transactions.ts`: nothing new beyond types; `useSaveTransaction` already invalidates every plan query.
- `api/payees.ts`: unchanged URL; the type carries `transfer_account_id`.

## 8. Register UI (`apps/web/src/register/`)

Transfers:
- `entryDraft.ts`: `Draft` gains `transferAccountId: string | null` and `lines: LineDraft[] | null` (`LineDraft = {
  key: number; payee: { id: string | null; name: string }; category: CategoryValue; memo: string; outflowText:
  string; inflowText: string }`). `Open` edit gains `split?: true`. `draftFromTx` fills both from the detail.
  `draftToCreate`: transfer → `transfer_account_id`, no payee fields; split → `subtransactions`. `draftToPatch`:
  transfer change → `transfer_account_id` (null plus payee fields when leaving a transfer); lines changed (deep
  compare) → `subtransactions` (or `[]`), and with them `amount` when it changed. New `lineAmount(l)`,
  `emptyLine()`.
- `PayeeField.tsx`: props `currentAccountId`, `transfers: boolean`; render the "Payments and Transfers" section
  (heading class `entry-heading`, options labelled `transferPayeeLabel`) before "Saved Payees"; picking an entry
  calls `onTransfer(accountId, name)`.
- `CategoryField.tsx`: prop `placeholder` (`"Category not needed"` when disabled by the rule); prop
  `footer: "split" | "none"`; remove the Payment/Transfer button; Split button full width, enabled, `onSplit`,
  disabled with a title on a transfer draft; text `Split (Multiple Categories)...` while the draft is split.
- `EntryRow.tsx`: compute `rule = transferCategoryRule(chosen, transferAccount)`; on `not_needed` force
  `{ kind: "none" }` and disable. Account change onto the transfer account clears the transfer.
- `RegisterTable.tsx`: `useAccounts(budgetId)` always; payee cell for transfers (`transferCellText`, title
  `transferPayeeName`, `TransferIcon` button → `navigate(accountPath(budgetId, id), { state: { select: otherId } })`
  with `stopPropagation`); `categoryCell(tx, account, transferAccount)`; initial `selected` from
  `useLocation().state?.select` and `scrollIntoView({ block: "center" })` once rows load.
- `icons.tsx`: `TransferIcon` (two opposed arrows, 14px), `MinusCircleFilledIcon`, `PlusCircleFilledIcon` (12px).

Splits:
- `SplitLines.tsx` (new): renders the line `<tr>`s and the remaining row inside the entry `<tbody>`; cells carry
  `data-line={i}` and `data-field`; ⊖ `aria-label="Remove split"`; `Add another split` button; remaining numbers
  from `splitRemainingColumns(splitRemaining(draftAmount, lines.map(lineAmount)))` with `formatAmountEntry` (shows
  `0.00` for zero).
- `SplitDialog.tsx` (new): props `{ total, sum, onAutoDistribute, onUpdateTotal, onAdjust }`; portal on
  `document.body`; `role="dialog" aria-modal="true" aria-labelledby`; title `h2` "Something Doesn't Add Up"; body
  `unbalancedText`; buttons in the order Auto-Distribute (primary), Update Total, Adjust Manually; Escape = Adjust;
  focus the first button on open. Styling in `entry.css` from tokens (`--backgroundSecondary`, `--shadowMenu`,
  `--radius-lg`, width 440, title 18/600).
- `EntryRow.tsx` submit with lines: < 2 → message; unbalanced → dialog; Update Total writes the sum into the parent
  amount texts and submits; Auto-Distribute rewrites each line's text in its own column.
- `RegisterTable.tsx`: `s`/`S` handler (document keydown, same guards as Shift+N in `Register.tsx`) for the
  conditions in the design → `onOpen({ mode: "edit", id, focus: "category", split: true })`; saved split rows: the
  chevron (`CaretDownIcon` ▾ / `ChevronRightIcon` ›) and line rows `tr.split-line-row` after the parent; collapsed
  ids in local state; the edited parent's lines are drawn by `EntryRow`, not here.
- `entry.css` / `register.css`: `.split-line` cells, ⊖ and Add another split (`--actionPrimary`, ghost buttons,
  radius 8, 28×32 / 145×32 hit areas), remaining row, chevron button, transfer button.
- Verify: `pnpm check`; then the e2e specs of §9.

## 9. e2e

- `e2e/support/register-seed.ts`: add `seedWorked(request)` returning `{ plan, checking, savings, brokerage, fun,
  groceries, dining, month }` (Seed W of the design), and `planMonth(request, plan, month)`. API only; never the
  database.
- `e2e/transfers.spec.ts`: design cases 1–9 and 17 (transfer parts). Wait for each save with `expect.poll` on the
  API before reading it. Real mouse for dropdown options, ⇆, at 1600×900 and 1024×700.
- `e2e/splits.spec.ts`: cases 10–17 (split parts); 12 asserts no POST/PATCH is sent on Auto-Distribute
  (`page.on("request")`).
- `e2e/register-entry.spec.ts` line ~173: Payment/Transfer is absent, Split is enabled. `e2e/payee-picker.spec.ts`:
  adjust where the list now starts with "Payments and Transfers".
- Run: `pnpm e2e e2e/transfers.spec.ts e2e/splits.spec.ts e2e/register-entry.spec.ts e2e/payee-picker.spec.ts
  e2e/register.spec.ts e2e/all-accounts.spec.ts`.

## 10. Report

Add to the Implementer's report: the batch order as built; any 422/409 text that differs from the design; the
`git diff --stat origin/main` showing no file of Lead notes 11 and 15.
