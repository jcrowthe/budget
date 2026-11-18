# Connection status: implementation spec (EXF-465 with EXF-824)

Design: [connection-status-design.md](connection-status-design.md). The tasks follow the design's "order of the work". **Commit after
each part** (`EXF-465, EXF-824: <part>`). Before each commit, run `pnpm check` and the specs of that part (`pnpm e2e <specs>`).
Every browser click uses `realClick` (`e2e/support/real-click.ts`). Locators use `{ exact: true }`. Each spec makes its own plan.

## Part 1: EXF-824 in the Worker

### 1a. The failing test first
`apps/worker/test/connection-status-plan-delete.test.ts`:
- Arrange a sandbox plan (`createPlan("sandbox")`, `seedSandboxCredentials`, `stubPlaid` with `/item/public_token/exchange`,
  `/accounts/get` and `/item/remove`, as in `bank-link-calls.test.ts`) and one account made from the bank
  (`createAccountsFromBank`).
- `it("a deleted plan leaves no link: removing the connection writes nothing to it")`: DELETE the plan (REST). Read the delete
  row's `created_at` (`change_log` where `entity_type='budget' and action='delete'`). DELETE the connection
  (`/api/v1/bank-connections/{id}?budget_id=` of a second live plan in the same environment; the route needs a live plan) → 200.
  Then `select count(*) from change_log where budget_id = <deleted> and created_at > <delete row's created_at>` = 0.
- **Run it on the present code first** and quote the failing line in the commit message and the report.
- `it("the delete unlinks every linked account with its history row, in the delete's batch")`: two linked accounts and one
  unlinked one. After the DELETE, `bank_account_id` and `import_start_date` are null for both linked accounts. There are two
  `account` `update` rows with `after.linked === false`, and none of them has `created_at` later than the plan's delete row.
- `it("a link made after the read loses the whole delete")`: call the service with a hook, or, simpler, test the guards
  directly. Build the batch as `deleteBudget` does, then insert a link before running it. Assert that the plan is not deleted and
  that no account was unlinked. (If a direct test of the guard is easier through the repository functions, test
  `linksAsRead` + `softDeleteStmt` alone.)
- `it("leftover links in a plan deleted before this change: removal unlinks them with no history row")`: link an account,
  soft-delete the plan by a direct `update budgets set deleted_at` (Worker tests may), then remove the connection → 200. The
  account is unlinked, and the deleted plan has no new `change_log` row.

### 1b. Repositories
`apps/worker/src/repositories/accounts.ts` (name every column; no positional insert):
```ts
/** The plan's live accounts linked to a bank account, with the link columns (as linkedToConnection). */
export function linkedInPlan(db: Db, budgetId: string): Promise<AccountReadRow[]>;
/** Holds while no live account of the plan is linked except the pairs read (`${id}|${bankAccountId}`). */
export function linksAsRead(budgetId: string, rows: Pick<AccountRow, "id" | "bankAccountId">[]): SQL;
/** SELECT 1 while `before` is still linked as read and the plan's deleted_at = at. */
export function unlinkAfterDeleteHolds(db: Db, before: AccountRow, at: string): SelectQuery;
/** UPDATE accounts SET bank_account_id = NULL, import_start_date = NULL under the same condition. */
export function unlinkAfterDeleteStmt(db: Db, before: AccountRow, at: string): UpdateQuery;
```
`linksAsRead` with no rows is `not exists (… bank_account_id is not null)`. With rows, add `and (id || '|' || bank_account_id) not
in (…)`, one bound parameter per row. Document the bound: at most 90 rows (D1 allows 100 parameters a statement). If a plan has
more, throw `Conflict` before the batch; no plan comes near that.

`apps/worker/src/repositories/budgets.ts` (outside the ground, named in the design): add an optional `extra?: SQL` to
`softDeleteStmt(db, before, at, extra?)` and `existsUnchanged(db, before, extra?)`, ANDed into the `where`. No other change.

