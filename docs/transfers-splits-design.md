# Transfers and splits design (EXF-526, EXF-524)

Transfers between two accounts of a plan (a linked pair of rows) and split transactions (a parent with lines), in
the register and through REST and MCP. One Build, one pull request. Spec: [transfers-splits-spec.md](transfers-splits-spec.md).
The Lead's scope notes override the tickets where they differ. Transfers are built first, then splits.

## Source

Studied live, only in the test plan's **All Accounts** register; notes and 18 cropped captures in
`/workspace/scratch/source/transfers-splits/` (`notes.md`, `captures.txt`). Seen:

- Rows 36px, Figtree 14/500; selected and edit rows share `--register-row-selected`; tracking rows in All Accounts
  show "Category not needed" in `--labelSecondary`.
- Payee dropdown (04–07): "Saved Payees" heading, "Manage Payees" footer. **No "Payments and Transfers" section: all
  test-plan accounts are closed**, and typing "transfer" or an account name offers only `Create "<text>" Payee`, so
  closed accounts are never transfer payees.
- Category dropdown (09): footer = **one** full-width "Split (Multiple Categories)" button (secondary, 32px, radius
  8, bg `rgba(117,131,255,.2)`); **no "Payment/Transfer" button**.
- Split editor (10–16): parent category `Split (Multiple Categories)...`; two empty 36px lines, blank up to the
  account column, a ⊖ (12px filled circle-minus, `--actionPrimary`) right-aligned in DATE, then inputs `payee`,
  `category`, `memo`, `outflow`, `inflow`; a last row with `⊕ Add another split` from the DATE column,
  `Amount remaining to assign:` right-aligned in MEMO and plain numbers (no `$`) under OUTFLOW and INFLOW.
  100 / 60+25 → `15.00 | 0.00`; 100 / 60+50 → `0.00 | 10.00` (never negative); 100 / 60+40 → `0.00 | 0.00`. "Add
  another split" focuses the new line's payee with its list open. Escape cancels the whole edit.
- Not visible: transfer entries, saved transfer rows (⇆), saved splits (chevron), the "Something Doesn't Add Up"
  dialog. The tickets are the specification there.

## Approach

### Data: one migration, four columns on `transactions`

`apps/worker/migrations/20261116100500_transfers_splits.sql` (Lead note 3), additive:
`transfer_account_id TEXT`, `transfer_transaction_id TEXT`, `parent_transaction_id TEXT`, `split_index INTEGER`,
indexes `transactions_transfer (transfer_transaction_id)` and `transactions_parent (parent_transaction_id)`.

- **A transfer is two ordinary rows**, one per account, each with `transfer_account_id` = the other account and
  `transfer_transaction_id` = the other row. `payee_id` is null on both; `payee_name` is written as
  `Transfer : <other account name>` (kept for a rollback) but **reads derive it from the other account's current
  name**, so a rename shows everywhere.
