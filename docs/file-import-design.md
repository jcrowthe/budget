# File import, pure layer (EXF-531 with EXF-518, unit FI-1): design

Everything a file import decides that needs no database, in `@budget/schema`, unit-tested. The Worker's preview
and import (FI-2) and the browser's dialog (FI-4) both call these functions, so the preview and the import cannot
disagree. Bank sync moves onto `resolveImportedPayee` in FI-5. Plan: p_c62f35f9e111418dadd71bc7ad40c7e9.

Three new modules, no other source change:
- `packages/schema/src/file-import-read.ts`: decoding, file formats, CSV/TSV, OFX/QFX and QIF readers, `FileImportError`.
- `packages/schema/src/file-import.ts`: the 13 date formats, detection, auto-mapping, file rows with keys and skip
  reasons, caps, Zod schemas, copy.
- `packages/schema/src/imported-payee.ts`: `resolveImportedPayee`, `titleCaseAllCaps`.

No migration, no route, no MCP tool, no web change, no shared module, no `package.json` change.

## Source

**Source: not compared, built from the tickets.** Nothing in the source app was opened. The words are quoted
from EXF-531 ("Dialog 1", "Dialog 2", "Result") and EXF-518 ("Rule semantics", "Implementation"), with "the
YNAB field" written as "the field". The fixtures are hand-made (`ZZ`/`Sample` names, made-up amounts), and none
comes from a real bank.

## Shared definitions

Copied from the FI-1 contract. **This section is authoritative once it lands.**

### File row and import key

- **File row:** `date` (ISO, or null when it doesn't parse), `payee_text`, `memo`, `amount` (milliunits; negative
  is an outflow), `fitid` (OFX/QFX only, else null), `line` (position in the file).
- **Import key**, stored in `transactions.import_id`:
  - an OFX/QFX row with a FITID: `file:v1:<account_id>:fitid:<FITID>`;
  - any other row: `file:v1:<account_id>:<date>:<amount>:<h>:<n>`. `h` is the first 16 hex characters of the
    SHA-256 of `fold(payee_text) + "\u0000" + fold(memo ?? "")`. `n` (1, 2, …) is the row's occurrence of that
    `(date, amount, h)` within the file, in file order.
  - The key is computed from the file's own payee text (before renaming) and the memo as read (before "Import
    Memos", after "Swap Payee and Memo"). Re-importing the same file with the same options gives the same keys.
  - A row is a file import exactly when its import_id starts with `file:`.
- **Within-file duplicate:** a second row with the same FITID key in one file is dropped, `skip: "duplicate_in_file"`.

### Dates

- **Cutoff:** a row is before cutoff by the bank import's rule: `skipReason` in `packages/schema/src/plaid-import.ts`
  (`importStartDate`, Starting Balance date, the 3-day grace before the latest reconciled row). Before-cutoff rows
  are skipped unless `include_before_start` is set.
- **Future date:** a row dated after `today` (client-sent, YYYY-MM-DD) takes `today`.
- **Date formats:** `FILE_DATE_FORMATS` holds the 13 of EXF-531: `MM/DD/YYYY`, `DD/MM/YYYY`, `DD/MMM/YYYY`,
  `DD/MMMM/YYYY`, `YYYY/MM/DD`, `YYYY/DD/MM`, `MM-DD-YYYY`, `DD-MM-YY`, `DD-MM-YYYY`, `YYYY-MM-DD`, `DD.MM.YYYY`,
  `YYYY.MM.DD`, `MM/DD'YYYY`.
- **Detection order:**
  1. Every date cell parses with the plan's `date_format` (plan-formats.ts): use it.
  2. Exactly one of the 13 parses every cell: use it.
  3. Otherwise the format is unclear, and the result carries `date_question { first_value, formats }`.

  With "No header row" the header line is a data row, so the format is unclear. Once a format is chosen, an
  unparseable date is skipped as `invalid`.

### Mapping and options

