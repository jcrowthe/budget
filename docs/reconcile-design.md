# Reconcile design (EXF-533, EXF-664)

**EXF-533:** reconcile an account: the header's Reconcile button and `shift+E`, the popover, the Yes and No paths (Difference modal, reconcile mode with a live difference), the adjustment row, the header's reconciled label, locked rows editable with a confirmation, REST `POST …/reconcile` and the MCP tool `reconcile_account`.
**EXF-664:** one screen formatter writes every negative amount with the minus sign U+2212. Exports keep the ASCII hyphen.

## Source

**Not studied live:** nobody opens the source app in this Build (its test plan has only closed accounts). No study notes exist. Every screen is built from EXF-533's text (observed in the source; its screenshots are not in the repository); every acceptance case and polish item is **"not compared: built from the ticket"**. The lock illustration is the app's own art; "Budget" replaces the source's name ("recorded in Budget", memo "Entered automatically by Budget").

## What exists (read in the code)

- `transactions.cleared` is `uncleared | cleared | reconciled`; balances count `reconciled` as cleared (`txRepo.balancesByAccount`).
- Reconciled rows show the green lock (`RegisterTable.tsx` `ClearedCell`: `title` "This transaction is reconciled", `disabled`) and never open; PATCH/DELETE of one is always 409 `transaction_reconciled` (`services/transactions.ts` `mutate`); bulk delete takes `confirm_reconciled`.
- `PAYEE_SYSTEMS` has `reconciliation_adjustment`. `adjustBalance` (`services/accounts.ts`) is the guarded-adjustment pattern to copy (`systemPayee`, `adjustmentRow`, `accountHolds`, one batch).
- The header draws an inert Reconcile button with its tooltip and a static "Not Yet Reconciled"; the registry lists `reconcile` (`shift+e`) unbound.
- Screen money uses `formatMoney` (hyphen) in the header, `SelectedTotal`, `CategoryField`, `ActionBar`, `CloseAccountDialog`; Reflect's `reflect-format.ts` and `split.ts` also write a hyphen. `plan/format.ts`, `SidebarAccounts`, `targetMoney`, `signedChange`, `minusMoney` already write U+2212.

## Decisions

- **D1 Data.** Migration `20261116101400_account_reconciled_at.sql` (reserved name): `ALTER TABLE accounts ADD COLUMN last_reconciled_at TEXT;`. It is nullable, stores an ISO UTC timestamp, and is the only schema change. `Account` gains `last_reconciled_at: string | null`.
- **D2 Operation.** `POST /api/v1/budgets/{budget_id}/accounts/{account_id}/reconcile`, body `{ statement_balance, create_adjustment = false, cleared_balance?, today? }`:
  - `difference = statement_balance − cleared` (milliunits). `cleared` counts cleared and reconciled rows.
  - **409 `reconcile_changed`** when `cleared_balance` is sent and is not the server's cleared balance. The web always sends it: it is the balance the person confirmed.
  - **409 `reconcile_difference`** when `difference ≠ 0` and `create_adjustment` is false.
  - Both 409 bodies are `{ error: { id: "409", name, detail, difference, cleared_balance } }`; `detail` states the numbers in milliunits (the MCP error carries them).
  - Otherwise **one batch**: every live `cleared` row becomes `reconciled` (with `updated_at`) with one `change_log` row each, `accounts.last_reconciled_at = now`, the account's `update` log and, when `difference ≠ 0`, the adjustment row and its log. Answer: `{ account, reconciled_count, adjustment }` (`adjustment` null when none).
  - A closed account → 422 `account_closed`; unknown or deleted → 404. The adjustment's date is `today` (the browser's local date; default the UTC date).
- **D3 Adjustment row.**
  - Payee: system payee `reconciliation_adjustment`, "Reconciliation Balance Adjustment" (created in the batch when missing, like `systemPayee`). Memo "Entered automatically by Budget". Amount `difference`, `cleared: "reconciled"`, `approved: true`.
  - **Category:** "Inflow: Ready to Assign" (`inflow_to_ready_to_assign = on_budget`) on every on-plan account, credit cards and lines of credit included. No category on a tracking account (any off-plan type: loans, assets, liabilities).
  - **On a credit card** the credit engine counts it as an inflow to Ready to Assign (`credit-engine-design.md`, "Inflow to Ready to Assign (any account)"): Ready to Assign and the card balance move by the difference, the payment category does not. That is today's Manual Balance Adjustment on a card. Case 16.
