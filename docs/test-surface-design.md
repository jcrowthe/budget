# Derived API and MCP surface tests: design (EXF-561)

## Feature

Three tests each keep a hand-written list of everything the API or MCP endpoint exposes. Because of that, every
Build that adds a route or a tool edits the same lines, and Builds running side by side conflict at merge:

- `apps/worker/test/openapi.test.ts`: `toEqual([...five paths...])` on `/api/v1/openapi.json`
- `apps/worker/test/mcp.test.ts`: `toEqual(["create_budget", "get_plan_month", "list_budgets"])`
- `e2e/mcp.spec.ts`: the same three names again

This Build replaces the three lists with checks **derived from the same globs the Worker uses**. After it, a
feature adds files only (route, tool, its own tests) and never edits these three files. The change is to tests
and one doc only. No route, tool, behaviour or UI of the app changes.

## Source

This feature has no source-app counterpart: it changes the clone's test suite only. The Lead's note says
nobody uses the source app in this Build, so there are no study notes and no compare cases.

## Evidence (what the code does today)

- `apps/worker/src/app.ts` collects `import.meta.glob<{ default: OpenAPIHono<AppEnv> }>("./routes/*.ts",
  { eager: true })`, mounts each module at `/api/v1`, and serves `doc31` at `/api/v1/openapi.json` (3.1.0).
- `apps/worker/src/mcp/server.ts` collects `import.meta.glob<{ tools: McpToolDef[] }>("./tools/*.ts",
  { eager: true })` and calls `server.registerTool` for each tool. The MCP SDK throws on a duplicate name
  ("already registered").
- Prototype (a temporary test run in the Workers pool and then deleted) confirmed that a test file can use
  `import.meta.glob("../src/routes/*.ts", { eager: true })` and `("../src/mcp/tools/*.ts")`, and that
  `mod.default.getOpenAPI31Document({ openapi: "3.1.0", info })` returns each route file's own paths,
  relative to `/api/v1`. With `/api/v1` added in front, their union equals the served document's paths:
  - `budgets.ts` gives `/budgets`, `/budgets/{id}`
  - `health.ts` gives `/health`
  - `months.ts` gives `/budgets/{budget_id}/months`, `/budgets/{budget_id}/months/{month}`
  - tools: `budgets.ts` gives `list_budgets`, `create_budget`; `months.ts` gives `get_plan_month`
- `tsconfig` for the Worker already includes `vite/client` types and the `test` dir, so `import.meta.glob`
  typechecks in tests. Nothing in `apps/worker/src/`, any config or any always-overlap file needs to change.
- The existing resources are already exercised elsewhere: `/api/v1/health` (`access.test.ts`, `budgets.test.ts`),
  budgets REST (`budgets.test.ts`), months REST (`months.test.ts`), `get_plan_month` (`e2e/months.spec.ts`).

## Approach

### 1. New test helper `apps/worker/test/surface.ts` (not a test file; vitest only runs `*.test.ts`)

It is the single place that knows how to read the surface, so resource tests and the derived checks share it:

- `routeModules` and `toolModules`: the two eager globs (same patterns as the Worker, relative to `test/`).
- `routeFilePaths(mod)`: the `/api/v1/...` paths one route module contributes (via `getOpenAPI31Document`).
- `apiDocument()`: GET `/api/v1/openapi.json` through `json()` from `helpers.ts`, returns `{ openapi, paths }`.
- `apiPaths()`: `Object.keys(apiDocument().paths)`.
- `mcpRpc(method, params, id)`: the JSON-RPC POST to `/mcp` that is now private to `mcp.test.ts`, moved here
  unchanged (it handles the SSE `data:` lines).
- `listedToolNames()`: `initialize`, then `tools/list`, returns the names.

### 2. `openapi.test.ts`: derived checks (replaces the path list)

`describe("openapi")`:
- `serves an OpenAPI 3.1.0 document`: `openapi === "3.1.0"`.
- `every path is under /api/v1/`: each key starts with `/api/v1/`.
- `the route glob finds route files`: `Object.keys(routeModules).length > 0`. Without it, a broken glob
  pattern would let every per-file check pass with nothing to check.
