# Link status: implementation spec (EXF-866 with EXF-867)

Design: [link-status-design.md](link-status-design.md). Commit after each part, in this order. Parts 1 to 3 must be whole. A part that is not finished is reported "not done", never left half done.

The brief's rules for specs and tests hold (`realClick`, exact names, own plan, `expect.poll`, a fault's test run first against the old code with its failing line quoted).

## Interfaces (all parts)

### Migration `apps/worker/migrations/20261116101700_connection_link_status.sql`
```sql
-- EXF-866: Account Not Found on a link; the reason of a connection's last failure; the nightly check's last try.
ALTER TABLE accounts ADD COLUMN link_missing_since text;
ALTER TABLE bank_connections ADD COLUMN sync_error_code text;
ALTER TABLE bank_connections ADD COLUMN login_checked_at text;
```
- Drizzle: `linkMissingSince` in `db/schema/accounts.ts`; `syncErrorCode`, `loginCheckedAt` in `db/schema/bank-connections.ts`. Full row literals add the keys as `null` (the typecheck lists them). Delete `.e2e-state` after.

### `packages/schema/src/plaid-import.ts`
```ts
export const CHECK_AFTER_MS = 20 * 3600_000;
export type StatusReason = "unavailable" | "unsupported" | "reauthorize";
export const REAUTHORIZE_CODES: ReadonlySet<string>; // INVALID_MFA, INSUFFICIENT_CREDENTIALS, PENDING_EXPIRATION, PENDING_DISCONNECT
export function statusReason(status: string, code: string | null): StatusReason | null;
// delayed + INSTITUTION_NOT_AVAILABLE → unavailable; delayed + INSTITUTION_NO_LONGER_SUPPORTED → unsupported;
// login_required + REAUTHORIZE_CODES → reauthorize; anything else → null
export function storedErrorCode(code: string | null): string | null; // /^[A-Z0-9_]{1,64}$/ else null
```

### API fields
- **`packages/schema/src/accounts.ts`, `Account`**, after `last_synced_at`:
  - `connection_reason: z.enum(["unavailable","unsupported","reauthorize"]).nullable().default(null)`;
  - `link_missing_since: z.string().nullable().default(null)`.
  - Each has an `.openapi({ description })` that says what it means and that it is null when not linked.
- **`packages/schema/src/bank-connections.ts`, `BankConnection`**, after `status`:
  - `status_reason: z.enum([...]).nullable().default(null)`, with a description.
- **`services/bank-connections.ts` `toApi`:** `status_reason: statusReason(row.status, row.syncErrorCode)`.
- **`services/accounts.ts` `accountToApi`:**
  - `connection_reason: row.bankAccountId === null ? null : statusReason(row.connectionStatus ?? "", row.connectionErrorCode ?? null)`;
  - `link_missing_since: row.bankAccountId === null ? null : row.linkMissingSince`.
- **`repositories/accounts.ts`:** `AccountReadRow` gains `connectionErrorCode: string | null`, selected as `bankConnections.syncErrorCode` in the same join (line 34). There is no new statement.

### `packages/schema/src/connection-status.ts` (the web's rules)
```ts
export type ShownStatus = LinkStatus | "not_found" | "reauthorize" | "unavailable" | "unsupported";
export function shownStatus(a: { linked: boolean; connection_status: LinkStatus | null;
  connection_reason: StatusReason | null; link_missing_since: string | null }): ShownStatus | null;
export function shownLabel(s: ShownStatus): string;
// connectionLabel for the four; not_found "Linked Account Not Found"; reauthorize "Reauthorization Needed";
// unavailable "Direct Import is Temporarily Unavailable"; unsupported "Connection Unavailable"
export const RELINK_STRIP = "Relink your account to continue importing transactions.";
export const RELINK_DETAILS = "Your linked account is not found. Relink to continue importing transactions.";
export const REAUTHORIZE_STRIP = "Reauthorize your bank connection to continue importing transactions.";
export const UNAVAILABLE_TEXT = "The import service cannot reach this bank at the moment. Budget tries again on its own.";
export const UNSUPPORTED_TEXT = "The import service no longer supports this bank, so new transactions will not be imported.";
export type Strip = { kind: "repair" | "reauthorize" | "not_found" | "broken" | "delayed"; text: string } | null;
export function stripFor(a: /* the Account fields above + closed, last_synced_at */, connectionCreatedAt: string | undefined, nowMs: number): Strip;
export type Popup = { title; line; details; action: "repair" | "reauthorize" | "relink" | null };
export function popupFor(s: ShownStatus, lastSyncedAt: string | null, nowMs: number): Popup;
```
- **`shownStatus`'s order:**
  - not linked → null;
  - `login_required` → `reauthorize` if the reason is `reauthorize`, else `login_required`;
  - `broken`;
  - `link_missing_since` set → `not_found`;
  - `delayed` → the reason (`unavailable` or `unsupported`) or `delayed`;
  - `connected`.
  - A null `connection_status` on a linked account is `broken`, as `linkStatus` has it.
