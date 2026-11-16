# Plan export design (EXF-476, Worker half)

`GET /api/v1/budgets/{budget_id}/export` and MCP `export_budget` return the whole plan as a ZIP of two
delimited files: Plan (every category of every month) and Register (every transaction). EXF-477 imports
this format, so the bytes matter. **Not in this Build:** the plan menu entry, the dialog and "Don't show
again" (criteria 1 and 8); EXF-476 stays open for them. Nothing under `apps/web/` or `e2e/` changes.

## Source

No source study; nobody opened the source app for this Build (Lead's instruction: its plan menu lists the
owner's other plans). The reference is EXF-476's text (sections File names, Encoding, Amounts, Plan file,
Register file, and its made-up samples). Where the ticket is silent this document decides (**decided**);
**not observed** marks what cannot be checked until the dialog half is built.

## Approach

- **Pure text** in `packages/schema/src/plan-export.ts`: format function, file names, field quoting, the
  two file writers. Tested byte for byte against hand-written text.
- **Reads** in `apps/worker/src/services/plan-export.ts`: a fixed number of D1 calls; month figures from
  the engine through the existing `getPlanMonths` (no arithmetic re-derived); strings encoded with
  `TextEncoder`; zipped with the existing `storeZip`.
- **ZIP container**: `packages/schema/src/zip.ts` (`storeZip`, written for the Reflect exports) already
  does what note 3 asks with no dependency: stored entries (method 0), CRC-32, UTF-8 name flag `0x0800`,
  local headers, central directory, end record. Its one gap is the modification time (always 00:00): it
  gains an optional third argument `time = "00:00"` (`"HH:mm"`, DOS time `h<<11 | m<<5`), so the Reflect
  exports' bytes and `zip.test.ts` are unchanged. The Workers runtime has no built-in ZIP writer
  (`CompressionStream` writes gzip/deflate streams, not a container).
- Routes and tools are collected by globs: one new route file, one new tool file. No migration, no shared
  module, no `package.json` change.

## The format (pure)

### Plan format, default, plug points (note 4)

```ts
interface PlanFormat {
  currency_symbol: string;                        // "$", "€"
  symbol_placement: "before" | "after" | "none";  // "none" = Don't show
  decimal_separator: string;                      // "." or ","
  group_separator: string;                        // for EXF-468; never written
  decimal_digits: number;                         // 0..3
  date_format: string;                            // tokens YYYY, MM, DD: "MM/DD/YYYY", "DD.MM.YYYY"
}
DEFAULT_PLAN_FORMAT = { "$", "before", ".", ",", 2, "MM/DD/YYYY" }  // US dollars, 123,456.78
exportFormat(f): { delimiter: "," | "\t"; extension: "csv" | "tsv";
                   amount(milli: number): string; date(iso: string): string }
```

- Delimiter TAB and `tsv` when `decimal_separator === ","`, else `,` and `csv`.
- Amount: `Math.round(|m| / 10^(3-d))` split into units and `d` decimals with the plan's separator, no
  grouping; symbol before, after or none; ASCII `-` in front only when the rounded value is non-zero (never
  `-$0.00`). `$0.00`, `$17.34`, `$200000.00`, `-$120.00`, `45.00€`, `-45.00€`, `120,50€`.
- Date: the tokens of `date_format` replaced by the ISO date's parts.
- **EXF-468** plugs in at one service function `planFormatOf(plan): PlanFormat`, returning
  `DEFAULT_PLAN_FORMAT` today. **EXF-480**: `registerFile(…, flagNames)` writes
  `flagNames[color] ?? FLAG_NAMES[color]` (`Red` … `Purple`), `""` for no flag; the service passes `{}`.

### Fields and lines

- Text field: formula guard first (first character other than U+0020 is `+ - = @` → leading spaces
  dropped, `\` in front: `=x` → `\=x`), then wrapped in `"` with inner `"` doubled. Line breaks and emoji
  are written as stored.
- Amount fields are never quoted (TSV too).
- File: a BOM U+FEFF (EF BB BF in UTF-8), header, rows, joined by `\r\n`, nothing after the last row. Rows are
  pushed to an array and joined once (linear).

### File names and the stamp (note 5)

- `safeName(name)`: each run of characters outside `[A-Za-z0-9]` becomes one space; no trim, as the
  ticket's rule is written (`"Plan ✓"` → `"Plan "`; **decided**, **not observed**).
- Query parameter **`now`**: the caller's local date and time `YYYY-MM-DDTHH:mm`, named like the `today`
  parameter of the scheduled-transaction operations. A real calendar date, hours 00–23, minutes 00–59;
  else 400 `bad_request`. Absent: the server's UTC time (`new Date().toISOString().slice(0, 16)`).
- Stamp: `now` with `T` → space and `:` → `-` (`2026-11-15 19-51`). One value names all three files:
  `Budget Export - <SafeName> as of <stamp>.zip`; entries (no folder, this order)
  `<SafeName> as of <stamp> - Plan.<ext>` and `<SafeName> as of <stamp> - Register.<ext>`.
- The ZIP's DOS date and time come from `now`; its month is the current month; its date is the engine's
  `today`.

### Plan file (note 6)

Header `"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"`.

- **Months**: from `getMonthRange(…).first_month` through the later of the month of `now` and
  `last_assigned_month` (**decided**: the brief says "to the current month", but money assigned to a
  future month would be lost to the importer; with no future assignment it is the current month, as the
  ticket observed). If `first_month` is later, the range is the last month alone.
- **Figures**: `getPlanMonths(env, id, months, today)`, one `MonthDetail` per month. Its group order
  (Credit Card Payments first, then `sort`) and category order are the grid's. Assigned, Activity,
  Available are the engine's per-category values as they are.
- **Rows of a month**: the visible categories (neither it nor its group hidden) in group then category
  order; then the hidden ones (it or its group hidden) in the same order, with group `Hidden Categories`.
  Columns `"Mmm YYYY"` (English), `"<Group>: <Category>"`, `"<Group>"`, `"<Category>"`, three amounts. No
  group totals, no Ready to Assign row, no Uncategorized row.
- **Deleted categories and groups are not written** (**decided**). The engine leaves them out
  (`listActive`) and nothing is lost: a category with history is deleted only with `reassign_to`, whose
  batch moves its transactions and merges its `month_categories` into the target (`category-delete.ts`);
  a payment category is deleted only with no money and no transactions. Every figure the importer needs
  is on an active category.

### Register file (note 7)

Header `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"`.

- **Written**: every live transaction of every live account (closed and tracking included) that is not a
  split parent; unapproved ones too.
- **Splits**: parent not written; each live line is a row numbered `i/n` in `split_index` order. Memo
  `Split (<i>/<n>) <line memo>` (trailing space when the line has none; the parent's memo is not used);
  payee the line's, else the parent's; category and amount the line's; account, flag, date, cleared the
  parent's.
- **Transfers**: each side its own row in its own account, payee `Transfer : <other account's current
  name>`; a transfer split line likewise.
- **Scheduled**: each live schedule on an open account once, at `date_next`, `Uncleared`, with its flag,
  payee, category and memo. A closed account's schedules are not written (**decided**: they are already
  left out of listing and posting by `listForPlan` and never become transactions).
- **Not written** (**decided**): soft-deleted transactions and lines; transactions of a soft-deleted
  account (the engine ignores them too, and an account is deletable only when its Starting Balance, deleted
  with it, is all it holds).
- **Payee**: transfer → `Transfer : <name>`; system `starting_balance` → `Starting Balance`;
  `manual_adjustment` or `reconciliation_adjustment` → `Manual Balance Adjustment`; else the name or `""`.
- **Category columns**, first rule that applies:
  1. tracking (off-budget) account → `"","",""`;
  2. transfer between two on-budget accounts → `"","",""`;
  3. no category, to Ready to Assign → `"Inflow: Ready to Assign","Inflow","Ready to Assign"`;
  4. no category → `"","",""`;
  5. category or its group hidden → `"Hidden Categories: <name>","Hidden Categories","<name>"`;
  6. else `"<Group>: <Category>","<Group>","<Category>"` (a deleted category keeps its stored name;
     unreachable through the app today).
- **Amounts**: Outflow `amount(-a)` if `a < 0` else `amount(0)`; Inflow `amount(a)` if `a > 0` else
  `amount(0)`. Cleared `Cleared` / `Uncleared` / `Reconciled`.
- **Sort**, one sort of the finished rows: date newest first; signed amount ascending; then, for a
  deterministic order, account sort order, transaction or schedule id, split index. Split lines sort as
  rows; split order only breaks ties (**decided**: the ticket's rule speaks of rows; its sample agrees).

## REST and MCP

- `GET /budgets/{budget_id}/export?now=` (`routes/plan-export.ts`): 200 `Content-Type: application/zip`,
  `Content-Disposition: attachment; filename="<zip name>"` (ASCII by construction); 404 unknown or deleted
  plan; 400 bad `now`. Read-only: no `change_log` row, no `Idempotency-Key`.
- `export_budget({ budget_id, now? })` (`mcp/tools/plan-export.ts`): same service; returns
  `{ file_name, content_base64, bytes }` (`bytes` = ZIP length; base64 built in 32 KB chunks, joined once).
  Its description says what the two files hold and what `now` is.
- Coverage: `"GET /budgets/{budget_id}/export": { tool: "export_budget" }` in
  `test/mcp-coverage/budgets.ts`; one `CALLS` line in `test/mcp-timestamps.test.ts` (every tool is listed
  there; at a rebase keep both sides).

## D1 calls and size (note 8)

**15 D1 calls whatever the size**: `budgets.findActive` (1), `getMonthRange` (2), `getPlanMonths` (8:
plan, groups, categories, assignments, notes, activity, targets, snoozes), and four set reads in the new
`repositories/plan-export.ts`: live transactions and lines on live accounts (with account, payee and
transfer-account columns), every category of the plan with its group (deleted included, for labels), the
accounts (sort order), and `scheduledRepo.listForPlan`. Months are computed in memory. `getPlanMonths`
runs `computeMonth` per month from the first month, so engine time grows with months² (a cost of
`packages/core`, out of bounds); text and ZIP are linear. `plan-export-calls.test.ts` expects 15 for a
small plan and for 1,000 transactions over 24 months.

Largest plan tested and handler time, filled in by the Implementer:

| Plan | Months | Transactions | D1 calls | Handler time (local) |
|---|---|---|---|---|
| fixture F | 2 | 14 | 15 | _measured_ |
| large | 24 | 1,000 | 15 | _measured_ |

## Downstream effects

EXF-477 reads these files; EXF-468 replaces `planFormatOf`; EXF-480 passes `flagNames`; the web half of
EXF-476 downloads `GET …/export?now=<local time>`; `storeZip` gains an optional argument, callers
unchanged.

## Out of scope

The dialog, menu entry and "Don't show again"; plan formats and flag names as settings; targets and
category notes (the ticket says they are not exported); any import.

## Acceptance

Worker and package tests; no screen, no compare case.

**Fixture F** (`test/plan-export-fixture.ts`, built with the services):

- Plan `ZZ-TEST Export: Plan #1 <h>` (`<h>` = 8 random hex); its default groups deleted (no history);
  `created_at` set to `2026-10-01T00:00:00.000Z` by a direct UPDATE.
- Groups in order: Bills (Rent), Everyday (`Groceries 🛒`), Fun (Games, Old Hobby hidden); Credit Card
  Payments is automatic.
- Accounts in order, Starting Balances dated 2026-10-01: Main Checking (checking) +1000.00, Rainy Day
  Savings (savings) +500.00, Sample Visa (creditCard) 100.00 owed, Old Car (otherAsset, tracking)
  +3000.00, then closed with `today` 2026-11-15 (adds −3000.00 `Manual Balance Adjustment`, memo
  `Closed Account`).
- Assigned: Oct Rent 900.00, Groceries 300.00; Nov Rent 900.00.
- Transactions: 10/03 Main Checking, Landlord, Rent, −900.00, memo `monthly`, cleared · 10/20 Sample
  Visa, Corner Shop, Groceries, −40.00, uncleared · 10/25 Main Checking, Corner Shop, Groceries, −80.50,
  cleared · 11/05 Main Checking, Employer, Ready to Assign, +2500.00, memo `=bonus`, flag purple, cleared
  · 11/10 transfer 200.00 Main Checking → Rainy Day Savings, both sides then `reconciled` by direct UPDATE
  · 11/12 Main Checking, payee `Shop "Q", Ltd`, Old Hobby, −5.00, memo `line one` LF `line two 🎉`,
  uncleared · 11/13 Main Checking −1.00, then deleted · 11/14 Main Checking split, Corner Shop, flag red,
  cleared: line 1 Groceries −30.00 memo `food`, line 2 Games −12.50 no memo · 11/14 Main Checking, Refund
  Shop, Groceries, +10.00, cleared.
- Schedule: Main Checking, Landlord, Rent, −900.00, monthly, memo `monthly`, `date_next` 2026-12-01.
- Export: `GET …/export?now=2026-11-15T19:51`.

**Expected Plan file** (after the BOM; CRLF between lines, none after the last):

```
"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"
"Oct 2026","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa",$0.00,$40.00,$40.00
"Oct 2026","Bills: Rent","Bills","Rent",$900.00,-$900.00,$0.00
"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$300.00,-$120.50,$179.50
"Oct 2026","Fun: Games","Fun","Games",$0.00,$0.00,$0.00
"Oct 2026","Hidden Categories: Old Hobby","Hidden Categories","Old Hobby",$0.00,$0.00,$0.00
"Nov 2026","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa",$0.00,$0.00,$40.00
"Nov 2026","Bills: Rent","Bills","Rent",$900.00,$0.00,$900.00
"Nov 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$0.00,-$20.00,$159.50
"Nov 2026","Fun: Games","Fun","Games",$0.00,-$12.50,-$12.50
"Nov 2026","Hidden Categories: Old Hobby","Hidden Categories","Old Hobby",$0.00,-$5.00,-$5.00
```

**Expected Register file** (the 11/12 memo holds a raw LF):

```
"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
"Main Checking","","12/01/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Uncleared"
"Old Car","","11/15/2026","Manual Balance Adjustment","","","","Closed Account",$3000.00,$0.00,"Cleared"
"Main Checking","Red","11/14/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","Split (1/2) food",$30.00,$0.00,"Cleared"
"Main Checking","Red","11/14/2026","Corner Shop","Fun: Games","Fun","Games","Split (2/2) ",$12.50,$0.00,"Cleared"
"Main Checking","","11/14/2026","Refund Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","",$0.00,$10.00,"Cleared"
"Main Checking","","11/12/2026","Shop ""Q"", Ltd","Hidden Categories: Old Hobby","Hidden Categories","Old Hobby","line one
line two 🎉",$5.00,$0.00,"Uncleared"
"Main Checking","","11/10/2026","Transfer : Rainy Day Savings","","","","",$200.00,$0.00,"Reconciled"
"Rainy Day Savings","","11/10/2026","Transfer : Main Checking","","","","",$0.00,$200.00,"Reconciled"
"Main Checking","Purple","11/05/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","\=bonus",$0.00,$2500.00,"Cleared"
"Main Checking","","10/25/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","",$80.50,$0.00,"Cleared"
"Sample Visa","","10/20/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","",$40.00,$0.00,"Uncleared"
"Main Checking","","10/03/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Cleared"
"Sample Visa","","10/01/2026","Starting Balance","","","","",$100.00,$0.00,"Cleared"
"Rainy Day Savings","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$500.00,"Cleared"
"Main Checking","","10/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"
"Old Car","","10/01/2026","Starting Balance","","","","",$0.00,$3000.00,"Cleared"
```

If the services store fixture F differently (say a Starting Balance's cleared state), the expected text
stays; the difference is reported as a defect or as a departure from the case, never regenerated from the
code.

1. **(AC2) ZIP and names.** Build F, GET the export. 200, `Content-Type: application/zip`,
   `Content-Disposition: attachment; filename="Budget Export - ZZ TEST Export Plan 1 <h> as of 2026-11-15 19-51.zip"`.
   The test's own ZIP reader finds exactly two local headers and two central entries, in order
   `ZZ TEST Export Plan 1 <h> as of 2026-11-15 19-51 - Plan.csv` and `… - Register.csv`; each stored
   (method 0), flag `0x0800`, CRC-32 matching its data, DOS date 2026-11-15, DOS time 19:51:00; the end
   record counts 2. Without `now` the name matches
   `^Budget Export - ZZ TEST Export Plan 1 [0-9a-f]{8} as of \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.zip$` with the
   UTC date. `now=2026-02-30T10:00` and `now=2026-11-15T24:00` → 400; an unknown plan → 404.
2. **(AC3) Encoding.** Each entry starts with EF BB BF, uses CRLF, does not end with `\n`, and after the
   BOM equals the expected file above byte for byte (text quoted, amounts not).
3. **(AC4) TSV.** Pure: format `{ "€", "after", ",", ".", 2, "DD.MM.YYYY" }` → delimiter TAB, extension
   `tsv`; a register row matching the ticket's TSV sample gives
   `"Konto"\t""\t"30.11.2026"\t…\t120,50€\t0,00€\t"Cleared"` byte for byte; `amount(-45000)` = `-45,00€`;
   `exportFileNames` ends in `- Plan.tsv` and `- Register.tsv`.
4. **(AC5) Plan rows.** F's Plan file equals the expected text (both months, Credit Card Payments first,
   Old Hobby under Hidden Categories, no deleted default category). Pure: a category of a hidden group
   goes under Hidden Categories after the visible ones; `planMonths` extends the range to a later
   assigned month.
5. **(AC6) Register rows.** F's Register file equals the expected text: sort (the 11/14 tie −30.00,
   −12.50, +10.00; the transfer pair; the four Starting Balances), split numbering and trailing space,
   transfers, flags, the scheduled row, the three cleared states, the closed tracking account, the
   deleted 11/13 row absent.
6. **(AC6) Flag names.** Pure: `flagNames = { purple: "Tax" }` writes `"Tax"`; without it `"Purple"`.
7. **(AC7) Formula guard.** Pure: `=x` → `\=x`, `  +1` → `\+1`, `-a` → `\-a`, `@b` → `\@b`; `a=b` and
   `Split (1/1) =x` unchanged. F: memo `=bonus` → `"\=bonus"`.
8. **MCP.** `export_budget({ budget_id, now: "2026-11-15T19:51" })` on F: same `file_name`; decoded
   base64 equals the REST body; `bytes` is its length. The tool is in `listedToolNames()` and
   `/budgets/{budget_id}/export` in `apiPaths()`.
9. **Read-only.** The plan's `change_log` row count is unchanged by a REST and an MCP export.
10. **D1 calls.** 15 for F and 15 for a one-account plan with 1,000 transactions over 24 months, whose
    Register file has 1,002 lines (header, 1,000 rows, the Starting Balance) and whose ZIP has two entries.
11. **Formatter.** Default format: `17340` → `$17.34`, `-120000` → `-$120.00`, `200000000` →
    `$200000.00`, `0` → `$0.00`, `-4` → `$0.00`, `2026-11-15` → `11/15/2026`.
    `safeName("ZZ-TEST Export: Plan #1")` = `ZZ TEST Export Plan 1`, `safeName("Plan ✓")` = `Plan `.

Criteria 1 and 8: not in this Build.

## Manifest

touches: [packages/schema/src/plan-export.ts, packages/schema/src/zip.ts, packages/schema/test/plan-export.test.ts, apps/worker/src/services/plan-export.ts, apps/worker/src/repositories/plan-export.ts, apps/worker/src/routes/plan-export.ts, apps/worker/src/mcp/tools/plan-export.ts, apps/worker/test/plan-export.test.ts, apps/worker/test/plan-export-calls.test.ts, apps/worker/test/plan-export-fixture.ts, apps/worker/test/zip-reader.ts, apps/worker/test/mcp-coverage/budgets.ts, apps/worker/test/mcp-timestamps.test.ts, docs/plan-export-design.md, docs/plan-export-spec.md, docs/README.md]
shared: []
migrations: 0
