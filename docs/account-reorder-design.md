# Account reorder design (EXF-490)

Reorder accounts by dragging their rows in the sidebar, within their section. REST
`PUT /api/v1/budgets/{budget_id}/accounts/order`, MCP `reorder_accounts`. The ticket is the spec; this note records
what it leaves open and how the code answers. The category and group reorder in the Plan grid (EXF-496,
[reorder-design.md](reorder-design.md)) is a separate feature and keeps its behaviour.

## Data

No migration. `accounts.sort_order` (INTEGER, NOT NULL, no unique index) already exists and is **one order per plan
across all types** (`db/schema/accounts.ts`). The display order is `(sort_order, id)`
(`repositories/accounts.ts` `list`). The sidebar groups the plan-ordered list by section
(`packages/core/src/account-types.ts` `sidebarSections`): STARRED (starred and open), CASH, CREDIT, LOANS and
TRACKING (open, by type), CLOSED (sorted by name). Creates use `max(sort_order) + 1` over the plan's non-deleted
accounts, behind the guard that holds only while that value is still free (`sortIsNext`). So a new account is last
in its section, and app-created sort values are distinct.

## Request and rules

`PUT …/accounts/order` with `{ "account_ids": [...] }`: the ids of one section in their new order, 1 to 500, with no
duplicates. The server rewrites `sort_order` for those ids only (see the tie case below for the one exception). It
answers `200 { data: { accounts } }`: the plan's accounts, closed ones included, in display order (the same list as
`GET …/accounts`). The MCP tool `reorder_accounts` takes `{ budget_id, account_ids }` and returns `{ accounts }`.

| Request | Answer |
|---|---|
| unknown plan | 404 `not_found` |
| an id that is not a non-deleted account of this plan | 404 `not_found` (nothing written) |
| empty list, duplicate id, more than 500 ids | 422 `unprocessable_entity` |
| a closed account among the ids | 422 `account_closed` (nothing written) |
| ids from more than one of CASH, CREDIT, LOANS, TRACKING | 422 `account_groups_mixed` (nothing written) |
| a subset of one section (for example the starred CASH accounts) | 200, only those rows change |
| already in that order | 200, no write, no change_log row |

The checks run in this order: plan, ids exist, closed, mixed. **A section depends on the type, never on the
drag**: moving an account into another section would change its type, so the server refuses it with 422 and the
sidebar never offers it.

**Closed accounts cannot be reordered.** CLOSED stays sorted by name (ticket; `sidebarSections`). The server
refuses closed ids, and closed rows are not draggable.

**STARRED.** The ticket says to allow drag in STARRED using the same `sort_order`, and to answer 422 when the ids
mix groups. Both hold if a starred row can be dropped only among the **starred rows of its own type group**. The
sidebar sends those starred ids in their new order (a subset of one group). Because the order is the same
`sort_order`, those accounts also swap places in their type section, and the non-starred accounts stay where they
are. Dropping a starred CASH row among starred CREDIT rows opens no gap.

## Sort values: permute the listed accounts' own values

The PUT carries a whole order, not one move. So the server does not use EXF-496's midpoint/stride scheme.
Instead it **reuses the listed accounts' own sort values**:

1. Read the plan's non-deleted accounts once (`id, type, closed, sort_order`).
2. `slots` = the listed accounts' current `sort_order` values, sorted ascending.
3. The account at position `i` of `account_ids` gets `slots[i]`. Only rows whose value changes are written.

This keeps the set of values. So the plan's `max(sort_order)` does not change, and a concurrent create's
`sortIsNext` guard is undisturbed (AC 6: a new account still lands last). Every account that is not listed keeps
its value and its place. Accounts of other sections are not affected. No gaps or renormalize are ever needed.

**Ties** (two non-deleted accounts sharing a value: never produced by the app, only by direct edits). If the
slots are not distinct, or a slot equals the value of an account that is not listed, the server renumbers **all**
of the plan's non-deleted accounts to `0…n-1` in the new display order: the current order, with the listed
accounts permuted into their own positions. Only rows whose value changes are written, and each is logged (so
undo covers them). This is the only case that writes rows outside `account_ids`. It can lower the max. A create
that races it fails its guard and retries (`MAX_ATTEMPTS`).

## One batch per reorder

From EXF-496 this reuses the json_each guard, `logSelectStmt` and the retry loop. Each reorder is `requirePlan`,
one read of the plan's accounts, then **one `db.batch`**:

1. `change_log` rows (`logSelectStmt`): `action = 'update'`, `entity_type = 'account'`, one per written row, with
   `before = {"id", "sort": old}` and `after = {"id", "sort": new}`. They have the request's actor
   (`user:…`, `service:…`, `mcp:…`) and share the request's change set.
