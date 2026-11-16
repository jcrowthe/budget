# MCP coverage design (EXF-572)

An MCP tool for every REST operation, a test that enforces it, and tool descriptions an agent can use.
Worker-only: MCP tool files, tests and `docs/conventions.md`. No interface, no REST change, no migration.

## Source

Not compared, as the Lead ordered: there is nothing to compare. The feature exists only in the clone. The
reference is the owner's requirement ("everything the app can do over REST is also available as an MCP tool")
plus the ticket's audit. No source study was run and there are no screenshots.

Evidence from the clone at `2d1982e`, gathered with a throwaway vitest probe (deleted):
- `/api/v1/openapi.json` has **31 operations** (the ticket counted 28 at `82aac3a`; `2d1982e` added
  `GET accounts/{account_id}`, `GET /account-summary` and the plan-wide `GET /transactions`). The document
  does not list `/api/v1/openapi.json` itself.
- `tools/list` has 15 tools. Two take `budget_id` as `format: uuid` (`list_bank_connections`, `set_month_note`);
  the others take `{type: string, minLength: 1}`. `create_transaction` and `update_transaction` offer
  `cleared` with `enum: [uncleared, cleared, reconciled]`.
- In `tools/list` input schemas, a `Month` field is `allOf` patterns, one of them ending in `-01$`; a date
  field has pattern `^\d{4}-\d{2}-\d{2}$` and none ending in `-01$`; a `Milliunits` field is `type: integer`.
  In the OpenAPI document, money fields are `{type: integer}`; the only other integers (`sort`, target
  `percent`, `every`, `day_of_*`) sit only in objects that also carry money.
- A tool that throws answers `result.isError: true` with the error message in `content[0].text`. This holds
  for input validation (`Input validation error: … budget_id: Invalid UUID`) and for services' `NotFound`
  (`Plan not found`). Unknown ids never crash the server.
- **Category routes are not on main** (`ls apps/worker/src/routes` has no categories file; `origin/main` is
  `2d1982e`).

## Approach

1. Add the missing tools in their resource's tool file, each a thin call to the existing service, returning
   the REST operation's `data` object (the existing convention: `list_budgets` returns `{ budgets }`).
2. A coverage mapping, `apps/worker/test/mcp-coverage-map.ts`, holds one line per REST operation (tool name,
   or an exclusion with its reason), plus the short list of tools that have no single REST operation. A test,
   `mcp-coverage.test.ts`, compares it with the OpenAPI document and `tools/list` both ways.
3. A description test, `mcp-descriptions.test.ts`, checks each listed tool mechanically, from its `tools/list`
   input schema and from the OpenAPI response schema of the operations it maps to: no hand-kept list of tools.
4. One small new module, `apps/worker/src/mcp/tool-text.ts`, holds the shared id schema and the three
   sentences (money, month, date), so every tool says them the same way. It is outside `mcp/tools/` (the
   tool glob would require it to export tools) and is not a shared module in the profile.
5. Rewrite every description to the rules, and make ids and `cleared` consistent.

## What changes

### New tools

| Tool | File | Input | Returns (the REST `data`) | Service |
| -- | -- | -- | -- | -- |
| `get_budget` | budgets.ts | `budget_id` | `{ budget }` | `getBudget` |
| `update_budget` | budgets.ts | `budget_id`, `name?`, `bank_environment?` | `{ budget }` | `updateBudget` |
| `delete_budget` | budgets.ts | `budget_id` | `{ deleted: true }` | `deleteBudget` |
| `get_account_summary` | accounts.ts | `budget_id` | `{ balances: { cleared, uncleared, working } }` | `getAccountSummary` |
| `get_transaction` | transactions.ts | `budget_id`, `transaction_id` | `{ transaction }` (detail) | `getTransaction` |
| `list_plan_months` | months.ts | `budget_id`, `from`, `to` | `{ months: MonthSummary[] }` | `listPlanMonths` |
| `get_month_range` | months.ts | `budget_id` | `{ first_month, last_assigned_month }` | `getMonthRange` |

- `update_budget` leaves `opened` out: recording that a plan was opened is the interface's job, not a change.
- `get_account_summary` is **not in the Lead's list**: `GET /budgets/{budget_id}/account-summary` came with
  `2d1982e` and has no tool. It is the plan-wide totals the All Accounts header shows; a tool is one line over
  an existing service, so it gets one rather than an exclusion.
- `list_plan_months` composes the route's range rule in the tool file (the rule lives in the route, not the
  service): `to` before `from`, or a span of 120 months or more, is a tool error with the route's message.