- **A split line is a row of `transactions`** with `parent_transaction_id` = the parent and `split_index` 0..n-1. A
  line has its own `amount`, `payee_id`/`payee_name` (null = the parent's payee), `category_id`,
  `inflow_to_ready_to_assign`, `memo`; its `account_id`, `date`, `cleared`, `approved` copy the parent's and every
  parent write keeps them in step. A parent is a row with at least one live line; its `category_id` is null and its
  flag false.
- **Why lines live in `transactions`**: the category files (another Build's) count a category's history and move
  a deleted category's rows by `category_id` on `transactions` (`repositories/categories.ts`,
  `category-reassign.ts`); lines there are counted and moved with no change, a separate table would strand them.
  Cost: the readers in `repositories/transactions.ts` that list or sum exclude lines (`parent_transaction_id is
  null`); no other Worker reader sums rows (`month-range` reads only the first month).
- `TransactionRow` makes the four new fields optional, and `insertIfStmt` writes `?? null` for them, so
  `services/accounts.ts` (Starting Balance insert) compiles unchanged.

### The category rule (one pure function)

`packages/schema/src/transfers.ts`: `transferCategoryRule(side, other)` where `side` and `other` are
`{ on_budget: boolean }` (`other` null for a plain row). Returns `"category" | "not_needed" | "none"`.

| this side | other side | rule | category allowed | month figures |
|---|---|---|---|---|
| on-plan | (plain row) | category | category or Ready to Assign, optional | category / RTA / uncategorized (as today) |
| tracking | (plain row) | none | no (422) | ignored (engine `onBudget` false) |
| on-plan | on-plan (cash or credit) | not_needed | **no: 422 when sent** | **nothing**: no activity, not uncategorized, RTA unchanged |
| on-plan | tracking | category | category or RTA, optional; without: "This needs a category" | category / RTA / uncategorized |
| tracking | on-plan | none | no (422) | ignored |
| tracking | tracking | none | no (422) | ignored |

The month figures come out right through `activityByMonth` only (no change to `services/months.ts` or
`packages/core`): it drops rows with `transfer_account_id` set when both its own account and the transfer account
are on-plan (join `accounts` as `ta`), and drops split parents (`not exists` a live line); lines pass through as
ordinary rows with their own category, the parent's account and date. The tracking side is already ignored by the
engine. Shown by `apps/worker/test/transfers.test.ts` ("month figures per rule case": one transfer per row of the
table, `GET …/months/{month}` before and after, compare every category's `activity`, `uncategorized` and
`ready_to_assign`) and `splits.test.ts` ("lines count, the parent does not").

### Balances

`balancesByAccount` and `openAccountsBalances` exclude lines, so a split counts once with the parent's amount;
each transfer side counts in its own account. The web invalidates every query keyed by the plan after a save
(`useSaveTransaction`, unchanged), so the header balances, the sidebar and All Accounts follow without a reload.

### REST

Requests gain `transfer_account_id` (string | null) and `subtransactions` (array of `{ amount, payee_id?,
payee_name?, category_id?, inflow_to_ready_to_assign?, memo? }`, max 50). `TransactionDetail` (both lists and the
single read) gains `transfer_account_id`, `transfer_transaction_id`, `transfer_account_name` and `subtransactions`
(`id`, `amount`, `payee_id`, `payee_name`, `category_id`, `category_name`, `category_group_name`,
`inflow_to_ready_to_assign`, `memo`, by `split_index`; `[]` for a plain row). Lines are never list rows; a line id
is 404 on GET, PATCH, DELETE.

- **POST transfer**: other account open, in the plan, not the same (422); no payee fields (422); category per the
  posted side's rule. One batch: both rows (other side opposite amount, same date and memo, `uncleared`,
  `approved`), one `change_log` `create` row per side. Returns the posted side.
