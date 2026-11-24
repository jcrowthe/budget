# EXF-515 U1: server side of the remembered category, as built

Design and definitions: [payee-category-design.md](payee-category-design.md). This is the build record of unit U1 (try 2).

## What was built

- **Migration** `20261116101900_payee_category.sql`: the five `payees` columns and one backfill `UPDATE` (the majority of the last 3 counted rows, else the most recent). Mirrored in `db/schema/payees.ts`.
- **Pure rule** `packages/schema/src/payee-category.ts`: `RECENCY_ORDER`, `compareRecency`, `nextDefault`, `effectiveDefault`, `CategoryMode`.
- **Repository** `repositories/payee-category.ts`: `recencyOrderSql`, `liveCategorySql`, `recomputeDefaultsStmt`, `recentValueSql` (read-time fallback), `recentCountedQuery`, `liveCategoryQuery`. `repositories/payees.ts` `listForPlan` adds the mode, the fixed choice and the history default to its one select.
- **API:** `Payee` and `PayeeUpdate` fields; `PATCH …/payees/{id}` takes `category_mode`, `fixed_category_id`, `fixed_inflow_to_ready_to_assign` (`buildPayeeUpdateBatch`); `GET …/payees/{id}/recent-transactions?limit=`.
- **MCP:** `set_payee_category_mode`, `list_payee_recent_transactions` (100 tools).
- **Writes** (`services/transactions.ts`, `services/payees.ts`): `recomputeDefaultsStmt` in the batch of `createTransaction`, `addTransaction` (plain path), `mutate` (update and delete; success is read at `indexOf(w0.self)`), `rejectTransactions` (one extra group) and a payee delete with a replacement.

## Tests

- `packages/schema/test/payee-category.test.ts`: the eight ticket rows, RTA as a value, empty, fallback.
- `payee-category-history.test.ts` (acceptance 1): `ZZ Cafe A: 11/15 Fun, 11/15 Fun → Fun`, `ZZ Cafe A: then 11/15 Groceries ×2 …→ Fun`, `ZZ Cafe C: …→ Groceries`, `ZZ Cafe D: … (a tie keeps)`, `ZZ Cafe D: then Rent 11/13 (3-way tie) → Groceries`, `ZZ Cafe E: …→ Fun`, `ZZ Phone Co: history Phone, fixed Fun → Fun`, `ZZ Cafe A: off → null`.
- `payee-category-writes.test.ts` (2, 3), `payee-category-migration.test.ts` (4), `payee-category-api.test.ts` (5, 6, 8, surface), `payee-category-calls.test.ts` (7).

## Departures (see the design doc for the reasons)

1. `test/rename-rules.test.ts`: 98 → 100 tools, two numbers (outside May touch).
2. The migration test rebuilds the 20261116101800 state by resetting the new columns, then reruns the migration's UPDATE.
3. The PATCH change_log carries the category fields only when the request names one.
4. A fixed choice accepts what `categoriesRepo.findActive` accepts.
5. `PayeeRow` keeps the five columns optional (`PayeeFullRow` is the full select).
6. `nextDefault` keeps a live stored default when the last 3 are empty.
7. `fixed` without a new value needs a stored value that is still live, else 422 `fixedNeedsValue`.
8. `test/payees.test.ts` and `test/splits.test.ts` needed no change. `packages/schema/test/payees.test.ts` `p()` gained the five fields.
9. A new `repositories/payees.ts` `findByNameQuery` / `updateGuardSql` (same file as may touch).

## D1 calls

Unchanged from base for transaction create, update and delete, the payee list (3 / 3), rename (4) and hide (3). PATCH with a category ≤ 4; recent transactions 3.
