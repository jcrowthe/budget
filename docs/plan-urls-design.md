# Plan-scoped URLs, page titles and browser history (EXF-475)

## Feature

Every screen URL starts with the open plan's id. The tab title is `<Screen> | <Plan name> | Budget`. Back and
Forward walk through in-app navigation with no page reload. `/` opens the plan that was opened most recently,
which the server now records as `budgets.last_opened_at`. The screens keep their placeholder content: this
ticket covers only the URL, title and history contract. Later Builds fill in the pages.

## Source

Study notes: `/workspace/scratch/source/plan-urls/notes.md`, with masked screenshots `plan.png`,
`all-accounts.png`, `account.png`, `reflect.png` and `unknown-account.png` in the same directory. It was
observed on 2026-11-15 on the Test Budget plan, when the current month was 2026-11. Summary:

- **Title.** The title is `<Page> | Test Budget | YNAB`, and it is only `YNAB` for about 1 s during a hard
  load. The Plan title never includes the month. Report titles: `Spending Breakdown`, `Spending Trends`,
  `Net Worth Report`, `Income v Expense Report`, `Age Of Money` (capital O). An account's title is its name.
- **Pushes.** Every sidebar click, month arrow and Reflect tab pushes one history entry. Back and Forward
  restore the URL, title and on-screen month without a reload. The observed sequence (Plan, All Accounts, an
  account, Reflect, Back x3, Forward) matches the ticket.
- **Sidebar Plan link.** It points at `/budget/<last viewed month>`. That value is held in memory, so it is the
  current month again after a reload.
- **Replaces** (client side; the server returns 200 for every path):
  - `/budget` with no month keeps the URL `/budget` and shows the current month.
  - A malformed or out-of-range month (`abcdef`, `202613`, `190001`, a month before the plan's first month,
    or past the allowed month) is replaced with the current month. It is not clamped to the nearest allowed
    month.
  - `/reflect` is replaced with the last report used, which is stored per plan in localStorage; the first time
    it is `spending-breakdown`. An unknown report (`/reflect/foo`) is replaced with `/budget`.
  - An unknown account (`/accounts/<made-up id>`) is silently replaced with `/accounts`.
  - Any other unknown sub-path, or one with extra segments (`/nonexistent`, `/budget/202611/extra`,
    `<P>/`), is replaced with `/budget`.
- **No URL change.** The plan menu, Plan Settings, Display Options and the month picker change neither the URL
  nor history.
- **Sidebar highlight.** On an account page only the account row is highlighted, not All Accounts. Reflect is
  highlighted on every report.
- **Unknown plan id.** Not observed: opening another plan id in the source is forbidden.

## Approach

1. **Plan scope in the router.** `apps/web/src/router.tsx` keeps the file convention: every
   `pages/*.tsx` exports `page = { path, element }`. A page whose path starts with `/:budgetId/` is nested,
   prefix removed, under one layout route `/:budgetId` whose element is a new `shell/PlanScope.tsx`. PlanScope:
   - resolves the plan from the plan list;
   - shows nothing while the list loads, and the **Plan not found** state for an unknown or deleted id (it
     never falls back to another plan);
   - records the open (see 3) and renders `<Outlet/>`.

   The plan scope gets two built-in children. The index route (`/<id>`) replaces itself with `/<id>/budget`.
   The `*` route replaces any unknown sub-path with `/<id>/budget`. `PlanGate` is removed, because pages no
   longer wrap themselves.
