# Pending bank transactions (EXF-466)

Plaid's pending transactions are stored, shown in a collapsible **Pending Transactions** section at the top of a
linked account's register, and affect no balance, category, plan or report figure until they post, or the user
chooses **Enter Now**. Read with `plaid-import-design.md` (the sync), `manual-match-design.md` (unmatch) and
`undo-design.md` (change sets).

## Storage: a separate table (D1)

Pending items live in `pending_transactions` and never in `transactions`. Every query that sums or counts
`transactions` (balances, activity, the plan month, reports, search, export, attention counts) stays untouched, so
pending rows are out of all of them **by construction**.

**Audit.** `repositories/` and `services/` hold about 180 lines that filter on `deleted_at` directly (183 at the
time of the build) instead of going through `countsInBalance()` (`repositories/transactions.ts`). A `status` column
on `transactions` would put each of those sites at risk of counting a pending row, and a missed one is a wrong
balance. A table of their own makes the exclusion free. The price: Enter Now inserts a real `transactions` row and
soft-deletes the pending one (D2), in one batch.

Migration `20261126234117_pending_transactions.sql`: the table, plus `transactions.pending_transaction_id` and
`transactions.status` (additive). `pending_transactions` columns: `id` (our uuid, the API id), `budget_id`,
`account_id`, `plaid_transaction_id`, `date`, `amount` (our sign), `payee_name` (after the plan's renaming
rules), `imported_payee`, `import_payee_name`, `bank_description`, `entered_transaction_id`, `resolved_at`,
`created_at`, `updated_at`, `deleted_at`. A partial unique index keeps one live row per (plan, Plaid id).

## Decisions

| # | Decision |
|---|---|
| D1 | Pending items live in `pending_transactions`, never in `transactions` (above). |
| D2 | Enter Now inserts a real `transactions` row and soft-deletes the pending row, in **one** `db.batch` with change_log rows. One change set: Undo works. |
| D3 | `transactions.pending_transaction_id` is Plaid's id of the pending item the row came from (kept after posting); `status` is `'entered'` while the clock shows, else null. |
| D4 | The resource gains `status: "pending" \| "entered" \| null` and `pending_transaction_id`, both defaulting to null in the schema so older stubs parse. A pending item is served in the PlanTransaction shape with `status: "pending"`. |
| D5 | The section shows only in a linked account's register, never in All Accounts. `GET …/transactions?status=pending` without `account_id` still lists plan-wide. |
| D6 | Pending sits at the top of the grid, above Scheduled. |
| D7 | Expanded by default; the collapsed state is kept in sessionStorage under `register.pending-collapsed`. Shown only when items exist and no search or attention filter is on. |
| D8 | An entered row is **approved**: never in `unapproved_count` or `needs_attention_count`, no banner. Pending items raise none either. When the posted version arrives it is matched and cleared, and stays approved. |
| D9 | Category on Enter Now when the request names none (no category, RTA flag, split or transfer): the payee's default, else Ready to Assign for an inflow into checking or savings (`categoryFor`), else none. |
| D10 | The clock is display only. Toggling it (`PATCH {status: null \| "entered"}`) never clears `pending_transaction_id`; the posted version still matches. |
| D11 | An entered row the user deleted, then the posted version arrives: it is imported as a new unapproved row (normal rules). |
| D12 | **Reconciled exception:** an entered row that is reconciled when the posted version arrives is matched and approved but **keeps its amount** (and stays reconciled). In every other plain case the bank's amount wins. |
| D13 | No Delete or Dismiss for a pending item. |
| D14 | The bank's amount does **not** replace the amount of an entered row the user has since split or made a transfer (lines must keep summing; a transfer's other side would drift): it is matched and approved and keeps its amount, like D12. It is matched only in the **same account**: a row the user moved elsewhere is not matched and the posted version is imported normally (as D11). |
| D15 | A matched entered row gets `match_entry_amount` = its amount before the match, so manual unmatch (EXF-464) gives the user's own amount back. `matched` stays `import_id IS NOT NULL AND source IS NULL`. |
| D16 | `SyncResult` is not changed: pending writes are not counted in `added/modified/removed/skipped`. |

