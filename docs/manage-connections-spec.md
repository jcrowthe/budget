# Manage Bank Connections screens: implementation spec (EXF-460 screens, EXF-773)

Design: [manage-connections-design.md](manage-connections-design.md) (behaviour, wording, acceptance). This file says
where each part goes. Commit after each task, in this order. Run `pnpm check` before each commit; run only the specs
of the task with `pnpm e2e <specs>` (never the full suite). Every spec click is `realClick` (import from
`e2e/support/real-click.ts`; do not edit it); exact names; own sandbox plan (`bank_environment: "sandbox"`);
`expect.poll` on the stub's `requests` after a click that sends one.

## Ground rules

- **Out of bounds** (unchanged): `apps/web/src/register/**`, `apps/web/src/pages/account.tsx`, `pages/accounts.tsx`,
  `api/transactions.ts`, anything named `approve`/`attention`, `e2e/register*.spec.ts`, `e2e/all-accounts.spec.ts`,
  every `paths.always_overlap` file, `apps/worker/test/openapi.test.ts`, `mcp.test.ts`, `e2e/mcp.spec.ts`,
  `packages/core/src/**`, `packages/schema/src/common/**`, `apps/worker/src/**` (all Worker source), `api/client.ts`,
  `router.tsx`, `shell/planMenuEntries.ts`, `apps/web/src/plan/**`, `apps/web/src/reflect/**`,
  `e2e/support/real-click.ts`, `e2e/support/plaid-stub.ts`.
- No dependency, no migration, no REST route, no MCP tool. Tokens only (`tokens.css` variables). Money via
  `fmt.money`, dates via `fmt.date` (`usePlanFormatter()`); never a `$` literal or `minimumFractionDigits`
  (`scripts/test/plan-formats-screens.test.ts`). Test data `ZZ …`; never the source app's name.

## Reused, not copied

| Symbol | From | Used for |
| -- | -- | -- |
| `useBankConnections(budgetId)` | `api/bank-link.ts` | the list (the only connections read) |
| `linkAccount`, `syncConnection`, `startPlanSync`, `invalidateBankLink`, `errorDetail` | `api/bank-link.ts` | link, sync after relink, refresh, messages |
| `useAccounts(budgetId)` | `api/accounts.ts` | plan accounts (linked names, link choices) |
| `localToday(date?)` | `api/today.ts` | `today`, local dates of timestamps |
| `useBudgets()` | `api/budgets.ts` | `bank_environment === "sandbox"` |
| `BankLinkAccounts`, `useBankSubline`, `BANK_LINK_TITLES` | `shell/bank-link-accounts.tsx` | Add as a new Account, `<Type> \| <balance>` |
| `UnlinkAccountDialog` | `account/link-account-unlink.tsx` | Unlink |
| `AddAccountDialog` (`variant="connections"`) | `shell/AddAccountDialog.tsx` | Add a New Bank Connection |
| `loadPlaidLink`, `plaidExitMessage`, `PlaidLoadError` | `shell/plaidLink.ts` | the update-mode sign-in |
| `bankAccountLabel`, `planAccountType`, `connectionLabel` | `@budget/schema/bank-link` | labels |
| `ACCOUNT_TYPE_LABEL` | `shell/accountTypeLabels.ts` | plan account type names |

## Task 1 — list, two ways in, empty state

**`packages/schema/src/manage-connections.ts`** (new, pure):
```ts
export type ConnectionGroup = "attention" | "delayed" | "others";
export const CONNECTION_GROUPS: { id: ConnectionGroup; heading: string }[]; // Needs Attention, Delayed, All Others
export function connectionGroup(status: string): ConnectionGroup; // connected→others, delayed→delayed, else attention
export function statusLabel(status: string): string; // connected/delayed/login_required/broken via connectionLabel; else "Connection Repair Needed"
export function connectionBadge(status: string): "Repair" | "Delayed" | null;
export function accountCountLabel(n: number): string; // "1 Account" / "N Accounts"
export const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;
export function resetAvailableAt(lastResetAt: string | null, now?: number): string | null; // same body as the Worker's
```
**`packages/schema/test/manage-connections.test.ts`**: groups for the four statuses and `"weird"`; labels; badges;
counts 1/2/0; `resetAvailableAt` null, 24 h − 1 s, 24 h + 1 s.

