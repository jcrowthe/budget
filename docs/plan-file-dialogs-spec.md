# Plan file dialogs: implementation spec (EXF-476 criteria 1 and 8, EXF-477 screens)

Design, copy and acceptance: [plan-file-dialogs-design.md](plan-file-dialogs-design.md). Commit after each part of
"The order of the work". Run `pnpm check` and the specs of the part (`pnpm e2e <specs>`), never the whole suite.
Out of bounds (brief note 8): `apps/web/src/shell/**` (import only), `router.tsx`, `api/client.ts` (import
`ApiError` only), `register/**`, `plan/**`, `account/**`, every Worker file, `paths.always_overlap`, `scripts/**`,
`e2e/support/real-click.ts`. No dependency, no migration. Nothing formats money or dates by itself
(`scripts/test/plan-formats-screens.test.ts`); no `console.*` in the new code.

## Part 1: Export Plan

**T1. Key.** `packages/schema/src/ui-state.ts`: add `hide_plan_export_dialog: z.boolean(),` to `UI_STATE_FIELDS`
after `hide_reconcile_difference_dialog`. Nothing else (design "Don't show again key"). Verify: `pnpm check`
(`apps/worker/test/ui-state.test.ts` unchanged and green).

**T2. `apps/web/src/api/plan-export.ts`** (new)
```ts
/** The browser's local minute as the export's `now`: "YYYY-MM-DDTHH:mm". */
export function exportNow(at: Date): string;
/** GET /api/v1/budgets/{id}/export?now=…; saves the blob under the Content-Disposition file name; returns it.
 *  Non-2xx → throws ApiError(status, id, name, detail) from the JSON error body; network → rethrows. */
export async function downloadPlanExport(budgetId: string, now: string): Promise<string>;
```
File name: `/filename="([^"]+)"/` of the header, else `Budget Export.zip`. Save as `downloadExport` does
(`api/transactions.ts:262`: object URL, `<a download>`, click, revoke after 1 s). `credentials: "same-origin"`.
Build `now` from `getFullYear/getMonth/getDate/getHours/getMinutes` with `padStart(2, "0")` (no `/` in it).

**T3. `apps/web/src/plan-export/plan-export-dialog-focus.ts`** (new, used by both dialogs)
```ts
/** While mounted: Tab / Shift+Tab cycle through the focusable elements inside `box` (capture phase);
 *  Escape calls onEscape (preventDefault + stopPropagation). On unmount focuses `returnTo()` if connected. */
export function useDialogFocus(
  box: RefObject<HTMLElement | null>,
  opts: { onEscape: () => void; returnTo: () => HTMLElement | null; initial?: RefObject<HTMLElement | null> },
): void;
```
Focusables: `button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])`
inside `box`, visible. Model: `shortcuts/KeyboardShortcutsDialog.tsx:22-52`. Keep `onEscape` in a ref.

**T4. `apps/web/src/plan-export/plan-export-dialog.tsx` + `plan-export-dialog.css`** (new)
```ts
export function PlanExportDialog(props: { budgetId: string | null; onClose: () => void }): JSX.Element | null;
```
- `type Phase = "wait" | "ask" | "working" | "failed"`. `ui = useUiState(budgetId ?? undefined)`; `save =
  useSaveUiState(budgetId)`.
- `wait`: render null; when `ui.isSuccess` → `hide_plan_export_dialog ? run() : "ask"`; `ui.isError` → `ask`.
- `ask`: portal into `document.body`: `.dialog-backdrop` > `div.dialog.form.plan-export-dialog` (`role="dialog"`,
  `aria-modal="true"`, `aria-labelledby` the `h2`). Header `h2` `Export Plan` + `button.icon-button`
  `aria-label="Close"` with `CloseIcon` (from `shell/icons`). Body `p` with the sentence of the design, copied
  exactly (U+2014, ASCII `'`). Footer: `label.plan-export-dialog-check` > `input[type=checkbox]` + `Don't show
  again`; `button.secondary` `Cancel`; `button.primary` `Export`. Cancel / ✕ / Escape → `onClose()`.
