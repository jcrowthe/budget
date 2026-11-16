# Test plans isolation design (EXF-579, EXF-569)

Two small test-infrastructure tickets in one Build. **No screen and no app behaviour changes**: no file
under `apps/`, `packages/`, and none of `paths.always_overlap` (`playwright.config.ts`, `clone.profile.json`,
the `package.json` files, …) is edited.

- **EXF-579**: `scripts/live-test-plans.sh purge` (and `list`) take an optional name prefix, so a run cleans
  up only its own `ZZ-TEST` plans on the live app and two runs can share it.
- **EXF-569**: `e2e/plans.spec.ts:4` is flaky under `fullyParallel: true` because it asserts which plan is
  "opened last" across the whole shared database. Prove the rule where it is deterministic and make the
  browser specs look only at their own plans.

## Source

Nothing to study. This Build changes no screen, and the Lead forbids opening the source app in it. No
source notes were taken. **I (Architect) did not open the source app and did not call the live app**
(`https://budget.doxen.dev`). Everything below comes from reading the repository at `41bee46`.

## Current state (read in the repository)

### `scripts/live-test-plans.sh`

- `list | purge` accept exactly one argument (`[ $# -eq 1 ] || usage`). Argument checks run before any
  environment check or request.
- `PREFIX` comes from `clone.profile.json` `live.test_prefix` (`ZZ-TEST`). `list_ids` and `list` keep the
  plans where `.name | startswith($p)`.
- `purge`: list the ids; refuse with exit 3 when more than 50 match; for each id, re-read the plan and
  delete only if its name still starts with the prefix; re-list; print `deleted <n> remaining <m>`;
  exit 0 only when `m` is 0. A failed re-list stops the script (exit 1, no `remaining` line).
- Tests: `scripts/test/live-test-plans.test.ts` (vitest project `scripts`, part of `pnpm check`). It has
  three blocks: a real local dev server with its own state (`support/dev-server.ts`, never the live app);
  a local stand-in HTTP server (auth routing); and a fake `curl` that stands in for the live URL
  (`support/fake-curl.ts`, routes matched by substring of `METHOD URL`, first match wins, `seq` for
  ordered answers, every call logged). Dev-server test `g` leaves 51 `ZZ-TEST bulk<i>` plans behind.

### "`/` opens the plan opened last"

- The choice is a pure, exported function: `pickLastOpened(plans)` in
  `apps/web/src/shell/useCurrentPlan.ts`. It returns the plan with the greatest `last_opened_at`. A plan
  that was never opened (`null`) loses to any opened plan. When no plan was ever opened it returns the
  first plan, and `undefined` for an empty list. `apps/web/src/pages/home.tsx` calls it on the
  `useBudgets()` list and `<Navigate replace>`s to `planPath(target.id)`.
- No vitest project covers `apps/web` (`vitest.config.ts`: `packages/*/test`, `scripts/test`, the worker),
  and `vitest.config.ts` is out of bounds. Playwright's loader can import the function directly. This
  was checked: a probe spec doing `import { pickLastOpened } from "../apps/web/src/shell/useCurrentPlan"`
  loads under `playwright test --list` (the module and its imports are Node-safe), and the probe was
  deleted afterwards. The root `tsconfig.json` (which includes `e2e/`) is not typechecked by `pnpm check`
  (`pnpm -r typecheck` runs per package, and the root has no `typecheck` script).
- Opening a plan page records an open (`PlanScope`, `PATCH /budgets/{id}` `{opened:true}` stamps
  `last_opened_at`).

### Why `e2e/plans.spec.ts:4` flakes

1. `:7` `page.goto("/")` lands on whatever plan is newest in the whole database, then `:12-15` clicks
   `.first()` of `/^Budget$|ZZ-TEST/`. Other specs delete their plans (`api`, `months`, `month-nav`,
   `plan-grid`, `categories*`, `assigned`, `plan-urls:219`), so that plan can vanish. The visit also stamps
   another worker's plan, which disturbs that worker.
2. `:31-35` PATCHes A as opened before the submenu click. A is then newer than B even if the submenu
   click recorded nothing, so the submenu open is not what the spec proves.
3. `:47-60` computes the newest plan from the full list in the response to `/` and expects the URL to
   match. Another worker can record an open, or the page can load the list again, between that response
   and the redirect. So the expected id and the redirect can come from different states of the database.

## Approach

### EXF-579: an optional prefix for `list` and `purge`

```
bash scripts/live-test-plans.sh list ['<prefix>']
bash scripts/live-test-plans.sh purge ['<prefix>']
```

