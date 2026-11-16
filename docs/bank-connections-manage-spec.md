# Spec: bank connections read, rename, reset, remove (EXF-460 Worker) + coverage fix (EXF-574)

Design: [bank-connections-manage-design.md](bank-connections-manage-design.md) (behaviour, errors and acceptance
live there; this file is the task list). Worker only: **no file under `apps/web/`**. Never call real Plaid,
never read `PLAID_SANDBOX_SECRET`/`PLAID_PRODUCTION_SECRET`, never run `scripts/plaid-credentials.sh`. Do not
open the source app. After the migration, delete `.e2e-state`.

## T1. Migration and table

- New `apps/worker/migrations/20261116100300_bank_connections_reset.sql`:
  `ALTER TABLE bank_connections ADD COLUMN last_reset_at TEXT;` (nothing else).
- `apps/worker/src/db/schema/bank-connections.ts`: add `lastResetAt: text("last_reset_at")` (nullable) after
  `syncCursor`.
- `createBankConnection`'s row literal gains `lastResetAt: null`.
- Verify: `test/schema-drift.test.ts` passes.

## T2. Schemas (`packages/schema/src/bank-connections.ts`)

- `BankAccount`: add `linked_account_id: z.uuid().nullable().openapi({ description: "The plan account linked to
  this bank account in the given plan; null until linking exists (EXF-461)" })`.
- `BankConnection`: add `last_reset_at: z.string().nullable()`; `status` description becomes
  `"connected (later: other statuses of the sync)"`; keep `z.string()`.
- New:
  ```ts
  export const BankConnectionParams = z.object({ id: z.string().min(1).openapi({ param: { name: "id", in: "path" } }) });
  export const BankConnectionScope = z.object({ budget_id: z.uuid() });            // query of every {id} route
  export const BankConnectionUpdate = z.object({ nickname: z.string().max(100) }).openapi("BankConnectionUpdate");
  export const BankConnectionDeleted = dataEnvelope(
    z.object({ deleted: z.literal(true), plaid: z.enum(["removed", "already_removed"]) }),
  ).openapi("BankConnectionDeletedResponse");
  export type BankConnectionUpdate = z.infer<typeof BankConnectionUpdate>;
  ```
  Reuse `LinkTokenResponse` and `BankConnectionResponse`.

## T3. `secrets/` and tokens (shared module: only this addition)

- `apps/worker/src/secrets/index.ts`: add
  `export function deleteSecretStmt(db: Db, name: string)` → `db.delete(secrets).where(eq(secrets.name, name))`
  (unexecuted; `Db` from `../db/client`). Doc comment: "for a `db.batch`; `deleteSecret` executes alone."
  Change nothing else in the folder.
- `apps/worker/src/plaid/tokens.ts`: add
  `export const deleteAccessTokenStmt = (db: Db, connectionId: string) => deleteSecretStmt(db, accessTokenSecretName(connectionId));`
- Verify: `test/secrets.test.ts` still passes; T7 case 3 shows the row gone.

## T4. Plaid client (`apps/worker/src/plaid/client.ts`)

- Add pure `linkTokenUpdateRequest(e: BankEnvironment, publicHostname: string, accessToken: string)`: build
  `linkTokenRequest(e, publicHostname)`, drop the `products` and `transactions` keys, add `access_token`.
  Result keys: `client_name, language, country_codes, user, access_token` (+ `redirect_uri` for production).
- Add `export const ITEM_GONE_CODES = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);`.
- Verify: unit assertions in T7 (no `products`, `access_token` present, no `webhook`).

## T5. Repository (`apps/worker/src/repositories/bank-connections.ts`)

- `getInEnvironment(db, environment, id): Promise<{row, accounts} | null>`: one connection where
  `id = ? AND environment = ?`, accounts ordered like `listByEnvironment`.
- `connectionExists(db, id)`: `db.select({ one: sql\`1\` }).from(bankConnections).where(eq(bankConnections.id, id))`
  (the guard for `changeLogInsertIf`).
