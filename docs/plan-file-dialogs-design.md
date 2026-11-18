# Plan file dialogs: Export Plan and Import Plan screens (EXF-476 criteria 1 and 8, EXF-477 screen half)

The API halves are live: `GET /api/v1/budgets/{id}/export` ([plan-export-design.md](plan-export-design.md)) and
`POST /api/v1/budgets/import` with `dry_run`, `continue` and cancel ([plan-import-design.md](plan-import-design.md)).
This Build adds the two screens: the plan menu's **Export Plan** entry with its dialog and "Don't show again", and an
**Import Plan** dialog opened from the plans page. **Web only: no Worker change, no migration, no file under
`apps/web/src/shell/**`.** Tasks: [plan-file-dialogs-spec.md](plan-file-dialogs-spec.md). Polish:
`docs/plan-file-dialogs-polish.md` (Designer).

## The source app in this Build

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the
Clerk's step 2.

**The source has no plan import at all:** the Import Plan dialog is this app's own, built from EXF-477 and in the look
of this app's dialogs. **The source's Export Plan dialog lives in its plan menu, which lists the owner's other plans
by name, so nobody opens it.** EXF-476's text holds what was seen of it on 15 Nov (title, body sentence, checkbox,
buttons).

**What may be read, and nothing else:** in the Clerk's tab as it stands (the test plan's Plan page), **the source's
loaded style rules and its already-loaded static script files** (same-origin files the page has loaded, read without
navigating; the Export Plan dialog's words may be found there and compared with the ticket's). In a tab of your own on
the same address you may add throw-away elements with the source's classes to measure a look (a dialog's frame, a
checkbox row, a primary button), and then close that tab.

**What nobody ever does in the source, each with its reason:**
- **Open the plan menu, Export Plan, or the address `/users/budgets`.** Reason: they list the owner's other plans by
  name; and an export would write the owner's data to a file in a box.
- **Click anything on the page: a row, a cell, a button, a month, an account; "these clicks and no other" means none
  here.** Reason: the last Build's sub-agent clicked a row to try something; this Build has nothing to try in the source.
- **Type into any field; create, edit or delete anything; open any account page, All Accounts, Reconcile, Reflect or
  settings.** Reason: it is the owner's account.
- **Read or print any text of the sidebar's header or the account menu, or print the sidebar's or the page's whole
  text.** Reason: the plan's name and the signed-in address are there.
- **Fetch a script file the page has not loaded, let a sub-agent do so, or keep a copy of a source script in the
  repository.** Reason: only what the tab already holds is read, and nothing of the source is committed.
- **Leave the tab changed; keep a screenshot of the source that shows more than your own probe elements.**

So the Import dialog is **"not compared: this app's own"** and the Export dialog's behaviour is **"not compared: built
from the ticket"**; only looks and words read from the style rules or the loaded script files count as compared. Both
are complete and acceptable answers.

**Each step states in its report, for itself only, every action it took in the source app (style rules read, script
files read and probe elements included), or that it opened nothing. Nobody but the Clerk runs the Clerk's commands; a
step that runs them has opened the source and says so.**

## Source (what was read, 18 Nov)

Notes: `/workspace/scratch/source/plan-file-dialogs/notes.md`; probe image `probe-export-dialog.png` (own elements
only, dark theme). **Architect's actions in the source:** none by me; my sub-agent, in the Clerk's tab, read the style
rules, the CSS variables and the list of loaded scripts, and searched already-loaded same-origin scripts (`wrapper-*.js`
held every hit) for strings; it opened one tab of its own on the test plan's address, added a white cover and a probe
dialog, screenshotted the probe only, and closed that tab. No click, no typing, no navigation of the Clerk's tab.

- **Words (compared: read from loaded script files):** title `Export Plan`; body `Your data is just that—yours! All
  the requested data will be exported in CSV format so it's easy to open in other applications.` (U+2014 with no
  spaces; ASCII apostrophe); checkbox `Don't show again` (ASCII apostrophe, also its `aria-label`); `Cancel`
  (secondary), `Export` (primary); the close button's label is `Close`. Same as EXF-476.
- **Behaviour seen in the script:** "Don't show again" is stored per plan and only when Export is pressed with the
  box ticked (Cancel stores nothing); when set, the entry exports straight away; the stamp is local time; Export is
  disabled once pressed. Our key lives in `ui-state` (per plan, on the server) instead of local storage.