- **D4 Locked rows (PATCH).**
  - A PATCH on a reconciled row (or on a transfer whose other side is reconciled) needs `confirm_reconciled: true` in the body when it changes `amount`, `date`, `account_id`, `cleared` or `transfer_account_id`. Without it the answer is 409 `transaction_reconciled` and nothing is written.
  - Every other field saves without asking: `payee_*`, `category_id`, `inflow_to_ready_to_assign`, `memo`, `approved`, `flag_color`, and `subtransactions` with an unchanged total.
  - An edit keeps `reconciled` unless `cleared` is sent. Sending `cleared` un-reconciles the row and needs the confirmation.
  - DELETE `/transactions/{id}` keeps its 409. The UI deletes through bulk with `confirm_reconciled`, which is unchanged.
  - The MCP tool `update_transaction` gains `confirm_reconciled`.
- **D5 D1 calls (conventions, "Services: D1 calls").** A reconcile reads with set queries and writes one batch: plan (1), account (1), `accountFacts` (3), the system payee (1, only when an adjustment is written), and the batch (1).
  - **6 calls without an adjustment, 7 with one, for 10 and for 1,000 cleared rows.**
  - The flags and their logs are two set statements (`UPDATE … WHERE cleared='cleared'`, `INSERT INTO change_log … SELECT … FROM transactions`). `reconcile-calls.test.ts` asserts these numbers and that 10 and 1,000 rows count the same.
- **D6 Two requests at once.** Every statement up to the marker runs only while guard **G** holds: the account is as read (`accountHolds`) and its cleared sum equals the cleared balance read (`clearedSumIs`). The marker is `accounts.last_reconciled_at = now`; the adjustment and the later logs run only while it holds. Two zero-difference reconciles at once both succeed; the second finds no `cleared` row and reconciles 0 (nothing written twice). If the marker changed no row, nothing was written: the service re-reads and answers 409 `reconcile_changed` with the new difference (no retry: the confirmed balance no longer holds). Case 15 forces it. The web computes the difference itself (`statement − account.cleared_balance`; `ApiError` exposes no extra fields); on 409 `reconcile_changed` it refetches the plan's queries and keeps its step with the new figures.
- **D7 Where Reconcile sits.** The Reconcile button stays in the header's top row (`.acct-actions`, beside the pencil) **at every width, 1440 and 1024 alike**. It never moves into the toolbar or its More button; the toolbar does not change. At 1024×700 the top row holds the name (ellipsis), the info line (badge + "Reconciled a few seconds ago"), the pencil and Reconcile; the balance row keeps the balances, Selected Total and a card's Payment pill as Record Payment left them. Case 18.
- **D8 Reconcile state in the web.** A `ReconcileProvider` (`account/`), mounted by `pages/account.tsx` per account, holds the step and the statement balance; the header uses it for the button, popover and modal, the register for the bar.
  - The live difference uses the `account` the page already holds (`useAccount`, refetched when a row changes). **No second fetch** of the account or the rows.
  - All Accounts mounts no provider: no button, no shortcut, no bar. In reconcile mode the button is disabled and `shift+E` does nothing; leaving the page leaves the mode.
- **D9 "Don't Show Again"** sets the UI-state key `hide_reconcile_difference_dialog` (added in `schema/ui-state.ts` only), the way the register's export dialog uses `hide_register_export_dialog`. When the key is set, No → Next goes straight to reconcile mode.
- **D10 Entering the balance that already matches.** On the No path, a bank balance equal to the cleared balance skips the Difference modal and enters reconcile mode at "the same", with "Finish Reconciliation".
- **D11 Relative time.** Pure `reconciledAgo(iso, nowMs)` in `schema/reconcile.ts` with the usual humanized thresholds ("a few seconds ago" under 45 s, then minutes, hours, days, months, years; the list is in spec T2); the label re-renders every 30 s. `title`: `toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })`, local time ("Nov 15, 2026, 8:06 PM").
- **D12 EXF-664 formatter.** New pure `packages/schema/src/screen-money.ts`: `MINUS` (U+2212) and `screenMoney(m)` (en-US USD, U+2212 before `$`, never a negative zero; schema does not import core). `reflect-format.ts` builds on it (`reportMoney`, `debtsMoney`, `drillAmount`, `tickMoney` write U+2212; `minusMoney` = `reportMoney`). Header, `SelectedTotal`, `CategoryField`, `ActionBar` refusals, `CloseAccountDialog`, `split.ts` `unbalancedText` and every reconcile string use it; register rows show absolute amounts and are unchanged.
  - **Hyphen kept:** the register CSV export (`schema/register-export.ts` `money`) and the plan export (`schema/plan-export.ts` `PlanFormat`), as their formats ask; editable input texts the parser reads back (`EditAccountDialog` `balanceText`, `formatAssignedInput`).
  - **Left alone, out of bounds:** `plan/format.ts` `money` (already U+2212; `plan/**` is held), `targetMoney` (already U+2212), `shell/BankConnected.tsx` (shared module; still `formatMoney`). Worker error texts are API text.

