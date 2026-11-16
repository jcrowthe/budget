# Categories spec (EXF-494, EXF-495)

Implements [categories-design.md](categories-design.md); its rules (R1–R9), API table and acceptance are the
contract. Follow `docs/conventions.md`. Verify each task with `pnpm check`; e2e with
`pnpm e2e e2e/categories.spec.ts e2e/categories-hidden.spec.ts e2e/plan-grid.spec.ts e2e/assigned.spec.ts`.
**Do not edit** `repositories/transactions.ts`, `services/transactions.ts`, `services/months.ts`,
`api/months.ts`, `shell/**`, `packages/core/src/**`, `test/openapi.test.ts`, `test/mcp.test.ts`,
`test/existing-surface.test.ts`, `e2e/mcp.spec.ts`, or any `paths.always_overlap` file. No migration.

## T1. Schemas: `packages/schema/src/categories.ts` (append; existing exports unchanged)

```ts
const groupName = z.string().trim().min(1, "The group name is required.").max(100);
const categoryName = z.string().trim().min(1, "The category name is required.").max(100);
CategoryGroupNew    = z.object({ name: groupName }).openapi("CategoryGroupNew")
CategoryNew         = z.object({ group_id: z.string().min(1), name: categoryName }).openapi("CategoryNew")
CategoryGroupUpdate = z.object({ name: groupName.optional(), hidden: z.boolean().optional(),
                        collapsed: z.boolean().optional() })
                        .refine(v => Object.values(v).some(x => x !== undefined), "Nothing to update")
CategoryUpdate      = z.object({ name: categoryName.optional(), hidden: z.boolean().optional() }).refine(… same)
CategoryUsage       = z.object({ category_count: int, transaction_count: int, has_assigned: z.boolean(),
                        has_history: z.boolean() })
CategoryDeleted     = z.object({ category_ids: z.array(z.uuid()), group_id: z.uuid().nullable(),
                        reassigned_to: z.uuid().nullable(), transactions_moved: int, months_merged: int })
CategoriesUnhidden  = z.object({ group_ids: z.array(z.uuid()), category_ids: z.array(z.uuid()) })
// responses, each dataEnvelope(...).openapi(name):
CategoryGroupResponse {category_group: CategoryGroup}; CategoryResponse {category: Category};
CategoryUsageResponse {usage}; CategoryDeletedResponse {deleted}; CategoriesUnhiddenResponse {unhidden}
```
Export the inferred types. `group_id` is `z.string().min(1)` so a non-uuid answers **404**, not 422: the service 404s any id that is not a
uuid or not found (like `isUuid` in `services/month-categories.ts`). Same for path ids and `reassign_to` (422).

## T2. Repositories

`repositories/category-groups.ts` (add):
- `minSort(db, budgetId): Promise<number | null>`; `sortIsFirst(db, budgetId, sort)`: SELECT 1 while
  `coalesce(min(sort_order), 1) - 1 = sort` over active groups.
- `nameFree(db, budgetId, name, exceptId?)`: SQL condition `not exists (active group of the plan, id ≠ exceptId,
  lower(trim(name)) = lower(trim(:name)))`; `nameTaken(...)`: async read of the same.
- `newGroupGuard(db, budgetId, sort, name)` = sortIsFirst AND nameFree; `insertIfStmt(db, row, guard)`.
- `holds(db, id, updatedAt)`: SELECT 1 while the active row still has `updated_at`.
- `updateIfStmt(db, id, set: Partial<{name, hidden, collapsed, updatedAt}>, guard: SQL)`.
- `softDeleteStmt(db, id, now, guard)`.

