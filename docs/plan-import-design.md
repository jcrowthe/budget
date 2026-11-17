# Import Plan, the API half, and the export's `now` bound: design (EXF-477, EXF-670)

`POST /api/v1/budgets/import` and the MCP tool `import_budget_export` make a **new** plan from an Export Plan zip
(the source's, compressed, or the clone's, stored) or from its two `.csv`/`.tsv` files. Large plans are written in
caller-driven steps (`continue_budget_import`) and stay invisible until the last one. EXF-670 bounds the export's
`now` and its months. **No screen, no file under `apps/web/` or `e2e/`**: the dialog and its entry points stay open
on EXF-477. Interfaces and tasks: [plan-import-spec.md](plan-import-spec.md).

## Source

**Not opened in this Build** (the source is the owner's real account). The reference is the text of EXF-476 (format,
samples) and EXF-477 (reading rules), and the clone's export ([plan-export-design.md](plan-export-design.md)). No
study folder, no screenshot, no file from the source: test files are written by hand from the tickets or made by the
clone's export.

## Approach

- **Pure, in `@budget/schema`**: a zip reader beside `storeZip` in `zip.ts` (inflater injected: the package has no
  DOM/Node types); `plan-import-read.ts` (delimited text, formula guard, amounts, dates, file names, identification);
  `plan-import.ts` (rows → `ImportPlan` with integer keys, warnings, counts; zod schemas of options and results).
- **Worker**: `services/plan-import-compare.ts` (`ImportPlan` → `EngineInput` → core `computeMonth`; in the Worker
  because `@budget/schema` does not depend on `@budget/core` and `package.json` may not change);
  `services/plan-import.ts` (decode, unzip, build, compare, chunk, steps, sweep, cancel);
  `repositories/plan-import.ts` (`json_each` set inserts, guards, cleanup); `routes/plan-import.ts`,
  `mcp/tools/plan-import.ts` (collected by the globs); `services/plan-clock.ts` (`planClock.now()`, a test seam for
  the export and the import).
- **Migration** `20261116101300_plan_imports.sql` (the number the Lead reserved) + `db/schema/plan-imports.ts`: one
  additive table `plan_imports`.
- No service or repository of note 11, no shared module, no `package.json` changes; the import copies their rules
  (Starting Balance payee, transfer pair shape, payment categories, split lines) into its own statements.

## Steps, storage, invisibility (note 4)

**Call 1** (`POST /budgets/import`, not dry run) parses both files, builds the plan, compares, then:
- **Single-call path** (≤ `singleCallRows` = 2,500 rows, e.g. the ticket's sample): **one** D1 batch writes the
  visible plan, every row, the history entry and a `plan_imports` row `done`. No R2. **201**.
- **Stepped path**: rows are cut into chunks of ≤ `chunkRows` = 2,500 in dependency order (accounts, groups,
  categories, payees; assignments; transactions and lines; schedules), each chunk the final rows (with ids) of one
  batch as positional JSON. The chunks are concatenated into **one R2 object** `plan-imports/<import_id>/chunks`;
  their byte ranges go in `plan_imports.chunk_offsets`. One D1 batch inserts the plan row **hidden**
  (`budgets.deleted_at` set) and the import row (`writing`, `next_chunk` 0). **202** with `import_id`, progress, summary.

**Continue** (`POST /budgets/import/{import_id}/continue`): read the import row; R2 ranged `get` of chunk
`next_chunk` = n; one D1 batch in which every statement is guarded by `(select next_chunk from plan_imports where id
= ? and state = 'writing') = n` and which ends with `update … set next_chunk = n + 1 where … next_chunk = n`. The
**last** chunk's batch also, under the same guard, inserts the history entry, clears the plan's `deleted_at` and sets
the import `done`; then the R2 object is deleted and `r2_key` cleared. **202** until done, then **201**.
A step repeated after a lost answer, or two at once, writes nothing the second time (the guard fails inside the
atomic batch) and answers the current state; continue on a `done` import answers the same 201 again.

**Why R2, and prepared chunks rather than the file.** The normalized plan is several MB (≈ 6 MB of JSON for 20,000
transactions): past D1's 2 MB row and a sane batch. R2 ranged reads give each step only its chunk (one `JSON.parse`
of ≈ 0.5 MB). Keeping the raw file would mean re-parsing it, the heaviest CPU work, at every step.