- **`stripFor`:**
  - closed → null;
  - `reauthorize` → `REAUTHORIZE_STRIP`;
  - `not_found` → `RELINK_STRIP`;
  - `unavailable` → like `delayed` (the 3-day line);
  - `unsupported` → null;
  - the rest as today.
- **`popupFor`:**
  - `not_found` → details `RELINK_DETAILS`, action `relink`;
  - `reauthorize` → details `REAUTHORIZE_STRIP`, action `reauthorize`;
  - `unavailable` → `UNAVAILABLE_TEXT`; `unsupported` → `UNSUPPORTED_TEXT`;
  - the line is `Last attempted …` for every status but connected.

### `packages/schema/src/bank-link.ts`
- `connectionLabel("broken")` returns `"Connection Lost"`; `login_required` keeps `"Connection Repair Needed"`.

### `packages/schema/src/manage-connections.ts`
- **`statusLabel(status: string, reason: StatusReason | null = null)`:**
  - a known status with a reason → `shownLabel` of that reason;
  - a known status without one → `connectionLabel`;
  - an unknown status → `Connection Repair Needed` (unchanged).
- **`connectionBadge(status, reason = null)`:** `"Reauthorize"` for `reauthorize`, `"Unavailable"` for `unavailable` or `unsupported`, else as today. The return type widens to match.

### `e2e/support/bank-link-stub.ts`
- `FakeConnection.reason?: "unavailable" | "unsupported" | "reauthorize" | null`, served as `status_reason` (default null) in `connectionJson`, right after `status`.
- `opts.missing?: Record<accountId, string>`, kept in a `Map`.
- `overlay` adds:
  - `connection_reason: conn?.reason ?? null` (null when not linked);
  - `link_missing_since: bank ? (missing.get(id) ?? null) : null`.
- The link route clears the account's entry on POST and on DELETE.
- Times are made as `new Date(Date.now() - h * 3600_000).toISOString()`.

## Part 1: EXF-867 (shell)

1. **The failing spec, new `e2e/link-status-popup.spec.ts`.** Run it before the fix and quote the failing line.
   - **Setup:** a stand-in plan with 30 accounts (`ZZ Acct 01`…`30`, made through the API). `ZZ Acct 01` is linked to a connected connection; the rest are not linked. The page is 1024×700.
   - **A (scroll):** `realClick` the first mark → dialog `Connected`; `page.mouse.move` over the list away from the popup, `page.mouse.wheel(0, 300)`; `expect.poll` `.sidebar-scroll` `scrollTop` > 0; the dialog has count 0.
   - **B (resize):** a click pins it; `page.setViewportSize({ width: 1300, height: 900 })`; count 0.
   - **C (running Repair):** `login_required`, `page.route` holds `**/bank-connections/*/link-token`; click the mark, then `Repair`; wheel and resize; the dialog `Connection Repair Needed` stays; release the route.
   - Cases A and B must fail on `b0240a5`. C passes before and after.