`repositories/categories.ts` (add, same shapes, scoped by `group_id`): `minSort`, `sortIsFirst`, `nameFree(db,
groupId, name, exceptId?)`, `nameTaken`, `newCategoryGuard`, `insertIfStmt(db, row, guard)`, `holds`,
`updateIfStmt`, `findInPlan(db, budgetId, id)` (active, group active, returns row with its group's `hidden`),
`listActiveInGroup(db, groupId)`, and set statements:
- `setHiddenInGroupStmt(db, groupId, hidden, now, opts: {exceptId?: string; onlyIfHidden?: boolean})`.
- `unhideAllStmt(db, budgetId, now)`; group counterpart `unhideAllGroupsStmt` in category-groups.
- `softDeleteManyStmt(db, ids, now, guard)`.
- `historyOf(db, budgetId, ids): Promise<{transactions: number; assignedMonths: number}>` (R5).
- For change_log rows of set updates, `logHiddenChangesStmt(db, entry base, where)`: an `INSERT INTO change_log
  … SELECT` over the rows about to change, building `before_json` / `after_json` with `json_object(...)` in the
  `categoryToApi` shape. Ids: `lower(hex(randomblob(16)))` formatted 8-4-4-4-12 (`substr` pieces).

`repositories/month-categories.ts` (add): `mergeIntoStmt(db, budgetId, fromIds, targetId, now, guard)` (R7.4,
`INSERT … SELECT … WHERE <guard> GROUP BY month ON CONFLICT(budget_id, month, category_id) DO UPDATE SET
assigned = month_categories.assigned + excluded.assigned, updated_at = excluded.updated_at`; note SQLite needs
the `WHERE` before `ON CONFLICT` in an upsert-select) and `logMergeStmt(db, …)` (R7.3).

New `repositories/category-reassign.ts`: `logMovesStmt(db, {budgetId, actor, fromIds, targetId, guard})` (R7.1)
and `moveTransactionsStmt(db, budgetId, fromIds, targetId, guard)` (R7.2: active rows only, `deleted_at is
null`). Both return unexecuted statements.

Verify: unit-level through T7 tests.

## T3. Services: `services/categories.ts` (add; keep `createCategoryGroup`, `createCategory` unchanged)

Errors (exported, mapped by routes; MCP throws them as is):
```ts
export class NameTaken extends Error {}            // 422 name_taken, message per entity (design API)
export class HistoryExists extends Error {}        // 409 history_exists, detail with counts
export class InvalidReassignTarget extends Error {} // 422 invalid_reassign_target
```
Use cases, all `(env, actor, input)`; each mutation is one `db.batch` with its change_log rows, guarded and
retried up to 5 times like the existing creates, then `Conflict`:
- `addCategoryGroup(env, actor, {budget_id, name}): Promise<CategoryGroup>`: R1, R2 (top), name check before
  the loop (fast 422) and inside the guard; after a lost race, `nameTaken` → `NameTaken`.
- `addCategory(env, actor, {budget_id, group_id, name}): Promise<Category>`: same; 404 for a missing group.
- `updateCategoryGroup(env, actor, {budget_id, group_id, name?, hidden?, collapsed?}): Promise<CategoryGroup>`:
  read `before`; rename checks `nameFree(except self)`; `hidden: false` also unhides all its categories (R3)
  with set-log rows; `hidden: true` sets the group only; `collapsed` only → no change_log row (R4). Guard every
  statement on `holds(id, before.updatedAt)`.
- `updateCategory(env, actor, {budget_id, category_id, name?, hidden?}): Promise<Category>`: rename within its
  group; `hidden: false` while the group is hidden → R3's three writes in one batch (category, group, siblings
  `hidden = 1` where they had 0), each logged.
- `unhideAll(env, actor, budgetId): Promise<CategoriesUnhidden>`: R3; returns the ids that changed.
- Thin wrappers for MCP naming are not needed: tools call these.

Every logged `after` is the API shape (`groupToApi` / `categoryToApi`) of the row after the change; entity types
`category_group` and `category`, action `update` (create: `create`).

## T4. Delete: new `services/category-delete.ts`

```ts
export interface DeletePlan { budgetId: string; actor: string; now: string;
  categoryIds: string[]; group: CategoryGroupRow | null; categories: CategoryRow[];
  targetId: string | null; targets: TargetRow[] }
export function buildDeleteBatch(db: Db, p: DeletePlan): BatchItem[]   // test seam, R6/R7 order
export async function categoryUsage(env, budgetId, categoryId): Promise<CategoryUsage>
export async function groupUsage(env, budgetId, groupId): Promise<CategoryUsage>
export async function deleteCategory(env, actor, {budget_id, category_id, reassign_to?}): Promise<CategoryDeleted>
export async function deleteCategoryGroup(env, actor, {budget_id, group_id, reassign_to?}): Promise<CategoryDeleted>
```
- Validate the plan (404), the row (404), then `reassign_to` when given (R8 → `InvalidReassignTarget`), then
  history (R5). History and no `reassign_to` → `HistoryExists("Category has history (N transactions, assigned
  amounts); pass reassign_to")` (list only what exists; for a group "Category group has history …").
