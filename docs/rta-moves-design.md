# Ready to Assign pill and moving money: design (EXF-491, EXF-492)

One Build, two tickets. Both move money between categories and Ready to Assign (RTA) through one route family,
one service (`moveMoney`) and one category picker.

- **EXF-491**: the RTA box in the Plan header (three states), its breakdown popover, "Assign ▾" (Auto tab drawn
  but disabled, Manually tab) and "Fix This".
- **EXF-492**: the Move popover on a positive Available pill and the Cover popover on a negative one.
- API for both: `POST …/months/{month}/moves`, `POST …/months/{month}/categories/{category_id}/cover`, MCP
  `move_money` and `cover_overspending`.

## Source

Study notes: `/workspace/scratch/source/rta-moves/notes.md`. Screenshots in the same folder (sidebar cropped):
`rta-zero.png`, `rta-breakdown-zero.png`, `zero-pill-hover.png`, `plan-overview-nov2026.png`,
`header-dec2026-next-disabled.png`.

**Seen live** (only zero states: "Test Budget" is $0.00 everywhere in Oct to Dec 2026, and the Lead forbids
changing it):

- **RTA box**: right after the month block, not centred (calendar `0 0 30%`, box `0 1 auto`, as
  `.plan-header-totals` already is). 226×62, padding 8/16/12, radius 8, #3C3E53 / #9B9CAA. Amount Figtree
  21px/700 with a 16px info icon visible only on hover; label 14px/500 "All Money Assigned"; at right, 40px from
  the text, a disabled 30×34 button (aria-label "All Money Assigned") with a 30px check-circle at opacity .8.
- **Breakdown**: opened by the amount or the label; Escape or an outside click closes it. 540 wide, centred on
  the box, top 8px below it, 30×15 arrow, #1F2038, radius 6.4, padding 16px 0. Title 16px/500 #C4C5CF. Card
  #292B3D, radius 8, padding 24: green plus-circle row "+$0.00" (#77BA21, 600), rule, grey subtract-circle row
  "+$0.00" (#C4C5CF), rule, "Total Ready to Assign" 16px/600 "= $0.00", "Nice work! Every dollar has a job.".
  A zero block has no detail lines. Help box rgba(117,131,255,.2), 24px #545BFE info icon; its second sentence
  and "Checkup" link are dropped (Lead). No buttons.
- **Zero Available pill**: a disabled button; hover and click do nothing.

**Not seen live** ("not compared: forbidden by the Lead"): the positive and negative RTA states, the Assign and
Fix This buttons and popovers, the Move and Cover popovers, the picker's contents and filtering, the month dropdown,
"20+5" maths, a breakdown with non-zero lines. Their copy and behaviour come from the tickets; their colours and
sizes from the source's loaded CSS rules, listed under "CSS-derived specs" in the notes (box #346011 / #6A1020;
Assign button #508316 hover #77BA21; Fix This #BF2E3B hover #CE5E66; buttons 32 high, radius 8, padding 4px 16px;
active tab #A3ACFF with a 2px border; Move/Cover 320 wide, padding 16, amount input with a 1px #727484 border on
#3C3E53).

## Approach

### Data and history (Worker)

The money moves through `moveMoney` (`services/months.ts`). Today it writes one `change_log` row per changed
cell (`entity_type` `month_category`, `entity_id` `<category>:<month>`), and each row's `after` carries
`move: { from_category_id, to_category_id, amount }`. A two-sided move's two rows have nothing tying them
together, and the move's month is only in the entity id.

**Extended:** each call makes one `move_id` (a UUID, made once per call; a lost race writes no rows, so a retry
keeps the same id). Every row of the call carries:

`after.move = { id, month, from_category_id, to_category_id, amount, kind }` (null side = RTA; `kind` is
`"move"`, the default, or `"cover"`). Rows stay one per cell, so each cell's before/after chain is unchanged.

`moveMoney` returns `{ move_id, cells }` (it returned `cells` before; only tests called it).

**How EXF-506 (Recent Moves) reads it.** Select the plan's rows where
`entity_type = 'month_category' and json_extract(after_json, '$.move.id') is not null`, ordered by `created_at`,
and group them by `$.move.id`.

One group is one move: from, to, amount, month, kind from any row's `move`; actor and time from the row (the
rows of one move share one batch and `created_at` within 1 ms). Wording: both ids set "moved $X from A to B";
`to` null "removed $X from A"; `from` null "assigned $X to C"; `kind` lets it word a cover differently.

