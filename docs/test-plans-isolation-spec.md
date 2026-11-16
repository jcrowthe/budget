# Test plans isolation spec (EXF-579, EXF-569)

Implements [test-plans-isolation-design.md](test-plans-isolation-design.md). Read its "Current state" first.

**Bans for every step:** do not open the source app; do not call `https://budget.doxen.dev` (do not run
`scripts/live-test-plans.sh` without `LIVE_TEST_PLANS_BASE_URL`, not even `list`; the tests use the local
dev server, a local stand-in or the fake curl). Do not edit anything under `apps/`, `packages/`, or
`playwright.config.ts`, `clone.profile.json`, `vitest.config.ts`, any `package.json`. The one exception is
the temporary inversion in T6, which is reverted and never committed. Run long commands in the
foreground.

## T1. `scripts/live-test-plans.sh`: optional prefix (EXF-579)

- Header comment: `list ['<prefix>']` and `purge ['<prefix>']`, with one line saying that `<prefix>` must
  start with the profile prefix, is matched as a plain string prefix, and narrows `list`/`purge` to
  plans whose names start with it.
- `usage()` text: `usage: live-test-plans.sh list ['<prefix>'] | create '<name>' | delete <id> | purge ['<prefix>']`.
- Argument check (still before any env check or request):
  ```bash
  list | purge)
    [ $# -le 2 ] || usage
    if [ $# -eq 2 ]; then
      [[ "$2" == "$PREFIX"* ]] || fail "REFUSED: the prefix must start with $PREFIX" 2
    fi
    ;;
  ```
  Then set `MATCH="$PREFIX"` and, for `list`/`purge` with two arguments, `MATCH="$2"`. Do not echo the
  refused argument.
- `list_ids` and `list`: the jq filter becomes
  `select((.name | startswith($p)) and (.name | startswith($m)))` with `--arg m "$MATCH"`.
- `purge` re-read: `.data.budget.name | startswith($p) and startswith($m)` (both args). Everything else in
  `purge` stays: the 50 limit (now on the `MATCH` count, message unchanged), `remaining` from a separate
  `list_ids` call, exit codes.
- Verify: `bash -n scripts/live-test-plans.sh`. `biome` does not lint shell. T2 covers behaviour.

## T2. `scripts/test/live-test-plans.test.ts`: the cases (EXF-579)

Keep every existing test unchanged. Add the following. Each title starts with `EXF-579`.

In `describe("against the local dev server")`, **insert after `f` and before `g`** (`g` leaves 51 bulk
plans behind):

- `h. EXF-579 AC1: purge '<prefix>' deletes only that run's plans`: `create` (the helper) `ZZ-TEST A one`,
  `ZZ-TEST A two`, `ZZ-TEST B one`; `run(["purge", "ZZ-TEST A"], env())` → status 0, `stdout.trim()` is
  `deleted 2 remaining 0`; both A ids answer 404, the B id and `keepId` answer 200. `run(["list",
  "ZZ-TEST B"])` stdout is exactly `${bId}\tZZ-TEST B one\n`; `run(["list", "ZZ-TEST A"])` stdout is `""`.
  Keep `bId` in the describe scope.
- `i. EXF-579 AC2: a prefix without ZZ-TEST is refused and deletes nothing`: `count()` before; for each of
  `["purge","Other"]`, `["list","Other"]`, `["purge",""]`, `["purge","ZZ-TEST A","extra"]`, expect status 2;
  `count()` unchanged; B still 200; for the first three, stderr contains `ZZ-TEST`.
- `j. EXF-579 AC3: purge with no argument deletes every test plan`: `create("ZZ-TEST C one")`; `run(["purge"])`
  → 0 and `deleted 2 remaining 0`; B and C 404, `keepId` 200.
- `k. EXF-579 AC4: an unprefixed plan survives any prefix`: `create("ZZ-TEST k")`; `run(["purge",
  "ZZ-TEST"])` → 0 and `deleted 1 remaining 0`; `keepId` 200; output does not contain `Keep me`.

After `g`, in the same describe:

- `l. EXF-579: the 50 limit counts the given prefix`: `run(["purge", "ZZ-TEST bulk"])` → status 3, stderr
  contains `limit 50`; then `run(["purge", "ZZ-TEST bulk1"])` → 0 and `deleted 11 remaining 0`; then
  `run(["list","ZZ-TEST bulk"])` has 40 lines.

In `describe("live mode")` (fake curl standing in for the live URL; no network):

