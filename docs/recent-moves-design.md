# Recent Moves: design (EXF-506)

The Plan toolbar's "Recent Moves" opens a popover listing the plan's assigning and money moves of the last 34
days, read from the `month_category` rows already in `change_log`. No migration, no new write, no change to the
history module.

Scope of this Build: the plan-wide Recent Moves popover (toolbar), its REST read and MCP tool. The per-category
Moves popover and the clock icon on the row (EXF-506 acceptance 4) are **not** in this Build: see Departures.

## Source

Looked at read-only on 2026-11-25 (app.ynab.com, the person's logged-in browser; nothing clicked but the page
load):

- The toolbar button (`.budget-toolbar-open-recent-moves`, label "Recent Moves", clock-arrow-back icon) is
  **disabled** on that plan, which has no moves; its tooltip reads "Previous 34 days of assigning and moving
  money". So the panel itself could not be opened.
- The loaded CSS rules for the panel (saved in the Thread folder, `source-recent-moves-css.json`) give:
  - a modal (`.modal-recent-moves .modal`) **27.4375rem (439px) wide**; body `.recent-moves` **34.25rem (548px)**
    high, stepping down to 500 / 430 / 350px on windows ≤ 767 / 649 / 590px high; a full zero state is 455px high;
  - a header (`.recent-moves-header`, 54px high, bottom rule) with the title and a segmented filter
    (`.segmented-control-button`);
  - day sections (`.recent-moves-day-section-refreshed`, padding 0 16px) with a sticky date heading that has a
    label at each end (`justify-content: space-between`);
  - cards (`.refreshed-recent-moves-row-wrapper`): radius 8, padding 12px 16px, margin-bottom 8; an icon at the
    left (margin-right 16), the content, an avatar at the right (margin-left 8); an "assign method" line in the
    tertiary label colour;
  - category chips (`.recent-moves-category-button`): inline-flex, radius 4, padding 4px 8px, name ellipsised,
    month after it in the tertiary colour, a **disabled** variant;
  - a zero state (`.recent-moves-zero-state`) with a description and an actions row, and a *filtered* zero state
    (`.recent-moves-filtered-zero-state`, centred, bold first line).

Everything else (copy of the cards, filter names, grouping, chip click) is from the ticket. The empty-state copy
was **not** observed and is assumed (below).

## Data: what one entry is

One query over `change_log`, `entity_type = 'month_category'`, `budget_id = ?`, `created_at >= since`
(index `change_log_budget_created`), skipping the rows of a category-delete merge (`reassigned_from` in before
or after). Categories are left-joined for names (deleted ones too, with `deleted_at` → `deleted: true`).

| change_log rows | entry | `method` |
|---|---|---|
| a row whose `after.move.id` is set: all rows of one id are **one** entry (both sides of a move) | from `after.move`: both ids → `moved`; `to` null → `removed` (from A); `from` null → `assigned` (to C); amount = `move.amount` | `move.kind`: `move`, `cover` or `undo` |
| any other row (direct Assigned edit, auto-assign, the undo of an edit) | delta = `after.assigned − before.assigned`; > 0 → `assigned` to the cell, < 0 → `removed` from it; amount = \|delta\|; delta 0 → no entry | `auto_assign` when `after.auto_assign` is set; `undo` when `after.undo_of` is set; else `edit` |

`undo_of`: for a move undo, `after.move.undo_of` (the undone move's id); for an edit undo, `after.undo_of` (the
undone change set); else null. `at` is the earliest row's `created_at`; `actor` the row's actor.

**Filters** (one rule, shared by the service and the web through `@budget/schema/recent-moves`):
`moved` = entries from a move record whose `from` is a category (category → category, category → Ready to
Assign); `assigned` = everything else (direct edits, auto-assign, undone edits, moves from Ready to Assign such as
Assign Manually and a cover from Ready to Assign). Every entry is in exactly one of the two; `all` is both.

**Actor name.** There is no profile with a display name: the account profile is the Access identity. The name is
derived from the recorded actor: `user:<email>` (also `mcp:user:<email>`) → the email's local part;
`service:<name>` → `<name>`; anything else → the actor text. `initial` = its first character, upper-cased.

