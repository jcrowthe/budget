# Card payments and register leftovers: implementation spec (EXF-539, EXF-635, EXF-636, EXF-637, EXF-630)

Design, decisions D1–D10 and the acceptance cases are in [card-payments-design.md](card-payments-design.md).
**The source is not opened by the Implementer.**

## Hard limits

- **No migration. No engine change. No dependency.**
- **No edits to:**
  - any shared module: `packages/core/**`, `apps/web/src/shell/**`, `router.tsx`, `api/client.ts`, `app.ts`,
    `mcp/server.ts`, `mcp/types.ts`, `middleware/**`, `history/**`;
  - the out-of-bounds files of the brief's note 8: `apps/web/src/plan/**`, `pages/plan.tsx`, `services/months.ts`,
    `services/month-categories.ts`, `repositories/card-flows.ts`, the plan/credit specs and tests,
    `e2e/support/real-click.ts`;
  - `paths.always_overlap`.
- `services/months.ts` `getPlanMonth` is **imported**, never edited.
- `mcp-timestamps.test.ts` gets exactly one added entry (T4).
- Never edit `openapi.test.ts`, `mcp.test.ts` or `e2e/mcp.spec.ts`.

## T1. Pure helpers: `packages/schema/src/card-payments.ts` (new)

```ts
export const CREDIT_TYPES: readonly string[]            // re-export REGISTER_CREDIT_TYPES from ./register
export const CARD_PAYMENTS_GROUP = "Credit Card Payments";
export const isCredit = (type: string) => boolean;
type Acct = { type: string; on_budget: boolean; name: string };
/** D3: null unless both are on-plan and exactly one is a credit account. */
export function paymentDisplay(side: Acct, other: Acct | null):
  null | { payee: string /* "Payment: <other.name>" */; category: string /* "Credit Card Payments: <card.name>" */; cardIsSide: boolean };
/** D4: "Payment from <other>" when current is credit and other is on-plan non-credit; else "To/From <other>". */
export function transferEntryLabel(current: Acct | null, other: Acct): string;
/** D1/D2: the payment category (kind credit_card_payment, account_id = accountId) of a month read, or null. */
export function paymentCategoryOf(month: Pick<MonthDetail, "groups">, accountId: string):
  null | { id: string; name: string; available: number };
export type PaymentTone = "zero" | "positive" | "negative";
export const paymentTone = (available: number): PaymentTone;   // 0 → zero, > 0 → positive, < 0 → negative
/** D2: the Inflow text for Record Payment: formatAmountEntry(available) when > 0, else "". */
export const paymentPrefill = (available: number | null | undefined): string;
// Zod (from @hono/zod-openapi, .openapi names):
export const CardPaymentRequest  // { from_account_id: string.min(1), amount?: Milliunits.positive(), date?: IsoDate, memo?: string.max(500).nullable() }
export const CardPaymentResult   // { amount: Milliunits, from_transaction: TransactionDetail, to_transaction: TransactionDetail }
export const CardPaymentResponse = dataEnvelope(CardPaymentResult);
export const OWN_PAYMENT_TEXT = (card: string) =>
  `A transaction on ${card} can't use its own payment category. Choose a spending category, or use Record Payment to pay ${card} from a cash account.`;
export const PAYMENT_SOURCE_TEXT = "Pay a card from an on-plan cash account (checking, savings or cash)";
export const NOTHING_TO_PAY_TEXT = (card: string) =>
  `${card}'s payment category has nothing available to pay; send an amount`;