- `Export`: `if (checked) save.mutate({ hide_plan_export_dialog: true })`; then `run()`.
- `run()`: phase `working` (render null), `downloadPlanExport(budgetId, exportNow(new Date()))`; success →
  `onClose()`; failure → `failed`: the same frame titled `Export Plan`, `role="alertdialog"`, body `The plan could not
  be exported.` and, for an `ApiError` with a detail, a second line with it; footer `OK` (primary) → `onClose()`.
- `useDialogFocus` with `returnTo: () => document.querySelector(".plan-button, .rail-logo")`; initial focus on
  `Export` (ask) / `OK` (failed). A ref guards `run()` against a second call.
- CSS (`.plan-export-dialog …` only): checkbox row `margin-right: auto`, gap 4 px, 0.9rem/400 `var(--labelSecondary)`,
  footer `align-items: center`; body text 14 px/500, line-height 1.5. Theme variables only.

**T5. `apps/web/src/menu-actions/export-plan.tsx`** (new)
```ts
export const action: PlanMenuAction = { entry: "export-plan", Dialog: PlanExportDialog };
```

**T6. Specs.** `e2e/plan-export-dialog.spec.ts`: design cases 1-4. Downloads: `page.waitForEvent("download")`;
`suggestedFilename()`; read the zip with `download.path()` and check the two entry names by scanning the central
directory (or `isZip` + a small reader in the support file); count requests to `/export` with `page.on("request")`.
Case 3 reads `GET /api/v1/budgets/{id}/ui-state` by `expect.poll`. Case 4: `request.delete` of the plan after
`page.goto`, then Export → alert. `e2e/plan-export-dialog-narrow.spec.ts`: design case 14 (export half) at
1024×700: keyboard open (plan button focus, Enter, ArrowDown to `Export Plan`, Enter), Tab ×N stays in the dialog,
Escape, `document.activeElement` is the plan button; the dialog's box inside the viewport.
**Departure:** `e2e/plan-menu.spec.ts` test "6 EXF-470…": add `"Export Plan"` to the `enabled` list (and the comment
"Export Plan by EXF-476 (menu-actions/export-plan.tsx)"). After T5, run the unchanged test once and quote its failing
line in the report; then edit it.

## Part 2: Import Plan button, file step, consistent preview

**T7. `apps/web/src/api/plan-import.ts`** (new)
```ts
import type { PlanImportOptions, PlanImportPreview, PlanImportResult, PlanImportCancelResult } from "@budget/schema/plan-import";
export function importForm(files: readonly File[], options: PlanImportOptions): FormData;
export function previewImport(files: readonly File[], options: PlanImportOptions, signal?: AbortSignal): Promise<PlanImportPreview>;
export function startImport(files: readonly File[], options: PlanImportOptions): Promise<PlanImportResult>;
export function continueImport(importId: string): Promise<PlanImportResult>;
export function cancelImport(importId: string): Promise<PlanImportCancelResult>;
```
- `importForm`: `append("file", f, f.name)` per file; `name`, `export_date`, `date_format` when set; `currency_format`
  and `account_types` as `JSON.stringify` when set (route `routes/plan-import.ts`, `jsonField`).
- URLs: `POST /api/v1/budgets/import?dry_run=true` (preview), `POST /api/v1/budgets/import`, `POST
  /api/v1/budgets/import/{id}/continue`, `DELETE /api/v1/budgets/import/{id}`; `credentials: "same-origin"`, `Accept:
  application/json`, no Content-Type (the browser sets the multipart boundary).
- Parse 2xx with `PlanImportPreviewResponse` / `PlanImportResultResponse` / `PlanImportCancelResponse` → `.data`.
  Non-2xx → `ApiError(status, error.id, error.name, error.detail)`; unparsable body → `ApiError(status, String(status),
  "error", statusText)`. Network errors propagate (`TypeError`). Never log.

