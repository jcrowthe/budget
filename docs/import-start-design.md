# Import start design (EXF-774 with EXF-780)

A linked account's import can be made to start earlier: moving its Starting Balance to an earlier date
moves `accounts.import_start_date` in the same batch, and the next sync reads the bank feed again from its
start and brings the rows dated on or after the new date. It works through `PATCH .../transactions/{id}`, the MCP
tool `update_transaction` and the register. The API's shape does not change. The rider EXF-780 settles the split
editor's "Amount remaining to assign" line in a plan with other formats.

Spec: [import-start-spec.md](import-start-spec.md). Polish (Designer): `docs/import-start-polish.md`.

## The source app in this Build

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the
Clerk's step 2 (`https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`).

**What may be looked at and read:** the test plan's Plan page, as it stands in the tab, and **the source's style
rules** (its loaded style sheets, read from that tab without navigating). In a tab of your own on the same address
you may add throw-away elements with the source's classes to measure a look, then close that tab; nothing is
saved by that. Reason: an earlier Designer did exactly this and found real differences; it touches none of the
owner's data. For EXF-780 the one thing worth reading there is how the source styles and words the split editor's
"Amount remaining to assign" line, if its rules show it.

**What nobody ever does in the source, each with its reason:**
- **Open any account page, All Accounts, or a transaction's editor, in any plan; type into any field; create,
  edit, approve, reject or delete anything.** Reason: the import rule this Build makes can only be seen on a
  linked account, and the source's linked accounts are the owner's real ones, with his transactions and balances;
  the test plan has none and none may be made.
- **Open Add Account, the bank search, Bank Connections or the plan menu.** Reason: they show the owner's banks,
  start a real bank connection, or list his other plans.
- **Open Reconcile.** Reason: a Designer pressed a button there and the whole session signed out.
- **Leave the tab changed:** an override is set back and the Clerk's tab stays on the test plan's Plan page.
  Reason: earlier steps left a size override behind and the next step's check failed.

So the behaviour of this Build is **"not compared: built from the ticket"**, which is a complete and acceptable
answer; only looks read from the style rules count as compared.

**Each step states in its report, for itself only, every action it took in the source app (reading style rules
and probe elements included), or that it opened nothing.**

## Source (what the Architect read)

Notes: `/workspace/scratch/source/import-start/notes.md`, with `css-matches.json`, `grid-rules.txt`,
`js-matches.json`, `probe-row.png` and two saved static bundles in the same folder.

- **EXF-774: not compared, built from the ticket** (and this design). Nothing linked may be opened.
- **EXF-780: compared, read from the source's loaded style rules and its loaded static bundle** (the template
  `register/grid-split.hbs` and `calculateSplitRemaining()`):
  - The line is a full row of the editor. "Add another split" sits in the Payee column, and the label
    **`Amount remaining to assign:`** sits in the Memo column, right-aligned with an ellipsis and a tooltip
    (`.ynab-grid-body-split.is-editing .ynab-grid-cell-memo { text-align:right; text-overflow:ellipsis }`).
  - The amounts are plain text in the Outflow and Inflow cells. What is left on the outflow side shows under
    Outflow and what is left on the inflow side under Inflow; the other cell shows a visible formatted zero.
  - The value is computed (parent minus the lines) and written with `currencyService.format(x)`, whose default
    is `{includeSymbol:false}`. So it shows the plan's group and decimal separators and every decimal, with
    **no currency symbol, no sign and no colour state**.
  - It updates when a line is added or removed and when an amount field is left.

Architect's actions in the source: one sub-agent connected over CDP and listed the tabs. In the existing Plan
tab, through `page.evaluate` only, it read the `cssRules` and CSS variables and fetched (read-only GET) the
already-loaded same-origin static `.js` files. It opened one tab of its own on the Plan address, added one probe
`div`, measured it, took one element screenshot and closed that tab. It clicked, typed and navigated nothing,
and changed no viewport or colour scheme.

## What the code does today (read)

- `import_start_date` is written only by `linkAccount`/`createAccountsFromBank` (set),
  `unlinkAccount`/`unlinkForConnectionStmts`/`closeIfStmt` (cleared) and account deletion
  (`apps/worker/src/services/account-links.ts`, `repositories/accounts.ts`). `updateTransaction`
  (`services/transactions.ts` `mutate` → `prepare` → `planWrites`, one batch) never touches the account.
