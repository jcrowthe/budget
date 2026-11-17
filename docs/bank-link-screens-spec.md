# Bank link screens spec (EXF-461, the screens)

Design: [bank-link-screens-design.md](bank-link-screens-design.md) (wording, acceptance, order). Commit after each task
(1–6 = the design's order), `pnpm check` green first. Run specs with `pnpm e2e <spec>`, never the full suite.

## Task 1: two fields on the account read

**Before changing code**, add `apps/worker/test/bank-link-calls.test.ts` with the `counting()` helper copied from
`plan-formats-calls.test.ts`. Measure on unchanged code `listAccounts` (2 and 10 accounts), `getAccount`,
`updateAccount` (rename), `linkAccount`, `unlinkAccount`, `createAccountsFromBank` (1 id, 2 ids; Plaid stubbed via
`test/plaid-stub.ts` `stubPlaid`/`createPlan("sandbox")` as in `account-links.test.ts`). Expected on main: list 5,
get 5, rename 7. Write the measured numbers into the design's "D1 calls" and assert them; they must not change.

`packages/schema/src/accounts.ts`, on `Account`:
```ts
connection_status: z.enum(["connected", "delayed", "login_required", "broken"]).nullable().default(null)
  .openapi({ description: "Status of the linked account's bank connection: connected, delayed, login_required or broken; null when not linked" }),
last_synced_at: z.string().nullable().default(null)
  .openapi({ description: "When the linked account's bank connection last synced (ISO 8601 UTC); null when not linked or never synced" }),
```
Export `type ConnectionStatus`.

`apps/worker/src/repositories/accounts.ts`:
```ts
export type AccountReadRow = AccountRow & { connectionStatus: string | null; connectionSyncedAt: string | null };
export async function findActive(db, budgetId, id): Promise<AccountReadRow | undefined>
export async function list(db, budgetId, opts): Promise<AccountReadRow[]>
```
Both: `db.select({ ...getTableColumns(accounts), connectionStatus: bankConnections.status, connectionSyncedAt:
bankConnections.lastSyncedAt }).from(accounts).leftJoin(bankAccounts, eq(bankAccounts.id, accounts.bankAccountId))
.leftJoin(bankConnections, eq(bankConnections.id, bankAccounts.bankConnectionId))`, with the same where, order and
limit. No other statement changes. The callers in other services read named fields only. Check `plan-export.ts`,
`card-payments.ts`, `payees.ts`, `transactions*.ts` and `scheduled-transactions.ts`: none spreads a row into a write.

`apps/worker/src/repositories/bank-connections.ts` `findBankAccountInEnvironment` returns
`BankAccountRow & { connectionStatus: string; connectionSyncedAt: string | null }`. Select `{ a: bankAccounts, s:
bankConnections.status, t: bankConnections.lastSyncedAt }` in the same statement.

`apps/worker/src/services/accounts.ts`:
- `accountToApi(row: AccountRow & Partial<Pick<AccountReadRow, "connectionStatus" | "connectionSyncedAt">>, b)`.
  When `row.bankAccountId === null`, both fields are null. Otherwise `connection_status: asStatus(row.connectionStatus)`
  (one of the four, else null) and `last_synced_at: row.connectionSyncedAt ?? null`.
- `insertAccountWithStartingBalance` input gains `link?: { connectionStatus: string; connectionSyncedAt: string |
  null }`, spread into the row it passes to `accountToApi` (the change_log `after` and the answer).

`apps/worker/src/services/account-links.ts`:
- `createAccountsFromBank` passes `link: { connectionStatus: p.bank.connectionStatus, connectionSyncedAt:
  p.bank.connectionSyncedAt }`.
- `linkAccount`'s `after = { ...before, bankAccountId, importStartDate, connectionStatus: bank.connectionStatus,
  connectionSyncedAt: bank.connectionSyncedAt }`.
- `planAccountType` and `defaultName` move to `packages/schema/src/bank-link.ts` (task 2). Import them and
  re-export `planAccountType`, so the existing tests import it unchanged.

MCP (`apps/worker/src/mcp/tools/accounts.ts`, `reconcile.ts`): add a constant `LINK_STATE = "connection_status
(connected, delayed, login_required or broken; null when not linked) and last_synced_at (when its bank connection last
synced; null when not linked or never synced)"`. Every tool whose result holds an account (`list_accounts`,
`get_account`, `update_account`, `adjust_account_balance`, `close_account`, `reopen_account`, `create_account`,
`create_accounts_from_bank`, `link_account`, `unlink_account`, `reconcile_account`) names it in "Returns …" and adds
`"last_synced_at"` to both arrays of its `timestamps(...)` call. No tool, route or coverage line is added.