**T8. `apps/web/src/plan-import/plan-import-dialog-files.ts`** (new, pure)
```ts
export type FileCheck = { ok: true; kind: "zip" | "pair" } | { ok: false; message: string };
export function checkImportFiles(files: readonly { name: string; size: number }[]): FileCheck;
```
Order: empty → `Choose the zip made by Export Plan, or its Plan and Register files.`; any bad extension (case
insensitive) → `<name> is not a .zip, .csv or .tsv file.` (first one); one `.zip` alone → zip; two of `.csv`/`.tsv`
→ pair; one `.csv`/`.tsv` → `Choose both files: Plan and Register.`; else → `Choose one zip, or the two files: Plan
and Register.`; then total size > `IMPORT_LIMITS.uploadBytes` → `The files are larger than <uploadBytes / 2**20> MB,
the most an import takes.`

**T9. `apps/web/src/plan-import/plan-import-dialog-latest.ts`** (new, pure)
```ts
/** Each next() aborts the previous controller and returns a sequence number; isLatest(seq) is true only for the last. */
export function latestOnly(): { next(): { seq: number; signal: AbortSignal }; isLatest(seq: number): boolean };
```

**T10. `apps/web/src/plan-import/plan-import-dialog-format.ts`** (new, pure)
```ts
export function previewFormatter(formats: ImportFormats): PlanFormatter; // design "Amounts and dates in the preview"
export function questionDate(iso: string): string; // toLocaleDateString("en-US", { dateStyle: "long", timeZone: "UTC" })
```

**T11. Dialog.** New files in `apps/web/src/plan-import/`:
- `plan-import-dialog.tsx`: `export function PlanImportDialog(props: { onClose: () => void; returnTo: () =>
  HTMLElement | null }): JSX.Element` — portal, `.dialog-backdrop` > `div.dialog.form.plan-import-dialog`
  (`role="dialog"`, `aria-modal`, `aria-labelledby`), header `Import Plan` + ✕ `Close`, a scrolling body, a footer per
  step. Holds `step: Step` (below), `files: File[]`, `options: PlanImportOptions`, `preview`.
- `plan-import-dialog-drop.tsx`: the drop zone: `button.plan-import-dialog-drop` (`aria-describedby` the sentence)
  opening a visually hidden `input#plan-import-file` (`type="file" multiple accept=".zip,.csv,.tsv"`); `onDragOver`
  preventDefault; `onDrop` takes `dataTransfer.files`; the input's value is reset after each choice. Refusal under it
  in `p[role="alert"]`.
- `plan-import-dialog-preview.tsx`: the preview body (design step 2). Labels: `Plan name`, `Export date`, `Currency
  symbol`, `Symbol placement` (`Before amount` / `After amount` / `Don't show`), `Decimal separator`, `Date format`;
  section headings `Accounts`, `Counts`, `Warnings`, `Mismatches`. Accounts: `table` in
  `div.plan-import-dialog-accounts` (`max-height: 240px; overflow: auto`), columns `Account`, `Type`, `Proposed`,
  `Transactions`; the Type `select` has `aria-label="Type of <name>"`; name cells `text-overflow: ellipsis` + `title`;
  the Proposed cell shows `ACCOUNT_TYPE_LABEL[proposed_type]` with the reason below in small secondary text.
  Counts as a `dl`. The date question: `fieldset` with `legend` = `question`, radios labelled `<questionDate(date)>
  (<date_format>)`.
- `plan-import-dialog-run.ts`: `useImportRun()` (part 4).
- `plan-import-dialog-icon.tsx`: `ImportPlanIcon` (24×24 document with an up arrow, `currentColor`).
- `plan-import-dialog.css`: width 640 px, `max-width: calc(100vw - 32px)`, `max-height: calc(100vh - 32px)`, flex
  column; body `overflow: auto; min-height: 0`; warnings/mismatch text `overflow-wrap: anywhere`. Theme variables only.