2. **The fix (`apps/web/src/shell/connection-status-mark.tsx`):** `stickyRef.current = relink.running || !!relink.error || !!relink.notice;` `sticky` (with `pinned`) stays for `closeSoon` and `onBlur`.
3. **Connection Lost:** `connectionLabel` in `bank-link.ts`; the detail banner's `<strong>` (`manage-connections-detail.tsx`) becomes `statusLabel(connection.status)` (part 4 adds the reason).
4. **Failing spec for (b), in the same file:** a broken connection's page → `.acct-link-status`, the mark's `aria-label`, the dialog opened by clicking the mark, and the `Bank Connections` row's subtitle all read `Connection Lost`.
5. **Departures** (listed in the report): `e2e/bank-link-status.spec.ts:53-56`, `:68`; `packages/schema/test/bank-link.test.ts:65`; `packages/schema/test/manage-connections.test.ts:21`; and any other `broken` assertion that `grep -rn "Connection Repair Needed" e2e packages apps/*/test` finds.
- **Verify:** `pnpm check`; `pnpm e2e e2e/link-status-popup.spec.ts e2e/connection-status-sidebar.spec.ts e2e/connection-status.spec.ts e2e/bank-link-status.spec.ts e2e/manage-connections-reset.spec.ts`.

## Part 2: migration and Linked Account Not Found in the Worker

1. **The failing test, new `apps/worker/test/link-status-not-found.test.ts`.** Use `setupPlaid` and `stubBank` with an `/accounts/get` override listing three accounts (`acc-chk`, `acc-sav`, `acc-ira`) filtered by a module variable `present` (default all), then `world` and `linked` twice (Checking, Savings); `acc-ira` stays unlinked.
   - With `present = ["acc-chk"]`, `syncOne` → on `GET …/accounts/{savings}`, `link_missing_since` is an ISO string, and checking's is null. Both read `connection_status` `connected`, and `connRow` reads `status` `connected`.
   - Run it on `b0240a5` first: the assertion on `link_missing_since` fails (the field is absent). Quote the line.
   - With `present` all again, `syncOne` → null.
   - `/accounts/get` answering `plaidError(500, "INTERNAL_SERVER_ERROR")` → nothing marked.
   - With the connection set to `login_required` in D1, `syncOne` → nothing marked, 0 Plaid calls.
   - The mark is kept: two syncs without the account → the first time stays.
   - Unlink (`DELETE …/accounts/{id}/link`) → null.
   - Relink: `POST …/link` of the marked Savings account to the `acc-ira` bank account → 200, null, `bank_account_id` the new one, 1 new `account` change_log row.
   - The healthy Checking account → 409, `name` `account_already_linked`.
2. **`repositories/accounts.ts`:**
   - `markMissingStmt(db, connectionId: string, missingBankIds: string[], now: string, guard: SQLWrapper)`:
     ```
     UPDATE accounts SET link_missing_since = CASE WHEN bank_account_id IN (missing) THEN coalesce(link_missing_since, now) ELSE NULL END
     WHERE deleted_at IS NULL
       AND bank_account_id IN (SELECT id FROM bank_accounts WHERE bank_connection_id = :conn)
       AND (link_missing_since IS NULL) = (bank_account_id IN (missing))
       AND EXISTS guard
     ```
     With an empty `missing`, the `IN ()` becomes a false constant.
   - In every `.set({ … bankAccountId … })`, add `linkMissingSince: null`: `setLinkIfStmt`, `unlinkIfStmt`, close at about `:297`, delete at about `:341`, and the statements of `unlinkForConnectionStmts` and of the plan delete (EXF-824).
   - `linkCondition(before, bankAccountId)`: replace `isNull(accounts.bankAccountId)` with `before.bankAccountId === null ? isNull(...) : and(eq(accounts.bankAccountId, before.bankAccountId), isNotNull(accounts.linkMissingSince))`. The other conditions stay.
3. **`services/plaid-sync.ts` final batch:**
   - Compute `missing = bankAccounts.filter(b => !byPlaidId.has(b.plaidAccountId)).map(b => b.id)`.
   - When `linkedRows.length > 0`, push `markMissingStmt(db, row.id, missing, finished, guard)` before the connection's `updateConnectionStmt`, which must stay last (the conflict check reads the last result).
