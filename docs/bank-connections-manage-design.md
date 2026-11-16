# Bank connections: read, rename, reset, remove (EXF-460 Worker half) and MCP coverage fix (EXF-574)

One Build, two tickets, **Worker only**. EXF-460: read one bank connection, rename it, get a Plaid Link
**update-mode** token (24-hour rule), record that update mode finished, and **remove** a connection (Plaid
`/item/remove`, the stored token, the connection and its bank accounts), over REST and MCP. EXF-574: the MCP
coverage test rejects `{ tool: [] }`, and `docs/mcp-coverage-design.md` is corrected in two places.
Spec: [bank-connections-manage-spec.md](bank-connections-manage-spec.md). The Lead's scope notes override the
tickets where they differ. **No file under `apps/web/` changes**; every screen of EXF-460 comes in a later Build.

## Source

Not compared, as the Lead ordered: the source's Bank Connections screen shows the owner's real banks, and this
Build changes no screen. No source study was run, no screenshot exists, and the source app was not opened. The
behaviour comes from the ticket's "Behaviour" and "API and MCP" sections, the Lead's notes and Plaid's
documented API (update mode = `/link/token/create` with `access_token` and no `products`; `/item/remove`).

Evidence from the clone at `41bee46` (read, not run): `routes/bank-connections.ts` has `GET /bank-connections`,
`POST /bank-connections/link-token`, `POST /bank-connections`; its `defaultHook` answers validation errors with
**400**. `services/bank-connections.ts` has `toApi`, `listBankConnections`, `createLinkToken`,
`createBankConnection`. `plaid/tokens.ts` has `get/store/deleteAccessToken` over `secrets/index.ts`
(`setSecret`/`getSecret`/`deleteSecret`, each **executes on its own**; no statement builder). `PlaidApiError`
carries `status` (0 = network/timeout), `errorCode`, `displayMessage`. `changeLogInsertIf` exists in
`history/change-log.ts`. MCP actor is `mcp:<identity actor>` (`mcp/server.ts`). `budgets` routes use `{id}`.

## Approach

Follow `docs/conventions.md`: services `(env, actor, input)`, **one `db.batch` per mutation with its
`change_log` row**, routes and tools found by the globs, one coverage line per operation in the existing
`test/mcp-coverage/bank-connections.ts`. No new dependency, no `env.ts`/`wrangler.jsonc` change.

### Plan scoping (acceptance 9)