- No history: batch = log rows + soft-deletes, guarded on "still no history" (no active transaction, no
  non-zero cell for the ids). `reassign_to` given but no history: still valid; nothing to move.
- With history: R7 order exactly; G as a single `SQL` built once: every id in `categoryIds` has
  `deleted_at is null` (on `categories` only, **not** their group's row, which step 6 deletes first) and the
  target and its group are active; the final categories soft-delete guarded on the
  target part only; success = last result `meta.changes > 0`; else re-read and throw `NotFound("Category")`,
  `InvalidReassignTarget`, or retry.
- `targets` rows of the deleted categories: read before the batch; log (`targetToApi` from
  `services/targets.ts`, entity `target`, action `delete`) and delete each (`deleteIfHoldsStmt` or a plain delete
  guarded by G).
- Returned `transactions_moved` / `months_merged` come from the counts read before the batch (the guard makes them
  exact or the batch a no-op).

## T5. Routes (new files, `export default` an `OpenAPIHono<AppEnv>` with the 422 `defaultHook` of
`routes/accounts.ts`)

- `routes/category-groups.ts`: `POST /budgets/{budget_id}/category_groups`, `PATCH
  /budgets/{budget_id}/category_groups/{group_id}`, `DELETE /budgets/{budget_id}/category_groups/{group_id}`
  (query `reassign_to: z.string().min(1).optional()`), `GET /budgets/{budget_id}/category_groups/{group_id}/usage`.
- `routes/categories.ts`: `POST /budgets/{budget_id}/categories`, `PATCH|DELETE
  /budgets/{budget_id}/categories/{category_id}`, `GET /budgets/{budget_id}/categories/{category_id}/usage`,
  `POST /budgets/{budget_id}/categories/unhide_all` (register `unhide_all` before `{category_id}` routes).
- Map: `NameTaken` → 422 `name_taken`; `InvalidReassignTarget` → 422 `invalid_reassign_target`;
  `HistoryExists` → 409 `history_exists`; `NotFound`/`Conflict` fall through to `onError`. Declare 404, 409, 422
  in each `createRoute` response list. Actor: `c.get("identity").actor`.

## T6. MCP (new files `mcp/tools/category-groups.ts`, `mcp/tools/categories.ts`)

`export const tools: McpToolDef[]` with the eight tools of the design, inputs `budget_id: z.string().min(1)`, ids
`z.string().min(1)`, `name: z.string()`, `hidden: z.boolean()`, `reassign_to: z.string().min(1).optional()`.
`rename_*` → `update*({name})`, `set_*_hidden` → `update*({hidden})`. Results are exactly the REST `data`
(e.g. `{category}`, `{category_group}`, `{deleted}`). Descriptions say names are trimmed and unique, new rows go
to the top, delete needs `reassign_to` when history exists, and hidden rows still count in Ready to Assign.

## T7. Worker tests (new files; `ZZ-TEST <random>` plans; `apiPaths()` / `listedToolNames()` from
`test/surface.ts` for each file's own paths and tools)