**`apps/worker/test/manage-connections-reads.test.ts`** (new; copy `counting()` from `bank-link-calls.test.ts`, the
plan/stub setup from there): `listBankConnections` makes **4** D1 calls with 1 and with 10 connections (assert both
`toBe(4)`); and for a list of instants `resetAvailableAt` from `@budget/schema/manage-connections` equals the one
exported by `src/services/bank-connections.ts`.

**`apps/web/src/api/manage-connections.ts`** (new):
```ts
renameBankConnection(budgetId, id, nickname): Promise<BankConnection>   // PATCH /api/v1/bank-connections/{id}?budget_id=, body {nickname}, idempotencyKey uuid, BankConnectionResponse
removeBankConnection(budgetId, id): Promise<{ deleted: true; plaid: string }> // DELETE …/{id}?budget_id=, idempotencyKey uuid, BankConnectionDeleted
createUpdateLinkToken(budgetId, id): Promise<{ link_token: string; expiration: string }> // POST …/{id}/link-token?budget_id=, no body, NO idempotencyKey, LinkTokenResponse
finishReset(budgetId, id): Promise<BankConnection>                      // POST …/{id}/reset?budget_id=, idempotencyKey uuid, BankConnectionResponse
setConnectionInCache(qc, budgetId, c: BankConnection): void             // replaces the row in ["bank-connections", budgetId]
```
Ids `encodeURIComponent`; schemas from `@budget/schema/bank-connections`.

**`apps/web/src/shell/manage-connections-dialog.tsx`** (new): `export function ManageConnectionsDialog({ budgetId,
onClose }: { budgetId: string | null; onClose: () => void })` (null → renders nothing).
- State `view`: `{ v: "list" } | { v: "add" } | { v: "detail", id } | { v: "bank", id, bankId } | { v: "link", id,
  bankId } | { v: "new", id, bankId } | { v: "unlink", id, bankId } | { v: "reset", id } | { v: "remove", id }`, and
  `linking` (ref; true while the sign-in is open).
- `view.v === "add"` → render only `<AddAccountDialog variant="connections" onBack={toList} onClose={toList} />`;
  `toList` invalidates `["bank-connections", budgetId]` and sets the list view.
- `unlink`, `reset`, `remove` render only their dialog (tasks 3–4). Other views render
  `div.dialog-backdrop.top > div.dialog.modal.account-modal.manage-connections[role=dialog][aria-label=<title>]`
  with `.dialog-head` (Back `icon-button back` on every view but the list; `<h2 title>` + subtitle `<p
  class="mc-subtitle">` on the detail; Close), body `.account-modal-body`, footer `.account-modal-footer`.
- Escape (one `document` keydown listener, ignored while `linking`): list → `onClose`; detail → list; bank →
  detail; link/new → bank.
- If the viewed connection disappears from the query (removed), fall back to the list.
- List body: `env-pill` when sandbox; `CONNECTION_GROUPS` filtered to non-empty; `<section><h3>heading</h3><ul>` of
  `ConnectionRow`; empty: `<p class="mc-empty">No bank connections yet.</p>`; read error: `error-bar`. Footer:
  `<button class="primary large">Add a New Bank Connection</button>`.
- `ConnectionRow` (`<button class="mc-row" aria-label={nickname}>`): `ConnectionLogo` (img `institution_logo` or
  `BankIcon` in `.mc-logo`; `<span class="mc-dot" data-status={group}>`), `.mc-lines` (three spans, each `title`),
  badge `<span class="mc-badge" data-kind="repair|delayed">` with `LinkWarningIcon`/`ClockIcon`, `ChevronRightIcon`.

**`apps/web/src/menu-actions/bank-connections.tsx`** (new):
`export const action: PlanMenuAction = { entry: "bank-connections", Dialog: ManageConnectionsDialog };`