```

**Test:** `packages/schema/test/card-payments.test.ts`:
- every branch of `paymentDisplay`: cash↔card both sides, card↔card null, card↔tracking null, cash↔cash null;
- `transferEntryLabel`;
- `paymentTone` at −1, 0 and 1;
- `paymentPrefill(335000) === "335.00"`, and `""` for 0, −1 and undefined;
- `paymentCategoryOf` on a fixture month.

## T2. Own payment category (D5)

- **`apps/worker/src/repositories/transactions.ts` `categoryNamesMany`:** also select `kind` and `accountId`. The
  value type becomes `{ categoryName; groupName; kind: string | null; accountId: string | null }`. It stays one query.
- **`services/transactions.ts`:**
  - Add `export function refuseOwnPaymentCategory(account: AccountRow, category: { kind: string | null; accountId: string | null } | undefined)`.
    It throws `new TransactionRefused(422, "own_payment_category", OWN_PAYMENT_TEXT(account.name))` when
    `category?.kind === "credit_card_payment" && category.accountId === account.id`.
  - In `validate`: fetch the category once, from `known.get(id)` or `categoriesRepo.findActive`, keep the
    not-found refusal, then call the helper. `Reads.categories` takes the new value type.
- **`services/transaction-splits.ts` `validateLines`:** use the row from `findActive` per line and call the helper.
- **`repositories/scheduled-transactions.ts` `categoryNames`:** also select `kind` and `accountId`.
- **`services/scheduled-transactions.ts` `checkRules`:** call the helper with the schedule's account.

**Verify:** `apps/worker/test/own-payment-category.test.ts` covers design case 4, through REST, bulk and MCP. It also
checks that a row with the code writes no `change_log` row. Write it first and run it once against the unchanged
code: the POST answers 201. Quote that line in the report.

## T3. Payments operation (D6)

**`apps/worker/src/services/card-payments.ts` (new)**

```ts
export class PaymentRefused extends TransactionRefused {}   // or reuse TransactionRefused directly
export async function payCreditCard(env: Env, actor: string, budgetId: string, cardId: string,
  input: z.input<typeof CardPaymentRequest>): Promise<CardPaymentResult>
```

Steps, in order:
1. Parse the input.
2. Check the plan: `budgetsRepo.findActive`, else `NotFound("Plan")`.
3. Read the accounts once: `accountsRepo.list(db, budgetId, { includeClosed: true })`, as a map.
4. Check the card:
   - missing → `NotFound("Account")`;
   - not credit → 422 `not_a_credit_account` "<name> is not a credit card or line of credit";
   - closed → 422 `account_closed` `CLOSED_OTHER`.
5. Check the source:
   - missing → 422 `invalid_payment_source` (the same text for every source refusal);
   - `id === cardId`, not on budget, or a credit type → 422 `invalid_payment_source`;
   - closed → 422 `account_closed` `CLOSED_NO_NEW`.
6. Set `date = input.date ?? todayUtc()`.
7. When `amount` is undefined:
   `const m = await getPlanMonth(env, budgetId, `${date.slice(0, 7)}-01` as Month, date)`, then
   `paymentCategoryOf(m, cardId)`. When that is null or `available <= 0` → 422 `nothing_to_pay`. Otherwise
   `amount = available`.
8. Call `const r = await createTransfer(env, actor, budgetId, { from_account_id, to_account_id: cardId, amount, date, memo })`
   and return `{ amount, from_transaction: r.from_transaction, to_transaction: r.to_transaction }`.

**`apps/worker/src/routes/card-payments.ts` (new)**
- `export default` an `OpenAPIHono<AppEnv>` with the same `defaultHook` as `routes/accounts.ts`.
- `POST /budgets/{budget_id}/accounts/{account_id}/payments`, tag `Accounts`.
- Body `CardPaymentRequest`. Answers 201 `CardPaymentResponse`, with 404 and 422 `ErrorBody`.
- Catch `TransactionRefused`, then `apiError(c, e.status, e.code, e.message)`, as `routes/transactions.ts`
  `refusals` does.
- The actor comes from `c.get("identity").actor`.

**`apps/worker/src/mcp/tools/card-payments.ts` (new)**
- `export const tools: McpToolDef[]` with `pay_credit_card`.
- Input: `{ budget_id: Id, card_account_id: Id, from_account_id: Id, amount: Milliunits.positive().optional(), date: IsoDate.optional(), memo: z.string().max(500).optional() }`.
- The description says:
  - it pays a credit card or line of credit from an on-plan cash account, as a transfer pair (cash −amount,
    card +amount);
  - the default amount is the card's payment category Available in the date's month, and a tool error
    (`nothing_to_pay`) when that is ≤ 0;
  - paying from another card or a tracking account is a tool error (`invalid_payment_source`);
  - `${MONEY} ${DATE}`, and the default date is today (UTC);
  - `Returns { amount, from_transaction, to_transaction }`, each as get_transaction returns it;
  - `${dates("date")} ${timestamps(["updated_at", "created_at"])}`.

**Coverage:** in `apps/worker/test/mcp-coverage/accounts.ts`, add
`"POST /budgets/{budget_id}/accounts/{account_id}/payments": { tool: "pay_credit_card" }`.

## T4. Worker tests for payments

**`apps/worker/test/card-payments.test.ts` (new):** design cases 1–3, everything through REST except the MCP lines.
- Seed with `bulk-helpers` `plan()` and `account(bid, "creditCard", 0)`.
- Assign through `PATCH …/months/2026-11-01/categories/{id}` (read the existing route for its body).
- Read figures from `GET …/months/2026-11-01` (`paymentCategoryOf`) and `GET …/accounts/{id}`.
- Also check:
  - `expect(await apiPaths()).toEqual(expect.arrayContaining(["/budgets/{budget_id}/accounts/{account_id}/payments"]))`;
  - the same check with `listedToolNames()` and `pay_credit_card`;
  - the MCP result's `from_transaction.created_at` is ISO.

**`apps/worker/test/mcp-timestamps.test.ts`:** one entry:
`const NOT_CALLED: Record<string, string> = { pay_credit_card: "the seed has no credit card" };`
At a rebase, keep the other Build's entry too.

## T5. EXF-630: transactions service

In `services/transactions.ts`:
- `linksOf`: `const lines = linesByParent(await txRepo.listLines(db, budgetId, { parentIds: rows.map((r) => r.id) }))`.
- `detailsOf`: `const lines = linesByParent(await txRepo.listLines(db, budgetId, { parentIds: ids }))`. Do not call
  `linksOf` there.

Change nothing else. **Verify:** every existing Worker test passes unchanged.

## T6. Counting tests: `apps/worker/test/bulk-call-count.test.ts` and `bulk-helpers.ts`

1. **`bulk-helpers.ts`:** change to `category(bid: string, suffix = "Groceries")`, matching `c.name.endsWith(suffix)`.
   Existing callers are unchanged.
2. **`World`:** gains `cat2 = await category(b, "Transportation")`. The `categorize` op uses `value: w.cat2`.
3. **Approve:** after the loop, add
   `expect(counts.approve?.[0], "EXF-630: approve read the transfer other sides it never used (8 calls)").toBe(7)`.
   Run it once on the code before T5 and quote the failing line, which reads 8.
4. **New `it`, "moving rows from several accounts":**
   - `small`: 10 plain categorized rows in one account.
   - `large`: 100 rows round-robin over three accounts. At least 10 are splits, and at least 10 are transfers to a
     fourth account.
   - Move each to a fresh `target`.
   - Assert equal counts, ≤ `LIMIT`, and every row's `account_id === target` (`get`).
5. **New `it`, "paying a card":**
   - Plan A: 1 card and 10 rows. Plan B: 4 cards and 100 rows.
   - Count `payCreditCard` with `amount: 1000`, then without amount (fund the payment first).
   - Assert equal counts per mode across the plans, each ≤ `LIMIT`.
   - Print the two figures in the assertion message (expected about 9 and 17).

## T7. EXF-637: refusal text

- **`services/transactions-bulk.ts`:** the tracking refusal texts (D10):
  - `${target.name} is a tracking account, so its transactions can't have a category. Remove the category first.`
  - for `lines.length > 0`: `${target.name} is a tracking account, so its transactions can't be split. Make it a plain transaction first.`
