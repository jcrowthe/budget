# Manual match and unmatch: implementation spec (EXF-464, EXF-816)

Design: [manual-match-design.md](manual-match-design.md). Its tables (refusals in order, writes, D1 counts) are the
contract; this spec says where each piece goes. Work in the design's order and commit after each part. Run `pnpm
check` before each commit, and only your part's specs (`pnpm e2e <specs>`), never the whole suite.

## Ground (read in the code)

- `services/transactions.ts`:
  - `transactionToApi` :41, `transactionDetailToApi` :212, `logShape` :235, `TransactionRefused` :180;
  - private helpers to export: `activePlan` :268, `activeAccount` :274, `detailOf` :280, `linesByParent` :286,
    `payeeInsert` :70, `MAX_ATTEMPTS` :151;
  - `approveTransactions` :1302 is the guard pattern.
- `repositories/transactions.ts`: `LinkCols` :31, `insertIfStmt` :52 (leave it), `holdsAt` :443, `allHold` :451,
  `writtenAt` :471, `TxSet` :484, `updateIfStmt` :512, `softDeleteIfStmt` :549, `syncLinesIfStmt` :568,
  `listLines` :592.
- `services/payees.ts:74` is `resolvePayee`.
- `services/plaid-sync.ts:481-523` is the automatic match: read it, **do not edit**.
- Patterns:
  - routes: `routes/transactions.ts:300-355`, errors at :70;
  - tools: `mcp/tools/transactions.ts:71-85`;
  - D1 counter: `test/bulk-call-count.test.ts:24` `counting()` (copy it; do not edit that file);
  - Plaid world: `test/plaid-sync-helpers.ts` (`setupPlaid`, `world1`, `feed`, `syncOne`, `q`, `REST_ACTOR`; the
    Starting Balance is dated `T` = 2026-03-10, so imports are dated ≥ T), and `plaid-sync.test.ts` 462-13;
  - browser stand-in: `e2e/support/approve-seed.ts` `stubReject`.
- Web:
  - `RegisterTable.tsx:189` (`attentionCol`) and :329 (the cell);
  - `Popover.tsx` (`anchor`, `placement`, `width`, `label`, `role`, `align`);
  - `icons.tsx` `LinkIcon` :173 and `LinkBrokenIcon` :178;
  - `api/transactions.ts` `invalidatePlan` :151;
  - `account/Tooltip.tsx` (import only).

## Part 1: EXF-816

1. **Spec first:** `e2e/manual-match-category-title.spec.ts`, at viewport 1024×700, on the real server.
   - Seed through the API: a plan (`testName("match-cat")`), a checking account, the group "ZZ Group With A Long
     Name For Narrow" and in it the category "ZZ Category With A Long Name Too".
   - Open the account, then `Add Transaction`, and type an outflow.
   - A helper reads, from the open row's `input[aria-label="Category"]`, `{ value, title, scrollWidth, clientWidth,
     textOverflow: getComputedStyle(el).textOverflow }`.
   - The cases are:
     1. the long category picked;
     2. `Inflow: Ready to Assign` picked;
     3. `Split (Multiple Categories)` → the parent field;
     4. the first split line's field, with the long category picked.
   - For each, `expect(title).toBe(value)`, and when `scrollWidth > clientWidth`, `expect(textOverflow).toBe(
     "ellipsis")`.
   - Also `expect(scrollWidth).toBeGreaterThan(clientWidth)` for cases 1, 3 and 4. If case 4 is not cut at 1024,
     make the names longer, and say so.
2. Run it before the fix. **Quote the failing line** in the commit message and the report; it is expected at
   `expect(title).toBe(value)` with the received title `""` or `null`.
3. Fix `CategoryField`:
   `title={fixedText ?? title ?? ((typed ?? shown) || undefined)}`. Nothing else changes.
4. Verify: the new spec, `e2e/register-attention-narrow.spec.ts`, `e2e/splits.spec.ts` and
   `e2e/register-entry.spec.ts` pass. Commit.

## Part 2: match in the Worker; `match_details`

**Migration** `apps/worker/migrations/20261116101600_manual_match.sql`:
```sql
-- EXF-464: the hand entry's amount before a manual match, for unmatch. Null for every other row.
ALTER TABLE transactions ADD COLUMN match_entry_amount integer;
```
Then delete `.e2e-state`.
- `apps/worker/src/db/schema/transactions.ts`: add `matchEntryAmount: integer("match_entry_amount")` after
  `flagColor` (`schema-drift.test.ts` checks it).
- `repositories/transactions.ts`: add `"matchEntryAmount"` to `LinkCols` and to `TxSet`. **Do not** add it to
  `insertIfStmt`.

**Schema** `packages/schema/src/transactions.ts`:
```ts
export const MatchDetails = z.object({ date: IsoDate, amount: Milliunits, payee_name: z.string().nullable() })
  .openapi("MatchDetails");  // description: "What the bank sent for a matched transaction"