**`apps/web/src/shell/Sidebar.tsx`**: remove the `?add-accounts=connections` block (`useSearchParams`,
`connectionsVariant`, `clearConnections`, the second `AddAccountDialog`); add state `connectionsOpen`; under the Add
Account button, when `!rail && !notFound && plan`: `<button class="add-account bank-connections">` with `BankIcon` and
`{side.narrow ? "Connections" : "Bank Connections"}`; render `<ManageConnectionsDialog budgetId={plan.id}
onClose={…}/>` when open.

**`apps/web/src/shell/icons.tsx`**: add `TrashIcon`, `LinkIcon`, `ClockIcon` (same `base` props, `aria-hidden`).
**`tokens.css`**: `--labelWarning: #daac00; --calloutWarningSubtleBackground: #362c05;`.
**`global.css`**: `.add-account + .bank-connections { margin-top: 0 }` (or equivalent) so the two sit as a pair.
**`apps/web/src/shell/manage-connections.css`** (new, imported by the dialog): rows (48px min, logo 32px, dot 8px with
a 2px `--backgroundTertiary` ring), group headings (as `.bank-link-bank h3`), badge (`--labelWarning` on
`--calloutWarningSubtleBackground`, `--radius-sm`), every text line `white-space: nowrap; overflow: hidden;
text-overflow: ellipsis; min-width: 0`, the head's title block centred with ellipsis.

**`e2e/support/bank-link-stub.ts`** (additive only): `FakeConnection` gains optional `institution_name`
(default = nickname), `last_reset_at` (default null), `logo` (default null); `connectionJson` uses them. In the
`/bank-connections` handler, before the existing branches:
- `PATCH …/{id}` → nickname = body.nickname.trim() || institution_name, 200 `{data:{bank_connection}}`; or
  `opts.rename` refusal.
- `DELETE …/{id}` → `opts.remove` refusal, else remove the connection and every link to its bank accounts, 200
  `{data:{deleted:true, plaid:"removed"}}`.
- `POST …/{id}/link-token` → `opts.updateToken` refusal, else 200 `link_token: "link-update-test"`.
- `POST …/{id}/reset` → status `connected`, `last_reset_at` now, 200 `{data:{bank_connection}}`.
- `GET …/{id}` → 200 (the screen never calls it; specs assert its absence).
New options `rename?`, `remove?`, `updateToken?: Refusal`. The existing `/bank-connections/link-token` branch must
match only the collection path (`/bank-connections/link-token$`).

**`e2e/manage-connections.spec.ts`**: design cases 1–4 (and 5 in task 1 or after, its stub is
`stubPlaidLink(page, { success: … })` with `newConnection`). Dot colour: compare `getComputedStyle(dot).backgroundColor`
with the resolved `--statusPositive` read from `document.documentElement`.

**Departures in this task:** `e2e/plan-menu.spec.ts` "6 EXF-470" adds `"Manage Bank Connections"` to `enabled`;
`e2e/bank-connections.spec.ts` "the Manage Bank Connections variant …" opens via sidebar `Bank Connections` →
`Add a New Bank Connection`, and after `Back` expects the `Manage Bank Connections` dialog (not "no dialog" / URL).
List both in the report.

## Task 2 — detail and Save

**`apps/web/src/shell/manage-connections-detail.tsx`** (new): `export function ConnectionDetail({ budgetId,
connection, sandbox, onBankAccount, onReset, onRemove, relink })` renders body + footer.
- Banner `<div class="mc-banner" role="note">` per design (three texts as constants), with `Repair` (calls
  `relink.start()`) or `Remove` (calls `onRemove`).
- `<label for="mc-nickname">Nickname</label><input id="mc-nickname" class="account-field" maxLength={100}>`; draft
  resets when `connection.nickname` changes.
- Link section `<h3 class="mc-link-heading"><LinkIcon/>…</h3>` + `<ul>` of `<button class="mc-row mc-bank-row"
  aria-label={bankAccountLabel(...)}>`; third line `Linked to <name>` from `useAccounts`.
- `<h3>Bank Connection Details</h3><dl class="mc-details">` three rows; `<p class="mc-synced">` via
  `syncedLine(fmt, last_synced_at)`.
