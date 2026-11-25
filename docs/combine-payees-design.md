# Combine payees design (EXF-512)

`Combine and Rename` in Manage Payees: several selected payees become one. Their transactions (split lines included),
scheduled transactions and renaming rules go to one payee (the survivor). The other payees are deleted. It is one
`db.batch` and one change set, so the dialog's Undo reverts it.

Spec of record: Linear EXF-512 and the Build contract. Implementation plan: the Build Thread's `spec.md`.

## What the source shows (read-only look, 2026-11-25)

The source app was looked at in a logged-in browser. Two payees were ticked, nothing was combined, and the dialog was
closed. Only structure and copy were recorded here.

- **Several selected, top to bottom:** a header (`<n> Payees Selected`, the names, and a `Show <N> Transactions`
  button); the `Combine and Rename` card; `Hide All` / `Delete All`; the hidden-payees note.
- **The card:** an `h2` `Combine and Rename`, then the paragraph `Combining these payees will also combine all their
  renaming rules and categorization rules.`, then one row with a text input (placeholder `New Payee Name`, pre-filled)
  and a primary `Combine` button.
- **The input is pre-filled with the first-selected payee's name.** The ticket says so too. The look found the value was
  not the second-ticked payee's name.
- **Empty input:** after the field was cleared, the source's `Combine` button was still enabled. What a press does was
  not tried. See the assumption below.
- **Not observed:** a transfer payee in the selection. The source list was too long to reach one without risk. The
  ticket says "disable Combine when one is selected".

## Decisions

### D1. The survivor and its name

`POST /api/v1/budgets/{budget_id}/payees/combine` takes `{ payee_ids, name, target_payee_id? }`. The rule is the
ticket's:

1. `target_payee_id` when given. It must be one of `payee_ids` (else 422).
2. Else the selected payee whose name equals the trimmed `name` exactly.
3. Else the first id of `payee_ids`.

The survivor is renamed to the trimmed `name` when it differs. Refusals, in order:

- fewer than 2 distinct ids: 422;
- a transfer id (`transfer:…`): 422;
- an unknown id: 422;
- a system payee: 422;
- empty name: 422;
- a name already used by a live ordinary payee outside the selection: 409 `conflict`, `PAYEE_ERRORS.duplicate`;
- a name equal to another selected payee's name while `target_payee_id` names a different payee: 409. The ticket's rule
  2 already makes that payee the survivor. Refusing the mix also keeps the undo safe: the undo restores payees in one
  `UPDATE`, and a swap of the same name between two rows could trip `payees_budget_name` there.