- `it.each(<sorted route file keys>)("route file %s contributes at least one path")`: `routeFilePaths(mod)`
  is non-empty, and each of those paths is in the served document.
- `every documented path comes from a route file`: sorted union of all `routeFilePaths` equals sorted
  `apiPaths()`. Both sides are derived; no list is kept by hand.

### 3. `mcp.test.ts`: derived checks (replaces the tool list)

`describe("mcp")`:
- Keep `lists tools and creates a budget with an mcp actor` and its call flow. Replace the full-list
  `toEqual` with `expect(names).toEqual(expect.arrayContaining(["create_budget", "list_budgets"]))`, the tools
  this test calls. Use `mcpRpc` from `surface.ts` in place of the local `rpc`.
- `the tool glob finds tool files`: `Object.keys(toolModules).length > 0`.
- `it.each(<sorted tool file keys>)("tool file %s exports at least one tool")`: `tools.length > 0`.
- `no two tools share a name`: the names that appear more than once across all tool files `toEqual([])`, so
  the failure message names the duplicate.
- `tools/list lists exactly the tools the tool files export`: sorted `listedToolNames()` equals the sorted
  names from `toolModules`.

### 4. `e2e/mcp.spec.ts`: membership only

Keep initialize, `tools/list`, `create_budget` with a `ZZ-TEST` name, the REST read-back and `list_budgets`.
Replace the full-list `toEqual` with `toEqual(expect.arrayContaining(["create_budget", "list_budgets"]))`.

### 5. New `apps/worker/test/existing-surface.test.ts`

The Lead does not want the existing resource tests retrofitted. This new file adds an explicit assertion for
the three existing resources, so that removing one of their routes or tools fails `pnpm check` (today removing
`get_plan_month` fails only `pnpm e2e`):
- `apiPaths()` contains `/api/v1/health`, `/api/v1/budgets`, `/api/v1/budgets/{id}`,
  `/api/v1/budgets/{budget_id}/months`, `/api/v1/budgets/{budget_id}/months/{month}`.
- `listedToolNames()` contains `list_budgets`, `create_budget`, `get_plan_month`.
It uses `arrayContaining`, so adding routes or tools never breaks it. New resources do **not** add their
lines here: they assert their surface in their own test file (step 10).

### 6. `docs/conventions.md` step 10 (only that step changes)

New wording, verbatim:

> 10. **Tests**: `apps/worker/test/widgets.test.ts` (REST, change_log rows, atomicity, and the resource's own
>     surface: `expect(await apiPaths()).toEqual(expect.arrayContaining([...]))` with its paths and the same
>     with `listedToolNames()` for its tools, both from `test/surface.ts`), `e2e/widgets.spec.ts` (the user
>     flow). Name test data `ZZ-TEST <random>`; no spec may assume an empty database. Never edit
>     `apps/worker/test/openapi.test.ts`, `apps/worker/test/mcp.test.ts` or `e2e/mcp.spec.ts`: they derive the
>     route and tool lists from the globs (every route file contributes a path, every tool file exports a
>     tool, no two tools share a name, `tools/list` matches the tool files), so a new resource adds files only.

## Downstream effects

- Every later route or tool Build adds files only. The approval card stops showing these three files as
  unplanned.
- A Build that edited these lists on its own branch before this merges (none of the running ones does:
  EXF-511 and EXF-487 stay out of these files) resolves the rebase conflict by taking this version and moving
  its assertions into its own test file.
- A route file must now contribute at least one OpenAPI path. A plain Hono `.get()` with no `createRoute`
  fails `route file … contributes at least one path`. That is intended: conventions step 6 already requires
  `createRoute`.

## Out of scope

- Any file under `apps/worker/src/`, `apps/web/`, `packages/`, `scripts/`, and any `paths.always_overlap` file
  (vitest, Playwright and Worker configs included).
- Retrofitting `budgets.test.ts`, `months.test.ts`, `access.test.ts`, `helpers.ts`, `e2e/months.spec.ts`,
  `e2e/plans.spec.ts`, `e2e/api.spec.ts` or any other existing test file.