2. **Pages** (placeholders, files under `apps/web/src/pages/`):

   | URL | Page file | Behaviour | Title screen name |
   |---|---|---|---|
   | `/:budgetId/budget/:month?` | `plan.tsx` (existed as `/:budgetId/budget`) | no month: stays `/budget` and shows the current local month. An invalid `YYYYMM`: **replace** with `/budget/<current local month>`. Otherwise the header shows the month (`Nov 2026`) | `Plan` |
   | `/:budgetId/accounts` | `accounts.tsx` (existed) | unchanged | `All Accounts` |
   | `/:budgetId/accounts/:accountId` | `account.tsx` (new) | no accounts exist yet (EXF-481), so every id is **replaced** with `/<id>/accounts`, as in the source (polish P1) | `All Accounts` |
   | `/:budgetId/reflect/:report?` | `reflect.tsx` (existed as `/:budgetId/reflect`) | no report: **replace** with `/reflect/spending-breakdown`. Unknown report: **replace** with `/<id>/budget` (no month, polish P2). Header stays `Reflect` | report title from the table in the spec |
   | `/:budgetId`, `/:budgetId/<anything else>` | router built-ins | **replace** with `/<id>/budget` | — |
   | `/` | `home.tsx` (existed) | **replace** with `/<latest opened plan>/budget`. With no plans, the existing "Create your first plan" card | `Budget` |
   | other `*` | `not-found.tsx` (existed) | unchanged | — |

   All Navigate redirects use `replace`, so a redirected URL never leaves a history entry of its own. Sidebar
   links push. The month comes from the URL. A programmatic change goes through
   `usePlanMonth().setMonth(month)`, which pushes `/<id>/budget/YYYYMM`; EXF-493's arrows will call it.
3. **`last_opened_at`.**
   - Migration `20261115204324_budgets_last_opened_at.sql`:
     `ALTER TABLE budgets ADD COLUMN last_opened_at TEXT;`. It is nullable and additive.
   - The existing `PATCH /api/v1/budgets/{id}` accepts a new optional body field **`opened: true`**. Only the
     literal `true` is allowed; anything else is a 400. The server stamps `last_opened_at = now` in ISO 8601,
     so the client clock is never trusted.
   - **Opening is not a change.** A PATCH with only `opened` writes **no `change_log` row** and leaves
     `updated_at` (`last_modified_on`) unchanged. It is a plain `UPDATE … WHERE id = ? AND deleted_at IS
     NULL`, and 0 changed rows gives a 404.
   - With `name` as well, the existing guarded batch runs (one change_log `update` row) and the same UPDATE
     also sets `last_opened_at`.
   - `Budget` gains `last_opened_at: string | null` in list, get, create (null), PATCH responses and the MCP
     `list_budgets` output (through `toApi`, with no change to the tool file).
   - No new path is added: the OpenAPI path list is unchanged. Only the `Budget` and `BudgetUpdate` component
     schemas change.
4. **Recording an open (web).** PlanScope calls `PATCH {opened: true}` once each time the resolved plan id
   changes: a hard load, a plan-menu switch, or a newly created plan. A ref keyed by plan id stops StrictMode
   and child navigations from repeating it. On success, the returned budget replaces its entry in the
   `["budgets"]` query cache with no invalidation. Errors are ignored (no UI, no retry). The localStorage key
   `budget.lastPlanId` is dropped: the server is the single source of the last-used plan, the same on every
   device.
5. **Choosing the last-opened plan.** `pickLastOpened(plans)` returns the plan with the greatest
   `last_opened_at`, comparing ISO strings. When no plan has a value, it returns the first in list order (the
   list is ordered by `created_at`). Home uses it, and so does the Sidebar when the URL has no known plan.
6. **Titles.**
   - `usePageTitle(screen)` stays as it is (`<screen> | <plan.name> | Budget`, or `Budget` while loading). It
     reads the name from the `["budgets"]` cache, so a rename that updates the cache (any later rename UI), or
     a refetch (every page mount refetches, because staleTime is 0, and so does window focus) changes the
     title.
   - PlanScope's not-found state sets `Plan Not Found | Budget`.