The web always sends `target_payee_id`. It sends the selected payee whose name equals the typed text, and otherwise the
first-selected payee (`selected[0]`, the order of the dialog's `selected` array). So with a new name the result keeps
the first-selected payee's settings (EXF-512 AC 4).

### D2. Renaming rules: moved to the survivor, deduped by kind + text

Every live rule of a merged payee moves to the survivor (`payee_id` update, one `payee_rename_rule` `update` row per
rule). A rule is dropped instead (soft-deleted, one `delete` row) when it would duplicate:

- a live rule of the survivor with the same `kind` and `match_text`; or
- an earlier rule of the merged payees, by `(created_at, id)`.

So the earliest copy is always kept. The unique index `payee_rename_rules_payee (payee_id, kind, match_text)` makes this
dedupe necessary, not just tidy. The combine does not add new `is <old name>` rules for the merged names. The ticket
asks only that the rules be combined. See follow-ups.

### D3. Categorization: the survivor's

The survivor keeps `category_mode`, `fixed_category_id`, `fixed_inflow_to_ready_to_assign` and its stored default
(`default_category_id`, `default_inflow_to_ready_to_assign`). The merged payees' settings are dropped with them. Unlike
a delete with a replacement, the combine does **not** run `recomputeDefaultsStmt`. A recompute over the merged history
could hand the default to a merged payee's category: in the ticket's example, 2 newer Fun rows would outvote the
Groceries default. That would break AC 4.

The stored default follows the history rule again at the payee's next single-transaction write
(docs/payee-category-design.md). When the survivor has no live stored default, the read-time fallback reads the last 3
counted rows, the moved ones included.

### D4. Transfer and system payees: 422

A `transfer:<account>` id or a system payee in `payee_ids` (or as `target_payee_id`) is refused with 422
`unprocessable_entity`. This differs from `bulk`, which answers 403 for the same ids. The contract asks for 422 here. In
the web, a selection with a transfer is the existing `mixed` pane (`Only one payee group can be edited at a time…`), so
the card and its button are not there.

### D5. One batch, one change set, change_log per row

The batch reuses the delete-with-replacement statements of EXF-882 with `replacementId = survivor`, in this order:

1. the survivor's rename: its `payee` `update` log row, then the update (only when renamed). It goes first, so the moved
   rows' stored `payee_name` and their log's `after.payee_name` read the new name;
2. `logDeleteStmt`: one `payee` `delete` row per merged payee, with `replacement_payee_id`, `transactions_moved` and
   `scheduled_moved`;
3. `logTransactionMovesStmt` and `logScheduledMovesStmt`: one `update` row per moved transaction (split lines included)
   and per moved schedule;
4. `transactionsRepo.movePayeeStmt` and `scheduledRepo.movePayeeStmt`;
5. the rules: the log of the dropped duplicates, their soft delete, the log of the moves, then the move;
6. `payeesRepo.softDeleteStmt` of the merged payees;
7. a closing check that fails the whole batch unless the survivor is live under the new name and no merged payee is
   live. It uses the `livePayeesCheck` trick: an insert of a NULL `change_log.actor`. The service maps that failure to
   409 `PAYEE_ERRORS.race`.

Every statement carries the guard `liveOrdinaryCountSql(budgetId, allIds)`. The rename also carries `unchangedSql`, so a
rename that raced the combine changes nothing, and the check then rolls everything back. Ids ride `json_each` (one bound
parameter, `idsIn`). The batch has 13 statements whatever the payees, rules or rows (the rename is two no-op statements when the name stays, so the count never changes).

**change_log.** The ticket asks for "one entry per affected payee". There is one per payee, plus one per moved row and
per moved or dropped rule. The undo needs those rows: a payee `delete` whose `transactions_moved > 0` has no logged move
rows is refused (`refusals` in `services/undo.ts`). Per-row logging is bounded the same way the existing delete is: one
`insert … select`, not one statement per row.

### D6. Undo

The combine is one change set, so the dialog's Undo (origin `payees`) reverts it in one step. The existing engine does
it with no type-map change:

- merged payees: the net `delete` is restored (`deleted_at = null`, name and hidden from `before`);
- the survivor: the net `update` puts the old name back;
- transactions and schedules: the net `update` puts `payee_id` back, and `payee_name` is derived again;
- rules: moved rules get their `payee_id` back, and dropped ones are undeleted.

`where` is `{ surface: "payees" }`: the move rows carry no `account_id`. Redo applies the set again. The worker test
proves the round trip, and an e2e test proves it from the dialog. If the undo test finds that a type map needs a key,
only payee or rule keys change, and a test that fails first proves it.

### D7. D1 calls

The combine makes a constant number of D1 calls:

1. plan check;
2. one read batch: the selected rows (`listForPlan` with `ids` and counts) and the name lookup (`findByNameQuery`);
3. the write batch;
4. the survivor read back for the response.

That makes 4. `test/combine-payees-calls.test.ts` asserts the same count for 2 vs 20 payees and for 10 vs 1000
transactions. It also asserts the statement count of `buildPayeeCombineBatch`.

### D8. REST and MCP

- **REST:** `POST /budgets/{budget_id}/payees/combine` returns `{ data: { payee, merged } }`.
  - `payee` is the survivor as a `Payee`, with its new counts and `has_rules`.
  - `merged` is a `PayeeDeleted[]` (`replacement_payee_id` = the survivor), plus `rules_moved` and `rules_dropped`.
- **MCP:** the tool `combine_payees` calls the same service and returns the same `data`.
- `test/mcp-coverage/payees.ts` gains `"POST /budgets/{budget_id}/payees/combine": { tool: "combine_payees" }`.
- A parity test runs the combine once through REST and once through MCP on twin worlds and compares the results.

## Web

- In `several` mode, the pane shows a `CombineCard` between `SelectedNames` and the `Hide All` / `Delete All` row, as the
  source does.
- The input is labelled `New Payee Name` (aria-label and placeholder). It is pre-filled with `selected[0].name`, and
  re-filled when the first-selected payee changes.
- `Combine` is disabled while the trimmed text is empty or a request is running. This is an assumption: the source
  leaves it enabled, and what it then does was not observed.
- On success, the payee views refresh, the selection clears (`Select a payee to edit.`) and the change set joins the
  dialog's undo stack (`recorded(b)` → `recordChange(b, id, "payees")`).
- A refusal shows its `detail` in the card's alert. The card hides while the `New payee` delete question is open.
- Colours come only from `shell/tokens.css` variables.

## Built, as observed

- A rename has never rewritten the stored `transactions.payee_name`; the reads join the live payee's name. So after a
  combine the moved rows are stored under the new name and the survivor's own rows keep the old stored text. Every read
  shows the new name.
- The account register also lists a moved schedule as an upcoming row, so the live check's register shows
  `ZZ-TEST AB` on 5 transactions and 1 upcoming row.
- Undo needed no type-map key (the test fails only before the server code exists).

## Found, not built

1. The several-selected `Show <N> Transactions` button and its PAYEE-column popover. The source has them in the header,
   but they need a read over several payees (manage-payees-design "Found, not built" 2). They are not among EXF-512's
   acceptance items.
2. Learning `is <merged name>` rules on the survivor, so that a later bank import of a merged payee's old text lands
   on the survivor and does not create that payee again.
3. The source quirk that left a payee used only by a scheduled split out of the combine is not copied. Schedules move.
   (This clone has no scheduled splits.)

## Live check (ZZ-TEST plan)

1. `bash scripts/live-test-plans.sh create 'ZZ-TEST Combine <run>'`, then open the plan.
2. Add an account. Enter 3 transactions to `ZZ-TEST A` (category X) and 2 to `ZZ-TEST B` (category Y), and add a
   scheduled transaction to `ZZ-TEST B`.
3. Open Manage Payees and select `ZZ-TEST B`. Add the rule `Contains ZZB`.
4. Click `ZZ-TEST A` by name, then tick `ZZ-TEST B`. The pane shows `2 Payees Selected`, both names, and `Combine and
   Rename` with `ZZ-TEST A` filled in.
5. Type `ZZ-TEST AB` and press `Combine`. The pane shows `Select a payee to edit.`. The list has `ZZ-TEST AB`, and
   neither A nor B.
6. Select `ZZ-TEST AB`. It shows `Show 6 Transactions` (5 plus the schedule). Its Categorization reads category X, and
   its Renaming card lists `Contains ZZB`. The register shows `ZZ-TEST AB` on all 5 rows.
7. Press Undo in the dialog. A and B are back with 3 and 2+1, B's rule is back, and `ZZ-TEST AB` is gone.
8. `bash scripts/live-test-plans.sh delete <id>`.