- **CSV mapping:** the fields are `date`, `payee`, `memo` (optional), `outflow` and `inflow`, each a column index or null.
  - Auto-map: a header cell equal to the field label (case-insensitive, trimmed) is taken.
  - The labels are the header cells, or `A, B, C…` with "No header row".
  - `outflow` and `inflow` mapped to the same column means a signed amount.
  - "Swap Inflow and Outflow" negates every amount.
- **OFX/QFX/QIF options:** `import_memos` (default true; false makes memo null), `swap_payee_memo`, `swap_inflow_outflow`.
- **OFX fields:** `STMTTRN`, `DTPOSTED`, `TRNAMT` (signed), `FITID`, `NAME` (or `PAYEE/NAME`), `MEMO`. Both SGML
  (1.x, unclosed tags) and XML (2.x). QFX is OFX.
- **QIF fields:** `!Type:Bank|CCard|Cash|Oth A|Oth L`, `D`, `T`/`U`, `P`, `M`, `^`. QIF dates use the `MM/DD'YY`,
  `MM/DD/YYYY` and `MM/DD'YYYY` forms and go through the same detection.

### Payee resolution

`resolveImportedPayee(text, rules, payees)` (EXF-518), pure, in `packages/schema/src/imported-payee.ts`:
1. Empty text: no payee.
2. The winning renaming rule (`pickRenameRule`: `is` before `contains`, case-insensitive, newest) whose payee is a
   live ordinary payee: that payee, with `rule_id`.
3. A live ordinary payee whose folded name (`foldRuleText`) equals the folded text: that payee.
4. Otherwise a new payee named after the text (trimmed, ≤ 200 characters). ALL-CAPS text (at least one letter, no
   lower-case letter) is title-cased word by word: `D7 PHONE COMPANY LLC #2` becomes `D7 Phone Company Llc #2`.

It returns `{ payee_id } | { new_name }`, plus an optional `rule_id`.

## What exists (read in the code)

- `plan-import-read.ts`: `stripBom`, `readDelimited` (RFC 4180, throws `ImportError("not_recognized")` on an
  unclosed quote, drops blank records), `detectDecimal`, `parseAmount(cell, decimal?)`, `parseDate(text, fmt)` over
  its own 7 `DATE_FORMATS` (years 1900–2199, `isCalendarDate`), `dateCandidates`. `sniffDelimiter` picks a
  delimiter by a width of at least 7 fields (the Plan file's width), so a 5-column bank file can't use it.
  `unguard` strips the export's formula guard, which only our own export writes. Both stay unused here.
- `plan-formats.ts` / `plan-formats-catalogue.ts`: a plan's `date_format` is a `DateFormat` (one of those 7, each
  also one of the 13 here).
- `rename-rules.ts`: `foldRuleText` (trim, white-space runs to one space, NFC, lower case), `pickRenameRule(name,
  rules)` over `MatchableRule { id, payeeId, kind, matchText (folded), createdAt }`.
- `plaid-import.ts:167` `skipReason(t, { closed, importStartDate, startingBalanceDate, latestReconciledDate },
  known)` → `account_closed | before_start | before_reconciled | known | null`, with `RECONCILED_GRACE_DAYS = 3`.
- "Live ordinary payee" is `deleted_at is null and system is null` (`apps/worker/src/repositories/payees.ts`
  `liveOrdinarySql`). Hidden payees count. The bank sync reads them with `includeHidden: true`
  (`plaid-sync.ts` `planPayees`). Transfer entries are not rows of `payees`.
- `@budget/schema` compiles with `lib: ES2022, types: []`: no `TextDecoder`, no `crypto` in `src`. Tests may import
  `node:*` (as `zip.test.ts` does).

## Decisions as built

### Reading (`file-import-read.ts`)

- `fileFormatOf(fileName)`: the text after the last `.`, lower-cased, if it is one of `csv tsv ofx qfx qif`; else null.
- `decodeFileText(bytes: Uint8Array, decoder: (bytes, label: "utf-8" | "windows-1252") => string)`: a UTF-8 BOM
  means `utf-8`. Otherwise the first 1,024 bytes are read as ASCII: an OFX SGML header `CHARSET:1252`, or an XML
  declaration `encoding="windows-1252"` / `"ISO-8859-1"` / `"latin1"` (case-insensitive), means `windows-1252`.
  Anything else is `utf-8`, and when that decoding holds U+FFFD and the bytes hold no `EF BF BD`, the text is
  decoded again as `windows-1252` (a bank CSV saved on Windows). The BOM is stripped. The caller passes
  `(b, l) => new TextDecoder(l).decode(b)`.
