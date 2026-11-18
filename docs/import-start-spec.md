# Import start spec (EXF-774 with EXF-780)

Design: [import-start-design.md](import-start-design.md). Do the work in the design's order and **commit after
each part**. Read `docs/conventions.md` first. Out of bounds: the brief's note 10 list. That covers every shared
module, every `paths.always_overlap` file, `apps/web/src/{shell,account,menu-actions,plan,reflect}/**`,
`apps/worker/src/plaid/**`, `e2e/support/bank-link-stub.ts` and `e2e/support/real-click.ts` (import both, edit
neither), and `apps/web/src/api/bank-link.ts` (import only). Use no new dependency and no migration.

## Part 1: the rule in the Worker

### 1.1 `apps/worker/src/services/account-links.ts`

```ts
/** The import start after a linked account's Starting Balance moves from `from` to `to` (YYYY-MM-DD). */
export function importStartAfterMove(current: string | null, from: string, to: string): string
// to < from → to;  to > from → max(current ?? to, to);  to === from → current ?? to
```

```ts
/** Statements that move a linked account's import start inside another service's batch (none when unchanged). */
export async function importStartStmts(
  db: Db, actor: string, budgetId: string,
  account: accountsRepo.AccountRow, next: string, guard: SQLWrapper,
): Promise<{ stmts: BatchItem[]; holds: SQLWrapper; written: SQLWrapper } | null>
```

- It returns `null` when `account.bankAccountId === null` or `next === account.importStartDate`.
- `holds` = `accountsRepo.importStartHolds(db, account)`. `written` =
  `accountsRepo.importStartIs(db, account, next)`.
- `stmts` = [`changeLogInsertIf(db, {budgetId, actor, action:"update", entityType:"account", entityId,
  before: accountToApi(account, b), after: accountToApi({...account, importStartDate: next}, b)}, guard)`,
  `accountsRepo.setImportStartIfStmt(db, account, next, guard)`]. `b` comes from
  `(await accountFacts(db, budgetId, account.id))(account)` (3 reads).

### 1.2 `apps/worker/src/repositories/accounts.ts`

```ts
/** SELECT 1 while the account is live, linked to before.bankAccountId and has before.importStartDate (IS). */
export function importStartHolds(db: Db, before: AccountRow): SQLWrapper
/** SELECT 1 while the account is live, linked to before.bankAccountId and has import_start_date = value. */
export function importStartIs(db: Db, before: AccountRow, value: string): SQLWrapper
/** UPDATE accounts SET import_start_date = next WHERE <importStartHolds condition> AND exists guard. */
export function setImportStartIfStmt(db: Db, before: AccountRow, next: string, guard: SQLWrapper)
```

Write it with Drizzle `.update(accounts).set({ importStartDate: next })`, which names its column. Treat a null
`importStartDate` with `isNull`.

### 1.3 `apps/worker/src/services/transactions.ts` (`mutate` only)

After `prepare` and before the guards are built:

```ts
const moved = kind === "update" && before.payeeSystem === "starting_balance"
  && plan.after.accountId === before.accountId && plan.after.date !== before.date
  && beforeAccount.bankAccountId !== null;
const next = moved ? importStartAfterMove(beforeAccount.importStartDate, before.date, plan.after.date) : null;
```

When `next` is set, call `importStartStmts(db, actor, budgetId, beforeAccount, next, <guard>)` (call it once per
attempt, after `guard` exists). Then:

- `guard` becomes `txRepo.allHold([...guards, imp.holds])` (so the payee, log and rest statements need the
  account as read too);
- the account's two statements go **after `w0.rest` and before `w0.self`**, with the account log next to the
  transaction logs;
- `selfGuard` becomes `txRepo.allHold([holdsAt(before), (writtenAt(lastOther) if any), imp.written])`.

Build `guard` first, then `planWrites`. Keep `planWrites` unchanged, or add an optional `extra: {logs, rest,
selfHolds}` argument; bulk passes nothing. **Keep one `db.batch`.** Bulk (`transactions-bulk.ts`) is
unchanged.

### 1.4 MCP descriptions

- `apps/worker/src/mcp/tools/transactions.ts` `update_transaction`: append the sentence of the design's "MCP".
- `apps/worker/src/mcp/tools/accounts.ts` `create_accounts_from_bank`: append its sentence.

The descriptions keep "Returns".

### 1.5 Tests (new files; never edit `openapi.test.ts`, `mcp.test.ts`)

