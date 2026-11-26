# Scheduled transfers (EXF-501, part 1)

A scheduled transaction can be a transfer between two accounts of the plan. Scheduled splits (AC1–3 of the
ticket) are a later unit. Tests: `apps/worker/test/scheduled-transfers*.test.ts`, `upcoming-transfers.test.ts`,
`plan-transfer-roundtrip.test.ts`, `packages/schema/test/scheduled-transfers.test.ts`,
`plan-import-transfers.test.ts`, `apps/web/src/register/scheduledTransfers.test.ts`,
`e2e/scheduled-transfers.spec.ts`.

## Data model

- Migration `20261126151100_scheduled_transfers.sql`: `scheduled_transactions.transfer_account_id TEXT
  REFERENCES accounts(id)`, nullable, plus an index on it. Additive.
- One row is one series, stored on its **series account** (`account_id`). `transfer_account_id` is the other
  account. **The other side is never stored**: it is derived when reading, so the two sides cannot drift apart.
- A transfer schedule has no payee (`payee_id` null). Its payee is derived: `Transfer : <other account>`.

## API fields and the mirror

`ScheduledTransaction` gains `transfer_account_id`, `transfer_account_name` and `mirror`.

- **Series row** (`mirror: false`): the series account's own view; `amount` as stored.
- **Mirror row** (`mirror: true`): what the other account's list shows. Same `id` as the series (every call,
  enter, delete, GET, bulk, takes the series id), `account_*` = the viewing account, `transfer_account_*` = the
  series account, `amount` negated, same dates, frequency and memo, no flag.
- `GET ?account_id=X` returns the series where `account_id = X` and the mirror where `transfer_account_id = X`
  (one query). Without `account_id` (All Accounts) it returns both rows; they sort by `date_next`, series id,
  series before mirror.
- Create and PATCH accept `transfer_account_id`. A plain schedule becomes a transfer (the payee is cleared), a
  transfer re-targets, and `null` makes it plain again (the payee comes from the same request, else none). A
  payee sent with a transfer is 422. The other account must be active, open and different.

## Category rule

The category belongs to the on-plan side, as for the register's transfers:

| series | other | category |
| --- | --- | --- |
| on-plan | on-plan | none (422 `A transfer between on-plan accounts takes no category`) |
| tracking | tracking | none (422) |
| on-plan | tracking | allowed, validated against the series account |
| tracking | on-plan | allowed, validated against the **other** account (incl. the own-payment-category refusal) |

The mirror carries the category only when it is the on-plan side of an on-plan/tracking transfer (series
tracking). When a PATCH makes a category not-needed and the request did not send one, it is cleared; when it did,
422. The UI disables the category of a tracking-series transfer, so setting it there is API/MCP-only (the mirror is
read-only).

## Entering

`enteredRows` builds one transaction for a plain schedule, two for a transfer: the series side, then the other
side from `newOtherSide`, linked both ways, both with `approved` as the entry mode says (Enter Now: approved, dated
today; due-job and past-dated create/update: unapproved, dated the occurrence). The response's `transaction` is the
series-side row. `bulkScheduled` and `enterDue` record each schedule's gate-statement index instead of assuming a
fixed number of statements per item, because plain items use 4 and transfers 6. Bulk dedupes ids, so selecting
both rows of one series enters once.

D1: the due-job is still one read and one batch for any number of schedules. A batch of 100 transfers holds about
600 statements; miniflare accepts it (tested). Real D1 may have its own batch limit: this is the first batch that
size, so watch it before raising `SCHEDULER_MAX_PER_RUN`.

## Closing and deleting an account (decision)

- **Close**: nothing is written. A transfer schedule counts only while *both* accounts exist and are open ("live
  pair"), so it disappears from both registers, the due-job, Enter Now (bulk: 422 `account_closed`, with the
  other-account text when only that side is closed) and Upcoming. Reopening brings it back.
- **Delete**: the account's delete batch ends every live schedule that is a transfer to it or from it, logged
  (`scheduled_transaction` `delete` rows in the same change set as the account's delete) and soft-deleted, before the
  account's own soft-delete (which must stay the batch's last statement). **Deviation:** deleting an account is not
  undoable (`docs/undo-design.md` D5), so undoing it does not restore the schedules; the ends are only recorded.

## Upcoming (EXF-505)

An occurrence counts on the **on-plan side**: the series account when on-plan, else the other account (amount
negated, account name of that side). An on-plan to on-plan transfer has no category and is never counted. Closed or
deleted other accounts drop out. Same one select, constant calls.

## Category delete (EXF-659)

No code change: schedules move by `category_id`; on-plan/on-plan transfers have none and are untouched, on-plan/
tracking ones move like plain schedules. Tested.

## Export / import

- **Export** writes two scheduled register rows per transfer (series side, mirror side `Transfer : A`, negated, same
  date and memo), each with the category of its on-plan side. The file format is unchanged.
- **Import** reads a paired transfer dated after the export date as **one** transfer schedule on its outflow side
  (category from the on-plan row of an on-plan/tracking pair), not two future real rows, and not counted in
  `transfers_paired`. **Behaviour change:** before, such a pair became two real future-dated transactions with a
  `scheduled_not_supported` warning; now the warning remains for splits only. Edited tests:
  `packages/schema/test/plan-import.test.ts` (the 11/10 pair is now one schedule).

## Undo

`repositories/undo.ts` changes in two places only: `transfer_account_id` joins the scheduled-transaction keys, and the
refusal also fires when the transfer account was deleted since. Undo of create/delete/edit then works for transfers
(and re-target, plain↔transfer). To make undo of a schedule **delete** work the soft-delete no longer changes
`updated_at` (undo compares the soft-deleted row with the log's `before`); this also fixes plain schedules, whose
delete was undo-stale.

## Web

- The add row and a series' edit row offer `To/From <account>` in the payee picker; the category shows "Category
  not needed" for on-plan/on-plan. A split in the add row still says "Scheduled splits are not available yet".
- Scheduled rows are keyed with `scheduledRowKey` (`id`, or `mirror:<id>` for a mirror); selection holds keys and
  every action turns them into unique series ids (`seriesIds`). A mirror is read-only: it selects but never opens an
  editor; its ⇆ button ("Click to edit this schedule in A"; the row's own tooltip reads "Scheduled in A: edit it there") opens A with the series ticked and in view
  (`state.selectScheduled`). The series row's ⇆ jumps to the other account.
- Mutations already invalidate every query of the plan, so both registers refresh.

## Make Repeating

Left disabled for transfers: enabling it would change `makeRepeating.test.ts` and `e2e/make-repeating.spec.ts`
assertions, which this unit may not edit. Follow-up: enable it and update those two.

## D1 calls (counting tests)

| call | calls |
| --- | --- |
| an account's scheduled list, 10 or 100 transfers + plain | the same, at most 3 |
| `enterDue`, 10 or 100 due transfers | 2 (one read, one batch) |
| bulk enter now, 10 or 100 transfer ids | the same, at most 5 |
