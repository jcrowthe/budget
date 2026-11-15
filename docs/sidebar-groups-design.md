# Sidebar account groups design (EXF-483)

The sidebar's plain account list becomes typed groups: STARRED, CASH, CREDIT, LOANS, TRACKING, CLOSED. Each
group has a total (except CLOSED), and each group collapses. The account gains a derived `group` field in
REST and MCP. A new small resource, `ui-state`, stores interface state per plan. It starts with one key,
`collapsed_account_groups`. Spec: [sidebar-groups-spec.md](sidebar-groups-spec.md).

## Source

Studied live on the plan "Test Budget" (own tab, look-only). The notes and screenshots are in
`/workspace/scratch/source/sidebar-groups/`:

- `notes.md`
- `css-rules-nav-account.txt`
- `dom-*.txt`
- `01`–`08-*.png`

That plan has only closed accounts, so only CLOSED could be seen live. The other groups come from the
ticket and the source's CSS rules.

- **Place.** The groups sit under the nav links (Plan, Reflect, All Accounts) and directly above the "Add
  Account" button. When the plan has only closed accounts, there is no "No Accounts" card, just CLOSED
  (`03`).
- **Group.** Each group starts with 8px of padding above it. The header is one 32px flex row with margin
  `0 5px 4px 8px`. It holds:
  - a button with `aria-label` "collapse CLOSED" when expanded and "open CLOSED" when collapsed;
  - an 8×8 chevron (down when expanded, right when collapsed) with margin `0 8px 0 12px`;
  - the literal uppercase label, 12px/500, letter-spacing 1.36px, white;
  - the total (an empty element for CLOSED);
  - an empty 16px right slot with margin `0 8px`.

  Hovering the header changes nothing except the pointer cursor. When a group is collapsed, its rows are
  removed from the DOM. The state persists across navigation.
- **Row.** Each row is 32px tall, repeats every 36px (margin `0 5px 4px 8px`) and has radius 6px. It holds:
  - a left 16×16 slot (margin `0 8px`) with `title="Edit Account"`, containing a 12×12 pencil at opacity
    0.7 (1 when the pencil itself is hovered). The same slot holds the approval dot, which the pencil
    replaces on hover;
  - the name, 14px/500, white, one line with an ellipsis, starting at x=40, with the full name as its
    `title`;
  - the balance, 12px/500, tabular numbers, right-aligned;
  - a right 20×20 status slot with margin `0 8px`.

  The link goes to `/<plan>/accounts/<id>`.
- **Backgrounds.** Hover is `#1b1d48` (`--sidebarHover`). The selected row is `#1c1f58` (`--sidebarActive`,
  the same as the active nav link), and hovering it does not change it.
- **Pencil.** The source shows it only on hover, or while that account's Edit dialog is open (CSS
  `.is-editing-this-account`). The selected row shows **no** pencil (`06`), which differs from the ticket
  and the Lead's note 4. This plan follows the source; see *Deviations*.
- **Balance colours.** Positive and zero balances are white. Negative balances are red `#ee5867`
  (`--labelNegative`), 12px/600, in a transparent pill with padding 2px 6px. In the LOANS group, the CSS
  makes a negative balance inherit the normal colour, so loan rows and the loan total are **not** red.
- **Formatting.** Amounts look like `$0.00`. The minus sign could not be seen live; the ticket and the Plan
  grid use U+2212 (`−$150.00`).
- **Sort order of CLOSED.** The ticket and Lead say A→Z by name. The live plan lists closed accounts as
  D3 Checking Main, D6 Mortgage, D3 RTA Probe, D3 Tracking Probe, which is not alphabetical. This plan
  follows the Lead; see *Deviations*.
- **Narrow sidebar mode.** The groups are hidden entirely there. This clone has no narrow mode, so it is out
  of scope.

## Approach

1. **The `group` rule is pure, in core, and derived on every read.**

   In `packages/core/src/account-types.ts`:
   - `DISPLAY_GROUPS = ["cash", "credit", "loans", "tracking", "closed"]`.
   - `displayGroup(type, closed)` returns `"closed"` for any closed account. Otherwise it maps
     `accountGroup(type)` to its group (`loan` → `loans`).
   - The existing `accountGroup`, `AccountGroup` and the other functions do not change.

   `accountToApi` (in `services/accounts.ts`) adds `group`. REST and MCP both use this one function, so the
   two always agree. `change_log` snapshots made through `accountToApi` now also carry `group`, which is
   harmless and consistent with the API shape.

