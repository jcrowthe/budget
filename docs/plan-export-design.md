# Export Plan, the API half: design (EXF-476)

`GET /api/v1/budgets/{budget_id}/export` and the MCP tool `export_budget` return the whole plan as a zip of two
delimited files (Plan and Register) in the layout a later ticket (EXF-477) imports. **This Build has no screen
and changes no file under `apps/web/` or `e2e/`**: the plan menu's Export Plan entry, its dialog and "Don't show
again" (criteria 1 and 8) stay open on the ticket. No migration, no shared module, no dependency, no history entry.

## Source

The source app is **not opened** in this Build (the plan menu lists the owner's other plans). The reference is the
ticket's text, sections "File names", "Encoding", "Amounts", "Plan file" and "Register file", which record the
source's files byte by byte; its samples are made up. Where the ticket is silent, the decisions below (from the
Lead's brief and comments) decide. There is no study folder and no screenshot.

## Approach

- **One pure module**, `packages/schema/src/plan-export.ts`: the format (amounts, dates, delimiter, extension),
  the text-field encoder with the formula guard, the file assembly (BOM, CRLF), the names, the Plan rows and the
  Register rows (order, splits). Unit-tested in `packages/schema/test/plan-export.test.ts` with the ticket's cases.
- **One service**, `apps/worker/src/services/plan-export.ts` (`exportPlan`): a fixed set of reads, then the pure
  module, then `storeZip`. The month figures come from `getPlanMonths` in `services/months.ts` (the Plan page's own
  engine call, read only); nothing re-derives Assigned, Activity or Available.
- **No repository file**: every read already exists (budgets, month range, months, accounts, transactions, lines,
  schedules repositories and services), called read-only.
- **Route** `apps/worker/src/routes/plan-export.ts` and **tool** `apps/worker/src/mcp/tools/plan-export.ts`, both
  collected by the existing globs (`app.ts` and `mcp/server.ts` do not change).
- **Zip**: `storeZip` in `packages/schema/src/zip.ts` gets one optional third argument, the modification time.

## Format (note 4)

```ts
interface PlanFormat {
  currency_symbol: string;                         // "$"
  symbol_placement: "before" | "after" | "none";   // Currency Placement; "none" = Don't show
  decimal_separator: string;                       // "." or ","
  group_separator: string;                         // kept for EXF-468; never written in exports
  decimal_digits: number;                          // 0..3
  date_format: string;                             // tokens YYYY, MM, DD, e.g. "MM/DD/YYYY", "DD.MM.YYYY"
}
DEFAULT_PLAN_FORMAT = { "$", "before", ".", ",", 2, "MM/DD/YYYY" }
exportFormat(f: PlanFormat): { amount(m: number): string; date(iso: string): string;
                               delimiter: "," | "\t"; extension: "csv" | "tsv" }
```

- **Amount**: `|m|` rounded half away from zero to `decimal_digits` (integer arithmetic on milliunits), whole part
  without group separators, then `decimal_separator` and the digits (none when 0 digits). Symbol before
  (`$17.34`), after (`45.00€`) or none (`45.00`). A negative that is non-zero after rounding gets ASCII `-` in front
  of everything: `-$120.00`, `-45.00€`. A value that rounds to zero has no sign (`$0.00`).
- **Date**: `YYYY`, `MM`, `DD` of the ISO date replace the tokens of `date_format`.
- **Delimiter**: TAB and `tsv` when `decimal_separator` is `,`; otherwise `,` and `csv`.
- **Today the service always passes `DEFAULT_PLAN_FORMAT`** (plans have no format settings). **EXF-468** plugs in by
  reading the plan's settings into a `PlanFormat` in `exportPlan` (one line); **EXF-480** by passing the plan's
  flag names to `registerFile` (its `flagLabel` argument, today `FLAG_NAMES` from `@budget/schema/transactions`:
  `Red`, `Orange`, `Yellow`, `Green`, `Blue`, `Purple`).

## Encoding (both files)

- `"﻿"` + header + rows, joined with `"\r\n"`, **no** line end after the last row. Bytes are UTF-8 (`utf8` of
  `zip.ts`); emoji kept. Built from an array of lines and one `join` (no repeated string concatenation).
- **Text field**: when the value matches `/^\s*[+\-=@]/`, its leading whitespace is removed and `\` is put in front
  (`=SUM` → `\=SUM`, `  +1` → `\+1`); then `"` + value with every `"` doubled + `"`. Line breaks inside a value are
  kept as they are (inside the quotes). Every text column, header included, goes through it.
- **Amount fields** are never quoted.

## Names (note 5)

- `SafeName` = plan name with every run of characters outside `[A-Za-z0-9]` replaced by one space (no trim:
  `"ZZ-TEST Ex/port: 7"` → `"ZZ TEST Ex port 7"`, `"a!"` → `"a "`).
- **Stamp**: optional query `now` = the caller's local `YYYY-MM-DDTHH:mm` (named like the `today` parameter of the
  scheduled-transactions operations): a real calendar date, year 1900–2199, hours 00–23, minutes 00–59, else 422.
  Without it, the server's UTC time to the minute. Stamp text `YYYY-MM-DD HH-mm`.