- **POST split**: ≥ 2 lines; signed sum = `amount` (422 "The splits add up to -$85.00 but the amount is
  -$100.00"); no category/flag on the parent; not on a tracking account; not with a transfer (all 422). Lines take
  payees like the parent (a new payee once per distinct name, in the batch) and a category or the flag. One batch;
  **one** `change_log` row for the parent, its `after` holding `subtransactions`.
- **PATCH transfer** (either side): `amount` (negated), `date`, `memo` mirrored; `cleared`, `approved`, category
  per side (rule checked). `account_id` moves this side (not onto the other account) and the other side's
  `transfer_account_id` follows; a category that becomes not needed is cleared (sent → 422).
  `transfer_account_id: <id>` turns a plain row into a transfer (payee cleared, other side created) or re-links (old
  other side deleted, new one created, its cleared state starting over); `transfer_account_id: null` makes it plain
  (other side deleted; payee from the same request, else none). Payee fields on a transfer without
  `transfer_account_id: null` → 422. All supported: each is one guarded batch over at most three rows.
- **PATCH split**: `subtransactions: [...]` (≥ 2) replaces every line; `[]` makes it plain (category from the
  request, else none); `amount` alone, or a category/flag without `[]` → 422; `date`, `account_id`, `cleared`,
  `approved` carry to the lines; to a tracking account → 422; a credit Starting Balance → 409
  `starting_balance_locked`. A split never becomes a transfer nor the reverse (422).
- **DELETE**: either transfer side deletes both (a `delete` log row each); a split parent takes its lines.
- **Reconciled**: as today 409 `transaction_reconciled`. Anything that would write a reconciled other side
  (mirror, re-link, un-transfer, delete) refuses the pair with 409 `transaction_reconciled` "The other side of this
  transfer is reconciled"; cleared, approved and category on the open side still work.
- **Atomicity**: each case one `db.batch`, guarded (spec §4): the patched row's own write comes last and only
  succeeds when the other side's write did; otherwise the service retries as today.

**Payees**: `GET …/payees` and `list_payees` add, per open non-deleted account (`accountsRepo.list(…,
{ includeClosed: false })`, an import, no edit), `{ id: "transfer:<account_id>", name: "Transfer : <name>",
hidden: false, system: null, last_category_id: null, transfer_account_id }`; ordinary payees carry
`transfer_account_id: null`. `q` matches their name. A `transfer:` id as `payee_id` → 422 "Use transfer_account_id
for a transfer". **Last-used category** (note 8): the payee's latest row that is neither a line nor a split parent;
lines never feed it (their payee is optional and their category is one part of a purchase).

### MCP

- `create_transaction`, `update_transaction`: take `transfer_account_id` and `subtransactions` from the schemas
  (one `.describe()` sentence each); descriptions mention both and the new read fields.
- New `create_transfer(budget_id, from_account_id, to_account_id, amount, date, memo?, category_id?, cleared?)`:
  `amount` is the positive milliunits moved; `from` gets −amount, `to` +amount; `category_id` goes to the on-plan
  side when exactly one side is on-plan (else 422 if given); `cleared` applies to `from`. Returns
  `{ from_transaction, to_transaction }`.
- `list_transactions`, `get_transaction`: descriptions list `transfer_account_id`, `transfer_transaction_id`,
  `transfer_account_name`, `subtransactions`. `list_payees`: mentions the transfer entries.
- Coverage (`apps/worker/test/mcp-coverage/transactions.ts`):
  `"POST /budgets/{budget_id}/transactions": { tool: ["create_transaction", "create_transfer"] }`.

### Web: transfers (EXF-526)

- **Payee field**: `payeeMenu(payees, text, { currentAccountId, transfers })` lists transfer entries first under
  **"Payments and Transfers"**, labelled `To/From <account>`, all but the current account's (All Accounts: the row's
  chosen account, or all); filter: substring of `Transfer : <name>` or `To/From <name>`, case-insensitive. Then
  "Saved Payees" as today. Highlight with text: first saved match, else first transfer match, else the top item.
  Hidden for split lines and for a draft that is a split.
- Picking one sets `draft.transferAccountId` and the text `Transfer : <name>` (typing clears it). Category per
  `transferCategoryRule`: `not_needed` → emptied, disabled, placeholder **"Category not needed"**.
- **Saved row**: payee `Transfer: <name>`, `title="Transfer : <name>"`, then a ⇆ button (`TransferIcon`, title and
  aria-label "Click to jump to the other side of this transfer"). `categoryCell` gives grey "Category not needed"
  for on↔on, the amber "This needs a category" for an uncategorized on-plan side of on↔tracking.
- **⇆** navigates to `accountPath(budgetId, transfer_account_id)` with router state `{ select:
  transfer_transaction_id }`; that register starts with the row ticked and scrolled into view. `useAccounts(budgetId)`
  is loaded on account pages too, for the rule.
- **Footer**: "Payment/Transfer" is **removed** (absent in the source, capture 09; transfers start from the payee).
  "Split (Multiple Categories)" is enabled and full width.

### Web: splits (EXF-524)

- **Start**: the footer's Split, or `s`/`S` (no modifier, not typing, no modal) with one saved row selected and
  nothing open, on-plan, not reconciled, not a transfer, not a credit Starting Balance. Category cleared, two empty
  lines, focus in line 1's payee. `S` on a saved split opens it. Split is disabled (title "A transfer cannot be
  split") on a transfer draft. No "Keyboard Tip" toast (note 9).
- **Editor** (`SplitLines.tsx`): parent category `Split (Multiple Categories)...` (picking a category drops the
  lines); per line: blank cells, ⊖ (aria-label "Remove split") in DATE, payee (no transfers), category (no footer),
  memo, outflow, inflow; then `⊕ Add another split` (adds a line, focuses its payee), `Amount remaining to assign:`
  in MEMO, remaining outflow and inflow in their columns. Removing the last line leaves split mode.
- **Save**: < 2 lines → "A split needs at least two lines."; not adding up → dialog; else POST/PATCH with
  `subtransactions`.