2. **The sidebar's layout is built by a second pure function.** `sidebarSections(accounts)` lives in the
   same core file and is generic over `{ id, name, closed, starred, group, balance }`. It returns the
   sections in the fixed order and skips empty ones:
   - STARRED holds the open starred accounts.
   - CASH, CREDIT, LOANS and TRACKING hold the open accounts of each group, in the API's order.
   - CLOSED is sorted by name, A→Z (`localeCompare`, base sensitivity; ties keep the API order).
   - Each section has `total` = the sum of its balances, or `null` for CLOSED.

   Because this is in core, it is unit-tested with the ticket's worked examples.

3. **`ui-state` is a key/value resource.**
   - **Table.** `ui_state(budget_id, key, value JSON text, updated_at)`, primary key `(budget_id, key)`.
   - **Schema.** `packages/schema/src/ui-state.ts` holds `UI_STATE_FIELDS`, an object with **one line per
     key**:

     ```ts
     collapsed_account_groups: z.array(SidebarGroupName).max(6)
     ```

     The other schemas are built from it:
     - `UiState` = `z.object(fields).partial()`. It is the response; keys never set are absent.
     - `UiStatePatch` = `z.strictObject(fields).partial()`. It is the PUT body; an unknown key is a 422.
   - **GET** returns the stored keys that still parse. A row whose key is unknown, or whose value no longer
     validates, is skipped and never breaks the read.
   - **PUT** upserts one row per key sent, in one `db.batch`. That is the merge: keys not sent are not
     touched. PUT returns the full merged state.
   - **Normalising.** Before storing, the service removes duplicate group names and orders them in sidebar
     order.
   - **No history.** No `change_log` row is written: this is interface state, not plan data. The service
     therefore takes no actor.
   - **Missing plan.** A missing or deleted plan is a 404.
   - **Adding a key later.** A later Build adds one line to `UI_STATE_FIELDS`. It needs no migration, no
     route change and no service change.
   - **MCP.** No tools are added (`get_ui_state` and `set_ui_state` were left out). An agent rarely needs
     interface state, and leaving them out keeps the MCP surface to plan data.

4. **The web reads both and saves the collapse state optimistically.**
   - `useAccounts` keeps its name and its query key `["accounts", budgetId]`, so every existing
     invalidation still reaches the sidebar. It now asks for closed accounts too (`include_closed=true`).
     The Sidebar is its only user.
   - `api/ui-state.ts` adds two hooks:
     - `useUiState(budgetId)`, with the key `["ui-state", budgetId]`.
     - `useSaveUiState(budgetId)`. It writes the new value into the query cache at once, then PUTs.
       Failures are silent: no rollback and no message. Saves run in order through a mutation
       `scope` per plan, so the last click wins on the server. It does not invalidate.
   - `SidebarAccounts` renders the sections. Collapsed names come from `uiState.collapsed_account_groups ?? []`.
     - While the ui-state query is pending, nothing is drawn, so collapsed groups never flash open.
     - If the ui-state query fails, every group is shown expanded.

## What changes

### Data and API

- New migration `apps/worker/migrations/20261115231600_ui_state.sql` (additive: one table).
- `Account` gains `group: AccountGroup`, where `AccountGroup` is the OpenAPI name of the enum
  `cash|credit|loans|tracking|closed`. It appears in:
  - `GET /budgets/{id}/accounts` and `GET /budgets/{id}/accounts/{id}`;
  - the `POST` response;
  - MCP `list_accounts` and `create_account`.

  The `list_accounts` description mentions `group`.
- `GET /api/v1/budgets/{budget_id}/ui-state` returns `200 {data:{ui_state:{collapsed_account_groups?: SidebarGroupName[]}}}`.
- `PUT` on the same path takes a body of type `UiStatePatch`:
  - 200 with the merged `ui_state`;
  - 422 for an unknown key, an unknown group name, a non-array value or more than 6 entries;
  - 404 for an unknown plan.

  The path appears in OpenAPI automatically (route glob).

### Sidebar (user-visible)

**Order and empty states**
- Groups appear in the fixed order STARRED, CASH, CREDIT, LOANS, TRACKING, CLOSED. A group with no rows is
  not drawn.
- A plan with no accounts at all still shows the existing "No Accounts" card and Add Account, and no
  groups.
- A plan with only closed accounts shows CLOSED and no card (as in the source).

**Header**
- The header is a `<button class="nav-account-block">` holding the chevron (down when expanded, right when
  collapsed), the label, the total and an empty right slot.
- `aria-label` is "collapse CASH" when expanded and "open CASH" when collapsed. `aria-expanded` matches.
- Clicking the header toggles the group at once and saves the change.
- A collapsed group draws only its header. Its total stays visible.

**Total**
- The total is the sum of the group's working balances, with the same colour rules as rows.
- CLOSED has no total.