- Zip `Budget Export - <SafeName> as of <stamp>.zip`; entries, in this order and with no folder,
  `<SafeName> as of <stamp> - Plan.<ext>` and `<SafeName> as of <stamp> - Register.<ext>`.
- The same `now` is the zip entries' modification date and time, and its date is the export's **today**: the
  current month and the targets' today for `getPlanMonths`.
- `Content-Disposition: attachment; filename="<zip name>"` (SafeName and stamp are ASCII without quotes).

## Zip (note 3)

`storeZip(files, date, time?)`: `time` is `HH:mm` (optional); it writes the MS-DOS time
`(h << 11) | (m << 5)` into the local and central headers. Omitted, the field stays 0, so the Reflect exports'
bytes and `packages/schema/test/zip.test.ts` do not change (a new case in that test covers `time`).

## Plan file (note 6)

Header `"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"`.

- **Months**: `first = min(month-range first_month, current)` to `last = max(current, last_assigned_month)`, both
  from `getMonthRange` (the Plan page's navigation facts: the plan's creation month, first assignment, first note,
  first transaction), `current` = the month of `now`'s date. So money assigned ahead is written; empty future months
  after the last assignment are not.
- **Per month**, from `getPlanMonths(env, id, months, today)` (one read of the plan, the engine in memory): walk the
  groups and categories in the read model's order (the screen order: the Credit Card Payments group first, then
  groups by sort, categories by sort). A category is **hidden** when it or its group is hidden. All visible
  categories first, then all hidden ones in the same walk order, written with group `Hidden Categories`.
- Row: `Mmm YYYY` (English short month), `<Group>: <Category>`, group, category, then Assigned, Activity, Available
  of that month as amounts. No group totals, no Ready to Assign row, no Uncategorized row.
- The Credit Card Payments group is written like any other, one payment category per card (EXF-532 keeps one per
  credit account).
- **Deleted categories and groups are not written**: the read model holds active ones only. A category with history
  can only be deleted by moving its transactions and assignments elsewhere, so no figure is lost.

## Register file (note 7)

Header `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"`.

- **Rows**: every live transaction of every non-deleted account (open, closed, tracking), plus every live schedule
  once at its `date_next`. A split parent is not written; its live lines are, in `split_index` order. **Not
  written**: deleted transactions, transactions of a deleted account, deleted schedules, and **schedules on a closed
  account** (they are not listed, entered or found while the account is closed: scheduled-transactions design).
  Unapproved transactions are written like any other.
- **Order**: date descending; same date, signed amount ascending (largest outflow first … largest inflow last);
  then the account's position (`sort_order`, id), then creation time, then id. A split is one block placed by the
  parent's amount, its lines in split order. A schedule sorts by `date_next` and its amount, after transactions on
  full ties.
- **Columns**: Account = account name. Flag = `flagLabel(color)` or `""` (a line takes its parent's). Date = the
  format's date (parent's for lines). Outflow = `amount(-a)` when `a < 0` else `amount(0)`; Inflow = `amount(a)` when
  `a > 0` else `amount(0)`. Cleared `Cleared` / `Uncleared` / `Reconciled` (parent's for lines; schedules always
  `Uncleared`).
