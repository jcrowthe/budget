# Reorder design (EXF-496)

Reorder categories inside a group, move a category to another group, and reorder groups, by dragging rows in
the Plan grid. REST `POST …/categories/{category_id}/move` and `POST …/category_groups/{group_id}/move`, MCP
`move_category` and `move_category_group`. Spec: `/workspace/thread/spec.md` in the Build Thread. EXF-490 is a
different ask (sidebar **accounts**, `PUT /accounts/order`) and is out of scope.

## Data

No migration. `categories.sort_order` and `category_groups.sort_order` (INTEGER, no unique index) already exist.
The display order is `(sort_order, id)` (`repositories/categories.ts` `listActive`, `listActiveInGroup`;
`repositories/category-groups.ts` `listActive`). The order is one per plan, not per month: `months.ts`
reads the same two lists for every month.

`month_categories` is keyed `(budget_id, month, category_id)` with no group column
(`db/schema/month-categories.ts`), so a cross-group move only changes `categories.group_id`: no statement of a
move touches `month_categories`, Assigned/Activity/Available stay with the category in every month, the two
groups' subtotals change because they are sums over their categories, and Ready to Assign cannot change (it
does not depend on groups).

## Sort numbers: midpoint with a gap, renormalize when there is none

A move reads the destination scope once (the destination group's active categories, or the plan's active
groups), in display order, and removes the moved row from it. The target position is between `prev` and
`next` (either may be missing).

| Case | New `sort_order` of the moved row | Rows written |
|---|---|---|
| empty scope | `0` | 1 |
| first (no `prev`) | `next.sort - STRIDE` | 1 |
| last (no `next`) | `prev.sort + STRIDE` | 1 |
| `next.sort - prev.sort >= 2` | `floor((prev.sort + next.sort) / 2)` | 1 |
| otherwise (adjacent or tied) | renormalize the scope with the moved row in place | the rows whose sort changes |

`STRIDE = 1024`. Existing rows are consecutive (creates use `max + 1` / `min - 1`, default categories use
`0, 1, 2…`), so the first move inside an old group usually renormalizes; after that, moves are one row until a
gap is used up. Creates stay correct with gaps: they only need "above the min" or "below the max".