- `category-groups.test.ts`: POST puts the group first (sort below the default groups') and logs `create` with
  `user:tester@localhost`; empty name 422 with "The group name is required."; duplicate ("bills", " Bills ")
  422 `name_taken`; a deleted group's name is reusable; PATCH name (emoji kept), self-case rename allowed; PATCH
  `{collapsed: true}` → read model `collapsed: true` and **no** new change_log row; PATCH `{}` 422; unknown plan
  / group 404; MCP `create_category_group`, `rename_category_group`, `set_category_group_hidden` return the REST
  shape and log `mcp:…`.
- `categories.test.ts`: POST to the top of the group; duplicate in the same group 422, same name in another
  group 201; `group_id` unknown or of another plan 404; rename rules; MCP `create_category`, `rename_category`
  equal REST; surface assertions for every path of both route files and all eight tools.
- `category-hidden.test.ts`: hide a category with 15000 assigned → read model `hidden: true`, group subtotal
  without it, `ready_to_assign` unchanged; hide a group then PATCH one of its categories `{hidden:false}` →
  group visible, that category visible, siblings `hidden: true`, `sort` values unchanged; PATCH group
  `{hidden:false}` → all its categories visible; `unhide_all` → nothing hidden, returned ids; each change has a
  change_log row with the actor; `set_category_hidden` over MCP equals the PATCH.
- `category-delete.test.ts`:
  - no history → 200 at once, `deleted_at` set, group delete removes its categories; 409 `history_exists`
    without `reassign_to` (a transaction via `createTransaction`, or a cell via `setAssigned`); 422 for each R8
    case; 404s.
  - **Engine example** (fixed months `2026-10-01`… like `months.test.ts`): cash account; Fun Oct assigned
    45000, Oct activity −45000, Nov activity −50000; Target Nov assigned 15000; a target row on Fun. Record
    `ready_to_assign` for Sep–Jan; DELETE Fun `?reassign_to=Target` → Target Oct `[45000, -45000, 0]`, Nov
    `[15000, -50000, -35000]`; RTA equal in Sep, Oct, Nov; **Dec RTA = before + 15000** (R9); Fun gone; Fun's
    targets row gone; transactions point at Target; change_log rows for each transaction, each merged month,
    the target and the category, all with the actor.
  - **No overspending example**: Fun Oct 20000/−5000, Target Oct 10000 → after: Target Oct 30000/−5000/25000,
    Nov carried 25000; RTA unchanged in every month Sep–Jan.
  - Group delete with reassignment merges every category of the group (hidden one included).
  - **Atomicity**: `db.batch([...buildDeleteBatch(db, plan), failingStmt])` (e.g. an insert into `change_log`
    with a `null` actor) rejects, and transactions, month_categories, targets, categories and change_log are
    exactly as before.
  - MCP `delete_category` / `delete_category_group` equal REST.

## T8. Web API: new `apps/web/src/api/categories.ts`

Functions over `apiFetch` with the T1 schemas and `idempotencyKey: crypto.randomUUID()` on writes:
`createGroup(b, name)`, `createCategory(b, groupId, name)`, `updateGroup(b, id, patch)`, `updateCategory(b, id,
patch)`, `groupUsage`, `categoryUsage`, `deleteGroup(b, id, reassignTo?)`, `deleteCategory(b, id, reassignTo?)`,
`unhideAll(b)`. `useCategoryActions(budgetId)` returns them wrapped so success runs
`qc.invalidateQueries({queryKey: ["month", budgetId]})`. `setGroupsCollapsed(qc, budgetId, ids, collapsed):
Promise<void>` per design (optimistic `setQueriesData` on `["month", budgetId]`, PATCH each changed id, restore
that id on failure, no invalidate). `ApiError.detail` carries the messages shown in popovers.

## T9. `apps/web/src/plan/collapse.ts`

Replace the file's body: `useCollapsedGroups(budgetId, groups)` → `{ isCollapsed(id), setCollapsed(ids,
collapsed) }`; `isCollapsed` reads `groups.find(id).collapsed`; `setCollapsed` calls `setGroupsCollapsed` for the
ids whose value differs. Delete `loadCollapsed`, `saveCollapsed`, `readStored`, the key. `PlanGrid` call sites do
not change. Verify: `grep -r "planGrid.collapsed" apps/web/src` is empty.

## T10. Popovers: new `plan/Popover.tsx`, `plan/NamePopover.tsx`

```ts
Popover(props: { anchor: HTMLElement; width: number; label: string; onClose(): void; className?: string;
  children: ReactNode })     // portal to document.body: div.popover-overlay > div.popover[role=dialog][aria-modal]
                             // + svg.popover-arrow; Escape → onClose + anchor.focus(); overlay click: nothing
NamePopover(props: { anchor: HTMLElement; mode: "add-group" | "add-category" | "edit-group" | "edit-category";
  initial?: string; onSubmit(name: string): Promise<void>;   // rejects with ApiError → show detail
  onHide?(): Promise<void>; onDelete?(): void; onClose(): void })
