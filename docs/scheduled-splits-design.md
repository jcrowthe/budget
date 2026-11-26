# Scheduled splits (EXF-501, part 2)

A scheduled transaction can be a split across categories. Part 1 (scheduled transfers) is
`docs/scheduled-transfers-design.md`. Tests: `apps/worker/test/scheduled-splits*.test.ts`,
`upcoming-splits.test.ts`, `plan-split-roundtrip.test.ts`, `category-delete-scheduled-splits.test.ts`,
`payees-scheduled-splits.test.ts`, `packages/schema/test/scheduled-splits.test.ts`,
`plan-export-scheduled-splits.test.ts`, `apps/web/src/register/scheduledSplits.test.ts`,
`e2e/scheduled-splits.spec.ts`.

## Data model

- Migration `20261126220000_scheduled_subtransactions.sql`: table `scheduled_subtransactions` (`id`, `budget_id`,
  `scheduled_transaction_id`, `amount`, `payee_id`, `category_id`, `inflow_to_ready_to_assign`, `memo`, `sort`,
  `created_at`, `updated_at`, `deleted_at`) and indexes on `(scheduled_transaction_id, sort)`, `category_id`,
  `payee_id`. Additive.
- A split schedule: the parent has no category, no Ready to Assign flag, no transfer; its `amount` is the sum of its
  2–50 lines; its account is on-plan. A line is never a transfer (there is no column for it).
- **A line is soft-deleted only when an edit replaces it** (PATCH with `subtransactions`, an empty list included).
  Deleting or ending a schedule (delete, bulk delete, last occurrence entered) leaves its lines alone, and every
  read, count and move joins a live parent. This keeps the enter and delete statements constant.

## API

