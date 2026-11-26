# Make a Fresh Start (EXF-478)

Plan menu → Current Plan → Make a Fresh Start. The dialog asks for a new plan's name and one checkbox; Continue
copies the plan's structure into a new plan that starts today and renames the old plan as an archive.

`POST /api/v1/budgets/{id}/fresh-start` `{ name, stop_importing_in_archive?: true, today?: PlanDate }` → 201
`{ data: { new_budget_id, archived_budget_id } }`. MCP: `fresh_start_budget` (needs `confirm: true`). `today`
defaults to the Worker's UTC date; the web app sends `localToday()`.

## Decisions

| Topic | Rule |
|---|---|
| Name | Clash key `name.trim().toLowerCase()` against every **active** plan, the current plan included; deleted plans do not count. Text: "The plan name already exists." (inline in the dialog, 422 `plan_name_taken` from the API, a tool error from MCP). An empty or over-long name is 422 `plan_name_invalid`. |
| Archive name | `<old name> (Archived on <today>)`. The suffix is 25 characters; when the result would pass 100 characters the old name is cut to 75 and trailing spaces are trimmed. Only `name` and `updated_at` of the archive change (plus the unlinks below). |
| Not undoable | The change set holds a `create fresh_start` row. `services/undo.ts` refuses unknown entity types, so undoing it on either plan is 409 `undo_refused`; the web app registers no Undo. A copy of the old plan is the archive itself. |

### Copied and not copied

| Copied | Not copied |
|---|---|
| Budget row: `bank_environment`, formats, `expected_income`, `flag_names` | Transactions |
| Accounts: live ones, closed ones stay closed; `paired_category_id` remapped; `last_reconciled_at` null | `month_categories` (assigned amounts, future months too) |
| Category groups (hidden and the credit-card-payments kind included), categories (notes, hidden, kind, `account_id` remapped) | Past months' notes and target snoozes (before today's month) |
| Targets (all columns, `created_on` kept) | `import_tombstones` |
| Target snoozes and month notes from today's month on | `report_settings`, `account_import_settings`, `ui_state` |
| Payees (system ones too; fixed and default category remapped), rename rules | `file_imports`, `plan_imports` |
| Custom views (builtins too; `category_ids` remapped, in order) | |
| Scheduled transactions (transfers, splits; new `write_token`) and their lines | |

### Starting Balance

One per copied account, dated today, `cleared`, approved, payee = the new plan's `starting_balance` system payee
(created in the batch when the old plan had none), `inflow_to_ready_to_assign = startingBalanceFeedsReadyToAssign(type)`
(cash types only, the app's rule for every Starting Balance). Unlinked account: amount 0. Linked account: the bank
balance as "Add from bank" stores it (`bankBalanceToPlan`).

### Bank links

Two plans may link one bank account: `accounts_bank_account_link` is unique per budget
(docs/account-links-design.md), and `plaid-sync` imports into every plan that links the account
(`services/plaid-sync.ts`). So the new plan keeps every link (`import_start_date` = today, `link_missing_since` as it
was) and the checkbox decides the archive:

- **Ticked (default):** the archive's linked accounts get `bank_account_id`, `import_start_date` and
  `link_missing_since` set to null, with one `update account` change_log row each. Imports continue only in the new plan.
- **Unticked:** the archive keeps its links; both plans import.

The checkbox is always shown and enabled. A linked account whose `bank_accounts` row is gone is treated as unlinked:
no link in the new plan and a $0 Starting Balance.

### Archive schedules

The archive keeps its scheduled transactions, but they are dormant: the same statement that renames the archive
sets `budgets.archived_at` (additive nullable column; the migration also backfills archives made earlier from their
`fresh_start` change_log row), and the due-job's selection (`listDue`) skips plans with `archived_at` set. No
statement is added to the write batch, so the D1 counts do not move.

Chosen over ending the schedules as deletes: a deleted schedule drops out of the archive's Scheduled list and
cannot be entered by hand, and the already-made archives would stay unfixed. Here the schedules stay visible and
editable, **Enter Now still works by hand** in the archive (it does not go through the due-job), and the dates do
not advance by themselves. The nightly/six-hourly job simply never selects them.

## D1 plan

One read batch, then one write batch: two D1 calls whatever the plan's size.

- **Read** (`readSourceStmts`): the source row, the active plans' `(id, name)`, the live accounts left-joined to
  `bank_accounts`, and the ids of live groups, categories, payees, schedules and schedule lines.
- **Write** (`copyStmts`, about 25 statements, in foreign-key order): abort guard, new plan, archive rename,
  accounts, groups, categories, targets, snoozes, month notes, payees, the system payee, rename rules, views,
  schedules, schedule lines, Starting Balances, the unlink (ticked), then the change_log rows.
- **Id maps** for accounts, groups, categories, payees and schedules are generated in the service and bound as ONE
  JSON parameter each (`{old: new}`; accounts an array of `{old, new, amount, rta, bank}`), joined with `json_each`.
  A statement holds at most a handful of parameters and no `IN` list is built from rows; a 100-row map is about
  8 KB of bound data, not SQL text. Rows without references of their own get their ids in SQL (`randomblob`).
- **Abort guard:** the first statement inserts a `change_log` row with a null `actor` (so it fails the batch)
  when the source row, the active plans' ids and names, any mapped table's live rows, or the linked accounts differ
  from what was read. The service answers 409. Nothing is written.
- Change log: new plan `create budget`, `create fresh_start`, one `create transaction` per Starting Balance;
  archive `update budget` (the rename), `create fresh_start`, and one `update account` per unlink.

## Tests

`packages/schema/test/fresh-start.test.ts` (name helpers); worker `fresh-start.test.ts` (the copy, 422/404, change_log,
undo refusal, race guard, entering), `fresh-start-links.test.ts` (Plaid stubbed), `fresh-start-mcp.test.ts` (REST = MCP,
confirm), `fresh-start-calls.test.ts` (constant calls and batch sizes, 10 vs 100); `e2e/fresh-start.spec.ts`
(AC1 to AC5). `docs/README.md` is not updated by this change (outside its scope); link this page from it later.