// TransactionDetail.extend({...}) gains:
match_details: MatchDetails.nullable().default(null)  // description: bank's date, amount, payee as imported; null unless matched
export const TransactionMatchRequest = z.object({ ids: z.array(z.string().min(1)).length(2)
  .refine((a) => a[0] !== a[1], "Select exactly two different transactions to match") }).strict()
  .openapi("TransactionMatchRequest");
export const MatchResult = z.object({ transaction: TransactionDetail, removed: TransactionDetail }).openapi("MatchResult");
export const UnmatchResult = z.object({ transaction: TransactionDetail, imported: TransactionDetail }).openapi("UnmatchResult");
export const MatchResponse = dataEnvelope(MatchResult);
export const UnmatchResponse = dataEnvelope(UnmatchResult);
```
The fixtures in `packages/schema/test/register.test.ts` and `register-export.test.ts` gain `match_details: null`.
That is the only edit to existing tests here; list it in the report.

**`transactionDetailToApi`** adds:
`match_details: matched && row.importDate != null && row.importAmount != null ? { date: row.importDate, amount:
row.importAmount, payee_name: row.importPayeeName ?? null } : null`.
`transactionToApi` and `logShape` are unchanged.

**Pure rule** `packages/schema/src/manual-match.ts` (no Worker imports):
```ts
export type MatchRow = Pick<TransactionDetail, "id"|"account_id"|"date"|"payee_name"|"amount"|"cleared"|"approved"
  |"import_id"|"source"|"transfer_account_id"|"subtransactions"|"match_details">;
export type MatchFmt = Pick<PlanFormatter, "date" | "money">;
export type Refusal = { name: "not_matchable"|"not_matched"|"account_closed"|"transaction_reconciled"; detail: string };
export const matchRole = (r) => r.import_id !== null && r.source === null ? "matched" : r.source === "plaid" ? "import" : "entry";
export const matchLabel = (r: Pick<MatchRow,"payee_name"|"date"|"amount">, fmt: MatchFmt) =>
  `${r.payee_name || "The transaction"} on ${fmt.date(r.date)} (${fmt.money(r.amount)})`;
export const MATCH_TEXT = { /* every sentence of the design's two tables, as functions of labels/amounts */ };
export function matchRefusal(a: MatchRow, b: MatchRow, ctx: { closed: (accountId: string) => boolean; fmt: MatchFmt }): Refusal | null;
export function unmatchRefusal(r: MatchRow, ctx: { closed: (accountId: string) => boolean; fmt: MatchFmt }): Refusal | null;
export function matchActions(rows: readonly MatchRow[], accountOf: (id: string) => { closed: boolean } | null, fmt: MatchFmt):
  { match: { enabled: boolean; reason: string | null } | null; unmatch: { enabled: boolean; reason: string | null } | null };
