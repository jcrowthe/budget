# File import UI (EXF-531, unit FI-4): design

The browser half of File Import. The register's "File Import" button opens three dialogs in turn: dialog 1 "File
Import", dialog 2 "Import Transactions" (mapping, date format, options, skipped rows, live preview) and the result.
The server side is merged: FI-1 pure layer ([file-import-design.md](file-import-design.md)), FI-2 API, FI-3
match/unmatch. Plan: p_c62f35f9e111418dadd71bc7ad40c7e9. Web only: no Worker change, no migration, one ui-state key.

## Source

The copy comes from EXF-531 and FI-1's `FILE_IMPORT_COPY` (`packages/schema/src/file-import.ts`), character for
character, with "the YNAB field" written as "the field" and the product called "Budget". Dialog 1 was observed
read-only on 2026-11-24 (title, text, italic format lines, help box, footer, `accept`). Dialog 2 is built from the
ticket; anything not checked against the source is listed under Departures.

## Files

- `apps/web/src/file-import/`
  - `file-import.tsx`: the controller. Holds the step (`closed | intro | preview | result`), the chosen `File`, and
    one hidden `<input type="file" accept=".csv,.tsv,.ofx,.qfx,.qif">`. The input is always mounted, so the toolbar
    click can open the chooser directly when "Don't show again" is set.
  - `file-import-dialog.tsx`: dialog 1.
  - `file-import-preview.tsx`: dialog 2.
  - `file-import-date.tsx`: the amber ⓘ and its date-format popover.
  - `file-import-result.tsx`: the result.
  - `file-import-rows.ts`: local reading, the cutoff and the rows built in the browser.
  - `file-import.css`.
- `apps/web/src/api/file-imports.ts`: `previewFileImport` (multipart) and `importFile` (JSON).
- Small touches:
  - `RegisterToolbar.tsx`: an `onFileImport` prop and the button's `onClick`.
  - `Register.tsx`: mounts the controller.
  - `RegisterTable.tsx`: Bank Import Details for any non-null `source`.
  - `EntryRow.tsx`: the "Approve" label.
  - `packages/schema/src/ui-state.ts`: `hide_file_import_dialog`.

## Flow

1. **Button.** File Import calls `open()`. With `hide_file_import_dialog` set, the hidden input is clicked inside the
   same user gesture. Otherwise dialog 1 opens. The button stays disabled in a closed account, and on All Accounts
   when there is no open account (`closed` in Register.tsx, unchanged).
2. **Dialog 1.** Shows the intro, the two italic format lines and the duplicates help box. Its footer has "Don't show
   again", "Cancel" and "Choose File". The flag is written only when a file is actually chosen with the box ticked.
   Cancel, the X ("Close") and Escape write nothing.
3. **File chosen.** In parallel:
   - the browser reads the file (`decodeFileText` and `readFileText` from `@budget/schema/file-import-read`);
   - the Worker previews it (`POST …/accounts/{id}/imports/preview`, multipart, with options `{ today: localToday() }`).

   The Worker's answer supplies the `file_id`, the effective options (that account's remembered settings) and the
   used mapping, which the client pins as an explicit `mapping`. A read or preview error reopens dialog 1 with the
   message.