- `.mc-actions`: `Reset` (`secondary`, `ArrowsCircleIcon`) and `Remove` (`destructive`, `TrashIcon`).
- Footer `Save` (`primary large`), disabled when `draft.trim() === connection.nickname` or pending.
- Save: `useMutation(renameBankConnection)`; success → `setConnectionInCache`, draft = answer's nickname; error →
  `errorDetail` in the shared `error-bar`.
- Helpers in this file: `timeOfDay(iso)` (`new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit"
  }).format(new Date(iso))`), `syncedLine(fmt, iso | null)` → `Last synced ${fmt.date(localToday(new Date(iso)))} at
  ${timeOfDay(iso)}` or `Not synced yet`.

Spec (in `e2e/manage-connections.spec.ts`): design cases 6–7; assert no request matches `GET
/bank-connections/[^/?]+\?`.

## Task 3 — a bank account's options

**`BankLinkAccounts`** (`shell/bank-link-accounts.tsx`): new optional prop `single?: boolean`. When true the host
passes a connection whose `accounts` is the one bank account and `screen="edit"`; the edit screen opens with that
account's draft (initialise `editing`/`draft` from it), and its footer button reads `Add Account` and runs the add
mutation for that id with the draft as override when it differs from the proposal (`chosen` = that row). Errors show
in the `error-bar` on the edit screen. Without `single` nothing changes (existing specs prove it).

**`apps/web/src/shell/manage-connections-bank-account.tsx`** (new):
- `BankAccountOptions({ budgetId, connection, bank, onLinkExisting, onAddNew, onUnlink })`: subline; not linked → two
  `mc-row` buttons `Link to an Existing Account`, `Add as a new Account`; linked → `<p>Linked to "<name>" in this
  plan.</p>` and `<button class="secondary">Unlink</button>`.
- `LinkExistingAccount({ budgetId, bank, onLinked })`: sentence; rows from `useAccounts` where `!closed && !linked &&
  type !== "cash"`, each `name` + `${ACCOUNT_TYPE_LABEL[type]} | ${fmt.money(balance)}`; mutation `linkAccount(budgetId,
  accountId, { bank_account_id: bank.id, today: localToday() })`; success → `invalidateBankLink`, `startPlanSync`,
  `onLinked()`; error → `errorDetail` under the sentence.
- Host views: `bank` (title `bankAccountLabel`), `link` (title `Link to an Existing Account`), `new` (title
  `Account Details`; renders `<BankLinkAccounts single … onDone={toDetail} />`, which supplies body and footer),
  `unlink` (renders only `<UnlinkAccountDialog account={…} onCancel={toBank} onUnlinked={toDetail} />`).

**`e2e/manage-connections-accounts.spec.ts`**: design cases 8–10 (plan accounts made through the API: a checking
`ZZ Linked`, a checking `ZZ Spare`, a cash `ZZ Wallet`, a closed `ZZ Shut`; `links: { [ZZ Linked id]: checking bank id }`).

## Task 4 — Repair, Reset, Remove

**`apps/web/src/shell/manage-connections-relink.ts`** (new):
```ts
export function useConnectionRelink(budgetId: string, connectionId: string, onLinkingChange: (open: boolean) => void):
  { start(): Promise<void>; running: boolean; error: string | null; clearError(): void };
```
Steps exactly as the design's "Reset and Repair": `createUpdateLinkToken` → `loadPlaidLink()` → `create({ token,
onSuccess, onExit }).open()` → on success `finishReset` → `invalidateBankLink` → `syncConnection(...).catch(() =>
undefined).finally(() => invalidateBankLink(...))`. On exit: `plaidExitMessage(err) ?? "The bank sign-in was closed.
Nothing was changed."`. Errors: `ApiError`/`PlaidLoadError` → `e.message`/`errorDetail`. `onLinkingChange(true)` before
`open()`, `false` on success/exit. No `saveLinkState`.

**`apps/web/src/shell/manage-connections-confirm.tsx`** (new): `ConfirmConnectionDialog({ title, text, confirmLabel,
destructive, onConfirm: () => Promise<unknown>, onCancel, onDone })`, modelled on `UnlinkAccountDialog` (own
backdrop, `dialog form edit-account` classes, `role=dialog aria-modal aria-label={title}`, Escape → cancel, Cancel /
confirm in `.dialog-footer`, error-bar with `errorDetail`, confirm disabled while pending).
- Reset: title `Reset Bank Connection`, confirm `Reset` (primary); `onConfirm` resolves at once and the host returns
  to the detail and calls `relink.start()`.