## Sync

`netChanges` returns `{ upserts, pending, removed }`; `upserts` is unchanged (posted only). Pure decisions in
`packages/schema/src/plaid-import.ts`: `pendingPlan` (`insert`, `follow`, `skip_entered`, `noop`), `postedPlan`
(`import`, `match`), `enteredMatchValues` (D12 and D14).

- **Store.** A pending entry that passes `skipReason` (closed, before start, before the reconciled cutoff) and has
  no live row is inserted. Its payee name is the plan's renaming-rule result; **no payee is created**.
- **Follow.** An untouched live item whose date, amount or names changed takes the bank's values; one `update`
  change_log row (`service:plaid`), guarded on `updated_at` as read.
- **Replace.** A posted entry with `pending_transaction_id = P` against an untouched item P: the normal import
  (unapproved, `source plaid`, `pending_transaction_id` kept), and in the **same group** P is soft-deleted
  (change_log `delete`, `after {replaced_by}`), guarded on "still live, `updated_at` as read" and the import guard.
- **Match.** Against a live entered row of the same account: the row takes the bank's values (D12 and D14 decide
  the amount), `cleared`, `approved`, `status null`, `import_id`, `match_entry_amount` (D15), its lines follow;
  change_log `update` (`service:plaid`); the pending row gets `resolved_at` (the Undo guard). If the guard fails
  (the user edited the row meanwhile) the insert fallback runs as for any match.
- **Removed.** An untouched item is soft-deleted (`delete`, `service:plaid`). An entered row stays, uncleared, with
  its clock; its pending row gets `resolved_at`.
- **Bypass of `pickMatch`.** An entered row waits for **its own** posted version: `matchCandidatesQuery` excludes
  rows with a `pending_transaction_id`, so another import of the same amount never takes it.
- **Idempotence.** A repeat run from the old cursor changes nothing, change_log included; a full re-read never
  recreates an entered or replaced item (`skip_entered`; the posted import is then `known`).
- **Calls.** The pending reads ride the existing read batch; the writes are one group per plan (inserts, follows,
  removals, each with its log statement, about 7 statements) written before the posted units with `budget.fits(2)`.
  The counts do not grow with the number of items: **12 D1 + 2 Plaid calls for a sync with 10 pending and the same
  with 100** (`pending-calls.test.ts` C1; the cap is 45).

## API and MCP

- `GET /budgets/{id}/transactions?status=pending[&account_id=]` → `{ transactions, balances }`; the balances are the
  ordinary ones (pending changes nothing). `account_id` without `status=pending`, and `q`, `needs` or `since_date`
  with it, are 422; an unknown account is 404. 4 D1 calls whatever the number of items.
- `POST /budgets/{id}/transactions/{id}/enter-now` (body `EnterNowRequest`, every field optional) → 200
  `{ transaction }`; 404 when no live pending item has that id (a second call included); 409 `pending_changed` when a
  sync replaced or removed it between the read and the write (a guard statement fails the batch); 422 for a closed
  account and the usual create refusals. It shares the create path of `POST /transactions` (`createRow`): splits,
  transfers, payee creation and validation are not duplicated. 8 D1 calls whatever the number of items.
- `PATCH {status}` is the clock; only a row with a `pending_transaction_id` has one (422 otherwise).
- MCP: `list_unapproved_transactions` gains `include_pending`; new tool `enter_pending_transaction`.

## Undo

