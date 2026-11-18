# Manual match and unmatch: design (EXF-464, rider EXF-816)

The owner joins a bank import and his own entry of the same purchase into one transaction (two rows selected,
`Match`). A matched row shows a link icon, and its panel shows what the bank said. `Unmatch` gives the two back.
This works through REST, MCP and the register. The automatic rule and the sync (`services/plaid-sync.ts`) are **not
changed**. Rider EXF-816: the open row's Category field gets a `title` with its whole text.
Spec: [manual-match-spec.md](manual-match-spec.md).
Polish: `docs/manual-match-polish.md` (the Designer's).

## Source

### The source app in this Build (copied from the brief, with its reasons)

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the
Clerk's step 2.

**What may be read, and nothing else:**
- In the Clerk's tab as it stands (the test plan's Plan page): **the source's loaded style rules and its
  already-loaded static script files**. These are same-origin files the page has loaded, read without navigating;
  they hold no data of the owner's.
- In a tab of your own on the same address you may add throw-away elements with the source's classes to measure a
  look (the link icon, a bar button, the details popup), and then close that tab.

Reason: earlier steps did exactly this and found real differences (one read in the source's own code how a line is
written), and it touches none of the owner's data.

**What nobody ever does in the source, each with its reason:**
- **Open any account page, All Accounts or a transaction's editor, in any plan; select, match, unmatch, approve,
  reject, create, edit or delete anything; type into any field.** Reason: a matched transaction exists only where a
  bank import met a hand entry. That is in the owner's real accounts, with his real transactions; the test plan has
  no import and none may be made. EXF-464 itself was written from the public help pages for that reason.
- **Open Add Account, the bank search, Bank Connections, the plan menu or the address `/users/budgets`.** Reason:
  they show the owner's banks, start a real bank connection, or list his other plans by name.
- **Read or print any text of the sidebar's header or the account menu (the plan's name and the signed-in address
  are there), or print the sidebar's or the page's whole text.** Reason: a Designer's sidebar read once put the
  account's email into a transcript.
- **Open Reconcile.** Reason: a Designer pressed a button there and the whole session signed out.
- **Leave the tab changed.** An override is set back, and the Clerk's tab stays on the test plan's Plan page.
- **Keep a screenshot of the source that shows more than your own probe elements.**

So the behaviour of this Build is **"not compared: built from the ticket"**, which is a complete and acceptable
answer. Only looks and wordings read from the style rules and the static script files count as compared (each is
marked below).

**Each step states in its report, for itself only, every action it took in the source app (style rules read,
script files read and probe elements included), or that it opened nothing. Nobody but the Clerk runs the Clerk's
commands; a step that runs them has opened the source and says so.**

### What the study found

The notes, the files read and the actions are in `/workspace/scratch/source/manual-match/notes.md`. Each item below
is **compared: read from the source's style rules or script files**; the spec gives the sizes.
- **Icon.** It sits in the source's notification column, which is Budget's 26px attention column. It is a 16×16
  button holding a 14×14 link icon, with aria-label "This transaction has a matched transaction".
- **Panel.** "Matched Transactions" over a `DATE | PAYEE | MEMO | AMOUNT` table: the row's own first, then the
  bank's, with "None" for an empty payee. It has a secondary `Unmatch` with title "Unmatching will create two
  separate transactions for your manual entry and the imported entry."
- **Bar.** "Match" (link icon) and "Unmatch" (broken-link icon). The source **hides** them when they cannot act.
- **Words.**
  - "Match requires one manually entered transaction and one imported transaction to be selected."
  - The split sentence of 8a.
- **The open row's Category input.** It has an ellipsis and **no `title`**.

Rules, writes, API and MCP: **not compared: built from the ticket**.

## Approach

### The hand entry's earlier amount: a new column, so one migration

At an unmatch, a manual match's earlier amount is not in any present column: the row and `import_amount` both hold
the bank's.
- **New nullable column `transactions.match_entry_amount`** (milliunits). A manual match writes the entry's amount
  from before the match into it.
- Migration **`apps/worker/migrations/20261116101600_manual_match.sql`**, the name the Lead reserved:
  `ALTER TABLE transactions ADD COLUMN match_entry_amount integer;` (additive; no row rewritten).
- **Departure:** `request.json` should have held `"reserved_migrations": ["20261116101600_manual_match.sql"]`. The
  Lead accepts this.
- The automatic match leaves it null (the sync is untouched); unmatch then uses the present amount, which equalled
  the entry's at the match.