- `updateConnectionStmt(db, id, set: Partial<Pick<BankConnectionRow, "nickname" | "status" | "lastResetAt" | "updatedAt">>)`.
- `deleteAccountsStmt(db, connectionId)` and `deleteConnectionStmt(db, id)`.
- All `*Stmt` return unexecuted statements.

## T6. Service (`apps/worker/src/services/bank-connections.ts`)

- `toApi`: add `last_reset_at: row.lastResetAt` and, per account, `linked_account_id: null`.
- `export class BankConnectionRefused extends Error { constructor(public status: 409 | 502, public code: string, detail: string) }`
  (`name = "BankConnectionRefused"`, message = detail).
- `export const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;`
  `export function resetAvailableAt(lastResetAt: string | null, now = Date.now()): string | null` → null when
  never reset or `now >= Date.parse(lastResetAt) + RESET_INTERVAL_MS`; else that instant as ISO.
- `async function scoped(env, budgetId, id)`: `getBudgetEnvironment` (404 Plan) then `repo.getInEnvironment`;
  `null` → `throw new NotFound("Bank connection")`.
- `getBankConnection(env, budgetId, id): Promise<BankConnection>`.
- `renameBankConnection(env, actor, {budget_id, id, nickname})`: normalise (`trim`, blank →
  `institutionName.slice(0, 100)`); equal to `row.nickname` → return `toApi` unchanged, no write. Else batch
  `[changeLogInsertIf(db, {budgetId: null, actor, action: "update", entityType: "bank_connection", entityId: id,
  before, after}, repo.connectionExists(db, id)), repo.updateConnectionStmt(db, id, {nickname, updatedAt: now})]`;
  then re-read with `scoped` (404 if removed meanwhile) and return it.
- `createUpdateLinkToken(env, budgetId, id)`: `scoped`; `resetAvailableAt` not null → `BankConnectionRefused(409,
  "reset_too_soon", \`This bank connection was reset less than 24 hours ago. Reset is available again after ${at}.\`)`;
  `getAccessToken` null → `BankConnectionRefused(409, "bank_connection_broken", "This bank connection cannot be
  reset. Remove it and connect the bank again.")`; `plaidFor(env, row.environment)` →
  `/link/token/create` with `linkTokenUpdateRequest(...)`; return `{link_token, expiration}`. Writes nothing.
- `finishReset(env, actor, budgetId, id)`: `scoped`; batch `[changeLogInsertIf(... "update" ...),
  updateConnectionStmt(db, id, {status: "connected", lastResetAt: now, updatedAt: now})]`; return re-read.
- `removeBankConnection(env, actor, budgetId, id): Promise<{deleted: true; plaid: "removed" | "already_removed"}>`,
  exactly the steps of the design's "Remove":
  ```ts
  let plaid: "removed" | "already_removed" = "already_removed";
  const token = await getAccessToken(env, id);
  if (token) {
    const client = await plaidFor(env, row.environment);            // PlaidNotSetUp propagates → 422
    try { await client.post("/item/remove", { access_token: token }); plaid = "removed"; }
    catch (err) {
      if (!(err instanceof PlaidApiError)) throw err;
      if (!ITEM_GONE_CODES.has(err.errorCode ?? "")) throw new BankConnectionRefused(502, "plaid_remove_failed",
        "The bank connection could not be removed at Plaid. Nothing was changed. Try again.");
    }
  }
  await db.batch([
    changeLogInsertIf(db, { budgetId: null, actor, action: "delete", entityType: "bank_connection",
      entityId: id, before: toApi(row, accounts), after: null }, repo.connectionExists(db, id)),
    // EXF-461: unlink every plan account linked to this connection here, in this same batch.
    repo.deleteAccountsStmt(db, id),
    repo.deleteConnectionStmt(db, id),
    deleteAccessTokenStmt(db, id),
  ]);
  return { deleted: true, plaid };
  ```
  The `// EXF-461` comment is the documented extension point; keep it verbatim.
- Verify: T7.

## T7. Routes (`apps/worker/src/routes/bank-connections.ts`)

Five new `.openapi(...)` entries after the existing ones (the existing `/bank-connections/link-token` must stay
registered **before** `/bank-connections/{id}` routes; different methods/segment counts, but keep the order).
Each takes `request.query: BankConnectionScope` and `request.params: BankConnectionParams`; errors add
`404: "Plan or bank connection not found"`, `409: "Reset too soon or connection broken"`.