Entity `pending_transaction` in the undo engine: keys `date`, `amount`, `payee_name`, `resolved_at`. Undo of an Enter
Now removes the new row and restores the pending item (`entered_transaction_id` cleared). A sync that posted or
removed the item set `resolved_at`, and the row changed (`import_id`, `cleared`…), so the undo answers 409
`undo_stale`. `status` joined the transaction keys, so a clock toggle is undoable and a later toggle makes an older
undo stale. A restored item on a deleted, closed or unlinked account is refused. (`undo-design.md` is outside this
change: its rule table is not edited; this section is the rule for the new entity.)

## Web

`PendingSection` (modelled on `ScheduledSection`): a header button `aria-expanded` with the count, muted rows with no
selection, balance or cleared toggle. The circled "i" of a row opens a menu with **Enter Now**; a click or
double-click on a row opens the editor in mode `editPending`, whose Save is **Enter Now** (one request, the changed
fields in its body). A row with `status "entered"` shows a clock button in the cleared cell (`aria-pressed`); clicking
it hides it, and an outline clock shows on hover or focus on a row that has a `pending_transaction_id` and no
`import_id` yet. Colours come from the existing variables; the section and clock follow the register's narrow rules.

## Tests

Worker: `pending-sync.test.ts` (S1–S13), `pending-transactions.test.ts` (E1–E7, M1), `pending-calls.test.ts`
(C1–C4), `pending-audit.test.ts` (the month, accounts, category activity, reports, plan export, lists, search and
CSV equal the plan without pending, with a checking account and a credit card), schema unit tests in
`plaid-import.test.ts`. E2E: `e2e/pending-transactions.spec.ts` with `e2e/support/pending-stub.ts` (no real pending
row can be made in the browser; Enter Now makes the real row, so balances really move).

## Pre-allowed edits made

- `apps/worker/test/backup.test.ts:48` and `scripts/test/restore-backup.test.ts:179`: table count 28 → 29.
- `packages/schema/test/plaid-import.test.ts`: the `netChanges` test "pending is dropped" now also asserts `pending`
  (its `upserts` expectation is unchanged); the `txn()` fixture gains `pending_transaction_id: null`.
- `packages/schema/test/register.test.ts`, `packages/schema/test/register-export.test.ts`: fixtures typed as
  `TransactionDetail` / `PlanTransaction` gain `status: null, pending_transaction_id: null`.
- `apps/worker/test/rename-rules.test.ts:23,32` and `apps/worker/test/payee-category-api.test.ts:293,301`: tool count
  128 → 131 on the rebased tree (main is at 130 with fresh_start_budget and bulk_update_scheduled_transactions; this change adds enter_pending_transaction).
- `apps/worker/test/plaid-stub.ts`: `plaidTxn()` defaults `pending_transaction_id: null`.
- `apps/worker/test/mcp-coverage/transactions.ts`, `apps/worker/test/mcp-timestamps.test.ts`: the new route and tool.
- No exact-equality assertion on a transaction response, no plaid-sync "pending" assertion and no `change_log` JSON
  assertion needed an edit (the existing suites pass unchanged).

## Manifest

touches: [apps/worker/migrations/20261126234117_pending_transactions.sql, apps/worker/src/db/schema/pending-transactions.ts, apps/worker/src/db/schema/transactions.ts, apps/worker/src/plaid/transactions.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/pending-transactions.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/undo.ts, apps/worker/src/repositories/pending-transactions.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/imports.ts, apps/worker/src/repositories/undo.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/transactions.ts, packages/schema/src/transactions.ts, packages/schema/src/plaid-import.ts, apps/web/src/api/transactions.ts, apps/web/src/register/PendingSection.tsx, apps/web/src/register/RegisterTable.tsx, apps/web/src/register/AttentionMenu.tsx, apps/web/src/register/EntryRow.tsx, apps/web/src/register/entryDraft.ts, apps/web/src/register/icons.tsx, apps/web/src/register/register.css, e2e/pending-transactions.spec.ts, e2e/support/pending-stub.ts, docs/pending-transactions-design.md, docs/plaid-import-design.md]
shared: []
migrations: 1