- Extend the `it.each` refusal table with `[["purge", "Other"]]`, `[["list", "Other"]]`, `[["purge", ""]]`,
  `[["purge", "ZZ-TEST A", "extra"]]`. Each one exits 2 with no request logged (the existing assertion).
- `EXF-579 AC4: a plan renamed out of the prefix before deletion is kept`: routes, in this order (first
  substring match wins):
  - `"GET https://budget.doxen.dev/api/v1/budgets/"` → 200, `{data:{budget:{id: ID1, name:"Mine too"}}}`;
  - `"DELETE https://budget.doxen.dev/api/v1/budgets/"` → 200, `{data:{deleted:true}}`;
  - `"GET https://budget.doxen.dev/api/v1/budgets"` → 200, list `[{id: ID1, name:"ZZ-TEST A x"},
    {id: ID2, name:"Mine"}]`.

  Run `["purge","ZZ-TEST A"]` with both CF variables. Expect status 1, `out` contains
  `deleted 0 remaining 1`, `out` does not contain `Mine`, and the new part of the log contains no
  `-X DELETE`.

Verify: `pnpm vitest run --project scripts scripts/test/live-test-plans.test.ts` passes. Then `pnpm check`.

## T3. `e2e/support/plans.ts`: `showOnlyPlans` (EXF-569)

```ts
import type { Page } from "@playwright/test";
export type PlanRow = { id: string; name: string; last_opened_at: string | null };
/**
 * Every GET /api/v1/budgets this page makes returns only the plans `keep` accepts (real data, filtered).
 * The suite runs fullyParallel against one database: other specs create and open plans at any time.
 * `served` holds each filtered list in the order it was served. Pair with
 * `test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }))`.
 */
export async function showOnlyPlans(
  page: Page,
  keep: (p: PlanRow) => boolean,
): Promise<{ served: PlanRow[][] }>;
```

Body: the same as `twoPlans` in `e2e/plan-menu.spec.ts:46-54` (`route.fallback()` for anything but GET,
`route.fetch()`, filter `body.data.budgets`, `route.fulfill({ response, json: body })`), plus a push of a
copy of the filtered list onto `served`. The glob `**/api/v1/budgets` matches only the list, not
`/budgets/<id>`, as today. Do not change `plan-menu.spec.ts`'s own `twoPlans`.

## T4. `e2e/plans.spec.ts`: rewrite (EXF-569)

Add `test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }))`.

