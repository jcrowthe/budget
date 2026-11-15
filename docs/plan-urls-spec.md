# Plan-scoped URLs, titles and history: implementation spec (EXF-475)

Design: [plan-urls-design.md](plan-urls-design.md). Its Acceptance section lists the cases (C1–C14). Do not
edit `packages/core`, `apps/worker/test/openapi.test.ts`, the MCP tool file or any `paths.always_overlap`
file. If one seems necessary, stop and report.

## T1. Migration and table

- Create `apps/worker/migrations/20261115204324_budgets_last_opened_at.sql` with exactly
  `ALTER TABLE budgets ADD COLUMN last_opened_at TEXT;`. Use this exact file name: the timestamp is reserved
  for this Build.
- In `apps/worker/src/db/schema/budgets.ts`, add `lastOpenedAt: text("last_opened_at")`, which is nullable.
- Delete `.e2e-state` after adding the migration (see conventions).
- Verify: `test/schema-drift.test.ts` passes.

## T2. Schema (`packages/schema/src/budgets.ts`)

```ts
Budget: add  last_opened_at: z.string().nullable()
             .openapi({ description: "ISO 8601 time the plan was last opened in the app; null if never" })
BudgetUpdate = BudgetCreate.partial().extend({
  opened: z.literal(true).optional()
          .openapi({ description: "Set to true to record that the plan was opened (stamps last_opened_at = now). Not a change: no history entry." }),
}).openapi("BudgetUpdate")
```

- Keep the exported names and types. `BudgetCreate` does not change, so POST rejects or ignores `opened` as it
  does today.
- Verify: typecheck passes.

## T3. Repository (`apps/worker/src/repositories/budgets.ts`)

- `updateStmt(db, before, patch: { name?: string; lastOpenedAt?: string }, updatedAt)` passes the patch
  through as it does today.
- Add `markOpenedStmt(db: Db, id: string, at: string)`, which runs
  `UPDATE budgets SET last_opened_at = at WHERE id = ? AND deleted_at IS NULL`. It is unguarded by
  `updated_at` and does not touch `updated_at`.

## T4. Service (`apps/worker/src/services/budgets.ts`)

- `toApi(row)` adds `last_opened_at: row.lastOpenedAt ?? null`. `createBudget` sets `lastOpenedAt: null` on
  the row.
- `updateBudget(env, actor, id, patch)` has two paths:
  - **The patch has `opened === true` and no `name` key (`patch.name === undefined`).** Run
    `markOpenedStmt` alone. Write **no** change_log row and leave `updatedAt` unchanged. If
    `meta.changes === 0`, throw `NotFound("Plan")`. Return `toApi({...before, lastOpenedAt: now})`. The
    `before` comes from the existing `findActive`, so an unknown id is already 404.
  - **Otherwise (the existing path).** The batch is as today. When `opened` is true, add
    `lastOpenedAt: now` to `after` and to the `updateStmt` patch. An empty `{}` keeps today's behaviour.
- Add a comment above the opened-only branch: "Opening a plan is not a change: no change_log, no
  last_modified_on bump (EXF-475)."
- `routes/budgets.ts` should need no edit, because the schema flows through `BudgetUpdate`. Touch it only if
  typecheck requires.

## T5. Worker tests (`apps/worker/test/budgets.test.ts`)

Extend the `B` type with `last_opened_at: string | null`. Add `it` blocks covering C14:

1. Create a plan: `last_opened_at` is null in the POST response, the GET and the list.
2. `PATCH {opened: true}` returns 200 and `last_opened_at` is a valid ISO date within 10 s of now. Then:
   - `last_modified_on` equals its value before the PATCH.
   - GET and list return the same `last_opened_at`.
   - The change_log has only the `create` row for that budget (`SELECT action … WHERE budget_id = ?`).
