# Payee renaming rules (EXF-467): design

None of the five files closed by EXF-881 is needed: the import's rule read rides the batch that `plaid-sync.ts`
already sends, and nothing in `repositories/{accounts,bank-connections,imports}.ts`,
`services/bank-connections.ts` or `e2e/bank-connections-sandbox.spec.ts` changes. One migration:
`apps/worker/migrations/20261116101800_payee_rename_rules.sql`. No shared module changes. Spec:
[rename-rules-spec.md](rename-rules-spec.md).

## The source app in this Build

**No step of this Build opens, reads or probes the source app, and no step starts a sub-agent.** The Clerk's tab
command is the only contact, because the platform checks that the tab exists; nobody uses that tab. Reasons: the
source's `Renaming` card is inside its Manage Payees dialog, which is reached through the plan menu, and no child
opens that menu until the owner says so; the tooltip and the `Bank Import Details` popover exist only on real
imported rows of the owner's own accounts, which hold real payees. So:
- **Words** come from the tickets EXF-467 and EXF-510 (quoted below), character for character.
- **Looks** follow what the clone already has beside each new thing: the `Payee Name` card of the Manage Payees
  pane for the new card, the row of the payee list for the gear icon, the register's existing popovers and
  tooltips for the two new ones. The Designer compares the new pieces with those neighbours in the clone, not with
  the source, and writes "not compared with the source" once at the top of the polish list.
- **Behaviour** is "built from the ticket"; where the brief says "the Lead's decision, not observed", this design
  lists it under "Departures to check".

**Each step states in its report, for itself only, that it opened nothing in the source app.** Nobody but the
Clerk runs the Clerk's commands. (The Architect opened nothing in the source app and ran none of the Clerk's
commands.)

## Source

Nothing was studied (above): no notes, no screenshots. The words are the ticket quotes in this design.

## What exists (read in the code)

The import finds a payee **by name** (`plaid-sync.ts:305` `planPayees`, `ordinaryIdByNameSql`, `addPayee` `:835`);
merchant `ZZ BANK CAFE 12` gives `import_payee_name = ZZ BANK CAFE 12` but `imported_payee = ZZ Shop …` (measured
with the stub). A changed bank name is followed only when `modifiedPlan` is `follow` (`plaid-import.ts:251`: not
reconciled, unapproved, `source = 'plaid'`): **that is how the code tells a row the owner took over** (an edit
approves it, a match sets `source` null), kept. Per-account reads are one `db.batch` (`plaid-sync.ts:368`). No real
import can exist in the browser suite: specs dress hand rows (`e2e/support/manual-match-stub.ts`).

## Approach

### Data (migration `20261116101800_payee_rename_rules.sql`, additive)

Table `payee_rename_rules`: `id` TEXT PK, `budget_id`, `payee_id`, `kind` (`is` | `contains`), `text` (as typed,
trimmed, 1–200 chars), `match_text` (the comparison form), `created_at`, `updated_at`, `deleted_at` (soft delete,
as payees). Unique index `payee_rename_rules_payee (payee_id, kind, match_text) WHERE deleted_at IS NULL`; index
`payee_rename_rules_budget (budget_id, kind, match_text) WHERE deleted_at IS NULL`. Drizzle table
`db/schema/payee-rename-rules.ts`.

**Comparison form** `foldRuleText(s)` = `s.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase()`, always
computed in the Worker (or the web), never in SQL. SQL compares only stored `match_text` with a parameter the
Worker folded (`=` and `instr(?, match_text) > 0`), so SQLite's ASCII-only `lower()` is never used and both sides
agree. Non-ASCII: `CAFÉ` matches `café` (Unicode lower case); a decomposed `e`+U+0301 matches `é` (NFC);
`STRASSE` does not match `straße`, `İSTANBUL` not `istanbul` (lower case, not full case folding).

### Matching: one pure function (`packages/schema/src/rename-rules.ts`)

