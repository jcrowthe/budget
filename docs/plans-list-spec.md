# Plans list and New Plan: implementation spec (EXF-469, EXF-471, EXF-746, EXF-798)

Design: [plans-list-design.md](plans-list-design.md). Behaviour, the relative-time table, the acceptance cases, the
Looking list and the Manifest are there; this file is the task list. **Commit after each part, in this order.**
Web only: nothing under `apps/worker/**`, no dependency, none of `paths.always_overlap`, none of brief note 9's
out-of-bounds files. Clicks in specs: `realClick` from `e2e/support/real-click.ts` (import only). Specs that check
a fault (EXF-798, EXF-746) are run once against the code **before** the fix, and the report quotes the failing line.

## Part 1: EXF-798, the bank logo

1. **Spec first** `e2e/plans-list-bank-logo.spec.ts`. Use `setup(page, request, (z) => [z.connection])` and
   `openList`/`openDetail` from `e2e/support/manage-connections-seed.ts`, the way `e2e/manage-connections.spec.ts`
   does, with a `zzBank({ logo: PNG_1PX })` connection (`PNG_1PX` = the base64 of a valid 1×1 PNG, a constant in the
   spec). Collect `page.on("console")` texts before opening the modal. Assert:
   - `await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)` > 0, for the list row's
     `.mc-logo img` and for one bank-account row's `.mc-logo img` in the detail;
   - no console text contains `ERR_INVALID_URL`.

   Run it on the present code and quote the failing line.
2. **Stand-in** `e2e/support/bank-link-stub.ts` `connectionJson`: `institution_logo: c.logo ?
   \`data:image/png;base64,${c.logo}\` : null`. Update the `logo` field's comment to "base64; served as the Worker
   serves it (`services/bank-connections.ts:123`)". Nothing else in the file changes.
3. **Fix** `apps/web/src/shell/manage-connections-logo.tsx:10`: `<img src={c.institution_logo} alt="" />`.
4. Verify: the new spec and `pnpm e2e e2e/manage-connections` pass.

## Part 2: shared fields, New Plan, Plan Settings width

1. **Spec first** `e2e/new-plan-placement.spec.ts` (design Acceptance 5), Plan Settings half first. For each size
   `[1440, 900]`, `[1024, 700]`: make your own plan through the API, open Plan Settings (`openSettings` from
   `e2e/support/plan-formats-seed.ts`), select each currency (`USD`, `EUR`, `CHF`, `SEK`, `KWD`) with
   `selectOption`, then each placement value (`before`, `after`, `none`), and evaluate on the placement select:
   ```ts
   const s = el as HTMLSelectElement; const cs = getComputedStyle(s);
   const ctx = document.createElement("canvas").getContext("2d")!; ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
   const text = s.selectedOptions[0]!.text;
   return { text, need: ctx.measureText(text).width + 24,
            room: s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), title: s.title };
   ```
   Expect `need <= room` and `title === text`, and the dialog's box inside the viewport. Wait for
   `document.fonts.ready` first. Run it now and quote the USD failure. The New Plan half (same loop, `#new-plan-*`
   via labels) is added in step 4.