| method, path | body | handler |
| -- | -- | -- |
| `get /bank-connections/{id}` | | `{data:{bank_connection: await getBankConnection(...)}}` 200 |
| `patch /bank-connections/{id}` | `BankConnectionUpdate` (required) | `renameBankConnection(env, actor, …)` 200 |
| `post /bank-connections/{id}/link-token` | none | `createUpdateLinkToken` 200 `LinkTokenResponse`; catch → `refusalOr(c, err)` |
| `post /bank-connections/{id}/reset` | none | `finishReset` 200 `BankConnectionResponse` |
| `delete /bank-connections/{id}` | | `removeBankConnection` 200 `BankConnectionDeleted`; catch → `refusalOr(c, err)` |

- PATCH passes a third argument to `.openapi(route, handler, hook)`: on `!result.success` answer
  `apiError(c, 422, "unprocessable_entity", issues joined by "; ")`. Other routes keep the file's 400 hook.
- `refusalOr(c, err)`: `BankConnectionRefused` → `c.json({error:{id: String(status), name: code, detail: message}}, status)`;
  otherwise `plaidFail(c, err)` (422 not set up, 502 `plaid_error`, else rethrow → `NotFound` → 404 by `onError`).
- Read the actor with `c.get("identity").actor`.
- Verify: `GET /api/v1/openapi.json` lists the 5 new operations; `openapi.test.ts` (not edited) passes.

## T8. MCP tools (`apps/worker/src/mcp/tools/bank-connections.ts`)

- Inputs: `budget_id: Id`, `bank_connection_id: Id`, `nickname: z.string().max(100)`.
- `list_bank_connections`: description adds `display_id`, `provider`, `last_reset_at` and accounts'
  `linked_account_id` (null until linking exists); keep "no secret is ever returned" and `MONEY`.