3. Send `{opened: false}` and `{opened: "yes"}`: each is a 400 with the error envelope.
4. `{opened: true}` on a random uuid is a 404. On a deleted plan it is also a 404.
5. `{name: "ZZ-TEST N2", opened: true}`: the name is changed, `last_opened_at` is set, and the change_log
   gains exactly one `update` row.
6. A second `{opened: true}` gives a `last_opened_at` greater than or equal to the first.

`mcp.test.ts`: add nothing unless an assertion breaks. `list_budgets` returns the field through `toApi`.

Verify: `pnpm check`.

## T6. Web API (`apps/web/src/api/budgets.ts`)

```ts
export const updateBudget = async (id: string, patch: BudgetUpdate): Promise<Budget>
  // PATCH /api/v1/budgets/${id}, idempotencyKey: crypto.randomUUID(), schema: BudgetResponse → .data.budget
export function useMarkOpened(): UseMutationResult<Budget, Error, string>
  // mutationFn: (id) => updateBudget(id, { opened: true })
  // onSuccess: qc.setQueryData<Budget[]>(["budgets"], (list) => list?.map((b) => (b.id === updated.id ? updated : b)))
  // no invalidate, no retry
export function useUpdateBudget()   // same cache update; for later rename UIs
```

## T7. Path helpers (`apps/web/src/shell/planPaths.ts`, new)

```ts
import { addMonths, isMonth, monthKey, type Month } from "@budget/core/month";
export const planPath = (budgetId: string, month?: Month) => string     // "/<id>/budget" or "/<id>/budget/YYYYMM"
export const accountsPath = (budgetId: string) => string                // "/<id>/accounts"
export const accountPath = (budgetId: string, accountId: string) => string
export const reflectPath = (budgetId: string, report?: string) => string
export function parseMonthParam(p: string | undefined): Month | null
  // /^(19|20)\d{2}(0[1-9]|1[0-2])$/ → "YYYY-MM-01", else null
export function localCurrentMonth(now = new Date()): Month
  // the user's LOCAL year/month (now.getFullYear(), now.getMonth()+1), formatted "YYYY-MM-01"
export function rememberMonth(budgetId: string, month: Month): void   // in-memory Map, page session only
export function lastMonth(budgetId: string): Month | undefined
export function usePlanMonth(): { budgetId: string; month: Month | null; setMonth(m: Month): void }
  // reads :budgetId and :month via useParams; setMonth = navigate(planPath(budgetId, m))  (PUSH, never replace)
```

Import `addMonths` only if needed; EXF-493 does month arithmetic with it. Add no month maths to `packages/core`.

## T8. Choosing the plan (`apps/web/src/shell/useCurrentPlan.ts`)

- Remove `LAST_PLAN_KEY` and the localStorage effect. `useCurrentPlan()` returns
  `{ budgetId, plan, plans, isLoading, error }`.
- Add `export function pickLastOpened(plans: Budget[]): Budget | undefined`. It returns the plan with the
  greatest non-null `last_opened_at`, comparing strings. If none has a value, it returns `plans[0]`.
- `usePageTitle(screen: string)` is unchanged. Also export `useDocumentTitle(title: string)` (it sets
  `document.title` in an effect), for titles that have no plan.
- Grep for `LAST_PLAN_KEY` and fix every importer (Home, Sidebar).

## T9. PlanScope (`apps/web/src/shell/PlanScope.tsx`, new; delete `shell/PlanGate.tsx`)

```tsx
export function PlanScope(): JSX.Element
```

- `useCurrentPlan()` determines what renders:
  - while `isLoading`, `null`;
  - on `error`, `<div className="card">Could not load plans.</div>`;
  - for an unknown or deleted id, the not-found card (below);
  - otherwise `<Outlet />`.
- The not-found card is the same markup as today's PlanGate: `<h2>Plan not found</h2>`, then
  `<p>This plan doesn't exist or was deleted.</p>`, then `<Link to="/">Go to your plans</Link>`. It sets the
  title with `useDocumentTitle("Plan Not Found | Budget")`.