- **Looks (compared: read from style rules; values in the notes, section B/C):** 480 px dialog, 48 px header,
  body 14 px/500 line-height 1.5, footer padding 16 gap 8 with the checkbox pushed left, checkbox label 0.9rem/400
  in labelSecondary, 13 px square. This app's `.dialog.form` (`shell/global.css:345`) already gives the frame and
  buttons; the Designer compares the rest.

## Approach

### Export Plan (EXF-476 criteria 1, 8)

- `apps/web/src/menu-actions/export-plan.tsx` exports `action = { entry: "export-plan", Dialog: PlanExportDialog }`
  (model: `menu-actions/new-plan.tsx`; `shell/planMenuEntries.ts` untouched). The shell mounts the Dialog with
  `budgetId`.
- `PlanExportDialog` reads the shell's `useUiState(budgetId)` (same key, no second fetch); renders nothing until
  it has an answer; with `hide_plan_export_dialog` true it exports at once, unseen. Else the dialog: `.dialog.form` with header `Export Plan` and a `Close` (✕) button, the
  body sentence, footer `Don't show again` checkbox on the left, `Cancel`, primary `Export`.
- `Export`: if ticked, `useSaveUiState(budgetId).mutate({ hide_plan_export_dialog: true })`; the dialog disappears at
  once and the download starts: `GET /api/v1/budgets/{id}/export?now=<local YYYY-MM-DDTHH:mm>`; the blob is saved
  under the file name of `Content-Disposition` (`filename="…"`). `Cancel`, ✕ and Escape close with no request.
- **A failed export** (non-2xx or network) shows a small alert dialog `Export Plan` with `The plan could not be
  exported.` and the server's `detail` when there is one, and `OK`. Never a silent nothing.
- Focus stays inside (Tab cycles); on close it goes to the plan button (`.plan-button, .rail-logo`, as
  `plan-settings/PlanSettingsDialog.tsx:30`).

**"Don't show again" key.** `hide_plan_export_dialog: z.boolean()` added to `UI_STATE_FIELDS` in
`packages/schema/src/ui-state.ts` (its comment: "a later Build adds a key here and nowhere else"). Nothing else is
needed: the service validates and reads through `UI_STATE_FIELDS` (`apps/worker/src/services/ui-state.ts`), the rows
are key/value in `ui_state` (`db/schema/ui-state.ts`), the web types derive from the schema, MCP excludes ui-state
(`test/mcp-coverage/ui-state.ts`). **No migration.**

### Import Plan (EXF-477)

**Where.** One button `Import Plan` on `/plans`, a card `li` right after Create New Plan in the same grid, with the
same card look (`.plans-list-create`) and an icon of its own (`plan-import-dialog-icon.tsx`). Not in the plan menu.

**Steps** (one dialog, `role="dialog"`, `aria-modal`, title `Import Plan`, 640 px wide, `max-width: calc(100vw -
32px)`, `max-height: calc(100vh - 32px)`, the body scrolls inside):

1. **File.** Sentence: `Choose the zip made by Export Plan, or its Plan and Register files.` A drop zone that is a
   `<button>` (click, Enter, Space open the hidden `<input type="file" multiple accept=".zip,.csv,.tsv">`; drop works
   too). Refused in words before any upload (`role="alert"`, no request): a name not ending `.zip`, `.csv` or `.tsv`
   (`<name> is not a .zip, .csv or .tsv file.`); a zip with any other file, or three or more files (`Choose one zip,
   or the two files: Plan and Register.`); one `.csv`/`.tsv` alone (`Choose both files: Plan and Register.`); a total
   over `IMPORT_LIMITS.uploadBytes` (`The files are larger than 20 MB, the most an import takes.`, the number from
   the constant). Accepted files → one dry run (`Reading the files…`).