- **The re-read needs no change.** `runSync` computes
  `links = linkSet(open accounts)` = sorted `account_id:import_start_date`, and
  `fresh = !linksCovered(links, row.syncAccounts)` (`services/plaid-sync.ts:215-217`,
  `packages/schema/src/plaid-import.ts:234-248`). A changed `import_start_date` gives a pair the stored set
  lacks, so the run starts from a null cursor (a full re-read) and stores the new set in its final batch.
  `skipReason` skips `date < import_start_date` **or** `date <` the live Starting Balance's date
  (`before_start`). Both move together here, so the bank's rows dated on or after the new date are imported.
  The duplicate rules of the import design make the re-read safe: rows already imported are live → never
  inserted (only `bank_description` and the internal copies follow, or the bank's values for an unapproved
  unmatched row); rejected and deleted rows have tombstones → `known`.
- The sync's D1 calls are those of the import design (≤ 45 per run, `RUN_CALL_BUDGET`). A re-read takes the
  same path as a later link: it reads up to 4 pages / 500 updates per run (`has_more` goes on next run). It
  adds no call kind.

## The rule (EXF-774, notes 1 and 2)

It applies inside `mutate` (single PATCH and `update_transaction`) when **all** of these hold:
`before.payeeSystem === "starting_balance"`; the account after the edit is the same account; the date changes;
and the account is linked (`beforeAccount.bankAccountId !== null`). The new import start is then:

- **moved earlier** → `import_start_date := new date`;
- **moved later** → `import_start_date := max(import_start_date, new date)`. An account linked from the bank
  has `import_start_date` equal to its Starting Balance date, so it follows to the new date. An existing account
  linked later keeps its later start, because that start is already the true one.

When the value is unchanged, nothing is written for the account. Otherwise the batch holds, in addition to
today's statements: one `account` change_log row (`update`, actor as given, `before`/`after` =
`accountToApi` of the row with the old and new `import_start_date`, same balances), placed beside the
transaction's, and one guarded `UPDATE accounts SET import_start_date`. **The batch stays one.**

Atomicity: when the rule applies, the shared `guard` also requires the account to still be live, linked to the
same bank account and holding the read `import_start_date`. The account UPDATE comes before the row's own write,
and `selfGuard` also requires the account to hold the **new** `import_start_date`. So either both change or
neither does, and a lost race is retried by the existing loop.

The cases, as the code will do them:

| case | what happens |
|---|---|
| linked, Starting Balance moved earlier | `import_start_date` = new date, same batch, account history row; the next sync re-reads and imports rows dated ≥ the new date |
| linked, moved later | nothing imported is deleted or changed; `import_start_date` = max(old, new); later syncs skip rows before the Starting Balance's date (existing rule) |
| amount changed (with or without a date change) | the amount is the person's; this Build never recomputes it |
| not linked | nothing changes (no import start) |
| linked, Starting Balance deleted | `import_start_date` stays; `skipReason` then uses only `import_start_date` |
| linked, Starting Balance moved to another account (`account_id`) | neither account's import start changes (same rule as deleted) |
| reconciled Starting Balance | today's rule decides: a date change needs `confirm_reconciled` (the register asks); once confirmed, the rule above applies; nothing is loosened |
| how far back | no limit in the app; the bank decides what it returns |
| bulk endpoint / `bulk_update_transactions` | unchanged: no bulk op changes a date |

**The amount, plainly:** the Starting Balance's amount is not touched. When older rows arrive, the account's
balance is off by their sum until the person sets the Starting Balance to the bank's balance on that date. The
page has **no** place today that shows the bank's current balance next to the working balance: the header's
figures are Cleared / Uncleared / Working (`apps/web/src/account/AccountHeader.tsx`, out of bounds), and the
bank's balance is only in the bank connection reads. Following the brief, nothing new is built for it.

## The register (note 5)