### 1c. Service `apps/worker/src/services/budgets.ts` `deleteBudget`
```
const [before, linked] = await Promise.all([repo.findActive(db, id), accountsRepo.linkedInPlan(db, id)]);
if (!before) throw new NotFound("Plan");
const at = new Date().toISOString();
const facts = linked.length ? await accountFacts(db, id) : null;          // services/accounts.ts
const unlinks = linked.flatMap(row => [changeLogInsertIf(db, {budgetId: id, actor, action: "update", entityType: "account",
   entityId: row.id, before: accountToApi(row, facts(row)), after: accountToApi({...row, bankAccountId: null, importStartDate: null}, facts(row))},
   accountsRepo.unlinkAfterDeleteHolds(db, row, at)), accountsRepo.unlinkAfterDeleteStmt(db, row, at)]);   // built FIRST (createdAt)
const guard = accountsRepo.linksAsRead(id, linked);
const [, result] = await db.batch([planDeleteLog(existsUnchanged(db, before, guard)), repo.softDeleteStmt(db, before, at, guard), ...unlinks]);
if (result.meta.changes === 0) await lostRace(db, id);
```
Keep the existing log entry of the plan. Before the plan's `findActive` resolves, the `linkedInPlan` read may return rows of a
deleted plan; that is harmless because the `NotFound` comes first.

### 1d. Removal `apps/worker/src/services/account-links.ts` `unlinkForConnectionStmts`
After `linkedToConnection`, when `rows.length > 0`, read `importsRepo.livePlanIds(db, [...budgetIds])` (import only;
`repositories/imports.ts` is not edited). For a row of a deleted plan, push only `accountsRepo.unlinkIfStmt(db, row)`: no
`balancesOf` and no log row. Live rows stay as they are.

### 1e. D1 calls: `apps/worker/test/connection-status-calls.test.ts`
Copy `counting()` from `bank-link-calls.test.ts` (each file keeps its own). Assert:
`deleteBudget` with 0 linked accounts = 3; with 1 = 6; with 10 linked accounts and 100 transactions = 6. Also assert
`listAccounts` = 5 and `getAccount` = 5 on a plan with a linked account. Before the change, measure the delete once (2) and say
so in the commit.

Verify: `pnpm check` (the Worker tests include `bank-connections*.test.ts`, `account-links.test.ts`, `budgets*.test.ts` and
`bank-link-calls.test.ts`, all unchanged and green).

## Part 2: the strip for `login_required`

### 2a. Pure file `packages/schema/src/connection-status.ts` (no imports from the Worker or the web)
```ts
import { connectionLabel, type LinkStatus } from "./bank-link";
import { reconciledAgo } from "./reconcile";
export const DELAY_LINE_AFTER_MS = 72 * 3600_000;
export const REPAIR_STRIP = "Repair your bank connection to continue importing transactions.";
export const BROKEN_TEXT = "This bank connection cannot be repaired. Remove it and connect the bank again.";
export const DELAY_LINE = "Imports have been delayed for over 3 days. Try Reset in Bank Connections.";
export const REPAIR_TEXT = "Your bank needs you to sign in again before new transactions can be imported.";
export const DELAYED_TEXT = "Your bank or the import service did not answer the last time Budget asked. Budget tries again on its own, so new transactions may arrive late.";
export const CLOSED_NOTICE = "The bank sign-in was closed. Nothing was changed.";
export type Strip = { kind: "repair" | "broken" | "delayed"; text: string } | null;
/** The account page's strip; `connectionCreatedAt` counts a never-synced delay (undefined while unknown). */
export function stripFor(a: { linked: boolean; closed: boolean; connection_status: LinkStatus | null; last_synced_at: string | null },
  connectionCreatedAt: string | undefined, nowMs: number): Strip;
export function delayedOverThreeDays(lastSyncedAt: string | null, createdAt: string | undefined, nowMs: number): boolean;
export function lastCheckedText(lastSyncedAt: string | null, nowMs: number): string; // "Last checked " + reconciledAgo | "Not checked yet"
export type Popup = { title: string; line: string; action: "repair" | null };
export function popupFor(s: LinkStatus, lastSyncedAt: string | null, nowMs: number): Popup;
export type Rect = { left: number; top: number; right: number; bottom: number };
/** Fixed position of the popup: 8 px right of the mark, centred, 8 px inside the window; left of the mark when no room. */
export function placeStatusPopup(mark: Rect, size: { width: number; height: number }, vw: number, vh: number): { left: number; top: number };
```
`stripFor` uses `linkStatus(a)` (`bank-link.ts`), so a linked account with an unknown status counts as `broken`, as the
header does. An unreadable time means no line. Exactly 72 h is no line; more than 72 h is the line.
Tests: `packages/schema/test/connection-status.test.ts`: every row of the design's strip table; 72 h ± 1 ms; never synced
with `createdAt` undefined, 2 days ago and 4 days ago; `lastCheckedText(null)`; `popupFor` for each status; placement at 1440×900
and 1024×700, a mark near the bottom (clamped), and no room on the right (left side).
`manage-connections-detail.tsx` and `manage-connections-relink.ts` import the sentences from here; their text stays the same.