- `get_account` (since `2d1982e`) is kept: it calls `getAccount` and returns `{ account }`, the same as
  `GET accounts/{account_id}`. `list_transactions` without `account_id` calls `listPlanTransactions`, the
  same as `GET /budgets/{budget_id}/transactions`. Both are asserted against REST in the new test.

### The mapping (`apps/worker/test/mcp-coverage-map.ts`)

Keys are `METHOD path`, the path relative to `/api/v1` exactly as in the route file.

| Operation | Tool or exclusion |
| -- | -- |
| `GET /health` | excluded: service plumbing |
| `GET /openapi.json` | excluded: service plumbing (the document itself; not listed in it) |
| `GET /me` | excluded: describes the caller (another Build adds the route) |
| `GET /plaid/credentials`, `PUT /plaid/credentials` | excluded: secrets are never handled by an agent |
| `POST /bank-connections/link-token`, `POST /bank-connections` | excluded: need Plaid Link in a browser |
| `GET /institutions`, `GET /institutions/popular` | excluded: serve the bank search of that browser flow |
| `GET /budgets/{budget_id}/ui-state`, `PUT …/ui-state` | excluded: interface state |
| `GET /budgets` | `list_budgets` |
| `POST /budgets` | `create_budget` |
| `GET /budgets/{id}` | `get_budget` |
| `PATCH /budgets/{id}` | `update_budget` (note: `opened` is left out, it is the interface recording an open) |
| `DELETE /budgets/{id}` | `delete_budget` |
| `GET /budgets/{budget_id}/accounts` | `list_accounts` |
| `POST /budgets/{budget_id}/accounts` | `create_account` |
| `GET /budgets/{budget_id}/accounts/{account_id}` | `get_account` |
| `PATCH /budgets/{budget_id}/accounts/{account_id}` | `update_account` |
| `GET /budgets/{budget_id}/account-summary` | `get_account_summary` |
| `GET /budgets/{budget_id}/accounts/{account_id}/transactions` | `list_transactions` (with `account_id`; note: `sort`/`dir` left out, display order) |
| `GET /budgets/{budget_id}/transactions` | `list_transactions` (without `account_id`; same note) |
| `GET /budgets/{budget_id}/transactions/{transaction_id}` | `get_transaction` |
| `POST /budgets/{budget_id}/transactions` | `create_transaction` |
| `PATCH /budgets/{budget_id}/transactions/{transaction_id}` | `update_transaction` |
| `DELETE /budgets/{budget_id}/transactions/{transaction_id}` | `delete_transaction` |
| `GET /budgets/{budget_id}/months` | `list_plan_months` |
| `GET /budgets/{budget_id}/months/{month}` | `get_plan_month` |
| `PATCH /budgets/{budget_id}/months/{month}` | `set_month_note` |
| `GET /budgets/{budget_id}/month-range` | `get_month_range` |
| `PATCH /budgets/{budget_id}/months/{month}/categories/{category_id}` | `set_assigned` |
| `GET /bank-connections` | `list_bank_connections` |