- **Payee**: a transfer (row or line with `transfer_account_id`) → `Transfer : <other account's current name>`; a
  system payee → `SYSTEM_PAYEE_NAMES[system]` (`starting_balance` → `Starting Balance`, `manual_adjustment` →
  `Manual Balance Adjustment`, `reconciliation_adjustment` → `Reconciliation Balance Adjustment`), exhaustive, no
  fallback; D1 calls still 16; else the payee's name, or `""`. A line without a payee takes the parent's payee text.
- **Category** (columns 5–7): the account is a tracking account → empty; `inflow_to_ready_to_assign` with no category →
  `Inflow: Ready to Assign`, `Inflow`, `Ready to Assign`; no category (uncategorized, on-plan↔on-plan transfers, a
  card's Starting Balance) → empty; a hidden category (its own or its group's flag) → `Hidden Categories: <name>`,
  `Hidden Categories`, `<name>`; else `<group>: <name>`, group, name. Names and hidden flags come from the month read
  model already loaded; a category absent from it (deleted) keeps the names its row joins.
- **Memo**: the memo or `""`; a line's memo is `Split (<i>/<n>) <line memo or "">` (trailing space when empty; the
  parent's memo is not used), i = 1-based position among the live lines, n = their count.

## Loan account fields (EXF-991)

The files have no account rows, so a loan's fields ride on the Register as **six extra trailing columns** (not a
third file: a third entry would break the two-entry layout the dialog and `e2e/plan-export-dialog.spec.ts` rely on).
Header after `Cleared`: `"Account Type","Interest Rate","Minimum Payment","Escrow Amount","Paired Category Group","Paired Category"`.

- **Only when the plan has a loan account** (type `mortgage`, `autoLoan`, `studentLoan`, `personalLoan`,
  `medicalDebt`, `otherDebt`). A plan without one is written byte for byte as before, so every older consumer and
  test sees the 11-column header.
- Written on **every row of the loan's account** (the Register order is by date, so no row is "first"); the other
  accounts' rows have the six cells empty. Account Type is the type key, Interest Rate the stored decimal string
  (`6.5`, never localised), Minimum Payment and Escrow Amount in the plan's amount format, the pairing as the group and
  category names the Plan file writes (a hidden category or group: group `Hidden Categories`). A pairing whose
  category is gone is written empty.
- A loan with no transaction has no row and so is not in the file (as every account without a row).
- No new D1 call: the accounts are already read.

## Payee renaming rules (EXF-885 5a)

A plan's rules (`payee_rename_rules`: payee name, kind `is`/`contains`, text, order of creation) ride on the Register
as **three more trailing columns** after the loan columns: `"Rename Payee","Rename Kind","Rename Text"`.

- **Only when the plan has a live rule** (of an ordinary payee, hidden ones included; transfer payees' rules are not
  written, as the import does not apply them). A plan with none is written byte for byte as before.
- **Rows after the last transaction**, one per rule, oldest first (`created_at`, then id): every cell before the rule
  columns is `""`, then the payee's name, the kind and the text (the formula guard applies to the name and the text).
  A rule is not a property of any transaction (a payee can have more rules than rows, or no row), so it cannot ride on
  the transaction rows as the loan fields do.
- **Why this placement.** A third file breaks the two-entry layout. Rows in the Plan file have no place for a payee.
  A delimited section inside the Register (a blank line, a title row) is not valid for the file's readers: the
  reader skips blank lines and takes every other row as a transaction. Columns under a different header are the one
  way a reader can be told apart: an importer that does not know the header refuses the file ("not recognised") rather
  than reading a rule as a transaction, the same behaviour as for the loan columns (EXF-991). The current importer
  reads all four headers (base, loan, rules, loan and rules).
- **One more D1 call** (one set query for the rules; 19 in all, pinned in `plan-export-calls.test.ts`).

## API (note 9)

| | Request | Response |
|---|---|---|
| REST | `GET /budgets/{budget_id}/export?now=YYYY-MM-DDTHH:mm` | 200 `application/zip`, `Content-Disposition`; 404 plan; 422 bad `now` |
| MCP | `export_budget { budget_id, now? }` | `{ file_name, content_base64, bytes }` (bytes = zip length) |

Read-only: no `change_log` row, no `Idempotency-Key`. Coverage: `"GET /budgets/{budget_id}/export": { tool:
"export_budget" }` in `apps/worker/test/mcp-coverage/budgets.ts`; one `CALLS` line in
`apps/worker/test/mcp-timestamps.test.ts` (the result has no timestamp).