Tests: `apps/worker/test/bank-link-account-read.test.ts` (design case 14) and the counting test (after == before).
Run `pnpm check`. If an existing Worker test `toEqual`s a whole Account, add the two fields to it and list it as a
departure in the report.

Verify: `pnpm exec vitest run --project worker apps/worker/test/bank-link-*.test.ts apps/worker/test/mcp-timestamps.test.ts apps/worker/test/mcp-descriptions.test.ts apps/worker/test/account-links.test.ts`.

## Task 2: shared pure code, web API, Add Accounts step, first sync

`packages/schema/src/bank-link.ts` (pure; no imports beyond `./accounts` types and `./plaid-import`):
```ts
export function planAccountType(type: string, subtype: string | null): AccountType   // moved verbatim
export function defaultAccountName(bank: { name: string; type: string; subtype: string | null; mask: string | null }): string // moved defaultName
export function planBalanceOf(plaidType: string, milli: number | null): number       // = bankBalanceToPlan
export function bankAccountLabel(name: string, mask: string | null): string          // "ZZ Checking – 0000" (U+2013), name alone without mask
export function addAccountsLabel(n: number): string                                  // "Add 1 Account" | "Add 2 Accounts"
export type LinkStatus = "connected" | "delayed" | "login_required" | "broken";
export function linkStatus(a: { linked: boolean; connection_status: LinkStatus | null }): LinkStatus | null // linked && null → "broken"
export function connectionLabel(s: LinkStatus | "not_set_up"): string               // Connected | Imports Delayed | Connection Repair Needed (not_set_up → "Bank connections are not set up")
export function syncLine(r: Pick<SyncResult, "status"|"added"|"matched"|"modified"|"removed"|"skipped"|"has_more">): string // design wording
export function planSyncDue(accounts: { linked: boolean; closed: boolean; last_synced_at: string | null }[], nowMs: number): boolean // some open linked with null or older than DUE_AFTER_MS
```
`SyncResult` comes as a type from `./bank-connections`. Tests in `packages/schema/test/bank-link.test.ts` cover each
function: every row of the type table; `planBalanceOf` gives depository 125050, credit −42025, loan 0 → 0 (not −0),
null → 0; `syncLine` for connected with zeros (`Synced: nothing new.`), with counts (`Synced: 3 new, 1 matched.`), for
delayed, for not_set_up and with has_more; `planSyncDue` at the 6 h edge (exactly 6 h is due; 5 h 59 m is not),
closed accounts ignored, no linked account. In `apps/worker/test/bank-link-account-read.test.ts`, add a check that
`planBalanceOf` equals `bankBalanceToPlan` for those cases.

`apps/web/src/api/bank-link.ts`:
```ts
createAccountsFromBank(budgetId, body: AccountsFromBankRequest) // POST …/accounts/from-bank, idempotencyKey, AccountsFromBankResponse → data
linkAccount(budgetId, accountId, body: AccountLinkRequest)      // POST …/accounts/{id}/link, idempotencyKey, AccountResponse → account
unlinkAccount(budgetId, accountId)                              // DELETE …/accounts/{id}/link, idempotencyKey, AccountResponse → account
syncPlan(budgetId)                                              // POST /api/v1/budgets/{id}/sync, no key, PlanSyncResponse → data
syncConnection(budgetId, connectionId)                          // POST /api/v1/bank-connections/{id}/sync?budget_id=, no key, SyncResultResponse → data
useBankConnections(budgetId: string, enabled = true)            // useQuery ["bank-connections", budgetId], listBankConnections, retry false
invalidateBankLink(qc, budgetId)                                // invalidate predicate queryKey.includes(budgetId) (covers ["bank-connections", id])
startPlanSync(qc, budgetId): void                               // syncPlan(...).finally(() => invalidateBankLink(qc, budgetId)); errors swallowed
```
Syncs send no `Idempotency-Key`: each press is a new run.