Connections belong to the user, not to a plan (their `change_log` rows keep `budget_id` null), but which ones
are visible depends on the plan's `bank_environment`. So **every `/bank-connections/{id}…` route and every new
tool takes `budget_id`** (query parameter in REST), and the lookup is `id = ? AND environment = <plan's
environment>`. A connection of the other environment answers **404 "Bank connection not found"**, exactly like an
unknown id. No route acts on a connection without a plan, so a sandbox plan can never read, rename, reset or
remove a production connection by guessing its id. Plaid calls then use the connection's own `environment`
(equal to the plan's by construction) through `plaidFor`.

### API (paths under `/api/v1`; all new routes take `?budget_id=<uuid>`)

| Operation | Request | 2xx | Errors |
| -- | -- | -- | -- |
| `GET /bank-connections/{id}` | | 200 `{data:{bank_connection}}` | 400, 404 |
| `PATCH /bank-connections/{id}` | `{nickname: string ≤100}` | 200 `{data:{bank_connection}}` | **422** invalid body, 404 |
| `POST /bank-connections/{id}/link-token` | no body | 200 `{data:{link_token, expiration}}` | 404, 409 `reset_too_soon`, 409 `bank_connection_broken`, 422 not set up, 502 |
| `POST /bank-connections/{id}/reset` | no body | 200 `{data:{bank_connection}}` | 404 |
| `DELETE /bank-connections/{id}` | | 200 `{data:{deleted: true, plaid: "removed" \| "already_removed"}}` | 404, 422 not set up, 502 `plaid_remove_failed` |

The `{id}` path parameter is `z.string().min(1)` (like `/budgets/{id}`): a malformed id is a 404, not a 400.
`budget_id` missing or not a uuid: 400 (the file's existing hook), except on PATCH where every validation error
is 422 (see Rename). The update-mode link-token route, like the existing one, answers 200, creates nothing, and
the web will send it no `Idempotency-Key` (the token must not be stored).

### Shape (list and single read)

`BankConnection` gains `last_reset_at` (string | null). `BankAccount` gains `linked_account_id` (always `null`
in this Build; EXF-461 fills it for the plan given). `GET /bank-connections?budget_id=` and
`list_bank_connections` return the same shape through `toApi`. `status` stays a free string (only `connected`
exists today; EXF-462 adds the others without a schema change). Still no token, `plaid_item_id`,
`plaid_account_id`, `sync_cursor` or `updated_at` in any response.

### Rename (`PATCH`)

- Body `{nickname}`, at most **100** characters (raw input). 101 → **422 `unprocessable_entity`**: the PATCH route
  has its own validation hook answering 422; the other routes of the file keep 400.
- Normalised: `nickname.trim()`; empty after trimming → `institution_name.slice(0, 100)`.
- Equal to the stored nickname → **nothing is written** (no row change, no `change_log` row, `updated_at`
  unchanged), 200 with the current object.
- Otherwise one batch: `changeLogInsertIf` (guarded by "connection still exists"; action `update`, entity
  `bank_connection`, `budget_id` null, before/after = API objects) then the `UPDATE … SET nickname, updated_at`.
  A connection removed meanwhile → 404.

### Reset: update-mode token and the 24-hour rule

- **Column** `bank_connections.last_reset_at TEXT NULL` (migration `20261116100300_bank_connections_reset.sql`,
  one additive `ALTER TABLE … ADD COLUMN`; later than the reserved `20261116100100`/`20261116100200`).
- `POST /bank-connections/{id}/link-token`: when `last_reset_at` is set and `now < last_reset_at + 24 h` →
  **409 `reset_too_soon`**, detail `This bank connection was reset less than 24 hours ago. Reset is available
  again after <ISO time>.` Otherwise read the access token (`getAccessToken`); none stored → **409
  `bank_connection_broken`** "This bank connection cannot be reset. Remove it and connect the bank again.". Then
  `/link/token/create` with `linkTokenUpdateRequest(environment, host, accessToken)`: the same body as today's
  `linkTokenRequest` **minus `products` and `transactions`**, plus `access_token` (Plaid update mode); still no
  webhook; `redirect_uri` only for production. Plaid errors: 422 / 502 as today (`plaidFail`). Nothing is
  written.
- `POST /bank-connections/{id}/reset` (the browser calls it after Link's `onSuccess` in update mode): sets
  `status = 'connected'`, `last_reset_at = now`, `updated_at = now` in one batch with a `change_log` update row.
  No Plaid call (update mode needs no token exchange). It is not refused within 24 h (a retry of a reset that
  already succeeded must not fail); the rule lives on the token route, which is what starts a reset. The sync
  after a reset is EXF-462's.
- Pure helper `resetAvailableAt(lastResetAt: string | null): string | null` (null = allowed now) for the rule
  and for EXF-460's screen tooltip later.

### Remove (`DELETE`), step by step

`removeBankConnection(env, actor, {budget_id, id})` in `services/bank-connections.ts`:

1. Resolve the plan's environment and the connection (404 when absent or of the other environment).
2. `getAccessToken`. When a token is stored, call Plaid `POST /item/remove {access_token}` with
   `plaidFor(env, connection.environment)`:
   - **2xx** → `plaid: "removed"`.
   - **`PlaidApiError` with `errorCode` `ITEM_NOT_FOUND` or `INVALID_ACCESS_TOKEN`** (the Item is already gone or
     the token can never work again) → `plaid: "already_removed"`; go on.
   - **Any other `PlaidApiError`** (network failure or timeout = status 0, 5xx, rate limit, invalid API keys,
     …) → throw `BankConnectionRefused(502, "plaid_remove_failed", "The bank connection could not be removed at
     Plaid. Nothing was changed. Try again.")`. **Nothing is removed.**
   - **`PlaidNotSetUp`** (no credentials for that environment; production outside the live Worker) → 422
     `bank_connections_not_set_up`; nothing removed.
   - **No token stored** (only after an earlier fault) → no Plaid call possible; `plaid: "already_removed"`; go on.
3. **One `db.batch` — the single removal place**, built in `removeBankConnection` in this order:
   `changeLogInsertIf` (action `delete`, entity `bank_connection`, `budget_id` null, actor, `before` = the API
   object, `after` null; guarded by "connection still exists", so a lost race logs nothing) →
   **`// EXF-461: unlink every plan account linked to this connection here, same batch`** →
   `DELETE bank_accounts WHERE bank_connection_id = id` → `DELETE bank_connections WHERE id = id` →
   `deleteAccessTokenStmt(db, id)` (the stored token, via the new `secrets` statement builder).
4. Answer 200 `{data:{deleted: true, plaid}}`. No transaction, no plan account, no plan is touched.

**Never stuck**: if Plaid removed the Item but the batch failed, a retry gets `ITEM_NOT_FOUND`/
`INVALID_ACCESS_TOKEN` and completes the local removal. A second `DELETE` after success → 404.

### `secrets/` (shared module, Lead's note 7)

Add **`deleteSecretStmt(db: Db, name: string)`**: the unexecuted `DELETE FROM secrets WHERE name = ?`, so the
token's deletion joins the removal batch (atomic with the rows and the log). Nothing else in `secrets/` changes.
`plaid/tokens.ts` gains `deleteAccessTokenStmt(db, connectionId)` over it.

### Errors

Service class `BankConnectionRefused(status: 409 | 502, code, detail)` (like `TransactionRefused`); the route
maps it to `{error:{id, name: code, detail}}`; in MCP it is a tool error with the detail as message.
`NotFound("Bank connection")` → 404 "Bank connection not found".

### MCP (`mcp/tools/bank-connections.ts`)

| Tool | Input | Returns |
| -- | -- | -- |
| `list_bank_connections` (changed description) | `budget_id` | `{bank_connections}` (new shape) |
| `get_bank_connection` | `budget_id`, `bank_connection_id` | `{bank_connection}` |
| `rename_bank_connection` | `budget_id`, `bank_connection_id`, `nickname` (≤100) | `{bank_connection}` |
| `remove_bank_connection` | `budget_id`, `bank_connection_id` | `{deleted: true, plaid}` |

Ids are `Id` from `tool-text.ts`. Descriptions start with what the tool does, say what it returns
(`Returns { … }` with main fields), say **no secret (no access token) is returned**, and include `MONEY` for the
three tools whose result carries balances. `remove_bank_connection` says plainly: **it removes the bank
connection at Plaid as well as in Budget and cannot be undone**; no transaction or plan account is deleted.
No tool for the update-mode token or the reset call (browser-only).

### Coverage lines (`apps/worker/test/mcp-coverage/bank-connections.ts`)

```
"GET /bank-connections/{id}": { tool: "get_bank_connection" }
"PATCH /bank-connections/{id}": { tool: "rename_bank_connection" }
"DELETE /bank-connections/{id}": { tool: "remove_bank_connection" }
"POST /bank-connections/{id}/link-token": { excluded: "update-mode token for Plaid Link, which runs only in a browser" }
"POST /bank-connections/{id}/reset": { excluded: "records the end of Plaid Link update mode, which runs only in a browser" }
```

### EXF-574

- `mcp-coverage.test.ts`: remember the file of each operation while collecting; a pure function
  `emptyToolLines(modules)` returns `"<operation> (<file>)"` for every line whose `tool` is an empty array; a new
  `it` expects `[]` from the real modules with a message telling to name a tool or use `{ excluded: reason }` in
  that file; a second `it` feeds a synthetic module with `{ tool: [] }` and expects the operation named (the check
  bites, permanently). The Implementer also adds a temporary `{ tool: [] }` line to a real coverage file, runs
  the test, sees it fail naming the operation, and removes the line (reported, not committed).
- `docs/mcp-coverage-design.md`: (a) the "carries money" rule (Description and input rules) says an integer
  property **named `sort` does not count** (display position, `NOT_MONEY` in `mcp-descriptions.test.ts`); the
  Source line about `sort` matches. (b) The "Category routes are not on main" premise in Source and the
  EXF-494/EXF-495 bullet in Downstream are replaced with the present state: since `325ee94` the category and
  category-group routes are on main with their tools (`create/rename/set_hidden/delete/get_usage` for groups and
  categories, `unhide_all_categories`) and their lines in `test/mcp-coverage/categories.ts` and
  `category-groups.ts`. Nothing else in that doc changes.

## Downstream

- **EXF-460 screens** (later Build): list via `GET /bank-connections?budget_id=`, detail via the single read,
  Save via PATCH, Reset via the update-mode token + Plaid Link + `POST …/reset` (grey out while
  `resetAvailableAt(last_reset_at)` is in the future; tooltip from the 409 detail), Remove via DELETE with its
  confirmation.
- **EXF-461**: fills `linked_account_id` for the given plan and adds its unlink statement at the marked line in
  `removeBankConnection`'s batch.
- **EXF-462**: adds statuses (Repair, Delayed …) as plain strings; decides whether Repair is exempt from the
  24-hour rule; runs a sync after `POST …/reset`.
- Agents see three new tools; `list_bank_connections` keeps its name and input, its result gains two fields.

## Out of scope

Every file under `apps/web/`; every screen and dialog of EXF-460; linking (EXF-461); sync and statuses other than
`connected` (EXF-462); any Plaid webhook; the files of note 9 (accounts, transactions, payees, months, moves,
categories, reports, `packages/core`, `durable/`, other tool and coverage files, `mcp-descriptions.test.ts`,
`openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, every e2e spec, every `paths.always_overlap` file).

## Acceptance

All cases are **Worker tests** (`apps/worker/test/bank-connections-manage.test.ts`, run by `pnpm check`) with
Plaid stubbed by `stubPlaid` from `test/plaid-stub.ts` and the `SENTINEL` values; no real Plaid call, no Plaid
secret read. No compare case: no screen changed and the source is forbidden.

1. **(EXF-460) Read.** Sandbox plan, create a connection (stub). `GET /bank-connections/{id}?budget_id=` →
   200 with `display_id`, `nickname`, `institution_name`, `status` `connected`, `provider` `Plaid`,
   `last_synced_at` null, `last_reset_at` null, 2 accounts each with `linked_account_id: null`. The list
   route's entry for that id deep-equals it. Unknown id → 404. Response text holds no sentinel.
2. **(EXF-460) Rename.** PATCH `{nickname: "ZZ Renamed"}` → 200 with it; list and single read show it; one
   `change_log` row `update`, `bank_connection`, actor `user:tester@localhost`, `budget_id` null, before/after
   nicknames. PATCH `"   "` → nickname = institution name. PATCH with the current nickname → 200, **no new
   `change_log` row**, `updated_at` unchanged. 100 chars → 200; **101 chars → 422**.
3. **(EXF-460) Remove.** Stub `/item/remove` 200. DELETE → 200 `{deleted: true, plaid: "removed"}`. The stub
   saw **one** `/item/remove` call, to `sandbox.plaid.com`, body `access_token` = `SENTINEL.accessToken`. No
   `secrets` row `plaid_access_token:<id>`; no `bank_connections` row; no `bank_accounts` row for it; absent from
   the list; one `change_log` row `delete` with `before_json` holding the nickname and no sentinel. Second
   DELETE → 404.
4. **(EXF-460) Remove, Item already gone.** Stub `/item/remove` 400 `{error_code: "ITEM_NOT_FOUND"}` → 200
   `plaid: "already_removed"`; everything of case 3 removed. Same with `INVALID_ACCESS_TOKEN`.
5. **(EXF-460) Remove, Plaid fails.** Stub `/item/remove` 500 `INTERNAL_SERVER_ERROR`, and separately a `fetch`
   that throws (network) → 502 `plaid_remove_failed`, detail "The bank connection could not be removed at
   Plaid. Nothing was changed. Try again."; connection, accounts, secret row unchanged; no `delete` log row.
   A following DELETE with a 200 stub succeeds.
6. **(EXF-460) Update-mode token and 24 h.** `POST …/{id}/link-token?budget_id=` → 200 `link_token`; the stub's
   `/link/token/create` body has `access_token` = `SENTINEL.accessToken`, **no `products` key**, no `webhook`,
   no `redirect_uri`. `POST …/{id}/reset` → 200, `status` `connected`, `last_reset_at` set, one `update` log
   row. Then the token route → **409 `reset_too_soon`** and the stub saw no new call. With `last_reset_at` set
   in D1 to 24 h + 1 min ago → 200 again; 23 h 59 min ago → 409. Response bodies hold no sentinel and the
   `idempotency_keys` table holds none.
7. **(EXF-460) MCP.** `list_bank_connections` returns the same objects as the REST list (deep-equal for the
   test connection) and no sentinel. `get_bank_connection` equals the REST read. `rename_bank_connection` and
   `remove_bank_connection` behave like PATCH and DELETE (Plaid stubbed) and write `change_log` rows whose actor
   starts with `mcp:`. Unknown id → `isError` "Bank connection not found". `tools/list` offers the three new
   tools; `mcp-coverage.test.ts` and `mcp-descriptions.test.ts` pass unchanged (the latter not edited).
8. **(EXF-460) Environments.** A seeded **production** connection: GET, PATCH, link-token, reset and DELETE
   with a **sandbox** plan's `budget_id` → 404 each, the row unchanged, no Plaid call; it is absent from the
   sandbox plan's list. A sandbox connection with a production plan → 404 likewise.
9. **(EXF-460) No leak.** Across cases 1–8 every response, MCP result, `change_log` row, `idempotency_keys` row
   and console line is free of every `SENTINEL` value (the existing `clean` check and console spy).
10. **(EXF-574) Empty tool list.** The synthetic-module test returns `["GET /x (fake.ts)"]`-style output naming
    the operation and file. Implementer's manual check: a temporary `"GET /bank-connections/{id}": { tool: [] }`
    makes `mcp-coverage.test.ts` fail with a message containing `GET /bank-connections/{id}` and the file path;
    removed again.
11. **(EXF-574 / both) Gate.** `pnpm check` passes with the committed coverage files. `git diff --stat
    origin/main` lists no file under `apps/web/` and none of note 9's files.
12. **(EXF-574) Doc.** `docs/mcp-coverage-design.md` states the `sort` exception in the "carries money" rule and
    the present category tools, and no longer says category routes are not on main.

## Manifest

touches: [apps/worker/migrations/20261116100300_bank_connections_reset.sql, apps/worker/src/db/schema/bank-connections.ts, apps/worker/src/repositories/bank-connections.ts, apps/worker/src/services/bank-connections.ts, apps/worker/src/routes/bank-connections.ts, apps/worker/src/plaid/**, apps/worker/src/secrets/index.ts, apps/worker/src/mcp/tools/bank-connections.ts, packages/schema/src/bank-connections.ts, apps/worker/test/bank-connections-manage.test.ts, apps/worker/test/bank-connections.test.ts, apps/worker/test/mcp-coverage/bank-connections.ts, apps/worker/test/mcp-coverage.test.ts, docs/mcp-coverage-design.md, docs/bank-connections-manage-design.md, docs/bank-connections-manage-spec.md, docs/README.md]
shared: [apps/worker/src/secrets/index.ts: adds deleteSecretStmt(db, name), an unexecuted delete, so the stored access token is deleted in the same batch as the connection, its bank accounts and the change_log row; nothing else in secrets/ changes. Sensitive, not shared: apps/worker/migrations/20261116100300_bank_connections_reset.sql (one additive ADD COLUMN last_reset_at).]
migrations: 1