2. **Fields component** `apps/web/src/plan-settings/new-plan-format-fields.tsx`:
   ```ts
   export type FormatValues = { code: string; numberFormat: string; placement: Placement; dateFormat: DateFormat };
   export const DEFAULT_FORMAT_VALUES: FormatValues;            // from DEFAULT_PLAN_FORMATS
   export function formatValuesOf(f: { currency_format: CurrencyFormat; date_format: { format: DateFormat } }): FormatValues;
   export function formatsInput(v: FormatValues): {
     currency_format: { iso_code: string; example_format: string; symbol_placement: Placement };
     date_format: { format: DateFormat };
   };
   export function PlanFormatFields(p: {
     idPrefix: "plan-settings" | "new-plan"; value: FormatValues; onChange: (next: FormatValues) => void;
   }): JSX.Element;
   ```
   - Move into it from `PlanSettingsDialog.tsx`: `label`, `common`, `dateLabel`, `placementLabel`, the
     `changeCurrency` rule (a currency change sets `numberFormat` and `placement` to the currency's defaults), and
     the four `<label>`/`<select class="field">` pairs.
   - Ids: `${idPrefix}-currency`, `-placement`, `-number-format`, `-date-format`.
   - Labels are unchanged: `Currency`, `Currency Placement`, `Number Format`, `Date Format`.
   - **Each select on its own row** (no `.plan-settings-row` wrapper).
   - The placement select gets `title={placementLabel(value.placement, symbol, value.numberFormat)}`.
   - It imports `./plan-settings.css`.
3. **Plan Settings** `PlanSettingsDialog.tsx`: keep the name, submit and PATCH logic. Hold one `FormatValues`
   state seeded with `formatValuesOf(plan ?? DEFAULT_PLAN_FORMATS)`, and compare it with the saved values as today
   to build the same patch. Render `<PlanFormatFields idPrefix="plan-settings" …/>`. `plan-settings.css`:
   - width `min(480px, calc(100vw - 32px))`;
   - delete `.plan-settings-row` and `.plan-settings-row > div`;
   - keep `select.field { text-overflow: ellipsis }`.

   Verify: `pnpm e2e e2e/plan-settings` passes unedited.
4. **New Plan** `apps/web/src/shell/NewPlanDialog.tsx` (signature `{ onClose: () => void }`; it may also receive and
   ignore `budgetId`):
   - Form `className="dialog form plan-settings new-plan"`, `role="dialog"`, `aria-modal="true"`,
     `aria-label="New Plan"`, `noValidate`.
   - Head: `<h2>New Plan</h2>` only.
   - Plan Name `#new-plan-name`, `maxLength={100}`, `autoComplete="off"`, focused on mount. A name error
     (`Plan name is required.`, `#new-plan-name-error`, `aria-invalid`, `aria-describedby`) clears on typing.
   - `<PlanFormatFields idPrefix="new-plan" value onChange />` starting at `DEFAULT_FORMAT_VALUES`.
   - API error `<p className="error" role="alert">{create.error.message}</p>`.
   - Footer `Cancel` (secondary), `Create Plan` (primary, `disabled={create.isPending}` only).
   - Escape on `document` calls `onClose` (the pattern of `PlanSettingsDialog`).
   - Submit: trim the name; if empty, show the error, focus the name and return. Otherwise
     `create.mutate({ name, ...formatsInput(values) }, { onSuccess: b => { onClose(); navigate(\`/${b.id}/budget\`) } })`.
5. **API** `apps/web/src/api/budgets.ts` `useCreateBudget`: in `onSuccess(b)`, if
   `qc.getQueryData(["budgets"])` exists, `setQueryData` with `[...list, b]`; otherwise `invalidateQueries`. There
   is no invalidation when the list exists.
6. **Spec** `e2e/new-plan.spec.ts`: design Acceptance 2–4.
   - Count requests with `page.on("request")`, filtering `POST` and `/api/v1/budgets`.
   - Expected EUR/JPY values come from `currencyByCode` and `NUMBER_FORMATS` (import from
     `../packages/schema/src/plan-formats-catalogue`; if Playwright's loader refuses, write the literals and say so).
   - Open the menu with `realClick` on the plan button, then `realClick` on `New Plan`.

   Then add the New Plan half of `new-plan-placement.spec.ts`. Verify: both specs, `pnpm e2e e2e/plans.spec.ts
   e2e/shortcuts.spec.ts e2e/plan-urls.spec.ts`.

## Part 3: relative time, the plans page, open and create

1. `packages/schema/src/plans-list-time.ts`: `export function lastUsedText(lastOpenedAt: string | null, now: number):
   string`, the design's table exactly. Unreadable is `Number.isNaN(Date.parse(x))`.
   `packages/schema/test/plans-list-time.test.ts`, now = `2026-11-18T12:00:00.000Z`:

   | Opened | Text |
   |-|-|
   | null | `Never opened` |
   | `"nope"` | `Never opened` |
   | now | `Last used just now` |
   | now − 59 s | `Last used just now` |
   | now + 5 min | `Last used just now` |
   | − 60 s | `Last used 1 minute ago` |
   | − 59 min 59 s | `Last used 59 minutes ago` |
   | − 60 min | `Last used 1 hour ago` |
   | − 23 h 59 min | `Last used 23 hours ago` |
   | − 24 h | `Last used yesterday` |
   | − 47 h 59 min | `Last used yesterday` |
   | − 48 h | `Last used 2 days ago` |
   | − 72 h | `Last used 3 days ago` |
   | − 29 d | `Last used 29 days ago` |
   | − 30 d | `Last used 1 month ago` |
   | − 59 d | `Last used 1 month ago` |
   | − 60 d | `Last used 2 months ago` |
   | − 364 d | `Last used 11 months ago` |
   | − 365 d | `Last used 1 year ago` |
   | − 730 d | `Last used 2 years ago` |
2. `apps/web/src/plans/plans-list-page.tsx` `export function PlansListPage()`:
   - `useDocumentTitle("Open Plan")` and `useBudgets()`. While loading, render nothing; on error, `<div
     className="card">Could not load plans.</div>`.
   - `const now = Date.now()`; order with `recentOtherPlans(plans, undefined, plans.length)`.
   - Markup: `<section className="plans-list" aria-labelledby="plans-list-heading"><h1 id=…>Your Plans</h1>
     <ul className="plans-list-grid" aria-label="Plans">` holding one `<PlansListCard>` per plan and the last `<li>`
     holding `<button type="button" className="plans-list-create">` (`PlusCircleIcon` + `Create New Plan`).
   - State: `creating` (renders `<NewPlanDialog onClose={…} />`; on close, focus the create button) and
     `deleting: Budget | null` (Part 4).
3. `apps/web/src/plans/plans-list-card.tsx` `export function PlansListCard({ plan, now, onDelete }: { plan: Budget; now:
   number; onDelete: (p: Budget, trigger: HTMLButtonElement) => void })`:
   - `<li className="plans-list-card">` holding a `<Link className="plans-list-open" to={planPath(plan.id)}
     aria-labelledby={\`plans-list-name-${id}\`} aria-describedby={\`plans-list-used-${id}\`}>`, with a thumbnail
     `<span aria-hidden>` (shell `PlanIcon`), `<span id className="plans-list-name" title={plan.name}>`, and
     `<span id className="plans-list-used">{lastUsedText(plan.last_opened_at, now)}</span>`.
   - Then `<button type="button" className="plans-list-delete" aria-label="Delete Plan" title="Delete Plan">`
     with `<TrashIcon />`.
   - `planPath(id)` (`shell/planPaths.ts:5`) gives `/<id>/budget`.
4. `apps/web/src/plans/plans-list.css`, **tokens only** (`shell/tokens.css`; a new token is added there and named
   in the report):
   - page padding `var(--space-3) var(--space-4)`; h1 24px/700;
   - grid `display:grid; grid-template-columns: repeat(auto-fill, 208px); gap: var(--space-3); list-style:none;
     padding:0`;
   - card `position:relative; width:208px; border-radius:12px; padding:var(--space-2);
     background:var(--backgroundTertiary)`;
   - link `display:flex; flex-direction:column; gap; color:inherit; text-decoration:none`, with `::after
     { content:""; position:absolute; inset:0 }` so the whole card is the link;
   - thumbnail height 144px, radius `var(--radius-xs)`;
   - name 16px/600 `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`; used line 14px/500
     `var(--labelSecondary)`;
   - `.plans-list-delete { position:absolute; right:8px; bottom:8px; z-index:1; visibility:hidden }`, and
     `.plans-list-card:hover .plans-list-delete, .plans-list-card:focus-within .plans-list-delete {
     visibility:visible }`;
   - hover and focus-within get a background token; `:focus-visible` on the link shows an outline on the card;
   - the create card has the same size.
5. `apps/web/src/pages/plans.tsx`: `export const page = { path: "/plans", element: <PlansListPage /> }`.
6. Spec `e2e/plans-list.spec.ts`: design Acceptance 6, 7, 8, 10, 11 (the `/plans` half) and 12. Helpers go in
   `e2e/support/plans-list-seed.ts`:
   - `ownPlan(request, label)`, which POSTs a `testName()` name;
   - `markOpened(request, id)`, which PATCHes `{opened:true}`;
   - `card(page, name)` = `page.getByRole("list", { name: "Plans" }).getByRole("listitem").filter({ has:
     page.getByRole("link", { name, exact: true }) })`.

   The order check: collect `getByRole("link")` names in the Plans list, filter to your own names, and compare.
   The empty-list stand-in uses `page.route` for GET only. Pair every route with `test.afterEach(({ page }) =>
   page.unrouteAll({ behavior: "ignoreErrors" }))`.

## Part 4: delete

1. `api/budgets.ts`:
   - `deleteBudget(id)` = `apiFetch(\`/api/v1/budgets/${id}\`, { method: "DELETE", idempotencyKey:
     crypto.randomUUID(), schema: z.object({ data: z.object({ deleted: z.literal(true) }) }) })` (`import { z } from "zod"`:
     `zod` is already a dependency of `apps/web` and is what `apiFetch` types against; no schema file is edited).
   - `useDeleteBudget()`: on success, `setQueryData<Budget[]>(["budgets"], l => l?.filter(b => b.id !== id))`. No
     invalidation.
2. `apps/web/src/plans/plans-list-delete.tsx` `export function DeletePlanDialog({ plan, onClose, onDeleted })`:
   - modelled on `account/link-account-unlink.tsx`: `dialog-backdrop` > `div.dialog.form.edit-account.plans-list-delete-dialog`
     with `role="dialog"`, `aria-modal`, `aria-label="Delete Plan"`; imports `../account/edit-account.css` (import
     only);
   - head `Delete Plan` + ✕ (`Close`); body `<p className="close-text">Are you sure you want to delete plan
     {plan.name}?</p>`;
   - error `<p className="error-bar" role="alert">{error.message}</p>`;
   - footer `Cancel` (secondary) and `Delete` (`destructive`, disabled while pending);
   - Escape on `document` cancels.

   `plans-list.css`: `.plans-list-delete-dialog .close-text { overflow-wrap: anywhere }`.
3. Page wiring:
   - the trash sets `deleting` and remembers the trigger;
   - Cancel, ✕ and Escape close and focus the trigger;
   - success closes and focuses `Create New Plan`.
4. Spec `e2e/plans-list-delete.spec.ts`: design Acceptance 9.
   - Count `DELETE` requests with `page.on("request")`.
   - For the 409 case, `page.route` on `**/api/v1/budgets/<id>`, DELETE only, answering `{ error: { id: "409",
     name: "conflict", detail: "ZZ refused" } }`.
   - Check the API state with `request.get` and `authHeaders()`.

   Delete only your own plans.

## Part 5: ways in and the shell on `/plans`

1. `apps/web/src/menu-actions/view-all-plans.ts`: `export const action: PlanMenuAction = { entry: "view-all-plans",
   run: ({ navigate }) => navigate("/plans") }`.
2. `shell/PlanMenu.tsx`:
   - remove `.filter((d) => d.id !== "open-plan" || others.length > 0)`;
   - change `{sub && others.length > 0 ? (` to `{sub ? (`;
   - inside the submenu, wrap the heading, the links and the `<hr>` in `{others.length > 0 ? <>…</> : null}`.
3. `pages/home.tsx`: when `pickLastOpened(data ?? [])` is undefined, return `<PlansListPage />`. Remove the "Create
   your first plan" card, and move `useDocumentTitle("Budget")` so it does not override the page's `Open Plan`
   (a parent's effect runs after its child's).
4. `shell/Sidebar.tsx`:
   - `const onPlansRoute = !!useMatch("/plans"); const atRoot = !!useMatch("/"); const plansPage = onPlansRoute ||
     (atRoot && !isLoading && !error && plans.length === 0); const noPlan = notFound || plansPage;`
   - Use `noPlan` where `notFound` hides the nav, the accounts card, Add Account, Bank Connections and the
     `planName` ("No Plan Open").
   - Render `.sidebar-resizer` only when `!plansPage`. Nothing else changes.
5. Departures in `e2e/plan-menu.spec.ts` (list them in the report):
   - test 7: `await expect(rows.nth(5)).not.toHaveAttribute("aria-disabled", "true")`;
   - test 8 becomes `"8 EXF-470/EXF-471: a single plan has Open Plan with only View All Plans"`. It expects the
     Open Plan row; `hoverIntoSubmenu` → `sub(page).getByRole("menuitem")` `toHaveText(["View All Plans"])`, and
     `Recent Plans` count 0. The `HR`-after-New-Plan check becomes: the section after Open Plan's starts with `HR`.
6. Spec `e2e/plans-list-ways-in.spec.ts`: design Acceptance 11 (the `/` half), 13 and 14.
7. Verify: `pnpm e2e e2e/plan-menu.spec.ts e2e/plan-menu-registry.spec.ts e2e/sidebar-not-found.spec.ts
   e2e/shell-compare.spec.ts e2e/sidebar-collapse.spec.ts e2e/plans.spec.ts e2e/plan-urls.spec.ts`.

## Part 6: narrow window and long names

1. Spec `e2e/plans-list-narrow.spec.ts`, design Acceptance 15:
   - columns = `getComputedStyle(grid).gridTemplateColumns.split(" ").length`, at 1024×700 versus 1440×900;
   - the 100-character name is `"ZZ-TEST " + random + "x".repeat(...)`, exactly 100 characters.
2. Fix what it finds; the dialogs already use `calc(100vw - 32px)` and `max-height: calc(100vh - 32px)`.
3. Run the Looking states yourself once at both sizes, before handing over.

## Finally

- `docs/README.md`: one line for the design (the Architect added it). Add one line for `plans-list-polish.md`
  when the Designer writes it.
- `pnpm check` green (biome, typecheck, unit, Worker, build, repository tests: formatter, branding, positional
  inserts). Run the specs of this Build with `pnpm e2e {specs}`; final_gate runs the full suite.
- Report: the failing lines of Parts 1 and 2; every edited existing expectation (the plan-menu tests 7 and 8 only);
  any new token; confirmation that no file outside the design's Manifest changed.