**How EXF-504 (Undo) reads it.** Undoing a move is the inverse move: `moveMoney` with `from` and `to` swapped
and the same amount and month, which is one new batch. It is guarded like any move, so it cannot clobber a later
edit of the same cells. EXF-504 can also restore each row's `before.assigned` with the existing guarded writers
if it prefers exact restore.

A move is atomic: every statement of the batch is guarded on all the cells still holding what was read, and the
D1 batch rolls back as a whole on error. A test seam `buildMoveBatch` lets a Worker test add a failing statement
and see that nothing changed.

### API

New route file `apps/worker/src/routes/moves.ts`, new service `services/moves.ts` (the `…AndRead` wrappers),
new schema `packages/schema/src/moves.ts`.

- `POST /api/v1/budgets/{budget_id}/months/{month}/moves`, body `{ from, to, amount }`.
  - `from` and `to` are each a category id or `"ready_to_assign"`; they must differ and not both be
    `"ready_to_assign"`.
  - `amount` is a positive integer in milliunits.
  - Answers 200 `{ data: MoveResult }`.
- `POST /api/v1/budgets/{budget_id}/months/{month}/categories/{category_id}/cover`, body `{ from }`.
  - Moves exactly `−available` of the category in that month from `from` (a category id or
    `"ready_to_assign"`) to it, with `kind: "cover"`.
  - Answers 200 `{ data: MoveResult }`.
- `MoveResult`: `{ move_id, month, amount, from: MonthCategoryAmounts | null, to: MonthCategoryAmounts | null,
  ready_to_assign }`.
  - A null side is RTA.
  - `MonthCategoryAmounts` is the existing `{ id, month, assigned, activity, available }` read back from the month
    model after the write.
- Errors, in the app's envelope:
  - 404 for an unknown or deleted plan or category (a non-UUID id is unknown);
  - 422 for: a bad month (path); `amount` ≤ 0, not an integer or not safe; `from` = `to`; both RTA; a cover of a
    category whose Available is ≥ 0 ("Category is not overspent"); a cover whose `from` is the category itself;
  - 409 when the guarded write loses five races in a row.
- `Idempotency-Key` is accepted, as on every write: the middleware already handles it.

New MCP tool file `apps/worker/src/mcp/tools/moves.ts`:

- `move_money(budget_id, month, from, to, amount)`
- `cover_overspending(budget_id, month, category_id, from)`

They call the same services with the server's `mcp:<actor>`, so REST and MCP give identical results and history
apart from the actor. Each description says what the tool does and returns, that amounts are integer milliunits
(1000 = one currency unit), that a month is `YYYY-MM-01`, and that `"ready_to_assign"` names Ready to Assign.

### Web

**Cache.** Every move goes through `monthCache.ts`: `beginWrite`; apply the move to the cached months (the move's
month exactly: both categories, their groups, RTA, `assigned_in_month`; every earlier cached month's RTA and
`assigned_in_future` when one side is RTA; later months wait for the refetch); run the POST in the plan's **one
write queue**, which moves from `api/assigned.ts` into `monthCache.ts` (`inOrder`) so a move never overtakes a
pending absolute Assigned PATCH of the same cell; on failure apply the inverse to the same caches and show a
message; `endWrite`. The arithmetic is `applyMove` in `packages/schema/src/assigned-edit.ts`, composed of
`applyAssigned`.

**Category picker** (`CategoryPicker.tsx`), three optional props. Without them it behaves exactly as today
(DeleteDialog):

- `readyToAssign?: number`: adds the entry "Inflow: Ready to Assign" with that amount, first under "Plan
  Categories". Its value is the exported constant `READY_TO_ASSIGN = "ready_to_assign"`, which the filter
  matches like a name.
- `include?: (c: MonthCategoryDetail) => boolean`: keeps only the categories it accepts (Cover and Fix This pass
  `c => c.available > 0`).
- `exclude` (existing): Move passes its source category.

Hidden categories stay listed (`includeHidden` defaults to true). The list opens upward when there is less room
below than above, and its max-height is clamped to the room on that side, so every row is reachable with a mouse
at 1024×700.

**Popover** (`Popover.tsx`), two optional props: `dismissOnOutside` (a mousedown on the overlay closes it; used by
the breakdown) and `gap` (the distance from anchor to box, default 15; the breakdown uses 8). Existing callers are
unchanged.

**RTA box** (`ReadyToAssign.tsx`, rendered by `PlanHeader` inside `.plan-header-totals`; `pages/plan.tsx` is not
touched). Its state is the sign of `useMonth(...).data.ready_to_assign`, so it switches live with every cache
write.