```ts
type Step =
  | { kind: "file"; error: string | null }           // refusal or the server's 422 ("This file cannot be imported: <detail>")
  | { kind: "reading" }                              // first dry run: "Reading the files…"
  | { kind: "preview"; updating: boolean; error: string | null }
  | { kind: "writing"; result: PlanImportResult; confirm: "cancel" | "close" | "leave" | null; stopping: boolean }
  | { kind: "failed"; result: PlanImportResult; detail: string }   // Try again / Cancel import
  | { kind: "ended"; detail: string }                // 409 from continue: "Nothing was kept." Choose another file / Close
  | { kind: "cancelled" }                            // "The import was cancelled. Nothing was kept." Close
  | { kind: "done"; result: PlanImportResult };      // result, Open Plan / Close
```
Part 2 scope: file → reading → preview (read-only display of a consistent file, name and export date fields, Import
and Cancel buttons; Import wired in part 4). First dry run options `{}`; on 422 back to `file` with the detail.
Import disabled when: a dry run is out, the last one failed, the name is empty, the export date does not parse, or
`date_question` is unanswered.

**T12. Plans page.** `apps/web/src/plans/plans-list-page.tsx`: after the Create New Plan `li`, a second `li` with
`button.plans-list-create.plan-import-dialog-open` (ref `importRef`) holding `ImportPlanIcon` and `<span>Import
Plan</span>`; state `importing`; render `<PlanImportDialog onClose={() => setImporting(false)} returnTo={() =>
importRef.current} />`. `plans-list.css` only if the icon needs a size rule.

**T13. Support and specs.** `e2e/support/plan-import-dialog-files.ts` (new):
```ts
export type Rows = string[][];                       // cells as written (text quoted by the writer, amounts not)
export function planCsv(rows: Rows): string;         // header of EXF-476, BOM, CRLF, no final newline
export function registerCsv(rows: Rows): string;
export function zipOf(name: string, files: { name: string; text: string }[]): { name: string; mimeType: string; buffer: Buffer };
export function pairOf(stamp: string, safeName: string, plan: string, register: string): { name: string; mimeType: string; buffer: Buffer }[];
export async function apiExport(request: APIRequestContext, planId: string): Promise<{ name: string; mimeType: string; buffer: Buffer }>;
export function unclearZip(): ReturnType<typeof zipOf>;   // days ≤ 12, flag "Tax", one Activity off by $1.00
export function largePair(rows: number): ReturnType<typeof pairOf>; // 3 accounts, 4 categories, rows Register lines
export function badAmountPair(): ReturnType<typeof pairOf>;          // one Register Outflow "$1,23.45" (quoted)
export function importRequests(page: Page): { url: string; method: string }[]; // live list of /budgets/import* requests
export async function chooseFiles(page: Page, files: Parameters<FileChooser["setFiles"]>[0]): Promise<void>; // filechooser + realClick on the drop zone
export async function deleteNamed(request: APIRequestContext, name: string): Promise<void>; // GET /budgets, DELETE each with that name
```
Zip with `storeZip` from `../../packages/schema/src/zip` (as `plan-menu-registry.spec.ts` imports source modules).
File names: `Budget Export - <SafeName> as of <YYYY-MM-DD HH-mm>.zip` / `<SafeName> as of <stamp> - Plan.csv`. Names
in files are made up (`ZZ Checking`, `ZZ Rent`, …). `apiExport` sends `now` = the local minute.
`e2e/plan-import-dialog.spec.ts`: design cases 5-7. `e2e/plan-import-dialog-logic.spec.ts`: case 15 (pure, imports
`apps/web/src/plan-import/plan-import-dialog-files.ts` and `-latest.ts`).

## Part 3: the preview's choices

**T14.** In `plan-import-dialog-preview.tsx` / `plan-import-dialog.tsx`: edits update `options` and call `refresh()`:
type select → `account_types = { ...all shown types, [name]: type }`; date format select or a question answer →
`date_format`; symbol / placement / separator → `currency_format = { currency_symbol, symbol_placement,
decimal_separator }` (only fields shown); export date on blur when it parses and changed → `export_date`; name → only
`options.name` (no dry run). `refresh()` = `latestOnly().next()`, `previewImport(files, options, signal)`, apply only
when `isLatest`; abort errors ignored. Keep the question (`DateQuestion`) of the first preview that had one in state
so it stays shown after the answer. Lists: show `warnings` (`message`, ` ×<count>` when > 1) and `mismatches`
(`<category> · <monthLabel(month)> · Activity|Available · expected <fmt.money(expected)> · got <fmt.money(got)>`),
with `Showing <len> of <total>` when `total > len`. `fmt = previewFormatter(preview.formats)` (memo).
Spec `e2e/plan-import-dialog-preview.spec.ts`: design cases 8-9 (console: `page.on("console")`, assert no message
contains `ZZ ` names or `1,23.45`).