```
- The order is exactly the design's tables (1 → 8c; then unmatch: not matched → closed → reconciled → no bank
  copy). "Split" means `subtransactions.length > 0`, "transfer" means `transfer_account_id !== null`, and
  "reconciled" means `cleared === "reconciled"`.
- In 8a and 8b, {t} is `fmt.money(entry.amount)` and {e} is `fmt.money(import.amount)`.
- The `money` and `date` texts come from the plan formatter (U+2212 and non-breaking spaces as it gives them).
- `matchActions`:
  - `match` is non-null only for exactly two rows, with `enabled = refusal === null` and `reason = refusal?.detail`;
  - `unmatch` is non-null only for one row whose `matchRole` is `"matched"`.
- Test `packages/schema/test/manual-match.test.ts` covers each row of both tables, `matchActions` for 0, 1, 2 and 3
  rows, and the label without a payee.

**Service** `apps/worker/src/services/manual-match.ts`:
- From `transactions.ts`, export (rename nothing else) `activePlan`, `activeAccount`, `detailOf`, `detailsOf`,
  `payeeInsert`, `linesByParent` and `MAX_ATTEMPTS`.
- `matchTransactions(env, actor, budgetId, ids: readonly string[]): Promise<{ transaction; removed }>`:
  1. `activePlan` gives `fmt = planFormatter(formatsOfRow(planRow))`.
  2. `findDetailMany`; a missing id throws `NotFound("Transaction")`.
  3. `activeAccount(a.accountId)`.
  4. The checks in the design's order, as the Worker's own code. Label with `matchLabel` and words from
     `MATCH_TEXT` (importing those two is allowed; `matchRefusal` is not). Throw `new TransactionRefused(status,
     name, detail)`.
  5. `listLines({ parentIds: [entry.id, imp.id] })`.
  6. One batch: `[changeLogInsertIf(update entry), changeLogInsertIf(delete import), syncLinesIfStmt (entry split
     only), softDeleteIfStmt(import), updateIfStmt(entry, …)]`. The guard is `allHold([holdsAt(entry),
     holdsAt(imp)])`. The last statement's guard also has `writtenAt(db, imp.id, now)`.
  7. When the last statement's `changes` is 0, retry up to `MAX_ATTEMPTS`, then `throw new Conflict("Transaction")`.
  8. Answer `transaction` from `findDetail` and lines (via the exported `detailOf`, or the same two calls), and
     `removed` = `transactionDetailToApi(imp, [])`.
  - The entry's `TxSet` is `{ amount: imp.amount, importId, importedPayee, bankDescription, importDate,
    importAmount, importPayeeName (all from imp), matchEntryAmount: entry.amount, cleared: entry.cleared ===
    "reconciled" ? "reconciled" : "cleared", approved: true, updatedAt: now }`.
  - The log's `after` is `logShape({ ...entry, ...set }, lines)` with the entry's category names.
- **Route** in `routes/transactions.ts`: `POST /budgets/{budget_id}/transactions/match`, body
  `TransactionMatchRequest`.
  - Responses: 200 `MatchResponse`, 404, 409, 422. The descriptions name each error `name`, as reject's do.
  - Actor: `c.get("identity").actor`.

**Tests** in `apps/worker/test/manual-match.test.ts` (`setupPlaid` in `beforeEach`, `world1()`):
- Design case 1, with the figures written in the test:
  - hand −12340 dated 2026-03-12, payee "ZZ Cafe", memo "ZZ memo", a category, flag red;
  - a feed entry of amount 13.00 (Plaid sign: positive is an outflow → −13000), date 2026-04-01, `merchant_name`
    "ZZ Bank Cafe";
  - balances read from `GET …/accounts/{id}` before the sync, after it, and after the match.
- Cases 4, 5 and 6.
  - For case 4, snapshot `select * from transactions where budget_id = ?`, `import_tombstones` and `count(*) from
    change_log` before and after each refusal: equal.
  - Run each case also through `matchRefusal` / `unmatchRefusal` with `planFormatter(DEFAULT formats)` and
    `closed` from the account read, and expect the same `name` and `detail`.
  - Set up the states the API cannot make (reconciled, an approved import, a split import, a closed account) with
    `q(...)` in D1, as `plaid-sync.test.ts` does.
- change_log: the `update` and `delete` rows with `actor = REST_ACTOR`.

**D1 calls** in `apps/worker/test/manual-match-calls.test.ts`:
- `counting()` around `matchTransactions` in an account holding 10 hand rows plus the pair, and then 100: both
  equal, and ≤ 7.
- The same for `getTransaction`, `listAccountTransactions` and `listPlanTransactions` before and after a match:
  equal.

Commit.

## Part 3: unmatch

`unmatchTransaction(env, actor, budgetId, id): Promise<{ transaction; imported }>` in `manual-match.ts`:
1. `activePlan`, then `findDetail` (404), then `activeAccount`.
2. The checks in the unmatch table's order.
3. `listLines({ parentIds: [row.id] })`.
4. `resolvePayee(db, budgetId, { payee_name: row.importPayeeName })` when the name is non-null.
5. Build `amount`: `lines.length > 0 || row.transferTransactionId ? row.amount : (row.matchEntryAmount ??
   row.amount)`.
6. One batch:
   - `[...(payee.create ? payeeInsert(...) : [])`;
   - log `update` of the entry; log `create` of the import;
   - `syncLinesIfStmt(cleared: "uncleared")` for a split only;
   - `updateIfStmt(entry, { amount, importId: null, importedPayee: null, bankDescription: null, importDate: null,
     importAmount: null, importPayeeName: null, matchEntryAmount: null, cleared: "uncleared", updatedAt: now },
     holdsAt(row))`;
   - `insertIfStmt(db, newImport, writtenAt(db, row.id, now))` (`newImport.payeeId` = the resolved or created
     payee's id).
   - The insert goes **after** the update (the unique index). `newImport`:
     - id: a new UUID; `accountId`; `date: row.importDate`; `amount: row.importAmount`;
     - `payeeId` / `payeeName` from `resolvePayee`; `categoryId: null`; `inflowToReadyToAssign: false`;
       `memo: null`;
     - `cleared: "cleared"`; `approved: false`; `source: "plaid"`;
     - `importId`, `importedPayee`, `bankDescription` and `importDate/Amount/PayeeName` copied from the row;
     - `flagColor: null`; `createdAt = updatedAt = now`; `deletedAt: null`.
7. Retry on 0 changes, or on `isUniqueViolation` when a payee was created.
8. Answer `detailsOf([row.id, newImport.id])`, giving `transaction` and `imported`.

**Route**: `POST /budgets/{budget_id}/transactions/{transaction_id}/unmatch`, no body; 200 `UnmatchResponse`, 404,
409, 422.

**Tests:**
- `manual-match.test.ts` gains design cases 2 and 6 (unmatch), the unmatch refusals, and the unmatch of an
  automatic match. Make that one with the 462-13 setup: equal amounts, 3 days apart, sync. Unmatch → the entry has
  its own amount.
- `manual-match-calls.test.ts` gains unmatch ≤ 8, equal for 10 and 100.
- `apps/worker/test/manual-match-sync.test.ts` covers design case 3:
  - after the unmatch, put the same entry in `feed.pages` as `added` and null the connection's `sync_cursor` and
    `sync_accounts` with `q(...)` (a re-read), then `syncOne` → `added 0, matched 0`, and the live rows and their
    count are unchanged;
  - then the entry as `modified`, with the same values → `modified 0`, the same rows.

  Run each test once against the code before your fix if it is written for a fault. Here they are new behaviour;
  say so.

Commit.

## Part 4: the two tools

In `mcp/tools/transactions.ts`:
- `match_transactions`: `{ budget_id: Id, ids: z.array(Id).length(2) }` → `matchTransactions(...)`.
- `unmatch_transaction`: `{ budget_id: Id, transaction_id: Id }` → `unmatchTransaction(...)`.

Descriptions:
- **Match** says:
  - the hand entry keeps its payee, memo, date, category and flag, and takes the bank's amount, the import's id and
    bank fields, cleared and approved;
  - the import's own row is deleted;
  - dates may be any distance apart and amounts may differ: **only this tool (the owner's word) matches such rows;
    the bank sync matches only equal amounts within 10 days**;
  - it names each refusal of the table as a tool error;
  - then `${MONEY} Returns { transaction, removed }` (as `get_transaction` returns them, with `match_details`), then
    `${dates("date") + " " + timestamps(["updated_at", "created_at"])}`.
- **Unmatch** says what comes back: the hand entry with its amount from before the match, uncleared, with its own
  fields; and the import as a new unapproved transaction with the bank's date, amount and payee and the same import
  id, which no sync matches or imports again. It also gives the refusals and `Returns { transaction, imported }`.
- `get_transaction` gains ", match_details (for a matched transaction the bank's date, amount and payee_name as
  imported, else null)".

Other files:
- `apps/worker/test/mcp-coverage/transactions.ts`: `"POST /budgets/{budget_id}/transactions/match": { tool:
  "match_transactions" }` and `"POST /budgets/{budget_id}/transactions/{transaction_id}/unmatch": { tool:
  "unmatch_transaction" }`.
- `apps/worker/test/mcp-timestamps.test.ts`: two `CALLS` entries next to `reject_transactions`. Extend its context
  setup (`:87-96`, the SQL-made import): add a hand row and an SQL-made import of the same account for
  `match_transactions`, then `unmatch_transaction` on the matched id. Keep both sides' entries at a rebase.
- `manual-match.test.ts` gains MCP:
  - design cases 1 and 2 through `mcpRpc` (from `test/surface.ts`), with change_log `actor` starting `mcp:`;
  - `expect(await apiPaths()).toEqual(expect.arrayContaining(["/api/v1/budgets/{budget_id}/transactions/match",
    "/api/v1/budgets/{budget_id}/transactions/{transaction_id}/unmatch"]))`;
  - the same for `listedToolNames()` with the two names.

Commit.

## Part 5: the register

**API** in `apps/web/src/api/transactions.ts`:
- `matchTransactions(budgetId, ids)` and `unmatchTransaction(budgetId, id)` via `apiFetch` (POST,
  `idempotencyKey`, `schema: MatchResponse` / `UnmatchResponse`).
- `useMatchTransactions(budgetId)` and `useUnmatchTransaction(budgetId)` call `useMutation` with `onSuccess: () =>
  invalidatePlan(qc, budgetId)`. Nothing else.

**Icon and details** in the new file `apps/web/src/register/manual-match-details.tsx`:
- `export function MatchCell({ budgetId, tx }: { budgetId: string; tx: TransactionDetail })`.
- It renders `button.match-link`:
  - `type="button"`, `aria-label="This transaction has a matched transaction"`, `aria-haspopup="dialog"`;
  - the `Tooltip` from `../account/Tooltip`, content `Matched`;
  - `<LinkIcon />` at 14×14;
  - `onClick` with `e.stopPropagation()`, which toggles the panel;
  - `onMouseDown` that stops propagation (no row select).
- The panel is `Popover` with `placement="below"`, `align="start"`, `role="dialog"`, `label="Matched
  Transactions"` and `width={Math.min(512, window.innerWidth - 16)}`. It holds:
  - `h2` "Matched Transactions";
  - `table.match-table` with a thead `Date | Payee | Memo | Amount` and two body rows:
    - `fmt.date(tx.date)`, `tx.payee_name || "None"`, `tx.memo`, `fmt.money(tx.amount)`;
    - `fmt.date(d.date)`, `d.payee_name || "None"`, empty, `fmt.money(d.amount)`;
  - each `td` has `title` = its text;
  - a button `Unmatch` (class `match-unmatch`, secondary), with `title` "Unmatching will create two separate
    transactions for your manual entry and the imported entry.";
  - an error line (`role="alert"`), filled from `ApiError.detail`.

  `Unmatch` calls `useUnmatchTransaction().mutateAsync(tx.id)`, then closes. On close, focus goes back to the
  button.

`RegisterTable.tsx`:
- `const attentionCol = rows.some((r) => !r.approved || r.matched);`
- In the cell: `{!tx.approved ? <AttentionCell …/> : tx.matched && tx.match_details ? <MatchCell …/> : null}`.
  Keep `AttentionCell` untouched; it already returns null when approved, so a simple order is fine.

CSS goes in `register.css`, using only `tokens.css` variables. Take the sizes from the notes' "Probe
measurements" and "Match popover" (`/workspace/scratch/source/manual-match/notes.md`):
- `.match-link`: 16×16 with `margin-top: 3px`, colour `--iconFillSecondary`; its svg is 14×14 with
  `pointer-events: none`.
- The panel: padding 16px.
- `h2`: 16px/600.
- Cells: 8px 12px, `max-width: 192px`, ellipsis; the Amount column right-aligned.
- `th`: 12px/500 uppercase, `--labelSecondary`, `--separatorStandard` borders.
- `Unmatch`: 8px 24px, right-aligned, 12px above.

**Bar** in `ActionBar.tsx`:
- `const ma = matchActions(sel, (id) => accountById.get(id) ?? null, fmt);`
- `match` and `unmatch` hooks, and:
  - `doMatch` runs `if (!ma.match?.enabled) return;`, then `guard(async () => { await match.mutateAsync(ids);
    clear(); })`;
  - `doUnmatch` does the same with `sel[0].id`.
- Render them after the Clear button, before the separator and More (the source's order):
  ```tsx
  {ma.match && (
    <Tooltip placement="above" align="center" delayed={false} content={ma.match.reason ?? "Match"}>
      {(tip) => <button {...tip} type="button" className="action-bar-button"
        aria-disabled={ma.match.enabled ? undefined : "true"} onClick={doMatch}><LinkIcon />Match</button>}
    </Tooltip>)}
  ```
  `Unmatch` is the same with `LinkBrokenIcon`.
- Give `.action-bar-button[aria-disabled="true"]` `opacity: .5` and `cursor: default`.
- The bar's icons are 12×12 with an 8px gap, as the existing `CategorizeIcon` uses (check `register.css`).
- `accountById` needs `closed`, which it already has.

**Stand-in** in the new file `e2e/support/manual-match-stub.ts`. The real server never sees a match in a spec.
- `export async function stubManualMatch(page: Page, pairs: { entry: string; imp: string; matched?: boolean }[]):
  Promise<{ posts: { url: string; body: unknown }[]; listGets: () => number }>`.
- Both rows of a pair are real hand rows made through REST. The stub dresses `imp` as an import, and while
  `matched`, it hides `imp` and dresses `entry` as matched.
- **GET** `/transactions` lists (account and plan, any query): `route.fetch()`, then map `data.transactions`. Every
  field keeps the server's own value except these, which take the forms the Worker gives them
  (`apps/worker/src/services/transactions.ts:41-62, 212-227`):
  - an apart `imp` becomes `{ ...t, import_id: "zz-imp-" + t.id, source: "plaid", approved: false, imported_payee:
    t.payee_name, bank_description: t.payee_name, matched: false, match_details: null }`;
  - while matched, `imp` is removed, and `entry` becomes `{ ...t, amount: impRow.amount, cleared: "cleared",
    approved: true, import_id: "zz-imp-" + imp, source: null, imported_payee: impRow.payee_name, bank_description:
    impRow.payee_name, matched: true, match_details: { date: impRow.date, amount: impRow.amount, payee_name:
    impRow.payee_name } }`, where `impRow` is the real row of `imp` from the same answer;
  - shift `data.balances` (`cleared`, `uncleared` by the row's `cleared`; `working`) by the shown − real amounts.
  - Count each GET in `listGets`.
- **POST** `…/transactions/match`: when the body's ids are a known apart pair, set it matched and fulfil 200 with
  `{ data: { transaction: <entry as dressed>, removed: <imp as dressed before> } }`. Otherwise use
  `route.continue()`, so the real server answers (two hand rows → its own refusal 4).
- **POST** `…/transactions/{id}/unmatch`: for a matched pair's `entry`, set it apart and fulfil 200 with `{ data: {
  transaction: <entry real>, imported: <imp dressed> } }`. Otherwise `route.continue()`.
- Record each POST in `posts`.

**Spec** `e2e/manual-match.spec.ts` (1440×900):
- Seed a plan with checking, savings and a category, all with `testName`.
- Rows in checking:
  - entry "ZZ Cafe" −12340 (5 days ago, categorized) and imp "ZZ Bank Cafe" −13000 (2 days ago), as a pair;
  - two plain hand rows "ZZ Plain A" and "ZZ Plain B";
  - a second pair started `matched: true`.
- One row in savings.
- Design case 11: the icon, the `Matched` tooltip on hover, the keyboard (`Tab` until focused, `Enter`, the texts
  in the plan's format, `Escape`, focus).
- Design case 12:
  - Select the pair with `realClick` on the checkboxes → `Match` enabled.
  - Click → `expect.poll(() => s.posts.length).toBe(1)`, with the body's ids equal to the pair; the import's row
    disappears; one row with `button[aria-label="This transaction has a matched transaction"]`.
  - Measure `listGets()` across the click, and compare it with a bulk Flag on one row done the same way: `≤`.
  - Plain A and B → `aria-disabled="true"`; hover → the tooltip text equals `MATCH_TEXT`'s sentence 4; a click →
    no new POST.
  - The started-matched row → `Unmatch` → one POST, then two rows.
  - All Accounts: the checking entry and the savings row → disabled, with the tooltip of refusal 1 (built with
    `matchLabel` and the default formatter).

Commit after the icon and details, and again after the bar.

## Part 6: narrow window

`e2e/manual-match-narrow.spec.ts` at 1024×700, with the same seed and stand-in, plus a long payee "ZZ Bank Cafe
With A Long Name For Narrow Width":
- the icon's box is inside its `td.cell-attention`;
- open the panel: its `getBoundingClientRect()` is inside `0..innerWidth` and `0..innerHeight`, and every `td`
  with `scrollWidth > clientWidth` has `text-overflow: ellipsis` and a `title` equal to its text;
- the bar with `Match`, and the bar with `Unmatch`: every button's rect is inside `.register-action-bar-inner`, and
  that is inside the window.

Fix what fails within `apps/web/src/register/**`. Commit.

## Reports

Every step reports:
- the D1 figures;
- EXF-816's failing line;
- the two fixtures edited (`match_details: null`), and any other existing test or spec edited, with its reason;
- that no file of the brief's note 11, no shared module and no dependency changed;
- its actions in the source app, or that it opened nothing.