| state | class | background / text | amount | label | right side |
|---|---|---|---|---|---|
| > 0 | `is-positive` | #346011 / #FFF | `$1,000.00` | Ready to Assign | button "Assign" + caret, bg #508316 |
| 0 | `is-zero` | #3C3E53 / #9B9CAA | `$0.00` | All Money Assigned | disabled check-circle button, aria-label "All Money Assigned" |
| < 0 | `is-negative` | #6A1020 / #FFF | `−$95.00` | You assigned more than you have | button "Fix This", bg #BF2E3B |

- The amount and the label sit in one button, "View Ready to Assign Breakdown", which opens the breakdown.
- The info icon after the amount shows on hover (in the negative state, always: ticket).
- Colours are local tokens at the top of `plan-header.css`, as that file already does.

**Breakdown popover** (`RtaBreakdown.tsx`), anchored to the box, 540 wide, gap 8, closes on Escape or a click
outside. `P` is the previous month's full name, `M` the viewed month's.

- Plus block. Header: green icon and `+$X`, where X = `left_over_from_previous + inflows`. When X ≠ 0, two lines:
  - "Ready to Assign left over from P"
  - "Inflow: Ready to Assign transactions in M"
- Minus block. Header: grey icon and `−$Y`, where Y = −(`cash_overspending_previous` + `assigned_in_month` +
  `assigned_in_future`). It shows "+$0.00" when Y = 0, as the source does. When Y ≠ 0, lines:
  - "Cash overspending in P"
  - "Assigned in M"
  - "Assigned in Future", only when non-zero
- Each line shows its signed amount in #C4C5CF.
- Total: "Total Ready to Assign" with `= +$Z` / `= −$Z` / `= $0.00`. It is green when positive, #EE5867 when
  negative and white at zero, and always equals the box.
- Message:
  - positive: "Give these dollars a job by assigning them to one or more categories!"
  - zero: "Nice work! Every dollar has a job."
  - negative: none (not observed)
- Help box: "Ready to Assign is money that hasn't yet been assigned to a category."

**Assign popover** (`AssignPopover.tsx`), anchored to the Assign button, 320 wide.

- Tab row: "Auto" is drawn but **disabled** (`aria-disabled`, title "Coming soon"); EXF-519 enables it.
  "Manually" is selected.
- "Assign:" amount field, prefilled `formatAssignedInput(ready_to_assign)`; it takes the same maths as the
  Assigned cell (`evaluateAssigned(text, prefill)`).
- "To:" picker over all categories, with no RTA entry.
- Cancel and Assign. Assign is disabled until a category is chosen and while the amount is ≤ 0.
- Assign posts the move `{ from: ready_to_assign, to: C, amount }` in the viewed month and closes the popover.
- Enter in the amount field acts as Assign when it is enabled.

**Fix This popover** (`FixThisPopover.tsx`), anchored to the Fix This button, 320 wide.

- "Un-assign money from".
- A month dropdown (a button with a listbox of our own, not a native select, so a real mouse can reach the
  rows):
  - the viewed month (default);
  - each later month up to `month-range.last_assigned_month` whose summary `assigned` ≠ 0, read with the
    existing `GET …/months?from&to` (at most 120 months).
  - Labels use `monthLabel` ("Nov 2026").
- A picker of the chosen month's categories with Available > 0 (`useMonth(chosen)`). Credit-card payment
  categories are the credit area's: nothing here.
- Cancel and OK. OK is disabled until a category is chosen.
- OK posts `{ from: C, to: ready_to_assign, amount: −ready_to_assign(viewed) }` in the chosen month. RTA(viewed)
  then becomes exactly 0, because RTA counts Assigned in every month.

**Move popover** (`MovePopover.tsx`), opened by a positive pill, anchored to it, 320 wide.

- "Move" amount field, prefilled `formatAssignedInput(available)`; the same maths as Assigned.
- "To" picker: the RTA entry first (amount = month RTA), then every category except the source.
- Cancel and OK. OK is disabled until a destination is chosen and while the amount is ≤ 0.
- An amount above Available is allowed.

**Cover popover** (`CoverPopover.tsx`), opened by a negative pill.

- "Cover overspending from", then a picker with the RTA entry and only the categories with Available > 0.
  There is no amount field.
- Cancel and OK. OK is disabled until a source is chosen; it posts the cover.

**Pill wiring.** `AvailablePill` gets `onOpen(anchor)`. Zero pills and the uncategorized pill stay disabled, as
today. `CategoryRow` passes it up, and `PlanGrid` holds the popover in its one-open-popover state
(`kind: "move" | "cover"`). A failed move shows the grid notice "Couldn't move the money.". A failure in the
header shows a 5-second alert under the box: "Couldn't assign the money." / "Couldn't un-assign the money.".