- **Dialog** (`SplitDialog.tsx`, portal, `role="dialog"`, `aria-modal="true"`): **"Something Doesn't Add Up"**;
  **"The total is -$100.00, but the splits add up to -$85.00. How would you like to handle the unassigned
  -$15.00?"**; **Auto-Distribute** (rewrites lines, closes, no save), **Update Total** (total := lines' sum, closes
  and saves: nothing else was missing), **Adjust Manually** (closes; Escape too).
- **Saved split**: category cell = chevron button (▾/›, aria-label "Collapse split"/"Expand split",
  `aria-expanded`) + `Split (Multiple Categories)...`; under it one row per line: empty date, payee only if set,
  category (or the amber "This needs a category" as text), memo, amount; no checkbox or cleared icon. Expanded by
  default; collapse is local state; a click on a line acts on its parent; lines stay under their parent in any sort.

### Pure modules (with unit tests)

`packages/schema/src/transfers.ts` (the rule, payee labels) and `packages/schema/src/split.ts` (sum, remaining,
remaining columns, `autoDistribute`: each line `line × total / sum` rounded to cents, remainder on the last line, 60
and 25 of −100 → −70.59 and −29.41; the dialog text). Signatures in the spec.

### Look

Tokens only: ⊖, `Add another split`, ⇆ in `--actionPrimary`; editing lines on `--register-entry-row`. New icons in
`register/icons.tsx`: `MinusCircleFilledIcon`, `PlusCircleFilledIcon`, `TransferIcon`. No new custom property.

## Downstream effects

- Any future reader that sums or lists `transactions` must exclude lines (`parent_transaction_id is null`) and, for
  category spending, drop split parents and on↔on transfers as `activityByMonth` does. **The Reflect/reports Build
  must know this** (named in the docs index line).
- Category reassignment moves lines with no change (they are `transactions` rows) and writes a `change_log` row per
  line moved.
- EXF-532/539 decide what a transfer to a credit card does to its payment category; today it is on↔on (`not_needed`).

## Out of scope

Undo of a deleted transfer (EXF-530); the action bar and its Categorize (EXF-520); credit card payment categories
(EXF-532, EXF-539); the multi-delete dialog; search over lines (EXF-528); a line that is a transfer; scheduled
splits and transfers (EXF-501); the "Keyboard Tip" toast.

## Acceptance

Clone on the e2e server, dark theme, 1600×900 unless stated. **Seed W** (API, `e2e/support/register-seed.ts`): a
ZZ-TEST plan; "ZZ Checking" $530.00, "ZZ Savings" $200.00, "ZZ Brokerage" (otherAsset) $1,000.00 (Starting Balances,
cleared); group "D4 Fun Group" with "D4 Fun", "D4 Groceries", "D4 Dining"; on Checking two uncleared outflows today:
$15.00 D4 Fun, $105.00 D4 Groceries. Checking: Uncleared −$120.00, Working $410.00; D4 Fun Activity −$15.00.

1. (526-1, 526-10) Checking, add row, payee empty: "Payments and Transfers" lists `To/From ZZ Brokerage`, `To/From
   ZZ Savings` (not Checking) above "Saved Payees"; `transfer` → only those two, first highlighted; `sav` → `To/From
   ZZ Savings`; never "Starting Balance". Pick Savings: category disabled, placeholder "Category not needed". Outflow
   50, Save: API −50000 in Checking, +50000 in Savings, linked both ways; both rows grey "Category not needed".
2. (526-8) Checking Uncleared −$170.00, Working $360.00; Savings Uncleared +$50.00, Working $250.00; sidebar
   matches; no reload.
3. (526-9) `GET …/months/{month}` before and after 1: every `activity`, `uncategorized`, `ready_to_assign` equal.
4. (526-2, 526-8) On Savings set the transfer's inflow 60 and the day before, Save, click its cleared icon: Savings
   Cleared $260.00; Checking shows 60.00 on the new date, uncleared, Working $350.00.