**Window.** `since` defaults to now − 34 × 24 h (inclusive). A `since` of `YYYY-MM-DD` means that day 00:00 UTC; a
date-time is used as given. The service reads the time through a seam `recentMovesClock.now()` so tests pin it.
Entries cover every month (a move in December made today is listed).

**D1 calls:** two, whatever the number of moves: the plan check and the one list query (no IN list).

## API

- `GET /api/v1/budgets/{budget_id}/moves?since=&type=all|moved|assigned` → `{ data: RecentMove[] }`, newest first
  (`at` desc, then `id` desc). 404 unknown plan; 422 bad `since` or `type`.
- `RecentMove = { id, at, actor: { id, name, initial }, kind: "assigned"|"removed"|"moved", amount,
  from: Side|null, to: Side|null, method: "edit"|"move"|"cover"|"auto_assign"|"undo", undo_of: string|null }`,
  `Side = { category_id, category_name, month, deleted }`. `amount` is positive milliunits.
- MCP `list_recent_moves(budget_id, since?, type?)` calls the same service and returns the same array.

## Web

- `Toolbar.tsx`: the Recent Moves button opens the popover (anchor = the button); its title is unchanged. Only that
  button changes; Undo/Redo are untouched. A new optional prop `onSelectCategory(id)` is passed by `PlanGrid` (one
  line) because the Plan's selection lives there.
- `plan/recent-moves/RecentMovesPopover.tsx` on `Popover` (`dismissOnOutside`), 439 wide, body 548 high (stepped
  as the source), header "Recent Moves" + tabs All | Moved | Assigned (`role="tab"`, All selected and focused on
  open). Escape closes and returns focus to the button (the Popover's own behaviour); Tab is trapped.
- Day sections newest first, heading "Nov 15, 2026" with "Today" at the right for today (local date). Cards:
  ⊕ icon for the assigned filter, ⇄ for moved; "`<name>` assigned **$100.00**" / "removed **$50.00**" /
  "moved **$25.00**", then "to [chip]", "from [chip]" or "from [chip] to [chip]"; a method line "Cover",
  "Auto-Assign" or "Undo" when not a plain edit or move; an avatar with the initial.
- A chip shows the category name and "Nov 2026"; clicking it closes the popover, opens that month and selects the
  category. A deleted category's chip is disabled.
- One GET per open (`staleTime: 0`, mounted only while open, key `["recent-moves", budgetId]`), filtered on the
  client with the shared rule. The Plan's undo/redo already invalidates every non-month query of the plan, so an
  undo refreshes it; a new move is listed at the next open (the popover is modal: no move can happen while open).
- Empty states (copy assumed): no entries at all → "No recent moves" and "Assigning and moving money in the last
  34 days shows up here.", with a Close button; a filter with none → "No moved money in the last 34 days" / "No
  assigned money in the last 34 days".

## Decisions

1. Group a move's rows by `after.move.id` in SQL (one entry per move), not one per cell.
2. Direct edits and auto-assign are listed per cell as deltas (ticket rule: 400 → 450 logs "assigned $50.00").
3. Undone moves are listed as their own entry (method `undo`, sides swapped by the undo engine), not hidden.
4. Category-delete merges are not moves and are not listed.
5. The filter rule lives in `@budget/schema/recent-moves` so REST, MCP and the web split entries the same way.
6. No cap on the number of entries: the 34-day window bounds it, and the read stays one query.

## Departures

- **EXF-506 acceptance 4 not built** (clock icon on the row, per-category Moves popover and its REST
  `…/months/{month}/categories/{cid}/moves`): outside the contract's Goal and its May touch (row files). Follow-up.
- **`PlanGrid.tsx` gets one line** (`onSelectCategory`) outside the May touch: acceptance 3 needs the selection,
  which only `PlanGrid` can set.
- **`apps/worker/test/mcp-timestamps.test.ts` gets one CALLS entry**, as `docs/conventions.md` requires for a tool
  with a timestamp.
- **Names** come from the Access identity (email local part), as no display-name profile exists.
- **The button stays enabled** with no moves (the source disables it); the popover shows an empty state.
- **A popover anchored to the button** (ticket), sized from the source's modal rules.
- **Empty-state copy** is assumed: the source's panel could not be opened.
