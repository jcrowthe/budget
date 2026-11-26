# Plan custom views design (EXF-502)

Users save named sets of categories as extra chips on the Plan, edit them, reorder every chip and delete custom
views. The built-in chips (Underfunded, Overfunded, Money Available, Snoozed) can only be reordered. The chips
and the views rule are in [plan-views-autoassign-design.md](plan-views-autoassign-design.md).

## Storage

One table, `plan_views` (migration `20261126180502_plan_views.sql`), holds both kinds of row:
- a **custom view**: `id` a UUID, `name`, `category_ids` (a JSON array), `sort_order`, soft-deleted through
  `deleted_at`;
- a **built-in position row**, one per built-in key whose position was ever saved: `id = builtin:{budget}:{key}`,
  `builtin_key` set, `name` null, `category_ids` `[]`. A unique index on `(budget_id, builtin_key)` keeps one.

**Default positions.** A built-in key without a row sorts at −4, −3, −2, −1 (key order underfunded, overfunded,
money_available, snoozed). A new custom view gets `coalesce(max(sort_order) over the plan's live rows, -1) + 1`,
computed inside its own INSERT … SELECT, so it goes last. The display order is `(sort_order, id)` with the
defaults merged in TypeScript. All and Overspent are fixed first and never in the order.

A reorder writes `sort_order = index` for every custom view and upserts the four built-in rows, in one batch.

## API and MCP

REST (tag Views): `GET` and `POST /budgets/{id}/views`, `PATCH` and `DELETE …/views/{view_id}`, `POST …/views/reorder`
`{ids}` (every built-in key and every live custom id exactly once: otherwise 422 "ids must list every view exactly
once."). A name is trimmed, 1–100 characters ("The view name is required." when blank), duplicates allowed.
`category_ids` is deduplicated, keeps its order, holds at most 500 live categories of the plan (hidden allowed,
otherwise 404 "Category not found"). PATCH and DELETE on a built-in key are 422 "Built-in views can only be
reordered." and write nothing.

MCP: `list_views`, `create_view`, `update_view`, `delete_view`, `reorder_views` (one tool per REST operation;
`apps/worker/test/mcp-coverage/custom-views.ts`), the same services, so the same data and messages.

Every mutation is one `db.batch` with its change_log row: entity type `plan_view` (create, update, delete; the
entity id is the view id; before/after `{name, category_ids, sort_order}`) and `plan_view_order` (update; the entity
id is the plan; before and after are the full order arrays). Updates and deletes are guarded on `updated_at` (a lost
race retries up to 5 times, then 409).

## The view_id month read and summary

`GET …/months/{month}?view_id=V` and `…/summary?view_id=V` (MCP `get_plan_month`, `get_month_summary` with `view_id`)
narrow to the view's visible members through the same `viewDetail` / `viewTotals` the built-in views use: groups
without a member are dropped, group subtotals are the sums over the members, `uncategorized` is null, an empty view
has `groups: []`. An unknown, deleted, other-plan or built-in id is 404 "View not found" (never all categories).
`view` + `view_id`, and `category_ids` + `view_id`, are 422. Without `view_id` the response is unchanged. It costs
exactly one D1 call more (`getViewScope`).

## Deleted and hidden categories

- A **deleted category** (or one in a deleted group) drops out of a view **on read**: the list statement joins
  `json_each(category_ids)` to live categories in live groups. The category delete batch is not touched, so an
  undone category delete puts the category back into its views.
- A **hidden category** stays a member. The grid, the editor and `view_id` reads leave it out while it is hidden;
  the API's `category_ids` still lists it. Editing keeps hidden members: the client sends
  `editedViewCategoryIds(stored, shown, checked)`.

## No undo

The undo engine always refuses `view_settings` and unknown entity types (docs/undo-design.md), so views and their
order go on no undo stack (the web mutations do not record a change set). change_log rows are still written.

## Export and import

Plan export and import do not carry views: the format has no slot for them and belongs to the scheduled
transactions work. Out of scope; a restore from a backup does carry the table (backups list tables from
`sqlite_master`).

## The editor flow

- The chip row ends with a filter icon button (`aria-label="Views"`; not a `.view-chip`) opening a menu: Manage
  Views and ⊕ New View.
- **New/Edit Custom View**: a name (required) and one checkbox per visible category, grouped (the visible groups
  only, hidden categories not offered). Zero categories is allowed. A server error shows under the field.
- A new view is always selected after Save and its chip follows Snoozed (it goes last). An empty view shows our own
  illustration, "There are no categories selected for {name}.", Edit View and View All; the inspector says "This
  view has no categories." with View All Categories. A filled view shows only its categories with subtotals over
  them. A selected custom view adds "✎ Edit View" after Category Group.
- **Manage Views**: cards in chip order with a drag handle (native drag and drop with a drop gap). The editor opened
  from it stacks over it; Save or Cancel returns to it. A view created from it is selected behind the dialog; an
  edit does not change the selection; deleting the selected view selects All. Delete is an inline "Cancel | Delete".
- **Keyboard reorder** (our own addition, as docs/reorder-design.md): Alt+Shift+ArrowUp/ArrowDown on a card's
  handle moves it one place, announced in a live region.
- The selected chip is not saved (docs/plan-views-autoassign-design.md); a custom view deleted elsewhere falls back to
  All.

Auto-Assign on a custom view works on the categories it shows (a plan-wide set, even for one category).

## Tokens

Colours come from existing tokens only (`views/views.css`, `plan-views.css`), so both the dark and the light theme
apply; `e2e/custom-views.spec.ts` checks the dialogs against each theme's tokens.

## D1 calls

`apps/worker/test/custom-views-calls.test.ts` pins, equal for 10 views of 10 categories and 100 of 100: list 1,
create 2 (also with 10 and 100 ids), update 2, delete 2, reorder 2, view scope 1.

## Pre-allowed edits made

- Tool counts 122 → 127: `payee-category-api.test.ts`, `rename-rules.test.ts`.
- Backup table counts 26 → 27: `backup.test.ts`, `restore-backup.test.ts`.
- `mcp-timestamps.test.ts`: entries for the five new tools.
- No exact-equality assertion on a plan-month or view-settings response and no `plan-views.spec.ts` assertion needed
  a change.