All popovers: Escape closes the picker list first, then the popover, and focus returns to the trigger. Focus is
trapped inside the popover. On open, the amount field is focused and selected (the picker is focused when there is
no amount field).

## Downstream effects

- `moveMoney`'s return type changes; its only callers are `months.test.ts` (which ignores the value) and the new
  service. The change_log `move` object gains `id`, `month` and `kind`; no reader exists yet.
- The write queue moves from `api/assigned.ts` to `monthCache.ts`; `useCommitAssigned` behaves the same.
- `AvailablePill` positive and negative pills now open popovers. Existing specs only focus the pill (Tab), so no
  assertion changes.
- `PlanHeader` renders the box itself; its `children` slot is removed (only `pages/plan.tsx` used the component,
  without children).
- The MCP coverage folder `apps/worker/test/mcp-coverage/` (EXF-572) is **not on main** at `325ee94`. The
  Implementer checks again on every rebase and, if the folder exists, adds `moves.ts` mapping the two operations
  to the two tools as `docs/conventions.md` will then say.

## Out of scope

The Auto tab's presets (EXF-519); Recent Moves, the clock icon, the "Moved" filter (EXF-506); Undo and Redo
(EXF-504); view chips and the Overspent count (EXF-500); row selection (EXF-498); the inspector (EXF-521);
credit-card payment categories in Fix This (credit area); the register's category field (EXF-517); plan
currency formats (EXF-468).

## Acceptance

Seed per case: a new `ZZ-TEST` plan (default categories) through the API, current month M; "balance X" = an
account made with starting balance X (the RTA inflow); Assigned set by `PATCH …/categories/{id}`; amounts in
dollars. "Real mouse": move to the element's centre, check `document.elementFromPoint` is it or inside it, click
with `page.mouse`. Category names below (Rent, Groceries, Fun) stand for any default categories.

### EXF-491

1. **Positive state** (not compared: forbidden by the Lead; the ticket describes it). Balance 1,000.00, nothing
   assigned. → The box shows "$1,000.00" (21px/700) and "Ready to Assign", background rgb(52,96,17), white text,
   radius 8px, and a button "Assign" with background rgb(80,131,22).
2. **Zero state** (compare live: "Test Budget", Plan, Nov 2026, dark theme as it is). Balance 100.00, assign
   100.00. → "$0.00", "All Money Assigned", rgb(60,62,83) / rgb(155,156,170); a disabled button named "All Money
   Assigned" with a check icon; no Assign button; height 62±2; the box starts right after the month block.
3. **Negative and live switch.** Balance 100.00, assign 150.00. → "−$50.00", "You assigned more than you have",
   rgb(106,16,32), a "Fix This" button rgb(191,46,59). Set that Assigned to 100.00 in the cell. → Without a
   reload the box turns grey, "All Money Assigned".
4. **Breakdown, zero** (compare live: as case 2, click the amount). → A 540px popover "Ready to Assign
   Breakdown" centred under the box with an arrow; "+$0.00" (green) and "+$0.00" rows with no detail lines;
   "Total Ready to Assign" "= $0.00"; "Nice work! Every dollar has a job."; the help sentence with no link.
   Escape closes it; reopened, an outside click closes it.
5. **Breakdown, positive and future.** Balance 1,000.00; assign 200.00 in M and 50.00 in M+1; view M. →
   "+$1,000.00" with "Ready to Assign left over from <M−1>" and "Inflow: Ready to Assign transactions in <M>";
   "−$250.00" with "Cash overspending in <M−1>", "Assigned in <M>", "Assigned in Future" (−$50.00); "= +$750.00",
   equal to the box; the "Give these dollars a job…" message. With nothing in M+1: no "Assigned in Future" line.
6. **Assign Manually.** Balance 4,270.00; click Assign (real mouse). → "Auto" disabled, "Manually" selected,
   "Assign:" "4,270.00", Assign disabled. Type "25", open the picker, type "Ren" (→ only the rent category, with
   its Available), pick it, click Assign (real mouse). → At once: the box $4,245.00, the category's Assigned and
   its group subtotal +25.00; the same after a reload; one `change_log` row with `move.from_category_id` null and
   amount 25000.
7. **Fix This, viewed month.** Balance 100.00; A 150.00 in M, B 30.00 in M+1; view M; click Fix This. → "Un-assign
   money from"; the dropdown lists "<M>" and "<M+1>" (short labels); the picker lists only categories with
   Available > 0 in the chosen month (A); OK disabled until a pick. Pick A, OK. → $0.00 "All Money Assigned";
   A's Assigned 70.00.