**Renormalize** keeps one anchor row's value and spaces the others `STRIDE` apart around it, in the new order:
`sort(i) = anchor.sort + (i - anchorIndex) * STRIDE`. The anchor is the scope's first system row when it has one
(a payment category among its group's categories), else the first row. A group move plans over the **displayed**
order of the ordinary groups only: the Credit Card Payments group is outside its scope (the month engine always
shows it first, and a group created after a card sorts before it in the data), so the anchor is the first ordinary
group and a group move never writes a change_log row for the payment group. (The undo engine refuses any set that
touches a payment row: `services/undo.ts` `refusals`.)

The plan is computed in TypeScript from the one read; the writes ride **one JSON parameter**
(`json_each`), so the statement count and the bound-parameter count do not grow with the scope.

## One batch per move

Every move is `requirePlan`, one read of the moved row, one read of the destination group (category move), one
read of the scope, then **one `db.batch`**:

1. `change_log` rows, `action = 'update'`, `entity_type = 'category'` (or `'category_group'`), one per written
   row (the moved row and every renumbered row), each with the full API `before` and `after` (`categoryToApi` /
   `groupToApi` shape: `group_id`, `sort`, …). Not a single "reorder" entry: the undo engine restores per entity
   from these rows, with its existing type maps (`repositories/undo.ts` `TYPE_MAPS.category` already has
   `group_id` and `sort`; `category_group` has `sort`), so no map change is needed.
2. One `update … from json_each(?)` (or a correlated `set … = (select … from json_each(?))`) writing
   `sort_order`, `group_id` (moved category only) and `updated_at` for the same rows.

Both statements carry the same guard: the moved row still has the `updated_at` read, every row in the JSON (and
the `prev`/`next` neighbours) still has the `sort_order` and `group_id` read and is active, the destination group
is active, and (cross-group) no other active category of the destination has the moved category's name. A lost
race writes nothing and is retried (`MAX_ATTEMPTS = 5`, then 409 `Conflict`). D1 calls per move are constant
(counted by `test/category-move-calls.test.ts` for 10 and 100 rows, with and without a renormalize):
**5** for a category move inside its group (plan, category, destination group, scope, batch), **6** across groups
(plus the name check), **3** for a group move (plan, scope, batch). The JSON carries only the moved row, the
renumbered rows and the two neighbours, and appears a few times per statement, so a renormalize of a very large
scope (hundreds of rows) approaches D1's statement size; a group or plan of that size is not expected.

## Rules and errors

| Request | Answer |
|---|---|
| unknown plan, category or group in the path; unknown or deleted `group_id` in the body | 404 |
| both `before_*` and `after_*` | 422 `unprocessable_entity` |
| neither | the end of the destination (category) / of the plan (group) |
| `before_*`/`after_*` not active, not in `group_id` (category), or the moved row itself | 422 `invalid_move_target` |
| a credit card payment category to another group | 422 `payment_category_locked` |
| the Credit Card Payments group itself | 422 `payment_group_locked` |
| `before_group_id` = the Credit Card Payments group (nothing goes above it) | 422 `invalid_move_target` |
| `after_group_id` = the Credit Card Payments group | the group lands first among the ordinary groups |
| any other category into the Credit Card Payments group | 422 `payment_group_locked` |
| cross-group move where the destination already has the name (case-insensitive, trimmed) | 422 `name_taken` |
| already at that position | 200, the row unchanged, no write, no change_log row |

Decided: payment categories may be **reordered inside** their group. The payment group **cannot be moved**: the
month engine (`packages/core` `budget-engine.ts` `groupOrder`) always lists it first whatever its `sort_order`,
so a move could change nothing the user sees, and it answers 422 `payment_group_locked` (found while testing: the
first draft allowed it and the grid ignored the result). Other groups may be placed *after* it (they land first
among the ordinary groups); nothing can be placed above it in the grid. A payment category's undo is refused by
the existing system-row rule; the UI never offers a drop that the server would refuse. The Uncategorized row and
the hidden-categories row are not categories and are neither draggable nor drop targets. Hidden categories and
groups keep their place in the scope (the server places relative to the target id, not to what is visible).

## Web (Plan grid)

`apps/web/src/plan/dnd.ts`: native HTML5 drag and drop on whole `.group-row` / `.category-row` rows.

- Drag start: the row (for a group, its block) gets `is-drag-source` (dimmed); a drag that starts inside an
  input or the Assigned cell is not a row drag (buttons such as the name can start one; a click still clicks).
- Over a category row while dragging a category: top half → before it, bottom half → after it (its group).
  Over a group header while dragging a category: first in that group (works for empty and collapsed groups).
- Dragging a group: over a group block (its header and its visible categories), the top half of the block →
  before that group, the bottom half → after it ("below the last category places it after that group").
- A `.drop-gap` row (one row high, `role="presentation"`) is rendered at the landing position; no gap and no
  drop where the server would refuse (payment rules above) or where the drop changes nothing.
- Drop: the cached month is patched in place (row moved), the move is sent through `useCategoryActions` (one
  `beginWrite`/`endWrite`, recorded on the Undo stack like the other category writes), and the refetch brings
  the subtotals. A failure shows the grid notice and refetches.

Keyboard reordering is not offered (the source has none). Colours come only from `shell/tokens.css`.

## Keyboard reorder (our addition)

The source app has no keyboard reorder; this is ours, so keyboard users can reorder what a mouse drags.

- Group and category rows are focusable (`tabIndex 0`). **Alt+Shift+ArrowUp / ArrowDown** on a focused row (or on a
  control inside it, but not in an input) moves it one place: a category among the visible categories of its group, a
  group among the visible groups. A move past either end does nothing. A payment category stays in its group; the
  Credit Card Payments group is pinned first, so it doesn't move and nothing moves above it. Moving a category into
  another group is still drag only.
- It sends the same `POST …/categories/{id}/move` and `…/category_groups/{id}/move` bodies as a drop (`before_*` for
  up, `after_*` for down); no new endpoint. One change set per move, so Undo works as for a drag.
- Focus goes back to the moved row once the order has changed.
- The grid has one visually hidden `aria-live="polite"` region (`role="status"`) that says, for example, "Moved
  Utilities to position 2 of 3 in Bills." (`keyboardMove` in `apps/web/src/plan/dnd.ts`).
- Proven by `e2e/reorder-keyboard.spec.ts`.