`EntryRow.send`'s `onSuccess`: when `startMoved(tx, body, account)` (new `apps/web/src/register/import-start.ts`)
is true, it calls `startPlanSync(qc, budgetId)` from `apps/web/src/api/bank-link.ts` (imported, not edited) once,
and then `onSaved` as today. `startMoved` is true when: `tx.payee_system === "starting_balance"`, `body.date` is
set and differs from `tx.date`, `body.account_id` is absent or equals `tx.account_id`, and the row's account
(the register's `account`, otherwise looked up in the accounts the page already holds) has `linked === true`. There
is one sync for a move in either direction: the server alone decides what changes. `startPlanSync` invalidates
every query of the plan when the sync answers, so the register and the accounts refresh. There is no new fetch,
and the save keeps its own invalidation. Edits that are not moves, and unlinked accounts, send nothing.

## MCP (note 6)

- `update_transaction`: + "Moving a linked account's Starting Balance to an earlier date moves the account's
  import_start_date with it, which widens the import: the next sync brings the bank's transactions from that
  date."
- `create_accounts_from_bank`: + "today also sets import_start_date: only the bank's transactions dated on or
  after it are imported."

## EXF-780: the "Amount remaining to assign" line

Today (`apps/web/src/register/SplitLines.tsx:41-46,135-141`) the line is
`formatAmountEntry(|remaining|, fmt)` = `fmt.input`, computed from the parsed lines (`splitRemaining`). It shows
the plan's separators and every decimal, with no symbol. It is computed, not an echo of a typed string.

**Decided: the source's form.** It is a computed amount written with the plan's separators and digits,
**without the currency symbol and without a sign** (`fmt.input(|r|)`), in every plan. The other cell shows the
formatted zero. This is the brief's second form ("plan's separators, no symbol"), and it is never a typed echo.
It departs from the Lead's expectation (symbol shown) because the source's own code formats this line with
`includeSymbol:false` (Source above). The default plan's line is unchanged (`1,000.00`).

Steps: (1) reproduce the nine cases (3 plans × 1.00 / 1,000.00 / 1,234.56) and record what was typed and what
the line read; (2) if any reading is not `fmt.input` of the expected remainder (for example `1,000,00`), write a
spec that fails on today's code first, quote its failing line, then fix it; if none, say "not reproduced" with
the nine readings. Expected readings for a line that leaves the whole amount (Outflow cell):

| plan | 1.00 | 1,000.00 | 1,234.56 |
|---|---|---|---|
| default (`123,456.78`, $ before) | `1.00` | `1,000.00` | `1,234.56` |
| Euro (`123.456,78`, € after, DD.MM.YYYY) | `1,00` | `1.000,00` | `1.234,56` |
| yen (0 decimals, `123,456`) | `1` | `1,000` | `1,235` (typed `1234.56` rounds to the plan's unit) |

`e2e/register-approve-euro.spec.ts` keeps `100,00` / `0,00` and gains the three amounts. **Departure (listed):**
that spec's comment and new assertions. They state the decision instead of "as observed".

## Out of scope

The choice on the Add Accounts step ("import from 30 or 60 days ago"): it waits for the owner's word. So do any
recomputation of the Starting Balance's amount, a bank-vs-working balance display, live Plaid flow tests, and
the source's "Something Doesn't Add Up" dialog.

## D1 calls

- **Transaction edit** (`updateTransaction`, a Starting Balance date edit): **7 calls today** (measured on
  `5bee02f` with `countingEnv`; the throw-away test is deleted). After: **7** for an unlinked account, an edit
  that does not move the date, or a move that leaves `import_start_date` as it is; **10** for a linked move. The
  3 added calls are the set reads of `accountFacts` for the account's history row, and the batch stays one. The
  count is the same for an account with 10 and with 100 rows (counting test).
- **Sync:** unchanged (import design). A re-read is the same code path as a later link.

## Acceptance

Worker cases use the import tests' feed stub (`apps/worker/test/plaid-sync-helpers.ts`, `plaid-stub.ts`). T is the
link date.

1. **Full re-read (note 3).** An account is created from the bank at T, with Starting Balance 1,250.50 at T.
   The feed holds four rows dated T (−10.00 each: r0..r3) and seven older rows, at T−5 (−1.00), T−15 (−2.00),
   T−29 (−3.00), T−30 (−4.00), T−31 (−5.00), T−45 (−6.00) and T−59 (−7.00).
   Sync 1: added 4, skipped 7; balance 1,210.50.
   Then r0 is rejected, r1 deleted, r2 approved and r3 categorized by hand; balance 1,230.50.
   PATCH the Starting Balance date to T−30 → the response is 200 and the account read shows
   `import_start_date` = T−30.
   Sync 2: added 4 (T−5, T−15, T−29, T−30); none of T−31, T−45, T−59, r0, r1 is inserted; balance 1,220.50.
   r2 is still approved with its fields, and r3 keeps its category.
   Sync 3: added 0; balance 1,220.50.
2. **Same batch, history.** After case 1's PATCH, `change_log` holds one `transaction` update and one `account`
   update with the request's actor (REST: `user:…`; MCP: `mcp:…`). The account row shows `import_start_date`
   before = T and after = T−30. A batch failed on purpose (`failingBatchEnv`) leaves both rows as they were.
3. **Later move.** Moving the Starting Balance from T to T+2 keeps every imported row. `import_start_date`
   becomes T+2. A later sync skips a feed row dated T+1.
4. **Not linked / no move.** A date edit of an unlinked account's Starting Balance, and a memo edit of a linked
   one, write no `account` change_log row, and `import_start_date` is unchanged.
5. **Linked later.** An account linked later (`import_start_date` = reconciled − 3 days, after its Starting
   Balance) whose Starting Balance moves later but stays before that start keeps `import_start_date`.
6. **Deleted Starting Balance.** After deleting it, `import_start_date` is unchanged.
7. **Reconciled.** A reconciled linked Starting Balance's date PATCH without `confirm_reconciled` → 409
   `transaction_reconciled`, nothing changes. With it → 200 and `import_start_date` moves.
8. **MCP.** `update_transaction` with `date` on a linked Starting Balance moves `import_start_date`, and the
   account's history actor is `mcp:…`. Both descriptions hold their sentence.
9. **D1 calls.** A counting test: 7 for an unlinked date edit and 10 for a linked move, for accounts holding
   10 and 100 rows. The figures are equal across sizes.
10. **Register, one sync (browser, `e2e/import-start.spec.ts`, `stubBankLink` with the account linked).** Open the
    linked account's register and let the open-time sync settle (count C). Open the Starting Balance row,
    change the date to 10 days earlier and press Save. `expect.poll` shows the plan sync requests reach C+1
    after the PATCH answers, and the register shows the row with the new date. Then edit the Starting Balance's
    memo and save: the count stays C+1. On an unlinked account in the same plan, a Starting Balance date move
    sends none. Run at 1440×900 and 1024×700 with `realClick`.
11. **EXF-780 spec (`e2e/import-start-split.spec.ts`).** In a default, a Euro `123.456,78`-after and a yen plan,
    the line reads the table's values for 1.00, 1,000.00 and 1,234.56, at both sizes. No cell matches a mixed
    form (`/\d,\d{3},\d{2}$/` in the Euro plan, `/[.,]\d+$/` in yen).
    `e2e/register-approve-euro.spec.ts` passes with its added assertions.
12. **1024×700.** The register row, the "Amount remaining to assign:" label and its cells are not cut without an
    ellipsis and a `title`.
13. **Looking (below).** Each state has its two entries.

### Looking

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh**
screenshot in this Thread (not a file a spec or an earlier step wrote), opens it, and writes one sentence on what
is seen in it. The report lists `state, size, file, sentence` for every one. A state without its two entries is
PARTIAL with the words "not looked at". "A spec is green" is not looking.

The states:
1. A linked account's register with its Starting Balance row open for editing, the date changed to an earlier one.
2. The same register after the save and the sync that follows (with the stand-in's answer): what the page shows.
3. The split editor in a default plan, a Euro `123.456,78` After-amount plan and a yen plan, each with something
   left to assign: the "Amount remaining to assign" line (EXF-780), for row amounts of 1.00, 1,000.00 and
   1,234.56 units.

## The order of the work

1. The rule in the Worker with its tests (notes 1 to 4) and the tools' descriptions.
2. The register: the one sync after such a save, with its spec.
3. EXF-780: reproduce, decide, fix, spec.

The Implementer commits after each part.

## Downstream effects

The account read's `import_start_date` changes after such an edit, and Activity / history show one account row
beside the transaction's. The next sync of that connection is a full re-read: Plaid pages, still bounded per
run. The out-of-bounds files of the brief's note 10 (shell, account, menu-actions, manage-connections, the stub,
the shared modules, `paths.always_overlap`, plan, reflect, plaid client) are not changed. No migration. No
dependency.

## Manifest

touches: [apps/worker/src/services/transactions.ts, apps/worker/src/services/account-links.ts, apps/worker/src/repositories/accounts.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/test/import-start*.test.ts, apps/web/src/register/**, apps/web/src/api/transactions.ts, e2e/import-start*.spec.ts, e2e/register-approve-euro.spec.ts, docs/import-start-design.md, docs/import-start-spec.md, docs/import-start-polish.md, docs/README.md]
shared: []
migrations: 0