## Not in this Build (each for a reason)

- **Hiding reconciled rows** until "Show Reconciled Transactions" is on: that is the View menu (EXF-529). Reconciled rows stay visible with their lock.
- **File import skipping rows dated before the last reconciliation:** file import is not built (EXF-531). The bank import (Plaid) is not changed.
- **"How do I find my account balance?"** The app has no help pages, so the link is left out.
- **The success popover after Finish:** the ticket shows it on the Yes path only. Finishing in reconcile mode closes the bar, and the header label changes.
- **The Plan page's formatter** and `shell/BankConnected.tsx` (D12).

## What changes

Worker: the column, a reconcile repository, service, route and tool, the D4 rule in the transactions service. Schema: `reconcile.ts` and `screen-money.ts` (new), `accounts.ts`, `transactions.ts`, `ui-state.ts`, `reflect-format.ts`, `split.ts`. Web: header label, provider, button, popover, modal and art in `account/`; the bar, editable locked rows and the save confirmation in `register/`. Tasks are in the spec; files are in the Manifest.

## Downstream effects

- Every tool that returns an `Account` names `last_reconciled_at` as a nullable timestamp. The `mcp-timestamps` test gets one `reconcile_account` call.
- Specs and unit tests reading negative screen amounts change "-$" to "−$" (EXF-664 text updates, not departures).
- Worker tests that expected every change to a reconciled row refused (`transactions.test.ts`, `transaction-flags.test.ts`) now expect a memo to save and an amount to be refused (D4).
- The Reconcile button loses `data-ticket`; `account-header.spec.ts` and `all-accounts.spec.ts` keep their assertions.
- After the migration, delete `.e2e-state`.

## Acceptance

Every case is **not compared: built from the ticket**. Browser cases run at 1440×900 unless marked, and clicks use `realClick`.

**Fixture W (worked example)**, made through the API in plan "ZZ-TEST reconcile <random>":
- **ZZ-TEST Checking:** Starting Balance +500.00 cleared, then these rows:

  - cleared: ZZ Paycheck +300.00 and ZZ Refund +30.00 (both Ready to Assign), ZZ Grocer −45.00, ZZ Fuel −20.00, ZZ Pharmacy −9.50;
  - uncleared: transfer to ZZ-TEST Savings −100.00, ZZ Rent −120.00, ZZ Phone −40.00.

  The outflows use one category. Totals: Cleared 755.50, Uncleared −260.00, Working 495.50.
- **ZZ-TEST Savings:** Starting Balance 260.00 cleared; its side of the transfer (+100.00) is uncleared.