- `get_bank_connection` → `{ bank_connection }`; `rename_bank_connection` → `{ bank_connection }` (description:
  at most 100 characters, blank uses the bank's name, unchanged writes nothing); both with `MONEY`, both "no
  secret (no access token) is returned".
- `remove_bank_connection` → `{ deleted: true, plaid }`. Description must contain, in substance: "Remove a bank
  connection. This removes it at Plaid (the bank stops sharing data with Budget) and in Budget: the stored
  access token, the connection and its bank accounts. It cannot be undone; connecting the bank again makes a new
  connection. No transaction and no plan account is deleted. If Plaid cannot be reached nothing is removed (tool
  error); try again. Returns { deleted: true, plaid } where plaid is removed or already_removed. No secret is
  returned."
- Each `run` calls the T6 service with `{ env, actor }`; `bank_connection_id` maps to the service's `id`.
- Verify: `mcp-descriptions.test.ts` passes (≥80 chars, `Returns`, `milliunits` + `1000 = one currency unit`
  where balances are returned, id inputs `{type: string, minLength: 1}`). **Do not edit that test.**

## T9. Coverage lines (`apps/worker/test/mcp-coverage/bank-connections.ts`)

Add exactly the five lines of the design's "Coverage lines" section. Nothing else in the folder changes.

## T10. EXF-574 (`apps/worker/test/mcp-coverage.test.ts`)

- In the collect loop keep `const fileOf: Record<string, string> = {}` (`fileOf[op] = file`).
- Export-free pure helper in the file:
  ```ts
  function emptyToolLines(mods: Record<string, CoverageModule>): string[]
  // for each file, each [op, c] with "tool" in c and Array.isArray(c.tool) && c.tool.length === 0 → `${op} (${file})`
  ```
- New `it("no line maps an operation to an empty tool list", …)`: `expect(emptyToolLines(modules), "Coverage lines
  whose tool is an empty list (operation and file). Name the tool(s) in that file of apps/worker/test/mcp-coverage/,
  or use { excluded: reason } (docs/conventions.md step 7).").toEqual([])`.
- New `it("the empty-tool-list check names the operation and file", …)`:
  `expect(emptyToolLines({ "./mcp-coverage/fake.ts": { operations: { "GET /fake": { tool: [] }, "GET /ok": { tool: "x" } } } }))`
  `.toEqual(["GET /fake (./mcp-coverage/fake.ts)"])`.
- Manual bite check (report it, do not commit): add `"GET /bank-connections/{id}": { tool: [] }` in place of its
  line, run `pnpm vitest run apps/worker/test/mcp-coverage.test.ts` (or the worker package's vitest), see the
  failure naming `GET /bank-connections/{id}` and the file; restore the line; rerun green.

## T11. EXF-574 doc (`docs/mcp-coverage-design.md`), two passages only

- **Money rule** ("Description and input rules", the "carries money" bullet): "when its input schema has an
  `integer` property anywhere **other than one named `sort`** (a display position; `NOT_MONEY` in
  `mcp-descriptions.test.ts`), or a 2xx response schema of an operation it maps to (resolving `$ref`) has one
  (same exception)." Adjust the Source bullet on integers (lines ~20–22) to say `sort` is not counted.
- **Categories**: replace the Source bullet "**Category routes are not on main** …" with "Since `325ee94`
  (EXF-494/EXF-495) the category and category-group routes are on main; their tools are
  `create_category_group`, `rename_category_group`, `set_category_group_hidden`, `delete_category_group`,
  `get_category_group_usage`, `create_category`, `rename_category`, `set_category_hidden`, `delete_category`,
  `unhide_all_categories`, `get_category_usage`, mapped in `test/mcp-coverage/categories.ts` and
  `category-groups.ts`." Replace the Downstream bullet "**EXF-494/EXF-495 (categories)**: not on main now …"
  with one line: "**EXF-494/EXF-495 (categories)**: merged as `325ee94` with their tools and coverage lines."

## T12. Tests (`apps/worker/test/bank-connections-manage.test.ts`, new)

Copy the setup of `bank-connections.test.ts` (sentinel `clean`, console spy, `seedSandboxCredentials`, a local
`happy()` handler map, `create(plan)`); don't import from that test file. One `it` per design acceptance case
1–9, plus:
- `expect(await apiPaths()).toEqual(expect.arrayContaining(["/api/v1/bank-connections/{id}",
  "/api/v1/bank-connections/{id}/link-token", "/api/v1/bank-connections/{id}/reset"]))` and the three tool names
  in `listedToolNames()`.
- Network failure in case 5: after `stubPlaid(...)`, override with
  `vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"))` (restored by plaid-stub's
  `afterEach`).
- 24 h boundaries: `UPDATE bank_connections SET last_reset_at = ?` with `now − 24h − 60s` and `now − 24h + 60s`;
  plus a pure `resetAvailableAt` test.
- Production connection seeded by SQL with a random `display_id`/`plaid_item_id` (6 hex / uuid), plus a token
  stored with `storeAccessToken(env, prodId, "ZZ-FAKE-TOKEN")`. With a sandbox plan: 404 on every route and
  `calls.length === 0`. With a production plan (tests are never `ENVIRONMENT=production`): DELETE answers **422
  `bank_connections_not_set_up`**, the row and its secret stay, no Plaid call. Delete seeded rows and the
  secret at the end of the test.
- MCP: `mcpRpc("tools/call", { name, arguments })`; actor check
  `select actor from change_log where entity_id = ? order by created_at desc` → `startsWith("mcp:")`.
- `apps/worker/test/bank-connections.test.ts` needs no change (its assertions use `toMatchObject`); touch it
  only if a new field breaks it.

## Done when

- `pnpm check` passes (foreground).
- `git diff --name-only origin/main` ⊆ the design's Manifest `touches`; nothing under `apps/web/`, no file of the
  Lead's note 9, no `paths.always_overlap` file.
- The report states: routes/tools/coverage lines as built, removal steps and Plaid failure handling, the
  EXF-461 line's location (`removeBankConnection` in `apps/worker/src/services/bank-connections.ts`), the
  `last_reset_at` column and check, `deleteSecretStmt` in `secrets/`, the manual bite check's output, "no real
  Plaid call, no Plaid secret read", and "I did not open the source app."
