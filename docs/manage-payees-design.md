# Manage Payees (EXF-510): design

No migration (`payees.hidden` exists). No shell file changes: the plan menu entry is enabled by one action file,
and the payee field opens the dialog itself. `apps/worker/src/app.ts` is not touched either, because routes are
collected by glob and `routes/payees.ts` already exists. Every file is inside the brief's ground (note 8), with one
addition: `e2e/support/manage-payees-seed.ts`, a support file named for this Build.

## The source app in this Build

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the Clerk's step 2.

**The source's Manage Payees dialog opens from its plan menu and from the payee field of a transaction row. Nobody opens either:** the plan menu lists the owner's other plans by name, and opening a transaction row in the source means typing into the owner's account. EXF-510's text holds what was seen of the dialog on 15 Nov, in detail (layout, groups, words, errors, the delete section).

**What may be read, and nothing else:** in the Clerk's tab as it stands (the test plan's Plan page), **the source's loaded style rules and its already-loaded static script files** (same-origin files the page has loaded, read without navigating; the dialog's words may be found there and compared with the ticket's). In a tab of your own on the same address you may add throw-away elements with the source's classes to measure a look (a dialog's frame and two panes, a list row with its checkbox, a group header, a card, the buttons), and then close that tab.

**What nobody ever does in the source, each with its reason:**
- **Click anything on the page: a row, a cell, a button, a month, an account; open the plan menu, Manage Payees or the address `/users/budgets`.** Reason: above; and an earlier Build's sub-agent clicked a row to try something. This Build has nothing to try in the source.
- **Type into any field; create, edit or delete anything; open any account page, All Accounts, Reconcile, Reflect or settings.** Reason: it is the owner's account.
- **Read or print any text of the sidebar's header or the account menu, or print the sidebar's or the page's whole text.** Reason: the plan's name and the signed-in address are there.
- **Fetch a script file the page has not loaded, let a sub-agent do so, or keep a copy of a source script in the repository.**
- **Leave the tab changed; keep a screenshot of the source that shows more than your own probe elements.**

So the dialog's behaviour and layout are **"not compared: built from the ticket"**, which is a complete and acceptable answer; only looks and words read from the style rules or the loaded script files count as compared.

**Each step states in its report, for itself only, every action it took in the source app (style rules read, script files read and probe elements included), or that it opened nothing. Nobody but the Clerk runs the Clerk's commands; a step that runs them has opened the source and says so.**

## Source (what was read)

Notes: `/workspace/scratch/source/manage-payees/notes.md` (§1 words with their keys, §2 style rules, §3 measured probes,
dark values = the clone's only theme); probe images `probe-*.png` there. The Architect's sub-agent read the style rules
(~9 times), searched the 20 already-loaded same-origin scripts, and built probe elements in its own tab (opened and
closed 3 times); no click, key or navigation in the source tab, no script kept.

- **Words: compared** (notes §1). Beyond the ticket: `No Transactions` replaces the button at zero; `Select 1 Unused
  Payee` / `Select {n} Unused Payees`; `1 transaction is using this payee(s). Select a new payee for this transaction.`;
  `Unhide All`; `Expand {g}`/`Collapse {g}`, `Check all {g}`/`Uncheck all {g}`; `Clear search`, search title `Find the
  payees you're looking for...`; empty plan `You don’t have any payees yet! Come back once you have some transactions.`;
  mixed selection `Only one payee group can be edited at a time. Please` [link `deselect transfer payees`] `to continue.`
- **Looks: compared** (notes §2–3): dialog `min(1136px, 90vw)` × `90vh`, header 48, footer padding 16 with a top border;
  left pane 293; group header and row 33 px, 14 px; no selected-row fill (selection is the ticked box); right pane
  padding 16 on `--backgroundPrimary`; cards on `--backgroundSecondary`, radius 8; error bar `#6a1020`/white; info box
  `--calloutPrimarySubtleBackground`; destructive `#6a1020`/`#feedeb`; popover 608 px. The two colours missing from
  `tokens.css` become local custom properties at the top of `manage-payees.css` (as `account-header.css` does).
- **Behaviour: not compared, built from the ticket**, except three facts read from the templates: transfers and hidden
  start collapsed; `Select N Unused Payees` counts the not-hidden, non-transfer payees with no transactions among the
  search's results; `No Transactions` at zero.

## Approach

### Worker

| Operation | Tool | Refuses |
|---|---|---|
| `GET /budgets/{budget_id}/payees` (+ `transaction_count`, `scheduled_count`, always) | `list_payees` | 404 plan |
| `PATCH …/payees/{payee_id}` `{name?, hidden?}` | `rename_payee`, `set_payee_hidden` | 404; 403 transfer/system; 422 empty name `Payee name cannot be empty` or no field; 409 `Another payee already exists with this name` |
| `DELETE …/payees/{payee_id}?replacement_payee_id=` | `delete_payee` | 404; 403; 422 bad replacement |
| `POST …/payees/bulk` `{payee_ids 1–1000, action hide\|unhide\|delete, replacement_payee_id?}` | `bulk_update_payees` | 404 plan; 403; 422 unknown id or bad replacement |
| `GET …/payees/{payee_id}/transactions` | `list_payee_transactions` | 404; 403 |

Tools: 89 today, 94 after. Exact words in the spec.

- **Counts:** `transaction_count` = live transaction rows with that `payee_id` in non-deleted accounts (a split line
  counts on its own; a deleted row counts for nothing); `scheduled_count` = live scheduled rows. Transfer entries 0/0.
  Two grouped subqueries in `listForPlan`'s one select: **the list stays at 3 D1 calls.**
- **Rename:** trimmed, ≤ 200 chars; exact duplicate among live ordinary payees (hidden included) → 409; case-only
  differences accepted (the unique index is case-sensitive, as the source); unchanged → no write; a unique-index race
  → 409. Transactions are **not** rewritten: every read takes the name through the `payees` join.
- **Holders of a payee's id, moved by a delete:** `transactions.payee_id` (`db/schema/transactions.ts:25`, parents and
  split lines, `services/transaction-splits.ts:72`) together with the reads' fallback `transactions.payee_name` (`:13`,
  set to the replacement's name or null; otherwise `[No Payee]` would still show the old name);
  `scheduled_transactions.payee_id` (`db/schema/scheduled-transactions.ts:16`, its `write_token` renewed so an
  in-flight edit is refused). Not moved: `change_log` copies (history); `imported_payee`, `import_payee_name`,
  `bank_description` (bank text, not ids). The import finds payees by name (`services/plaid-sync.ts:308`): a deleted
  payee is created again by the next import of that name; a hidden one keeps receiving imports, still hidden.
- **Delete batch (single and bulk, one builder), 4 statements whatever the rows:** log rows (`logSelectStmt`), the
  `transactions` move (repositories/transactions.ts `movePayeeStmt`), the scheduled move
  (repositories/scheduled-transactions.ts `movePayeeStmt`), the payees' soft delete. One guard on all: every id still a
  live ordinary payee of the plan, the replacement (if any) a live ordinary payee of the plan not among the ids. Fewer
  rows deleted than ids → 409 `The payees changed meanwhile. Try again.` Ids ride **one JSON parameter** (`json_each`),
  under D1's 100-parameter limit. Replacement: ordinary payees (hidden allowed) or none; transfer and system → 422.
- **Hide/unhide:** one log statement and one update over the rows whose `hidden` differs.
- **History:** one `change_log` row per changed payee (`entity_type` `payee`, the actor): rename/hide `update` with
  `{id, name, hidden}` before and after; delete `delete` with before `{id, name, hidden, transaction_count,
  scheduled_count}` and after `{id, deleted: true, replacement_payee_id, transactions_moved, scheduled_moved}`. **The
  reassigned transactions get no row of their own**; the payee's delete row records the move.
- **Popover read:** live transactions (parents and lines) and live scheduled rows (`date_next`) of the payee, newest
  first, cut at **500**, with `total_count`.
- **This app never hides a payee by itself** (nothing in `apps/worker/src` writes `hidden = true` on payees; imports
  create `hidden: false`), so the hidden note leaves out the ticket's last sentence.

### D1 calls (pinned by `apps/worker/test/manage-payees-calls.test.ts`)

| Request | Calls |
|---|---|
| list, before / after (10 and 100 payees) | 3 / 3 (plan, payees with counts, accounts) |
| rename | 4 (plan, payee, name check, batch) |
| hide | 3 (plan, payee, batch) |
| delete with 1 and with 500 transactions | 3 and 3 without replacement; 4 and 4 with one |
| bulk delete of 10 (and 100), with replacement | 4 (4) |
| bulk hide of 10 (and 100) | 3 (3) |
| popover read (1 and 500 transactions) | 4 and 4 (plan, payee, transactions, scheduled) |

### Web

- **One query:** the dialog reads the register's `usePayees(budgetId)` (`["payees", b]`, already with hidden and system
  payees, now with counts): one request, one cache for the register, the payee field and the dialog. Opening the
  dialog invalidates it once (fresh counts). The popover has `["payee-transactions", b, id]`. After a change,
  `invalidatePayeeViews(qc, b)` invalidates `payees`, `transactions`, `scheduled-transactions`, `category-activity`,
  `report-transactions`, `payee-transactions` for that plan: mounted queries refetch once; no reload.
