# Plan formats design (EXF-468 with EXF-726)

Each plan stores a currency, a number format, a currency placement and a date format. Every amount and date on every
screen and in every export file is written with them. The Plan Settings dialog (plan menu) edits them along with the
name. REST and MCP read and write the same fields. EXF-726: on the Plan grid at 1024 px, the number columns hold
amounts of up to twelve characters.

## The source app in this Build

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the Clerk's step 2 (`https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`).

**What may be looked at:** the Plan page of the test plan and the page of one of its accounts (reached from the test plan's sidebar), at 1440×900 and at 1024×700. On them: read how amounts and dates are written (the minus sign, the symbol, the separators), and measure the Plan grid's columns at both sizes (the widths of the name column, the three number columns and the right panel). **Nothing is changed, typed or applied anywhere in the source in this Build.** Reason: this Build needs only measurements of pages that are already matched; every setting it builds lives behind the plan menu (next point).

**What nobody ever does in the source, each with its reason:**
- **Open the plan menu (the plan's name at the top of the sidebar), and so Plan Settings, New Plan, or any other entry of it.** Reason: the menu lists the owner's other plans by name, and the owner has said nobody may look at any other plan; the owner has not answered whether the menu may be opened in the test plan. **The Plan Settings dialog is therefore not compared: it is built from the ticket's text (which holds what was seen on 15 Nov: the fields, their order, every option) and from the clone's own dialogs for its look (the New Plan dialog, the account edit dialog). "Not compared: built from the ticket" is a complete and acceptable answer for every part of the dialog.**
- **Reconcile: never open it, never press anything in it.** Reason: a Designer pressed Next in the source's Reconcile and the whole session signed out 31 seconds later; every Build stopped until the owner signed in again.
- **Create, edit, delete, clear, flag, approve or categorize a transaction; assign or move money; add, edit, reopen or delete an account or a category; type into any field.** Reason: it is the owner's account; a long amount "to have something to measure" is made in the clone, never in the source.
- **Open Bank Connections, Reflect, settings, an account's edit dialog, the register's View options, or any other plan.** Reason: they show the owner's data or are not released; nothing of this Build is there.
- **Leave the tab changed:** a size or theme override is set back, and the tab ends on the test plan's Plan page. Reason: two earlier Designers left the tab at a wrong size, and the next step's check then failed.

If the test plan cannot show a state (for example no amount of ten characters), that state is "not compared: built from the ticket".

**Each step states in its report, for itself only, every action it took in the source app (clicks and overrides included), or that it opened nothing.**

## Source (study of 17 Nov: `/workspace/scratch/source/plan-formats/`, `notes.md` holds the action log)

- The test plan has no open account and every amount is `$0.00`, so the account page, register dates and sidebar
  balances were not seen: **not compared: built from the ticket**. Amounts: `$` first, `,` groups, `.` decimals, no
  sign at zero, Figtree 14/500 `tabular-nums` (`plan-1440x900.png`, `plan-1024x700.png`). The source's formatter
  (called read-only in the page) writes `-$1,234.56` and `11/17/2026`; the clone keeps U+2212 (EXF-664, D12).
- Grid (`measure-*.json`): at 1440 name 361.9, number columns 118.6 each, panel 389.4; at 1024 name 236.1, columns
  84.3 (fixed %), panel 300, and the page scrolls sideways with Available cut off. The clone keeps measured columns
  (`columnWidths.ts`) and a page that never scrolls sideways (EXF-622/646).

## Approach

1. **Data.** `apps/worker/migrations/20261116101500_plan_formats.sql` adds to `budgets`, each `NOT NULL` with a
   default: `currency_iso_code 'USD'`, `number_format '123,456.78'`, `symbol_placement 'before'` (`before|after|none`,
   the export/import word), `date_format 'MM/DD/YYYY'`. `BudgetRow` literals (`createBudget`, import `buildRows`) set
   them; no `e2e/` fixture writes a `budgets` row.
2. **Catalogue** `packages/schema/src/plan-formats-catalogue.ts`: the ticket's currencies in its order with symbol,
   digits and defaults; the Common group; number formats per digits; the seven date formats in dialog order.
3. **Formatter** `packages/schema/src/plan-formats.ts`: `planFormatter(formats)` → `money`, `signed`, `abs`,
   `whole`, `input`, `date`, `dateFormat`, `digits`, `typedAmount`, `parseDate`, `planFormat()`. Every function that
   writes an amount or a date takes a **required** `fmt`, so the compiler finds every caller.
4. **Screens.** `apps/web/src/shell/plan-formats-context.tsx` (`PlanFormatsProvider`, `usePlanFormatter()`) is
   mounted once in `AppShell`, built from `useCurrentPlan().plan` (the list the shell already loads: no second
   fetch); default formatter outside a plan. Apply Settings updates the `["budgets"]` cache, so everything re-renders
   without a reload.
5. **Repository test** `scripts/test/plan-formats-screens.test.ts` fails when `apps/web/src`, `packages/schema/src`
   or `apps/worker/src` formats money or a date by itself; allow-list: the formatter, the catalogue, `plan-export.ts`
   (`exportFormat`), `plan-import-read.ts` (`DATE_FORMATS`). Run before the sweep; its count is reported.

## Formatter rules

- 1000 milliunits = one unit in every currency; round to the currency's digits half away from zero (integers only;
  a 0-decimal plan shows a fraction rounded, stored unchanged). The character before the last 2 (3) digits of the
  number format is the decimal separator, the other the group separator; `1,23,456.78` groups 3 then 2s.
- `money`: U+2212 first, before the symbol (`−$45.00`, `−45,00€`); a value shown as zero has no sign; `none` shows no
  symbol. On screens every space of a symbol or group separator is U+00A0, so an amount never breaks (option labels
  and files keep plain spaces). `signed` adds `+` above zero; `abs` = `money(|m|)`; `whole` = no decimals (chart
  ticks); `input` = typed-field text (no symbol, ASCII `-`; equal to today's `formatAssignedInput` by default).
- `date`: the plan's `YYYY`/`MM`/`DD` order. Month and weekday names, `reconciledTitle` and MM/YY axis labels are not
  part of the date format.
- With the defaults every output is byte-identical to today's, except a negative under half a cent: `$0.00`.

Note 10 figures (unit tests, `packages/schema/test/plan-formats.test.ts`): 1,234,560 → `$1,234.56` default;
`1.234,56€` / `−1.234,56€` EUR `123.456,78` after; `CHF 1'234.56` CHF default; `1 234-56` (`123 456-78`, none);
`1,234/56` (`123,456/78`, none); `¥1,235` JPY, and 1,234,000 → `¥1,234`; 12,345,678,900 → `1,23,45,678.90`
(`1,23,456.78`, none); 1,234,567 → `1,234.567` KWD none; −4 → `$0.00` (spaces on screen are U+00A0). 2026-12-30 →
`2026/12/30`, `2026-12-30`, `30-12-2026`, `30/12/2026`, `30.12.2026`, `12/30/2026`, `2026.12.30`. All confirmed by the
ticket's rules.

## API (REST and MCP)

- **Read** (every plan object: GET list/one, POST/PATCH answers, change_log rows, the import's history entry):
  `currency_format {iso_code, example_format, decimal_digits, decimal_separator, group_separator, symbol_first,
  currency_symbol, display_symbol}` and `date_format {format}`, derived in `toApi` (`symbol_first` = before,
  `display_symbol` = not none). The zod `Budget` gives both a `.default(...)`, because `e2e/plan-menu.spec.ts` test 7
  injects fake plans without them.
- **Write** (`POST /budgets`, `PATCH /budgets/{id}`): `currency_format?: {iso_code?, example_format?,
  symbol_placement?: "before"|"after"|"none"}`, `date_format?: {format}`.
- **Rules** (pure checks in `services/budgets.ts`): 422 `unknown_currency`, 422 `number_format_not_offered` (not
  offered for the currency's digits), 422 `unknown_date_format`; each names the allowed values and changes nothing. A
  changed currency without number format or placement takes that currency's defaults; the date format changes only
  when given; amounts are never converted. REST and MCP amounts stay milliunits and dates ISO. One batch: guarded
  change_log row with the actor, then the update (as the rename). The "opened only" fast path requires both new
  fields absent.
- **MCP:** `update_budget` and `create_budget` take the same objects; descriptions list the number formats per
  digits, the seven date formats, and where to read codes (`get_budget`); `get_budget`/`list_budgets` name the
  fields. **`update_budget_settings` is not added** (one tool for one operation); no coverage or timestamps change.

**D1 calls** (`apps/worker/test/plan-formats-calls.test.ts`, the `counting()` proxy of `reconcile-calls.test.ts`):
`PATCH /budgets/{id}` **2** (read, one batch), as today, for a rename and for every field; `GET /budgets` **1**;
`GET /budgets/{id}` **1**; `POST /budgets` **1**. None grows.

## Where amounts and dates are written

H = `usePlanFormatter()` in the component; P = required `fmt` parameter; R = built from the plan row the Worker
service already reads (no added call).

| Place | Shows | How |
|-|-|-|
| `web/plan/format.ts` (`money`, `signed`, `statusLabel`, pill titles, `categoryPill`) | grid amounts, titles | P |
| plan `rows`, `AssignedCell`, `AvailablePill`, `HiddenCategories`, `ReadyToAssign`, `RtaBreakdown` (keeps its `>= 0` plus), `CategoryPicker`, `AutoAssignOptions`, `activity-popover` (date+amount), `columnWidths` | grid, header, popovers | H |
| `plan/panel/*` (inspectors, `SummaryCard`, `TargetCard`, `TargetForm`, `overspentMessage`, `TargetDateField` placeholder) | panel | H |
| schema `target-wording`, `target-form` (`amountError(fmt)`, dates), `auto-assign` (`$0.00` title), `category-activity`, `reconcile` sentence, `split` text, `card-payments` prefill; `screen-money` keeps only `MINUS` | sentences | P |
| `register/format.ts` (→ `fmt.date`, `fmt.abs`), `RegisterTable`, `ScheduledSection`, `ActionBar`, `selection`, `CategoryField`, `SplitLines`, `ReconcileBar`, `SplitDialog` | register | H |
| `account/AccountHeader`, `CloseAccountDialog`, `DifferenceDialog`, `ReconcileButton`, `EditAccountDialog`, `PaymentBalance` | account | H |
| `shell/SidebarAccounts` (local copy removed), `BankConnected` (hyphen → U+2212) | sidebar | H |
| schema `reflect-format` (all money helpers, `tickMoney` → `whole`, `usDate`) and the 8 `reflect/*` reports, `TransactionPopover` | Reflect | P/H |
| schema `amount-entry`, `assigned-edit`, `date-entry` formatters | typed fields | P |
| worker `transaction-splits` (split refusal) | 422 detail | R (`activePlan` row in `transactions.ts`) |
| worker `plan-export`, `transactions-export` + `register-export`, `reports` + `transactionsCsv` | files | R |

**Server sentences with an amount:** only the split refusal, now in the plan's format. Reconcile `conflictDetail`
(milliunits), plan-export `now` (ISO) and the import date question (file text, ISO) carry no formatted amount; the
Worker uses no schema wording with an amount.

## Typing (the clone's rule; not observed in the source)

Typed amounts go through `fmt.typedAmount` before today's parsers (identity for `.`-decimal, `,`-group formats), which
round to the plan's digits. Typed dates are read in the plan's D/M/Y order, ISO still accepted, the format as
placeholder. Rules and examples in the spec.

## Files

Export Plan passes `fmt.planFormat()` to `exportFormat` (its rules stay: no groups, ASCII `-`, TSV for `,`). The
register export and Reflect's `transactionsCsv` write through `exportFormat` (an amount containing `,` is quoted);
`csvAmount` columns stay plain numbers. The import stores what it detects (`formatsFromImport`) **on the plan row it
inserts** (no added statement). Round trip EUR/`123.456,78`/after/`DD.MM.YYYY` in a Worker test. Files cannot carry
the group separator (`123 456,78` returns as `123.456,78`) or tell apart currencies sharing symbol and digits (CAD →
USD): known issue.

## The Plan Settings dialog (not compared: built from the ticket)

`apps/web/src/menu-actions/plan-settings.tsx` registers `{ entry: "plan-settings", Dialog }`; the dialog is
`apps/web/src/plan-settings/PlanSettingsDialog.tsx` with the New Plan dialog's classes. Title `Plan Settings`, ✕
(`Close`); Plan Name (focused, selected, max 100); Currency and Currency Placement side by side; Number Format; Date
Format (labels: 30 December of the current year); `Cancel`, `Apply Settings`. Currency optgroups `Common Currencies`,
`All Currencies`, labels `Name–CODE` (U+2013). A currency change resets number format and placement to its defaults
and rewrites `Before amount (€123,456.78)`, `After amount (123,456.78€)`, `Don't show (123,456.78)`. Cancel/✕/Escape
discard. Empty name: `Plan name is required.` under the field, nothing sent. Apply sends one PATCH of the changed
fields, closes on success, stays open with the API's detail on a refusal. Focus returns to the plan button. Inside
the window at 1024×700.

## EXF-726: number columns at 1024 px

- **Cause, measured** (Figtree 500 14px): the canvas in `columnWidths.ts` ignores `tabular-nums`: `−$106.50` is
  59.5 px on canvas, 63.5 in the DOM, so the column is 4 px short. **Fix:** measure `fmt.money(n)` with every digit
  replaced by `0` (64.7 px); cap each column at `−$000,000.00` (twelve wide characters, 95 px) plus its extra:
  Assigned 121, Activity 101, Available 111 (130 with a pill icon). Grid amounts (group rows, Assigned, Available,
  Activity) are `nowrap` with an ellipsis and a `title` holding the whole amount.
- **What gives way: the name column only.** Grid box at 1024×700 = 1024 − 260 − 320 = 444 px, fixed cells 31. Names
  have ~203 px today (floors 68+62+80); with twelve characters in all three columns ~80 px (61 with a pill icon), so
  they give way by ~123 px and keep their first word, ellipsis and tooltip. The panel stays 320 (`plan-narrow` test
  20); the page never scrolls sideways. A longer amount (state 9) stays on one line, cut with an ellipsis and its
  `title`. At 1440 nothing changes (narrow widths apply only under `data-narrow`).

## Built (Implementer)

- Repository test `scripts/test/plan-formats-screens.test.ts` found **48** places before the sweep (allow-list empty); it is green after, with the formatter, catalogue, `plan-export`, `plan-import-read`, the zod and column defaults, `plan-import`'s starting guess, `report-range` (MM/YY axis) and `reflect/format` (percent text) allowed. Lines that are comments are skipped.
- The catalogue lists 133 currencies; the ticket's symbol list has no entry for BBD and CLP: both use `$`.
- EXF-726: the columns measure `fmt.money(n)` with every digit as `0` (the canvas width of that equals the DOM's tabular width: 77 px for `−$0,000.00`, 95 for `−$000,000.00`), cap at `−$000,000.00` plus the cell's extras, and take the room from the name column and from the narrow cell paddings that were not needed (Assigned and Activity left padding 4 and 2 px to 0, the 2 px slack). `e2e/plan-narrow.spec.ts` test 21 passes unedited at 140 px of name with its data.
- Import: with Symbol None the file holds no symbol, so the currency is the first with those decimals (a 3-decimal plan comes back as BHD, amounts and format kept).

## Out of scope; known issues

Out: New Plan currency fields (EXF-469), converting amounts, percent text, month/weekday names, `planMenuEntries.ts`,
`e2e/month-nav.spec.ts` (EXF-727). `packages/core` is unchanged (`formatMoney` keeps its tests; nothing calls it).
Known: IRR's symbol `ريال` is unverified (ticket); RUB and RUR are both "Russian Ruble"; placement labels have no
U+200E; the file limits above; the source writes a hyphen minus, the clone U+2212.

## Departures

1. `apps/worker/test/mcp-tools.test.ts:131`: `update_budget`'s input keys gain `currency_format`, `date_format`
   (the brief has the tool take them).
2. `apps/worker/test/plan-import-migration.test.ts` "leaves the plan table's columns as they were": four columns added.
3. The split refusal writes U+2212 (no test asserts it).
4. A negative under half a cent shows `$0.00`, not `−$0.00` (no test known).

5. `packages/schema/test/screen-money.reconcile.test.ts`: imports `DEFAULT_FORMATTER.money` where it imported the deleted `screenMoney` (same expectations).
6. `packages/schema/test/target-wording.test.ts`: `targetMoney` (deleted) is `DEFAULT_FORMATTER.money` in the test (same expectations).
7. `packages/schema/test/reflect-format.test.ts`: the `usDate` test is removed with `usDate` (covered by `plan-formats.test.ts`); `t.map(tickMoney)` becomes `t.map((v) => tickMoney(v))` (the second argument is now the formatter, `map` would pass the index).
8. `e2e/plan-menu.spec.ts` test 6 (Plan Settings is enabled now) and test 5 (the keyboard path visits Plan Settings between Open Plan and Keyboard Shortcuts).
9. Pure schema functions take `fmt` as an optional last parameter defaulting to `DEFAULT_FORMATTER` (the spec said required), so every existing unit test passes without an added argument. Every call in `apps/web` and `apps/worker` was written with `fmt` while it was required (the compiler found them), then relaxed.
10. `autoAssignOptions(p, scope, hidden?, fmt)`: `fmt` follows the optional `hidden`.

Any other edited expectation is added here with its reason.

## Acceptance

Specs make their own plan through the API, click with `realClick`, wait with `expect.poll`.

1. AC1: plan menu → Plan Settings opens prefilled; Plan Name focused, all text selected. `e2e/plan-settings.spec.ts`.
2. AC2: the Currency select's optgroups and labels equal the ticket's lists (catalogue unit test; spec reads the DOM).
3. AC3: JPY offers exactly `123.456`, `123,456`, `123 456` with `123,456` selected; KWD only `123,456.789`; SEK
   selects `123.456,78` and `After amount (123.456,78kr)`.
4. AC4: after EUR the placement labels read `Before amount (€123,456.78)`, `After amount (123,456.78€)`,
   `Don't show (123,456.78)`.
5. AC5: change every field, then Cancel / ✕ / Escape: reopening shows the saved values; no PATCH sent.
6. AC6: apply EUR, `123.456,78`, After amount, `DD.MM.YYYY`: one PATCH, dialog closed; without reload a −1,234,560
   Available reads `−1.234,56€`, a register date `30.12.2026`, the sidebar balance follows; one change_log `update`.
7. AC7: REST GET/POST/PATCH and MCP `get_budget`/`list_budgets`/`create_budget`/`update_budget` read and write the
   fields; actors `user:…` and `mcp:…` (`apps/worker/test/plan-formats.test.ts`).
8. Refusals: `XXX` → 422 `unknown_currency`; JPY with `123,456.78` → 422 `number_format_not_offered`; `D/M/Y` → 422
   `unknown_date_format`; row and change_log unchanged.
9. PATCH `{currency_format:{iso_code:"SEK"}}` stores `123.456,78`, after, date unchanged; a date-only PATCH keeps the
   currency.
10. D1: PATCH 2 (rename, every field), GET list 1, GET one 1, POST 1.
11. Note 10 figures pass as unit tests.
12. `pnpm check` and the full e2e pass with no edited expectation beyond the departures.
13. Typing: `1.234,56` in `123.456,78` → 1,234,560; `1500` JPY → 1,500,000; `30.12.2026` in `DD.MM.YYYY` →
    2026-12-30, `12/30/2026` → refused; a spec types `1.234,56` into Assigned in a Euro plan, server holds 1,234,560.
14. Files: the Worker round trip keeps formats and amounts; default-plan export tests pass unchanged.
15. `scripts/test/plan-formats-screens.test.ts` green; its count before the sweep reported.
16. EXF-726 point 4: `e2e/plan-formats-narrow.spec.ts`, 1024×700, default format, `−$888.88`, `$88,888.88`,
    `−$888,888.88` in Assigned, Activity, Available and a group row: each `scrollWidth ≤ clientWidth`, one line, right
    edge inside its cell; a name shows its first word; page `scrollWidth ≤ clientWidth`. Run once before the fix,
    failing lines quoted.
17. State 5 format with `−8.888.888,88€`: one line, `title` equals the amount, ellipsis when cut.
18. `e2e/plan-narrow.spec.ts` and every 1440 spec pass unedited.
19. At 1024×700 the dialog is inside the viewport; after closing, focus is on the plan button; empty name + Apply shows
    `Plan name is required.` and sends nothing.
20. Compare (source: the test plan's Plan page, 1440×900 and 1024×700, as it is): a default-format amount reads like
    the source's `$0.00` (`$` first, `,`, `.`, no sign at zero, Figtree 14/500 tabular). Dialog: not compared: built
    from the ticket.

### Looking

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh** screenshot in this Thread (not a file a spec or an earlier step wrote), opens it, and writes one sentence on what is seen in it. The report lists `state, size, file, sentence` for every one. A state without its two entries is PARTIAL with the words "not looked at". "A spec is green" is not looking. Earlier acceptance steps that took under 80 seconds let through a button with white text on a near-white background.

The states:
1. The plan menu with `Plan Settings` enabled.
2. The dialog as it opens (the name focused, its text selected; the four selects with the plan's values).
3. The dialog after choosing Euro (the placement labels with `€`), and after choosing Japanese Yen (three number formats, `123,456` selected).
4. The dialog with an empty name after Apply Settings (the inline error).
5. After applying Euro, `123.456,78`, After amount, `DD.MM.YYYY`: the Plan page (header, grid with a negative Available, right panel); an account's register with the BALANCE column on (dates and amounts); the sidebar's balances; the Activity popover; one Reflect report.
6. After applying Japanese Yen: the Plan page (no decimals anywhere).
7. After "Don't show": the Plan page and the register (no symbol anywhere).
8. EXF-726: the Plan page in the default format with amounts of eight, ten and twelve characters made of wide digits (`−$888.88`, `$88,888.88`, `−$888,888.88`) in Assigned, Activity and Available and in a group row.
9. The same page in the format of state 5 with an amount of fourteen characters (`−8.888.888,88€`).

## The order of the work (Implementer: commit after each part)

1. The migration, the catalogue with its test, the schema fields, PATCH, POST, the reads, the MCP tools with their coverage and descriptions, the Worker tests.
2. The formatter with its unit tests (note 10's figures) and the repository test of note 4.
3. The sweep: every screen through the formatter, until the repository test is green and every existing spec passes unedited.
4. Typing (note 6) and the files (note 7).
5. The dialog and its specs.
6. EXF-726 and its spec.

## Manifest

touches: [apps/worker/migrations/20261116101500_plan_formats.sql, apps/worker/src/db/schema/budgets.ts, apps/worker/src/repositories/budgets.ts, apps/worker/src/services/budgets.ts, apps/worker/src/services/plan-import.ts, apps/worker/src/services/plan-export.ts, apps/worker/src/services/transactions-export.ts, apps/worker/src/services/reports.ts, apps/worker/src/services/transactions.ts, apps/worker/src/services/transaction-splits.ts, apps/worker/src/routes/budgets.ts, apps/worker/src/mcp/tools/budgets.ts, apps/worker/test/plan-formats*.test.ts, apps/worker/test/mcp-tools.test.ts, apps/worker/test/plan-import-migration.test.ts, packages/schema/src/**, packages/schema/test/**, apps/web/src/**, scripts/test/plan-formats-screens.test.ts, e2e/plan-settings*.spec.ts, e2e/plan-formats*.spec.ts, docs/plan-formats-*.md, docs/README.md]
shared: [apps/web/src/shell/** (AppShell mounts PlanFormatsProvider; new plan-formats-context.tsx; SidebarAccounts, BankConnected and AddAccountDialog write and read amounts with the plan's formats)]
migrations: 1