2. One `update accounts set sort_order = (select n from json_each(?) …)` for the same rows.

The writes ride **one JSON parameter** (`[{i, o, n, t}]`: id, old sort, new sort, type), so the statement count
and the number of bound parameters do not grow with the accounts. Both statements carry the same guard: every row
in the JSON still exists in the plan, is not deleted, still has sort `o` and type `t`, and a listed row is still
open. If the race is lost, nothing is written; the server re-reads and tries again (5 attempts, then 409
`conflict`). Then the response list is read. The D1 calls per reorder are constant, counted by
`test/account-order-calls.test.ts` for 5 and 50 accounts. Measured (`test/account-order-calls.test.ts`, 5 vs 50 accounts, permutation and tie fallback alike): **7 D1 calls**,
one of them the batch: plan check, read of the plan's accounts, the batch, then the response list (the account
read plus its three balance reads). The renumbering guard additionally requires the plan's account count to be the
one read, so a create that races a tie renumber retries instead of colliding.

**change_log shape (departure from the ticket's wording).** The ticket asks for "accounts reordered" with the old
and new order. That is recorded as the per-account `update` rows of one change set: the set's old and new sorts
*are* the old and new order. A single summary row with an unknown `entity_type` would make the set impossible to
undo (`services/undo.ts` refuses unknown types).

## Undo

The reorder's change set is undone like any other: `POST …/changes/{change_set_id}/undo` restores each row's
`before.sort`. Today the engine refuses an account row whose change is anything other than `starred` or
`paired_category_id` (`services/undo.ts` `refusals`), and `TYPE_MAPS.account` (`repositories/undo.ts`) does not
write `sort_order`. A worker test that undoes a reorder fails on that refusal (409 `undo_refused: account`, recorded before the change). So `sort` (column `sort_order`) is
added to both lists. Nothing else changes. A later reorder or a deletion makes the undo stale (409
`undo_stale`), as for other entities. The sidebar records the set on the Undo stack with origin `register`, the
same as starring (`api/accounts.ts` `useSetStarred`).

## Web (sidebar)

This is native HTML5 drag and drop, in the style of `apps/web/src/plan/dnd.ts`; its `inTopHalf` is imported
unchanged. The pure placement function and the hook live in `apps/web/src/shell/sidebarDnd.ts`, and the styles in
`shell/sidebar-dnd.css` (colours from `shell/tokens.css` only).

- Draggable: every `.nav-account-row` of STARRED, CASH, CREDIT, LOANS and TRACKING. CLOSED rows and section
  headers are not. The row's link has `draggable={false}`, so the drag is the row's and not the link's.
- Drag start dims the row (`is-drag-source`). Over a row of the **same section** (in STARRED, a starred row of the
  same type group), the top half places the dragged row before it and the bottom half after it. A
  `.nav-drop-gap` element (`role="presentation"`, one row high) opens there and the rows below shift down.
- No gap and no drop over another section, over a header, or where the drop changes nothing. Without
  `preventDefault` the browser refuses the drop, so the account stays where it was and no request is sent.
- Drop: the cached `["accounts", budgetId]` list is reordered at once, then the PUT is sent. A failure puts the
  list back; the list is refetched afterwards either way.
- A click without movement starts no drag, so it still opens the account. A collapsed section has no rows and no
  targets. There is no keyboard reordering: the source has none, and the ticket did not observe it.

## Observed and assumed

- Observed (ticket, from the source): a gap opens within a group; cross-group drops are refused; the order
  persists; clicks still navigate; new accounts are appended.
- Assumed: unknown ids answer 404, and the response is the full account list. STARRED reorders only among starred
  rows of one type group.

## Keyboard reorder and Undo (follow-ups)

- **Keyboard (our addition; the source app has none):** with an account's link focused, **Alt+Shift+ArrowUp /
  ArrowDown** moves it one place within its section (STARRED: within its type group; Closed doesn't reorder). It sends
  the same `PUT …/accounts/order` as a drop, and focus returns to the moved account. The sidebar has a visually hidden
  `aria-live="polite"` region ("Moved ZZ-TEST C to position 2 of 3.").
- **Undo:** the reorder's change set is recorded with origin `plan` (was `register`). The Plan page's Undo button and
  Ctrl+Z take the top entry of the shared stack (docs/undo-design.md), so they undo an account reorder; the register's
  own Undo is unscoped too, so it still can. Only a scoped consumer (Manage Payees, origin `payees`) ignores it.
  `plan` is the simplest consistent choice: the sidebar sits beside the Plan, and an account reorder is a
  plan-level layout change, like a category reorder.