- **Frame** (`apps/web/src/payees/`): portal modal `Manage Payees` with `Close` ✕; left pane search, windowed list,
  pinned `Select N Unused Payees` link (hidden at 0; position not compared); right pane the edit pane; footer `Undo`
  and `Redo` on the left (EXF-510 AC10, built: see item 14), primary `Done` on the right. Tab cycles
  inside; Escape closes; handled in a **window** capture listener so the register's and the split dialog's document
  listeners never see them. Focus returns to the opener. Own hook; nothing imported from `plan/`, `reflect/`,
  `plan-export/`.
- **List:** fixed 33 px rows, only the visible ones ±10 rendered (no dependency). `Payees` (open; ordinary, not hidden,
  `compareNames`), `Transfer Payees` (closed), `Hidden Payees` (closed, only while one is hidden, greyed names).
  **System payees are not listed** (the app sets them). Header: chevron `Expand <g>`/`Collapse <g>`, checkbox `Check
  all <g>`/`Uncheck all <g>` (mixed when partial), label with ` (n)` for n selected. Row: checkbox `Check <name>`,
  name button `Select <name>` (ellipsis + `title`). Name click selects alone; checkbox toggles; group checkbox adds or
  removes the group's shown rows. Search: every whitespace word a case-insensitive substring; headers stay; the
  selection survives. A payee that moves group by hide/unhide opens its new group.
