# Reconcile spec (EXF-533, EXF-664)

Implements [reconcile-design.md](reconcile-design.md); decisions are cited as D1–D12 and cases as "case n". Read `docs/conventions.md` first. Nobody opens the source app. Run `pnpm check` after every task; e2e only for the named specs (`pnpm e2e e2e/reconcile.spec.ts …`). After T1 delete `.e2e-state`.

Out of bounds (read, never change): `apps/web/src/plan/**`, `pages/plan.tsx`, `packages/core/**`, the schema/services/tests listed in the brief's note 8, every `paths.always_overlap` file, every shared module (`shell/**`, `router.tsx`, `api/client.ts`, `app.ts`, `mcp/server.ts`, `middleware/**`, `history/**`), `e2e/support/real-click.ts`, `openapi.test.ts`, `mcp.test.ts`, `e2e/mcp.spec.ts`. No new dependency.

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
export function reconciledAgo(iso: string, nowMs: number): string; // D11
export function reconciledTitle(iso: string): string;              // D11, local time
```

Avoid an import cycle: `accounts.ts` imports nothing from `reconcile.ts`.
- Verify: `packages/schema/test/reconcile.test.ts`: the sentence for −100000, +144500, 0, −1234567890 (thousands separators); every D11 threshold boundary (44 s/45 s, 89 s/90 s, 44 min/45 min, 21 h/22 h, 35 h/36 h, 25 d/26 d, 45 d/46 d, 319 d/320 d, 547 d/548 d) and a future time; `reconciledTitle` matches case 2's regex.

## T3 Screen formatter (D12, EXF-664)

- `packages/schema/src/screen-money.ts`: `export const MINUS = "−"`; `export function screenMoney(m: number): string`: `Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(m/1000)`, a leading `-` replaced by `MINUS`, and `"−$0.00"` returned as `"$0.00"`.
- `reflect-format.ts`: `reportMoney` (keeps its cent rounding) writes `MINUS`; `debtsMoney`, `drillAmount`, `tickMoney` use `MINUS`; `minusMoney` returns `reportMoney(m)`. Update the doc comments.
- `split.ts` `unbalancedText` uses `screenMoney`.
- Web: replace `formatMoney` with `screenMoney` in `AccountHeader.tsx` (`BalanceRow`), `register/selection.tsx` (`SelectedTotal`), `register/CategoryField.tsx`, `register/ActionBar.tsx` (refusal text), `account/CloseAccountDialog.tsx`. Leave `EditAccountDialog` `balanceText`, `register/format.ts` `registerMoney` (absolute) and everything in the out-of-bounds list alone.
- Verify:
  - `packages/schema/test/screen-money.reconcile.test.ts` (the name carries `reconcile`): −444000 → "−$444.00"; −4 → "$0.00"; 0 → "$0.00"; 1234500 → "$1,234.50"; −1234567890 → "−$1,234,567.89"; no output contains U+002D.
  - Update the `reflect-format.test.ts` and `split.test.ts` expectations to U+2212, and any other unit test that fails only on the sign.
  - The register CSV and plan export tests are unchanged and pass.

## T4 Repository `apps/worker/src/repositories/reconcile.ts` (new)

- `clearedSumIs(accountId, amount): SQL`: the cleared sum, with exactly the predicate `balancesByAccount` uses for its cleared part (`countsInBalance()` and `cleared in ('cleared','reconciled')`), equals `amount`.
- `reconcileLogsStmt(db, { budgetId, accountId, actor, now, guard })`: one `INSERT INTO change_log (id, budget_id, actor, action, entity_type, entity_id, before_json, after_json, created_at) SELECT <uuid expr>, budget_id, actor, 'update', 'transaction', t.id, json_object('id', t.id, 'cleared', 'cleared'), json_object('id', t.id, 'cleared', 'reconciled', 'updated_at', now), now FROM transactions t WHERE t.account_id = ? AND t.cleared = 'cleared' AND <countsInBalance> AND exists(guard)`. Use the UUID-v4 SQL expression of `20261116100100_payees.sql`. Use the Drizzle `changeLog` table (read-only import of the schema file); `history/**` is not changed.
- `reconcileFlagsStmt(db, { accountId, now, guard })`: `UPDATE transactions SET cleared='reconciled', updated_at=now WHERE account_id=? AND cleared='cleared' AND <countsInBalance> AND exists(guard)`.
- `markReconciledStmt(db, before: AccountRow, now, extra: SQL)`: `UPDATE accounts SET last_reconciled_at = now WHERE <holdsCondition(before)> AND extra`. Add it to `repositories/accounts.ts` if `holdsCondition` stays private there.
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
   - `[...payeeStmts]`
   - `reconcileLogsStmt(G)`
   - `reconcileFlagsStmt(G)`
   - `markReconciledStmt(before, now, clearedSumIs(...))` ← marker; remember its index
   - if `d ≠ 0`: `txRepo.insertIfStmt(db, tx, reconciledAtIs(...), payeesRepo.systemIdSql(budgetId, "reconciliation_adjustment"))`, then `changeLogInsertIf(create transaction, transactionExistsStmt(tx.id))`
   - `changeLogInsertIf(update account: before = accountToApi(before, facts), after, reconciledAtIs(...))`
6. Marker `meta.changes === 0`: re-read with `txRepo.balancesByAccount(db, budgetId, accountId)` and throw 409 `reconcile_changed` with the new `C'` and `S − C'`. Never retry.
7. Return `{ account: accountToApi({ ...before, lastReconciledAt: now }, { ...facts, cleared: C + d, canDelete: d ≠ 0 ? false : facts.canDelete }), reconciled_count: <flags statement meta.changes>, adjustment: d ≠ 0 ? transactionToApi({ ...tx, payeeId: sys.id }) : null }`. **No read after the batch.**
- Calls: 6 without an adjustment, 7 with one (D5).

## T6 PATCH rule (D4)

- `packages/schema/src/transactions.ts` `updateFields`: `confirm_reconciled: z.boolean().optional().describe("Must be true to change the amount, date, account, cleared state or transfer account of a reconciled transaction (or of a transfer whose other side is reconciled)")`. The "Nothing to update" refine ignores `confirm_reconciled`.
- `services/transactions.ts`:
  - `mutate("update")`: drop the blanket refusal for reconciled rows. Keep it for `kind === "delete"` (409 as today).
  - Add `const LOCKED_FIELDS = ["amount","date","account_id","cleared","transfer_account_id"]`. A field counts as changed when it is present and differs from `before` (for `transfer_account_id`, when it differs from `before.transferAccountId`).
  - If `before.cleared === "reconciled"` and a locked field changes and `!patch.confirm_reconciled` → `TransactionRefused(409, "transaction_reconciled", "This transaction is reconciled: send confirm_reconciled true to change its amount, date, account or cleared state")`.
  - `prepare`: `refuseOtherReconciled` applies on update only when a locked field changes and `!confirm_reconciled`.
  - `after.cleared`: keep `"reconciled"` unless `cleared` is sent. `parseCleared` still refuses `"reconciled"` as a value (422).
  - The flag-only path is unchanged. Strip `confirm_reconciled` before the patch reaches the field mapping and the logs.
- `routes/transactions.ts`: the PATCH 409 description names `confirm_reconciled`.
- `mcp/tools/transactions.ts` `update_transaction`: the input gets `confirm_reconciled` (via `transactionUpdateShape`). Replace the description sentence "A reconciled transaction … cannot be changed" with the D4 rule.
- Verify, updating these existing tests (intended behaviour change):
  - `transactions.test.ts` "reconciled rows cannot change or go" → memo 200; amount 409 with nothing written; DELETE 409.
  - `transaction-flags.test.ts` "flag with another field" → `{flag_color, amount}` 409, `{flag_color, memo}` 200.
  - `transfers.test.ts` keeps its 409 for `amount` and adds `confirm_reconciled: true` → 200.

## T7 Route and tool

- `apps/worker/src/routes/reconcile.ts` (new, `export default` `OpenAPIHono<AppEnv>`): `POST /budgets/{budget_id}/accounts/{account_id}/reconcile`, body `ReconcileRequest`, responses 200 `ReconcileResponse`, 409 `ReconcileConflictBody`, 422/404 `ErrorBody`, tag Accounts, `Idempotency-Key` accepted as on other writes. Catch `ReconcileRefused`: on 409 return `c.json({ error: { id: "409", name: e.code, detail: e.message, difference: e.difference, cleared_balance: e.cleared } }, 409)`; on 422 use `apiError`.
- `apps/worker/src/mcp/tools/reconcile.ts` (new): `reconcile_account({ budget_id: Id, account_id: Id, statement_balance: Milliunits, create_adjustment?: boolean, cleared_balance?: Milliunits, today?: IsoDate })`, calling `reconcileAccount` with the actor. Description:
  - what it does: every cleared transaction becomes reconciled and `last_reconciled_at` is set;
  - the two refusals as tool errors (`reconcile_difference` with the difference, `reconcile_changed`), `account_closed`;
  - the adjustment's payee, memo and category rule (D3);
  - `Returns { account, reconciled_count, adjustment }`;
  - `${MONEY}`, `${dates("today", "date")}`, `${timestamps(["updated_at", "created_at", "last_reconciled_at"])}`.
- `mcp/tools/accounts.ts`: every tool whose result holds an `Account` adds `last_reconciled_at` to its `timestamps([...], ["last_reconciled_at", …])` call as nullable. Do the same in any other tool file the timestamps test names.
- `apps/worker/test/mcp-coverage/accounts.ts`: `"POST /budgets/{budget_id}/accounts/{account_id}/reconcile": { tool: "reconcile_account" }`.
- `apps/worker/test/mcp-timestamps.test.ts`: one `CALLS` line, `["reconcile_account", (c) => ({ budget_id: c.bid, account_id: c.checking, statement_balance: <its cleared balance>, create_adjustment: true })]`. Place it after the lines that read `c.checking`'s rows, or use a spare account, so it changes nothing the other calls expect.
- Verify: `mcp-coverage`, `mcp-descriptions`, `mcp-timestamps` and `openapi` tests pass.

## T8 Worker tests (new; names carry `reconcile`)

- `apps/worker/test/reconcile-helpers.ts`: `seedWorkedExample()` builds fixture W through REST (design, Acceptance) and returns the ids.
- `reconcile.test.ts`: cases 11, 12 (to the milliunit), 13, 16, 17 (the tool through `mcpRpc`), plus:
  - the surface: `apiPaths()` contains the path and `listedToolNames()` contains `reconcile_account`;
  - change_log actor rows;
  - Idempotency-Key replay returns the same answer;
  - a Yes on an account with no cleared rows sets `last_reconciled_at` with `reconciled_count` 0;
  - a second reconcile leaves earlier reconciled rows alone (count only the new ones).
- `reconcile-calls.test.ts`: the counting proxy of `bulk-call-count.test.ts` (copy it; don't import from that file). Seed 10 and 1,000 cleared rows with set SQL (`setSql`-style `INSERT … SELECT` from a recursive CTE). Assert `calls(10) === calls(1000)`, both equal to the measured 6 without an adjustment and 7 with one. Assert that afterwards all 1,000 are `reconciled` with 1,000 change_log rows.
- `reconcile-race.test.ts`: an `env` whose `DB.batch` first awaits an injected `before()` once. Cases:
  - (a) `before` unclears a cleared row (direct SQL) → 409 `reconcile_changed`, `difference` = S − C′, nothing reconciled, no new change_log rows, `last_reconciled_at` null;
  - (b) `before` runs a full `reconcileAccount(..., create_adjustment: true)` on the real env → exactly one adjustment row, the outer call is 409;
  - (c) a stale `cleared_balance` → 409 `reconcile_changed` with no batch at all.

## T9 Web data

- `packages/schema/src/ui-state.ts`: add `hide_reconcile_difference_dialog: z.boolean()` (one line).
- `apps/web/src/api/accounts.ts`: `reconcileAccount(budgetId, accountId, body: ReconcileRequestInput)` (POST, `Idempotency-Key`, `ReconcileResponse`) and `useReconcileAccount(budgetId, accountId)`, which on success **and** on a 409 `reconcile_changed` runs the existing `useInvalidatePlan`.
- `apps/web/src/api/transactions.ts`: nothing beyond the type (`confirm_reconciled` comes with `TransactionUpdateRequest`).

## T10 Header, popover, modal (D7–D11)

`apps/web/src/account/`:
- `ReconcileContext.tsx`: `ReconcileProvider({ account, children })` and `useReconcile()`, which returns `null` outside a provider. State: `{ step: "idle" | "ask" | "enter" | "done" | "difference" | "mode", statement?: number }` plus actions `open()`, `cancel()`, `enterMode(statement)`, `finish(createAdjustment)`. `finish` calls `useReconcileAccount` with `{ statement_balance, create_adjustment, cleared_balance: account.cleared_balance, today: localToday() }`. On success go to `idle`, or to `done` when it came from Yes. On 409 `reconcile_changed` keep the step. Other errors show `role="alert"` text in the bar or popover.
- `pages/account.tsx`: wrap the header and register in `<ReconcileProvider key={account.id} account={account}>` once the account is loaded. The props come from the page's `useAccount`; the provider fetches nothing.
- `ReconcileButton.tsx`: replaces the inert button in `AccountHeader` and keeps its class, tooltip and text, without `data-ticket`.
  - `useShortcut("reconcile", open, enabled)`, where enabled = the account is open and the step is `idle`.
  - Disabled when the account is closed or the step is `mode`.
  - Its popover is anchored under the button, right-aligned, `role="dialog"`, `aria-label="Reconcile"`, closing on Escape and outside click. Steps:
    - `ask`: "Is your current balance" over the big `${screenMoney(account.cleared_balance)}?`, buttons "No" (secondary) and "Yes" (primary). Yes calls `finish(false)` with statement = cleared.
    - `enter`: label "Current balance at your bank" (`<label for>`), an input (autofocus, `inputmode="decimal"`, U+2212 normalised to "-" before `parseAmountInput`), and "Next" (primary), disabled while the value doesn't parse. Enter submits. Equal to cleared → `enterMode` (D10). Otherwise `ui.hide_reconcile_difference_dialog` → `enterMode`, else step `difference`.
    - `done`: own SVG lock-with-check art (`LockCheckArt` in `icons.tsx`, 64px, colour `--statusPositive`), "Account reconciled", "Time for the reconciliation dance!".
- `DifferenceDialog.tsx`: modal (`role="dialog"`, `aria-modal`, `aria-label="Difference"`, the app's `dialog` classes as in `BulkDialogs.tsx`) with:
  - the big signed `screenMoney(statement − cleared)`, "Difference", and the three `DIFFERENCE_TEXT` paragraphs;
  - a footer with the checkbox "Don't Show Again" (left) and "Next" (primary, right). Next saves the UI state when ticked, then `enterMode(statement)`. Escape → `cancel()`.
- `ReconciledLabel` in `AccountHeader.tsx`: `last_reconciled_at === null` → lock + "Not Yet Reconciled"; else lock + `Reconciled ${reconciledAgo(..., now)}` with `title={reconciledTitle(...)}`. `now` comes from a 30 s interval held only in that component.
- `reconcile.css`: tokens only. The popover is 280px wide, the big amount 24px/700, and the buttons use the header's button styles. The modal follows the register dialogs. No size changes elsewhere in the header.
- Verify: case 1, 2, 3, 9, 10 in `e2e/reconcile.spec.ts`.

## T11 Register (bar, locked rows)

- `register/ReconcileBar.tsx`: renders when `useReconcile()?.step === "mode"`, between `RegisterToolbar` and `RegisterTable` in `Register.tsx`. It is `<div class="reconcile-bar" role="region" aria-label="Reconciliation">` holding:
  - `<p class="reconcile-text">` with `reconcileSentence(statement − account.cleared_balance)` (the account comes from `useReconcile`, which holds the page's account);
  - the buttons "Cancel" (secondary) and "Create Adjustment & Finish", or "Finish Reconciliation" at zero (primary, busy-disabled while the request runs).
  - Layout: `display:flex; flex-wrap:wrap; justify-content:space-between; gap:8px 16px`; the text `white-space:nowrap`; the button group `margin-left:auto`. At 1024×700 with the default sidebar the sentence stays on one line and the buttons wrap under it when needed.
- `RegisterTable.tsx`: a reconciled row opens for editing like any row (`onRowClick` and `onDoubleClick` lose the reconciled exceptions). `ClearedCell` stays as it is (disabled lock, `title`, `aria-label` "This transaction is reconciled"). The category cell's "This needs a category" for reconciled rows becomes the normal button.
- `entryDraft.ts`: `cleared` becomes `"uncleared" | "cleared" | "reconciled"`; the draft keeps `reconciled`; `patch.cleared` is sent only when it changed. Add `touchesLocked(d, was): boolean` (amount, date or account changed).
- `EntryRow.tsx`:
  - The cleared cell shows the disabled lock for `reconciled`.
  - On save, a reconciled draft with `touchesLocked` opens `ReconciledSaveDialog` (in `BulkDialogs.tsx`): title "Save Changes to Reconciled Transaction", body "Saving your changes to this reconciled transaction may bring your reconciliation out of balance.", buttons "Cancel" and "Save". Save resends with `confirm_reconciled: true`; Cancel returns to the open editor.
  - A 409 `transaction_reconciled` on any save (for example a transfer's reconciled other side) opens the same dialog.
  - A memo-only change saves at once.
- Verify: cases 4–8 in `e2e/reconcile.spec.ts`; `register.spec.ts` and `register-bulk.spec.ts` pass.

## T12 Specs (browser; `realClick`; exact names; plans made through the API)

- `e2e/support/reconcile-seed.ts`: fixture W through the API (the e2e twin of T8's helper), plus `seedReconcileCard(request, name)` (card with long name, balances near −$12,345.67, a Payment pill).
- `e2e/reconcile.spec.ts`: cases 1–10 in order on fixture W.
  - Wait for each request with `expect.poll` on the API (account cleared balance, rows' `cleared`, `last_reconciled_at`).
  - Case 6 reads Ready to Assign through the month API before and after.
  - Case 7 asserts no request with `page.waitForRequest` racing a 500 ms timeout.
- `e2e/reconcile-narrow.spec.ts`: case 18 at 1024×700 and the Reconcile location at 1440×900. Measure `scrollWidth ≤ clientWidth` and bounding boxes for:
  - the `h1`, `.acct-info` and `.acct-actions` (right edge ≤ `.acct-head-top`'s);
  - the balance row with the Payment pill;
  - `.reconcile-text` (one line: height ≤ 1.5 × line-height) and both buttons inside `.reconcile-bar`;
  - the popover, the Difference modal and the save confirmation inside the viewport.

  Assert `getByRole("toolbar", { name: "Register toolbar" })` contains no "Reconcile".
- `e2e/reconcile-minus-sign.spec.ts` (case 19): a plan with negative figures (a negative category activity on the Plan page, an uncleared outflow, a debt for Net Worth). Read `innerText` plus every `[title]` and `[aria-label]` on:
  - the Plan page;
  - an account register with two rows selected (header balances, Selected Total, row amounts), the reconcile bar and the Difference modal;
  - Net Worth.

  Fail on `/-(?=\$|\d)/` inside amount-like tokens (`/[-−]?\$[\d,]+\.\d{2}/`). Don't flag dates or ids.
- Update the "-$" → "−$" assertions in the e2e files listed in the Manifest; change nothing else in them.
- Verify: `pnpm e2e e2e/reconcile.spec.ts e2e/reconcile-narrow.spec.ts e2e/reconcile-minus-sign.spec.ts` plus each edited spec, then `pnpm check`. Save the Tester's screenshot names from the design.

## Done when

- `pnpm check` is green.
- The specs above pass alone and with `--repeat-each=3`.
- `git diff --stat origin/main` shows only Manifest paths.
- No out-of-bounds file, shared module or dependency changed.
- `docs/README.md` has one line for the design (added by the Architect).