4. **`services/account-links.ts` `linkAccount`:**
   - Refuse with `account_already_linked` only when `before.bankAccountId !== null && before.linkMissingSince === null`.
   - When replacing, the `after` row has `linkMissingSince: null`.
   - The holder check is unchanged.
   - The unlink `after` rows, and `services/budgets.ts`'s, get `linkMissingSince: null`.
5. **Reads:** `accountToApi`, the `Account` schema and `AccountReadRow`, as in Interfaces.
- **Verify:**
  - `pnpm check`;
  - `bank-link-calls.test.ts` `MEASURED` unchanged (list 5, get 5, link 10, unlink 6);
  - `test/schema-drift.test.ts` passes.

## Part 3: Linked Account Not Found on the screens

1. **Icons** (`apps/web/src/shell/connection-status-icon.tsx`): `KeyIcon`, `DiamondAlertIcon`, `OctagonAlertIcon`. They are 16×16 `currentColor` and Budget's own drawing.
   - `LinkStatusIcon({ status: ShownStatus })` in `bank-link-status.tsx` maps: not_found → diamond, reauthorize → key, unavailable and unsupported → octagon; the rest as today.
   - `LinkStatusBadge` uses `shownStatus` and `shownLabel`, with `data-status={shown}` and a `title` equal to the label.
2. **Header** (`apps/web/src/account/AccountHeader.tsx`, `.acct-link-status`): it gets the new label through `LinkStatusBadge`. The CSS adds `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0` (in `account-header.css`).
3. **Strip** (`account/connection-status-strip.tsx`):
   - it uses `shownStatus` and the new `stripFor`;
   - `not_found` has the diamond icon, the text, `Relink` (primary, `.acct-connection-button`) and `Unlink` (secondary, `.acct-connection-button.secondary`), both `flex: none`;
   - `Relink` opens `LinkAccountDialog` (`account/link-account-dialog.tsx`) with `onBack` / `onLinked` closing it;
   - `Unlink` opens `UnlinkAccountDialog` with `onCancel` / `onUnlinked` closing it;
   - a click on the strip's empty area runs `Relink`;
   - the connection query's `enabled` excludes `not_found` and `connected`.
4. **Mark** (`shell/connection-status-mark.tsx`):
   - `s = shownStatus(account)`; `aria-label = shownLabel(s)`;
   - the badge background shows for `login_required`, `reauthorize` and `not_found` (CSS `[data-status]` in `connection-status.css`);
   - popup action `relink` gives two full-width buttons, `Relink` (primary) and `Unlink` (secondary). Each closes the popup and opens its dialog, which the mark renders (state `dialog: "link" | "unlink" | null`);
   - the Tab order is mark → `Relink` → `Unlink`.
5. **Modal row** (`shell/manage-connections-detail.tsx`): in the bank-account row, `plan?.link_missing_since` adds `<span className="mc-line mc-not-found" title="Linked Account Not Found"><DiamondAlertIcon/>Linked Account Not Found</span>`.
6. **Spec, new `e2e/link-status.spec.ts`:**
   - acceptance cases 4, 5, 6 (missing with `login_required`, and with `delayed`) and 7, from the design's states 1, 2 and 6;
   - state 1's `Relink` → choose `ZZ Savings` → `expect.poll` one POST `…/accounts/<id>/link` → the strip has count 0.
- **Verify:** `pnpm e2e e2e/link-status.spec.ts e2e/connection-status*.spec.ts e2e/bank-link*.spec.ts e2e/manage-connections*.spec.ts`.

## Part 4: the stored reason and its words

1. **Failing test, new `apps/worker/test/link-status-reason.test.ts`** (design case 10). `/transactions/sync` answers `plaidError(400, code)` for each code in the table; then:
   `connRow`'s `sync_error_code`, `GET /bank-connections?budget_id=`'s `status_reason` and `GET …/accounts/{id}`'s `connection_reason` follow the table; a good sync, and a `recordFailure` (`failingBatchEnv`), leave the code null.