5. (526-3) On Checking click ⇆ (real mouse): Savings' page, the paired row ticked and visible; payee `Transfer: ZZ
   Checking`, title `Transfer : ZZ Checking`; ⇆ title "Click to jump to the other side of this transfer".
6. (526-4) DELETE one side via the API: both rows gone everywhere; balances as before 1.
7. (526-5, 526-8) Transfer $100.00 Checking → `To/From ZZ Brokerage`, no category: Checking row amber "This needs
   a category"; in All Accounts the Brokerage row "Category not needed". Give it D4 Fun: Activity −$115.00 on the
   Plan; Checking Working $250.00; Brokerage Cleared $1,000.00, Uncleared $100.00, Working $1,100.00.
8. (526-6) The Brokerage register has no CATEGORY header.
9. (526-7) REST POST with `transfer_account_id` and MCP `create_transfer` create both rows with one `create` log row
   per side and the caller's actor; a failing second insert leaves neither. On↔on with `category_id` → 422. PATCH
   mirrors amount/date/memo, not cleared; re-link, un-transfer and a reconciled other side as in the Approach.
10. (524-1, compare) Checking, open a saved row, category → Split: parent `Split (Multiple Categories)...`, two
    empty lines (⊖ in DATE, placeholders), `⊕ Add another split`, `Amount remaining to assign:` with the parent's
    outflow under OUTFLOW and `0.00` under INFLOW. **Source**: test plan, All Accounts, dark theme, its viewport;
    double-click an existing row, category → Split; Escape.
11. (524-1, compare) Parent 100, lines 60 + 25 → `15.00 | 0.00`; 60 + 50 → `0.00 | 10.00`; 60 + 40 → `0.00 |
    0.00`. **Source**: as 10, typing those; Escape.
12. (524-2, 524-3) 100 with 60/25, Save: dialog title and `-$100.00`, `-$85.00`, `-$15.00`. Auto-Distribute →
    70.59 / 29.41, no request sent. Reset to 60/25, Save, Update Total → saved total 85.00. Adjust Manually and
    Escape close it.
13. (524-4, 524-8) −$100.00 = 60 D4 Groceries + 25 D4 Dining + 15 D4 Fun (line payee "D4 Toy Shop", memo "gift"):
    Activity −60, −25, −15 more; `uncategorized` unchanged; Checking Uncleared −$100.00 once; GET has 3 lines.
14. (524-5) ▾ and three line rows (payee only on line 3); ▾ collapses (›), › expands.
15. (524-6) Select a categorized saved row, press `S`: two empty lines, empty parent category. `S` in a field types.
16. (524-7, 524-9) REST unbalanced or one line → 422; MCP `create_transaction` with lines = REST rows;
    `get_transaction` returns the lines; one log row holding them.
17. (Lead) Real mouse (topmost at centre, `page.mouse`) at 1600×900 and 1024×700: transfer entries, Split, ⊖, Add
    another split, ⇆, chevron, dialog buttons.
18. (compare) Category footer: one full-width Split, no Payment/Transfer. **Source**: as 10, open the category
    dropdown; Escape.
19. Not compared, not visible in the test plan: transfer entries, saved transfers and ⇆, saved splits, the dialog.

## Manifest

touches: [apps/worker/migrations/20261116100500_transfers_splits.sql, apps/worker/src/db/schema/transactions.ts, packages/schema/src/transactions.ts, packages/schema/src/register.ts, packages/schema/src/payees.ts, packages/schema/src/transfers.ts, packages/schema/src/split.ts, packages/schema/test/transfers.test.ts, packages/schema/test/split.test.ts, packages/schema/test/payees.test.ts, packages/schema/test/register.test.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/transaction-pairs.ts, apps/worker/src/services/transaction-splits.ts, apps/worker/src/services/payees.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/routes/payees.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/mcp/tools/payees.ts, apps/worker/test/mcp-coverage/transactions.ts, apps/worker/test/transfers.test.ts, apps/worker/test/splits.test.ts, apps/worker/test/transactions.test.ts, apps/worker/test/plan-transactions.test.ts, apps/worker/test/payees.test.ts, apps/web/src/register/**, apps/web/src/api/transactions.ts, apps/web/src/api/payees.ts, e2e/transfers.spec.ts, e2e/splits.spec.ts, e2e/register-entry.spec.ts, e2e/payee-picker.spec.ts, e2e/support/register-seed.ts, docs/transfers-splits-design.md, docs/transfers-splits-spec.md, docs/README.md]
shared: []
migrations: 1
