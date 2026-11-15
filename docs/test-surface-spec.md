# Derived API and MCP surface tests: implementation spec (EXF-561)

Design: [test-surface-design.md](test-surface-design.md). Tests and one doc only. Do not edit anything under
`apps/worker/src/`, `apps/web/`, `packages/`, `scripts/`, any config, `helpers.ts` or any other existing test
file. Run the worker tests alone with `pnpm vitest run --project worker`.

## T1. Helper `apps/worker/test/surface.ts` (new)

```ts
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../src/env";
import type { McpToolDef } from "../src/mcp/types";

export const routeModules: Record<string, { default: OpenAPIHono<AppEnv> }>;
//   = import.meta.glob<{ default: OpenAPIHono<AppEnv> }>("../src/routes/*.ts", { eager: true })
export const toolModules: Record<string, { tools: McpToolDef[] }>;
//   = import.meta.glob<{ tools: McpToolDef[] }>("../src/mcp/tools/*.ts", { eager: true })

export function routeFilePaths(mod: { default: OpenAPIHono<AppEnv> }): string[];
//   Object.keys(mod.default.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "probe", version: "1" } })
//     .paths ?? {}).map((p) => `/api/v1${p}`)
export function toolFileNames(): string[];          // all names across toolModules, file order, duplicates kept
export async function apiDocument(): Promise<{ openapi: string; paths: Record<string, unknown> }>;
//   (await json("/api/v1/openapi.json")).json(), with json from ./helpers
export async function apiPaths(): Promise<string[]>;
export async function mcpRpc(method: string, params: unknown, id?: number):
  Promise<{ status: number; body: any }>;          // move `rpc` from mcp.test.ts here, behaviour unchanged
//   (POST /mcp via call(), Content-Type json, Accept "application/json, text/event-stream",
//    Cf-Access-Jwt-Assertion = await localToken(), Host "localhost"; parse the SSE `data:` line)
export async function listedToolNames(): Promise<string[]>;
//   mcpRpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }, 1)
//   then mcpRpc("tools/list", {}, 2) → body.result.tools.map(t => t.name)
```

Use a typed body in place of `any` if Biome's `noExplicitAny` objects (for example
`{ result?: { tools?: { name: string }[]; structuredContent?: Record<string, unknown> } }`), or keep the cast at
the call site. Verify: `pnpm -r typecheck` passes.

## T2. `apps/worker/test/openapi.test.ts` (rewrite)

Remove the hand-kept path list. `describe("openapi", …)` with exactly these test names (the Tester names them
in the acceptance report):

| test name | assertion |
|---|---|
| `serves an OpenAPI 3.1.0 document` | `(await apiDocument()).openapi === "3.1.0"` |
| `every path is under /api/v1/` | every `apiPaths()` entry `startsWith("/api/v1/")`. Collect the offenders and `toEqual([])` |
| `the route glob finds route files` | `Object.keys(routeModules).length > 0` |
| `route file %s contributes at least one path` | `it.each(Object.keys(routeModules).sort())`: `routeFilePaths(routeModules[file])` length > 0, and `apiPaths()` `toEqual(expect.arrayContaining(thosePaths))` |
| `every documented path comes from a route file` | `[...new Set(all routeFilePaths)].sort()` `toEqual` `(await apiPaths()).sort()` |

No literal path other than the `/api/v1` prefix appears in this file.

## T3. `apps/worker/test/mcp.test.ts` (rewrite)

Delete the local `rpc`; import `mcpRpc`, `toolModules`, `toolFileNames`, `listedToolNames` from `./surface`.

| test name | assertion |
|---|---|
| `lists tools and creates a budget with an mcp actor` | existing flow unchanged (initialize, `tools/list`, `create_budget` "ZZ-TEST M", change_log actor starts `mcp:user:`, `list_budgets` contains the id with `last_opened_at: null`). Only change: names `toEqual(expect.arrayContaining(["create_budget", "list_budgets"]))` |
| `the tool glob finds tool files` | `Object.keys(toolModules).length > 0` |
| `tool file %s exports at least one tool` | `it.each(Object.keys(toolModules).sort())`: `toolModules[file].tools.length > 0` (also `Array.isArray`) |
| `no two tools share a name` | names occurring more than once in `toolFileNames()`, deduped, `toEqual([])` |
| `tools/list lists exactly the tools the tool files export` | `(await listedToolNames()).sort()` `toEqual([...toolFileNames()].sort())` |

The string `get_plan_month` must not appear in this file.

## T4. `e2e/mcp.spec.ts` (edit one assertion)

Keep the test name, `rpc` helper and flow. Replace the `.sort()).toEqual([...three names...])` with
`expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["create_budget", "list_budgets"]))`.
Verify: `pnpm e2e e2e/mcp.spec.ts` passes; `get_plan_month` no longer appears in the file.

## T5. `apps/worker/test/existing-surface.test.ts` (new)

`describe("existing-surface", …)`:
- `budgets, months and health paths are documented`: `apiPaths()` `toEqual(expect.arrayContaining([
  "/api/v1/health", "/api/v1/budgets", "/api/v1/budgets/{id}", "/api/v1/budgets/{budget_id}/months",
  "/api/v1/budgets/{budget_id}/months/{month}"]))`.
- `budgets and months tools are listed`: `listedToolNames()` `toEqual(expect.arrayContaining(["list_budgets",
  "create_budget", "get_plan_month"]))`.
Add a one-line comment: new resources assert their own surface in their own test file; do not add them here.

## T6. `docs/conventions.md` step 10

Replace step 10 only, with the wording given verbatim in the design doc ("Approach" section 6). Keep the
numbered-list indentation (4 spaces on continuation lines). Change no other line.

## T7. Mutation checks (temporary, never committed)

Run design Acceptance cases 4–8 exactly as written there. Record each failing test's full name
(`openapi > route file ../src/routes/zz-probe.ts contributes at least one path`,
`mcp > tool file ../src/mcp/tools/zz-probe.ts exports at least one tool`, `mcp > no two tools share a name`)
and the reverse case's `pnpm check` result. Afterwards: `rm -f apps/worker/src/routes/zz-probe.ts
apps/worker/src/mcp/tools/zz-probe.ts apps/worker/test/zz-probe.test.ts`,
`git checkout -- apps/worker/src/mcp/tools/months.ts`, and confirm that `git status --short` lists none of them.

Throwaway tool for case 7 (shape only):
`export const tools: McpToolDef[] = [{ name: "zz_probe", description: "probe", inputSchema: z.object({}), run: async () => ({ ok: true }) }]`
with `z` from `zod` (as in the existing tool files) and `McpToolDef` from `../types`.

## T8. Finish

- `pnpm check` exits 0.
- `git diff --name-only origin/main...HEAD` lists only the design Manifest files.
- Commit as `EXF-561: Derive the API path and MCP tool checks from the globs`.