- Remove: title `Remove Bank Connection`, confirm `Remove` (destructive), `onConfirm = removeBankConnection`; done →
  `invalidateBankLink`, list.

Disabled rules in the detail: `const at = resetAvailableAt(connection.last_reset_at)`; `reason = at ? "Reset is
available again on <fmt.date(localToday(new Date(at)))> at <timeOfDay(at)>. A bank connection can be reset once every
24 hours." : status === "broken" ? "This bank connection cannot be reset. Remove it and connect the bank again." :
null`; `Reset` `disabled={!!reason || relink.running}` `title={reason ?? undefined}`; `<p class="mc-reset-note">` with
the reason; `Repair` disabled while `at` or running, same title.

**`e2e/manage-connections-reset.spec.ts`**: design cases 11–13. Separate tests for success
(`stubPlaidLink(page, { success: … })`) and exit (`{ exit: { display_message: null } }`). Order of calls from
`requests` indices. 24-hour: fixture `last_reset_at` = 1 h ago → disabled with the title.

## Task 5 — EXF-773

1. **First** write `e2e/manage-connections-edit-sync.spec.ts` (`test.use({ viewport: { width: 1024, height: 700 } })`,
   `stubBankLink` with one linked account, `afterSync: { delayMs: 600, result: { added: 3 } }`): open Edit Account from
   the sidebar row; assert both buttons' boxes inside `.form-body`'s box (`top ≥ body.top`, `bottom ≤ body.bottom`)
   with `scrollTop === 0`; record `Unlink Account`'s x; click `Sync Now`; while `Syncing…` x is unchanged; then the
   `role="status"` line inside the body's box. Run once on unchanged code; quote the failing line in the report.
2. `account/edit-account.css`: `@media (max-height: 760px)` reductions for `.edit-account` (hr margin, label margin,
   helper margin, `.form-body` gaps; textarea height one row) until step 1 passes; the spacing above 760px untouched.
   `EditAccountDialog.tsx` changes only if the textarea's `rows` must follow (prefer CSS).
3. `account/link-account-section.tsx`: a ref on the result line; `useEffect` on `sync.status` → `ref.current
   ?.scrollIntoView({ block: "nearest" })` when success or error. Sync button content: `<span class="sync-label"><span
   aria-hidden={busy}>Sync Now</span><span aria-hidden={!busy}>Syncing…</span></span>` with CSS `display: inline-grid`,
   both spans in `grid-area: 1 / 1`, the inactive one `visibility: hidden`. Accessible name stays `Sync Now` /
   `Syncing…`.
4. Add a 1440×900 test in the same spec: the dialog's height equals the value measured before the change (record it
   from `9ecd379` in the test as a constant with a comment).
5. Run `e2e/link-account.spec.ts`, `e2e/bank-link-narrow.spec.ts`, `e2e/edit-account.spec.ts`.

## Task 6 — narrow window

**`e2e/manage-connections-narrow.spec.ts`** (1024×700): design case 16. Helpers: `inWindow(locator)` (box within
0..1024 × 0..700), `scrolls(body)` (`scrollHeight > clientHeight`), `cut(text)` (`scrollWidth > clientWidth`,
`text-overflow: ellipsis`, `title` = full text). Fixtures: 30 connections (`ZZ Bank 01`…), one with 14 bank
accounts named with 80 characters, a 100-character nickname. Also the list and detail at 1440×900 lie in the window.

## Docs

`docs/README.md`: one line for the design (with the spec link). The Designer writes `docs/manage-connections-polish.md`.

## Verify (each task)

`pnpm check`; `pnpm e2e e2e/manage-connections*.spec.ts` plus the task's departures (`e2e/plan-menu.spec.ts`,
`e2e/bank-connections.spec.ts`) and, from task 3 on, `e2e/bank-link.spec.ts` (BankLinkAccounts unchanged without
`single`). `git diff --stat origin/main` lists only Manifest paths.