**Invisible until done.** Plan reads go through `findActive`/`listActive` (`deleted_at is null`) or join active
budgets (the scheduler's `listDue`): a hidden plan is absent from the list, 404 by id, a tool error through MCP, never
touched by the cron. Its id is not returned before `done`; no `change_log` row exists before the last batch.

**Leftovers.** `DELETE /budgets/import/{import_id}` (`cancel_budget_import`) removes a `writing` import at once: one
batch of `delete … where budget_id = ? and <import writing> and <plan hidden>` over `scheduled_transactions`,
`transactions`, `month_categories`, `categories`, `category_groups`, `payees`, `accounts`, then the `budgets` row; the
import becomes `abandoned` (summary and offsets cleared); then the R2 delete. A step whose batch fails or whose R2
object is gone runs the same cleanup (422 / 409). **The sweep**: every call 1 first cleans at most one import that is
`writing` and untouched for 24 h, or `done` with an `r2_key` left. The guards can never match a visible plan.

**Calls per invocation** (service only; the Idempotency middleware adds ≤ 2 when a key is sent). None grows with the
file:

| Invocation | D1 | R2 |
|---|---|---|
| dry run | 0 | 0 |
| call 1, single path | sweep ≤ 2 + batch 1 = **≤ 3** | sweep ≤ 1 |
| call 1, stepped | sweep ≤ 2 + batch 1 = **≤ 3** | sweep ≤ 1 + put 1 = **≤ 2** |
| continue | read 1 + batch 1 (+ clear key 1 on the last; + cleanup 1 on failure) = **≤ 3** | get 1 (+ delete 1) = **≤ 2** |
| continue on done / abandoned | 1 | 0 |
| cancel | read 1 + batch 1 = **2** | 1 |

A batch holds ≤ 2,500 rows, ≤ 250 per statement, one JSON parameter each (≈ ≤ 100 KB), so the 100-bound-values limit
never applies. 20,000 transactions over 96 months, 200 categories, 30 accounts ≈ 45,000 rows ≈ 19 chunks ≈ 20
invocations. Call 1's CPU grows with the file (one parsing pass with `slice`, no per-character concatenation, `Map`
joins; the engine once per month like the export, on activity pre-summed per month). If the real CPU limit refuses
it, the state machine can split call 1 (store / parse / compare) without changing the API; the test reports times.

## Reading rules (EXF-477, notes 3, 5, 6)

- **Upload**: REST `multipart/form-data`, **one or two parts named `file`** (a zip, or the Plan and Register files in
  either order), text fields `name`, `export_date`, `date_format`, `currency_format` (JSON), `account_types` (JSON);
  query `dry_run=true`. MCP: `files: [{ file_name, content_base64 }]` (1–2) and the same options. Limits: upload ≤ 20
  MiB, ≤ 8 zip entries, entry ≤ 32 MiB inflated, Register ≤ 200,000 rows, Plan ≤ 400,000 rows.
- **Zip**: central directory; stored and deflated (`DecompressionStream("deflate-raw")`, read incrementally, stopped
  past the stated size); CRC and size checked; UTF-8 names; directories and `__MACOSX/` ignored. Plain refusals:
  encrypted, ZIP64, other methods, too many entries, an entry over the bound, bad CRC, corrupt.
- **Files**: UTF-8 (fatal), BOM stripped, TAB for `.tsv` else sniffed from the header, RFC 4180 (quotes, doubled
  quotes, CRLF/LF, breaks inside quotes); identified by header, exactly one Plan and one Register.