**Row**
- A `div.nav-account-row` (with `is-selected` on the current account) holds a pencil `<button>` and a link.
- The link's accessible name contains the name and the balance.
  - The name is `.name`: ellipsis, `title` = the full name.
  - The balance is `.value`, with one of `.negative`, `.zero` or `.positive`.
  - An empty right slot of 20px is kept for EXF-465.
- **Selection.** The current account is found with `useMatch("/:budgetId/accounts/:accountId/*")`. Its row
  is highlighted in STARRED and in its type group.

**Pencil**
- The pencil is a `<button>` with `title` "Edit Account" in the left slot. It is visible on row hover or
  when it has focus.
- Clicking it calls `onEdit(account.id)`. That handler is a no-op until EXF-486, so the click does not
  navigate.
- The left slot is also the reserved approval-dot slot (EXF-463). Nothing is drawn there.

**Money and colours**
- Amounts use `formatMoney` with `-` replaced by `−` (U+2212).
- Negative amounts are red with `--labelNegative`, except inside LOANS. Zero and positive amounts use
  `--labelPrimary`.

### Unchanged

- The Add Account dialog, the account page, the router and `api/client.ts`.
- `e2e/accounts.spec.ts` needs only two strings changed: `-$150.00` and `-$700.00` become `−$150.00` and
  `−$700.00`. The class names it uses (`.nav-account-row`, `.name`) are kept.

## Downstream effects

- **EXF-484 (star) and the close/reopen ticket.** They only need to invalidate the accounts query of
  their plan (`["accounts", budgetId]`). STARRED and CLOSED then follow, because the group is derived.
- **EXF-486.** It wires `SidebarAccounts`'s `onEdit` to open its dialog. It may add an
  `is-editing-this-account` class to keep the pencil shown while the dialog is open.
- **EXF-482 (loans).** LOANS works as soon as loans can be created.
- **EXF-490 (drag reorder).** It reorders within a section. The rows keep the API's `sort` order.
- **EXF-463 and EXF-465.** They fill the left dot slot and the right status slot.
- **Later Builds** (the Plan progress-bar choice, display options) add one line to `UI_STATE_FIELDS` and use
  `useUiState` and `useSaveUiState`.

## Out of scope