- `apps/worker/test/import-start.test.ts`: acceptance cases 1–8, through REST (`json(...)` PATCH) except case 8
  (MCP via `mcpRpc` from `test/surface.ts`). Use `plaid-sync-helpers.ts`: `setupPlaid`, `stubBank`, `feed`,
  `syncOne`, `rows`, `count`, `failingBatchEnv`. Create the account with `createAccountsFromBank` / the
  `from-bank` route with `today: T` (the helpers' fixed past date, so T+2 is not in the future). Build the feed
  rows (Plaid amounts: positive = outflow) with the dates and amounts of case 1. In the test, assert the counts
  (`added`, `skipped`), the balance in milliunits (1250500 → 1210500 → 1230500 → 1220500 → 1220500) and the rows'
  states. Reject and approve go through `/transactions/reject` and `/transactions/approve`, delete through DELETE,
  and categorize through PATCH `category_id`.
  Sync 2's `skipped` is 5 (3 `before_start` + 2 tombstoned `known`). State it if the code says otherwise.
- `apps/worker/test/import-start-calls.test.ts`: `countingEnv` around `updateTransaction`. Unlinked date edit
  = 7, linked move = 10, each for an account with 10 and with 100 extra rows. **Run it on the unchanged code first**
  (the linked case then counts 7 and the test fails). Quote the failing line in the report.
- Run each fault test once against the code before the fix and quote the failing line (brief rule).

Verify: `pnpm check`. Commit: `EXF-774: linked Starting Balance date moves import_start_date (Worker, MCP)`.

## Part 2: the register's one sync

### 2.1 `apps/web/src/register/import-start.ts` (new)

```ts
import type { Account } from "@budget/schema/accounts";
import type { TransactionDetail, TransactionUpdateRequest } from "@budget/schema/transactions";
/** True when this saved patch moved a linked account's Starting Balance date (one plan sync follows). */
export function startMoved(
  tx: Pick<TransactionDetail, "payee_system" | "date" | "account_id">,
  body: Pick<TransactionUpdateRequest, "date" | "account_id">,
  account: Pick<Account, "linked"> | undefined,
): boolean
```

### 2.2 `apps/web/src/register/EntryRow.tsx`

- `const qc = useQueryClient();`
- In `send`'s `onSuccess`: if `mode === "edit" && tx && startMoved(tx, p.body, chosen)`, then
  `startPlanSync(qc, budgetId)`; then `onSaved(...)` as today.
- `chosen` is the register's `account`, or the account found in `accountsQ.data ?? accounts`. That list is
  already loaded, so there is no new query.
- Do not touch `useSaveTransaction`'s invalidation. `apps/web/src/api/transactions.ts` needs no change unless
  a helper fits there.

### 2.3 Spec `e2e/import-start.spec.ts` (acceptance case 10)

- The plan comes from `createPlan`/API helpers in `e2e/support`. It has one checking account (balance via API)
  and a second unlinked one. Call `stubBankLink(page, request, { budgetId, connections: [fakeConnection({accounts:
  [bank]})], links: { [accountId]: bank.id }, orphanSyncedAt? })` so the account reads `linked: true` (the
  server's account stays unlinked: the server side is case 1's Worker test).
- Count = `requests.filter(r => r.method === "POST" && /\/budgets\/[^/]+\/sync$/.test(new URL(r.url).pathname))`
  (check `RecordedRequest`'s field names). After the page settles, take C. If the open-time sync is due, wait
  for it with `expect.poll`.
- Open the Starting Balance row, change the date (in the plan's date format) to 10 days earlier, and press Save
  with `realClick`. `expect.poll` shows the PATCH answered (`page.waitForResponse` / poll the row's date cell),
  then the count reaches C+1. A memo-only save keeps C+1. On the unlinked account, a date move adds none.
- Use `{ exact: true }` names, run at 1440×900 and 1024×700, and use `realClick` for every click.

Verify: `pnpm e2e e2e/import-start.spec.ts`, then run it on the code without 2.2 (it must fail on the C+1 poll)
and quote the line. Commit: `EXF-774: register sends one plan sync after a linked Starting Balance date move`.

## Part 3: EXF-780

1. **Reproduce.** On `pnpm dev`, make three plans through the API: a default one; a Euro one
   (`currency_format` example `123.456,78`, `€` after, `DD.MM.YYYY`; copy the setup of
   `e2e/register-approve-euro.spec.ts`); and a yen one (`¥`, 0 decimals). In each, add a row with outflow 1.00,
   1,000.00 and 1,234.56 typed in the plan's own form (`1,00`, `1.000,00`, `1.234,56` in Euro; `1`, `1000`,
   `1234.56` in yen), then press "Split (Multiple Categories)". Leave the lines empty, then fill one line with
   half. Record the 9 × 2 readings and what was typed.
2. **Decide (done in the design):** `fmt.input(|r|)`, with no symbol and no sign. `SplitLines.tsx` already does
   this. Fix only what the reproduction shows is not that: for example a line or parent parsed with the default
   formatter, or text echoed instead of formatted. Any fix stays in `apps/web/src/register/**`, and formatting
   goes through `usePlanFormatter()` (`scripts/test/plan-formats-screens.test.ts` must stay green).
3. **Spec `e2e/import-start-split.spec.ts`** (acceptance case 11): the table in the design, both sizes, plus the
   mixed-form regexes. If a fault was found, run the spec on today's code first and quote the failing line.
4. **`e2e/register-approve-euro.spec.ts`:** replace the comment "as observed live; case 15 only asks to report
   it" with the decision and add the three amounts' assertions. **List this as a departure.**
5. Check at 1024×700 that `.split-remaining-label` has `text-overflow: ellipsis` with `title="Amount remaining to
   assign"`. The source has a tooltip with that text. Add both in `register/entry.css` / `SplitLines.tsx` if
   they are missing.

Verify: `pnpm check` and `pnpm e2e e2e/import-start-split.spec.ts e2e/register-approve-euro.spec.ts e2e/splits.spec.ts`.
Commit: `EXF-780: split remaining line in the plan's format without symbol, spec in three plans`.

## Docs

`docs/README.md` already has one line for the design (the Architect added it). Add no other line, and never edit
the README's text.

## Report checklist (Implementer)

- Part 1: the figures of case 1 (counts, balances), the D1 counts before/after, and each fault test's failing
  line on the old code.
- Part 2: the spec's failing line without the change.
- Part 3: the 9 readings before and after, with what was typed.
- Existing tests or specs whose expectation changed, each with its reason (expected: only
  `register-approve-euro.spec.ts`).
- Confirmation that no file of note 10 and no shared module changed, and that no dependency was added.
- The actions you took in the source app (expected: none).
