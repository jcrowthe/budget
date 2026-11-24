# Remembered category per payee (EXF-515, server side): design

Unit U1 of plan p_e2a21c83 (try 2 of the Build). This covers the data model, the history rule, the payee API and MCP, and the single-transaction writes. The Manage Payees card, the register fill and the bank-import use are later units (see "Found, not built"). After landing, this doc is the reference for the definitions below.

## Shared definitions

- **Counted row** of payee P: a `transactions` row such that:
  - `payee_id = P`; not deleted; its account not deleted;
  - `parent_transaction_id IS NULL` (split lines don't count) and not a split parent (no live line points to it);
  - `transfer_account_id IS NULL`;
  - either `category_id` is a live category of the plan, or `inflow_to_ready_to_assign = 1` (Ready to Assign counts as a value).

  "Live category" is the same rule the transaction `validate` uses through `categoriesRepo.findActive`: same plan, not deleted, group not deleted. Scheduled transactions never count, because they live in another table. An unapproved import counts once it has a category.
- **Recency order:** `date DESC, created_at ASC, id ASC`. It is one constant, `RECENCY_ORDER` in `packages/schema/src/payee-category.ts`. The SQL (`recencyOrderSql`) and the pure `compareRecency` are both built from it.
- **Last 3:** the first 3 counted rows in recency order.
- **Value:** a pair `{ category_id, inflow_to_ready_to_assign }`. Ready to Assign is `{ null, true }`. Never a sentinel id.
- **History rule** `nextDefault(current, last3)`. `current` is the stored value if it is live, else null; RTA is always live.
  1. If one value holds ≥ 2 of the last 3, use it.
  2. Otherwise, if `current` is live, keep it.
  3. Otherwise take last3's first value, or null.
- **Stored default:** `payees.default_category_id` and `payees.default_inflow_to_ready_to_assign`.
  - They are recomputed by one idempotent set statement, `recomputeDefaultsStmt(db, budgetId, payeeIds | "plan")` (`repositories/payee-category.ts`).
  - It goes in the batch of every write that changes a payee's counted rows.
  - It writes only the rows whose value changes, adds no D1 call, writes no change_log row and does not bump `payees.updated_at`.
- **Effective default** (`default_category_id` / `default_inflow_to_ready_to_assign` in the API), from `effectiveDefault(mode, fixed, stored)`:
  - `off`: null.
  - `fixed`: the fixed value while it is live, else null.
  - `history`: the stored value while it is live. Otherwise a read-time fallback computed in `listForPlan`'s one select: the majority of the last 3, else the most recent counted value.
  - Transfer entries and system payees: always null, with mode `history`.

## Columns (migration `20261116101900_payee_category.sql`, additive)

| column | type |
|---|---|
| `category_mode` | `TEXT NOT NULL DEFAULT 'history'`, CHECK in (`history`,`fixed`,`off`) |
| `fixed_category_id` | `TEXT` |
| `fixed_inflow_to_ready_to_assign` | `INTEGER NOT NULL DEFAULT 0` |
| `default_category_id` | `TEXT` |
| `default_inflow_to_ready_to_assign` | `INTEGER NOT NULL DEFAULT 0` |

Backfill: one `UPDATE` over every live ordinary payee. It takes the majority of the last 3, else the most recent counted value, which keeps today's suggestion wherever there is no majority. For F,G with ascending dates it reads G.

## Where the recompute rides

| write | statement placement | success check |
|---|---|---|
| `addTransaction` (plain path), `createTransaction` | last statement, payee of the row | none read (unchanged) |
| `mutate` (update, delete) | after the row's own write; before and after payees | `results[indexOf(self)]`, no longer the last result |
| `rejectTransactions` | one extra group after the per-row groups (same single batch) | per-row groups unchanged |
| payee delete with a replacement | appended after `buildPayeeDeleteBatch` (still 6 statements) | `res[batch.length - 1]` |

Splits, transfers and approvals never change a payee's counted rows.

## API and MCP

- `Payee` gains `category_mode`, `fixed_category_id`, `fixed_inflow_to_ready_to_assign`, and read-only `default_category_id` and `default_inflow_to_ready_to_assign`.
- `last_category_id` / `last_inflow_to_ready_to_assign` are unchanged. They mean the **latest transaction, not the suggestion**.
- `PATCH /budgets/{budget_id}/payees/{payee_id}` also takes `category_mode`, `fixed_category_id` and `fixed_inflow_to_ready_to_assign`, combinable with `name` / `hidden` in one batch with one change_log row.
  - `fixed` needs a fixed value, given now or already stored and live.
  - An unknown or deleted category, or both a category and RTA, is 422.
  - A transfer entry is 403 `PAYEE_ERRORS.transfer`; a system payee is 403 `PAYEE_ERRORS.system`.
  - Leaving `fixed` keeps the stored fixed value.
- `GET /budgets/{budget_id}/payees/{payee_id}/recent-transactions?limit=3` (1–10, default 3) returns `{ transactions: [{ id, account_id, date, category_id, category_name, category_group_name, inflow_to_ready_to_assign, amount }] }`: the first `limit` counted rows.
- New tools: `set_payee_category_mode` and `list_payee_recent_transactions` (100 tools). The other payee tools' descriptions name the new fields.

## Decisions (fixed by the contract)

- Q1: same-date order is `date DESC, created_at ASC, id ASC`.
- Q2: Ready to Assign is a value, with separate columns (`fixed_*`, `default_*` pairs). Never a sentinel id.
- Q4: `last_category_id` / `last_inflow_to_ready_to_assign` stay unchanged, documented as "latest transaction, not the suggestion".
- Deletes recompute too. A fixed choice whose category was deleted reads as null. A category delete is covered by the read-time fallback.
- Try 2, acceptance 1: fail-on-base is required only for the rows whose base suggestion differs. Measured on base: A1 Fun, A2 Groceries, C Fun, D1 Fun, D2 Rent, E Fun. Cafe E already matches on base (logged).
- Try 2, acceptance 4: the backfill stays as Do 1 (majority of last 3, else most recent). Expected G, G, null.

## Departures to check against the source

- The ticket's history rule says "by date". The ticket table's Cafe A row 2 (same-date rows) only works with `created_at ASC` as the tie-break. Q1 fixes it. Check: `RECENCY_ORDER`, `recencyOrderSql`.
- The ticket offers one `default_category_id`. Here Ready to Assign is a second boolean (`default_inflow_to_ready_to_assign`, and the same for `fixed_*`), per Q2.
- `last_category_id` keeps today's meaning, which counts transfers and uncategorised rows (Q4). It is not the suggestion.
- The rule "a tie keeps the current default" keeps a live stored default even when the last 3 are empty (for example, every row deleted). The read-time fallback applies only when the stored value isn't live.
- The ticket's "first categorised transaction sets the default" is the third branch of `nextDefault` (no majority, no live current → most recent counted value).
- A fixed choice accepts any category a transaction could take by `findActive`. The per-account own-payment-category refusal (`refuseOwnPaymentCategory`) is not applied to the payee; it is still checked on the transaction.
- `fixed` without a new value needs a stored fixed value that is still live; otherwise 422.
- The PATCH change_log row adds the three category fields to before/after only when the request names a category field. A name/hidden-only PATCH keeps `{id, name, hidden}` (pinned by `test/manage-payees.test.ts`).
- `PayeeRow` (`repositories/payees.ts`) keeps the five new columns optional, so the payee literals in files of other units still compile. The full select type is `PayeeFullRow`.
- The migration test recreates the 20261116101800 state by resetting the new columns to their `ADD COLUMN` defaults and rerunning the migration's UPDATE, as `payees-migration.test.ts` does. The test pool has one D1 binding.
- `test/rename-rules.test.ts` asserts the tool count. It moves from 98 to 100, a one-number change outside this unit's files.

## Found, not built (later units)

- **U3:**
  - Bank import (`plaid-sync.ts`), bulk writes (`transactions-bulk.ts`), manual match, entering a scheduled transaction (`scheduled-transactions.ts`) and plan import don't call `recomputeDefaultsStmt` yet. After them the stored default can be stale until the payee's next single-transaction write. A null stored value is covered by the read-time fallback. `recomputeDefaultsStmt(db, budgetId, "plan")` exists for those writers.
  - Creating a transaction without `category_id` doesn't apply the default yet (REST/MCP report it).
- **U4:** the Categorization card, the "Last 3 transactions" popover and the register add-row fill.
- An account delete or a category-group delete leaves the stored default as it is. It reads through the live check and the fallback, so the API stays right.

## Measured (as built)

D1 calls, counted with `countingEnv` (`test/payee-category-calls.test.ts`). Base is main d1e7f2d.

| operation | base | now |
|---|---|---|
| payee list, 10 and 100 payees | 3 / 3 | 3 / 3 |
| `addTransaction`, existing payee / new payee | 9 / 9 | 9 / 9 |
| `updateTransaction` `{category_id}` / payee move | 7 / 8 | 7 / 8 |
| `deleteTransaction` | 5 | 5 |
| `updatePayee` rename / hide | 4 / 3 | 4 / 3 |
| `updatePayee` mode, `fixed`, rename + fixed | n/a | ≤ 4 |
| recent transactions | n/a | 3 |

Base suggestion (`last_category_id`) of the ticket rows, measured on base: Cafe A row 1 Fun, row 2 Groceries, Cafe C Fun, Cafe D row 1 Fun, row 2 Rent, Cafe E Fun. Cafe E already matches the ticket on base; the others differ.

## Found while building

- D1 batches only accept Drizzle builder statements: `db.run(sql)` has no prepared statement and fails inside `db.batch`. `recomputeDefaultsStmt` is therefore a `db.update(...).from(<derived table>)`, with no `WITH`.
- A tie keeps the stored default (rule step 2), so one edited row can leave the default as it was (a single Fun row edited to Groceries keeps Fun). This is the contract's rule, read literally.
- `buildPayeeDeleteBatch` stays at 6 statements; the replacement's recompute is appended outside it.


## Writers and imports (U3)

**`categoryFor` is the function the file import (EXF-531) must call.** `categoryFor(account, amount, payeeDefault)` in `packages/schema/src/plaid-import.ts` takes the payee's effective default, `{ categoryId, inflowToReadyToAssign } | null`, and returns the category of a new imported row. Read the default from `payeesRepo.listForPlan` and `payeeToApi` (the API's `default_category_id` / `default_inflow_to_ready_to_assign`), never from `last_category_id`. Order: an account that takes no category gets none; the default's category; the default's Ready to Assign; a deposit into a checking/savings account gets Ready to Assign; else none.