- Starring, closing, reopening and creating loans (EXF-484, the close ticket, EXF-482).
- The Edit Account dialog (EXF-486).
- Approval dots (EXF-463) and linked status icons (EXF-465).
- Drag reorder (EXF-490).
- Bank Connections, the narrow sidebar mode and sidebar resize.
- The account page, the register and the Plan files (Lead's note 6).

## Deviations to confirm with the Lead

1. **Pencil on the selected row.** The live source shows no pencil on the selected row (only on hover or
   while editing). The ticket and Lead's note 4 say "and the selected row". This plan follows the source.
2. **Sort order of CLOSED.** The live source orders closed accounts like D3 Checking Main, D6 Mortgage,
   D3 RTA Probe, D3 Tracking Probe (not alphabetical; probably by account order). The ticket and the Lead
   say A→Z by name. This plan follows the Lead.
3. **LOANS negatives are not red.** This comes from the source CSS rule `.nav-account.loan .negative`
   (inherit). The ticket's general rule would make them red. This plan follows the source.

## Acceptance

There are two kinds of case:
- **Clone** cases: run on a fresh plan made through the API (`ZZ-TEST …` names), unless a fixture is named.
  A fixture answers `GET …/accounts*` with `page.route` on a real plan id.
- **Compare** cases: they name the source state to reproduce live. That is always the plan "Test Budget",
  in its default dark theme, desktop at about 1600×800. Look only, and put any group back as it was.

1. **Only CASH.** On a plan with one Checking account of $250.00, the sidebar shows exactly one header,
   CASH, with the total "$250.00". It has one row: the name and "$250.00".
2. **Group order and totals.** Add a Credit Card owing 150, an Asset of 5000 and a Liability owing 700.
   The headers read CASH, CREDIT, TRACKING in that order. CREDIT's total is "−$150.00" and TRACKING's is
   "$4,300.00".
3. **Fixture order and totals.** Use a fixture with:
   - one starred Checking of 312500;
   - Credit Cards of −150000 and −75000;
   - a Mortgage of −100000000;
   - an Asset of 5000000 and a Liability of −700000;
   - closed accounts "ZZ-TEST Zeta" and "ZZ-TEST Alpha".

   The headers read STARRED, CASH, CREDIT, LOANS, TRACKING, CLOSED. The totals are:
   - STARRED "$312.50";
   - CREDIT "−$225.00";
   - LOANS "−$100,000.00", not red;
   - TRACKING "$4,300.00".

   CLOSED has no total text.
4. **Negative and positive colours.** The −$150.00 card row's balance reads "−$150.00", with U+2212, and
   its computed colour is `rgb(238, 88, 103)`. The $250.00 row's colour is `rgb(255, 255, 255)`. A $0.00
   row is white too.
5. **Collapse survives a reload.** Click the header "collapse CREDIT".
   - The CREDIT rows disappear. The header remains with "−$150.00" and a right chevron, and its aria-label
     reads "open CREDIT".
   - After a reload it is still collapsed.
   - `GET …/ui-state` returns `collapsed_account_groups: ["credit"]`.
   - Click "open CREDIT": the rows come back. After a reload they are still expanded.
6. **A failed save keeps the screen.** Answer `PUT …/ui-state` with a 500 and click "collapse CASH". The
   group collapses and stays collapsed, and no alert or message appears.
7. **STARRED.** With the fixture of case 3, STARRED is first. Its row also appears in CASH: the same name
   appears in two rows.
8. **CLOSED.** With the fixture of case 3, CLOSED is last. Its rows read "ZZ-TEST Alpha", "ZZ-TEST Zeta",
   its header has no total, and none of the closed accounts appears in another group.
9. **Pencil.**
   - Before a hover, the row's "Edit Account" button is not visible. When the row is hovered, it is
     visible and its `title` is "Edit Account".
   - Clicking it leaves the URL unchanged and opens no dialog.
   - **Compare (source):** hover a CLOSED row in "Test Budget" with the group expanded. The pencil appears
     in the left slot. Collapse the group again afterwards if it was collapsed.
10. **Long name.** Create an account named "ZZ-TEST " followed by 60 characters. Its `.name` has
    `scrollWidth > clientWidth`, computed `text-overflow: ellipsis`, and `title` equal to the full name.
11. **Current row.** Open `/{plan}/accounts/{checking id}`. That row has the class `is-selected` and the
    background `rgb(28, 31, 88)`, and other rows have neither.
    - **Compare (source):** open a closed account from CLOSED in "Test Budget". Its row is highlighted the
      same way and shows no pencil until hovered.
12. **Empty plan.** On a new plan with no accounts, there are no `.nav-account-group` elements. The "No
    Accounts" card and "Add Account" are shown.
13. **Header look (compare).** In "Test Budget", expand CLOSED (then collapse it back). Compare with the
    clone in case 8:
    - the header is 32px, the label 12px/500 with letter-spacing 1.36px;
    - the chevron is 8px and the label starts 28px from the header's left edge;
    - rows are 32px tall and repeat every 36px; the name is 14px/500 at x=40.
14. **API: `group` in REST and MCP** (Worker test). For each of the 13 types, the account's `group` is:
    - open: `cash`, `credit`, `loans` or `tracking`;
    - after `closed` is set to 1 in the database: `closed`;
    - always the same in REST `GET …/accounts` and MCP `list_accounts`.
15. **API: `ui-state`** (Worker test).
    - A new plan's GET returns `{}`.
    - `PUT {collapsed_account_groups:["loans","starred","loans"]}` returns and stores
      `["starred","loans"]`.
    - `PUT {}` leaves it unchanged.
    - A row stored directly under another key survives a PUT.
    - These are each a 422: an unknown key, the name `"savings"`, a string value, 7 names.
    - An unknown plan is a 404.
    - The plan's `change_log` row count is the same before and after every PUT.
    - The path is in `apiPaths()`.

## Manifest

touches: [packages/core/src/account-types.ts, packages/core/test/account-types.test.ts, packages/schema/src/accounts.ts, packages/schema/src/ui-state.ts, apps/worker/migrations/*_ui_state.sql, apps/worker/src/db/schema/ui-state.ts, apps/worker/src/repositories/ui-state.ts, apps/worker/src/services/ui-state.ts, apps/worker/src/routes/ui-state.ts, apps/worker/src/services/accounts.ts, apps/worker/src/mcp/tools/accounts.ts, apps/worker/test/accounts.test.ts, apps/worker/test/ui-state.test.ts, apps/web/src/api/accounts.ts, apps/web/src/api/ui-state.ts, apps/web/src/shell/SidebarAccounts.tsx, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/accountTypeLabels.ts, apps/web/src/shell/icons.tsx, apps/web/src/shell/global.css, apps/web/src/shell/tokens.css, e2e/sidebar-groups.spec.ts, e2e/accounts.spec.ts, docs/sidebar-groups-design.md, docs/sidebar-groups-spec.md, docs/README.md]
shared: [packages/core/src/account-types.ts: adds DISPLAY_GROUPS, displayGroup and sidebarSections (pure group and section rules read by the Worker and the web); apps/web/src/shell/{SidebarAccounts.tsx, Sidebar.tsx, accountTypeLabels.ts, icons.tsx, global.css, tokens.css}: the grouped sidebar, its labels, chevron-down and pencil icons, and its styles]
migrations: 1