`ScheduledTransaction.subtransactions` (always present; empty for a plain schedule and for a transfer mirror):
`id, amount, payee_id, payee_name, category_id, category_name, category_group_name, inflow_to_ready_to_assign, memo`.
Create and PATCH accept `subtransactions: [{amount, category_id, payee_id?, payee_name?, inflow_to_ready_to_assign?,
memo?}]` (the register's line object, at most 50). MCP `create_scheduled_transaction` and
`update_scheduled_transaction` take the same field; the tool count is unchanged.

Refusals (422, the register's texts where it has one):

| case | text |
| --- | --- |
| lines that do not add up to `amount` | `The splits add up to X but the amount is Y` |
| fewer than two lines | `A split needs at least two lines` |
| `category_id` or the RTA flag with lines | `A split transaction's category is in its lines` |
| lines with a transfer (**decision: refused**, as the register refuses) | `A transfer cannot be split` |
| a tracking account | `A tracking account's transactions cannot be split` |
| `amount` alone on a split | `A split's amount changes with its lines: send subtransactions too` |
| a card's own payment category on a line | as the register |

PATCH with `subtransactions` replaces every line; `[]` makes the schedule plain (its category is the request's, else
none); a plain schedule given lines becomes a split (its category is cleared). Dates, memo and flag edits keep the
lines. A new line `payee_name` creates the payee once per distinct name.

## Entering

Enter Now, the due job and a past-dated create or edit write a real split dated the occurrence: the parent (category
null), every line (`split_index` 0..n-1, amount, category, payee, memo, RTA copied), and one create log with the lines.
A split costs a constant **three statements** whatever its lines (`insertIfStmt`, `insertEnteredLinesStmt` from
`json_each`, the log), all under the schedule's write-token guard. A batch of 100 due splits is about 5 × 100
statements (gate, parent, lines, transaction log, schedule log); plain schedules are 3 × 100.

## Upcoming (EXF-505)

`listUpcomingSources` adds a line branch in the same statement (`union all`): each line counts toward **its own
category**; lines of one category in one schedule merge into one occurrence (amounts summed, one count per date);
the parent counts nowhere; a Ready to Assign line, an uncategorized line and a deleted-category line count nowhere.
The occurrence's payee and memo come from the lowest-sort line of that category that has one, else the parent's.

## Category delete, payees

- Category delete (EXF-659): the delete preview counts a schedule once when it or a live line uses the category; the
  lines of live schedules move to the replacement (or are cleared), logged as `scheduled_subtransaction` updates, the
  parent's write token renewed so an edit in flight gets a 409.
- Payee delete and combine move the lines of live schedules the same way (logged as `scheduled_subtransaction`
  updates, the parents' write tokens renewed, undoable; with no replacement the line's payee is cleared); the payee
  list's `scheduled_count` counts a schedule once, whether the parent or a line uses the payee; the payee's
  transactions pane lists it. This adds three constant statements to each batch.
  Pins: delete batch 8 → 11 (`manage-payees-calls.test.ts`), combine batch 14 → 17 (`combine-payees-calls.test.ts`),
  payee delete in `rename-rules.test.ts` 8 → 11. The counts stay the same for 10 and 100 payees, schedules and lines.

## Undo

Undo of create, edit (lines replaced), plain↔split, delete and Enter Now restore the lines: a schedule's log row
carries its lines, `restoreStmts` brings back the lines of `before` (keys, position) and removes the lines only in
`after`; the stale finder checks every line of `after` still holds what was written. `scheduled_subtransaction` is
an undo type of its own for the category and payee moves. Redo of a schedule create is stale for plain schedules too
(the `updated_at` guard) and is not changed here.

## Export and import

The register file is unchanged: a split schedule is written as consecutive `Split (k/n) <memo>` rows dated by its
next date. An older importer reads such rows as a split transaction dated in the future and warns
`scheduled_not_supported`, as today. The importer now makes **one split schedule** (frequency `never`, dated by the
file) from an on-plan split dated after the export date, with no `scheduled_not_supported` warning; it counts in
`scheduled`, not in `splits`. This supersedes part 1's "the warning remains for splits". The first line's payee
becomes the parent's payee, a line with that payee has none of its own (as for real splits). Tracking-account splits
are unchanged.

## Web

The scheduled add row's category picker offers `Split (Multiple Categories)...`; an unbalanced save opens the
register's "Something Doesn't Add Up" dialog (Auto-Distribute / Update Total / Adjust Manually). The scheduled
section shows a split series with a chevron and indented sub-rows (payee, `Group: Category`, memo, outflow, inflow),
expanded by default. Make Repeating is enabled for splits (lines copied with fresh keys); a transfer keeps a reason.

## D1 calls

| operation | calls |
| --- | --- |
| an account's scheduled list, 10 or 100 split schedules | ≤ 3 (lines come in the same select) |
| due job, 10 or 100 due splits | 2 (one read, one batch) |
| bulk Enter Now, 10 or 100 splits | 5 |
| create or edit, 2 lines / 10 lines | 7 / 15 (the register's rule: one category read per line, 50-line cap) |

## Edits to existing tests

- Pre-allowed: `apps/worker/test/backup.test.ts:48` and `scripts/test/restore-backup.test.ts:179` (26 → 27 tables);
  `apps/web/src/register/makeRepeating.test.ts` ("is on for a split and off for a transfer", a new "copies a split's
  lines" case); `e2e/make-repeating.spec.ts` (the reason constant and the split/transfer test); the web fixture
  `apps/web/src/register/scheduledTransfers.test.ts` gains `subtransactions: []`.
- Approved deviation: `packages/schema/test/plan-import.test.ts` (the two split-after-export-date cases now expect a
  schedule and no warning) and a third assertion of the same behaviour in the same file (`schedules.length` 3 → 4).
- Approved by the approver (payee line handling): the three statement-count pins above.
- Not pre-allowed, declared: `packages/schema/test/scheduled-transactions.test.ts` ("refuses fields it does not
  support": `subtransactions: []` is now valid by the feature itself; an unknown line key is the refused case).