`pickRenameRule(name, rules)`: the folded name; `is` matches when equal to `match_text`; `contains` when
`match_text` is a substring (words in the same order, no wildcards). Any rule of a payee may match (OR). Among
matches: **`is` before `contains`**, then the newest `created_at`, then the greater `id`. The import is its only
user. A rule of a hidden payee applies (the payee stays hidden); a deleted payee's rules are deleted with it and the
read joins live ordinary payees only. Rules are per plan (`budget_id`).

### The import applies the rules (`services/plaid-sync.ts`)

- **Read:** one `rulesForPlanQuery(db, budgetId)` per plan, pushed into the existing per-account batch beside
  `categoryNamesQuery`. **D1 calls of one sync: 13 before, 13 after** (2 Plaid); the run's 45-call budget
  (`RUN_CALL_BUDGET`, `docs/plaid-import-design.md`) holds, since no call is added. `planPayees` also keeps the
  payees by id (for the rule payee's last category).
- **Insert:** `pick = pickRenameRule(payeeNameOf(txn), rules)`. A match gives the row the rule's payee:
  `payee_id` = `coalesce(<that payee if still live and ordinary>, ordinaryIdByNameSql(<bank name>))`,
  `payee_name` = its name, category by `categoryFor` with **its** last category; `addPayee(<bank name>)` is
  emitted only guarded by "the rule's payee is no longer live" (a delete between read and write falls back to
  today's path instead of losing the import). No match: as today. **`import_payee_name` keeps the name as received
  in every case.**
- **Follow** (`followPlan`): a row that follows the bank and whose bank name changes goes through the same pick.
  A row the owner edited, matched or reconciled is never moved; a later rule never moves an existing row.
- **History:** `service:plaid` as today; the row's change_log copy has `import_payee_name` beside the rule's
  payee and **`rename_rule_id`** when a rule gave the payee: that field shows a rule renamed it.

### Rules made by themselves (`is`), in the batch of the change that causes them

Every statement is guarded like the batch it joins, conditions in SQL: **no new round trip**. Each rule made or
removed writes one `change_log` row (`entity_type` `payee_rename_rule`, the change's actor), put before its write
with the same condition (`changeLogInsertIf` / `logSelectStmt`).

1. **The transaction edit** (`mutate`; register, `PATCH …/transactions/{id}`, MCP `update_transaction`). Applies
   when: an update; `before.source = 'plaid'`; `before.import_payee_name` not null; after the change no transfer;
   `after.payee_id` not null and differs from `before.payee_id` (so not on clear, not to a transfer, not on a
   hand-entered or matched row). Split lines' payees never count; Match, Unmatch and the bulk operations do not go
   through `mutate`'s payee path (bulk has no payee operation; `manual-match.ts` writes its own batch).
   - **Learn:** the new payee's name ≠ `import_payee_name` → insert `is <import_payee_name>` on the new payee
     unless it has that `(is, match_text)`.
   - **Undo:** the new payee's name = `import_payee_name` exactly → soft-delete every live `is <that name>` rule
     (same `match_text`) of other payees of the plan; **then, if a live `contains` rule of another live payee still
     matches the folded name, insert `is <that name>` on this payee unless it has it**, so that it holds (point 2's
     order: `is` wins). The new payee may be one this edit creates (its insert is earlier in the batch).
   - **D1: 8 before, 8 after** (learn and undo).
2. **The payee rename** (`updatePayee` with a new name; Manage Payees, `PATCH …/payees/{id}`, `rename_payee`):
   insert `is <old name>` on the payee when one of its live transactions has `import_payee_name = <old name>` and it
   has no such rule; guarded by the payee still reading as before; placed before the payee's update. **D1: 4
   before, 4 after.** This ends the fault: `ZZ BANK CAFE 12` imported, renamed `ZZ Cafe`, the next import of
   `ZZ BANK CAFE 12` gets `ZZ Cafe`, and no payee `ZZ BANK CAFE 12` is made.
3. **The payee delete** (`buildPayeeDeleteBatch`, single and bulk): two statements added before the payees' soft
   delete: one `delete` history row per live rule of the deleted payees, and their soft delete, under the delete's
   guard. Six statements, still one batch (the atomicity test appends a failing statement). The replacement payee
   inherits nothing. **D1 unchanged** (3, or 4 with a replacement).

### REST and MCP (new files `routes/payee-rename-rules.ts`, `mcp/tools/payee-rename-rules.ts`; both globbed)

Rule resource `PayeeRenameRule`: `{ id, payee_id, kind: "contains"|"is", text, created_at, updated_at }`.

| Operation | Tool | Answer | D1 |
|---|---|---|---|
| `GET /budgets/{budget_id}/payees/{payee_id}/rename-rules` | `list_payee_rename_rules` | 200 `{ rules }`, oldest first | 3 |
| `POST …/rename-rules` `{kind, text}` | `create_payee_rename_rule` | 201 `{ rule }` | 3 |
| `PATCH …/rename-rules/{rule_id}` `{kind?, text?}` | `update_payee_rename_rule` | 200 `{ rule }` (same id and `created_at`) | 4 |
| `DELETE …/rename-rules/{rule_id}` | `delete_payee_rename_rule` | 200 `{ rule }` as it was | 4 |

The card edits a row in place, so **PATCH is added**. Refusals (words in the spec): transfer entry 403
`PAYEE_ERRORS.transfer`; system payee 403 `PAYEE_ERRORS.system`; unknown plan, payee or rule 404; empty or over
200 characters 422; PATCH with no field 422; **the same `(kind, match_text)` already on the payee 409** (a PATCH to
its own value writes nothing, 200). Each write is one batch with its `change_log` row.
**Tools: 94 → 98.** Coverage: four lines in `apps/worker/test/mcp-coverage/payees.ts`; four CALLS in
`mcp-timestamps.test.ts` (`created_at`, `updated_at`). `list_payees`, `rename_payee`, `delete_payee`,
`bulk_update_payees` descriptions say what they now do with rules.

**`has_rules`** on the `Payee` resource: in `listForPlan`'s one select when `counts` is on (an `exists`
subquery), false for transfer entries. **The list stays 3 D1 calls** (10 and 100 payees, with rules).

### Transaction resource

A new field **`import_payee_name`** (string or null; the name the import matched and its rules compare, as
received; null when no import gave the row), from `transactionToApi` (`services/transactions.ts:41-62`).
**`imported_payee` and `bank_description` keep their meaning.** In every read and change_log copy.

### Web

- **Queries:** `has_rules` rides the existing `usePayees(b)` (`["payees", b]`); a payee's rules are
  `usePayeeRenameRules(b, id)` (`["payee-rename-rules", b, id]`, on while one ordinary payee is selected). A rule
  change writes its answer into both caches (`setQueryData`): no refetch. `invalidatePayeeViews` also covers
  `payee-rename-rules` (a rename may add a rule); a transaction save invalidates the whole plan already. Fresh
  without a reload, nothing fetched twice.
- **The `Renaming` card** (`payees/rename-rules-card.tsx`), under `Payee Name`, for one ordinary payee, hidden or
  not; not for a transfer entry (Found, not built). Looks: the `Payee Name` card's frame, heading, input and error
  bar (`manage-payees.css`). Heading: a gear icon and `Renaming`; the sentence; one row per rule, oldest first: a
  select (`Contains`, `Is`; aria-label `Rule type`), a text input (aria-label `Rule text`, maxLength 200), a `−`
  button (`title` and aria-label `Remove renaming rule`); the last row is always empty (`Contains` by default)
  with a `+` button (`Add a renaming rule`).
  Saves: the select at once, the text on blur or Enter, `+` on the empty row (blank: nothing sent); `−` deletes;
  an emptied saved row shows `Renaming rule text cannot be empty` without a request; a refusal shows its `detail`
  in the red bar under its row, as the name errors do (spec task 5).
- **The gear on a list row** (`manage-payees-list.tsx`): a 16 px slot before the checkbox on every payee row; with
  `has_rules`, the gear with `title` and aria-label `Renaming rules applied`.
- **Several selected:** the sentence under the buttons when any selected payee has `has_rules`.
- **The payee cell of an imported row** (`source = "plaid"`, not a transfer; `RegisterTable.tsx`): the name in a
  span whose `title` is `<payee_name> (Imported as <import_payee_name>)` when `payee_name` and `import_payee_name`
  are both set and differ, else `<payee_name>` (the browser's own tooltip, as every register cell's). At the right
  of the cell, the info button (`rename-rules-bank-import.tsx`, `InfoCircleIcon`, aria-label and `Tooltip`
  `Bank Import Details`), at opacity 0 unless the row is hovered, selected (`is-checked`) or the button has focus;
  always in the tab order. Its press never selects or opens the row.
- **The popover** (`Popover`, `role="dialog"`, below, start-aligned, 320 px): `Bank Import Details`; `As it appears
  on your statement` with `bank_description`; `As we imported it` with `import_payee_name`; and, only when the
  payee differs from `import_payee_name`, a link button `Don't rename as <payee_name>`: `PATCH {payee_name:
  import_payee_name, approved: <the row's approved>}` through `useSaveTransaction` (the payee of that name is made
  if missing; the Worker does point 1's undo); success closes the popover and puts the focus on the info button; a
  refusal shows in the popover. No amount or date is shown, so no formatter call.

## Departures to check

1. (Lead, not observed) `is` beats `contains`; among one kind the newest wins.
2. (Lead) A payee rename in Manage Payees adds `is <old name>` when the old name came from the bank.
3. (Lead) The undo removes other payees' `is <name>` rules and adds `is <name>` when a `contains` rule elsewhere
   still matches. The learn does the same removal (EXF-885): every other payee's `is <name>` goes, with a delete
   history row each, then `is <name>` is added to the new payee unless it has it.
4. (Lead) The info button sits at the right of the payee cell, shown on hover, selection or focus.
5. (Architect) The fold also turns any run of white space into one space.
6. (Architect) `+` with a blank text sends nothing; an emptied saved row shows the empty error locally.
7. (Architect) A duplicate rule is 409; a PATCH operation is added (tool 98); rules are soft-deleted.
8. (Architect) `Don't rename as` keeps the row's approval; the tooltip is the browser's `title`.
9. Changed expectations in existing tests, fields only: `packages/schema/test/payees.test.ts` helper `p`
   (`has_rules: false`); `packages/schema/test/register.test.ts` and `register-export.test.ts` fixtures
   (`import_payee_name: null`).
10. Browser acceptance 5's "the rules after `Don't rename as`" is shown by Worker case 2.4 with the same request
    body, because a browser row is a dressed hand row and the server does the undo only on a real import.

## Found, not built

1. A `Renaming` card for transfer payees (the source shows one; a rule that turns an import into a transfer is its
   own piece of work).
3. Plan export and import do not carry rules.
4. Matched rows have no `Bank Import Details`.

## Built (EXF-885)

- **Descriptions.** The five transaction tools in `mcp/tools/transactions.ts` name `import_payee_name`;
  `update_transaction` says that changing the payee of an imported row writes the renaming rule, and
  `bulk_update_transactions` says its ops write none.
- **Learn when the new payee already has an older `is <name>` and another payee a newer one.** Chosen: the learn
  removes every other payee's live `is <name>` (same `match_text`, as the undo does, with a delete history row each)
  and adds `is <name>` to the new payee unless it has it. Reason: the owner's last correction must decide, and
  `pickRenameRule` takes the newest `is` rule; rewriting `created_at` of the owner's rule would falsify history,
  and keeping both rules leaves the answer to a timestamp. After any correction exactly one payee holds
  `is <name>`; all in the change's own batch, no extra D1 call.

## Out of scope

Rules on file import (EXF-518, EXF-531), `Combine and Rename` (EXF-512), `Categorization` (EXF-515), rules on
transfer payees, Undo.

## Acceptance

Real local server; each plan made through the API. Worker imports: `plaid-sync-helpers.ts`, the bank's answers
given by the test, no Plaid. Browser imported rows: hand rows dressed by `e2e/support/rename-rules-stub.ts` in
`transactionToApi`'s forms (`services/transactions.ts:41-62`: `import_id`, `imported_payee`, `bank_description`,
`import_payee_name` strings, `source "plaid"`, `matched false`, `match_details null`; the rest the server's).
`realClick`, `{ exact: true }`; behaviour "built from the ticket", not compared.

1. **Worker, import (EXF-467 1, 3, 4, 6)**
   1. Import `ZZ BANK CAFE 12`; PATCH its payee to a new `ZZ-TEST Coffee` (the register's edit) → rule `is ZZ BANK
      CAFE 12` on `ZZ-TEST Coffee` with a change_log row by the PATCH actor; the next import of that name has payee
      `ZZ-TEST Coffee`, `import_payee_name` `ZZ BANK CAFE 12`, log `rename_rule_id` set, actor `service:plaid`.
   2. `contains uber` on `ZZ-TEST Rides` → imports `UBER TRIP` and `Uber Eats Order` get `ZZ-TEST Rides`;
      `contains uber eats` on another payee does not match `EATS UBER` (words in order).
   3. Two payees with `contains zz shop`: the newer rule's payee wins; `is` on a third beats both.
   4. REST and MCP list, create, update, delete with change_log rows; refusals 403/404/409/422 with their words.
   5. A hidden payee's rule applies, the payee stays hidden; a deleted payee's rules no longer apply.
   6. `CAFÉ ZZ` matches `contains café`.
2. **Worker, rules made by themselves**
   1. (Fails first) Import `ZZ BANK CAFE 12`, rename the payee `ZZ Cafe` (PATCH payee), import a second row of the
      same name → payee `ZZ Cafe`; no payee `ZZ BANK CAFE 12` exists.
   2. No rule: payee cleared, made a transfer, a hand row, split lines, Match, Unmatch.
   3. A second learn to a third payee: that payee's rule is newest and wins.
   4. Undo: row renamed by `is` on `ZZ Cafe`; PATCH `{payee_name: "ZZ BANK CAFE 12"}` → `ZZ Cafe`'s `is` rule gone,
      payee `ZZ BANK CAFE 12` made; next import keeps that name. With `contains bank cafe` on `ZZ Other` → `is ZZ
      BANK CAFE 12` is added to `ZZ BANK CAFE 12`, and the next import keeps it.
3. **A row the owner set by hand is not moved:** import, PATCH payee `ZZ Mine`; `modified` with a new merchant
   name that a `contains` rule of `ZZ Other` matches → still `ZZ Mine`. An unapproved untouched import does follow.
4. **Delete:** deleting a payee (single and bulk) soft-deletes its rules with history rows; the replacement has
   none; with a failing statement appended to `buildPayeeDeleteBatch`, the payee, its rules and their history
   are unchanged.
5. **Browser:**
   1. Card: select `ZZ Cafe`; add `Contains` `zz cafe` with `+`, then `Is` `ZZ BANK CAFE 12` with Tab: two rows and
      the empty one; the list row's gear `Renaming rules applied`; the same `Is` again → `This payee already has
      this renaming rule`; `Remove renaming rule` twice → no rows (API agrees), no gear. Hidden payee: card;
      transfer: no `Renaming`; two selected, one with rules → the sentence. Tab reaches every control.
   2. Register: a dressed row with payee `ZZ Cafe` and `import_payee_name` `ZZ BANK CAFE 12` → the name's `title`
      `ZZ Cafe (Imported as ZZ BANK CAFE 12)`; a dressed row not renamed → its payee's name only.
   3. `Bank Import Details` (by mouse after hover, and by Tab + Enter) → the title, the statement text and
      `ZZ BANK CAFE 12`, the link `Don't rename as ZZ Cafe`; the link sends PATCH `{payee_name: "ZZ BANK CAFE
      12", approved: …}`; the row then reads `ZZ BANK CAFE 12`, its title has no `(Imported as`, and the reopened
      popover has no link.
   4. 1024×700: the card fits the pane; the popover lies inside the window.
6. **Counts** (`rename-rules-calls.test.ts`): one sync 13 D1 with rules on the plan; transaction edit 8 (learn and
   undo); payee rename 4 (with the rule made); payee list 3 for 10 and 100 payees with rules; rule list 3, create 3,
   update 4, delete 4.
7. **Tools:** 98; the four tools in `mcp-coverage/payees.ts`, `listedToolNames()` and `apiPaths()` include them.
8. **Light tests:** no file-wide time limit raised; no test seeds more than a few dozen rows.

### Looking (Tester: this is your main work)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh**
screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it. The report lists `state,
size, file, sentence`. **Three states, six screenshots, every one opened; take no others unless something looks
wrong.**

1. Manage Payees with a payee selected that has two rules, one `Is` and one `Contains`: the `Renaming` card with its
   two rows and the empty last row, and the gear icon on that payee's row in the list.
2. A register with an imported row whose payee was renamed by a rule, the pointer resting on its payee: the tooltip
   `<Payee> (Imported as <imported name>)`. (If the tooltip is the browser's own and cannot be in a screenshot,
   say so, give its text as read from the element, and take the screenshot of the row.)
3. The `Bank Import Details` popover open on that row.

(States 2 and 3 use `stubRenameRulesImports` from `e2e/support/rename-rules-stub.ts`. In this design the tooltip
of state 2 is the browser's `title`.)

## D1 calls (before → after)

One sync (2 accounts, 2 entries) 13 → 13 · transaction edit of an imported row's payee 8 → 8 · payee rename 4 → 4 ·
payee list 3 → 3 · payee delete 3/4 → 3/4 · new: rule list 3, create 3, update 4, delete 4.

## The order of the work (commit each part before the next)

1. The migration, the table, the repository, the matching function with its unit tests.
2. The operations, their tools, `has_rules`, the delete with its rules.
3. The import applies the rules, with its tests and counts.
4. The rules made by themselves (the row's edit, the payee's rename), with their tests and counts.
5. The `Renaming` card, the gear, the several-selected sentence, their spec.
6. The tooltip, `Bank Import Details`, `Don't rename as`, their spec.

If the Build runs long, parts 1 to 5 must be whole; the tooltip and `Bank Import Details` are then reported as not
done, with what is there.

## Manifest

touches: [apps/worker/migrations/20261116101800_payee_rename_rules.sql, apps/worker/src/db/schema/payee-rename-rules.ts, apps/worker/src/repositories/payee-rename-rules.ts, apps/worker/src/services/payee-rename-rules.ts, apps/worker/src/routes/payee-rename-rules.ts, apps/worker/src/mcp/tools/payee-rename-rules.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/services/payees.ts, apps/worker/src/mcp/tools/payees.ts, apps/worker/src/services/plaid-sync.ts, apps/worker/src/services/transactions.ts, apps/worker/src/repositories/transactions.ts, packages/schema/src/rename-rules.ts, packages/schema/src/payees.ts, packages/schema/src/transactions.ts, packages/schema/test/rename-rules.test.ts, packages/schema/test/payees.test.ts, packages/schema/test/register.test.ts, packages/schema/test/register-export.test.ts, apps/worker/test/rename-rules*.test.ts, apps/worker/test/rename-rules-helpers.ts, apps/worker/test/mcp-coverage/payees.ts, apps/worker/test/mcp-timestamps.test.ts, apps/web/src/payees/**, apps/web/src/api/payees.ts, apps/web/src/register/RegisterTable.tsx, apps/web/src/register/rename-rules-bank-import.tsx, apps/web/src/register/register.css, e2e/rename-rules*.spec.ts, e2e/support/rename-rules-stub.ts, e2e/support/rename-rules-seed.ts, docs/rename-rules-design.md, docs/rename-rules-spec.md, docs/rename-rules-polish.md, docs/README.md]
shared: []
migrations: 1