- The column is internal: not in the API and not in the change_log copy.
- Only match and unmatch write it. `insertIfStmt` does not name it, so a duplicate or an import gets null.

### Match: `POST /budgets/{budget_id}/transactions/match` `{ ids: [a, b] }`

The service is the new file `apps/worker/src/services/manual-match.ts`. The roles of a row:
- **matched**: `import_id != null && source == null`;
- **import**: `source == 'plaid'`;
- **entry**: any other row.

The checks run in this order; the first that fails answers, and nothing is written. A row is named
`<payee_name> on <date> (<amount>)` in the plan's format (`The transaction on …` without a payee), never by its id.

| # | Pair | Answer |
|---|---|---|
| 0 | not two distinct ids | 422 `unprocessable_entity` "Select exactly two different transactions to match" |
| 0 | unknown, deleted, split line, scheduled (another table) | 404 `not_found` |
| 1 | two accounts | 422 `not_matchable` "`A` and `B` are in different accounts: only two transactions of one account can be matched." |
| 2 | account closed | 422 `account_closed` "This account is closed: its transactions cannot be matched" |
| 3 | either already matched (a first) | 422 `not_matchable` "`X` is already matched: unmatch it first." |
| 4 | two imports, or two entries | 422 `not_matchable` "Match requires one manually entered transaction and one imported transaction to be selected." |
| 5 | the import is approved | 422 `not_matchable` "`I` is approved: an approved import is its own transaction, so it cannot be matched." (approving was his word that it is its own purchase) |
| 6 | the import is a split / a transfer | 422 `not_matchable` "`I` is split: only an import as the bank sent it can be matched." / "`I` is a transfer: only an import as the bank sent it can be matched." |
| 7 | the import is reconciled | 409 `transaction_reconciled` "`I` is reconciled: it cannot be matched." (a reconciled row is not deleted today) |
| 8a | amounts differ, entry is a split | 422 `not_matchable` the source's split sentence, with {t} = entry's and {e} = import's amount (we invent no line) |
| 8b | amounts differ, entry is a transfer | 422 `not_matchable` "Before matching these transactions, you will first need to change the amount of your transfer from {t} to match the bank's transaction amount of {e}." (the other side would no longer be the opposite) |
| 8c | amounts differ, entry reconciled | 409 `transaction_reconciled` "`E` is reconciled: its amount cannot change to the bank's {e}." (the rule is not loosened; no `confirm_reconciled` here) |
| – | anything else, at any date distance and amount difference | 200 matched |

With equal amounts, a split, a transfer or a reconciled entry matches, as in the automatic rule:
- a split's lines take `cleared` and `approved`;
- a transfer's other side is not written;
- a reconciled entry stays reconciled.

A Starting Balance entry is like any entry.

**Writes** (one `db.batch`, actor as given; every statement guarded by `holdsAt` of both rows):
1. The change_log rows: `update` of the entry, and `delete` of the import (before → null).
2. If the entry is a split: its lines become `cleared` and `approved`.
3. Soft delete of the import row. There is **no tombstone**: the bank's id stays known through the matched row, and
   unmatch makes it live again.
4. **Last**, the entry's update, also guarded by `writtenAt(import, now)`, because the unique index allows one live
   row per `import_id`. The entry keeps its payee, memo, date, category, RTA flag and flag colour, and it takes:
   - `amount` = the import's;
   - `import_id`, `imported_payee`, `bank_description` and `import_date/amount/payee_name` from the import;
   - `match_entry_amount` = its own amount before;
   - `cleared` (`reconciled` stays);
   - `approved` = true.

   `source` stays null, so `matched` is true.

A lost race re-reads and re-checks (5 attempts, then 409 `Conflict`). The answer is 200
`{ data: { transaction, removed } }`.

### Unmatch: `POST /budgets/{budget_id}/transactions/{transaction_id}/unmatch`

| Row | Answer |
|---|---|
| unknown, deleted, split line | 404 `not_found` |
| not matched | 422 `not_matched` "`X` is not matched: only a matched transaction can be unmatched." |
| account closed | 422 `account_closed` "This account is closed: its transactions cannot be unmatched" |
| reconciled | 409 `transaction_reconciled` "`X` is reconciled: unmatching would change a reconciled transaction." |
| no bank copy (`import_date` or `import_amount` null; none known) | 422 `not_matched` "`X` has no record of the bank's transaction." |
| a matched split or transfer | allowed (amount below) |