2. **Preview** (from `PlanImportPreview`): **Plan name** (text field, max 100) and **Export date** (text field in the
   preview's date format, parsed by the preview formatter's `parseDate`; bad text → inline error, Import disabled);
   **Formats read**: currency symbol (text, ≤ 8), its place (Before / After / Don't show), decimal separator
   (`.` `,` `-` `/`), date format (the seven `DATE_FORMATS`); **Accounts** table: name, type select
   (`IMPORT_ACCOUNT_TYPES` with `ACCOUNT_TYPE_LABEL`), proposed type and its reason, transactions; **counts**
   (accounts, category groups, categories, months, transactions, splits, transfers paired, scheduled); **Warnings**
   (`message`, `×count` when > 1) with `Showing <n> of <warning_count>` when cut; **Mismatches** (category, month as
   `monthLabel` of `plan-export.ts`, Activity/Available, expected, got) with `Showing <n> of <mismatch_count>` when cut.
   **When `date_question` is not null** its text is shown with one radio per option (the date written out, e.g.
   `October 3, 2026`, and its format); `Import` stays disabled until one is chosen; the answered question stays shown.
   **A change of an account's type, the date format, a currency field, or the export date (on blur)** sends the dry
   run again with the options; only the latest answer is applied (older ones aborted and ignored). While one is out:
   `Updating preview…`, Import disabled. A refused dry run (422) shows the server's words and keeps Import disabled.
   **The preview step sends no request without `dry_run=true`.**
3. **Import** (`Import` primary, `Cancel` secondary): one `POST /budgets/import` without `dry_run`, same files and
   options. 201 `done` → result. 202 `writing` → progress: `Writing step <chunks_done + 1> of <chunk_count>` and a
   `role="progressbar"` (`aria-valuenow` = chunks_done, `aria-valuemax` = chunk_count), and the sentence `Keep this
   page open until the import finishes. If it stops, the new plan never appears and what was written is removed
   later.` Then `POST …/continue` one at a time until 201.
   - `Cancel import` (while writing) asks once in the dialog: `Cancel this import? Everything written so far is
     removed.` [`Keep importing`] [`Cancel import`]. On yes: no further continue is sent; after the one in flight
     returns, `DELETE /budgets/import/{id}`; then `The import was cancelled. Nothing was kept.` and `Close`. If the
     import finished first (DELETE 409 `import_finished`), the result is shown.
   - **A failed continue** (network error, 5xx or 422): `This step could not be written: <detail>` with `Try again`
     (sends the same continue; the API applies a step once) and `Cancel import`. Never a spinner left. A 409 (`import_abandoned`)
     means the server already removed it: its words, `Nothing was kept.`, `Choose another file` and `Close`.
   - **Closing while writing** (✕, Escape) asks the same question as `Cancel import`; yes cancels, then closes.
     **Leaving the page while writing**: `useBlocker` asks the same (yes → cancel, then go); a reload or tab close
     gets the browser's `beforeunload` prompt.
   - **An import left unfinished** (page closed anyway) stays a hidden plan that no read shows (plan-import-design,
     "Invisible until done"); the next import started a day or more later removes it: `sweep` in
     `apps/worker/src/services/plan-import.ts:347`, called first by `startImport` (`:379`), stale after `staleMs`
     24 h (`:33`). The writing sentence above tells the person so.
4. **Result.** `Imported <name>.`, the counts, the warnings and mismatches with their totals, `Open Plan` (primary,
   navigates to `/<budget_id>/budget` and closes) and `Close`. On `done` the dialog calls
   `queryClient.invalidateQueries({ queryKey: ["budgets"] })`: the shell's one plans query refetches once and the
   card appears without a reload; the dialog never fetches the list itself.
- **A file that cannot be read** (the first dry run answers 422): the file step stays, with `This file cannot be
  imported: <detail>` (`role="alert"`). The detail names the file and line when the server does (e.g. `Register file
  line 7, column 9: "$1,23.45" is not an amount`). Nothing in the dialog or the API module writes file content or
  server answers to the console.
- Focus stays inside the dialog (Tab cycles), starts on the drop zone, and returns to `Import Plan` on close.

**Amounts and dates in the preview (note 4).** Pure functions exist; no shared-module edit:
`previewFormatter(formats)` = `planFormatter({ currency_format: currencyFormatOf(s.iso_code, s.example_format,
s.symbol_placement), date_format: { format: s.date_format } })` with `s = formatsFromImport(formats)`
(`packages/schema/src/plan-formats-catalogue.ts`, `plan-formats.ts`). This is exactly what the Worker stores for the
new plan (`importedFormatColumns`, `services/plan-import.ts:157`) and what `toApi` turns back into its
`currency_format` (`services/budgets.ts:30`), so the preview shows the new plan's own formats. Mismatch amounts use
`.money`, the export date field `.date`/`.parseDate`. The date question's options are written out with the month name
(`toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })`, as `plan/monthNav.ts:21` does for months),
because the plan's own format is the thing in question.

## The server's shapes, and the one stand-in

Errors are `{ error: { id, name, detail } }` (`apps/worker/src/middleware/errors.ts:27`). Continue answers 409
`import_abandoned`, 422 `import_failed` or 404 (`services/plan-import.ts:460-565`); cancel of a finished import 409
`import_finished`. `apiFetch` sends JSON only, so the two new API modules use `fetch` with `FormData`/blob and throw
`ApiError` (imported from `api/client.ts`). **The stand-in (state 7)** fulfils one `continue` with 422 `{ "error": {
"id": "422", "name": "import_failed", "detail": "The step did not apply; call continue again" } }`, the server's own
answer for a step that did not apply (`services/plan-import.ts:562`); it never reaches the server, so `Try again`
finishes the import for real.

## D1 calls

No Worker operation changes; **the import's D1 calls are unchanged** (plan-import-design table): dry run **0** (0 R2);
call 1 **≤ 3** (R2 ≤ 2); continue **≤ 3** (R2 ≤ 2); cancel **2** (R2 1). Export **16** (plan-export-design "D1 calls").
ui-state PUT (Don't show again) **4** (`services/ui-state.ts`: findActive, batch, then the read's findActive and list);
the GET is the shell's, not repeated. Plans list refresh after an import: **1** (plans-list-design). The dialogs add no
call of their own.

## Downstream effects

- The plan menu's `Export Plan` becomes enabled for every plan. **Departure:** `e2e/plan-menu.spec.ts` test "6
  EXF-470…" lists `Export Plan` among the enabled entries (was disabled). `e2e/shell-compare.spec.ts` asserts only
  the names: unchanged.
- The plans page grid gains one card; no existing spec counts its items (`e2e/plans-list*.spec.ts` read).

## Out of scope and found, not fixed

Out: a real export from the source app; an import entry in the plan menu; flag names (EXF-480); loans; the file
format; a currency picker. **Found, not fixed:** an unknown currency symbol is stored as the first currency with the
same digits (`formatsFromImport`, `plan-formats-catalogue.ts:280`); the preview shows that, but offers no choice.

## Acceptance

Real local server, real files (hand-written in the ticket's format with made-up names, or this app's export).
Every plan a spec makes carries `testName`'s prefix (the import's `name` typed into the preview) and is deleted after.
`realClick` for clicks. No fixed browser clock where a spec exports (the API refuses a `now` a day off the server's).

Copy and refusal sentences are those of "Approach"; each case names its spec.

1. **EXF-476 c1** (`plan-export-dialog.spec.ts`): plan menu → Export Plan → the dialog's exact words and buttons;
   Cancel, ✕ (`Close`) and Escape each close it with no request to `/export` and no download.
2. **Export downloads**: Export → dialog gone, one download `Budget Export - <SafeName> as of <stamp>.zip` (stamp =
   the browser's local minute ± 1) holding `… - Plan.csv` and `… - Register.csv`.
3. **EXF-476 c8**: tick + Export → ui-state polls to `hide_plan_export_dialog: true`; Export Plan again downloads with
   no dialog. Tick + Cancel (another plan) saves nothing.
4. **Export failure**: the plan deleted through the API after the page loaded; Export → the alert with the server's
   words; `OK` closes it.
5. **Button and refusals** (`plan-import-dialog.spec.ts`): `Import Plan` beside `Create New Plan`; the drop zone
   opens the file chooser by mouse and by Enter; `.xlsx`, zip + csv, three files, one csv, 21 MB: each its sentence,
   no request to `/budgets/import`.
6. **Consistent preview**: the API export of a seeded plan (checking, card, a category with money) → name, export
   date in the file's date format, formats, accounts with proposed type and reason, counts, no mismatch; exactly one
   request, `dry_run=true`.
7. **One-call import**: name set to a `testName` → Import → one request without `dry_run` → result → `Open Plan` →
   `/<id>/budget` with the name in the page title; `/plans` shows the card with exactly one `GET /api/v1/budgets`
   after done and no reload.
8. **Preview edits, date question** (`plan-import-dialog-preview.spec.ts`): hand-written zip, every day ≤ 12, flag
   `Tax`, one Activity edited → the question with two options, Import disabled, the warning, the mismatch in the
   file's format; an answer → dry run with `date_format`, Import enabled; an account type → `account_types`; the
   decimal separator → `currency_format`. **Every `/budgets/import` request before Import has `dry_run=true`.**
9. **Unreadable file**: Register cell `"$1,23.45"` → the alert naming `Register file line` and the text; no console
   message holds any cell text of the file.
10. **Several steps** (`plan-import-dialog-steps.spec.ts`): generated 6,000 Register rows → 202 `chunk_count ≥ 3`;
    `Writing step k of n` advances; continues never overlap; 201 → result.
11. **Cancel**: `Cancel import` → question → yes → one DELETE, `Nothing was kept`, plan absent from `GET /budgets`;
    ✕ while writing asks the same; `Keep importing` goes on to done.
12. **Failed step**: the stand-in on the first continue → `Try again` and `Cancel import`, no spinner; `Try again` →
    done, the plan listed once.
13. **Round trip** (`plan-import-dialog-roundtrip.spec.ts`): seeded plan with a card, a split, a transfer, a scheduled
    row and a hidden category → Export by the dialog → that zip into Import → Open Plan; Ready to Assign, one
    category's Available and the card's balance (API) equal the first plan's; the Plan page shows the same Ready to
    Assign text.
14. **Narrow, keyboard** (`plan-export-dialog-narrow.spec.ts`, `plan-import-dialog-narrow.spec.ts`, 1024×700): both
    dialogs inside the window; 100-character plan and account names cut with ellipsis and `title`; a long warning
    wraps; 30 accounts scroll inside the dialog, not the page; Tab/Shift+Tab stay inside; Escape closes; focus returns
    to the plan button / `Import Plan`.
15. **Pure logic** (`plan-import-dialog-logic.spec.ts`): `checkImportFiles` (each refusal, both accepted forms); the
    latest-only sequencer drops an older answer arriving last.

### Looking (Tester's main work)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state **against the real
local server with a real file** (no stand-in, except state 7), takes a **fresh** screenshot in this Thread, **opens
it**, and writes one sentence on what is seen in it (not what a measurement says). The report lists `state, size,
file, sentence`. A state without its two entries is PARTIAL with the words "not looked at". **Eight states, sixteen
screenshots, every one opened; take no others unless something looks wrong.**

1. The Export Plan dialog, opened from the plan menu.
2. The plans page with the Import Plan button beside Create New Plan.
3. The Import dialog's first step, before a file is chosen.
4. The preview of a consistent file: name, export date, formats, the accounts with their types, the counts.
5. The preview of a file with an unclear date format, a warning and a mismatch: the date question unanswered, Import
   disabled.
6. An import of a file large enough for several steps, while it writes: the progress.
7. A step that failed while writing (the one stand-in: one `continue` answer failed by the spec): what the dialog
   offers.
8. The result of a finished import, and the error shown for a file that cannot be read (file and line named), as two
   screenshots of this state at each size if they cannot be one.

(For state 6 the Tester may slow a real `continue` with `page.route(…, r => setTimeout(() => r.continue(), ms))`:
it still reaches the server and is not a stand-in.)

## The order of the work (Implementer: commit after each part)

1. Export Plan: the action file, the dialog, the download, "Don't show again", its specs.
2. Import Plan: the button, the file step with its refusals, the preview of a consistent file.
3. The preview's choices: account types, the date question, the formats, the warnings and mismatches.
4. Import, progress, cancel, the failed step, the result and Open Plan.
5. The round trip through both screens; the narrow window; the keyboard.

**If the Build runs long, parts 1, 2 and 4 are the ones that must be whole** (a consistent file goes in by the screen
and the plan opens); say plainly in the report what of parts 3 and 5 is not done, and the Lead tickets it. A part half
done is worse than a part left out.

## Manifest

touches: [apps/web/src/menu-actions/export-plan.tsx, apps/web/src/plan-export/**, apps/web/src/plan-import/**, apps/web/src/plans/plans-list-page.tsx, apps/web/src/plans/plans-list.css, apps/web/src/api/plan-export.ts, apps/web/src/api/plan-import.ts, packages/schema/src/ui-state.ts, e2e/plan-export-dialog*.spec.ts, e2e/plan-import-dialog*.spec.ts, e2e/support/plan-import-dialog-files.ts, e2e/plan-menu.spec.ts, docs/plan-file-dialogs-design.md, docs/plan-file-dialogs-spec.md, docs/plan-file-dialogs-polish.md, docs/README.md]
shared: []
migrations: 0