- Recording an open:

  ```ts
  const recorded = useRef<string | null>(null); const mark = useMarkOpened();
  useEffect(() => {
    if (plan && recorded.current !== plan.id) { recorded.current = plan.id; mark.mutate(plan.id); }
  }, [plan?.id]);
  ```

  - Depend on `plan?.id` only, and do not put `mark` in the dependencies; a biome-ignore comment with the
    reason is fine.
  - Errors are swallowed: no toast.
- Also export, from the same file, the two router built-ins:
  - `PlanIndexRedirect`, which renders `<Navigate to="budget" replace />`;
  - `PlanFallbackRedirect`, which renders `<Navigate to={planPath(budgetId)} replace />`.

## T10. Router (`apps/web/src/router.tsx`)

- Keep the `import.meta.glob("./pages/*.tsx")` collection and sorting. Split the pages:
  - Pages whose `path` starts with `"/:budgetId/"` become children of the plan route, with the prefix
    stripped.
  - All other pages stay as children of AppShell.

```ts
const PLAN_PREFIX = "/:budgetId/";
const planRoute: RouteObject = {
  path: "/:budgetId",
  element: <PlanScope />,
  children: [{ index: true, element: <PlanIndexRedirect /> }, ...scoped, { path: "*", element: <PlanFallbackRedirect /> }],
};
export const router = createBrowserRouter([{ element: <AppShell />, children: [...others, planRoute] }]);
```

- Update the comment at the top: "pages export `page: { path, element }`; paths under `/:budgetId/` render
  inside PlanScope (plan resolved, not-found handled, open recorded)".
- Also add one bullet to step 9 of `docs/conventions.md`: plan pages use a `/:budgetId/...` path and need
  no gate.
- Verify the ranking: `/` hits `home.tsx`, `/x` hits PlanScope (and shows not found when x is not a plan),
  and `/a/b` hits PlanScope `*`.

## T11. Pages

**`pages/plan.tsx`** has the path `"/:budgetId/budget/:month?"`.

- Read `{ budgetId, month }` from `usePlanMonth()`.
- A missing month (`:month` absent) renders the current month at `/budget` with no redirect (polish P2). If
  the month is present but invalid, return
  `<Navigate replace to={planPath(budgetId, localCurrentMonth())} />`. This covers a missing or invalid
  month.
- Otherwise:
  - call `usePageTitle("Plan")`;
  - call `rememberMonth(budgetId, month)` in an effect;
  - render `<PageHeader variant="plan" title={<month as "Nov 2026": toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) of `${month}T00:00:00Z`>} />`,
    then `<div className="page-body" />`.
- Call hooks before any early return.
- Remove `PlanGate`.

**`pages/accounts.tsx`**: the path does not change. Remove `PlanGate`.

**`pages/account.tsx`** (new) has the path `"/:budgetId/accounts/:accountId"`.

- Return `<Navigate replace to={accountsPath(budgetId)} />` for every id (polish P1: the source replaces an
  unknown account with All Accounts). No title hook, no card.
- Add a comment: EXF-481 renders the register for a known id.

**`pages/reflect.tsx`** has the path `"/:budgetId/reflect/:report?"`.

```ts
export const REPORTS = {
  "spending-breakdown": "Spending Breakdown",
  "spending-trends": "Spending Trends",
  "net-worth": "Net Worth Report",
  "income-expense": "Income v Expense Report",
  "age-of-money": "Age Of Money",
} as const;
```

- If there is no `report`, return `<Navigate replace to={reflectPath(id, "spending-breakdown")} />`.
- If the report is not in `REPORTS`, return `<Navigate replace to={planPath(id)} />`.
- Otherwise call `usePageTitle(REPORTS[report])`, and keep the header `Reflect`.
- Call hooks unconditionally. Pass `""` while redirecting, so the effect does no harm.