### 2b. The relink hook `apps/web/src/shell/manage-connections-relink.ts`
Return `{ start, running, error, notice, clearError }`. `onExit` with no Plaid message sets `notice = CLOSED_NOTICE` (not
`error`). A Plaid message sets `error`. `start()` and `clearError()` clear both. Nothing else changes: same calls, same order.

### 2c. The connection of an account `apps/web/src/api/bank-link.ts`
```ts
/** The connection holding the account's bank account, from the shared connections read; enabled only when asked. */
export function useAccountConnection(budgetId: string, bankAccountId: string | null, enabled: boolean): { connection: BankConnection | undefined; isLoading: boolean };
```
This is `useBankConnections(budgetId, enabled && !!bankAccountId)` plus a `find` on `c.accounts.some(b => b.id === bankAccountId)`.

### 2d. The strip `apps/web/src/account/connection-status-strip.tsx` + `connection-status-strip.css`
`export function ConnectionStrip({ account }: { account: Account })`, rendered in `AccountHeader` after `<BalanceRow>` (only
there).
- `const s = linkStatus(account)`. The connection is enabled when `account.linked && !account.closed && s !== "connected"`.
- `const strip = stripFor(account, connection?.created_at, now)`, with `now` refreshed every 60 s (as `ReconciledLabel` does).
- Markup: `<div class="acct-connection-strip" data-kind={kind} role="note">` with an icon (`LinkWarningIcon`, or `ClockIcon`
  for delayed), `<span class="acct-connection-text" title={text}>{text}</span>`, and the button. Below it, the message when there
  is one: `<p class="acct-connection-notice" role="status">` or `<p class="error-bar acct-connection-error" role="alert">`.
- Repair: `useConnectionRelink(account.budget_id, connection?.id ?? "", () => {})`. It is disabled while the connection is
  unknown, while `running` (`aria-busy="true"`) and while `resetReason(connection, fmt)` is not null. The reason is the button's
  `title`; put it on a wrapping `<span>` so the tooltip shows on a disabled button.