- `readCsv(text, delimiter: "," | "\t")`: `stripBom`, then `readDelimited`. An `ImportError` becomes
  `FileImportError("unreadable")`, and no record becomes `no_rows`. Cells are kept as read. The delimiter comes
  from the format: `csv` → `,`, `tsv` → TAB. There is no sniffing.
- `readOfx(text)`: the text must contain `<OFX>` (case-insensitive), else `unreadable`. Each transaction is a
  `<STMTTRN>` block that ends at `</STMTTRN>`, the next `<STMTTRN>` or `</BANKTRANLIST>`, whichever comes first, so
  SGML and XML read the same way. A leaf is `<TAG>value` up to the next `<` or line end, with tag names
  case-insensitive, the value trimmed and the entities `&amp; &lt; &gt; &quot; &apos; &#NN; &#xNN;` decoded.
  `NAME` is the block's own `<NAME>` outside `<PAYEE>…</PAYEE>`, else the `NAME` inside `PAYEE`.
  Each entry is `{ date, amount, fitid, name, memo }`:
  - `date`: the first 8 digits of `DTPOSTED` as ISO, or null when they are not a calendar date.
  - `amount`: `parseAmount(TRNAMT)` milliunits, or null.
  - `fitid`, `name` and `memo`: the trimmed text, or null when absent or empty.

  No block gives `no_rows`.
- `readQif(text)`: lines (CRLF or LF). `!Option:…` and `!Clear:…` lines are ignored, and an `!Account` block is
  ignored up to its `^`. The first `!Type:` line decides: `Bank`, `CCard`, `Cash`, `Oth A` and `Oth L`
  (case-insensitive, trimmed) are read, and any other type gives `unsupported_format`. Text before any `!Type:`
  that is not one of those headers, or no `!Type:` at all, gives `unreadable`. In a record, `D` is `dateText`
  (trimmed, inner spaces removed: `1/ 5'26` → `1/5'26`), `T` is the amount (`U` is used when there is no `T`),
  `P` is the payee, `M` is the memo, and `^` ends the record. Other codes (`N C L A S E $ …`) are ignored.
  A last record without `^` still counts when it has a line. The amounts are `parseAmount(text, decimal)`, where
  `decimal` is the first non-null `detectDecimal` over the file's amounts, or null. No record gives `no_rows`.
- `readFileText(fileName, text): ParsedFile` dispatches on `fileFormatOf`, and a null format throws
  `unsupported_format`. `ParsedFile` is `{ format: "csv" | "tsv", cells } | { format: "ofx" | "qfx", entries:
  OfxEntry[] } | { format: "qif", entries: QifEntry[] }`.
- `FileImportError extends Error` with `code: "unreadable" | "no_rows" | "unsupported_format"`.
- Caps `MAX_FILE_ROWS = 2000` and `MAX_FILE_BYTES = 2_000_000` are constants in `file-import.ts`. The Worker
  (FI-2) refuses a larger file before reading. The readers don't check them.

### Dates (`file-import.ts`)

- `parseFileDate(text, fmt)` returns ISO or null on the trimmed text. For the 7 formats that `plan-import-read.ts`
  also has, it is `parseDate` itself, so the two imports agree. The other six use one token parser:
  - `MM` and `DD` are 1–2 digits, `YYYY` is 4 digits, and `YY` is 2 digits read as `20YY`.
  - `MMM` is a 3-letter English month (`Jan`…`Dec`), and `MMMM` is the full English name (`January`…). Both are
    case-insensitive.
  - The separators are literal.
  - The result must be a calendar date (`isCalendarDate`) with a year in 1900–2199.