- **Formula guard**: a text field starting `\` + one of `+ - = @` loses the backslash.
- **Amounts**: negative when it starts with `-`; between the first and last digit at most one non-digit, the decimal
  separator, followed by 1–3 digits; the text around is the symbol (`before` / `after` / `none`). `-$45.00` → -45000,
  `120,50€` → 120500, `¥1234` → 1234000; anything else is 422 naming file, line, column. Amount = Inflow − Outflow.
  Formats are detected from the first non-zero amount; a different one later is a warning.
- **Dates**: `MM/DD/YYYY`, `DD/MM/YYYY`, `YYYY/MM/DD`, `YYYY-MM-DD`, `DD-MM-YYYY`, `DD.MM.YYYY`, `YYYY.MM.DD`
  (EXF-468 will own the list). Candidates = formats parsing every Register date. None → 422; one → used; several
  without `date_format` → **unclear**: the preview has `date_question` ("The date format of <file> is unclear. The
  first transaction reads <date>. What date is this?" with options `{ date_format, date }`) and is computed with the
  first option; a real import answers **422 `date_format_unclear`** with the question and options.
- **Name and export date** from the zip's (else an entry's) name `… Export - <SafeName> as of YYYY-MM-DD HH-mm`
  (`YNAB Export - …` and `Budget Export - …` both); `name` / `export_date` win; else `Imported Plan` and the server's
  UTC date with a warning. **Never from `now`.**
- **Formats are not stored** (no plan settings): `summary.formats` reports them (overridden by `currency_format`).
  **EXF-468** plugs in as one statement in the final batch and in `exportPlan`'s `PlanFormat` line.

## Building the plan (notes 6, 7)

- **Groups, categories** in first-appearance order of the Plan file, keyed by (group, category). `Credit Card
  Payments` → the payment group (`kind`, sort = min − 1 like the app) and payment categories (`kind`, `account_id`) of
  the accounts so named; none in the Register → a credit card account with no transactions (warning). A credit
  account without a row gets its payment category appended.
- **Hidden categories** go, hidden, into a **visible group `Hidden Categories`** after all others, in file order; a
  repeated name goes to `Hidden Categories (2)`, … (names stay unique per group). The export writes every hidden
  category as `Hidden Categories: <name>` after the visible ones in walk order, so rows come back identical. A hidden
  category named like an account whose Starting Balance is an uncategorized outflow is that card's payment category
  (a closed card), made visible, with a warning.
- **Assigned** → `month_categories` when non-zero. Activity and Available are only compared.
- **Accounts**: proposed `creditCard` (a payment category has its name), `otherAsset` (Starting Balance uncategorized,
  ≥ 0), `otherLiability` (uncategorized, < 0: the ticket's loan/debt, which the app cannot create; warning), else
  `checking`. `account_types` overrides within `checking savings cash creditCard lineOfCredit otherAsset
  otherLiability` (422 for others, unknown names, or a payment-category account moved off credit types). All open.
  Sort order: a stable topological order of the account edges given by full (date, amount) ties in the Register,
  else first appearance, so the export's tie order comes back.
- **Payees**: `Starting Balance` → system `starting_balance`; `Manual Balance Adjustment` → system
  `manual_adjustment`; paired transfer → none (`payee_name` `Transfer : <other>`); `""` → none; else one per name.
- **Rows**: `Inflow: Ready to Assign` → `inflow_to_ready_to_assign`; `""` → uncategorized; else the category
  (created with a warning if not in the Plan file). Cleared 1:1. Flags by colour name (other names: none, warning).
  `approved` true. A tracking account's row loses any category. **A card's row in its own payment category** loses
  it, with a warning. `created_at` = import start + Register index (ms), so ties keep file order.
- **Splits**: `Split (1/n) …` then `Split (k/n) …` rows with the same account, date, flag and cleared → a parent
  (sum, first line's payee, flag, no category, no memo) and lines (`split_index`, memo after `Split (k/n) ` or null,
  payee null when equal to the parent's). Incomplete runs stay plain (warning). On a tracking account the lines
  become plain rows. A line payee `Transfer : X` stays a payee (warning).
- **Transfers**: a row in A with payee `Transfer : X` pairs with the first unpaired row in X with payee `Transfer :
  A`, same date, opposite amount. Each side keeps memo, flag, cleared; category null when both are on-plan. Unpaired
  → plain row with that payee, warning.
- **Scheduled**: a non-split, non-transfer row dated after the export date → a one-off schedule (`never`,
  `date_first` = `date_next`), warning. Splits and transfers after it stay transactions (warning).
- **Plan row**: `created_at` = earlier of the import time and the first Plan month (so that month comes back).
- **History**: one `change_log` row `create` / `budget` / plan id, actor = who started the import, `after` = the plan
  plus `import: { text: "Imported plan from file", import_id, file_name, export_date, counts, formats,
  warning_count, mismatch_count }`. **Imported rows get no history rows**: 45,000 log rows would double the writes
  and steps, nothing reads them, and the entry records the whole creation.

## Comparison (criterion 5) and results

The comparison builds `EngineInput` from the `ImportPlan` with `planActivity`'s rules (off-plan rows, split parents,
the cash side of on-plan transfers and a card's uncategorized Starting Balance out; card side of a transfer as
`transfer`; `accountId` on card rows), runs `computeMonth` per Plan month and lists ≤ 200 mismatches { category,
month, column, expected, got } with `mismatch_count`. Schedules are not activity. **dry_run** returns
`PlanImportPreview` (summary + `date_question`), writes nothing (0 D1, 0 R2), one call whatever the size.
`PlanImportResult` = { import_id, state, budget_id, progress, summary }. Errors: 422 `unprocessable_entity`, 422
`date_format_unclear`, 404 unknown import, 409 `import_abandoned`, 409 `import_finished`.

| REST | MCP |
|---|---|
| `POST /budgets/import` (multipart, `?dry_run`) → 200 / 201 / 202 | `import_budget_export` |
| `POST /budgets/import/{import_id}/continue` → 201 / 202 | `continue_budget_import` |
| `DELETE /budgets/import/{import_id}` → 200 | `cancel_budget_import` |

The import tool's description says what it reads, that it **creates a new plan and never changes an existing one**,
and that while `state` is `writing` the caller calls `continue_budget_import` until `done`.

## EXF-670

- `now` is accepted only when its date is within **one day** of the server's UTC date (`planClock`); else **422
  `unprocessable_entity`** "now must be within one day of the server's date (<d−1> to <d+1>)", the same text as a tool
  error.
- **Month bound**: `last = min(max(current, last_assigned_month), server month + 24)` (`EXPORT_MONTHS_AHEAD`); money
  assigned later is not written. Still 15 D1 calls.
- `plan-export-design.md` line 170 gains the September assignments (Groceries $200.00, Fun $50.00, Hobby $20.00).

## Downstream effects and out of scope

The table is additive; existing plans and reads are untouched. At a rebase keep every line of
`mcp-timestamps.test.ts`, `mcp-coverage/budgets.ts`, `docs/README.md`. Out of scope: the dialog and entry points;
plan formats and flag names (EXF-468, EXF-480); repeating schedules; account closure; targets and notes; loans.

## Acceptance

All Worker or unit tests; nothing is compared with the source. `planClock` = 2026-11-16T12:00Z where dates matter.
**S** = EXF-476's two samples written by hand into a compressed zip `YNAB Export - Sample Plan as of 2026-11-15
19-51.zip`. **F** = `buildF` of `plan-export-helpers.ts`.

1. **Sample (criterion 1).** POST S → 201 `{ budget_id, summary }`: accounts `Main Checking`, `Rainy Day Savings`
   (checking), `Sample Visa` (creditCard, no transactions, warning); groups `Bills`, `Everyday`, `Fun` (from the
   Register, warning), `Credit Card Payments`, `Hidden Categories` with `Old Hobby` hidden; assigned Oct Rent $900.00,
   Groceries 🛒 $300.00, Nov Rent $900.00; one split (−30.00 `food`, −12.50 no memo, `Corner Shop`, red); one
   transfer pair; one schedule 2026-12-01 (−900.00, `monthly`); flag `Tax` → none + warning; name `Sample Plan`; one
   `change_log` row.
2. **Amounts (criterion 2).** Unit: `$17.34` → 17340, `-$45.00`, `120,50€` → 120500, `-45,00€`, `¥1234` → 1234000,
   `0,5 kr.` → 500; `12.3456`, `1.2.3` refused. Worker: a hand-written `.tsv` pair (two parts; `€` after, `,`
   decimals, `DD.MM.YYYY`) imports `120,50€` as 120500 and reports `€`, `after`, `,`, TAB.
3. **Formula guard (criterion 3).** S's `\=bonus` → memo `=bonus`.
4. **Dates (criterion 4).** All days ≤ 12 with `/`: dry run → `date_question` with the first row's text and options
   `MM/DD/YYYY`, `DD/MM/YYYY` and their dates; real import → 422 `date_format_unclear`; with `date_format` → 201. S (a
   day of 14) → no question. Unit: the seven formats; none parsing → 422.
5. **Comparison (criterion 5).** F exported then imported → `mismatch_count` 0 and the summary's figures equal `GET
   /months/{m}` of the new plan; one Activity cell edited → exactly that mismatch.
6. **Dry run (criterion 6).** Row counts of every table touched and the R2 listing under `plan-imports/` are equal
   before and after a dry run of S and of the large file; the preview has formats, proposed types, counts, warnings.
7. **Round trip (criterion 7, main test).** F exported (`now=2026-11-16T09:05`), imported, re-exported with the same
   `now`: Plan entries byte-identical, Register entries byte-identical. Same through the stepped path (`chunkRows` 7).
8. **Steps.** `chunkRows` 7 on F: 202, then 201. Between steps the plan is absent from `GET /budgets` and
   `list_budgets`; `GET /budgets/{id}`, `/accounts`, `/months/{m}` → 404 (id from `plan_imports` by SQL); `get_budget`
   → tool error; `enterDue({ budgetIds: "all", day: "2199-01-01" })` enters nothing in it. Two concurrent continues
   and a repeated one leave the rows of one; continue after done → the same 201.
9. **Cleanup.** Cancel mid-way → 0 rows for that plan id in every table, R2 object gone, continue → 409. An import
   25 h stale → removed by the next POST. R2 object deleted mid-way → continue 409 and cleanup.
10. **Size.** Generated source-style compressed zip: 30 accounts, 200 categories, 96 months (19,200 Plan rows), 20,000
    transactions with splits and transfers. Every invocation ≤ 40 D1 and ≤ 40 R2 calls; logs `plan-import: <n>
    invocations, slowest <ms> ms (<step>), dry run <ms> ms`; counts checked in D1. S: 1 invocation.
11. **Zip.** Stored (`storeZip`) and deflated (test-made with `CompressionStream("deflate-raw")` and its own header
    writer) entries read in the unit and the Worker pools; refusals: encrypted, ZIP64, method 12, 9 entries, entry
    over the bound, bad CRC, truncated.
12. **Options.** `account_types` checking → `savings` applied; `mortgage` → 422; `name`, `export_date` override the
    file name; a loan-like account → `otherLiability` + warning; a card row in its own payment category →
    uncategorized + warning.
13. **EXF-670.** `now` ±1 day accepted; +2 days and `2199-12-31T23:59` → 422 naming the range (REST) and a tool
    error; money at server month + 30 → Plan file ends at server month + 24; 15 D1 calls; existing export tests pass
    with the pinned clock.
14. **Migration, surface.** The migration is `CREATE TABLE`/`CREATE INDEX` only; a plan inserted with the
    pre-migration columns is listed and read (`/budgets`, `/budgets/{id}`, `/months/{m}`) as before; `schema-drift`,
    `openapi`, `mcp`, `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps` pass; `apiPaths()` / `listedToolNames()`
    contain the three operations and tools.

## As built (departures from the plan above, and measured numbers)

- `ImportError` lives in `plan-import-read.ts` (re-exported by `plan-import.ts`) so the two files do not import each
  other; `identifyFiles` also returns `planDelimiter` (the two files may differ); `ImportPlan.planRows` has no `label`.
- `summary.formats.delimiter` is `"comma"` or `"tab"`. A split line's `split_index` is 0-based like the app's.
- Several date formats are one answer, not a question, when they read every date of the Register alike (a file whose
  only date is `10/10/2026`): the question is asked only between formats that give different dates.
- A step whose R2 chunk is unreadable JSON, like one whose batch throws, cleans up and answers 422 `import_failed`.
- Task 0: `DecompressionStream("deflate-raw")` works in the Worker test pool (`plan-import-zip.test.ts`); no inflater by hand.
- **Size (case 10, local, `plan-import-calls.test.ts`)**: 30 accounts, 200 categories (6 hidden, 4 payment), 96 months
  (19,200 Plan rows), 20,030 Register rows, zip 356 KB: **17 invocations** (start + 16 continues), **at most 3 D1 and
  2 R2 calls** per invocation, slowest **start ≈ 3.2 s** (dry run ≈ 3.3 s, the same work). Of it, `computeMonth` once per
  Plan month is ≈ 2.8 s (the engine recomputes the timeline from the first month each call), parse and build ≈ 0.2 s,
  unzip and decode < 0.05 s. A Worker CPU limit below that cannot take call 1 or a dry run of a plan this size; the
  state machine is then split (store / parse / compare) without changing the API, as written above.
- Not covered by a test: the cron never runs against a half-written plan only because `listDue` joins active plans
  (`plan-import-steps.test.ts` inserts a due schedule into a hidden plan to prove it).

## Carry-over (Build `p_51a143af…`, 2026-11-16)

Merged from `0b970a0` onto main `49012cd` without conflict (35 files, +6,496 −15). The decisions above stand and
still fit main: `listActive`/`findActive`, the scheduler's `listDue` (inner join on active plans,
`repositories/scheduled-transactions.ts`) and the bank sync's `livePlanIds` (`repositories/imports.ts:74`, used at
`services/plaid-sync.ts:208`) and its link guard (`imports.ts:234`) are the only reads across plans
(`grep` of `apps/worker/src` for the `budgets` table), and each skips a hidden plan. Re-run here:
`plan-import-calls.test.ts` passes and logs `17 invocations, slowest 3225 ms (start), dry run 3179 ms; max D1 3, max
R2 2` (logs need `--silent=false`). New work is spec task 12; the points of the Lead's brief:

1. **Criteria → tests.** EXF-477 1: `plan-import.test.ts` "case 1 …creates the plan…"; 2: "case 2 …TSV pair…", "…$17.34
   …", schema `plan-import-read.test.ts` "amounts"; 3: "case 3 …\=bonus…"; 4: "case 4 …asks in the dry run…", "…a day of
   14…"; 5: `plan-import-roundtrip.test.ts` "criterion 5" (two tests); 6: "case 6 …dry run…" and the large dry run in
   `plan-import-calls.test.ts`; 7: `plan-import-roundtrip.test.ts` "criterion 7" (single and stepped). Fixture F
   already holds all eight things the Lead names (card `Sample Visa` with its payment category and card spending,
   split, transfer, schedule, hidden `Old`/`Old Hobby`, red flag, reconciled transfer, Dec 2026 assignment ahead of
   the pinned Nov), but the test does not say so: **task 12a** asserts them in the first export. EXF-670 1–3:
   `plan-export-now.test.ts` (four tests) and schema `plan-export.test.ts` "EXF-670 now bound"; 4: `plan-export-design.md`
   line 170 (done).
2. **Large file**: the test above (≤ 40 asserted per invocation). Repeated / simultaneous continues:
   `plan-import-steps.test.ts` "two concurrent continues…" and "a step repeated after it was applied…"; the large
   test's final D1 counts prove no chunk was written twice.
3. **Invisible until done**: covered: list (REST, `list_budgets`), by id (REST plan, accounts, months, export;
   `get_budget`), `enterDue` over all plans, no `change_log`; cancel, 25 h sweep and failed steps leave nothing in D1
   or R2; a visible plan untouched by cancel. **Missing, task 12b–d**: the bank sync, a plan-scoped tool other than
   `get_budget`, and a plan **deleted by the owner** surviving cancel and sweep.
4. **Hand-written source-style files**, all covered: source-prefixed compressed zip built from parts
   (`SAMPLE_ZIP_NAME` from `SRC`, `deflatedZip`) in case 1 and `plan-import-zip.test.ts`; `.csv` with `$` (case 1,
   "$17.34"); `.tsv` with `€` after and `,` decimals (case 2); formula guard (case 3); every day ≤ 12 (case 4); unpaired
   transfer (schema "a self-transfer and an unpaired transfer…"); flag `Tax` (case 1, schema "flags by colour name");
   `Credit Card Payments: Sample Visa` without that account (case 1).
5. **Conflict** with the Plan-page Build: none at `49012cd`. If it merged before a rebase: keep every entry of both
   sides in `mcp-timestamps.test.ts`; in `plan-export-calls.test.ts` keep both changes and expect what the code then
   makes (16 expected), and write that number in `plan-export-design.md`, `plan-export-now.test.ts` ("15 D1 calls")
   and this doc's EXF-670 section.
6. **Out of bounds**: the branch touches none of the Lead's list, no shared module, no `paths.always_overlap` file,
   nothing under `apps/web/` or `e2e/`. Task 12 adds tests only; if one fails because of an out-of-bounds file
   or of code outside the manifest (e.g. `services/scheduled-transactions.ts`, `services/plaid-sync.ts`), stop and report the file and why rather than change it.

### Second carry-over (2026-11-17): amounts with thousands separators (spec task 13)

Merged `d427fbb` onto main `49012cd` (fast-forward, 36 files, +6,970 −15); main had not moved, so the design and the
point-5 conflict are unchanged (the Plan-page Build has not merged). The only new work is the amount rule below; the
export keeps writing no separator (`exportFormat().amount`, unchanged).

**Decision.** The file's **decimal separator** is fixed before any amount is read: `currency_format.decimal_separator`
if given, else the first amount cell (Plan Assigned, Activity, Available, then Register Outflow, Inflow, in file order)
that reveals it: a number with two different non-digits where the last one occurs once and is one of `. , - /` (it is
the decimal), or with one non-digit occurring once followed by 1 or 2 digits. No cell reveals it → `null`, and every
amount is read by the old rule. With a known decimal `d`, an amount is accepted when it is:
- the old rule (no non-digit, or one followed by 1–3 digits), **except** a single non-digit `g ≠ d` from the grouping
  set followed by exactly 3 digits, which is grouping (`$1,234` in a `.` file → 1234000; `1.234€` in a `,` file →
  1234000; `1.234` in a `.` file stays 1.234, a three-decimal currency);
- or **grouped**: groups joined by one grouping char `g ≠ d` used throughout, first group 1–3 digits, every later
  group exactly 3 digits, at least two groups, then optionally `d` and 1–3 digits. Grouping set: `,` `.` space,
  U+00A0, U+202F, `'`, `’`.

