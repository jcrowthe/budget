# Reconcile spec (EXF-533, EXF-664)

Implements [reconcile-design.md](reconcile-design.md); decisions are cited as D1–D12 and cases as "case n". Read `docs/conventions.md` first. Nobody opens the source app. Run `pnpm check` after every task; e2e only for the named specs (`pnpm e2e e2e/reconcile.spec.ts …`). After T1 delete `.e2e-state`.

Out of bounds (read, never change): the brief's out-of-bounds list (note 3 of the carry-over brief: `apps/web/src/plan/**`, `pages/plan.tsx`, `packages/core/**`, …), every `paths.always_overlap` file and shared module, `e2e/support/real-click.ts`, the tests the conventions say are never edited. No new dependency.

## T1 Column (D1)

- `apps/worker/migrations/20261116101400_account_reconciled_at.sql`: `ALTER TABLE accounts ADD COLUMN last_reconciled_at TEXT;` (only this line).
- `db/schema/accounts.ts`: `lastReconciledAt: text("last_reconciled_at")`.
- Every literal `AccountRow` (typecheck finds them: `services/accounts.ts`, `account-links.ts`, tests' helpers) sets `lastReconciledAt: null`.
- `packages/schema/src/accounts.ts` `Account`: `last_reconciled_at: z.string().nullable().openapi({ description: "When the account was last reconciled (ISO 8601 UTC); null before the first reconcile" })`. `accountToApi` maps it.
- Verify: `schema-drift.test.ts` passes; GET account shows `last_reconciled_at: null`.

## T2 Schema module `packages/schema/src/reconcile.ts` (new)

```ts
export const RECONCILE_ADJUSTMENT_PAYEE = "Reconciliation Balance Adjustment";
export const RECONCILE_MEMO = "Entered automatically by Budget";
export const reconcileFields = {
  statement_balance: Milliunits,               // the balance at the bank
  create_adjustment: z.boolean().optional(),   // default false
  cleared_balance: Milliunits.optional(),      // the cleared balance the caller saw and confirmed
  today: PlanDate.optional(),                  // the adjustment's date; default UTC today
};
export const ReconcileRequest = z.object(reconcileFields).strict().openapi("ReconcileRequest");
export const ReconcileResult = z.object({ account: Account, reconciled_count: z.number().int().min(0), adjustment: Transaction.nullable() });
export const ReconcileResponse = dataEnvelope(ReconcileResult).openapi("ReconcileResponse");
export const ReconcileConflictBody = z.object({ error: z.object({ id: z.string(), name: z.enum(["reconcile_difference","reconcile_changed"]), detail: z.string(), difference: Milliunits, cleared_balance: Milliunits }) }).openapi("ReconcileConflict");
export const reconcileDifference = (statement: number, cleared: number) => statement - cleared;
/** "This account's cleared balance in Budget is $100.00 higher than your actual account." / "lower than" / "is the same as your actual account." */
export function reconcileSentence(difference: number): string;   // amount = screenMoney(|difference|); difference < 0 → "higher"
export const DIFFERENCE_TEXT: readonly [string, string, string];  // the modal's three paragraphs, design case 3 / ticket, with "Budget"
export function reconciledAgo(iso: string, nowMs: number): string; // D11, thresholds below
export function reconciledTitle(iso: string): string;              // D11, local time
```

`reconciledAgo` thresholds: "a few seconds ago" <45 s (and any future time), "a minute ago" <90 s, "N minutes ago" <45 min, "an hour ago" <90 min, "N hours ago" <22 h, "a day ago" <36 h, "N days ago" <26 d, "a month ago" <46 d, "N months ago" <320 d, "a year ago" <548 d, else "N years ago". `accounts.ts` imports nothing from `reconcile.ts` (no cycle).
- Verify: `packages/schema/test/reconcile.test.ts`: the sentence for −100000, +144500, 0, −1234567890 (thousands separators); every D11 threshold boundary (44 s/45 s, 89 s/90 s, 44 min/45 min, 21 h/22 h, 35 h/36 h, 25 d/26 d, 45 d/46 d, 319 d/320 d, 547 d/548 d) and a future time; `reconciledTitle` matches case 2's regex.

## T3 Screen formatter (D12, EXF-664)

- `packages/schema/src/screen-money.ts`: `export const MINUS = "−"`; `export function screenMoney(m: number): string`: `Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(m/1000)`, a leading `-` replaced by `MINUS`, and `"−$0.00"` returned as `"$0.00"`.
- `reflect-format.ts`: `reportMoney` (keeps its cent rounding) writes `MINUS`; `debtsMoney`, `drillAmount`, `tickMoney` use `MINUS`; `minusMoney` returns `reportMoney(m)`. Update the doc comments.
- `split.ts` `unbalancedText` uses `screenMoney`.
- Web: replace `formatMoney` with `screenMoney` in `AccountHeader.tsx` (`BalanceRow`), `register/selection.tsx` (`SelectedTotal`), `register/CategoryField.tsx`, `register/ActionBar.tsx` (refusal text), `account/CloseAccountDialog.tsx`. Leave `EditAccountDialog` `balanceText`, `register/format.ts` `registerMoney` (absolute) and everything in the out-of-bounds list alone.
- Verify: `packages/schema/test/screen-money.reconcile.test.ts`: −444000 → "−$444.00", −4 → "$0.00", 0 → "$0.00", 1234500 → "$1,234.50", −1234567890 → "−$1,234,567.89", no U+002D in any output. `reflect-format.test.ts`, `split.test.ts` (and any unit test failing only on the sign) expect U+2212. Register CSV and plan export tests unchanged and green.

## T4 Repository `apps/worker/src/repositories/reconcile.ts` (new)

- `clearedSumIs(accountId, amount): SQL`: the cleared sum, with exactly the predicate `balancesByAccount` uses for its cleared part (`countsInBalance()` and `cleared in ('cleared','reconciled')`), equals `amount`.
- `reconcileLogsStmt(db, { budgetId, accountId, actor, now, guard })`: one `INSERT INTO change_log (id, budget_id, actor, action, entity_type, entity_id, before_json, after_json, created_at) SELECT <uuid expr>, t.budget_id, ${actor}, 'update', 'transaction', t.id, json_object('id', t.id, 'cleared', 'cleared'), json_object('id', t.id, 'cleared', 'reconciled', 'updated_at', now), now FROM transactions t WHERE t.account_id = ? AND t.cleared = 'cleared' AND <countsInBalance> AND exists(guard)`. UUID-v4 SQL expression as in `20261116100100_payees.sql`; Drizzle `changeLog` table imported read-only; `history/**` unchanged.
- `reconcileFlagsStmt(db, { accountId, now, guard })`: `UPDATE transactions SET cleared='reconciled', updated_at=now WHERE account_id=? AND cleared='cleared' AND <countsInBalance> AND exists(guard)`.
- `markReconciledStmt(db, before: AccountRow, now, extra: SQL)`: `UPDATE accounts SET last_reconciled_at = now WHERE <holdsCondition(before)> AND extra`. (In `repositories/accounts.ts`, where `holdsCondition` is private.)
- `reconciledAtIs(db, accountId, now)`: `SELECT 1 FROM accounts WHERE id=? AND last_reconciled_at = now` (the marker guard).
- Every function returns an **unexecuted** statement or SQL (conventions step 4).

## T5 Service `apps/worker/src/services/reconcile.ts` (new) (D2, D3, D5, D6)

`export class ReconcileRefused extends Error { status: 409|422; code: "reconcile_difference"|"reconcile_changed"|"account_closed"; difference?: number; cleared?: number }`

`export async function reconcileAccount(env, actor, budgetId, accountId, input): Promise<ReconcileResult>`:
1. Parse `ReconcileRequest`. `budgetsRepo.findActive` (404 Plan). `accountsRepo.findActive` (404 Account). If closed → `ReconcileRefused(422, "account_closed", "A closed account cannot be reconciled")`.
2. `facts = (await accountFacts(db, budgetId, accountId))(before)` (3 set queries). `C = facts.cleared`, `d = statement − C`.
3. `cleared_balance` given and ≠ C → 409 `reconcile_changed`. `d ≠ 0 && !create_adjustment` → 409 `reconcile_difference`. Detail: `"The cleared balance (C milliunits) differs from statement_balance (S milliunits) by difference d milliunits"`, prefixed for `reconcile_changed` with `"The cleared balance changed. "`.
4. When `d ≠ 0`: `payeesRepo.findSystem(db, budgetId, "reconciliation_adjustment")` and `systemPayee(..., "reconciliation_adjustment", RECONCILE_ADJUSTMENT_PAYEE, now)`. Build the row with the generalised `adjustmentRow(before, sys, d, date, RECONCILE_MEMO, now, { payeeName: RECONCILE_ADJUSTMENT_PAYEE, cleared: "reconciled" })`. Export both helpers from `services/accounts.ts`; keep `adjustBalance` and `closeAccount` behaviour identical.
5. `G = accountsRepo.accountHolds(db, before, clearedSumIs(accountId, C))`. Batch, in order:
   - `...payeeStmts`, `reconcileLogsStmt(G)`, `reconcileFlagsStmt(G)` (logs first: they select the still-`cleared` rows)
   - `markReconciledStmt(before, now, clearedSumIs(...))` ← marker (the flags keep the cleared sum, so it still holds); remember its index
   - if `d ≠ 0`: `txRepo.insertIfStmt(db, tx, reconciledAtIs(...), payeesRepo.systemIdSql(budgetId, "reconciliation_adjustment"))`, then `changeLogInsertIf(create transaction, transactionExistsStmt(tx.id))`
   - `changeLogInsertIf(update account: before = accountToApi(before, facts), after, reconciledAtIs(...))`
6. Marker `meta.changes === 0`: re-read with `txRepo.balancesByAccount(db, budgetId, accountId)` and throw 409 `reconcile_changed` with the new `C'` and `S − C'`. Never retry.
7. Return `{ account: accountToApi({ ...before, lastReconciledAt: now }, { ...facts, cleared: C + d, canDelete: d ≠ 0 ? false : facts.canDelete }), reconciled_count: <flags statement meta.changes>, adjustment: d ≠ 0 ? transactionToApi({ ...tx, payeeId: sys.id }) : null }`. **No read after the batch.**
- Calls: 6 without an adjustment, 7 with one (D5).

## T6 PATCH rule (D4)

- `packages/schema/src/transactions.ts` `updateFields`: `confirm_reconciled: z.boolean().optional()`, described as "Must be true to change the amount, date, account, cleared state or transfer account of a reconciled transaction (or of a transfer whose other side is reconciled)". The "Nothing to update" refine ignores it.
- `services/transactions.ts`:
  - `mutate`: drop the blanket refusal (line ~831) for `update`; keep it for `delete`.
  - `LOCKED_FIELDS = ["amount","date","account_id","cleared","transfer_account_id"]`; a field changes when present and different from `before` (`transfer_account_id` against `before.transferAccountId`).
  - `before.cleared === "reconciled"`, a locked field changes and `!confirm_reconciled` → `TransactionRefused(409, "transaction_reconciled", "This transaction is reconciled: send confirm_reconciled true to change its amount, date, account or cleared state")`. In `prepare`, `refuseOtherReconciled` applies on update under the same condition.
  - `after.cleared` stays `"reconciled"` unless `cleared` is sent; `parseCleared` still refuses the value `"reconciled"` (422). The flag-only path is unchanged. `confirm_reconciled` never reaches the field mapping or the logs.
- `routes/transactions.ts`: the PATCH 409 description names `confirm_reconciled`. `mcp/tools/transactions.ts` `update_transaction`: input gains it (via `transactionUpdateShape`); the description's "cannot be changed" sentence becomes the D4 rule.
- Verify by updating (intended change): `transactions.test.ts` "reconciled rows cannot change or go" → memo 200, amount 409 with nothing written, DELETE 409; `transaction-flags.test.ts` "flag with another field" → `{flag_color, amount}` 409, `{flag_color, memo}` 200; `transfers.test.ts` keeps its `amount` 409 and adds `confirm_reconciled: true` → 200.

## T7 Route and tool

Routes and tools are found by glob (`app.ts`, `mcp/server.ts`): neither file changes.
- `apps/worker/src/routes/reconcile.ts` (new, default `OpenAPIHono<AppEnv>`): `POST /budgets/{budget_id}/accounts/{account_id}/reconcile`, body `ReconcileRequest`; 200 `ReconcileResponse`, 409 `ReconcileConflictBody`, 422/404 `ErrorBody`; tag Accounts; `Idempotency-Key` as on other writes. Catch `ReconcileRefused`: 409 → `c.json({ error: { id: "409", name: e.code, detail: e.message, difference: e.difference, cleared_balance: e.cleared } }, 409)`; 422 → `apiError`.
- `apps/worker/src/mcp/tools/reconcile.ts` (new): `reconcile_account({ budget_id, account_id, statement_balance, create_adjustment?, cleared_balance?, today? })` calling `reconcileAccount` with the actor. Description: cleared rows become reconciled and `last_reconciled_at` is set; tool errors `reconcile_difference` (with the difference), `reconcile_changed`, `account_closed`; the adjustment's payee, memo and category rule (D3); `Returns { account, reconciled_count, adjustment }`; `${MONEY}`, `${dates("today", "date")}`, `${timestamps(["updated_at", "created_at", "last_reconciled_at"], ["last_reconciled_at"])}`.
- `mcp/tools/accounts.ts` (and any tool file the timestamps test names for an `Account`): add `last_reconciled_at` to `timestamps(...)` as nullable.
- `apps/worker/test/mcp-coverage/accounts.ts`: `"POST /budgets/{budget_id}/accounts/{account_id}/reconcile": { tool: "reconcile_account" }`.
- `apps/worker/test/mcp-timestamps.test.ts`: one `CALLS` line for `reconcile_account` (statement = the account's cleared balance, `create_adjustment: true`), on a spare account or after the lines that read `c.checking`, so the other calls see nothing new.
- Verify: `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps`, `openapi` tests pass.

## T8 Worker tests (new; names carry `reconcile`)

- `apps/worker/test/reconcile-helpers.ts`: `seedWorkedExample()` builds fixture W through REST and returns the ids.
- `reconcile.test.ts`: cases 11, 12 (to the milliunit), 13, 16, 17 (via `mcpRpc` from `surface.ts`); `apiPaths()` has the path and `listedToolNames()` the tool; change_log actors; Idempotency-Key replay gives the same answer; Yes with no cleared rows sets `last_reconciled_at`, `reconciled_count` 0; a second reconcile counts only newly reconciled rows.
- `reconcile-calls.test.ts`: copy the counting proxy of `bulk-call-count.test.ts` (don't import it). Seed 10 and 1,000 cleared rows with set SQL (`INSERT … SELECT` from a recursive CTE). Assert `calls(10) === calls(1000)`, equal to 6 without and 7 with an adjustment, and all 1,000 `reconciled` with 1,000 change_log rows.
- `reconcile-race.test.ts`: an `env` whose `DB.batch` first awaits an injected `before()` once. (a) `before` unclears a cleared row → 409 `reconcile_changed`, `difference` = S − C′, nothing reconciled or logged, `last_reconciled_at` null. (b) `before` runs a full adjustment reconcile on the real env → one adjustment row, outer call 409. (c) stale `cleared_balance` → 409 with no batch.

## T9 Web data

- `packages/schema/src/ui-state.ts`: add `hide_reconcile_difference_dialog: z.boolean()` (one line).
- `apps/web/src/api/accounts.ts`: `reconcileAccount(budgetId, accountId, body: ReconcileRequestInput)` (POST, `Idempotency-Key`, `ReconcileResponse`) and `useReconcileAccount(budgetId, accountId)`, which on success **and** on a 409 `reconcile_changed` runs the existing `useInvalidatePlan`.
- `apps/web/src/api/transactions.ts`: nothing beyond the type (`confirm_reconciled` comes with `TransactionUpdateRequest`).

## T10 Header, popover, modal (D7–D11)

`apps/web/src/account/`:
- `ReconcileContext.tsx`: `ReconcileProvider({ account, children })`, `useReconcile()` (`null` outside a provider). State `{ step: "idle"|"ask"|"enter"|"done"|"difference"|"mode", statement?: number }`; actions `open()`, `cancel()`, `enterMode(statement)`, `finish(createAdjustment)`. `finish` calls `useReconcileAccount` with `{ statement_balance, create_adjustment, cleared_balance: account.cleared_balance, today: localToday() }`; success → `idle` (or `done` from Yes); 409 `reconcile_changed` keeps the step; other errors show `role="alert"` text in the bar or popover.
- `pages/account.tsx`: wrap header and register in `<ReconcileProvider key={account.id} account={account}>` once `useAccount` has loaded; the provider fetches nothing.
- `ReconcileButton.tsx` replaces the inert button in `AccountHeader` (same class, tooltip, text; no `data-ticket`). `useShortcut("reconcile", open, enabled)` with enabled = account open and step `idle`; disabled when closed or in `mode`. Popover under the button, right-aligned, `role="dialog"`, `aria-label="Reconcile"`, closes on Escape and outside click. Steps:
  - `ask`: "Is your current balance" over the big `${screenMoney(account.cleared_balance)}?`; "No" (secondary), "Yes" (primary; `finish(false)` with statement = cleared).
  - `enter`: `<label for>` "Current balance at your bank", input (autofocus, `inputmode="decimal"`, U+2212 → "-" before `parseAmountInput`), "Next" (primary, disabled while unparsable); Enter submits. Equal to cleared → `enterMode` (D10); else `ui.hide_reconcile_difference_dialog` → `enterMode`, else step `difference`.
  - `done`: own SVG `LockCheckArt` (`icons.tsx`, 64px, `--statusPositive`), "Account reconciled", "Time for the reconciliation dance!".
- `DifferenceDialog.tsx`: modal (`role="dialog"`, `aria-modal`, `aria-label="Difference"`, the dialog classes of `BulkDialogs.tsx`): big signed `screenMoney(statement − cleared)`, "Difference", the three `DIFFERENCE_TEXT` paragraphs; footer checkbox "Don't Show Again" (left) and "Next" (primary, right; saves the UI state when ticked, then `enterMode`). Escape → `cancel()`.
- `ReconciledLabel` in `AccountHeader.tsx`: null → lock + "Not Yet Reconciled"; else lock + `Reconciled ${reconciledAgo(..., now)}` with `title={reconciledTitle(...)}`; `now` from a 30 s interval inside this component only.
- `reconcile.css`: tokens only; popover 280px wide, big amount 24px/700, header button styles; modal like the register dialogs; no other header size changes.
- Verify: cases 1, 2, 3, 9, 10 in `e2e/reconcile.spec.ts`.

## T11 Register (bar, locked rows)

- `register/ReconcileBar.tsx`: renders when `useReconcile()?.step === "mode"`, between `RegisterToolbar` and `RegisterTable` in `Register.tsx`: `<div class="reconcile-bar" role="region" aria-label="Reconciliation">` with `<p class="reconcile-text">` = `reconcileSentence(statement − account.cleared_balance)` (account from `useReconcile`), "Cancel" (secondary) and "Create Adjustment & Finish" or, at zero, "Finish Reconciliation" (primary, disabled while the request runs). Layout `display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px 16px`; text `white-space:nowrap`; buttons `margin-left:auto` (they wrap under the sentence at 1024 if needed).
- `RegisterTable.tsx`: reconciled rows open for editing like any row (`onRowClick`, `onDoubleClick` lose their reconciled exceptions); `ClearedCell` unchanged (disabled lock, `title`/`aria-label` "This transaction is reconciled"); the reconciled category cell becomes the normal button.
- `entryDraft.ts`: `cleared` gains `"reconciled"`, kept by the draft; `patch.cleared` sent only when changed; add `touchesLocked(d, was)` (amount, date or account changed).
- `EntryRow.tsx`: disabled lock for `reconciled`. Saving a reconciled draft with `touchesLocked`, or any save answered 409 `transaction_reconciled` (a transfer's reconciled other side), opens `ReconciledSaveDialog` (in `BulkDialogs.tsx`): "Save Changes to Reconciled Transaction", "Saving your changes to this reconciled transaction may bring your reconciliation out of balance.", "Cancel" (back to the open editor) and "Save" (resends with `confirm_reconciled: true`). A memo-only change saves at once.
- Verify: cases 4–8 in `e2e/reconcile.spec.ts`; `register.spec.ts`, `register-bulk.spec.ts` pass.

## T12 Specs (browser; `realClick`; exact names; plans made through the API)

- `e2e/support/reconcile-seed.ts`: fixture W through the API, and `seedReconcileCard(request, name)` (long-named card, balances near −$12,345.67, Payment pill).
- `e2e/reconcile.spec.ts`: cases 1–10 in order on fixture W; wait for each request with `expect.poll` on the API (cleared balance, rows' `cleared`, `last_reconciled_at`); case 6 reads Ready to Assign from the month API before and after; case 7 races `page.waitForRequest` against 500 ms.
- `e2e/reconcile-narrow.spec.ts`: case 18 at 1024×700, and the Reconcile location at 1440×900. `scrollWidth ≤ clientWidth` and boxes for the `h1`, `.acct-info`, `.acct-actions` (right edge ≤ `.acct-head-top`'s), the balance row with the pill, `.reconcile-text` (one line: height ≤ 1.5 × line-height) and both buttons inside `.reconcile-bar`, the popover, Difference modal and save confirmation inside the viewport. The `Register toolbar` toolbar contains no "Reconcile".
- `e2e/reconcile-minus-sign.spec.ts` (case 19): a plan with a negative category activity, an uncleared outflow and a debt. Read `innerText` and every `[title]`/`[aria-label]` on the Plan page, a register with two rows selected (header, Selected Total, rows), the reconcile bar and Difference modal, and Net Worth. Within amount tokens (`/[-−]?\$[\d,]+\.\d{2}/`) fail on `/-(?=\$|\d)/`; ignore dates and ids.
- Update only the "-$" → "−$" assertions of the e2e files in the Manifest.
- Verify: `pnpm e2e e2e/reconcile.spec.ts e2e/reconcile-narrow.spec.ts e2e/reconcile-minus-sign.spec.ts` plus each edited spec, then `pnpm check`.

## Done when

- `pnpm check` is green.
- The specs above pass alone and with `--repeat-each=3`.
- `git diff --stat origin/main` shows only Manifest paths.
- No out-of-bounds file, shared module or dependency changed.
- `docs/README.md` has one line for the design (added by the Architect).