2. **`services/plaid-sync.ts`:**
   - `storeStatus(db, row, accounts, status, now, code: string | null)`: it writes `syncErrorCode: storedErrorCode(code)`, and returns early only when status, `syncErrorSince` and the code are all unchanged;
   - the catch passes `e.errorCode`; the missing-token call passes null;
   - `recordFailure` sets `syncErrorCode: null`;
   - the final batch's two branches set `syncErrorCode: null`;
   - `updateConnectionStmt`'s `Pick` gains `syncErrorCode` and `loginCheckedAt`;
   - `toApi` `after` copies follow.
3. **`services/bank-connections.ts`:** the reset's update (about `:325-336`) sets `syncErrorCode: null`.
4. **Pure tests, new `packages/schema/test/link-status.test.ts`:** `statusReason` (every table row), `shownStatus` (missing × four statuses × reasons), `stripFor`/`popupFor` new kinds, `statusLabel`/`connectionBadge` with reasons.
5. **Screens:**
   - **Strip:** `reauthorize` has the warning triangle and the button text `Reauthorize`; it runs `relink.start()` exactly as `repair` does.
   - **Popup:** action `reauthorize` → the button `Reauthorize`; the `unavailable` and `unsupported` details.
   - **`manage-connections-dialog.tsx`:** the list row badge is `connectionBadge(c.status, c.status_reason)`, and the subtitle (`:217`) is `statusLabel(connection.status, connection.status_reason)`.
   - **`manage-connections-detail.tsx`:**
     - `badge = connectionBadge(status, status_reason)`;
     - the banner's sentence is `REAUTHORIZE_STRIP`, `UNAVAILABLE_TEXT` or `UNSUPPORTED_TEXT` for those reasons;
     - the Repair button's label is `Reauthorize` when the reason is `reauthorize`;
     - `data-kind` maps `reauthorize` → the repair look and `unavailable` → the delayed look;
     - the banner's icon is the clock for Delayed or Unavailable.
6. **Spec,** appended to `e2e/link-status.spec.ts`: design case 11 (states 3 and 4, and `unsupported`). `Reauthorize` posts `…/link-token`, `…/reset` and `…/sync`, in that order, with `stubPlaidLink(page, OK)`.

## Part 5: the nightly check

1. **Failing test, new `apps/worker/test/link-status-check.test.ts`** (design cases 8 and 9).
   - `run = (env, conn, o) => runSync(env, conn.id, o)`, passed to `syncDueConnections(env, now, run)`.
   - **Good:** a `login_required` connection (set in D1, with `sync_error_since` set) with `feed.pages` holding one entry → after the loop, status `connected`, 1 import, a `bank_connection` change_log row.
   - **Refused:** with `/accounts/get` and `/transactions/sync` answering `plaidError(400, "ITEM_LOGIN_REQUIRED")` → `planCalls` total 1; `status`, `sync_error_since` and `last_synced_at` unchanged; `login_checked_at` set.
   - **Again:** `now` + 1 h → 0 new Plaid calls; `now` + 21 h → 1. **broken** → 0. **Sync Now** on `login_required` → 0.
   - **Order:** `opts.maxRuns: 2` with two due connections and one `login_required` → the check is not run.
   - On `b0240a5` the "good" case fails (status stays `login_required`). Quote the line.
2. **`services/plaid-sync.ts`:**
   - `runSync(env, id, opts: { …; check?: boolean })`.
   - `syncConnection`: `if (NEEDS_REPAIR.includes(row.status) && !(opts.check && row.status === "login_required")) return empty(...)`.
   - After `plaidFor`, when checking: `try { checked = await fetchBalances(plaid, token) } catch (e) { if (!(e instanceof PlaidApiError)) throw e; await bankRepo.checkedStmt(db, row.id, now); return empty(row, "login_required"); }`. The write is one statement (one D1 call).
   - The later `balances = checked ?? await fetchBalances(...)`.
   - `requestSync(env, conn, opts: { check?: boolean } = {})` sends `{ connection_id, check }`.
   - `syncDueConnections(env, now, run, opts)`: after the round-robin, compute `left = maxRuns - runs`. If `left > 0` and there is wall time, read `listToCheck`, and for each connection run `run(env, conn, { check: true })` (counted, wall-checked, try/catch with the same log line).
   - The early `return out` inside the due loop stays, and skips the checks.