So `$1,234.56` → 1234560, `-$12,345.00` → −12345000, `$1,000,000.00` → 1000000000 (`.` file); `1.234,56€` → 1234560,
`1 234,56 €` → 1234560 (`,` file). **Still refused** (422 `bad_amount`, the existing message `<Plan|Register> file line
<n>, column <col>: "<text>" is not an amount`): `1,23.45`, `12,3456.00`, `1234,567.00` (first group of 4), `1,234,56`,
`1,234.5678`, mixed grouping chars (`1,234 567.00`), a grouping char equal to the decimal, two decimals; and any
grouped amount when no cell reveals the decimal (`1,234,567` alone). `formats.decimal_separator` = option, else the
detected decimal, else the first amount's, else `.`. The pre-scan is string work only: no D1 or R2 call is added, and
the calls of case 10 stay at ≤ 3 D1 / 2 R2.

**15. Thousands separators (acceptance).** Unit (`plan-import-read.test.ts`): `parseAmount(cell, ".")` on `$1,234.56`,
`-$12,345.00`, `$1,234`, `$1,000,000.00`, `1.234` (→ 1234); `parseAmount(cell, ",")` on `1.234,56€`, `1 234,56 €`,
`1.234€`; refusals listed above → null; `detectDecimal` on `$0.00` → `.`, `1.234,56€` → `,`, `$1,234` → null; the
no-argument behaviour unchanged (`1,234.56` → null). Schema (`plan-import.test.ts`): a `,`-decimal TSV pair with
`1.234,56€` imports 1234560 and reports `decimal_separator` `,`. Worker (`plan-import.test.ts`): a hand-written `.csv`
pair whose Plan has Assigned `$1,234.56` and Activity `-$12,345.00`, and whose Register has outflows `$12,345.00`
and an inflow `$1,000,000.00` → 201; in D1 the plan's `month_categories.assigned` and `sum(transactions.amount)` equal
the hand-computed milliunits exactly, `mismatch_count` 0; the same pair with one cell `$1,23.45` → 422 whose message
holds `Register file line`, the column and `$1,23.45`, and D1 row counts unchanged. Export unit
(`plan-export.test.ts`): 1234560 written `$1234.56`.