**Writes** (one batch):
1. The payee insert with its log, if the name is new (as `createTransaction` does).
2. The change_log rows: `update` of the entry, `create` of the import.
3. If the entry is a split: its lines become `uncleared`.
4. **The entry** (same id):
   - `amount`:
     - a split or a transfer keeps its present amount (equal at the match; its lines or other side must still
       agree);
     - any other row takes `match_entry_amount ?? amount`, so 12.34 comes back;
   - the import fields and `match_entry_amount` become null;
   - `cleared` = `uncleared`: the bank's confirmation leaves with the import, which is the cleared row;
   - approval, payee, memo, date, category and flag are kept.
5. **Then the import**, inserted as a new row, guarded by `writtenAt(entry, now)`:
   - id: a new UUID;
   - `date`, `amount` and payee from `import_date`, `import_amount` and `import_payee_name` (`resolvePayee`: an exact
     name, or created);
   - `cleared`, unapproved, `source plaid`;
   - the same `import_id` and bank fields;
   - no category, RTA flag, memo or flag: it waits for his word, shown by the attention column and the banner.

The answer is 200 `{ data: { transaction, imported } }`.

**Next sync:** the bank's id is on a live row (the new import), so it is "already imported": it is never inserted
or matched again (matching happens only at insert). As an unapproved, unmatched import it follows the bank.
`plaid-sync.ts` is not changed.

### `match_details` on the reads

`TransactionDetail` gains `match_details: { date, amount, payee_name } | null`, `.nullable().default(null)` so older
stand-ins still parse. That covers the single read, both lists, the bulk, approve, match and unmatch answers, and
MCP.
- `transactionDetailToApi` fills it from the row's own `import_date`, `import_amount` and `import_payee_name` when
  the row is matched and the first two are set; otherwise it is null.
- `logShape` does not change.
- **No added D1 call**: the columns are already in the row.

### MCP