7. **Sidebar.**
   - Plan link: `/<id>/budget/<m>`. `m` is the URL's month while on the Plan route, else the last month
     viewed for that plan in this page session (an in-memory map), else the current month. The link is
     active on any `/<id>/budget…` URL.
   - Reflect link: `/<id>/reflect`, active on `/reflect/*`.
   - All Accounts link: `/<id>/accounts` with `end`, so it is **not** active on an account page, as in the
     source.
   - The links target `plan?.id ?? pickLastOpened(plans)?.id`. They never point at an unknown id; with no
     plan the target is `/`.
   - The class stays `active`, so the existing CSS and e2e selectors keep working.
8. **Menus and dialogs** (PlanMenu, NewPlanDialog, AddAccountDialog) stay component state. They neither
   navigate nor touch history.

## What changes

- **Worker:**
  - `db/schema/budgets.ts` gets `lastOpenedAt`.
  - `repositories/budgets.ts` gets `markOpenedStmt`, and `updateStmt` gets an optional `lastOpenedAt`.
  - `services/budgets.ts` changes `toApi` and `updateBudget` (the opened-only branch).
  - `routes/budgets.ts`: no code change is expected; the schema flows through.
  - The new migration.
- **Schema:** `packages/schema/src/budgets.ts` adds `Budget.last_opened_at` and `BudgetUpdate.opened`.
- **Web:**
  - `router.tsx`: plan-scope nesting.
  - New `shell/PlanScope.tsx` and `shell/planPaths.ts`; `shell/PlanGate.tsx` is deleted.
  - `shell/useCurrentPlan.ts` gets `pickLastOpened` and loses the localStorage key.
  - `shell/Sidebar.tsx`: links and active states.
  - `api/budgets.ts`: `updateBudget`, `useMarkOpened`.
  - Pages: `plan.tsx`, `reflect.tsx`, `accounts.tsx`, `home.tsx`, and the new `account.tsx`.
- **Tests:**
  - `apps/worker/test/budgets.test.ts` (extended).
  - New `e2e/plan-urls.spec.ts`.
  - `e2e/shell.spec.ts` changes for the Reflect URL and title.
  - `e2e/plans.spec.ts` changes for the `/budget/YYYYMM` URL and a race-safe `/` assertion (see the spec).
- **User-visible:**
  - Canonical month URLs.
  - Report titles.
  - The account not-found state.
  - `/` follows the server's last-opened plan, not this browser's localStorage.

## Downstream effects

- New plan screens register `pages/<x>.tsx` with a `/:budgetId/...` path. They are nested in PlanScope
  automatically, never need a gate, and get the plan from `useCurrentPlan()`.
- EXF-493 (month controls) calls `usePlanMonth().setMonth`, and adds the range clamp: before the first month or
  after the allowed month goes to the current month.
- EXF-481 (accounts) replaces `account.tsx`'s not-found card with the register. The title becomes the
  account's name, and an unknown id keeps the not-found card.
- The Reflect ticket adds the tab bar (buttons that push `/reflect/<report>`) and may remember the last report.
- EXF-471 (plans list) gives the not-found link its final target, and uses `Open Plan | Budget`.
- `/` now depends on server state. Parallel e2e specs that open plans can change which plan `/` picks, so any
  `/` assertion must compare against the list response the page itself received (see the spec).
- EXF-485 is not affected: it touches no file in this manifest. The `Budget` schema only gains a field.

## Out of scope

Screen content; the month arrows, month picker and month range; the Reflect tab bar; the plans list page and
its `Open Plan` title; Plan Settings and rename UI; account data.

## Differences from the source kept on purpose

1. **`/budget` with no month** keeps the URL `/budget` and shows the current month, as the source does (polish
   P2). Only the sidebar link and a malformed month use `/budget/YYYYMM`.
2. **Out-of-range months** are not detected: only a malformed month (anything other than `YYYYMM` with year
   19xx–20xx and month 01–12) falls back to the current month. The plan's month range does not exist until
   EXF-485 and EXF-493.