Tools without a single REST operation: `get_account_balances` (its figures are inside the account read and
the account's transactions list).

### The coverage test (`apps/worker/test/mcp-coverage.test.ts`)

Fails, naming what is wrong and what to do, when:
1. an operation of the OpenAPI document has no mapping line (message: add the tool and one line in the
   mapping file, or an exclusion with its reason; see `docs/conventions.md` step 7);
2. a mapped tool is not in `tools/list` (lists `METHOD path → tool`);
3. a tool mapping names an operation the document does not have (stale line). Exclusions are exempt, so
   `GET /me` and `GET /openapi.json` may name paths that are absent;
4. a listed tool maps to no operation and is not in `toolsWithoutOperation`;
5. a `toolsWithoutOperation` entry is not listed, or also maps to an operation;
6. an exclusion reason or a note is shorter than 10 characters.

It does not make any check of `openapi.test.ts`, `mcp.test.ts` or `e2e/mcp.spec.ts` redundant: those check
the globs and `tools/list` against the tool files; this checks REST against MCP. None of them is edited.

### Description and input rules (all tools, checked by `mcp-descriptions.test.ts`)

One `it` per tool name, from `toolFileNames()`; the tool's description and JSON input schema come from
`tools/list`. A tool:
- has a description of at least 80 characters that contains the word `Returns`, followed by the object and
  its main fields;
- **carries money** when its input schema has an `integer` anywhere, or a 2xx response schema of an
  operation it maps to (resolving `$ref`) has one. Then the description contains `milliunits` and
  `1000 = one currency unit`;
- with an input whose patterns include one ending in `-01$` (a month), contains `YYYY-MM-01`; with an input
  whose pattern is `^\d{4}-\d{2}-\d{2}$` and is not a month, contains `YYYY-MM-DD`;
- takes every `id` or `*_id` input as `{ type: string, minLength: 1 }` (nullable allowed), with no `format`
  and no `pattern`. **The id rule:** a non-empty string that the service resolves; an unknown or malformed id
  answers a tool error (`… not found`).

Plus, tested by hand in `mcp-tools.test.ts`: `cleared` in `create_transaction` and `update_transaction`
offers exactly `uncleared`, `cleared` (it uses `PlainClearedStatus`); `delete_transaction` has its own
sentence (a reconciled transaction cannot be deleted); `create_budget` says new plans start with the default
groups and categories and what `bank_environment` means.

Two id fixes follow: `list_bank_connections` and `set_month_note` take `Id` instead of `z.uuid()`.
`set_month_note`'s service parses `budget_id` as a uuid, so the tool first answers `NotFound("Plan")` for an
id that is not a uuid (same as `set_assigned`'s service does), rather than surfacing a Zod message.

### Conventions

`docs/conventions.md` step 7 and step 10 gain the rule (wording in the spec): a new REST operation comes with
its MCP tool and one mapping line, or an exclusion line with its reason; the description rules above.

## Downstream effects

- Every later Build that adds a route adds a mapping line and its tool, or `mcp-coverage.test.ts` fails
  `pnpm check` naming the operation. A Build that adds a tool with no REST operation adds a
  `toolsWithoutOperation` entry.
- Every later tool must meet the description rules or `mcp-descriptions.test.ts` fails on that tool's name.
- **EXF-494/EXF-495 (categories)**: not on main now. If they land before this Build's last rebase, the
  Implementer adds their mapping lines (task 8 of the spec). If not, the Lead has that Build add its lines;
  its tools must also pass the description test.
- **The `/me` Build**: its exclusion line is already present; it adds nothing to the mapping.
- Agents see new tools and new descriptions in `tools/list`. Tool names that existed are unchanged; inputs
  change only by widening (`budget_id` accepts any non-empty string) and by narrowing `cleared` (a value that
  was always refused is no longer offered).

## Out of scope

- Everything under `apps/web/`; every route, service and repository; `packages/**`; migrations.
- `apps/worker/src/mcp/server.ts`, `mcp/types.ts` (shared modules): no `outputSchema` is added to tools.
- `openapi.test.ts`, `mcp.test.ts`, `existing-surface.test.ts`, `e2e/mcp.spec.ts`, `test/surface.ts`.
- `sort`/`dir` on `list_transactions` (display order, noted in the mapping) and `opened` on `update_budget`.
- Any `paths.always_overlap` file. No new dependency.

## Acceptance

All cases run in `/workspace/repo`. No source app and no screenshots (forbidden by the Lead; nothing to
compare). Revert every temporary edit; at the end `git status --short` shows none of them.

1. **Check passes.** `pnpm check` exits 0; its output includes `mcp-coverage`, `mcp-descriptions` (one test
   per tool, 22 tools) and `mcp-tools` tests, all passing.
2. **The tools are listed.** In `mcp-tools.test.ts`, `tools/list` contains `get_budget`, `update_budget`,
   `delete_budget`, `get_account`, `get_account_summary`, `get_transaction`, `list_plan_months`,
   `get_month_range`, and 22 tools in total.
3. **Same data as REST.** For a seeded plan with an account and a transaction, each of `get_budget`,
   `get_account`, `get_account_summary`, `get_transaction`, `list_plan_months` (`from` = `to` - 2 months),
   `get_month_range`, `list_transactions` with and without `account_id`, returns `structuredContent` equal
   to the REST operation's `data` for the same input.
4. **Writes are logged with an `mcp:` actor.** `update_budget` (rename, then `bank_environment: "sandbox"`)
   returns `{ budget }` equal to a REST `GET /budgets/{id}` afterwards, and a `change_log` row
   (`entity_type` `budget`, `action` `update`) with actor `mcp:user:tester@localhost`. `delete_budget`
   returns `{ deleted: true }`; REST `GET /budgets/{id}` then answers 404; a `change_log` row with
   `action` `delete` and the same actor exists.
5. **Tool errors, not crashes.** `delete_budget` with a random uuid, and with `not-a-plan`, answers
   `result.isError: true` with text containing `not found` (case-insensitive). `get_transaction` with plan B's
   id and plan A's transaction id answers `isError: true`, `not found`. `list_plan_months` with `to` before
   `from` answers `isError: true`. `set_month_note` and `list_bank_connections` with `budget_id: "not-a-plan"`
   answer `isError: true`, `not found`.
6. **`cleared` offers only accepted values.** In `tools/list`, `create_transaction` and `update_transaction`
   have `inputSchema.properties.cleared.enum` equal to `["uncleared", "cleared"]`; `create_transaction` with
   `cleared: "reconciled"` answers `isError: true` and adds no transaction row.
7. **`update_budget` has no `opened`.** Its `tools/list` input schema properties are exactly `budget_id`,
   `name`, `bank_environment`.
8. **Descriptions.** `grep -n "cannot be changed" apps/worker/src/mcp/tools/transactions.ts` shows the
   sentence used by `update_transaction` only; `delete_transaction`'s description says a reconciled
   transaction cannot be deleted. `create_budget`'s description contains `Bills`, `Needs`, `Wants`,
   `production` and `sandbox`.
9. **Coverage bites: a tool removed (note 6, check 1).** Comment out the `get_budget` entry in
   `apps/worker/src/mcp/tools/budgets.ts`. Run `pnpm vitest run --project worker test/mcp-coverage.test.ts`.
   Expected: fails `mcp-coverage > every mapped tool is in tools/list`, the diff naming
   `GET /budgets/{id} → get_budget`. Revert.
10. **Coverage bites: an unmapped route (note 6, check 2).** Create `apps/worker/src/routes/zz-probe.ts`
    with one `createRoute` `GET /zz-probe` answering `{ data: { ok: true } }`. Run the same command.
    Expected: fails `mcp-coverage > every REST operation has an MCP tool or a stated exclusion`, the diff
    naming `GET /zz-probe`, and the message pointing at the mapping file and conventions step 7.
11. **Coverage passes once mapped (note 6, check 3).** Keep the probe route; add
    `"GET /zz-probe": { tool: "zz_probe" }` to the mapping and `apps/worker/src/mcp/tools/zz-probe.ts`
    exporting a `zz_probe` tool whose description is 80+ characters with `Returns { ok }`. Run
    `pnpm vitest run --project worker test/mcp-coverage.test.ts test/mcp-descriptions.test.ts`.
    Expected: all pass. Delete both probe files and the mapping line; `git status --short` is clean.
12. **Description test bites.** Temporarily remove the `${MONEY}` sentence from `get_account`'s description;
    `pnpm vitest run --project worker test/mcp-descriptions.test.ts` fails on `get_account` only (its money
    is detected from the `GET accounts/{account_id}` response). Tools in `toolsWithoutOperation` are checked
    for money through their input only, so `get_account_balances` keeps `MONEY` by review, not by this test.
    Change `list_bank_connections`'s `budget_id` back to `z.uuid()`: it fails on `list_bank_connections`.
    Revert both.
13. **Conventions.** `docs/conventions.md` step 7 names `apps/worker/test/mcp-coverage-map.ts` and the
    exclusion-with-reason rule; step 7 or 10 states the description rules (milliunits, `YYYY-MM-01`,
    `YYYY-MM-DD`, `Returns`, ids as non-empty strings).
14. **Nothing out of bounds changed.** `git diff --name-only origin/main...HEAD` lists only files in the
    Manifest; none under `apps/web/`, `apps/worker/src/routes/`, `services/`, `repositories/`, `packages/`,
    `apps/worker/migrations/`, and none in `paths.always_overlap`.
15. **E2E unaffected.** The final gate's full `pnpm e2e` passes (`e2e/mcp.spec.ts` included).

## Manifest

touches: [apps/worker/src/mcp/tools/budgets.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/src/mcp/tools/transactions.ts, apps/worker/src/mcp/tools/months.ts, apps/worker/src/mcp/tools/month-categories.ts, apps/worker/src/mcp/tools/bank-connections.ts, apps/worker/src/mcp/tool-text.ts, apps/worker/test/mcp-coverage.test.ts, apps/worker/test/mcp-coverage-map.ts, apps/worker/test/mcp-descriptions.test.ts, apps/worker/test/mcp-tools.test.ts, docs/conventions.md, docs/mcp-coverage-design.md, docs/mcp-coverage-spec.md, docs/README.md, apps/worker/src/mcp/tools/categor*.ts]
shared: []
migrations: 0

Outside the Lead's expected list: `apps/worker/src/mcp/tool-text.ts` (the shared id schema and the money,
month and date sentences, so every tool file says them alike; it cannot live in `mcp/tools/`, whose glob
requires each file to export tools). `apps/worker/src/mcp/tools/categor*.ts` only if note 7 applies at the
last rebase and a category operation has no tool.
