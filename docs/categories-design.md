# Categories design (EXF-494, EXF-495)

Create, rename, delete, hide and unhide category groups and categories on the Plan grid; collapse moves to the
server. One Build, two tickets: **EXF-494** (create, rename, delete, collapse), **EXF-495** (hide, unhide).
Spec: [categories-spec.md](categories-spec.md).

## Source

Notes: `/workspace/scratch/source/categories/notes.md` (Test Budget Plan page, dark theme, 2026-11-15), with
`hover-add-icon.png`, `group-add-popover.png`, `category-add-popover.png`, `group-edit-popover.png`,
`category-edit-popover.png`, `category-edit-popover-rightclick.png` in the same folder. Seen live:

- **One popover component** for all four editors: a transparent full-viewport overlay holding a `role=dialog`
  box **below its anchor, centred on it**, with a 30×15 up-arrow on its top edge (box top = anchor bottom + 15).
  Box `--backgroundTertiary`, radius 0.4rem, `--shadowMenu`, padding 12.24px, **no title**. Input 32px, 500
  14px, `--inputBackground`, radius 4px, 1px `--inputBorderActive` when focused, 8px below. Buttons 32px, 500
  16px, padding 6px 16px, radius 8px, gap 8px: Cancel secondary (`--buttonSecondaryBackground` /
  `--buttonSecondaryLabel`), OK primary (`--buttonPrimaryBackground`), Delete destructive (#6a1020 on #feedeb,
  #912333 pressed).
- **Add group** (toolbar "Category Group"): 224px, placeholder "New Category Group", Cancel / OK at the right.
- **Add category** (⊕ after the group name, 14px `--actionPrimary`, shown **at once** on group-row hover, stays
  while its popover is open, tooltip "Add Category"): 224px centred on the ⊕, placeholder "New Category".
- **Edit** (click a group name; a category's name on the second click, or right-click in its name cell): 400px;
  input holds the name (emoji included), caret at the end, placeholder "Enter category name" for both; Hide,
  Delete at the left, Cancel, OK at the right.
- In all: input focused on open; OK enabled when empty; no live validation; Escape closes; **an outside click
  does not close** (the overlay catches it).
- **Not seen live** (the plan had nothing hidden, every Available was 0, and OK/Hide/Delete were forbidden): the
  validation messages, the delete dialogs, the Hidden Categories row and popover, the category picker. Their
  texts come from the tickets; stylesheet hints (hidden popover 20rem, bold group lines, categories indented 1em
  in `--actionPrimary`, a full-width bottom button; picker rows name left, Available right, coloured) are in the
  notes.

## Approach

Files are added where possible (`docs/conventions.md`). **No migration**: `hidden`, `collapsed`, `sort_order`, `deleted_at`,
`updated_at` all exist.

### Rules

1. **Names** are trimmed, 1–100 characters, compared trimmed and case-insensitively with SQLite `lower()` (ASCII
   folding; emoji compare exactly), deleted rows never counting. A category name is unique within its group, a
   group name within the plan. Renaming a row to its own name in another case is allowed.
2. **Top.** A group created through the API gets `sort_order = min(active groups of the plan) − 1`, a category
   `min(active categories of its group) − 1` (0 when empty; negatives are fine, the read model sorts by
   `sort_order, id`). The insert is guarded on "the min and the free name still hold" (the `sortIsNext` pattern);
   a lost race retries. `createCategoryGroup` / `createCategory` (append at the end, used by tests and default
   categories) are **unchanged**; the new use cases `addCategoryGroup` / `addCategory` serve REST and MCP.
3. **Hidden is two independent flags**, `category_groups.hidden` and `categories.hidden`; `sort_order` never
   changes, so everything returns to its original group and position. A category shows in the grid only when
   neither it nor its group is hidden.
   - Hide a group: `group.hidden = 1` only (its categories' own flags are untouched).
   - Unhide a group: `group.hidden = 0` and `hidden = 0` on all its active categories.
   - **Unhide a category whose group is hidden**, one batch: the category `hidden = 0`, the group `hidden = 0`,
     and `hidden = 1` on every *other* active category of the group that had `hidden = 0`. The group returns
     with only that category.
   - `unhide_all`: `hidden = 0` on every active group and category of the plan, one batch.
   - No money moves: the engine already counts hidden rows (budget-engine rule 6); only subtotals leave them out.
4. **Collapse is interface state**: PATCH `{collapsed}` writes the column and `updated_at` but **no change_log
   row**. Name and hidden changes write one `update` row each (actor, API shape before and after); a PATCH that
   mixes them logs, with `collapsed` in `after`.
5. **History** of a category: any transaction with `deleted_at` null and that `category_id`, or any
   `month_categories` row with `assigned ≠ 0`. A group's history is that of any active category in it (hidden
   included).
6. **Delete without history**: one batch soft-deletes the category (or the group and all its active
   categories), one `delete` log row per row, guarded on "still no history". History without `reassign_to` →
   **409** `history_exists`, detail e.g. "Category has history (2 transactions, assigned amounts); pass
   reassign_to".
7. **Delete with `reassign_to`** is one `db.batch` (atomic in D1). Every statement carries guard G (all deleted
   categories still active; the target active in an active group), in this order:
   1. change_log rows for each moved transaction, `INSERT … SELECT` from `transactions` (entity `transaction`,
      before `{id, category_id: <old>}`, after `{id, category_id: <target>, reassigned_from: <old>}`);
   2. `UPDATE transactions SET category_id = <target>` on the active rows of the deleted categories (new
      `repositories/category-reassign.ts`; the transactions files are not touched);
   3. change_log rows per month with assignments, `INSERT … SELECT … GROUP BY month` with a `LEFT JOIN` to the
      target's cell (entity `month_category`, id `<target>:<month>`, before `{month, category_id, assigned: b}`,
      after `{…, assigned: b + s, reassigned_from: [ids]}`);
   4. merge upsert: `INSERT INTO month_categories … SELECT month, <target>, sum(assigned) … GROUP BY month ON
      CONFLICT DO UPDATE SET assigned = assigned + excluded.assigned` (the deleted rows' cells stay, ignored by
      the engine, for undo);
   5. a `delete` log row (`targetToApi`) and the delete of each removed `targets` row;
   6. the group soft-delete and its log row (group delete), the categories' `delete` log rows;
   7. **last**, the categories' soft-delete, guarded only on G's target part (G reads these rows' `deleted_at`).

   Success is `changes() > 0` of the last statement; otherwise the service re-reads and answers 404 (category
   gone), 422 (target gone) or retries. Test seam `buildDeleteBatch` returns the statements, so a Worker test
   appends a failing statement and proves nothing changed.
8. **Reassign target** → 422 `invalid_reassign_target` when it is the deleted category, a category of the group
   being deleted, deleted, unknown, or of another plan. A hidden target is fine.
9. **Numbers after a merge.** The target's Assigned, Activity and carried Available are the two categories' sums
   in every month. Ready to Assign is unchanged in every month **unless the merge cancels cash overspending**: if
   one category ends a month negative and the other positive, the merged one overspends less, so the next
   month's `cash_overspending_previous` shrinks and RTA rises by that amount from then on (budget-engine
   property 2; no merge can avoid it). In the engine example (Target Oct 45000/−45000/0, Nov 15000/−50000/−35000)
   RTA is unchanged in Oct and Nov and **Dec RTA rises by 15000**. The Worker tests prove both cases; the report
   states this against the ticket's wording.

### API (under `/api/v1/budgets/{budget_id}`; errors `{ error: { id, name, detail } }`)

| Method and path | Body / query | 2xx `data` | Ticket |
|---|---|---|---|
| `POST /category_groups` | `{name}` | 201 `{category_group}` | 494 |
| `PATCH /category_groups/{group_id}` | any of `{name, hidden, collapsed}` | 200 `{category_group}` | 494, 495 |
| `DELETE /category_groups/{group_id}` | `?reassign_to=` | 200 `{deleted}` | 494 |
| `GET /category_groups/{group_id}/usage` | | 200 `{usage}` | 494 |
| `POST /categories` | `{group_id, name}` | 201 `{category}` | 494 |
| `PATCH /categories/{category_id}` | any of `{name, hidden}` | 200 `{category}` | 494, 495 |
| `DELETE /categories/{category_id}` | `?reassign_to=` | 200 `{deleted}` | 494 |
| `GET /categories/{category_id}/usage` | | 200 `{usage}` | 494 |
| `POST /categories/unhide_all` | | 200 `{unhidden: {group_ids, category_ids}}` | 495 |

`deleted` = `{category_ids, group_id | null, reassigned_to | null, transactions_moved, months_merged}`; `usage` =
`{category_count, transaction_count, has_assigned, has_history}`. **The two `usage` reads are an addition to the
Lead's list**: the dialogs need "All transactions [n]" and the shared error envelope cannot carry a count.

Errors: 404 `not_found` (unknown or malformed plan, group, category; `group_id` in POST /categories). 422
`unprocessable_entity` (empty name: "The group name is required." / "The category name is required."; empty
PATCH: "Nothing to update"), 422 `name_taken` ("This group name already exists" / "A category with this name
already exists in this group"), 422 `invalid_reassign_target`. 409 `history_exists`; 409 `conflict` (race lost
five times).

MCP (same services, actor `mcp:<actor>`; errors are thrown with the REST `detail`), each returning the REST
`data`: `create_category_group(budget_id, name)`, `rename_category_group(budget_id, group_id, name)`,
`set_category_group_hidden(budget_id, group_id, hidden)`, `delete_category_group(budget_id, group_id,
reassign_to?)`, `create_category(budget_id, group_id, name)`, `rename_category(budget_id, category_id, name)`,
`set_category_hidden(budget_id, category_id, hidden)`, `delete_category(budget_id, category_id, reassign_to?)`.

### Web

- **`api/categories.ts`**: one call per route; `useCategoryActions(budgetId)` whose writes invalidate
  `["month", budgetId]` on success (as `api/assigned.ts`; `api/months.ts` untouched);
  `setGroupsCollapsed(qc, budgetId, ids, collapsed)` writes `collapsed` into every cached month of the plan
  (`setQueriesData`), sends one PATCH per changed group, restores on failure, and does **not** invalidate (so it
  cannot overwrite a pending Assigned edit).
- **`plan/collapse.ts`**: `useCollapsedGroups` keeps its signature; `isCollapsed` reads the read model's
  `collapsed`, `setCollapsed` calls `setGroupsCollapsed`. `loadCollapsed`, `saveCollapsed` and the
  `budget.planGrid.collapsed.*` localStorage handling are removed. Header chevron and Ctrl/⌘+↑/↓ unchanged.
- **`plan/Popover.tsx`**: portal with a transparent overlay and the anchored box and arrow (from the anchor's
  `getBoundingClientRect`, clamped 8px inside the viewport, arrow kept on the anchor). Escape closes and returns
  focus to the anchor; an overlay click does nothing (as the source). `useDismiss.ts` is not on main at
  `0c81b09`, so dismissal lives in this file; no `useDismiss.ts` is created.
- **`plan/NamePopover.tsx`**: add (224px; Cancel, OK) and edit (400px; Hide, Delete | Cancel, OK). Enter submits,
  Escape cancels; an empty name shows the required message without a request; a server 422 shows its detail in
  red under the input (`--labelNegative`, 14px) and keeps the popover open; an unchanged name closes it silently.
- **Delete flow**: `GET …/usage`; no history → `DELETE` at once, no confirmation; history (or a racing 409) →
  **`plan/DeleteDialog.tsx`** on the shell's `.dialog-backdrop` / `.dialog.modal` classes (used, not edited):
  title "Delete Category" or "Delete Category Group"; "Before you can delete the category **<name>**, you'll need
  to reassign your past activity to a new category." or "All **<n>** categories in the group **<name>** will be
  reassigned to the selected category."; a `CategoryPicker` ("Select category") excluding the deleted ids;
  "Here's what will be reassigned to the new category:" with "All transactions" + count badge, "All assigned
  amounts", "Any remaining available amount"; Cancel / Delete (destructive, disabled until a pick).
- **`plan/CategoryPicker.tsx`** (shared with EXF-491, EXF-492, EXF-517; knows nothing of deletion). Props
  `{ groups: MonthGroupDetail[]; value: string | null; onChange(id: string): void; exclude?: ReadonlySet<string>;
  placeholder?: string; label: string; includeHidden?: boolean = true; autoFocus?: boolean }`. A `role=combobox`
  field that filters (case-insensitive, category or group name) a `role=listbox` drop-down headed "Plan
  Categories": per group a bold heading (the group name), then its categories with their Available for the month
  (`money()`, coloured zero/positive/negative); empty groups dropped. ↑/↓ move, Enter picks, Escape closes the
  list without closing the dialog around it.
- **`plan/HiddenCategories.tsx`**: the grid body's last row, only when something is hidden; group-row style, no
  checkbox or chevron; label button "Hidden Categories"; Assigned / Activity / Available as plain-text sums over
  every category hidden itself or by its group. Its 20rem popover: header "Click to unhide a category"; per group
  in grid order a bold "Group: <name>" (a button when the group is hidden, plain text otherwise), then its hidden
  categories as indented link buttons (all categories of a hidden group); a full-width primary "Show all hidden
  categories" (`unhide_all`). Each action closes the popover.
- **Grid**: Toolbar "Category Group" opens the add-group popover. `GroupRow`: the name becomes `button.group-name`
  (click → edit popover); the ⊕ opens add-category and has `.active` while open. `CategoryRow`: click on
  `.category-name`, or `contextmenu` anywhere in its name cell (`preventDefault`), opens the edit popover anchored
  on the name. **Until EXF-498 (selection), a single click opens it**; the source selects first and opens on the
  second click. `PlanGrid` keeps one `openPopover` state so only one is open, and renders `HiddenCategories`
  last. `docs/plan-grid-design.md`: the ⊕ "fades in" sentence is corrected (it appears at once).

## Downstream effects

- The grid hides categories of hidden groups (it already dropped hidden groups) and now totals hidden rows.
- `e2e/plan-grid.spec.ts` "collapse … survives a reload" runs on a stubbed month, where a server PATCH cannot
  persist: its reload part moves to `e2e/categories.spec.ts` on real data; the stubbed test keeps the in-session
  steps and stubs `PATCH **/category_groups/*` with 200.
- Waiting tickets: **EXF-504** Undo replays the change_log rows above (clear `deleted_at`, reverse the logged
  moves). **EXF-496** reorders `sort_order` (negatives allowed). **EXF-498** makes `CategoryRow`'s name click open
  the popover only on a selected row and replaces `onContextMenu` with its multi-select menu when several rows
  are selected. **EXF-500** disables the toolbar "Category Group" while a view filter is active. **EXF-491,
  EXF-492, EXF-517** use `CategoryPicker`.

## Out of scope

Undo/Redo, drag reorder, selection and the multi-select menu, filtered-view disabling, Move pickers, migrations.
None of the files the Lead's notes 3 and 10 reserve for other Builds is touched.

## Acceptance

Against `pnpm dev`, a fresh `ZZ-TEST` plan (default groups Bills, Needs, Wants). Compare cases use the source's
Test Budget Plan page, its own dark theme, 1600×813: **look only, leave with Cancel or Escape**.

1. **(494) Add group.** Click "Category Group": a 224px popover under it with its arrow, the input focused,
   placeholder "New Category Group". OK on an empty field: "The group name is required." in red, no request.
   Type "ZZ Group", Enter: it is the first group row. Compare: the source's "Category Group" popover.
2. **(494) Add category.** Hover Bills: the ⊕ shows at once. Click it: placeholder "New Category". "ZZ Cat", OK:
   Bills' first category. Add "zz cat " to Bills again: "A category with this name already exists in this
   group", nothing added. Compare: the source's ⊕ popover on Bills.
3. **(494) Rename.** Click "🏠 Rent/Mortgage": the edit popover holds the full name, caret at the end, with Hide,
   red Delete, Cancel, OK. "D1 Rent 🏡", Enter: the grid shows it, and the case 7 picker lists it. Empty it:
   "The category name is required.". Rename Needs to "bills": "This group name already exists". Compare: the source's
   popover on a category (right-click) and on Bills (click).
4. **(494) Right-click** in the name cell of "🛒 Groceries": the same edit popover; no browser menu.
5. **(494) Delete unused.** Delete "⚡️ Utilities": gone at once, no dialog; change_log has a `delete` row with
   actor `user:dev@localhost`.
6. **(494) Delete an empty group.** Add group "ZZ Empty" with one category, delete the group: both gone at once.
7. **(494) Delete with history.** Assign 20.00 to "🍿 Entertainment", Delete it: "Delete Category" with the bold
   name sentence, "Select category", the three bullets ("All transactions" 0), Delete disabled. Pick "🏝️
   Vacation", Delete: Entertainment gone, Vacation's Assigned +20.00, Ready to Assign unchanged.
8. **(494) Delete a group with history.** Assign 5.00 in Wants, delete Wants: "Delete Category Group", "All 3
   categories in the group Wants will be reassigned to the selected category.", picker without Wants'
   categories. Pick a Needs category, Delete: Wants gone, the pick's Assigned +5.00.
9. **(494) Collapse on the server.** Collapse Bills; open the plan in a new browser context: Bills collapsed.
   localStorage has no key starting `budget.planGrid.collapsed`. Collapse all, Expand all, Ctrl+↑/↓ still work;
   no change_log row for collapse.
10. **(494) API.** The spec's Worker tests pass: REST and MCP give the same data and history with the right
    actor; every error above as stated; a forced failure in the delete batch changes nothing; rule 9's numbers.
11. **(495) Hide a category.** Assign 15.00 to "📱 Phone & Internet", note RTA, Hide it: row gone, Bills' subtotal
    −15.00, RTA unchanged, a last row "Hidden Categories" with $15.00 / $0.00 / $15.00 as plain text, no
    checkbox or chevron.
12. **(495) Hidden popover.** Also hide Wants; click "Hidden Categories": "Click to unhide a category", "Group:
    Bills" (text), "📱 Phone & Internet", "Group: Wants" (button) with its four categories, "Show all hidden
    categories". Escape closes.
13. **(495) Unhide.** Click "📱 Phone & Internet": back as Bills' second row. Reopen, click "🍿 Entertainment":
    Wants returns with only Entertainment; the other three stay under "Group: Wants". Click "Group: Wants": all
    four back in their original order.
14. **(495) Show all.** Hide two rows in different groups, "Show all hidden categories": all visible, the Hidden
    Categories row gone; reload: nothing hidden.
15. **(495) Persistence and history.** Hide a category, reload: still hidden. change_log has `update` rows for
    hide and unhide with the actor; `set_category_hidden` matches the PATCH (Worker test).
16. **Visual compare.** Popover widths, colours, arrow and button order match the live source states of cases 1
    to 3 (screenshots above as reference only).

## Manifest

touches: [packages/schema/src/categories.ts, apps/worker/src/services/categories.ts, apps/worker/src/services/category-delete.ts, apps/worker/src/repositories/categories.ts, apps/worker/src/repositories/category-groups.ts, apps/worker/src/repositories/month-categories.ts, apps/worker/src/repositories/category-reassign.ts, apps/worker/src/routes/categories.ts, apps/worker/src/routes/category-groups.ts, apps/worker/src/mcp/tools/categories.ts, apps/worker/src/mcp/tools/category-groups.ts, apps/worker/test/categories.test.ts, apps/worker/test/category-groups.test.ts, apps/worker/test/category-delete.test.ts, apps/worker/test/category-hidden.test.ts, apps/web/src/api/categories.ts, apps/web/src/plan/rows.tsx, apps/web/src/plan/PlanGrid.tsx, apps/web/src/plan/Toolbar.tsx, apps/web/src/plan/collapse.ts, apps/web/src/plan/plan-grid.css, apps/web/src/plan/icons.tsx, apps/web/src/plan/Popover.tsx, apps/web/src/plan/NamePopover.tsx, apps/web/src/plan/DeleteDialog.tsx, apps/web/src/plan/CategoryPicker.tsx, apps/web/src/plan/HiddenCategories.tsx, e2e/categories.spec.ts, e2e/categories-hidden.spec.ts, e2e/plan-grid.spec.ts, docs/categories-design.md, docs/categories-spec.md, docs/plan-grid-design.md, docs/README.md]
shared: []
migrations: 0