`apps/web/src/shell/bank-link-accounts.tsx`:
```ts
export function BankLinkAccounts(props: { budgetId: string; connection: BankConnection; sandbox: boolean;
  onScreen?: (s: "select" | "edit" | "summary") => void;  // AddAccountDialog sets title/back from it
  onDone: () => void }): JSX.Element
```
It holds the state: `ticked: Set<string>` (starts as every row with `linked_account_id === null`), `overrides:
Record<id, {name, type}>`, the screen, the error, and `useMutation(createAccountsFromBank)`. It renders the body and its
own footer (`account-modal-footer`). Title and Back belong to the host. To keep that simple, export
`useBankLinkFlow(...)` (state + actions) and the body/footer components, and let both hosts render them. Either way
the host shows the title (`Add Accounts` / `Account Details`) and a Back that goes summary→select and edit→select.
Escape on edit or summary goes back one screen; on select it closes. The accounts list for the `Linked` pill's
name is `useAccounts(budgetId)` (cached; on `/plaid/oauth` it is the only reader). Styles live in
`shell/bank-link.css` (tokens only): `.bank-link-row` (grid: checkbox 20px | text 1fr | Edit auto), `.bank-link-name`
and `.bank-link-sub` (nowrap, ellipsis), `.bank-link-pill` (as `.env-pill`), `.bank-link-note` (12px
`--labelSecondary`).

`AddAccountDialog.tsx`: the screen `connected` becomes `link` and renders the flow. `TITLES` covers the sub-screens.
`canGoBack` is true on edit/summary. The `Done` footer is removed. Its `onDone` is `onClose`. Delete
`BankConnected.tsx` and the `.bank-connected` rules in `global.css`.

