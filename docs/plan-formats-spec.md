# Plan formats spec (EXF-468 with EXF-726)

Design: [plan-formats-design.md](plan-formats-design.md). Follow its "The order of the work" and commit after each
part. Clicks in specs use `realClick` (`e2e/support/real-click.ts`). Names use `{ exact: true }`. Each spec makes its
own plan through the API. Inserts name their columns.

## Part 1: data, catalogue, API, MCP

**1.1 Migration** `apps/worker/migrations/20261116101500_plan_formats.sql`:
```sql
ALTER TABLE budgets ADD COLUMN currency_iso_code TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE budgets ADD COLUMN number_format TEXT NOT NULL DEFAULT '123,456.78';
ALTER TABLE budgets ADD COLUMN symbol_placement TEXT NOT NULL DEFAULT 'before';
ALTER TABLE budgets ADD COLUMN date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY';
```
- `apps/worker/src/db/schema/budgets.ts`: `currencyIsoCode`, `numberFormat`,
  `symbolPlacement` (`enum ["before","after","none"]`), `dateFormat`, each `.notNull().default(...)`.
- Delete `.e2e-state` afterwards.
- Verify: `test/schema-drift.test.ts` passes.

**1.2 Catalogue** `packages/schema/src/plan-formats-catalogue.ts` (pure, no imports beyond `plan-import-read`'s
`DateFormat`):
```ts
export type Placement = "before" | "after" | "none";
export type Digits = 0 | 2 | 3;
export interface Currency { code: string; name: string; symbol: string; decimal_digits: Digits;
  number_format: string; placement: "before" | "after" }
export const CURRENCIES: readonly Currency[];          // "All Currencies", the ticket's order (RUB and RUR both kept)
export const COMMON_CURRENCY_CODES = ["USD","GBP","CAD","AUD","EUR"] as const;
export const NUMBER_FORMATS: Record<Digits, readonly string[]>;
//   2: 123,456.78 123.456,78 "123 456.78" 123'456.78 "123 456-78" "123 456,78" 123,456/78 1,23,456.78
//   3: 123,456.789     0: 123.456 123,456 "123 456"
export const DATE_FORMAT_OPTIONS: readonly DateFormat[]; // YYYY/MM/DD YYYY-MM-DD DD-MM-YYYY DD/MM/YYYY DD.MM.YYYY MM/DD/YYYY YYYY.MM.DD
export function currencyByCode(code: string): Currency | undefined;
export function numberFormatParts(f: string): { decimal_separator: string; group_separator: string;
  decimal_digits: Digits; indian: boolean };
export function currencyFormatOf(code: string, numberFormat: string, placement: Placement): CurrencyFormat;
export function placementOf(cf: Pick<CurrencyFormat, "symbol_first" | "display_symbol">): Placement;
export function formatsFromImport(f: ImportFormats): StoredFormats; // see 4.3
export interface StoredFormats { iso_code: string; example_format: string; symbol_placement: Placement;
  date_format: DateFormat }
export const DEFAULT_STORED_FORMATS: StoredFormats; // USD, 123,456.78, before, MM/DD/YYYY
```
- Fill the defaults, symbols and digits from the ticket's lists. Every currency not listed under 0 or 3 decimals has
  2. Symbols keep their spaces and U+200F exactly as the ticket gives them.
- `CurrencyFormat` (the read shape with the eight fields) is defined in `budgets.ts` (1.3) or here; avoid an import
  cycle.