3. **`durable/plaid-item-sync.ts`:** read `check` from the body (`=== true`) and call `runSync(this.env, id, { check })`.
4. **`repositories/bank-connections.ts`:**
   - `checkedStmt(db, id, at)`: an UPDATE of `login_checked_at = at` where `id` matches and `status = 'login_required'`;
   - `listToCheck(db, before: string, limit: number)`: `status = 'login_required' AND (login_checked_at IS NULL OR login_checked_at <= before)`, ordered by `login_checked_at IS NOT NULL, login_checked_at, created_at, id`, `LIMIT limit`.
5. **`scheduled.ts`:** no change (it passes `requestSync`, whose new third parameter is optional).

## Part 6: tool texts, call counts, narrow window

1. **`mcp/tools/bank-connections.ts` `FIELDS`:**
   - add `status_reason` to the list;
   - "status_reason refines status: unavailable (delayed: the bank cannot be reached through the import service for now; Budget tries again; nothing to do), unsupported (delayed: the import service no longer supports this bank; imports will not resume; the owner may remove the connection), reauthorize (login_required: the owner must reauthorize with Reauthorize in the app; an agent cannot do it); null otherwise";
   - broken reads "broken (Connection Lost: …)".
2. **`mcp/tool-text.ts` `LINK_STATE`:** add "connection_reason (the connection's status_reason) and link_missing_since (when the bank stopped listing this account's bank account, Linked Account Not Found: imports to it have stopped; the owner relinks it with Link Account, which may replace this link, or unlinks it; when connection_status is login_required or broken, that is shown first)".
3. **`mcp/tools/accounts.ts`:**
   - `link_account`: "an account whose link_missing_since is set may be linked to another bank account without unlinking first";
   - in every account tool, and in `mcp/tools/reconcile.ts`, every `timestamps([...], [...])` holding `last_synced_at` adds `link_missing_since` to both lists.
   - `mcp-descriptions.test.ts` and `mcp-timestamps.test.ts` must pass. Their CALLS are not edited unless a test requires it, and then it is listed.
4. **New `apps/worker/test/link-status-calls.test.ts`** (`countingEnv`, `planCalls`):
   - the two-account sync with two entries = 13 D1 and 2 Plaid;
   - Sync Now on `login_required` = 1 D1 and 0 Plaid;
   - the nightly loop with nothing due and nothing to check = 2 D1;
   - a refused check = 5 D1 and 1 Plaid (pin the measured value and report it if it differs);
   - the account list and get stay at 5 (`bank-link-calls.test.ts` unchanged); the connections list stays at 4.
5. **New `e2e/link-status-narrow.spec.ts`** at 1024×700, for states 1, 3, 4 and 5:
   strip buttons inside the viewport with `scrollWidth <= clientWidth`; `.acct-link-status` uncut, or with an ellipsis and a `title` equal to its text; at states 2 (Tab) and 5 (`realClick`) the popup inside the window.
6. **Docs:** one line in `docs/README.md` (done by the Architect).

## What the Implementer reports
The failing lines before each fix (EXF-867 A and B, parts 2, 4, 5), every edited expectation, the measured D1 counts, and each part as done or "not done".

## Carry-over (second Build): two tasks

Parts 1 to 6 above are built (`c953b12`). This Build does only the two tasks below, each committed by itself, in this order; design: "Carry-over (second Build)". **Never edit the migration file.** Open nothing in the source app.