1. **[AC1]** On ZZ-TEST Checking, hovering Reconcile shows the tooltip "Reconcile" `shift` `E`. A click opens a popover with "Is your current balance", the big "$755.50?", "No" and "Yes" (no help link); Escape closes it; `shift+E` from the page body opens it. All Accounts: no button, `shift+E` opens nothing.
2. **[AC2, Yes]** On ZZ-TEST Savings the header reads "Not Yet Reconciled". Reconcile → Yes: a popover shows the lock-with-check art, "Account reconciled" and "Time for the reconciliation dance!". The Starting Balance row shows the green lock. The header reads "Reconciled a few seconds ago", its `title` matching `/^[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} (AM|PM)$/`. API: `last_reconciled_at` set, the row `reconciled`.
3. **[AC3]** On Checking: Reconcile → No. The popover shows the label "Current balance at your bank", an input and "Next". Type `655.50` and press Enter. A modal shows "−$100.00", "Difference", the three paragraphs of the ticket (with "Budget"), and "Don't Show Again" and "Next". Next: the bar over the table reads "This account's cleared balance in Budget is $100.00 higher than your actual account." with "Cancel" and "Create Adjustment & Finish".
4. **[AC4]** In that mode, clear the −100.00 transfer row. The header shows Cleared $655.50 and Uncleared −$160.00. The bar reads "…is the same as your actual account." and the button is "Finish Reconciliation". Before finishing, unclearing ZZ Fuel brings back "$20.00 higher" and clearing it again "the same" (live both ways). Finish Reconciliation: the bar goes away, 7 rows show the lock (API: 7 `reconciled`), the header reads "Reconciled a few seconds ago".
5. **[AC6, edit]** Click the reconciled ZZ Refund row, change Inflow 30.00 → 35.00, Save. A modal "Save Changes to Reconciled Transaction" shows "Saving your changes to this reconciled transaction may bring your reconciliation out of balance.", "Cancel" and "Save". Cancel keeps the editor open, nothing saved. Save → Cleared $660.50, the row keeps its lock. A memo-only change saves with no modal.
6. **[AC5, adjustment]** Reconcile → No → `655.50` → Next (the modal shows "−$5.00") → Next. The bar says "$5.00 higher" → "Create Adjustment & Finish". A new locked row appears: payee "Reconciliation Balance Adjustment", category "Inflow: Ready to Assign", memo "Entered automatically by Budget", outflow 5.00 (API: amount −5000, `reconciled`). The header shows Cleared $655.50 and Working $495.50. Ready to Assign (API month) is 5000 lower than just before.
7. **[AC7]** Clicking a lock changes nothing (API `cleared` unchanged, no request sent). Its tooltip/title reads "This transaction is reconciled".
8. **"Lower than"**: Reconcile → No → `800.00` (cleared 655.50). The modal shows "$144.50". The bar reads "…$144.50 lower than your actual account." Cancel leaves the mode, and nothing is written (API unchanged).
9. **Don't Show Again** (after case 8, so earlier modals still show): Reconcile → No → `600.00` → Enter; in the modal tick "Don't Show Again" → Next → Cancel. Reconcile → No → `600.00` → Enter goes straight to the bar (no modal). UI state: `hide_reconcile_difference_dialog: true`.
10. **D10**: Reconcile → No → the exact cleared balance → no modal; the bar reads "the same" with "Finish Reconciliation".
11. **[AC8, REST]** POST reconcile with `statement_balance` 100000 below cleared and `create_adjustment: false` → 409 `reconcile_difference`, `difference: -100000`, `cleared_balance`. Nothing written (counts of transactions and change_log, `last_reconciled_at` null).
12. **[REST, worked example to the milliunit]** Worker test on fixture W:
    - The first reconcile at 655500 → 409 (−100000). Clear the transfer, reconcile at 655500 → 200, `reconciled_count` 7, `adjustment` null.
    - PATCH ZZ Refund to 35000 without `confirm_reconciled` → 409 `transaction_reconciled`. With it → 200, cleared 660500.
    - Reconcile at 655500 with `create_adjustment` → adjustment −5000 with the D3 fields, account cleared 655500 and balance 495500, Ready to Assign −5000.
    - change_log: one `update` per reconciled row (cleared → reconciled), the adjustment's `create`, the account's `update` with `last_reconciled_at`, all with the actor.
13. **[PATCH rules]** On a reconciled row, memo, payee, category or flag alone → 200. Amount, date, account, cleared or transfer account → 409 and nothing written, unless `confirm_reconciled: true` (200; stays `reconciled` unless `cleared` was sent). A transfer whose other side is reconciled: the same for its mirrored fields.
14. **[Calls]** Reconciling with 10 and with 1,000 cleared rows: 6 calls each without an adjustment, 7 each with one.
15. **[Race]** As D6: an unclear between the read and the batch → 409 `reconcile_changed`, nothing reconciled, no log, `last_reconciled_at` unchanged. Two adjustment reconciles interleaved → one adjustment, the other answer is 409. A stale `cleared_balance` → 409 `reconcile_changed`.
16. **[Card and tracking]**
    - Card ZZ-TEST Visa, cleared −50000, reconciled at −55000 with an adjustment: adjustment −5000 to Ready to Assign; Ready to Assign −5000; the payment category's Available unchanged.
    - Tracking ZZ-TEST Asset with an adjustment: no category, `inflow_to_ready_to_assign` false; Ready to Assign unchanged.
    - A closed account → 422 `account_closed`; its header's Reconcile is disabled.