- Test `packages/schema/test/plan-formats-catalogue.test.ts`:
  - The order of the `Name–CODE` labels (snapshot of the ticket's list as literals).
  - The Common group.
  - The note-2 values: JPY (0 decimals, `123,456`, before, `¥`), KWD (3, `123,456.789`), SEK (`123.456,78`, after,
    `kr`), CHF (`123'456.78`, before, `CHF `), INR (`1,23,456.78`), EUR (`123,456.78`, before, `€`), XPF (`123.456`,
    after).
  - Each currency's default number format is in `NUMBER_FORMATS[digits]`.
  - The set of `DATE_FORMAT_OPTIONS` equals `DATE_FORMATS`.

**1.3 Schema** `packages/schema/src/budgets.ts`:
- `CurrencyFormat` zod (`.openapi("CurrencyFormat")`) with the eight fields: `iso_code`, `example_format`,
  `decimal_digits` int, `decimal_separator`, `group_separator`, `symbol_first` bool, `currency_symbol`,
  `display_symbol` bool.
- `DateFormatObject` `{ format: z.enum(DATE_FORMATS) }`.
- `Budget` gains `currency_format: CurrencyFormat.default(DEFAULT_CURRENCY_FORMAT)` and
  `date_format: DateFormatObject.default({ format: "MM/DD/YYYY" })`. The default is needed by
  `e2e/plan-menu.spec.ts` test 7, which injects plans without these fields.
- `CurrencyFormatInput` `{ iso_code?: z.string(), example_format?: z.string(), symbol_placement?:
  z.enum(["before","after","none"]) }` and `DateFormatInput` `{ format: z.string() }`. They are strings so that the
  service can give named refusals. Their descriptions list the allowed values.
- `BudgetCreate` gains `currency_format?` and `date_format?`, and `BudgetUpdate` inherits them through `.partial()`.

**1.4 Repository and service.**
- `repositories/budgets.ts`: `updateStmt`'s patch type gains the four columns.
- `services/budgets.ts`:
  - `toApi` adds `currency_format: currencyFormatOf(row.currencyIsoCode, row.numberFormat, row.symbolPlacement)` and
    `date_format: { format: row.dateFormat }`.
  - New `export class BudgetRefused extends Error { status: 422; code }`.
  - New `resolveFormats(stored: StoredFormats, input): StoredFormats` (pure):
    - Code unknown: `unknown_currency`, `Unknown currency <x>. Use a code of the plan settings list.`
    - Currency changed: fill a missing `example_format` and `symbol_placement` from the new currency's defaults.
      Otherwise keep the stored ones.
    - Format not in `NUMBER_FORMATS[digits]`: `number_format_not_offered`, `<f> is not a number format of <CODE>;
      use one of <list>.`
    - Date format not in the seven: `unknown_date_format`, `... use one of <list>.`
    - The date format is changed only when given.
  - `createBudget` and `updateBudget` call it before building the batch. The "opened only" condition also requires
    `currency_format` and `date_format` to be undefined. `after` and the update set include the four columns.
  - Calls stay: PATCH = `findActive` + one `db.batch`.
- `routes/budgets.ts`: POST and PATCH catch `BudgetRefused` and return `apiError(c, e.status, e.code, e.message)`, as
  `routes/accounts.ts:143` does, and declare `422` in `responses`.
- Verify: `pnpm check`.

**1.5 MCP** `mcp/tools/budgets.ts`:
- `create_budget` and `update_budget` `inputSchema` add `currency_format` (`iso_code`, `example_format`,
  `symbol_placement` as `z.enum`) and `date_format` (`{ format: z.enum(DATE_FORMAT_OPTIONS) }`), both optional.
- `update_budget`'s "Nothing to update" check counts them.
- Descriptions:
  - Say what is returned, now naming `currency_format` (its eight fields) and `date_format`.
  - The number formats per decimal digits and the seven date formats.
  - "A changed currency without example_format or symbol_placement takes the currency's defaults; the date format is
    never changed by a currency change; amounts are never converted. Amounts in every tool stay integer milliunits
    and dates ISO."
  - Keep `timestamps(...)`.
- `list_budgets` and `get_budget` descriptions name the two fields.
- No new tool, so no coverage line and no `mcp-timestamps` change. Run `mcp-descriptions.test.ts`.

**1.6 Worker tests**
- `apps/worker/test/plan-formats.test.ts`:
  - GET list and GET one carry the defaults for a new plan.
  - PATCH with each field.
  - SEK defaults; a date-only PATCH.
  - The three refusals: 422 with name, row unchanged, no change_log row.
  - POST with formats.
  - The change_log `update` row's `after` has the new formats and actor `user:`.
  - The MCP round trip through the four tools, actor `mcp:`.
  - The surface: `apiPaths()` holds `/api/v1/budgets/{id}`.
- `apps/worker/test/plan-formats-calls.test.ts`: copy `counting()` from `reconcile-calls.test.ts`. Assert
  `updateBudget` = 2 calls for a rename and for all fields, `getBudget` = 1, `listBudgets` = 1, `createBudget` = 1.
- Departures (design): `mcp-tools.test.ts:131` gains `currency_format` and `date_format` in the sorted list;
  `plan-import-migration.test.ts` column list gains the four columns.

## Part 2: formatter and repository test

**2.1** `packages/schema/src/plan-formats.ts`:
```ts
export interface PlanFormats { currency_format: CurrencyFormat; date_format: { format: DateFormat } }
export const DEFAULT_PLAN_FORMATS: PlanFormats;
export interface PlanFormatter {
  formats: PlanFormats; digits: Digits; dateFormat: DateFormat;
  money(m: number): string; signed(m: number): string; abs(m: number): string; whole(m: number): string;
  input(m: number): string; date(iso: string): string;
  typedAmount(text: string): string;                    // 4.1
  parseDate(text: string, today: string): string | null; // 4.2
  planFormat(): PlanFormat;                             // for exportFormat
}
export function planFormatter(f: PlanFormats): PlanFormatter;
export const DEFAULT_FORMATTER: PlanFormatter;
```
- **Rounding:** `step = 10 ** (3 - d)`; `units = Math.round(Math.abs(m) / step)` (half away from zero on `|m|`).
- **Digits:** group the whole part by 3, or 3 then 2s when `indian`. The number is `whole[decimal digits]`.
- **Separators:** on screens any `" "` in the group separator or the symbol becomes `" "`.
- **Symbol:** before or after per placement; none when `display_symbol` is false.
- **Sign:** `"−"` (U+2212, `MINUS` from `screen-money.ts`) before everything when `m < 0 && units > 0`.
- **`signed`:** `+` when `units > 0 && m > 0`.
- **`whole`:** `money` with `d = 0` rounding.
- **`input`:**
  - No symbol, plain spaces, ASCII `-`.
  - All decimals, and `0.00`-style zero (in the plan's separators).
  - For the default format it equals `formatAssignedInput`.
- **`date`:** token replace (as `exportFormat.date`).
- **`planFormat()`:** `{ currency_symbol, symbol_placement: placementOf(cf), decimal_separator, group_separator,
  decimal_digits, date_format }`.

Tests `packages/schema/test/plan-formats.test.ts`:
- Every figure of design "Formatter rules", with screen spaces as U+00A0.
- The default formatter equals today's `screenMoney`, plan `money`, `reportMoney`, `registerDate` and
  `formatAssignedInput` on a table of values. Write that table **before** deleting the old functions.

**2.2** `scripts/test/plan-formats-screens.test.ts`:
- Walk `apps/web/src`, `packages/schema/src` and `apps/worker/src`, `.ts` and `.tsx`.
- Hits:
  - `/style:\s*["']currency["']/`
  - `/\bformatMoney\(/`
  - `/\$\$\{/`
  - `/(["'])\$\1/`
  - `/["'`][^"'`\n]*\$\d/`
  - `/replace(All)?\(\s*["']\$["']/`
  - `/minimumFractionDigits/`
  - `/["']MM\/DD\/YYYY["']/`
  - `/slice\(5,\s*7\)\}\//`
  - `/\}\/\$\{[^}]+\}\/\$\{/`
- `ALLOWED` lists the four files of the design, each with its reason, plus a second test that each allowed file
  still hits.
- **Run it before part 3 and write the count in the commit message.**

## Part 3: the sweep

- **Provider.** Create `apps/web/src/shell/plan-formats-context.tsx`:
  - `PlanFormatsProvider({ children })` reads `useCurrentPlan().plan` and memoizes `planFormatter` on
    `plan?.currency_format` and `plan?.date_format`, using `DEFAULT_FORMATTER` when there is no plan.
  - `usePlanFormatter()` returns it.
- **Mount.** Wrap `AppShell`'s content in the provider.
- **Every place in the design table** gets `fmt` as said there:
  - Add `fmt: PlanFormatter` as the **last required parameter** of each pure function (`money(m, fmt)`,
    `targetStatusText(..., fmt)`, `reconcileSentence(diff, fmt)`, `unbalancedText(total, sum, fmt)`,
    `autoAssignOptions(..., fmt)`, `amountError(fmt)`, `reportMoney(m, fmt)`, `formatEntryDate(iso, fmt)`, …).
  - Components call `usePlanFormatter()`.
  - Delete `screenMoney`, plan `money`'s module constant, `registerMoney`/`registerDate` (use `fmt.abs`/`fmt.date`),
    `usDate`, `SidebarAccounts`' local `money`, and `EditAccountDialog`'s `balanceText` (use `fmt.input`).
  - Keep every call site's own sign rule (for example `RtaBreakdown`'s `>= 0` plus).
- **Worker split refusal.**
  - `validateLines(..., fmt)` uses `fmt.money`.
  - In `transactions.ts`, make `activePlan` return the row, then pass
    `planFormatter(formatsOfRow(row))` from the row that path already read.
  - `formatsOfRow` is a small helper in `services/budgets.ts` built from `toApi`.
  - If a path to `validateLines` has no plan row read before it, say so in the commit. Never add a read.
- **Verify.** The repository test is green, `pnpm check` passes, and `pnpm e2e` passes with no spec edited.

## Part 4: typing and files

**4.1 Typed amounts.** `typedAmount(text)`:
- Identity when `decimal_separator` is `.` (or the format has 0 digits) and the group is `,`.
- Otherwise:
  - Remove the trimmed symbol, `\s` and U+00A0, and every group separator character.
  - If the decimal is `,`, replace `,` with `.`.
  - If the decimal is `-` or `/` and the text matches `^[-−]?\d+[-/]\d{1,d}$`, replace the last separator with `.`.
    Otherwise leave it (operators keep their meaning; `.` stays a decimal point).

Parsers:
- `evaluateAssigned(text, before, digits = 2)` and `evaluateAmountEntry(text, digits = 2)` round to `digits`
  (milliunits step `10 ** (3 - digits)`).
- `parseAmountInput(text, digits = 2)` allows up to `digits` decimals.
- `formatAmountEntry(m, fmt)` = `fmt.input(Math.abs(m))`, and `formatAssignedInput(m, fmt)` = `fmt.input(m)`.

Callers pass `fmt.typedAmount(text)` and `fmt.digits`:
- `AmountField`, `entryDraft`, `AssignedCell`, `MoveAmountField`, `TargetForm`
- `EditAccountDialog`, `ReconcileButton`, `AddAccountDialog`

Unit tests:
- `1.234,56` (`123.456,78`) → 1,234,560
- `1 234,56` (`123 456,78`) → 1,234,560
- `1500` JPY → 1,500,000
- `1.500` XPF → 1,500,000
- `1,234.567` KWD → 1,234,567
- `12-50` (`123 456-78`) → 12,500
- `1.234,56+10` → 1,244,560
- The default format gives byte-identical results on today's test inputs.

**4.2 Typed dates.**
- `parseEntryDate(text, today, order: "MDY" | "DMY" | "YMD" = "MDY")`. The order comes from the date format (`YYYY…`
  is YMD, `DD…` is DMY, `MM/DD/YYYY` is MDY).
- ISO `YYYY-M-D` is accepted first.
- Otherwise split on `/ . -`:
  - With three parts, read Y, M, D in that order (2-digit year → 20YY; YMD needs the year first, 4 digits).
  - With two parts, read the D/M pair in the format's order, this year.
  - With one part, it is the first of D or M in the format's order; MDY keeps today's "month, day 1".
- `fmt.parseDate(text, today)` wraps it.
- Callers: `DateField` (placeholder `fmt.dateFormat`), `TargetDateField` (placeholder `fmt.dateFormat`, replacing
  the literal), `EntryRow`, `entryDraft`, `target-form.ts` (`fmt` parameter).
- Unit tests: `30.12.2026` DMY → `2026-12-30`; `12/30/2026` DMY → null; `2026/12/30` YMD; `2026-12-30` in every
  order; today's MDY tests unchanged.

**4.3 Files.**
- **Export Plan.** `plan-export.ts` service: replace the `DEFAULT_PLAN_FORMAT` line with
  `exportFormat(planFormatter(formatsOfRow(plan)).planFormat())`.
- **Register export.** `register-export.ts`: `registerCsv(rows, fmt: ExportFormat)` uses `fmt.amount(Math.abs(m))`,
  `fmt.amount(0)` and `fmt.date`. A field containing `,` is quoted. `transactions-export.ts` passes it from the plan
  row it reads.
- **Reflect.** `spending-breakdown.ts`: in `transactionsCsv(rows, fmt: ExportFormat)`, remove `dollars` and `usDate`.
  `reports.ts`: make the existing plan check keep the row and pass it on. No added call; `*-calls` tests unchanged.
- **Import.** `formatsFromImport(f)`:
  - **Currency:** the candidates have `symbol.trim() === f.currency_symbol.trim()` and
    `decimal_digits === f.decimal_digits`. Rank them by: the default format's decimal is `f.decimal_separator`, then
    the default placement is `f.symbol_placement`, then dialog order (Common first, then All). With no candidate, or
    placement `none`, take the first currency in dialog order with those digits.
  - **Number format:** the currency's default if its decimal matches, else the first of `NUMBER_FORMATS[digits]` with
    that decimal.
  - **Placement and date format:** as detected.
  - **Storing:** in `services/plan-import.ts` `buildRows`, set the four columns on `budget` from
    `formatsFromImport(<the summary formats, after currency_format overrides>)`. `buildRows` may take the formats as a
    parameter. No new statement.
- Tests:
  - `apps/worker/test/plan-formats-roundtrip.test.ts`: EUR, `123.456,78`, after, `DD.MM.YYYY`. Export, import
    (zip), then check the new plan's `currency_format` and `date_format` are equal and the month's
    Assigned/Activity/Available and the register amounts are equal.
  - KWD (3 digits) round trip. If `1234.567` is not read, fix it in `detectDecimal` only if the change stays inside
    that function; otherwise note it in the design's known issues.
  - Unit tests of `formatsFromImport`: `$` → USD, `kr` `,` after → SEK, `€` `,` → EUR `123.456,78`, `¥` 0 → JPY.
  - Today's export and import tests pass unedited.

## Part 5: the dialog

Files: `apps/web/src/menu-actions/plan-settings.tsx`,
`apps/web/src/plan-settings/PlanSettingsDialog.tsx` and `plan-settings.css`.

- **Registration.** `export const action: PlanMenuAction = { entry: "plan-settings", Dialog: PlanSettingsDialog }`.
  No shell edit.
- **State.** `{ name, code, numberFormat, placement, dateFormat }`, from `useCurrentPlan().plan` via `budgetId`.
- **Markup:** `<div className="dialog-backdrop"><form className="dialog form plan-settings" role="dialog"
  aria-label="Plan Settings">`, then:
  - Head: `<h2>Plan Settings</h2>` and `<button type="button" aria-label="Close">✕</button>`.
  - `label[for=plan-settings-name]` "Plan Name", then the input `maxLength={100}`. On mount: `focus()`, then
    `select()`.
  - A two-column row: "Currency" select (`plan-settings-currency`) with
    `<optgroup label="Common Currencies">` (the 5, in the ticket's order) and `<optgroup label="All Currencies">`.
    Options are `${name}–${code}` (U+2013) with `value=code`. Next to it, "Currency Placement" select
    (`plan-settings-placement`).
  - "Number Format" (`plan-settings-number-format`): the options of `NUMBER_FORMATS[digits]`; label = value.
  - "Date Format" (`plan-settings-date-format`): label `dateText(\`${thisYear}-12-30\`, f)`, `value=f`.
  - Footer: `Cancel` (`secondary`), `Apply Settings` (`primary`, type submit).
- **Placement labels:**
  - `Before amount (${symbol}${numberFormat})`
  - `After amount (${numberFormat}${symbol})`
  - `Don't show (${numberFormat})`

  The symbol is written as in the catalogue (plain spaces); there is no U+200E.
- **Currency change:** `setState({ code, numberFormat: c.number_format, placement: c.placement })`.
- **Escape:** a document `keydown` listener closes, as in `EditAccountDialog.tsx:60`. Cancel and ✕ close.
- **Close:** `onClose()`, then
  `document.querySelector<HTMLElement>(".plan-button, .rail-logo")?.focus()`.
- **Submit:**
  - Trim the name. If it is empty, show `<p id="plan-settings-name-error" className="error">Plan name is
    required.</p>` under the field, with `aria-invalid` and `aria-describedby`, and do not send.
  - Build a patch of the changed fields only. If it is empty, close.
  - `useUpdateBudget().mutate({ id, patch })`. On success, close. On error, show `error.message` (`.error`) above the
    footer and stay open.
- **CSS:**
  - Use tokens only.
  - Width `min(440px, calc(100vw - 32px))`, `max-height: calc(100vh - 32px)`, `overflow: auto`.
  - Selects take the account edit dialog's select class or look (read `EditAccountDialog.tsx` and its CSS).
  - Primary and secondary buttons are the global ones. Check that the text contrast is readable (state 1 of
    "Looking").
- **Specs:**
  - `e2e/plan-settings.spec.ts`: acceptance 1–6, 19, and 13's Assigned typing.
  - `e2e/plan-settings-formats.spec.ts`: after applying Euro, check the grid, register (date and BALANCE), sidebar,
    Activity popover and a Reflect report. Then yen (no decimals) and "Don't show" (no symbol).
  - Each spec seeds its own plan, account, category and transactions through the API. After Apply, wait with
    `expect.poll` on `GET /api/v1/budgets/{id}`.

## Part 6: EXF-726

1. First write `e2e/plan-formats-narrow.spec.ts` (acceptance 16 and 17):
   - Viewport 1024×700. Seed through the API: categories with Assigned `$88,888.88` / `−$888.88` / `−$888,888.88`,
     transactions giving those Activities, Availables of all three lengths, and a group whose totals are twelve
     characters.
   - For each `.cell-assigned .amount`, `.activity-button`, `.cell-available` pill text and `.group-row .num` in those
     rows, check: `scrollWidth <= clientWidth`, height ≤ one line + 1, right edge ≤ cell right + 0.5.
   - A category name's text box is at least as wide as its first word.
   - `document.documentElement.scrollWidth <= clientWidth`.
   - Then PATCH the plan to the state-5 format with an `−8.888.888,88€` amount: one line, and `title` equals the text.
   - **Run it on the code before the fix and quote the failing lines in the commit message.**
2. `apps/web/src/plan/columnWidths.ts`:
   - `numberColumns(detail, family, fmt)`, measuring `fmt.money(n).replace(/\d/g, "0")`.
   - `CAP` per column = `textWidth("−$000,000.00") + extra + SLACK`. Cap each `grow`.
   - `useNumberColumns(detail)` reads `usePlanFormatter()` and memoizes on it.
3. `plan-grid.css`:
   - `.group-row .num` and `.hidden-categories-row .num`, and the Assigned amount and Available pill text:
     `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
   - Add a `title={text}` holding the whole amount where there is none (keep the pill's sentence title and the
     Activity button's title).
4. Verify:
   - The new spec passes.
   - `e2e/plan-narrow.spec.ts` passes unedited (test 20: panel 320).
   - 1440 specs pass unedited.
   - Run `pnpm e2e e2e/plan-formats-narrow.spec.ts --repeat-each=3`.

## Finishing

- Run `pnpm check`. Run `pnpm e2e` only if the Lead asks; otherwise final_gate does it.
- List any edited expectation beyond the design's departures, with its reason, in the design's Departures.
- No dependency is added. No out-of-bounds file of note 11 changes. Check with
  `git diff --stat origin/main -- apps/worker/src/app.ts apps/worker/src/middleware apps/worker/src/mcp/server.ts apps/worker/src/mcp/types.ts apps/web/src/api/client.ts apps/web/src/router.tsx apps/web/src/shell/planMenuEntries.ts e2e/month-nav.spec.ts package.json pnpm-lock.yaml`;
  it must print nothing.