## D1 calls and size (note 8)

`exportPlan` makes **16** D1 calls whatever the plan's size: `budgets.findActive` (1), `getMonthRange` (2),
`getPlanMonths` (9: its plan check and its eight set reads; the card flows query of EXF-537 made it 9, was 8), accounts with closed ones (1), `listDetailForPlan` (1),
`listLines` for the whole plan (1), `scheduledRepo.listForPlan` (1). The engine runs per month in memory on the one
loaded input. Every join of rows to lines, accounts and categories is a `Map` lookup; the sort is one
`Array.prototype.sort`. A counting test asserts 16 for a small plan and for 1,000 transactions over 24 months.

Largest plan tested (`plan-export-calls.test.ts`, in the Worker test pool, local D1): 1,080 transactions (1,000 plain, 10 splits of three lines, 20 transfer pairs), 24 months, 51 categories, 4 accounts: 15 calls then (16 since EXF-537 added the card flows read), handler 97 ms, zip 210,524 bytes. Fixture F (the small plan) also makes 16.

## Downstream effects

- EXF-477 (import) reads exactly these bytes. EXF-468 and EXF-480 plug in as said under Format.
- The other open Builds (month read model `payment` object, a payments operation) do not change the figures or the
  functions this export calls; at a rebase keep every line of `mcp-timestamps.test.ts` and of the coverage file.

## Out of scope

The plan menu entry, dialog and "Don't show again" (criteria 1 and 8); plan format settings (EXF-468); flag names
(EXF-480); targets and category notes (not exported, ticket); import (EXF-477).

## Acceptance

All cases are Worker or unit tests (no compare case: nothing is shown). Fixture **F**, built through REST in the
test with fixed dates: plan `ZZ-TEST Ex/port: 7`; default groups deleted; groups `Bills` (`Rent`), `Everyday`
(`Groceries 🛒`, `Fun "x", y`), `Old` hidden (`Hobby`), and `Old Hobby` hidden alone in `Bills`; accounts `Main
Checking` (Starting Balance $1000.00 on 2026-09-01), `Rainy Day` savings ($50.00 on 2026-09-01), `Sample Visa`
credit card (Starting Balance −$25.00), `House` tracking asset ($2000.00), `Old Cash` cash ($10.00, closed after its rows: a Manual Balance
Adjustment); assignments Sep `Rent` $900.00, `Groceries 🛒` $200.00, `Fun "x", y` $50.00, `Hobby` $20.00; Oct `Rent` $900.00; Dec `Groceries 🛒` $50.00; transactions as listed in case 6;
`now=2026-11-16T09:05`.

1. **Names and entries (criterion 2).** GET `/api/v1/budgets/<F>/export?now=2026-11-16T09:05` → 200,
   `Content-Type: application/zip`, `Content-Disposition: attachment; filename="Budget Export - ZZ TEST Ex port 7 as of
   2026-11-16 09-05.zip"`. Read back (local headers, central directory, end record): exactly two entries,
   `ZZ TEST Ex port 7 as of 2026-11-16 09-05 - Plan.csv` then `… - Register.csv`; each CRC-32 matches its data; DOS
   date 2026-11-16 and time 09:05. Without `now`, the stamp is the UTC minute of the call (between the minutes read
   before and after).
2. **Encoding (criterion 3).** Each entry starts `EF BB BF`; splitting outside quotes gives CRLF only; the last byte
   is not LF; headers are exactly the two above; amount fields have no quotes, text fields all do.
3. **TSV (criterion 4, unit).** `exportFormat({ "€", "after", ",", ".", 2, "DD.MM.YYYY" })` gives delimiter TAB,
   extension `tsv`, `120,50€`, `-45,00€`, `30.11.2026`; file names from it end `- Plan.tsv`, `- Register.tsv`;
   `registerFile` gives the ticket's line `"Konto"⇥""⇥"30.11.2026"⇥…⇥120,50€⇥0,00€⇥"Cleared"`.
4. **Amounts (unit).** Default format: 17340 → `$17.34`, -120000 → `-$120.00`, 200000000 → `$200000.00`, 0 → `$0.00`,
   17345 → `$17.35`, -4 → `$0.00`; after: `45.00€`, `-45.00€`; none: `45.00`; 0 digits: `$17`; 3 digits: `$17.340`.