- **Keyboard (chosen):** the list is one tab stop with `aria-activedescendant`; Up/Down/Home/End move; Space ticks (on a
  header: its group checkbox); Enter selects alone (on a header: opens or closes); Right/Left open/close a header.
- **Pane:** none → drawing (Budget's own outlined-tag SVG) and `Select a payee to edit.`; one ordinary → card `Payee
  Name` (Enter or blur saves, unchanged sends nothing, Escape with unsaved text reverts; errors in a red bar under the
  input), `Show N Transactions` / `No Transactions`, `Hide`/`Unhide`, `Delete`, the note without its last sentence;
  one transfer → heading and info box (`Budget creates these for you…`), no buttons; several → `<n> Payees Selected`,
  the comma-separated names (each cut at 240 px with a `title`), `Hide All` (`Unhide All` when all hidden), `Delete
  All`; several with a transfer → the `Only one payee group…` sentence. Categorization and Renaming leave no gap.
- **Delete:** N = Σ(transaction_count + scheduled_count). N = 0 → deleted at once. Otherwise the `New payee` section
  replaces the buttons (cards above dimmed): the sentence for N, a select labelled `New payee` (`[No Payee]` first,
  then the other ordinary payees by `compareNames`), `Cancel`, `Delete` / `Delete All` (`Deleting...` pending). Success
  clears the selection. More than 1,000 ids go in chunks of 1,000.
- **Popover `Transactions`:** inside the dialog under its button, with an arrow, clamped 16 px from the edges, 608 wide;
  columns ACCOUNT, DATE, CATEGORY (name, `Ready to Assign`, `Split` or empty), MEMO, AMOUNT; header buttons sort
  (DATE descending by default); `Close` ✕ and button; Escape closes only it. Dates and amounts through
  `usePlanFormatter()`. Beyond 500: `Showing the newest 500 of <total>.`
- **From the payee field:** the footer button loses `disabled`; `onMouseDown` prevents default so the list stays until
  the click; the click opens the same dialog, rendered by `PayeeField` in a portal (`budgetId` from the route). On
  close, focus returns to the payee input (its list reopens as on any focus); **the row's draft is untouched.** No
  shell file changes.
- **Sizes:** 1024×700 → dialog 921.6 × 630, left 293, right ≈ 628; 1440×900 → 1136 × 810, right ≈ 843.
- **2,000 payees:** memoised model, ~40 rows in the DOM; budgets open ≤ 1,500 ms on an idle box (the spec allows 2,500 ms under load; menu click → first row), filter
  ≤ 300 ms (typed letter → filtered list); figures printed and reported.

## Downstream effects

- `Payee` gains two required fields: the helper `p` in `packages/schema/test/payees.test.ts` gets them (fields only).
- Departures (expectations changed): (1) `e2e/plan-menu.spec.ts` "6 EXF-470" lists `Manage Payees` as enabled;
  (2) `e2e/payee-picker.spec.ts` first test `toBeDisabled()` → `toBeEnabled()`; (3) its skipped test runs: skip and
  comment removed, the payee hidden with `PATCH …/payees/{id}` `{hidden: true}`, expectations unchanged.
  `e2e/shell-compare.spec.ts` asserts labels only: unchanged.

## Out of scope

`Categorization` card (EXF-515); `Renaming` card and gear icon, `has_rules` (EXF-467); `Combine and Rename` (EXF-512);
Undo/Redo (EXF-530, EXF-504).

## Found, not built

1. Transfer payees as a replacement (the source lists them; one would turn a purchase into a transfer).
2. ~~The several-selected `Show N Transactions` and its PAYEE-column popover~~ Built: `GET …/payees/transactions?payee_ids=a,b`
   (a sibling of the single-payee path; same four D1 calls for any number of payees, `json_each`) and `list_payee_transactions`
   with an optional `payee_ids` (same tool, so the tool count is unchanged). Rows carry `payee_name`; the popover adds a
   PAYEE column (first; the source's column order was not checked in its app) when several are selected.
3. After a rename, the next import with the bank's old text creates that payee again (`plaid-sync.ts:308`); EXF-467.
4. A draft row whose picked payee is deleted in the dialog is refused on Save (`Payee not found in this plan`). Steps:
   Add Transaction, pick `ZZ A`, footer `Manage Payees`, delete `ZZ A`, `Done`, `Save`.

## Acceptance

All cases run against the real local server, with each plan seeded through the API (`e2e/support/manage-payees-seed.ts`:
payees `ZZ Phone Co`, `XX PHONECO 99`, `ZZ Cafe A` (3 transactions), `ZZ Cafe B` (1 transaction, 1 scheduled),
`ZZ Unused` (its only transaction deleted), accounts `ZZ Checking` and `ZZ Card`). There are no stand-ins. Clicks use
`realClick`. Behaviour: "not compared: built from the ticket".

1. **Opens from the menu.** Plan menu → `Manage Payees`. The dialog `Manage Payees` shows `Payees` open, `Transfer Payees`
   closed, no `Hidden Payees`, and the right pane `Select a payee to edit.` `Done` closes it, and focus is back on the plan
   button. (EXF-510 AC1)
2. **Opens from the payee field.** Add Transaction, type `ZZ`, then `Manage Payees` in the list's footer. The same dialog
   opens. Escape closes it, the row is still open with `ZZ` in the payee input, and the input has focus. (AC1)
3. **Groups.** Open `Transfer Payees`: it shows `Transfer : ZZ Card` and `Transfer : ZZ Checking`. Tick `Check ZZ Cafe A`:
   the label reads `Payees (1)`. `Check all Payees` ticks every payee row; clicking it again unticks them all. (AC2)
4. **Search.** Type `PHONE co`: only `ZZ Phone Co` and `XX PHONECO 99` are listed, and the three headers stay. Type `qqq`:
   only the headers show. `Clear search` restores the list. (AC3)
5. **Rename errors.** Select `ZZ Cafe B` and rename it to `ZZ Cafe A`, then Enter: the red bar reads `Another payee already
   exists with this name`, and nothing changes in the list. Clear the field and Tab: `Payee name cannot be empty`. Rename
   it to `zz cafe a`: no error. (AC4)
6. **Rename updates the register.** Rename `ZZ Cafe A` to `ZZ Cafe Z` and press Done. The account register shows `ZZ Cafe Z`
   on its three rows without a reload. (AC4)
7. **Show N Transactions.** `ZZ Cafe A` shows `Show 3 Transactions`, and `ZZ Cafe B` shows `Show 2 Transactions`. The popover
   `Transactions` has the five headers, 3 rows newest first, and dates and amounts in the plan's formats. Clicking DATE
   reverses the order, and `Close` closes the popover only. (AC5)
8. **Transfer payee.** Select `Transfer : ZZ Card`: the heading `Transfer : ZZ Card` and the info box sentence show, with no
   input and no buttons. Tick `ZZ Cafe A` as well: the `Only one payee group…` sentence shows, and `deselect transfer payees`
   leaves `ZZ Cafe A` selected alone. (AC6; the Renaming card is not built: EXF-467)
9. **Hide and unhide.** Select `ZZ Cafe A`, then `Hide`. `Hidden Payees` appears, open, with the greyed row, and the button
   reads `Unhide`. In the payee field, `ZZ Cafe` no longer offers `ZZ Cafe A`. `Unhide` puts it back in `Payees`, and the
   picker offers it again. (AC7)
10. **Delete unused.** Select `ZZ Unused`, then `Delete`: it leaves the list at once with no question, and the pane shows the
    empty state. (AC8)
11. **Delete used.** Select `ZZ Cafe A`, then `Delete`. The `New payee` section reads `3 transactions are using this payee(s).
    Select a new payee for these transactions.` The select starts at `[No Payee]` and lists no `Transfer :` entry.
    `Cancel` brings the buttons back. Choose `ZZ Cafe B`, then `Delete`: the register shows `ZZ Cafe B` on those three rows,
    and `ZZ Cafe B` shows `Show 5 Transactions`. Deleting with `[No Payee]` leaves the payee cell empty. (AC8)
12. **Select unused.** With the seed the link reads `Select 1 Unused Payee`; clicking it ticks `ZZ Unused` alone (`Payees (1)`). After a payee `ZZ Spare` is added through a transaction that is then deleted, it reads `Select 2 Unused Payees` and ticks both. With `Spare` in the search it reads `Select 1 Unused Payee`. (AC9)
13. **Several selected.** Tick three payees: `3 Payees Selected`, the three names, `Hide All` and `Delete All`. `Hide All`
    moves all three to `Hidden Payees`. `Delete All` on a set with transactions shows the `New payee` section with the summed
    count, and a button reads `Delete All`. (AC9, scope note 1)
14. **Undo, Redo, Done.** Both buttons are disabled when the dialog opens. Each write the dialog makes (rename, hide, delete
    with a replacement, the category card, the rename rules) is recorded with `origin: "payees"`; `Undo` reverts the last
    one and `Redo` applies it again. Only entries made since the dialog opened count (D2), so a register change made
    before opening does not enable `Undo`, and a new change empties `Redo`. A refusal shows in the footer
    (`role="alert"`). `Done` closes the dialog. No keyboard shortcut. (AC10 built, `e2e/manage-payees-undo.spec.ts`;
    EXF-882 item 3: a delete with a replacement undoes completely, `docs/undo-design.md` "U5")

    **U5 departures:** the web store's `recordChange` has no `where` parameter, so none is passed (the engine's answer
    carries `where: {surface: "payees", payee_ids}`); the hook is `useUndo(budgetId, scope)`; `savePayeeCategory` is
    recorded too, or Undo after a category change would revert an earlier rename; a bulk of more than 1000 ids sends one
    request per chunk and records one entry per chunk; `invalidateFor` does not exist, `useUndo` already refetches every
    query of the plan and the dialog then calls `invalidatePayeeViews`; the edit pane is remounted after each step so its
    name draft re-reads the restored payee.
15. **Keyboard.** Tab to the list, ArrowDown to `ZZ Cafe A`, then Space: the box is ticked. Enter selects it alone. Tab
    reaches `Payee Name`. Escape closes the dialog, and focus returns to the opener. Tab never leaves the dialog.
16. **Narrow window.** At 1024×700, with a seeded 120-character payee `ZZ Long …` and a 120-character memo on its
    transaction: the dialog lies inside the window, left pane 293 px, right pane ≥ 600 px; the long name is cut with
    an ellipsis and a `title` in the list and in the selected names, and the memo likewise in the popover (it has no
    payee column).
17. **Worker.** Every operation, its tool, each refusal with its status and words, the history rows, atomicity (an
    appended failing statement leaves nothing changed), and the D1 counts of the table above.
18. **2,000 payees.** One spec seeds 2,000 payees. The open time and the filter time are within the budgets above, and
    scrolling to the end shows the last name. The figures are printed in the test's output.
19. **The skipped spec.** `e2e/payee-picker.spec.ts` has no `test.skip`, and its hidden-payee test passes.

### Looking (Tester: this is your main work)

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state **against the real local server** (a plan seeded through the API; no stand-in), takes a **fresh** screenshot in this Thread, **opens it**, and writes one sentence on what is seen in it (not what a measurement says). The report lists `state, size, file, sentence`. A state without its two entries is PARTIAL with the words "not looked at". **Seven states, fourteen screenshots, every one opened; take no others unless something looks wrong.**

1. The dialog just opened: the three groups in the left pane (`Payees` open, `Transfer Payees` closed, `Hidden Payees` present), nothing selected, the right pane's empty state.
2. One payee selected: the `Payee Name` card with `Show N Transactions`, `Hide`, `Delete` and the note.
3. A rename to a name that exists: the red bar with its sentence.
4. The `Transactions` popover of a payee with several transactions.
5. A hidden payee selected: its greyed row, `Unhide`.
6. `Delete` on a payee with transactions: the `New payee` section with its select, `Cancel` and `Delete`.
7. Three payees selected by their checkboxes: the group label's count, the names, `Hide All` and `Delete All`.

(For state 1 the Tester first hides one payee through the API, so that `Hidden Payees` is present.)

## The order of the work

1. The Worker: the list's counts, rename and hide (PATCH), their tools, the counting tests.
2. The Worker: delete with a replacement, bulk, the popover's read, their tools.
3. The dialog: the action file, the frame, the list with groups, search and selection, the empty state.
4. The edit pane for one payee: rename with its errors, `Show N Transactions`, Hide and Unhide; the payee field's button; the skipped spec.
5. Delete (unused, used with the `New payee` section), `Select N Unused Payees`.
6. Several selected; a transfer payee selected; the narrow window; the keyboard; the 2,000-payee measurement.

**If the Build runs long, parts 1 to 4 are the ones that must be whole** (a payee can be found, renamed and hidden from the dialog, and every operation has its tool); say plainly in the report what of parts 5 and 6 is not done, and the Lead tickets it. A part half done is worse than a part left out.

## Manifest

touches: [apps/worker/src/routes/payees.ts, apps/worker/src/services/payees.ts, apps/worker/src/repositories/payees.ts, apps/worker/src/repositories/transactions.ts, apps/worker/src/repositories/scheduled-transactions.ts, apps/worker/src/mcp/tools/payees.ts, apps/worker/test/manage-payees*.test.ts, apps/worker/test/mcp-coverage/payees.ts, apps/worker/test/mcp-timestamps.test.ts, packages/schema/src/payees.ts, packages/schema/test/payees.test.ts, packages/schema/test/manage-payees.test.ts, apps/web/src/payees/**, apps/web/src/menu-actions/manage-payees.tsx, apps/web/src/api/payees.ts, apps/web/src/register/PayeeField.tsx, apps/web/src/register/entry.css, e2e/manage-payees*.spec.ts, e2e/support/manage-payees-seed.ts, e2e/payee-picker.spec.ts, e2e/plan-menu.spec.ts, docs/manage-payees-design.md, docs/manage-payees-spec.md, docs/manage-payees-polish.md, docs/README.md]
shared: []
migrations: 0