- `<prefix>` must start with `ZZ-TEST` (the profile's `live.test_prefix`). Anything else, including `''`,
  is refused with exit 2 before any request (stderr `REFUSED: the prefix must start with ZZ-TEST`).
  More than one extra argument prints the usage line and exits 2.
- Matching is a plain string prefix (jq `startswith`, no glob or regex). `MATCH` is `<prefix>` when it
  is given and `ZZ-TEST` otherwise. With no argument the script behaves exactly as today.
- `list '<prefix>'` prints `<id><TAB><name>` for each plan whose name starts with `MATCH`.
- `purge '<prefix>'` keeps every safeguard, now scoped to `MATCH`:
  - the 50 limit counts the plans matching `MATCH`;
  - each plan is re-read and deleted only if its name still starts with both `ZZ-TEST` and `MATCH` (a plan
    renamed out of the run's prefix in between is kept);
  - the re-list counts plans still matching `MATCH`;
  - output and exit code are unchanged: `deleted <n> remaining <m>`, 0 only when `m` is 0; 3 over the
    limit; 1 for a failed request.
- `create` and `delete` are unchanged. A run should name its plans under one tag, for example
  `ZZ-TEST F9 checkout`, and end with `purge 'ZZ-TEST F9 '`. The trailing space keeps `ZZ-TEST F90…` out.
  A prefix matches every name that starts with it.
- `clone.profile.json` (`live.recipes`) is **not** edited (Lead). The `### Scripts` bullets for the script
  in `docs/conventions.md` are updated, since this Build edits that file anyway.

Examples: `list 'ZZ-TEST F9'`, `purge 'ZZ-TEST F9'`, `purge` (all test plans), `purge 'Other'` (exit 2).

### EXF-569: prove the rule deterministically, look only at your own plans

1. **Unit proof of the rule (deterministic).** A test with no page in `e2e/plans.spec.ts` imports
   `pickLastOpened` and checks four cases: the newest `last_opened_at` wins whatever the list order;
   an opened plan beats a never-opened one; with none opened, the first plan wins; an empty list gives
   `undefined`. It runs in every `pnpm e2e` (the gate) and in the repeat run. Nothing under `apps/web/`
   moves.
2. **Browser proof on the spec's own plans.** A shared helper `showOnlyPlans(page, keep)` in
   `e2e/support/plans.ts` filters every `GET /api/v1/budgets` the page makes down to the plans `keep`
   accepts. The data is real, only filtered, as `plan-menu.spec.ts` `twoPlans` already does. It records
   each filtered list it serves. `e2e/plans.spec.ts` is rewritten so that it:
   - names all its plans under one tag (`testName("plans")`, so `<tag> S`, `<tag> A`, `<tag> B`) and filters
     to `name.startsWith(tag)` from before the first `goto`;
   - starts on its own seed plan S (created through the API), not on `/`. It then creates A and B
     through the plan menu (New Plan), as it does today;
   - drops the `PATCH` of A, so that A becomes "opened last" only by the Open Plan submenu click;
   - polls the API until `last_opened_at(A) > last_opened_at(B)` and `> last_opened_at(S)`. This is the
     ticket's "opening A stamps A later than B";
   - opens `/` and asserts that the list served to that load shows A newest of the spec's plans, and that
     the URL becomes exactly `/<A>/budget`.
   Only this spec can stamp its plans: no spec in the suite opens `/` unfiltered after this Build (see 3).
   So the assertion is deterministic. With the rule inverted, `/` lands on S, the oldest, and the test
   fails. The unit test fails as well.
3. **Same pattern elsewhere** (searched `e2e/*.ts` for `goto("/")`, `last_opened_at`, `.reduce(`,
   `budgets[0]`, first-plan regexes):
   - `e2e/plan-urls.spec.ts:237-268` (C13): the same newest-of-the-whole-list assertion. **Fixed**: install
     `showOnlyPlans` for its plans a and b before its first `goto`, drop the later inline route
     (`:280-289`), and assert that the served list shows a newest and the URL is `/<a>/budget`.
   - `e2e/plan-menu.spec.ts:270-276` (test 14, favicon): `page.goto("/")` with no filter. It asserts only
     the favicon, but it stamps whichever plan is newest in the database, which can be another spec's
     plan. **Fixed**: open its own new plan instead.
   - The specs excluded by the Lead (`register*`, `all-accounts`, `assigned`, `categories*`, and the Plan
     page, register, account and Reflect specs) have **no** instance: they all `goto` their own plan's
     id. Nothing is listed for later.
4. **Convention.** `docs/conventions.md` step 10 gains: no spec may assume it is the only one opening or
   creating plans. A spec that opens `/` or asserts on the latest, first or most recent plan shows the page
   only its own plans (`showOnlyPlans`) and asserts only on those.

Why not option 2 (a serial project): it edits `playwright.config.ts`, which is out of bounds, and it is
not needed because option 1 keeps the proof.

**Is the flake an app defect?** No. The app does what the rule says with the list it loads. The spec
compared that list against a database that other workers were changing. No app change.

## What changes

| Area | Change |
|---|---|
| `scripts/live-test-plans.sh` | optional `<prefix>` for `list` and `purge`; `MATCH`; header comment and usage line |
| `scripts/test/live-test-plans.test.ts` | the ticket's cases plus refusals and the guard, on the local dev server and the fake curl |
| `e2e/support/plans.ts` (new) | `showOnlyPlans` |
| `e2e/plans.spec.ts` | unit test of `pickLastOpened`; browser test on its own plans |
| `e2e/plan-urls.spec.ts` | C13 filtered from the start |
| `e2e/plan-menu.spec.ts` | test 14 opens its own plan |
| `docs/conventions.md` | step 10 sentence; `live-test-plans` `list`/`purge` bullets |
| `docs/README.md` | one line |

Downstream: Deploy verifiers and flow tests can end with `purge '<their tag>'`. The Lead passes the tag in
their briefs until `live.recipes` is updated. Future specs follow the new step 10 sentence.

## Out of scope

Any app code (`apps/**`, `packages/**`); `playwright.config.ts`, `clone.profile.json`, `vitest.config.ts`
and every other always-overlap file; specs owned by other running Builds (named above); the `delete` and
`create` commands; calling the live app in any way.

## Acceptance

Every case runs locally. **Nobody calls `https://budget.doxen.dev` or opens the source app.** No compare
case: no screen changes.

1. **EXF-579 AC1 (prefix purge).** On the test's local dev server, create `ZZ-TEST A one`, `ZZ-TEST A two`,
   `ZZ-TEST B one` and an unprefixed `Keep me`. Run `purge 'ZZ-TEST A'`. Expected: exit 0, stdout exactly
   `deleted 2 remaining 0`, both A plans answer 404, and `ZZ-TEST B one` and `Keep me` answer 200.
   `list 'ZZ-TEST B'` prints exactly the B line, and `list 'ZZ-TEST A'` prints nothing.
2. **EXF-579 AC2 (bad prefix).** `purge 'Other'`, `list 'Other'`, `purge ''` and `purge 'ZZ-TEST A' extra`
   each exit 2. On the dev server the plan count is unchanged. Against the fake curl no request is
   logged. stderr names `ZZ-TEST` for the first three.
3. **EXF-579 AC3 (no argument).** With `ZZ-TEST B one` still present and `ZZ-TEST C one` added, `purge`
   prints `deleted 2 remaining 0` and exits 0. `Keep me` answers 200. The existing test `f` still passes.
4. **EXF-579 AC4 (never an unprefixed plan).** `purge 'ZZ-TEST'` on the dev server leaves `Keep me`
   (200). With the fake curl, the list holds `ZZ-TEST A x` (id 1) and `Mine` (id 2), and the re-read of
   id 1 answers the name `Mine too` (renamed). `purge 'ZZ-TEST A'` makes no DELETE call (fake log), prints
   nothing containing `Mine`, prints `deleted 0 remaining 1` and exits 1.
5. **EXF-579 limit per prefix.** After test `g` (51 `ZZ-TEST bulk<i>`), `purge 'ZZ-TEST bulk'` exits 3
   with `limit 50`, and `purge 'ZZ-TEST bulk1'` prints `deleted 11 remaining 0` (bulk1, bulk10 to bulk19).
6. **EXF-579 unchanged behaviour.** Every existing case in `live-test-plans.test.ts` passes unchanged,
   including the `refuses %j` table with its new rows. `pnpm check` passes.
7. **EXF-569 unit proof.** `pnpm e2e e2e/plans.spec.ts` runs the `pickLastOpened` test and the browser
   test, and both pass.
8. **EXF-569 rule inverted.** Temporarily change `>` to `<` in the `last_opened_at` comparison of
   `pickLastOpened` (`apps/web/src/shell/useCurrentPlan.ts`). Run `pnpm e2e e2e/plans.spec.ts`. Expected:
   both tests fail (unit: wrong id; browser: URL is `/<S>/budget`, not `/<A>/budget`). Revert, then
   `git diff --exit-code -- apps packages` is clean. Record the failing output (titles and the first
   assertion message).
9. **EXF-569 repeat.** `pnpm e2e e2e/plans.spec.ts e2e/plan-menu.spec.ts e2e/plan-urls.spec.ts e2e/shell.spec.ts --repeat-each=10`
   passes with 0 failures and 0 flaky. Report the passed count.
10. **EXF-569 full suite five times.** `pnpm e2e` runs five times in a row in the foreground with default
    parallelism, and each run passes with 0 failed and 0 flaky. Report the five pass counts.
11. **Scope.** `git diff --name-only origin/main...HEAD` lists only the manifest's files. Nothing under
    `apps/`, `packages/`, and neither `playwright.config.ts` nor `clone.profile.json`.
12. **Report.** Each step states for itself: "I did not open the source app and did not call the live app."

## Manifest

touches: [scripts/live-test-plans.sh, scripts/test/live-test-plans.test.ts, e2e/plans.spec.ts, e2e/plan-urls.spec.ts, e2e/plan-menu.spec.ts, e2e/support/plans.ts, docs/conventions.md, docs/README.md, docs/test-plans-isolation-design.md, docs/test-plans-isolation-spec.md]
shared: []
migrations: 0