- **`apps/worker/test/transactions-bulk-rules.test.ts:85`:** expect the new text. List this as a departure.
- **`packages/schema/src/register-selection.ts`:**

  ```ts
  export function bulkRefusalText(detail: string, labelOf: (id: string) => string | null): string
  // /^Transaction ([0-9a-f-]{36}): (.*)$/is → `${labelOf(id) ?? "1 of the selected transactions"}: ${cap(rest)}`; else detail.
  ```

- **`ActionBar.guard` and `sendDelete`:** set the error to
  `e instanceof ApiError ? bulkRefusalText(e.detail, labelOf) : …`.
  - `labelOf(id)` finds the row in `rows`.
  - The payee text is `paymentDisplay(...)?.payee ?? (r.transfer_account_name ? transferCellText(r.transfer_account_name) : r.payee_name)`.
  - The label is `${payee} on ${registerDate(r.date)} (${formatMoney(r.amount)})`, or
    `The transaction on … (…)` when there is no payee.

**Test:** `register-selection.test.ts` covers the prefix with a known id, an unknown id, and no prefix.

## T8. EXF-635: ranges (D8)

- **`register-selection.ts`:**
  `export function rangeIds(order: readonly string[], from: string, to: string): string[] | null`. It returns the
  inclusive slice in `order`'s order, and null when either id is absent.
- **`register/selection.tsx`:** add to the context:

  ```ts
  anchor: { list: "real" | "scheduled"; id: string } | null;
  pick(list, id, how: "toggle" | "only" | "rangeAdd" | "rangeOnly"): void; // records the anchor for toggle/only; resets the cursor
  extend(step: 1 | -1): void;   // cursor-based, replaces the selection with anchor…cursor of the anchor's list
  ```

  - The range kinds read `rows` or `scheduledRows` (ids in order) and fall back to `toggle` or `only` when
    `rangeIds` is null or the anchor's list differs.
  - `toggle`, `set` and the existing scheduled setters keep their current meaning.
  - `clear` resets the anchor.