`match_transactions { budget_id, ids }` and `unmatch_transaction { budget_id, transaction_id }`, in
`mcp/tools/transactions.ts`, call the same services and return the same `data`.
- The descriptions say what is kept (the entry's payee, memo, date, category and flag) and what is taken (the bank's
  amount, the import's id and bank fields; cleared and approved; the import row deleted).
- They also say that **only the owner's word matches rows whose amounts or dates differ; the sync matches only equal
  amounts within 10 days**.
- Unmatch says what comes back.
- `MONEY`, `dates("date")` and the timestamps.
- One coverage line and one `CALLS` entry each.

### The register

- **Rule** `packages/schema/src/manual-match.ts`:
  - `matchRefusal(a, b, ctx)` and `unmatchRefusal(row, ctx)` return `{ name, detail } | null`, in the tables' order
    and with their words;
  - `matchLabel` and `MATCH_TEXT`.

  The Worker imports the words and the label, **not the decisions**. A Worker test runs every case of both tables
  through REST and through these functions and expects equal `name` and `detail`.
- **Icon.** It sits in the attention cell, which is 26px fixed, so no column moves at 1024 px. The column shows when
  a row is unapproved **or matched**.
  - An approved matched row shows `MatchCell`: the source's button with tooltip `Matched` and Budget's own
    `LinkIcon` (`icons.tsx:173`).
  - An unapproved matched row keeps the approval mark.
- **Details.** A `Popover` (below, `align="start"`, `role="dialog"`) laid out as the source's panel:
  - row 1 is the row's own values; row 2 is `match_details`, with no memo;
  - values go through `usePlanFormatter()`;
  - width `min(512, innerWidth − 16)`; cells max 192px with an ellipsis and a `title`;
  - Enter or Space opens it; Escape closes it and focus returns to the icon;
  - `Unmatch` sends one request, then closes the panel; a refusal shows in it (`role="alert"`).
- **Bar.** `matchActions(rows, accountOf, fmt)` in `manual-match.ts`, beside `barActions` (which is unchanged),
  returns `{ match, unmatch }`, each `{ enabled, reason } | null`.
  - Exactly two rows → `Match`, enabled when `matchRefusal` is null; otherwise `aria-disabled="true"`, its tooltip
    the reason, and no request.
  - Exactly one matched row → `Unmatch`, disabled the same way when refused.
  - **Departure:** the source hides them; the brief prefers the reason.
  - Placed after Clear, before the separator and More (the source's template order). No shortcut.
  - Success clears the selection; a refusal shows in the bar's alert line.
- **Requests.** One POST each, then `invalidatePlan` as the bulk action does (register, balance, sidebar dot,
  banner). Nothing else is fetched.
- **All Accounts.** The same bar. Two accounts → disabled, refusal 1.

### EXF-816

`CategoryField` sets `title = fixedText ?? title ?? ((typed ?? shown) || undefined)`, the whole text of the input.
- It covers the split text, a long "<Group>: <Category>", "Inflow: Ready to Assign" and each split line
  (`SplitLines` uses the same component).
- An explicit `title` (the credit Starting Balance's lock, on an empty field) still wins.
- **Departure** from the source (no title there): the 1024 px rule decides.

### D1 calls (first attempt; constant in the account's rows)

- **Match: 7.** Plan, both rows (`findDetailMany`), the account, the entry's lines, the batch, then the answer's
  `findDetail` and lines.
- **Unmatch: 8.** Plan, the row, the account, its lines, the payee by name (0 when there is no name), the batch,
  then the answer's `findDetailMany` and lines.
- A lost race repeats the reads and the batch (at most 5 attempts).
- `apps/worker/test/manual-match-calls.test.ts` counts both in accounts of 10 and of 100 rows (equal, and at most
  7 and 8). It also checks that `GET` of one transaction, of the account's list and of the plan's list make the same
  number of calls before and after a match.
- The existing call tests pass unchanged.

## Downstream effects

- Every transaction answer gains `match_details`.
- `packages/schema/test/register.test.ts` and `register-export.test.ts` fixtures gain `match_details: null`
  (typecheck only; **no expectation changes**).
- The attention column also shows for a register whose only marked rows are matched.
- Balances, sums and the sync are unchanged.

## Out of scope

- "Is: Matched" (EXF-528, note 6).
- Pending imports (EXF-466).
- `pickMatch` or the sync.
- Matching more than two rows, or unmatching several at once.
- Shortcuts.
- The source's older "Matched Transaction" layout.

## Files outside the ground (with reason)

- The reserved migration, with `db/schema/transactions.ts` (note 2).
- `apps/worker/test/mcp-timestamps.test.ts` and `mcp-coverage/transactions.ts`: the conventions require them for a
  tool.
- The two fixtures above.
- The new browser stand-in `e2e/support/manual-match-stub.ts`.

No shared module, no file of note 11 and no dependency changes. `account/Tooltip.tsx` is imported, not edited.

## Acceptance

Worker tests use `plaid-sync-helpers.ts`, the Plaid feed stand-in and `SENTINEL` credentials, with no Plaid call.
Browser specs use `realClick`, `{ exact: true }` and `expect.poll` after a request. Their import stand-in,
`e2e/support/manual-match-stub.ts`, answers in the server's shape: fields as `transactionToApi` /
`transactionDetailToApi` map them (`apps/worker/src/services/transactions.ts:41-62, 212-227`), and every shown field
is real.

1. **(464-3, note 9) Match by hand.**
   - Setup: a hand outflow of 12.34 (−12340), payee "ZZ Cafe", memo "ZZ memo", "ZZ Food", flag red, dated 20 days
     before a synced import of −13000 from merchant "ZZ Bank Cafe". The balance is B0 − 12340 with the entry alone
     and B0 − 25340 after the sync.
   - Match → one row: −13000, ZZ Cafe, memo, the entry's date, ZZ Food, red, `cleared`, approved, `matched true`,
     the bank's `import_id`, `match_details` = the import's date, −13000 and "ZZ Bank Cafe".
   - The import's row is gone. The balance is B0 − 13000: the entry alone moved by exactly −660.
   - change_log: `update` and `delete`, actor `user:` (REST) or `mcp:` (MCP).
2. **(464-4) Unmatch.**
   - The entry: −12340, `uncleared`, approved, ZZ Food, red, no `import_id`, `match_details null`.
   - The import: −13000, the bank's date, "ZZ Bank Cafe", unapproved, `cleared`, `source plaid`, the same
     `import_id`, no category.
   - The balance is B0 − 25340; change_log has `update` and `create`.
   - Unmatch of an **automatic** match gives the entry its own amount.
3. **(note 2) Next sync.** After 2, the same entry comes as `added` with a null cursor, then as `modified`: `added
   0`, `matched 0`, the same live rows, no second import.
4. **Refusals.** Every case of both tables gets its status, `name` and `detail`. Every table is unchanged,
   change_log included. `matchRefusal` and `unmatchRefusal` agree.
5. **Any distance.** 40 days apart with −1000 against −99000 → matched.
6. **Split and transfer.**
   - A split of −13000 against −13000 → matched, lines `cleared`; against −12000 → 8a.
   - A transfer: equal → matched, other side unchanged; different → 8b.
   - Unmatch of each keeps the present amount, the lines and the other side.
7. **(464-7) MCP.** The two tools do 1 and 2 with `mcp:` actors. `apiPaths()` and `listedToolNames()` include them,
   and the coverage and timestamps tests pass.
8. **(note 8) D1.** Match 7 and unmatch 8, equal for 10 and 100 rows; the reads are unchanged by a match.
9. **(464-1, -2, -6) Automatic rule.** EXF-462's, unchanged: `plaid-sync.test.ts` 462-13 and 462-7 pass untouched.
10. **(464-5) "Is: Matched".** Not this Build's: note 6.
11. **Icon and details** (`e2e/manual-match.spec.ts`).
    - The link icon is in the attention cell, with tooltip `Matched`.
    - Tab to it and press Enter: "Matched Transactions", with the entry's row and the bank's (date, payee and amount
      in the plan's format).
    - Escape closes it, and focus is back on the icon.
12. **Bar.**
    - An unapproved import and an entry → `Match`. Click → exactly one POST `…/match` with both ids, then one row
      with the icon. The list GETs that follow are no more than after a bulk Flag.
    - Two entries → `aria-disabled`, tooltip = refusal 4, and no request.
    - A matched row → `Unmatch`, one POST, then two rows.
    - All Accounts, two accounts → refusal 1.
13. **(EXF-816)** `e2e/manual-match-category-title.spec.ts` at 1024×700, on the real server. Fields: the split text,
    a long "ZZ Group…: ZZ Category…", "Inflow: Ready to Assign", and a split line's long category.
    - Each `title` equals the value.
    - When `scrollWidth > clientWidth`, `text-overflow` is `ellipsis`; the split and the long name are cut.
    - It fails first (quote the line). `register-attention-narrow.spec.ts` and `splits.spec.ts` still pass.
14. **(note 10) 1024×700** (`e2e/manual-match-narrow.spec.ts`).
    - The icon is inside its cell, and the panel inside the window.
    - Each cut cell has an ellipsis and a `title`.
    - The bar with `Match` and with `Unmatch` fits as today.
15. **Looking** (below): every state has its two entries.

### Looking (the Tester's main work)

For each state below, at 1440×900 and at 1024×700:
- the Tester drives the clone to that state;
- takes a **fresh** screenshot in this Thread;
- **opens it**;
- writes one sentence on what is seen in it (not what a measurement says).

The report lists `state, size, file, sentence`. A state without its two entries is PARTIAL with the words "not
looked at". **Six states, twelve screenshots, every one opened; take no others unless something looks wrong.**

1. A register with an unapproved import and a hand entry of the same purchase selected: the bar with `Match`.
2. The same register after `Match`: one row, with the link icon.
3. The matched row's details open: what the bank said (date, payee, amount) beside the entry.
4. A matched row selected: the bar with `Unmatch`; and the register after it: two rows again.
5. Two rows selected that cannot be matched (say which pair): the bar without `Match`, or with it disabled and its
   reason.
6. An open row whose Category field is cut at 1024 px, with its tooltip (EXF-816; at 1440×900 show the same row
   uncut).

For states 1–5 the Tester installs `e2e/support/manual-match-stub.ts` on a Playwright page of the dev server. No
real import can be made: no Plaid, and no D1 writes from outside. State 5's pair is two hand entries.

## The order of the work (Implementer: commit after each part)

1. EXF-816: the failing spec, the fix.
2. Match in the Worker with its refusals, tests and D1 calls; `match_details` on the reads.
3. Unmatch in the Worker, with the sync test of note 2.
4. The two tools.
5. The register: the icon and the details, then the bar's `Match` and `Unmatch`.
6. The narrow window.

## Manifest

touches: [apps/worker/migrations/20261116101600_manual_match.sql, apps/worker/src/db/schema/transactions.ts, apps/worker/src/services/manual-match.ts, apps/worker/src/services/transactions.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/routes/transactions.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/test/manual-match*.ts, apps/worker/test/mcp-coverage/transactions.ts, apps/worker/test/mcp-timestamps.test.ts, packages/schema/src/transactions.ts, packages/schema/src/manual-match.ts, packages/schema/test/manual-match*.test.ts, packages/schema/test/register.test.ts, packages/schema/test/register-export.test.ts, apps/web/src/register/**, apps/web/src/api/transactions.ts, e2e/manual-match*.spec.ts, e2e/support/manual-match-stub.ts, docs/manual-match-design.md, docs/manual-match-spec.md, docs/manual-match-polish.md, docs/README.md]
shared: []
migrations: 1