5. **Plan file (criterion 5).** For F the Plan entry equals, byte for byte, a text written by hand in the test:
   months Sep, Oct, Nov, Dec 2026 (Dec because of the assignment ahead); per month `Credit Card Payments: Sample Visa`,
   `Bills: Rent`, `Everyday: Groceries 🛒`, `Everyday: "Fun ""x"", y"` (text quoting), then `Hidden Categories: Old
   Hobby`, `Hidden Categories: Hobby`; no deleted default category appears. The amounts are worked out by hand, and
   the test also checks each row's three amounts against `GET /months/{month}` for that category (the Plan page).
6. **Register file (criteria 6 and 7).** For F the Register entry equals a hand-written text. F's rows and what they
   prove: a split on 2026-10-14 in Main Checking, red flag, cleared, payee `Corner Shop`, lines −30.00 Groceries memo
   `food` and −12.50 Fun no memo → two rows `Split (1/2) food`, `Split (2/2) ` with parent's flag, date, cleared; a
   transfer −200.00 Main Checking → Rainy Day on 2026-10-10, reconciled → `Transfer : Rainy Day` and `Transfer : Main
   Checking`, empty categories; an income +2500.00 RTA on 2026-10-05, memo `=bonus` → `\=bonus`; on 2026-10-20 three
   rows −5.00, −60.00, +7.00 → −60, −5, +7; a card purchase −40.00 Groceries on Sample Visa; a House row (tracking)
   +100.00 with empty category; a row in hidden `Hobby` → `Hidden Categories: Hobby`; an unapproved row (written); a
   deleted row (absent); memo `a "q", b⏎c 🛒` (quoted, line break kept); a schedule −900.00 Rent next 2026-12-01 memo
   `monthly` → `"Uncleared"` at the top; a schedule on Old Cash before closing (absent); Starting Balance rows (cash
   ones `Inflow: Ready to Assign`, the card's none, the tracking one none); Old Cash's `Manual Balance Adjustment`.
7. **Formula guard (unit).** `textField("=x")` → `"\=x"`, `"  +1"` → `"\+1"`, `"@a"` → `"\@a"`, `"-"` → `"\-"`,
   `"a=b"` → `"a=b"`, `'say "hi"'` → `"say ""hi"""`.
8. **MCP.** `export_budget { budget_id: F, now: "2026-11-16T09:05" }` → `file_name` equals case 1's name,
   `content_base64` decodes to bytes equal to the REST body, `bytes` = their length.
9. **Read-only and errors.** `change_log` rows of F are the same count before and after cases 1 and 8; unknown plan →
   404 (REST) / tool error; `now` = `2026-11-16 09:05`, `2026-02-30T10:00`, `2026-11-16T24:00` → 422.
10. **D1 calls.** Counting env: 16 calls for F and 16 for a plan with 1,000 transactions over 24 months (seeded with
    SQL batches), 40 categories and 4 accounts; the test logs `plan-export: <n> transactions, <m> months, <ms> ms`.
11. **Zip.** `zip.test.ts`'s existing cases pass unchanged; a new case: `storeZip(files, "2026-11-15", "19:51")`
    has time `(19 << 11) | (51 << 5)` at offset 10 and in the central header, and the same files without `time`
    give the bytes of the existing case.
12. **Surface.** `apiPaths()` contains `/api/v1/budgets/{budget_id}/export`; `listedToolNames()` contains
    `export_budget`; `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps`, `openapi` and `mcp` tests pass.

## Manifest

touches: [packages/schema/src/plan-export.ts, packages/schema/test/plan-export.test.ts, packages/schema/src/zip.ts, packages/schema/test/zip.test.ts, apps/worker/src/services/plan-export.ts, apps/worker/src/routes/plan-export.ts, apps/worker/src/mcp/tools/plan-export.ts, apps/worker/test/plan-export*.test.ts, apps/worker/test/plan-export-helpers.ts, apps/worker/test/mcp-coverage/budgets.ts, apps/worker/test/mcp-timestamps.test.ts, docs/plan-export-design.md, docs/plan-export-spec.md, docs/README.md]
shared: []
migrations: 0