3. **Unknown account:** silently replaced with `/accounts`, as in the source (polish P1; this supersedes the
   not-found card of the Lead's note 1).
4. **`/reflect`** always lands on `spending-breakdown`, which is ticket AC2. The source's "last report"
   memory belongs with the Reflect tab bar.
5. **Unknown plan link** goes to `/` (Lead's note 4; the plans list is EXF-471). A single-segment unknown
   path such as `/foo` is read as a plan id and shows Plan not found.
6. **Loading title** is `Budget` (the source shows `YNAB`), because of branding.
7. **Current month** is the user's local month. The source shows the same, so the clone does not use the
   Worker's UTC month here.

## Acceptance

`<id>` is a plan created for the test, named `ZZ-TEST <random>` (shortened to `<name>` below). `M` is the
current local month as `YYYYMM`, and `M+1` the next. "No reload" means a `window.__marker` set before the
step is still there after it. Compare cases name the source state to open live in this Thread's source tab,
on the Test Budget plan: replace `<id>` with `542b334b-696e-4418-937a-5e2c21a8b45c`, compare titles with
`Budget` in place of `YNAB`, and compare the URL path pattern.

1. **Plan URL (compare).** Hard-load `/<id>/budget`. The URL stays `/<id>/budget`, history gains no extra
   entry, the title is `Plan | <name> | Budget`, the header shows the month (`Nov 2026`), and the sidebar
   Plan link is active. Source: `/budget`, title `Plan | Test Budget | YNAB`.
2. **Month URLs.**
   - Hard-load `/<id>/budget/M+1`: the URL stays, and the header shows that month.
   - Hard-load each of `/<id>/budget/abcdef`, `/202613` and `/2026`: the URL is replaced with
     `/<id>/budget/M`.
   - Source (compare): `/budget/abcdef` is replaced with `/budget/202611`.
3. **All Accounts (compare).** Hard-load `/<id>/accounts`: the title is `All Accounts | <name> | Budget`,
   and the All Accounts link is active. Source: `/accounts`, same pattern.
4. **Account route.** Hard-load `/<id>/accounts/00000000-0000-0000-0000-000000000000`:
   - The URL is replaced with `/<id>/accounts` (as in the source; polish P1).
   - The sidebar shows the plan, and the All Accounts link is active.
   - The title is `All Accounts | <name> | Budget`. There is no not-found card.
5. **Reflect (compare).** Hard-load `/<id>/reflect`: the URL is replaced with
   `/<id>/reflect/spending-breakdown`, and the title is `Spending Breakdown | <name> | Budget`. Hard-load
   each of the other reports; the URL stays and the title matches:

   | Report URL | Title |
   |---|---|
   | `spending-trends` | `Spending Trends \| …` |
   | `net-worth` | `Net Worth Report \| …` |
   | `income-expense` | `Income v Expense Report \| …` |
   | `age-of-money` | `Age Of Money \| …` |

   Reflect is active on each. `/<id>/reflect/foo` (and `/reflect/constructor`) is replaced with `/<id>/budget`. Source: the same report
   URLs and titles.
6. **Hard reload.** On each URL from cases 1 to 5, `page.reload()` renders the same screen and title.
7. **Unknown sub-paths.** Hard-load `/<id>`, `/<id>/nonexistent` and `/<id>/budget/M/extra`: each ends at
   `/<id>/budget`.
8. **History sequence (compare).**
   1. Hard-load `/<id>/budget/M` and set the marker.
   2. Click All Accounts, then go in-app to `/<id>/accounts/<made-up id>`. There is no account row yet, so the
      test pushes it through the history API; it is replaced with `/accounts` (polish P1), leaving two
      `/accounts` entries.
   3. Click Reflect, which lands on `/reflect/spending-breakdown`.
   4. Press Back 3 times. The steps are `/accounts` (`All Accounts | …`), `/accounts` again (the pushed
      entry that was replaced), then `/budget/M` (`Plan | …`).
   5. Press Forward once: `/accounts` and `All Accounts | …`.

   The plan name is kept at every step and the marker survives. Source: the same sequence from Plan.
9. **Month push.**
   1. On `/<id>/budget/M`, change the month in-app to `M+1` (until EXF-493 adds arrows, push through the
      history API). The header shows the new month, and history gains one entry.
   2. Press Back: `/budget/M` and its month return with no reload.
   3. The sidebar Plan link points at `/budget/M+1` after visiting it and then moving to All Accounts.

   Source: month arrow Nov → Dec, then Back.
10. **Menus and dialogs (compare).** On `/<id>/budget/M`, record `location.href` and `history.length`, then
    open and close (Escape or Close) each of these:
    - the plan menu;
    - the plan menu's Open Plan submenu;
    - the New Plan dialog;
    - the Add Account dialog.

    Both values are unchanged. Source: the plan menu, Plan Settings and Display Options, each closed with
    Escape.
11. **Rename updates the title.**
    1. On `/<id>/budget/M`, `PATCH /api/v1/budgets/<id>` with `{name: "<name> R"}`.
    2. Click All Accounts.
    3. The title becomes `All Accounts | <name> R | Budget`, and the sidebar button shows the new name.
12. **Unknown plan.**
    - Hard-load `/<random uuid>/budget`: "Plan not found" and a link that goes to `/`. The title is
      `Plan Not Found | Budget`, the URL is unchanged, and no other plan's name appears in the sidebar
      button.
    - Hard-load a deleted plan's id: the same result.
13. **Root opens the last-opened plan.**
    1. Create A and B. Open `/<A>/budget`, then `/<B>/budget`, then `/<A>/budget`.
    2. Hard-load `/`. It lands on `/<X>/budget`, where X is the plan with the greatest `last_opened_at` in
       the `GET /api/v1/budgets` response the page loaded; with this worker alone, that is A.
    3. Switch to B with the plan menu's Open Plan submenu: the URL becomes `/<B>/budget`, and B's
       `last_opened_at` (GET) is later than A's.
14. **API.**
    - `PATCH /api/v1/budgets/<id>` with `{opened: true}` returns 200, with `last_opened_at` set within a few
      seconds of now and `last_modified_on` unchanged.
    - The change_log for `<id>` gains no row.
    - The list and get return the same `last_opened_at`.
    - `{opened: false}` returns 400, and so does `{opened: "yes"}`.
    - With a deleted or unknown id, the result is 404.
    - `{name, opened: true}` returns 200, with one change_log `update` row and both fields changed.
    - A new plan has `last_opened_at: null`.
    - The OpenAPI path list test (`apps/worker/test/openapi.test.ts`) passes unedited.
    - MCP `list_budgets` returns `last_opened_at`.

## Manifest

touches: [docs/plan-urls-design.md, docs/plan-urls-spec.md, docs/README.md, docs/conventions.md, apps/worker/migrations/20261115204324_budgets_last_opened_at.sql, apps/worker/src/db/schema/budgets.ts, apps/worker/src/repositories/budgets.ts, apps/worker/src/services/budgets.ts, apps/worker/src/routes/budgets.ts, packages/schema/src/budgets.ts, apps/worker/test/budgets.test.ts, apps/web/src/router.tsx, apps/web/src/shell/PlanScope.tsx, apps/web/src/shell/PlanGate.tsx, apps/web/src/shell/planPaths.ts, apps/web/src/shell/useCurrentPlan.ts, apps/web/src/shell/Sidebar.tsx, apps/web/src/api/budgets.ts, apps/web/src/pages/plan.tsx, apps/web/src/pages/reflect.tsx, apps/web/src/pages/accounts.tsx, apps/web/src/pages/account.tsx, apps/web/src/pages/home.tsx, e2e/plan-urls.spec.ts, e2e/shell.spec.ts, e2e/plans.spec.ts]
shared: [apps/web/src/router.tsx (nest /:budgetId pages under the PlanScope layout, keeping the page file convention), apps/web/src/shell/** (PlanScope replaces PlanGate; Sidebar links and active states; pickLastOpened; planPaths helpers)]
migrations: 1