```
Placeholders, widths, required messages per mode (design). Input focused on mount, caret at the end. Enter =
OK. Buttons `.popover-button` with `.is-primary`, `.is-secondary`, `.is-destructive` (do not reuse the global
`.primary` class: it carries a 16px top margin). Re-measure position on window resize/scroll.

## T11. `plan/CategoryPicker.tsx`

Props exactly as the design. Root `div.category-picker`; input `role=combobox`, `aria-expanded`,
`aria-controls`, `aria-label={label}`, placeholder (default "Select category"); list `div[role=listbox]` with
`div.picker-heading` "Plan Categories", per group `div.picker-group` (`role=presentation`) with
`div.picker-group-name` and `div[role=option].picker-option` containing `span.picker-name` and
`span.picker-available.{zero|positive|negative}` (`money()`). Selecting sets the input text to the category
name. Escape on the input closes the list and calls `e.stopPropagation()`.

## T12. `plan/DeleteDialog.tsx`

```ts
DeleteDialog(props: { budgetId: string; kind: "category" | "group"; name: string; ids: string[];
  categoryCount: number; transactionCount: number; groups: MonthGroupDetail[];
  onDone(): void; onCancel(): void })
```
`role=dialog`, `aria-label` = title; texts per design; Delete calls `deleteCategory`/`deleteGroup` with the pick;
an `ApiError` shows its detail in red above the footer. Escape (outside the open picker list) cancels.

## T13. `plan/HiddenCategories.tsx`

`HiddenCategoriesRow(props: { groups: MonthGroupDetail[]; budgetId: string })` → null when nothing is hidden;
row `div.grid-row.group-row.hidden-categories-row[role=row]` with empty `cell-collapse` / `cell-checkbox`,
`button.hidden-categories-label` "Hidden Categories", three `.num` cells. Totals with `addMilliunits` from
`@budget/core/money` (import only). Popover 320px per design; buttons call `updateCategory(…{hidden:false})`,
`updateGroup(…{hidden:false})`, `unhideAll`.

## T14. Grid wiring, CSS, icons

- `Toolbar.tsx`: prop `onAddGroup(anchor: HTMLElement)`; the "Category Group" button calls it.
- `rows.tsx`: `GroupRow` gets `onEditName(anchor)`, `onAddCategory(anchor)`, `addOpen: boolean`; the name is
  `<button type="button" className="group-name" title={g.name}>` (keep 16px/600, no button chrome).
  `CategoryRow` gets `onEditName(anchor)`: `onClick` on `.category-name` and `onContextMenu` on the row's
  `.cell-name` (`preventDefault`), anchor = the name button. Comment: "EXF-498: open only when selected".
- `PlanGrid.tsx`: `const [pop, setPop] = useState<{kind; id?; anchor: HTMLElement} | null>(null)`, renders the
  `NamePopover`/`DeleteDialog`; categories shown only when `!g.hidden && !c.hidden` (as now); `<HiddenCategoriesRow>`
  after the groups. Delete flow per design (usage → DELETE or dialog; a 409 opens the dialog).
- `plan-grid.css`: add `--buttonDestructiveBackground: #6a1020; --buttonDestructiveLabel: #feedeb;
  --buttonDestructiveBackgroundActive: #912333;` to the `:root` block; popover, arrow, button, picker,
  hidden-row and dialog-body rules using variables only; `.add-category.active { opacity: 1 }`.
- `icons.tsx`: only if a new glyph is needed (e.g. none beyond `PlusCircleFillIcon`).

## T15. e2e

- `e2e/categories.spec.ts` (real data, per-test `ZZ-TEST` plan like `plan-grid.spec.ts`): acceptance 1–9. History
  through `PATCH …/months/{month}/categories/{id}`. Case 9: a fresh profile is
  `browser.newContext({ baseURL, storageState: { cookies: (await context.storageState()).cookies, origins: [] } })`
  (auth cookie only, no localStorage); open the plan there, assert "Expand Bills categories"; in both contexts assert
  `Object.keys(localStorage).some(k => k.startsWith("budget.planGrid.collapsed"))` is false.
- `e2e/categories-hidden.spec.ts`: acceptance 11–15.
- `e2e/plan-grid.spec.ts`: in "collapse: one group, all, shortcuts, and it survives a reload" stub
  `**/api/v1/budgets/*/category_groups/*` (PATCH → 200 with a matching body) and drop the reload steps; nothing
  else changes (`.group-name` font assertions must still pass on the button).

## T16. Docs