### Task 1: the name `Linked Account Not Found`
1. **Expectations first** (edit, then run `pnpm exec vitest run packages/schema/test/link-status.test.ts apps/worker/test/connection-status-mcp.test.ts` once against the old label; quote one failing line, e.g. `expected 'Account Not Found' to be 'Linked Account Not Found'`):
   - `packages/schema/test/link-status.test.ts:80` (`shownLabel("not_found")`) and `:123` (the popup's `title`);
   - `apps/worker/test/connection-status-mcp.test.ts:23` → `toContain("Linked Account Not Found")`;
   - `e2e/link-status.spec.ts:51, 56, 100, 108, 129, 150` (`:151` stays). Test titles stay.
2. **Code:**
   - `packages/schema/src/connection-status.ts`: `SHOWN_LABELS.not_found = "Linked Account Not Found"`;
   - `apps/web/src/shell/manage-connections-detail.tsx` (~187): text and `title` from `shownLabel("not_found")` (import from `@budget/schema/connection-status`); no literal left;
   - `apps/worker/src/mcp/tool-text.ts` `LINK_STATE`, `apps/worker/src/mcp/tools/accounts.ts` `link_account`, `packages/schema/src/accounts.ts` `link_missing_since`: the words `Account Not Found` → `Linked Account Not Found`. Comments may follow.
3. **Narrow (`e2e/link-status-narrow.spec.ts`, new expectations, not departures):**
   - test 2: the popup's `strong` has text `Linked Account Not Found` and `scrollWidth <= clientWidth` (or, if it wraps, lies inside the popup);
   - new test `6 Manage Bank Connections: the row's Linked Account Not Found and a broken connection's badge fit at 1024x700`: the plan of design case 7 plus `oneAccountBank("ZZ Gone", "broken", …)`; `openList` → `ZZ Gone`'s `.mc-badge` is whole (`scrollWidth <= clientWidth`) and inside its row's box; `openDetail(page, "ZZ Bank")` → `.mc-not-found` reads `Linked Account Not Found`, is whole or has `text-overflow: ellipsis` with `title` equal to the name, and lies inside the dialog. Use `realClick` for clicks.
4. **Verify:** `grep -rn "Account Not Found" apps packages e2e --include=*.ts --include=*.tsx | grep -v "Linked Account Not Found"` prints only comments, test titles and `link-status.spec.ts:151`; the two vitest files pass.

### Task 2: the broken badge `Connection Lost`
1. **Failing test first:** `packages/schema/test/link-status.test.ts` "names a connection and its badge from the reason" gains `expect(connectionBadge("broken")).toBe("Connection Lost")` and `expect(connectionBadge("weird")).toBe("Repair")`; run it once, quote the failing line (`expected 'Repair' to be 'Connection Lost'`).
2. **`packages/schema/src/manage-connections.ts` `connectionBadge`:** return type `"Repair" | "Reauthorize" | "Connection Lost" | "Delayed" | "Unavailable" | null`; `if (status === "broken") return "Connection Lost";` before the attention branch. `connectionGroup` unchanged.
3. **`apps/web/src/shell/manage-connections-dialog.tsx`:** `data-kind={badge === "Connection Lost" ? "lost" : badge.toLowerCase()}`; `BadgeIcon` unchanged (it falls through to `LinkWarningIcon`).
4. **`apps/web/src/shell/manage-connections-detail.tsx`:** check the banner still gets `data-kind="repair"`, `LinkWarningIcon`, title `Connection Lost`, and no button for broken (it does, by the present expressions; change nothing unless `pnpm check` asks).
5. **New e2e test** in `e2e/link-status.spec.ts`: `C2 the Bank Connections list: a broken connection's badge reads Connection Lost` (`setup` with `z.connection`, `oneAccountBank("ZZ Gone", "broken", …)`, `oneAccountBank("ZZ Locked", "login_required", …)`; assertions as in design C2; `toHaveText` exact; `realClick` on `ZZ Gone` → the detail's `.mc-banner strong` reads `Connection Lost`, and no `Repair` button). Run it once before step 2 and quote its failing line too.

### Task 3: checks
`pnpm check`; `pnpm e2e e2e/link-status.spec.ts e2e/link-status-narrow.spec.ts e2e/link-status-popup.spec.ts e2e/connection-status*.spec.ts e2e/bank-link*.spec.ts e2e/manage-connections*.spec.ts` (expand the globs with `ls` if the runner does not). `git diff c953b12 -- apps/worker/migrations` prints nothing; no file outside the design's manifest or inside its "Out of bounds" list changed.

### What the Implementer reports (this Build)
Every file changed; the failing lines quoted for tasks 1 and 2; each edited expectation as a departure (the design's list); how the name fits at 1024×700 in the header, the popup and the row; the badge's word; the commands run with their results; that it opened nothing in the source app.