`pages/plaid-oauth.tsx`: state `done` renders `<PlanFormatsProvider budgetId={budgetId}>` around the flow, with
`sandbox` from `useBudgets()` (plan's `bank_environment`). `onDone` is `navigate(`/${budgetId}/budget`)`. Close stays
the link to the plan. When `saved.link_account_id` is set, it renders `LinkAccountChooser` (task 3) for that account
instead, and on success navigates to `accountPath(budgetId, accountId)`.

`shell/plan-formats-context.tsx`: `PlanFormatsProvider({ budgetId?, children })`. With `budgetId`, it uses that plan
from `useBudgets()` instead of the URL's.

`shell/plaidLink.ts`: the saved link state type gains `link_account_id?: string`. `BankSearch.tsx` gains the optional
prop `linkAccountId?: string` and passes it to `saveLinkState`.

e2e: `e2e/support/bank-link-stub.ts`:
```ts
export type FakeBankAccount = { id: string; name: string; mask: string | null; type: string; subtype: string | null; current_balance: number | null; plan_type: AccountType };
export type FakeConnection = { id: string; display_id: string; nickname: string; status: LinkStatus; last_synced_at: string | null; accounts: FakeBankAccount[] };
export async function stubBankLink(page: Page, request: APIRequestContext, opts: {
  budgetId: string;
  connections: FakeConnection[];       // listed newest first
  newConnection?: FakeConnection;      // answered to POST /bank-connections (added to the list)
  links?: Record<string /*account id*/, string /*bank account id*/>;
  unapproved?: Record<string /*account id*/, number>;
  afterSync?: { unapproved?: Record<string /*bank account id*/, number>; result?: Partial<SyncResult>; status?: number; detail?: string };
  fromBank?: { status: number; name: string; detail: string };   // a refusal instead of creating
  link?: { status: number; name: string; detail: string };
}): Promise<{ requests: RecordedRequest[]; links: Map<string, string> }>
```
- It routes `/api/v1/institutions*` (empty popular list unless given) and `/api/v1/bank-connections*` (list with
  `linked_account_id` from `links`, link-token, create, `/{id}/sync`).
- It routes `/api/v1/budgets/{id}/sync`, `…/accounts/from-bank` (each id becomes one real `POST
  /api/v1/budgets/{id}/accounts` through `request` with `authHeaders()`: `{ name: override ?? name, type: override ??
  plan_type, balance: current_balance ?? 0, date: today }`, so the server negates a card; then the link is
  recorded and 201 is answered with the overlaid accounts), `…/accounts/{id}/link` (POST and DELETE), and `GET
  …/accounts` and `…/accounts/{id}` (`route.fetch()`, then overlay `bank_account_id`, `linked`, `import_start_date`,
  `connection_status`, `last_synced_at`, `unapproved_count`).
- It records every request (method, url, body).
- Fixed fake ids (uuid v4 shape); names start with `ZZ`. No spec imports `@budget/*` today: give each fake bank
  account its plan type in the fixture instead of importing `planAccountType`.

Specs `e2e/bank-link.spec.ts` (design cases 1–6) and the two departures in `e2e/bank-connections.spec.ts`. Run each
departure test against the code before the change and quote its failing line in the report.

## Task 3: edit dialog: Link, Unlink, Sync Now

`apps/web/src/account/EditAccountDialog.tsx`:
- `screen: "edit" | "link" | "unlink"` beside `confirming`.
- A linked account shows `Account Type`: `<select id="edit-account-type" className="field" disabled
  title=…><option>{ACCOUNT_TYPE_LABEL[type]}</option></select>`.
- Add the section `Bank Connection` (design wording) and the component `LinkedSection({ budgetId, account })`. It
  uses `useBankConnections(budgetId, account.linked)`, finds the connection whose `accounts` holds
  `account.bank_account_id`, and runs `useMutation(syncConnection)` with the line state. On success or error it calls
  `invalidateBankLink`.
- Eligible to link: `!account.closed && account.type !== "cash" && !account.linked`.
- `screen === "link"` renders `<LinkAccountDialog budgetId account onBack={() => setScreen("edit")} onLinked={() =>
  setScreen("edit")} />`. `"unlink"` renders `UnlinkAccountDialog` (same file as LinkAccountDialog, or its own
  `link-account-unlink.tsx`), in the `CloseAccountDialog` frame (`dialog form edit-account`). It runs
  `useMutation(unlinkAccount)`; on success it invalidates and calls `setScreen("edit")`.
- Escape: each sub-screen goes back to `edit`; `edit` closes (as today).
- `edit-account.css`: `.dialog.form.edit-account { max-height: calc(100vh - 32px); display: flex; flex-direction:
  column; }` and `.edit-account .form-body { overflow-y: auto; min-height: 0; }`. Add `.edit-account-link`
  rows (status line, nowrap/ellipsis bank line, buttons row) and `.sync-line`.

`apps/web/src/account/link-account-dialog.tsx`:
```ts
export function LinkAccountDialog(p: { budgetId: string; account: Account; onBack: () => void; onLinked: () => void }): JSX.Element // account-modal shell, title "Link Account"
export function LinkAccountChooser(p: { budgetId: string; account: Account; onLinked: () => void }): JSX.Element // the body, reused by /plaid/oauth
```
The chooser uses `useBankConnections(budgetId)` and `useMutation(linkAccount)` with `today: localToday()`. On
success it runs `invalidateBankLink` and `startPlanSync`, then `onLinked`. The view `new` renders `<BankSearch
budgetId sandbox variant="connections" linkAccountId={account.id} onUnlinked={() => {}} onConnected={() => {
invalidate; setView("list") }} onLinkingChange />`. Escape is ignored while Link is open (same `linkOpen` ref
pattern as AddAccountDialog). Styles in `account/link-account.css` reuse `.bank-link-row` text classes; rows are
`<button type="button" class="link-account-row">`.

Spec `e2e/link-account.spec.ts` (cases 7–11), including the `/plaid/oauth` path with `link_account_id` saved.

## Task 4: sidebar icon and dot, header label

`apps/web/src/shell/icons.tsx`: add `LinkedCheckIcon` and `LinkWarningIcon` (12×12, `currentColor`, original
paths, no source art).

`apps/web/src/shell/bank-link-status.tsx`:
```ts
export function LinkStatusIcon(p: { status: LinkStatus }): JSX.Element // check for connected, warning otherwise; aria-hidden
export function LinkStatusBadge(p: { account: Account; className?: string }): JSX.Element | null // icon + connectionLabel, data-status; null when not linked
```
`SidebarAccounts.tsx`: `slot-left` holds `<span className="nav-unapproved-dot" title="Unapproved transactions"
aria-label="Unapproved transactions" />` when `a.unapproved_count > 0`. `slot-right` holds `<span
className="nav-link-status" data-status={s} title={connectionLabel(s)}><LinkStatusIcon status={s} /></span>` when
`linkStatus(a)`. `global.css`: the dot is 6px, round, `background: var(--labelPrimary)`, centred in its 16px slot,
and `.nav-account-row:hover .nav-unapproved-dot, .nav-account-row:focus-within .nav-unapproved-dot { visibility:
hidden }`. The check is `color: var(--labelSecondary)`; the warning `var(--labelNegative)` (no warning token exists;
tokens only).

`AccountHeader.tsx`: `<LinkStatusBadge account={account} className="acct-info-item acct-link-status" />` between
the badge item and `ReconciledLabel`. `account-header.css` sets the same icon size as the other info items.

Spec `e2e/bank-link-status.spec.ts` (case 12).

## Task 5: sync when the app opens

`apps/web/src/shell/bank-link-sync.ts`:
```ts
const checked = new Set<string>(); // plan ids checked in this page load
export function usePlanOpenSync(planId: string | undefined): void
```
It calls `useAccounts(planId)` (the sidebar's query) and `useQueryClient()`. In an effect on `[planId,
accounts.isSuccess]`: when `planId && accounts.isSuccess && !checked.has(planId)`, it adds `planId`, and if
`planSyncDue(accounts.data, Date.now())` it calls `startPlanSync(qc, planId)`. The id is added before the decision, so
a later refetch, navigation or remount never sends again in this page load; a reload empties the `Set`. The first
sync after adding or linking does not go through here (the plan is already checked), so the two never double up.
`PlanScope.tsx`: call `usePlanOpenSync(plan?.id)` next to the existing open-recording effect.

Spec `e2e/bank-link-sync.spec.ts` (case 13). It counts recorded `POST /budgets/{id}/sync` with `expect.poll`, then
waits 1 s and asserts that the count is unchanged.

## Task 6: narrow spec, docs

`e2e/bank-link-narrow.spec.ts` (case 16) uses `page.setViewportSize({ width: 1024, height: 700 })`. For each dialog:
`boundingBox()` lies inside `0..1024 × 0..700`; the body `scrollHeight > clientHeight`; the footer button
`toBeInViewport()`; each `.bank-link-name`, `.bank-link-sub` and sidebar `.name` with `scrollWidth > clientWidth`
has `text-overflow: ellipsis` and a `title` equal to its `textContent`.

`docs/account-links-spec.md`: three passages describe a bulk unlink that does not exist. Fix each one:
- Line ~67: drop `unlinkByConnectionStmt` and add `export function noLinksToConnection(connectionId: string) // NOT
  EXISTS condition the removal's deletes are guarded on`.
- Line ~118: change the comment to `// per account: a guarded log row and unlinkIfStmt(db, row)`.
- The bullet `unlinkForConnectionStmts` (~138–141): per row of `linkedToConnection`, the guarded log row, then
  `unlinkIfStmt(db, row)`, guarded on `unlinkHolds`. No bulk UPDATE. `removeBankConnection` guards its deletes with
  `repo.removalHolds(db, id, accountsRepo.noLinksToConnection(id))`. Also fix Task 7's "unlink logs + unlink update"
  to say "per-account unlink log and update pairs".

`docs/bank-link-screens-polish.md` belongs to the Designer. `docs/README.md` already has the design's line.

## Checks the Implementer runs

- `pnpm check` after every task.
- `pnpm e2e e2e/bank-link.spec.ts e2e/link-account.spec.ts e2e/bank-link-status.spec.ts e2e/bank-link-sync.spec.ts e2e/bank-link-narrow.spec.ts e2e/bank-connections.spec.ts e2e/sidebar-groups.spec.ts e2e/edit-account.spec.ts e2e/account-header.spec.ts` (with `--repeat-each=3` once at the end).
- `git diff --name-only origin/main` lists nothing outside the design's `touches` and none of note 10's files.
- Nothing calls Plaid. Nothing reads `PLAID_*`. No `$`-formatting outside the formatter. No source name.