Done by the Architect: `docs/README.md` line, `docs/plan-grid-design.md` ⊕ sentence. The report (Implementer)
lists routes, the picker props, EXF-498/504/496/500 attach points, and that `useDismiss.ts` was absent.

## Carry-over Build (design "Carry-over changes"; acceptance 17–19)

The branch `178c13a` is merged onto main `2d1982e`. Do not rewrite it; change only what T17–T19 name. Out of
bounds: `shell/**`, `menu-actions/**`, `apps/web/index.html`, `/me`, the other `mcp/tools/*.ts` files, any
REST-vs-tools surface test (EXF-572), every `paths.always_overlap` file. Do not open the source app.

## T17. `updated_at` on moved transactions

- `repositories/category-reassign.ts` `moveTransactionsStmt(db, budgetId, fromIds, targetId, now: string, guard)`:
  `.set({ categoryId: targetId, updatedAt: now })`. Its one caller, `buildDeleteBatch` in
  `services/category-delete.ts`, passes `p.now`. `logMovesStmt` unchanged.
- `test/category-delete.test.ts`, new `it` in "delete with reassignment": seed; a transaction in Fun, one in
  Target, and one in Fun deleted via `DELETE …/transactions/{id}` (or the service) before the category delete;
  read the three `updated_at` (raw `select … from transactions`); wait ≥2 ms; DELETE Fun `?reassign_to=Target`;
  then the moved one's `updated_at` = Fun's `categories.deleted_at` and > its old value; the other two equal
  their old values.
- Verify: `pnpm check`.

## T18. MCP tools (design table)

- `mcp/tools/categories.ts`: add `unhide_all_categories` (`z.object({ budget_id })` →
  `{ unhidden: await unhideAll(env, actor, input.budget_id) }`) and `get_category_usage`
  (`{ budget_id, category_id }` → `{ usage: await categoryUsage(env, input.budget_id, input.category_id) }`).
- `mcp/tools/category-groups.ts`: add `get_category_group_usage` (`{ budget_id, group_id }` →
  `{ usage: await groupUsage(env, input.budget_id, input.group_id) }`).
- Every tool in both files uses the file's `const budget_id = z.string().min(1)` (no inline variant, no
  `z.uuid()`); the services already answer `NotFound("Plan")` for a malformed or unknown id.
- Descriptions, all eleven tools: start with what it does, then "Returns …" naming the result key and fields
  (e.g. `{category}` with id, group_id, name, sort, hidden; `{deleted}` with category_ids, group_id,
  reassigned_to, transactions_moved, months_merged; `{usage}` with category_count, transaction_count,
  has_assigned, has_history; `{unhidden}` with group_ids, category_ids). The two delete and two usage tools also
  say: "Money is integer milliunits (1000 = one currency unit, negative is an outflow); months are YYYY-MM-01."
- Tests (in the files that already hold these areas; reuse `mcp`, `logs`, `send`, `api` from
  `category-helpers.ts`):
  - `category-hidden.test.ts`: two fresh plans, the same rows hidden in each; `POST …/categories/unhide_all` on
    one, `unhide_all_categories` on the other; the two results have the same counts and each lists its own
    plan's ids; nothing hidden afterwards; the MCP plan's change_log `update` rows all have an actor starting
    `mcp:`; with `budget_id: crypto.randomUUID()` → `isError: true`.
  - `category-delete.test.ts`: seed with history; `get_category_usage` / `get_category_group_usage`
    `structuredContent.usage` equal the REST `data.usage`; an unknown category / group id → `isError: true`.
  - `categories.test.ts` / `category-groups.test.ts`: add the new names to their `listedToolNames()` lists; one
    `it` that imports `tools` from both modules and asserts, for each, that
    `inputSchema.shape.budget_id.safeParse("").success` is false and `.safeParse("x").success` is true, and that
    every description contains "Returns".
- Do not edit `test/mcp.test.ts`, `test/existing-surface.test.ts` or `test/surface.ts`.
- Verify: `pnpm check`.

## T19. Merge fallout and gate

- `pnpm check`; fix only failures caused by main's changes (e.g. a changed type) and report each.
- `pnpm e2e` three times in the foreground (never background-and-poll). Only `e2e/plans.spec.ts:4` (EXF-569)
  may fail, and only alone; anything else is a defect to fix, even if it passes when run alone.