- **`Box.tsx`:** `onClick: (e: React.MouseEvent<HTMLButtonElement>) => void`. Add
  `onMouseDown={(e) => e.shiftKey && e.preventDefault()}`.
- **`RegisterTable.tsx`:**
  - Checkbox: `e.shiftKey ? pick("real", id, "rangeAdd") : pick("real", id, "toggle")`.
  - `onRowClick`: with `e.shiftKey`, call `pick("real", id, "rangeOnly")` and close an open entry, before the
    existing branches.
  - The plain row paths call `pick(…, "only")` where they call `setSelected([id])`.
  - Rows get the same shift `onMouseDown`.
- **`ScheduledSection.tsx`:** the same for `"scheduled"`.
- **`ActionBar.tsx`:** `useShortcut("select-multiple", (e) => extend(e.key === "ArrowDown" ? 1 : -1), hasSelection && !entryOpen)`.
  After extending, scroll the cursor row into view (`tr[data-tx=…]` or the scheduled row's selector).
  `apps/web/src/shortcuts/**` is not edited.

**Tests:** unit tests for `rangeIds`, and `e2e/register-range.spec.ts` (design cases 12–15).

## T9. EXF-636: Move on All Accounts (D9)

- **`register-selection.ts` `barActions`:** `move: true` (keep the parameter for the call sites). Update the unit
  test.
- **`ActionBar.tsx` `moveTo`:**
  - With `account`: `openAccounts` minus it, as today.
  - Without: `const only = new Set(sel.map(r => r.account_id)); openAccounts.filter(a => !(only.size === 1 && only.has(a.id)))`.
- **`e2e/register-bulk.spec.ts` ≈422–423:** assert Move to Account **is** present on All Accounts. List this as a
  departure. Design case 16 goes in `e2e/register-range.spec.ts`, or in a new `test` in `register-bulk.spec.ts`.

## T10. Payment display and picker (D3, D4)

- **`RegisterTable.tsx` `dataRow`:**
  - `const pay = transferAccount ? paymentDisplay(sideAcct, transferAccount) : null`, where `sideAcct` is
    `account ?? byId.get(tx.account_id)`.
  - When `pay` is set: the payee cell's `.transfer-name` shows `pay.payee` (title too), and the category cell shows
    `pay.category` as text (`title` too) instead of "Category not needed".
- **`packages/schema/src/payees.ts` `payeeMenu`:** opts gains `transferLabel?: (p: Payee) => string`, used in the
  needle match. The default keeps today's `To/From` match. Test it in `payees.test.ts`.
- **`PayeeField.tsx`:**
  - New prop `transferLabel?: (p: Payee) => string`. The default is today's `transferPayeeLabel(accountOfTransfer(p))`.
  - It is used to render and passed to `payeeMenu`.
  - `onTransfer(accountId, label)` passes the label.
- **`EntryRow.tsx`:**
  - `const pay = chosen && transferAccount ? paymentDisplay(chosen, transferAccount) : null`.
  - `transferLabel = (p) => transferEntryLabel(chosen ?? null, accountOf(p.transfer_account_id))`.
  - On pick, store `payee.name = label` only when it starts with `Payment from`; otherwise keep `p.name`, as today.
  - When editing a payment row on its card side, the payee text starts as `Payment from <other>`.
  - `CategoryField` gets `fixedText={pay?.category}`.
- **`CategoryField.tsx`:** new prop `fixedText?: string`. When set, the input is disabled, shows that text and opens
  no list.

## T11. Header pill (D1)

- **`apps/web/src/account/usePaymentAvailable.ts`:**
  `usePaymentAvailable(budgetId, accountId, enabled): { available: number | null | undefined; name: string | null; settled: boolean }`:
  - Call `useQuery({ queryKey: ["month", budgetId, month], queryFn: () => getMonth(budgetId, month), enabled })`,
    with `month = `${localToday().slice(0, 7)}-01``. This is the same key and function as `useMonth`, so the cache
    is shared. `api/months.ts` is not edited.
  - `available` is `undefined` while loading and `null` when there is no category.
- **`PaymentBalance.tsx`:**

  ```html
  <div class="acct-balance acct-payment" data-balance="payment">
    <span class="acct-payment-pill is-<tone>">…</span>
    <span class="acct-label"><HelpIcon/> Payment</span>
  </div>
  ```

  - The tooltip uses the existing `Tooltip`.
  - The pill is empty while loading (keep `min-height`).
- **`AccountHeader.tsx`:** for credit accounts, render `<PaymentBalance>` after `<SelectedTotal/>` inside
  `BalanceRow`'s children.
- **`account-header.css`:**

  ```css
  --account-payment-zero-bg: var(--inputBackground);  --account-payment-zero-label: #9b9caa;
  --account-payment-positive-bg: var(--statusPositive); --account-payment-positive-label: #0c0d22;
  --account-payment-negative-bg: var(--statusNegative); --account-payment-negative-label: #fff;
  ```

  The pill is `padding: 4px 7px 2px; border-radius: 1000px; 14px/500; line-height 16px; white-space: nowrap`.
  `.acct-payment` gets `margin-left: var(--space-4)`, and `.acct-selected-total + .acct-payment` the source's
  1rem gap.

## T12. Record Payment (D2, D7)

- **`RegisterToolbar.tsx`:** props gain `onRecordPayment?: () => void` and `paymentDisabled?: boolean`. When
  `onRecordPayment` is set, render
  `<button class="toolbar-button" title="Record a payment to this card">` with `CardIcon` from `account/icons`
  (or a register icon) and the text "Record Payment", after File Import.
  - Wrap the labels of File Import, Undo, Redo and Record Payment in `<span className="toolbar-label">`.
  - CSS (`register.css`): `.search-box input { width: clamp(120px, 20cqw, 192px) }` with
    `container: register-toolbar / inline-size` on `.register-toolbar`. Add
    `@container register-toolbar (max-width: <measured>px) { .toolbar-label.can-hide { visually hidden } }` for
    File Import, Undo and Redo only.
  - Pick the threshold from the 1024×700 measurement, so that nothing hides at 1440. Each hiding button gets
    `aria-label` equal to its text.
- **`Register.tsx`:**
  - `const credit = account && isCredit(account.type)`.
  - `const pay = usePaymentAvailable(budgetId, account?.id ?? "", !!credit)`.
  - `openPayment = () => setOpen({ mode: "add", key, payment: { inflow: pay.available ?? null } })`.
  - Pass `onRecordPayment={credit ? openPayment : undefined}` and `paymentDisabled={account.closed || !pay.settled}`.
  - `?record-payment`: `useSearchParams()`. When the parameter is present and `account` is loaded:
    - if credit, open and `!closed` and `pay.settled`, call `openPayment()`;
    - then (for a non-credit or closed account, immediately) delete the parameter with
      `setSearchParams(next, { replace: true })`;
    - run once per key.
- **`entryDraft.ts` `Open`:** add `payment?: { inflow: number | null }` on `mode: "add"`.
- **`RegisterTable.tsx`:** pass `prefillInflow={paymentPrefill(open.payment?.inflow)}` and
  `initialFocus={open.payment ? "payee" : …}`.
- **`EntryRow.tsx`:** `emptyDraft(...)` then `inflowText = prefillInflow ?? ""`.

## T13. Browser specs

- **`e2e/support/card-seed.ts`:** `seedCard(request, opts?)` makes the plan (`testName`), Checking, Savings, a
  tracking account, Visa (creditCard 0), an optional LOC and a second card, assigns Groceries 335000, and adds a
  Visa Groceries −335000 row dated 2026-11-10. It returns the ids.
- **`e2e/card-payments.spec.ts`:** design cases 5–11 and 21 (card header and toolbar). Settings:
  `page.clock.setFixedTime(new Date("2026-11-16T12:00:00"))`, exact names, `realClick`, and `expect.poll` on the
  API after each save.
- **`e2e/register-range.spec.ts`:** design cases 12–16, including the 1024×700 runs and the Move submenu's
  viewport check.
- **`e2e/register-bulk.spec.ts`:** T7 and T9 edits only.

## T14. Docs

- Add one line for the design to `docs/README.md`. `docs/card-payments-polish.md` is the Designer's.
- Build notes go at the end of the design doc: measured call counts, the toolbar threshold, and departures.

## Verification

- `pnpm check`.
- `pnpm e2e e2e/card-payments.spec.ts e2e/register-range.spec.ts e2e/register-bulk.spec.ts e2e/scheduled-transactions.spec.ts e2e/register.spec.ts e2e/register-entry.spec.ts e2e/all-accounts.spec.ts e2e/transfers.spec.ts e2e/payee-picker.spec.ts`.
- Report:
  - the call figures from T6;
  - the T2 and T6 "failing first" lines;
  - `git diff --name-only origin/main` against the manifest and the out-of-bounds list.