**Test 1** `"/ opens the plan opened last: pickLastOpened (EXF-569)"` takes no fixtures. Import
`pickLastOpened` from `../apps/web/src/shell/useCurrentPlan` (Playwright's loader handles it; checked).
Build rows with a local factory `plan(id, last_opened_at)` typed `Parameters<typeof pickLastOpened>[0][number]`.
Fill the other fields with fixed values. Do not import `@budget/schema`: it is not a root dependency.
Assert:
- `[a:"2026-01-01T…", b:"2026-01-03T…", c:"2026-01-02T…"]` → `b`, and the same with the list reversed;
- `[a:null, b:"2026-01-01T…"]` → `b`;
- `[a:null, b:null]` → `a`;
- `[]` → `undefined`.

**Test 2** keeps its title `"create a plan, switch back, and reopen the last used plan"`. Steps:
1. `const tag = testName("plans")`; names `${tag} S`, `${tag} A`, `${tag} B`.
   `const shown = await showOnlyPlans(page, (p) => p.name.startsWith(tag))` **before any `goto`**.
2. Create S through `request.post("/api/v1/budgets", { headers: await authHeaders(), data: { name } })`
   (see `newPlan` in `plan-urls.spec.ts`). `page.goto(`/${s.id}/budget`)`, then wait until the sidebar
   button `{ name: sName, exact: true }` is visible.
3. Create A through the menu as today: click S's button, then `New Plan`, `Plan name`, `Create Plan`. Wait
   for A's button (exact) and the URL `/<uuid>/budget`; `idA` comes from the URL. Create B the same way
   from A's button; `idB` comes from the URL, and `idB !== idA`.
4. **Remove** the `request.patch(... opened: true)` of A. Open A through B's menu → Open Plan → the
   submenu row `A` (exact), with the same real-mouse moves as today (`mouseClick`, move along the row).
   Expect the URL `/${idA}/budget` and A's button visible.
5. Poll the API (as in `plan-urls.spec.ts:247-256`): `stamp(A) > stamp(B) && stamp(B) > stamp(S)`, all
   non-empty. This is "opening A stamps A later than B", proven on the spec's own plans.
6. `const k = shown.served.length; await page.goto("/");`
   `await expect(page).toHaveURL(new RegExp(`/${idA}/budget$`));`
   Then `const list = shown.served[k]` (the first list served to that load). Expect it to contain
   exactly the three ids, and A's `last_opened_at` to be greater than every other entry's. Do **not**
   compute the expected id from a reimplementation of the rule: the expected id is A, because this spec
   opened it last.
7. Keep the comments short. State that the spec sees only its own plans, so other workers cannot change
   which plan is newest.

Verify: `pnpm e2e e2e/plans.spec.ts` (2 passed).

## T5. Same pattern in other specs (EXF-569)

- `e2e/plan-urls.spec.ts` C13 (`:237`). Right after `newPlan` a and b, call
  `const shown = await showOnlyPlans(page, (p) => p.id === a.id || p.id === b.id)`. Replace `:258-268`
  with: `const k = shown.served.length; await page.goto("/");` then expect the URL `/${a.id}/budget` and
  `shown.served[k]` to show a's `last_opened_at` > b's. Delete the inline `page.route(...)` at `:280-289`
  and its comment, since the filter is already installed. Keep the rest (stamp, submenu, final poll). The
  file already has `afterEach unrouteAll`.
- `e2e/plan-menu.spec.ts` test `"14 favicon"` (`:270`): replace `page.goto("/")` with
  `const p = await newPlan(request); await page.goto(`/${p.id}/budget`);`. The assertion is unchanged.
- Do not touch `register*`, `all-accounts`, `assigned`, `categories*`, `plan-grid`, `month-nav`,
  `account*`, `sidebar-groups`, or any Plan page, register, account or Reflect spec. The sweep found
  nothing in them (they all `goto` their own plan id). Re-run
  `grep -n 'goto("/")\|last_opened_at\|\.reduce(\|budgets\[0\]' e2e/*.ts` at the end. The only `goto("/")`
  left must be the filtered ones in `plans.spec.ts` and `plan-urls.spec.ts`.

Verify: `pnpm e2e e2e/plan-urls.spec.ts e2e/plan-menu.spec.ts`.

## T6. Prove the rule fails when inverted (EXF-569), and do not commit it

1. In `apps/web/src/shell/useCurrentPlan.ts` `pickLastOpened`, change `p.last_opened_at > best.last_opened_at`
   to `<`.
2. `pnpm e2e e2e/plans.spec.ts`: both tests must fail. Copy the two failure titles and first error
   lines into the report.
3. Revert: `git checkout -- apps/web/src/shell/useCurrentPlan.ts`. Then `git diff --exit-code -- apps packages`
   must be clean, and `pnpm e2e e2e/plans.spec.ts` must pass again.

## T7. Docs

- `docs/conventions.md` step 10, after "no spec may assume an empty database;": add
  `nor that it is the only one opening or creating plans: a spec that opens \`/\` or asserts on the latest,
  first or most recent plan shows the page only its own plans (\`showOnlyPlans\` in
  \`e2e/support/plans.ts\`) and asserts only on those`. Keep the line wrap style of the file.
- `docs/conventions.md` `### Scripts`, the `live-test-plans.sh` bullets: `list ['<prefix>']` and
  `purge ['<prefix>']`. Add: "`<prefix>` (must start with `ZZ-TEST`, else exit 2) narrows the command to
  one run's plans, e.g. `purge 'ZZ-TEST F9 '`; with no argument: every test plan." Do not edit
  `clone.profile.json`.
- `docs/README.md`: already holds this Build's design line. Do not add another.

## T8. Gate runs and report

Run each command in the foreground and wait for it:
1. `pnpm check`: pass.
2. `pnpm e2e e2e/plans.spec.ts e2e/plan-menu.spec.ts e2e/plan-urls.spec.ts e2e/shell.spec.ts --repeat-each=10`
   → 0 failed, 0 flaky. Record the passed count.
3. `pnpm e2e` five times in a row, with default workers → each run 0 failed, 0 flaky. Record the
   five counts. If one fails, it is a real defect until shown otherwise. Fix it, then restart the count
   of five. If a browser cannot launch, run `pnpm exec playwright install chromium` and retry.
4. `git diff --name-only origin/main...HEAD` lists only the manifest files.

The report contains: the new arguments with an example each; the test cases (h–l, the refusal rows, the
renamed-plan guard); how the rule is proven (T4 tests 1 and 2) and the inverted-rule failure; the other
specs (C13 and favicon fixed, nothing found in the excluded specs); the commands and counts; the
manifest; that nothing under `apps/`, `apps/worker/` or `packages/` changed and that `playwright.config.ts`
and `clone.profile.json` are untouched; and "I did not open the source app and did not call the live app."