**`pages/home.tsx`**:

- Use `pickLastOpened(data)`. If it finds a plan, return `<Navigate to={planPath(target.id)} replace />`.
- Otherwise keep today's "Create your first plan" card.
- Call `useDocumentTitle("Budget")`.

## T12. Sidebar (`apps/web/src/shell/Sidebar.tsx`)

- `target = plan?.id ?? pickLastOpened(plans)?.id`. Never use a raw unknown `budgetId`.
- Plan link:
  - `<NavLink to={target ? planPath(target, viewing ?? lastMonth(target) ?? localCurrentMonth()) : "/"} className={() => (onPlan ? "active" : "")}>`
  - `viewing` is `parseMonthParam(useMatch("/:budgetId/budget/:month")?.params.month)` while `budgetId === target`.
  - `onPlan` is `!!useMatch("/:budgetId/budget/*")`.
- Reflect link: `<NavLink to={reflectPath(target)}>`. Its default active matching covers `/reflect/*`.
- All Accounts link: `<NavLink to={accountsPath(target)} end>`, so it is not active on an account page.
- Keep the markup, icons, order and the class name `active`: the shell-compare spec depends on them.

## T13. e2e

Add a helper in the new spec:

```ts
async function inAppPush(page, path) // history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx: (history.state?.idx ?? 0) + 1 }, "", path); dispatchEvent(new PopStateEvent("popstate", { state: history.state }))
```

It stands in for links that do not exist yet: account rows (EXF-481) and month arrows (EXF-493). Also use a
reload marker: `await page.evaluate(() => { (window as any).__marker = 1 })`, then later
`expect(await page.evaluate(() => (window as any).__marker)).toBe(1)`. Compute `M` and `M+1` in Node from the
local date.

**`e2e/plan-urls.spec.ts`** (new). One test per design case, C1–C13. Each creates its own plan through the
API (`authHeaders()` and `testName("urls")`), and asserts `toHaveURL` and `toHaveTitle` as written in the
design:

- C6: loop over the URLs.
- C8 and C9: check that the marker survived.
- C10: compare `history.length` before and after.
- C12: create a plan, delete it, then load it.
- C13 must be race-safe, because other workers open plans in parallel:
  1. `const resp = page.waitForResponse(r => r.url().endsWith("/api/v1/budgets") && r.request().method() === "GET")`,
     then `page.goto("/")`.
  2. Find `X = argmax(last_opened_at)` in `(await (await resp).json()).data.budgets`.
  3. Expect the URL to be `/${X.id}/budget`, and expect A's `last_opened_at` in that response to be
     non-null.

**`e2e/shell.spec.ts`**:

- After clicking Reflect, expect the URL `/${id}/reflect/spending-breakdown` and the title
  `Spending Breakdown | ${name} | Budget`.
- The Plan link `active` check stays (it holds on `/budget` and `/budget/M`).

**`e2e/plans.spec.ts`**:

- Replace `/\/[0-9a-f-]{36}\/budget$/` with `/\/[0-9a-f-]{36}\/budget\/\d{6}$/`.
- Replace the final `goto("/")` / `toHaveURL(urlA)` with the same race-safe argmax check as C13. A is the
  last plan opened by this test.

Verify the specs: `pnpm e2e e2e/plan-urls.spec.ts e2e/shell.spec.ts e2e/plans.spec.ts e2e/shell-compare.spec.ts --repeat-each=3`,
then `pnpm check`. Do not run the full suite: final_gate does that.

## T14. Docs

The Architect's commit already adds the line for the design doc to `docs/README.md`. Add nothing else there
beyond the conventions bullet from T10.

## Done when

- `pnpm check` is green.
- The four specs above pass 3 times.
- `git diff --stat origin/main` lists only files in the design's Manifest `touches`.
- `git diff origin/main -- packages/core apps/worker/test/openapi.test.ts` is empty.