8. **Fix This, later month.** Same seed; choose "<M+1>", pick B, OK. → M's box $0.00; B's Assigned in M+1 is
   −50.00 (API).
9. **Picker filter.** Type a fragment of a group name. → That group's categories under it, each with its
   Available; a fragment matching nothing shows "No matching categories".

### EXF-492

10. **Move opens with full Available.** Rent Available 475.00; click its pill (real mouse). → "Move" "475.00", a
    "To" picker, OK disabled. Open the picker. → "Plan Categories", then "Inflow: Ready to Assign" with the
    month's RTA, then the groups; Rent not listed.
11. **Between categories.** Rent 475.00, Groceries 200.00; move 75 to Groceries. → At once Rent 400.00,
    Groceries 275.00 (Assigned and Available both by 75), group subtotals updated, RTA unchanged; same after a
    reload.
12. **Maths.** Type "20+5", pick a destination, OK. → 25.00 moved.
13. **To Ready to Assign.** Move 50 from Rent to "Inflow: Ready to Assign". → Rent's Assigned −50.00, box +50.00.
14. **More than Available.** Available 30.00, move 100.00. → The source −70.00, red pill rgb(191,46,59), Assigned
    −70.00.
15. **Cover.** Fun −70.00 (assigned −70.00), Groceries 275.00; click Fun's pill. → "Cover overspending from", no
    amount field; the picker lists "Inflow: Ready to Assign" and only categories with Available > 0. Pick
    Groceries, OK. → Fun 0.00 (disabled zero pill), Groceries 205.00.
16. **Zero pills** (compare live: "Test Budget", Nov 2026, a $0.00 pill). Click one. → Disabled, nothing opens, no
    hover change.
17. **REST and MCP parity.** Two identical plans; `POST /moves` vs `move_money`, `cover` vs `cover_overspending`
    with the same arguments. → Equal results apart from `move_id`; equal month read models; `change_log` rows
    equal apart from ids, times and actors (`user:…` vs `mcp:…`). A two-sided move writes two rows sharing one
    `move.id`; a move to or from RTA writes one.
18. **Errors.** 404: unknown plan; unknown or non-UUID category. 422: month `2026-11-15`; amount 0, −5, 1.5;
    `from` = `to`; both `"ready_to_assign"`; cover of a category with Available ≥ 0; cover from the category
    itself. All in `{ error: { id, name, detail } }`.
19. **Atomicity.** `buildMoveBatch` plus an appended failing statement. → Neither cell nor `change_log` changed.
20. **UI rollback.** Stub `POST …/moves` to answer 500; move 75. → The numbers change at once, then go back;
    "Couldn't move the money." shows.
21. **Real mouse, two sizes.** At 1440×900 and 1024×700, for the last visible category's pill and for the Assign
    and Fix This popovers: every popover button, the picker field, and the first and last picker rows (scrolled
    into view inside the list) pass the real-mouse check and act when clicked.

## Manifest

touches: [apps/worker/src/routes/moves.ts, apps/worker/src/services/moves.ts, apps/worker/src/services/months.ts, apps/worker/src/mcp/tools/moves.ts, packages/schema/src/moves.ts, packages/schema/src/months.ts, packages/schema/src/assigned-edit.ts, apps/worker/test/moves.test.ts, apps/worker/test/mcp-coverage/moves.ts, packages/schema/test/**, apps/web/src/plan/**, apps/web/src/api/moves.ts, apps/web/src/api/assigned.ts, apps/web/src/api/months.ts, apps/web/src/api/monthCache.ts, e2e/rta.spec.ts, e2e/moves.spec.ts, docs/rta-moves-design.md, docs/rta-moves-spec.md, docs/README.md]
shared: []
migrations: 0

## As built (departures from the plan)

- The MCP coverage folder `apps/worker/test/mcp-coverage/` was on main when the Build started (EXF-572); `moves.ts` there maps both operations to both tools.
- `buildMoveBatch(db, actor, v, moveId, reads, now)` takes the actor as its second argument (the log rows need it).
- A 422 thrown by the service (not overspent, cover from itself) carries the envelope name `error`, not `unprocessable_entity` (the shared error handler maps every `HTTPException` that way); schema failures keep `unprocessable_entity`.
- The picker input also opens its list on click, so a picked field can be reopened with the mouse.
- Two e2e support files: `e2e/support/real-click.ts` and `e2e/support/plan-seed.ts`.