4. **Dialog 2.** Every option is local state. The rows come from FI-1's `buildFileRows(parsed, options, ctx,
   sha256)`, run in the browser on each change, so Swap, No header row, the mapping, the date format and Include
   update at once with no request. The context is:
   - `today`: `localToday()`;
   - `accountId`: the target account;
   - `planFormat`: the plan's `date_format.format` (`useBudgets`);
   - `cutoff`:
     - `start`: the earliest Starting Balance row;
     - `reconciled`: the latest reconciled row, both from the target account's transaction list (the same rules as
       the Worker's `startingBalanceDateQuery` and `latestReconciledDateQuery`);
     - `importStart`: the account's `import_start_date`.
5. **Account select.** Lists the open accounts in sidebar order, preselecting the current account (on All Accounts,
   the first open one). The Worker binds a stored file to its account and has no `{file_id}` preview, so a change
   uploads the same `File` again for the new account with the current options, which gives a new `file_id`.
6. **Import.** `POST …/imports { file_id, options: { …options, today } }`. The Worker reads the stored file again and
   decides every row, so the counts in the result are the server's. Afterwards every query of the plan is
   invalidated: transactions, accounts, months and payees all change.
7. **Result.** "Import Matched" with `matchedMessage(matched)` when nothing new was imported and something matched.
   Otherwise "Import Successful" with `successMessage(imported, matched)`, then "OK". Focus returns to the File Import
   button after every close.

## Dialog 2 content

- **Header:** `header(n, file)`, where n counts the kept rows (`skip === null`), then the account select.
- **CSV/TSV:**
  - the mapping help;
  - five selects (Date, Payee, Memo (optional), Outflow, Inflow), each with the column labels and a blank choice;
  - the preview table (date, payee, memo, signed amount written `-$4.50` / `+$250.00` as in the ticket);
  - the options No header row, Swap Inflow and Outflow, and Remember setting for this account.
- **OFX/QFX/QIF:**
  - a "Preview" table with DATE, PAYEE, MEMO, OUTFLOW and INFLOW;
  - four options: Import Memos, Swap Payee and Memo, Swap Inflow and Outflow, and Remember setting for this account.
- **Unclear date:** an amber ⓘ (`--labelWarning`) on the Date label opens a popover. It holds the `unclearDate(file,
  first_value)` text, a select of the 13 formats and "Save". Import is disabled while the question is open.
- **Skipped rows:**
  - When FI-1's `skippedBefore` > 0, a disclosure reads "N transactions will be skipped ▸" and expands to the
    ticket's explanation.
  - The "Include N transactions dated before account start date or last reconciliation" checkbox sets
    `include_before_start`.
  - Both lines use the ticket's plural wording for every N.
- **Rows:** the table lists the kept rows and scrolls inside the dialog. The dialog is at most the window minus 32 px.
- **Footer:** "Cancel" and "Import". Import is disabled while loading, while the date question is open, or when no
  row is kept.

## Decisions and departures

From the Driver (not re-opened):
- **Q9:** no "Learn More". The source's link points at its own help.
- **Q10:** enabled on All Accounts, with the first open account preselected.
- **Close pattern:** the X is "Close", and Escape closes. Dialog 1 gets a "Cancel" because our dialogs have one
  (`ExportDialog`, Import Plan's file step).

Made here:
- **Account change re-uploads the file.** The API has no `{file_id}` preview, and the import refuses a file stored for
  another account.
- **The browser builds the cutoff** from data it already loads. The server re-decides on import.
- **Ticket wording for the skipped line.** FI-1's `willSkip`/`include` say "1 transaction", but AC5 asks for "1
  transactions will be skipped". The UI keeps a local `SKIP_COPY`; packages/schema is closed to this unit.
- **ASCII minus in the CSV preview** (`-$4.50`, as the ticket writes it). The register and header keep U+2212.
- **Every plan query is invalidated after an import,** a superset of transactions and accounts.
- **Not on the Undo stack.** `apps/web/src/undo/**` is closed to this unit; this is a follow-up.
- **Not compared with the source:** the CSV table's column heads (hidden, for screen readers), the popover opening on
  a click of the ⓘ, and the dialog widths (480 / 720 px).

## Other touches

- **Bank Import Details** shows for every imported row (`tx.source !== null`), so file rows (`source: "file"`) get the
  button too. `BankImportButton` reads only `import_payee_name`, which FI-2 writes.
- **Editing an unapproved row** shows "Cancel" and "Approve". The Worker approves on any PATCH, but `draftToPatch`
  sends only what changed and `EntryRow` closed without a request when nothing had. So the label changes and an
  unedited unapproved row sends `{ approved: true }` (see As built).

## Tests

`e2e/file-import.spec.ts` covers AC1–AC12 (titles `AC<n> …`), with `e2e/support/file-import-seed.ts` (an API-made
`ZZ-TEST` plan, `showOnlyPlans`) and fixtures in `e2e/fixtures/file-import/` (`sample.csv`, `three-rows.csv`,
`sample.ofx`, `sample.qif`, all hand-made). AC3 records `/api/v1` requests and expects none on Swap.

## As built

- Files: `apps/web/src/file-import/` (`file-import.tsx` the controller and the one hidden input,
  `file-import-dialog.tsx`, `file-import-preview.tsx`, `file-import-date.tsx`, `file-import-result.tsx`,
  `file-import-rows.ts` the browser's reader, cutoffs, SHA-256 and `useFileRows`, `file-import.css`) and
  `api/file-imports.ts`. `Register.tsx` holds a ref and mounts `<FileImport>`; the toolbar has `onFileImport`.
- **The approval fix is two lines in `EntryRow.tsx`.** F6 above read the create path (`draftToCreate`) as the save.
  `draftToPatch` sends only the differences, and an empty patch closed the row with no request, so "Approve" on an
  unedited imported row approved nothing. An unapproved row with an empty patch now sends `{ approved: true }`. The
  label reads "Approve" only for an unapproved row being edited. Departure from "label only".
- **Departures kept:** D1 (account change uploads the same `File` again, new `file_id`); D2 always-plural skipped and
  Include lines; D3 Cancel in dialog 1; D4 no Learn More; D5 All Accounts enabled with the first open account; D6
  cutoffs from the target account's transaction list; D7 every plan query invalidated; D8 ASCII minus in the CSV
  preview.
- **Dialog 2 while loading:** it opens at once with "Reading the file…" and Import disabled; a file that cannot be read
  or uploaded sends the person back to dialog 1 with "This file cannot be imported: <reason>".
- **Only dialog 2 reads the file.** The browser's parse and the Worker's upload start together; the rows shown are
  the browser's, the Worker's file id and settled options (remembered settings, the mapping used, pinned so "No
  header row" keeps the column indices) come from the upload.
- **The ▸ / ▾ in the skipped line is text** with a symbol-font fallback (a headless Chromium without that glyph draws
  an empty box; the test reads the text).

> **Fixed height (Import Transactions).** Dialog 2 has a fixed height, `min(640px, 100vh - 32px)`, so the "Reading the file…" state and the loaded preview share one box: Cancel does not move when the preview arrives (a press that straddled the move was lost). The body scrolls inside.