- Deriving a page list for the web app (pages have no hand-kept list today).

## Acceptance

All cases run in `/workspace/repo`. Revert every temporary edit and delete every throwaway file; at the end
`git status --short` shows none of them. No screenshots, no source app.

1. **Check passes.** Run `pnpm check`. Expected: exit 0. The output includes the openapi tests (3.1.0,
   `/api/v1/` prefix, glob non-empty, one `route file ../src/routes/<x>.ts contributes at least one path` per
   file for budgets, health, months, the union check) and the mcp tests (call flow, glob non-empty, one
   `tool file … exports at least one tool` per file, unique names, `tools/list` equality), and
   `existing-surface.test.ts`.
2. **No hand-kept list remains.** `grep -n "get_plan_month" apps/worker/test/mcp.test.ts e2e/mcp.spec.ts`
   prints nothing, and `grep -n "months/{month}" apps/worker/test/openapi.test.ts` prints nothing.
3. **E2E MCP flow.** `pnpm e2e e2e/mcp.spec.ts e2e/api.spec.ts`. Expected: all pass.
4. **Empty tool file bites (mutation a).** Create `apps/worker/src/mcp/tools/zz-probe.ts` exporting
   `export const tools: McpToolDef[] = [];`. Run `pnpm vitest run --project worker`. Expected: fails
   `mcp > tool file ../src/mcp/tools/zz-probe.ts exports at least one tool`. Delete the file.
5. **Duplicate tool name bites (mutation b).** Create `apps/worker/src/mcp/tools/zz-probe.ts` exporting one
   tool named `list_budgets` (any description, `z.object({})`, `run: async () => ({})`). Run the worker
   tests. Expected: fails `mcp > no two tools share a name`, with `list_budgets` in the diff. Other mcp tests
   may fail too, because the SDK refuses the duplicate. Delete the file.
6. **Pathless route file bites (mutation c).** Create `apps/worker/src/routes/zz-probe.ts` with
   `export default new OpenAPIHono<AppEnv>();` (no route). Run the worker tests. Expected: fails
   `openapi > route file ../src/routes/zz-probe.ts contributes at least one path`. Delete the file.
7. **Adding a resource is files only (reverse).** Create `apps/worker/src/routes/zz-probe.ts` (one
   `createRoute` GET `/zz-probe` returning `{ data: { ok: true } }`), `apps/worker/src/mcp/tools/zz-probe.ts`
   (one tool `zz_probe` returning `{ ok: true }`) and `apps/worker/test/zz-probe.test.ts` asserting
   `apiPaths()` contains `/api/v1/zz-probe` and `listedToolNames()` contains `zz_probe`. Run `pnpm check`,
   then `pnpm e2e e2e/mcp.spec.ts e2e/api.spec.ts`. Expected: both pass, and `git diff --stat` shows **no**
   change to `openapi.test.ts`, `mcp.test.ts` or `e2e/mcp.spec.ts`. Delete the three files.
8. **Removing an existing tool or route still bites.** In `apps/worker/src/mcp/tools/months.ts`, temporarily
   change the `tools` array to `[]`. Run the worker tests. Expected: fails
   `existing-surface > …` (`get_plan_month` missing) and `tool file ../src/mcp/tools/months.ts exports at
   least one tool`. Revert with `git checkout -- apps/worker/src/mcp/tools/months.ts`.
9. **Scope.** `git diff --name-only origin/main...HEAD` lists only Manifest files: nothing under
   `apps/worker/src/`, `apps/web/`, `packages/`, `scripts/`, no always-overlap file, no other existing test.
10. **Full gate.** final_gate runs `pnpm e2e`. Expected: green.

## Manifest

touches: [apps/worker/test/openapi.test.ts, apps/worker/test/mcp.test.ts, apps/worker/test/surface.ts, apps/worker/test/existing-surface.test.ts, e2e/mcp.spec.ts, docs/conventions.md, docs/test-surface-design.md, docs/test-surface-spec.md, docs/README.md]
shared: []
migrations: 0