- CSS: new token `--calloutStripBackground: #292c6c` in `shell/tokens.css`. Strip: `display:flex; align-items:center;
  gap:6px; min-height:48px; padding:8px 16px; box-sizing:border-box; background: var(--calloutStripBackground); color:
  var(--labelPrimary); font-size: var(--font-size-md); font-weight:400`. Icon 16px `flex:none`. Text `flex:1; min-width:0`
  (wraps). Button: the app's primary button, `height:32px; padding:6px 16px; border-radius: var(--radius-lg); font-weight:500;
  min-width:84px; flex:none; white-space:nowrap`. Notice: `background: var(--calloutPrimarySubtleBackground);
  border-radius: var(--radius-lg); padding: var(--space-3); font-size: var(--font-size-sm); font-weight:500; margin: var(--space-2)
  var(--space-3)`.

### 2e. Stand-in `e2e/support/bank-link-stub.ts`
Add `created_at?: string` to `FakeConnection`, served by `connectionJson` as `created_at: c.created_at ?? "2030-01-01T00:00:00Z"`
(`services/bank-connections.ts:39`). Nothing else changes; the overlay already follows `services/accounts.ts:147-148`.

### 2f. Spec `e2e/connection-status.spec.ts` (part 2 cases)
Seed with `setup` / `oneAccountBank` from `e2e/support/manage-connections-seed.ts` (zz `status: "login_required"`, `last_synced_at`
1 h ago), then `page.goto(/<plan>/accounts/<linkedId>)`.
- Acceptance 1. The strip text is `exact`, `getByRole("button", { name: "Repair", exact: true })`, and the header's
  `.acct-link-status` is `Connection Repair Needed`.
- Acceptance 2 (`stubPlaidLink(page, OK)`): `expect.poll` on the stub's requests. The order is link-token < reset < sync, with
  exactly 1 sync. Then the strip has count 0 and `.acct-link-status` is `Connected`.
- Acceptance 3 (closed): `getByRole("status")` has the closed sentence, `getByRole("alert")` has count 0 in `main`, there is no
  `/reset` POST, and the strip is still visible.
- Acceptance 4 (`zz: { last_reset_at: 1 h ago }`): Repair is disabled, and the wrapper's `title` matches `/^Reset is available again on /`.
- Run each new case once against the code before its part's change, and quote the failing line.

## Part 3: `broken` and the 3-day line
- `ConnectionStrip`: for `broken`, show the button `Open Bank Connections`, which opens `<ManageConnectionsDialog budgetId
  initialConnectionId={connection.id} onClose>`. It is disabled until the connection is known.
- `ManageConnectionsDialog` / `Host` (`shell/manage-connections-dialog.tsx`): new optional prop `initialConnectionId?: string`,
  which makes the initial view `{ v: "detail", id }`. Back and Escape go to the list as today.
- Spec cases (`e2e/connection-status.spec.ts`): Acceptance 5, 6 (four sub-cases: 2 d, 4 d, never synced with `created_at` 4 d
  ago, never synced with the default) and 7 (connected, unlinked, closed: `addAccount` + close through the API, and All Accounts:
  `.acct-connection-strip` has count 0).

## Part 4: the sidebar mark's popup
- `apps/web/src/shell/connection-status-mark.tsx` + `connection-status.css` (imported by the mark):
  `export function ConnectionStatusMark({ budgetId, account }: { budgetId: string; account: Account })`. It renders
  `<button type="button" class="nav-link-status" data-status={s} aria-label={connectionLabel(s)} aria-expanded aria-controls>`
  with `<LinkStatusIcon>`, followed by the popup when open: `<div role="dialog" aria-label={title} id class="status-popup"
  style={{left, top}}>` with `<strong>`, `<p>`, the Repair button (`login_required`), and the message (as in 2d).
- State: `open`, `pinned` (a click on the mark, a running Repair or a message). Use a close timer of 200 ms on
  `pointerleave` of the mark and the popup, cleared on `pointerenter`. Open on `focus` of the mark. On `focusout`, close when
  `relatedTarget` is outside both and not pinned. Escape (`keydown` on the mark and the popup): close, unpin, focus the mark,
  `stopPropagation`. A `pointerdown` outside closes. Listen for `scroll` on `.sidebar-scroll` (capture on `document`) and
  `resize` on `window`: close. Position: measure the mark's `getBoundingClientRect()` and the popup's size in a
  `useLayoutEffect`, then call `placeStatusPopup`.
- The popup's connection: `useAccountConnection(budgetId, account.bank_account_id, open && s === "login_required")`.
- `SidebarAccounts.tsx`: delete `LinkedStatus`. Inside the link, `.slot-right` stays empty (it keeps the width). After the
  `NavLink`, inside `.nav-account-row`, render `<ConnectionStatusMark>` when `linkStatus(a)`.
- `bank-link-status.tsx`: `LinkStatusIcon` returns `ClockIcon` for `delayed`.
- CSS (in `connection-status.css`, not `global.css`). `.nav-account-row .nav-link-status`: `position:absolute;
  right:<the slot's right offset>; top:50%; translate: 0 -50%; width:20px; height:20px; padding:0; border:0;
  border-radius: var(--radius-xs); display:flex; align-items:center; justify-content:center; background:transparent;
  cursor:pointer`. When `data-status` is not connected, add `background: var(--buttonSubtleBackground)`. Keep the existing
  colours from `global.css:566-578`, and the focus-visible ring of the app's buttons. Take the right offset from `global.css:548`
  (`.nav-account-link .slot-right`) so the mark sits where the icon sat. `.status-popup`: `position:fixed;
  z-index: var(--z-menu); width:292px; box-sizing:border-box; padding: var(--space-3); border-radius:0.4rem;
  background: var(--backgroundTertiary); box-shadow: var(--shadowMenu)`. Title 14px/700 `--labelPrimary`; line 14px/500
  `--labelSecondary`; button full width, 32px, primary.
- **Departure:** `e2e/bank-link-status.spec.ts:45-52`: `toHaveAttribute("title", X)` → `toHaveAttribute("aria-label", X)` for the
  same three texts. No other line changes.
- Spec cases (`e2e/connection-status-sidebar.spec.ts`): Acceptance 8 (`page.hover` on the mark; `getByRole("dialog", { name:
  "Connected", exact: true })` contains `Last checked an hour ago`; hover the login_required mark, move the mouse onto the
  popup's button, `realClick` → the calls of Acceptance 2), 9 (`page.keyboard.press("Tab")` from the row's link until the mark is
  focused; the dialog is visible; Tab → Repair focused; Escape → the dialog has count 0 and the mark is focused), and 10
  (`realClick` on the row's `.name` → URL is the account's, and no `status-popup` is visible).

## Part 5: the modal's notes and the tool's description
- `manage-connections-detail.tsx`: render `relink.notice` as `<p class="mc-notice" role="status">` in the place of the error bar
  (`error` wins when both are set). `manage-connections.css`: `.mc-notice`, the notice look of 2d.
- The scrim: no change (see the design).
- **Departure:** `e2e/manage-connections-reset.spec.ts:87`, `:211` and `:221`: `getByRole("alert")` → `getByRole("status")`. The
  texts are unchanged.
- `apps/worker/src/mcp/tools/bank-connections.ts`: append the design's status sentence to `FIELDS`. Run
  `mcp-descriptions.test.ts` (in `pnpm check`). Add a Worker test that asserts the `list_bank_connections` description contains
  `login_required (the owner must sign in to the bank again` (Acceptance 12), in `connection-status-plan-delete.test.ts` or a new
  `connection-status-mcp.test.ts`.
- Spec case (Acceptance 11) in `e2e/connection-status.spec.ts`: open the detail from the sidebar's `Bank Connections`, Repair
  with closed → `getByRole("status")` has the sentence, and `getByRole("alert")` has count 0 in the dialog.

## Part 6: the narrow window
`e2e/connection-status-narrow.spec.ts` at `page.setViewportSize({ width: 1024, height: 700 })`:
- States 1, 3 (4 d) and 4: the strip's button `toBeInViewport()`, its box inside `main`'s box, and the text's `scrollWidth <=
  clientWidth`.
- State 5: the popup's box is inside the window (0 ≤ x, x + w ≤ 1024, 0 ≤ y, y + h ≤ 700).
- Narrow sidebar: `page.addInitScript(() => localStorage.setItem("sidebar-preferred-width", "160"))`. Then the mark's box is
  inside its `.nav-account-row` box, and the popup is inside the window. Rail: after the collapse button, `.nav-link-status` has
  count 0.
- Fix what fails (CSS only, in this Build's files).

## Docs
`docs/README.md`: one line for the design (added with this spec). The Designer writes `docs/connection-status-polish.md`.

## Checks before handing over
- `git diff --stat origin/main` shows only the design's `touches`. None of the brief's note 11 out-of-bounds files changed,
  and no shared module outside `apps/web/src/shell/**` changed.
- There is no new dependency and no migration. There is no `PLAID_*` read, no real Plaid call, and no source name in code.