- **Bank import.** `planPayees` fills a per-plan map from the one `listForPlan` read the sync already makes (no added D1 call), so every row of one sync uses the defaults read at its start. A row renamed by a rule takes the rule payee's default (docs/rename-rules-design.md).
- **A1, `off` and cash inflows.** With no default (a brand-new payee, `off`, a `fixed` choice whose category is gone, no history) an inflow into checking/savings still gets Ready to Assign: the rule belongs to the account, and Ready to Assign is not a category. An `off` payee's outflow gets nothing.
- **A2, an RTA default** is applied as it is to any row that can take a category, whatever its sign.
- **A3, plan-wide recompute in the sync.** The final batch holds one `recomputeDefaultsStmt(db, plan, "plan")` per plan with an open linked account, only when the sync wrote something, before `updateConnectionStmt`, which stays last (its `changes` is the success check). A touched-ids list would miss a new payee (resolved by name in SQL), and "plan" also covers rows that moved or were deleted.
- **A4, own payment category.** In Q3, a default that is the card's own payment category gives none instead of a 422 (the request named no category). The bank import never checked this either.
- **A5.** `BULK_MAX_STATEMENTS` stays 400; the recompute statement counts inside it.
- **Q3, create without category keys** (Driver's decision): a create with neither `category_id` nor `inflow_to_ready_to_assign` takes the payee's effective default when the row can take a category (not a split, not a transfer, not a tracking account, and the payee already exists). `category_id: null` means none. The response shows the result. This is in `addTransaction`, the path REST and MCP call; the test-only `createTransaction` is unchanged (D-create). It costs one D1 call, only on this path.

Where the recompute rides (always in the writer's own batch, no added call):

| Writer | Statement |
| --- | --- |
| bank sync | `"plan"`, per plan, in the final batch before `updateConnectionStmt` |
| bulk categorize, move, duplicate, delete | the rows' payees, last, inside `BULK_MAX_STATEMENTS` |
| match | both payees, after the guarded update; success read at its index |
| unmatch | both payees, after the guarded insert; success read at its index |
| `enterDue` | per plan, the payees of its entered rows |
| scheduled `enter_now`, create and update that enter a row | the entered rows' payees |
| plan import | `"plan"`: after the rows in the one batch; in the last chunk after the reveal and before `advanceStmt` (last) |

D1 calls, before → after (same tests on main bd7c4fe and on the branch): bank sync 13 → 13 (`link-status-calls`, `rename-rules-calls`, `sync-refresh-calls`); a one-account sync 11 → 11; bulk memo 7 → 7, delete 5 → 5; match 7 → 7; unmatch 8 → 8; `enterDue` 2 → 2; `enter_now` 5 → 5; create with a payee and a category key 6 → 6, create with a payee and no category key 6 → 7 (the default read).