## Part 4: import, progress, cancel, failed step, result

**T15. `plan-import-dialog-run.ts`**
```ts
export function useImportRun(set: (s: Step) => void): {
  start(files: readonly File[], options: PlanImportOptions): Promise<void>; // POST; done → set done; writing → loop
  retry(): Promise<void>;          // the same continue again, back to writing
  cancel(): Promise<void>;         // stop sending; await the continue in flight; DELETE; → cancelled (409 import_finished → done via continue)
};
```
Loop: `while (state === "writing" && !stopping) { r = await continueImport(id) }`, one request at a time. A failure:
`ApiError` 409 → `ended` (its detail); any other `ApiError` or a network error → `failed` (detail, or `The connection
failed.`). On `done`: `queryClient.invalidateQueries({ queryKey: ["budgets"] })` (from `useQueryClient`), once.
`cancel` after DELETE 409 `import_finished`: call `continueImport(id)` once (answers the same 201) → `done`.
- Writing UI: `Writing step <min(chunks_done + 1, chunk_count)> of <chunk_count>`, `div[role=progressbar]`
  (`aria-valuemin=0`, `aria-valuenow=chunks_done`, `aria-valuemax=chunk_count`, `aria-label="Import progress"`), the
  keep-open sentence, `Cancel import` (secondary). The confirm replaces the footer: text of the design, `Keep
  importing`, `Cancel import` (primary). ✕ / Escape while writing → confirm `close`; yes → `cancel()` then `onClose()`.
- Leaving: `useBlocker(step.kind === "writing")` (`react-router`); blocked → confirm `leave`; yes → `cancel()` then
  `blocker.proceed()`; no → `blocker.reset()`. `beforeunload` listener with `preventDefault()` while writing.
- Result (`done`): `Imported <summary.name>.`, the counts `dl`, warnings and mismatches as in the preview, `Open
  Plan` (primary: `onClose()`, `navigate(`/${budget_id}/budget`)`) and `Close`. The single-call path (201 on start)
  goes straight here.
**T16. Spec** `e2e/plan-import-dialog-steps.spec.ts`: design cases 10-12. Overlap check: count in-flight `continue`
requests with `request`/`requestfinished`/`requestfailed` events; max 1. The stand-in: `page.route("**/continue",
route => route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { id: "422",
name: "import_failed", detail: "The step did not apply; call continue again" } }) }), { times: 1 })`.

## Part 5: round trip, narrow, keyboard

**T17.** `e2e/plan-import-dialog-roundtrip.spec.ts` (design case 13). Seed with `seedCard` (`e2e/support/card-seed.ts`)
plus, through the API: a split (`POST …/transactions` with `subtransactions`), a transfer (`transfer_account_id`),
a scheduled transaction (`createSched` of `scheduled-seed.ts` with `today` = the local date, first date in
the next month), a hidden category (`PATCH
…/categories/{id}` `hidden: true`). Do **not** call `fixCardClock`. Export with the dialog (`waitForEvent("download")`,
`download.path()` → buffer) → `/plans` → Import Plan → that buffer → name `testName("rt")` → Import → Open Plan.
Compare `GET …/months/<current month>` `ready_to_assign`, one category's `available`, `GET …/accounts/<card>`
`balance` of both plans; the Plan page's Ready to Assign text equal on both.
**T18.** `e2e/plan-import-dialog-narrow.spec.ts` (design case 14, import half): 30-account generated pair, a 100-char
plan name in the file name (SafeName) and a 100-char account name; the dialog box inside 1024×700;
`document.scrollingElement.scrollHeight <= innerHeight`; the accounts box `scrollHeight > clientHeight`; Tab cycles;
Escape on the preview closes and focus is on `Import Plan`; Enter on the drop zone opens the chooser.

## Docs

`docs/README.md` holds the design's line (added by the Architect). The Designer writes `docs/plan-file-dialogs-polish.md`.