17. **[MCP]** `reconcile_account` returns the REST `data`; a difference without `create_adjustment` is a tool error holding the difference in milliunits; the coverage line and timestamps call exist; `get_account` shows `last_reconciled_at`.
18. **[1024×700]** Card "ZZ-TEST Visa Signature Rewards" reconciled (label "Reconciled a few seconds ago"), balances near −$12,345.67 and its Payment pill. The name, info line, pencil and Reconcile sit in the header top row with no overflow (`scrollWidth ≤ clientWidth`, the right edges inside `.acct-head-top`). The Reconcile button is not inside the toolbar or its More menu, and the same holds at 1440×900.
    - In reconcile mode with statement 1,234,567.89 above cleared, the bar's sentence is one line, not cut, inside the bar, with both buttons inside it. The popover (both steps), the Difference modal and the Save confirmation lie inside the viewport with no text overflow.
19. **[EXF-664]** Unit test: `screenMoney(-444000)` is "−$444.00", `screenMoney(-4)` is "$0.00", `screenMoney(1234500)` is "$1,234.50", and the Reflect helpers write U+2212. `reconcile-minus-sign.spec.ts` builds a plan with negative figures and reads the visible text and the `title`/`aria-label` attributes:
the Plan page; the account register (header balances, Selected Total, row amounts, the reconcile bar and modal); Net Worth (debts and change). It fails on a U+002D directly before `$` or a digit in any amount. The register CSV export still has `-` (the existing export test keeps passing), and so does the plan export (`plan-export.test.ts` unchanged).
20. **[Sizes]** EXF-664 changes no size, colour or position: the existing header and Reflect layout specs pass unchanged apart from the sign in their texts.

Tester screenshots (clone only): `.screenshots/reconcile-{popover,enter-balance,difference,bar-higher,bar-same,finished,yes-done,edit-confirm,adjustment}-{1440,1024}.png`.

## Manifest

touches: [apps/worker/migrations/20261116101400_account_reconciled_at.sql, apps/worker/src/db/schema/accounts.ts, apps/worker/src/repositories/reconcile.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/services/reconcile.ts, apps/worker/src/services/accounts.ts, apps/worker/src/services/account-links.ts, apps/worker/src/services/transactions.ts, apps/worker/src/routes/reconcile.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/reconcile.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/test/reconcile*.ts, apps/worker/test/transactions.test.ts, apps/worker/test/transaction-flags.test.ts, apps/worker/test/transfers.test.ts, apps/worker/test/mcp-timestamps.test.ts, apps/worker/test/mcp-coverage/accounts.ts, packages/schema/src/accounts.ts, packages/schema/src/transactions.ts, packages/schema/src/reconcile.ts, packages/schema/src/screen-money.ts, packages/schema/src/reflect-format.ts, packages/schema/src/split.ts, packages/schema/src/ui-state.ts, packages/schema/test/*reconcile*.test.ts, packages/schema/test/reflect-format.test.ts, packages/schema/test/split.test.ts, packages/schema/test/register-selection.test.ts, apps/web/src/account/**, apps/web/src/register/**, apps/web/src/pages/account.tsx, apps/web/src/api/accounts.ts, apps/web/src/api/transactions.ts, apps/web/src/shortcuts/**, apps/web/src/reflect/**, e2e/reconcile*.spec.ts, e2e/support/reconcile-seed.ts, e2e/account-guards.spec.ts, e2e/account-header.spec.ts, e2e/all-accounts.spec.ts, e2e/close-account.spec.ts, e2e/income-expense.spec.ts, e2e/net-worth.spec.ts, e2e/record-payment.spec.ts, e2e/register.spec.ts, e2e/register-bulk.spec.ts, e2e/register-range.spec.ts, e2e/splits.spec.ts, e2e/spending-breakdown.spec.ts, e2e/spending-trends.spec.ts, e2e/transfers.spec.ts, docs/reconcile-design.md, docs/reconcile-spec.md, docs/reconcile-polish.md, docs/README.md]
shared: []
migrations: 1