## Manifest

touches: [packages/schema/src/zip.ts, packages/schema/test/zip.test.ts, packages/schema/src/plan-import.ts, packages/schema/src/plan-import-read.ts, packages/schema/test/plan-import*.test.ts, packages/schema/src/plan-export.ts, packages/schema/test/plan-export.test.ts, apps/worker/migrations/20261116101300_plan_imports.sql, apps/worker/src/db/schema/plan-imports.ts, apps/worker/src/repositories/plan-import.ts, apps/worker/src/services/plan-import.ts, apps/worker/src/services/plan-import-compare.ts, apps/worker/src/services/plan-clock.ts, apps/worker/src/services/plan-export.ts, apps/worker/src/routes/plan-import.ts, apps/worker/src/routes/plan-export.ts, apps/worker/src/mcp/tools/plan-import.ts, apps/worker/src/mcp/tools/plan-export.ts, apps/worker/test/plan-import*.test.ts, apps/worker/test/plan-import-helpers.ts, apps/worker/test/plan-export*.test.ts, apps/worker/test/plan-export-helpers.ts, apps/worker/test/mcp-coverage/budgets.ts, apps/worker/test/mcp-timestamps.test.ts, docs/plan-import-design.md, docs/plan-import-spec.md, docs/plan-export-design.md, docs/README.md]
shared: []
migrations: 1

**Built (second carry-over).** `parseAmount(cell, decimal?)`, `detectDecimal`, `GROUPING_CHARS` in `plan-import-read.ts`; `buildImportPlan` fixes the decimal before reading amounts. Tests: `plan-import-read.test.ts` (each form and refusal), `plan-import.test.ts` (schema, `,` TSV pair), `apps/worker/test/plan-import.test.ts` (hand-written `.csv` pair, totals 1234560 assigned and 987655000 net, and a `$1,23.45` 422), `plan-export.test.ts` (`$1234.56`). A grouped amount in a CSV must be quoted, as any cell holding the delimiter. No D1/R2 call added (large file: 17 invocations, max 3 D1, 2 R2, slowest step 3599 ms).