- `detectDateFormat(texts, planFormat)` returns `{ format, question }`, and exactly one of the two is non-null.
  Blank cells are left out. With no non-blank cell, the plan format is used. `question = { first_value: the first
  non-blank text, formats: all 13 in FILE_DATE_FORMATS order }` (the popover's select).
- QIF `dateText` of the form `M/D'YY` becomes `M/D'20YY` before detection (`qifDateText`), so `'YY` and `'YYYY`
  both land on `MM/DD'YYYY`. The question's `first_value` is the text as in the file.
- OFX dates are fixed by the format (`DTPOSTED`), so they never ask.

### Mapping

- `CSV_FIELD_LABELS = { date: "Date", payee: "Payee", memo: "Memo", outflow: "Outflow", inflow: "Inflow" }`.
- `columnLabels(firstRow, noHeader)`: the trimmed header cells, or `A`, `B`, … `Z`, `AA`, … for the row's width.
- `autoMap(labels)`: for each field, the first column whose trimmed, lower-cased label equals the field label, else null.
- An explicit `options.mapping` wins over `autoMap`. A column index past a row's end reads `""`.

### File rows (`buildFileRows`)

`buildFileRows(parsed, options, ctx, hash): Promise<{ rows, skippedBefore, dateQuestion, dateFormat }>`, with
`ctx = { today, cutoff: { start, reconciled, importStart }, accountId, planFormat }` and `hash(text) =>
Promise<string>` returning the lower-case hex SHA-256 of the text's UTF-8. **SHA-256 is injected**: the Worker and
the browser pass `crypto.subtle`, and the tests pass `node:crypto`. There is no SHA-256 in `@budget/schema`.

The steps, per format:
1. **Source rows.**
   - CSV/TSV: the records, without the first one unless `no_header`. `line` is the 1-based record number, and the
     header is record 1.
   - OFX/QFX/QIF: the entries. `line` is the 1-based entry number.
2. **Fields.**
   - CSV:
     - `payee_text`: the payee cell, trimmed, or `""`.
     - `memo`: the memo cell, trimmed, or null when empty or unmapped.
     - Amount, signed (outflow column = inflow column): `parseAmount(cell, decimal)`.
     - Amount, two columns: `|inflow| − |outflow|`, with an empty cell as 0. Both empty, or a non-empty cell that
       does not parse, is no amount.
     - `decimal` is the first non-null `detectDecimal` over the mapped amount cells of the data rows.
   - OFX: `payee_text = name ?? ""`, `memo`, `amount`, `fitid`.
   - QIF: `payee_text = payee ?? ""`, `memo`, `amount`.
3. **Swap Payee and Memo** (OFX/QFX/QIF): `payee_text ← memo ?? ""` and `memo ← payee_text || null`.
4. **Date.** `options.date_format` when set (the person's answer or the remembered one), else
   `detectDateFormat` over the date texts. While the question is open, every row has `date: null`, `key: null`,
   `skip: null`, `skippedBefore` is 0, and the Worker refuses to import. Once a format is chosen, a date that
   doesn't parse gives `date: null`.
5. **Invalid.** No date or no amount gives `skip: "invalid"` and `key: null`.
6. **Swap Inflow and Outflow** negates every amount (all formats).
7. **Key** (valid rows only), from the file's own date (before the future clamp, so a re-import on a later day
   gives the same key), the signed amount after the swap, `payee_text` and `memo` after step 3 and before step 8.
   `fold` is `foldRuleText`. Invalid rows don't count towards `n`, but before-cutoff rows do, so ticking "Include…"
   changes no key.
8. **Import Memos** off (OFX/QFX/QIF): `memo ← null`. CSV ignores `import_memos` and `swap_payee_memo`, because its
   memo is a mapping choice. OFX/QFX/QIF ignore `no_header` and `mapping`, and OFX also ignores `date_format`.
9. **Within-file duplicate:** a later row whose FITID key was already seen gets `skip: "duplicate_in_file"` and keeps
   its key.
10. **Future:** `date > today` gives `date = today`.
11. **Cutoff:** `skipReason({ date }, { closed: false, importStartDate: cutoff.importStart, startingBalanceDate:
    cutoff.start, latestReconciledDate: cutoff.reconciled }, false)`. A `before_start` or `before_reconciled` row
    counts in `skippedBefore` either way. Its `skip` is that reason unless `include_before_start`.
    `skippedBefore` is the N of "Include N transactions…" and "N transactions will be skipped", so it stays
    when the box is ticked.

The order of `skip` reasons is `invalid` > `duplicate_in_file` > the cutoff.

### Zod (`file-import.ts`, `z` from `@hono/zod-openapi`)

- `FileDateFormat`: `z.enum(FILE_DATE_FORMATS)`.
- `FileImportMapping` (`.openapi("FileImportMapping")`): `{ date, payee, memo, outflow, inflow }`, each
  `z.number().int().min(0).nullable()`.
- `FileImportOptions` (`.openapi("FileImportOptions")`):
  - `no_header`: false;
  - `mapping`: nullable, default null, meaning auto-map;
  - `date_format`: nullable, default null;
  - `swap_inflow_outflow`: false;
  - `import_memos`: true;
  - `swap_payee_memo`: false;
  - `include_before_start`: false;
  - `remember`: true;
  - `today`: `IsoDate`, required.

  The defaults are Zod `.default(...)`.
- `FileImportRow` (`.openapi("FileImportRow")`): `date` (IsoDate, nullable), `payee_text`, `memo` (nullable),
  `amount` (Milliunits, nullable only when `skip` is `invalid`), `fitid` (nullable), `line`, `key` (nullable),
  `skip` (`before_start | before_reconciled | invalid | duplicate_in_file`, nullable).
- `FileImportDateQuestion` (`.openapi("FileImportDateQuestion")`): `{ first_value, formats }`.
- `FileImportPreview` (`.openapi("FileImportPreview")`):
  - `file_name`, `format`;
  - `labels` (CSV/TSV, else null) and `mapping` (used, CSV/TSV, else null);
  - `date_format` (used, or null while asking) and `date_question` (nullable);
  - `rows`, `skipped_before`, `row_count`.
- `FileImportResult` (`.openapi("FileImportResult")`): `{ imported, matched, skipped }`, non-negative integers.

The envelope (`dataEnvelope`) is FI-2's.

### Copy (`FILE_IMPORT_COPY`)

The EXF-531 strings, character for character, with "the YNAB field" as "the field":
- Toolbar and dialog 1: "File Import", "Import transactions from a bank file.", the intro, "Recommended formats:
  OFX, QFX, and CSV", "Supported formats: QIF", the duplicates line, "Don't show again", "Learn More", "Choose
  File", and accept `.csv,.tsv,.ofx,.qfx,.qif`.
- Dialog 2:
  - "Import Transactions", and the header `(n, file)` with "Transaction"/"Transactions" by `n`;
  - "Choose the CSV column to match the field.", the five select labels (with "Memo (optional)"), "No header row",
    "Swap Inflow and Outflow", "Remember setting for this account", "Import Memos" and "Swap Payee and Memo";
  - "Preview" and DATE / PAYEE / MEMO / OUTFLOW / INFLOW;
  - the unclear-date text `(file, value)`, "Save", the skipped line `(n)`, its explanation, the Include line `(n)`,
    "Cancel" and "Import".
- Result: "Import Successful" and "Import Matched", their texts `(imported, matched)` (singular for 1; the matched
  sentence left out for 0), and "OK".

### `resolveImportedPayee` (`imported-payee.ts`)

- Its input types:
  - `ImportPayee { id; name; system: string | null; deletedAt?: string | null }`. Live ordinary means
    `system === null && !deletedAt`, and hidden payees count.
  - `rules: readonly MatchableRule[]`.
  - The return type is `ResolvedPayee | null`, with null for empty (trimmed) text.
- Step 2 runs `pickRenameRule(text, rules whose payeeId is a live ordinary payee)`. A stale rule never hides a live one.
- Step 3, with several folded matches: the payee whose name equals the trimmed text, else the smallest `id`.
- `titleCaseAllCaps(s)`: if `s` has a letter (`\p{L}`) and no lower-case letter (`\p{Ll}`), each run of non-space
  characters is lower-cased and its first letter upper-cased (`7-ELEVEN` → `7-Eleven`, `#2` unchanged).
  Otherwise `s` is unchanged.
- `new_name = titleCaseAllCaps(text.trim()).slice(0, 200).trimEnd()`.

Categories (the EXF-518 table's last column) are FI-2's `categoryFor`, not this function's. The EXF-518 tests here
assert the payee and rule columns.

## Departures to check against the source

From the Driver's decisions on the plan, not observed:
- **Q1** The import key format above (`file:v1:…`, FITID or date/amount/hash/occurrence).
- **Q3** Caps of 2,000 rows and 2 MB.
- **Q6** The cutoff is the bank import's `skipReason`, including the 3-day reconciled grace and `importStartDate`.
- **Q7** Outflow and Inflow mapped to one column means a signed amount.
- **Q11** Bank sync will also title-case ALL-CAPS new payees (FI-5). Here only `titleCaseAllCaps` exists.

Made here, also not observed:
- `DD-MM-YY` reads `YY` as `20YY`. `May` is both `MMM` and `MMMM`, so a file whose dates are all in May may ask.
- The unclear-date select offers all 13 formats, not only the ones that parse.
- The key uses the file's date before the future clamp.
- Two-column amounts use magnitudes (`|inflow| − |outflow|`), so a bank that writes outflows as `-4.50` still reads
  as an outflow.
- `skippedBefore` counts before-cutoff rows whether or not "Include…" is ticked. An invalid or `duplicate_in_file` row is
  not counted, because its skip reason ranks above the cutoff.
- The copy singularises the count messages for 1 (`matchedMessage(1)`: "1 transaction has been…").
- An amount written with a leading decimal point (`-.50`, `.99`, `$.99`) gets a `0` in front before `parseAmount`, which
  would otherwise read `.50` as 50 (the `.` taken for a currency symbol). `readAmount` and `amountDecimal` in
  `file-import-read.ts` do this for CSV, OFX/QFX and QIF alike; `plan-import-read.ts` is untouched.
- A file in Windows-1252 without a declaration is detected by U+FFFD.

## Contract extensions (additive)

- `buildFileRows`'s `ctx` carries `planFormat` (step 1 of the detection needs the plan's `date_format`; acceptance
  1 runs "with plan format `MM/DD/YYYY`"), and its result carries `dateFormat` (the preview's "detected or
  required date format").
- Also exported: `readFileText`, `ParsedFile`, `columnLabels`, `qifDateText`, `CSV_FIELD_LABELS`,
  `FileImportMapping`, `FileImportRow` and `FileImportDateQuestion`.

## Out of scope (later units)

- FI-2:
  - Worker preview and import, R2, `import_settings`;
  - matching and `categoryFor`;
  - the caps' 413/422;
  - moving the Starting Balance date when earlier rows are included.
- FI-3: Match, Unmatch and payee corrections.
- FI-4: the dialogs.
- FI-5: the bank sync on `resolveImportedPayee`.

## Tests

`packages/schema/test/file-import-read.test.ts`, `file-import.test.ts` and `imported-payee.test.ts`. The fixtures
are in `packages/schema/test/fixtures/file-import/` (`sample.csv`, `three-rows.csv`, `sample.tsv`,
`sgml.ofx`, `xml.ofx`, `sample.qfx`, `sample.qif`). The tests' names per acceptance item are in the spec.

## Worker (FI-2): design

The Worker half of EXF-531, with EXF-518 on file import and EXF-515 AC6. A bank file is previewed and then imported
over REST and MCP. The import writes everything in one atomic batch: deduplicated, matched automatically to rows
entered by hand, with payees resolved through the renaming rules and categories from each payee's default. The bank
import is the pattern (docs/plaid-import-design.md, `services/plaid-sync.ts`).

### Tables (migration `20261124130000_file_imports.sql`, additive)
- `file_imports`: one row per stored file (`r2_key` `file-imports/<budget_id>/<file_id>` in `FILES`), kept 30 days
  (`expires_at`). These rows are plumbing, like `plan_imports`, so they get no change_log. The sweep soft-deletes up to 5
  expired rows on each preview or import (`deleted_at`) and deletes their R2 objects. A swept or expired id answers 410.
- `account_import_settings` (`account_id`, `format`): the remembered options for each account and file format. A row
  is written only when the options change, with a change_log row.
- `transactions.import_memo`: the file's memo on a row the import created or merged. Only the file import writes it;
  FI-3's Unmatch reads it. It is in `LinkCols` (`repositories/transactions.ts`), so other writers may leave it out of
  their row literals. `transactions.source` gains `file`.

### API
- `POST /budgets/{budget_id}/accounts/{account_id}/imports/preview`: multipart `file` with an optional `options` JSON
  field. Returns `FileImportPreview` + `file_id`, `options` (the effective options: the request's, then the remembered
  settings, then the defaults) and `expires_at`.
- `POST /budgets/{budget_id}/accounts/{account_id}/imports` `{ file_id, options }` → `{ imported, matched, skipped }`.
  The server re-reads the stored file and never trusts rows sent by the client.
- MCP `preview_transactions_file` and `import_transactions_file` (with `file_id`, or with `file_name` +
  `content_base64`) call the same service.
- Errors: 404, 410 `file_expired`, 413 `file_too_large`, 422 `too_many_rows` / `unreadable` / `no_rows` /
  `unsupported_format` / `date_format_unclear` / `account_closed`. `apiError` has no 410 or 413, so the route writes
  those two itself in the same `{ error: { id, name, detail } }` shape.

### Deciding a row (in file order, over the rows `buildFileRows` keeps)
1. Its key is known (a live row or a tombstone): matched, nothing written.
2. `pickMatch` finds a row entered by hand: it is merged and counted as matched. The hand row keeps its payee, memo,
   category, date and amount. It takes the import columns and `import_memo`, becomes cleared (reconciled stays
   reconciled) and approved, and its source stays null.
3. A Direct Import row (Plaid, or Plaid matched to a hand entry) with the same date and amount: skipped, with no
   tombstone.
4. Otherwise a new row is created: cleared, unapproved, `source "file"`. Its payee comes from `resolveImportedPayee`
   (`rename_rule_id` in the change_log after) and its category from `categoryFor` with the payee's default.
With "include earlier rows", a created or merged row dated before the Starting Balance moves the Starting Balance's
date to it. `import_start_date` doesn't change.

### One batch, set statements
In order:
1. payees insert, then its change_log;
2. merge change_log, merge lines, merge update;
3. insert of the creates and of each merge's fallback;
4. create change_log;
5. the Starting Balance move, the settings upsert and the sweep;
6. `recomputeDefaultsStmt(db, budgetId, "plan")`.

Each row statement takes one `json_each(?)` parameter, split at 900 KB, so there are no IN lists. "Key not known" and
"account open" are SQL over each JSON row, so a concurrent import changes nothing twice. D1 calls: 2 for a preview,
4 for an import (6 when MCP sends the file's content), whatever the number of rows.

### As built
- The batch of a file with new payees, creates and settings is **7 statements**, the same for 100 and 1,000 rows
  (payees insert and log, row insert and log, the settings insert and log, the defaults recompute); merges add three
  (log, lines, update) and the Starting Balance move two. Measured: preview 2 D1 calls, import 4, for 10, 100 and 1,000
  rows alike; MCP content adds the preview's 2.
- Create and merge rows travel as `[after-object, payee_id, import_memo]` and `[id, updated_at, before, after, date,
  amount, memo, cleared]`: the insert reads the row's columns out of the `after` object (`j.value->>'$[0].date'`), so
  no row is serialised twice. A merge's fallback insert (candidate changed meanwhile) never creates a payee.
- `transactions.import_memo` is written only by this import (create and merge) and read by FI-3's Unmatch. It is in
  `LinkCols` (one type-only line in `repositories/transactions.ts`), so the other writers' row literals compile
  without it and insert it as NULL.
- The route writes 410 and 413 itself; the MCP tools throw `<code>: <message>`.
