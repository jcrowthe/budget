# Sidebar account groups: implementation spec (EXF-483)

Design: [sidebar-groups-design.md](sidebar-groups-design.md). Follow `docs/conventions.md`. Run `pnpm check`
after each task. Run the new spec with `pnpm e2e e2e/sidebar-groups.spec.ts e2e/accounts.spec.ts`. After you
add the migration, delete `.e2e-state`.

Do not touch any of these:
- `apps/web/src/pages/**`, `apps/web/src/register/**`, `apps/web/src/plan/**`;
- `apps/web/src/api/{transactions,months,client}.ts`, `apps/web/src/router.tsx`;
- `AddAccountDialog.tsx`, `AccountTypePicker.tsx`;
- the transactions and months schema, service, repository and route files;
- `apps/worker/test/{openapi,mcp,existing-surface}.test.ts`, `e2e/mcp.spec.ts`;
- any file in `paths.always_overlap`.

## 1. Core rules: `packages/core/src/account-types.ts`

Add these, and change nothing that already exists:

```ts
export const DISPLAY_GROUPS = ["cash", "credit", "loans", "tracking", "closed"] as const;
export type DisplayGroup = (typeof DISPLAY_GROUPS)[number];
/** The account's group as REST/MCP report it: "closed" for any closed account, else by type. */
export function displayGroup(type: AccountType, closed: boolean): DisplayGroup;

export const SIDEBAR_SECTIONS = ["starred", "cash", "credit", "loans", "tracking", "closed"] as const;
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];
export interface SidebarAccountLike {
  id: string; name: string; starred: boolean; closed: boolean; group: DisplayGroup; balance: number;
}
/** Non-empty sections in SIDEBAR_SECTIONS order; total = sum of balances, null for "closed". */
export function sidebarSections<T extends SidebarAccountLike>(
  accounts: readonly T[],
): { name: SidebarSection; rows: T[]; total: number | null }[];
```

`displayGroup` maps `accountGroup` as follows: `cash`→`cash`, `credit`→`credit`, `loan`→`loans`,
`tracking`→`tracking`.

What `sidebarSections` puts in each section:
- **starred** holds `starred && !closed`.
- **cash, credit, loans and tracking** each hold the rows with `!closed && group === name`, in input order.
- **closed** holds the rows with `closed`, sorted by
  `a.name.localeCompare(b.name, "en", { sensitivity: "base" })`. The sort is stable, so ties keep the
  input order.

Use the account's `group` field. Do not recompute it from the type.

**Test** (`packages/core/test/account-types.test.ts`):
- `displayGroup` for all 13 types, open and closed.
- `sidebarSections` with the ticket's examples:
  - CREDIT −150000 and −75000 → −225000;
  - TRACKING 5000000 and −700000 → 4300000;
  - STARRED with one 312500 → 312500.
- Empty sections are left out. An empty input gives `[]`.
- A starred open account appears in starred and in its own group.
- A starred closed account appears only in closed.
- The closed section is sorted by name ("b", "A", "c" → A, b, c) and its `total` is `null`.

## 2. Account `group` in the schema and service

- `packages/schema/src/accounts.ts`:
  - Add `AccountGroup = z.enum(["cash","credit","loans","tracking","closed"]).openapi("AccountGroup")`.
    It repeats core, as `AccountType` does.
  - Add `group: AccountGroup` to `Account`, after `closed`.
  - Export `type AccountGroup`.
- `apps/worker/src/services/accounts.ts`: in `accountToApi`, add
  `group: displayGroup(row.type, row.closed)`.
- `apps/worker/src/mcp/tools/accounts.ts`: append this to the `list_accounts` description:
  ` Each has group: cash, credit, loans, tracking or closed (closed accounts of any type).`

**Test** (`apps/worker/test/accounts.test.ts`, new `describe("group")`):
- The schema enum's `options` equal core's `DISPLAY_GROUPS`.
- For each type in `ACCOUNT_TYPES`, create the account with the minimal `createAccount` service. It accepts
  loan types. Then:
  - REST `GET …/accounts` gives the expected open group.
  - MCP `list_accounts` (via `mcpRpc`) gives the same value per id.
  - Run `UPDATE accounts SET closed = 1 WHERE budget_id = ?`. Both now report `closed` for all 13.
  - Set `starred = 1` on one open account. Its `group` is unchanged (starred is not a group).

## 3. Migration and table

- `apps/worker/migrations/20261115231600_ui_state.sql`:

  ```sql
  CREATE TABLE ui_state (
    budget_id TEXT NOT NULL REFERENCES budgets(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (budget_id, key)
  );
  ```

- `apps/worker/src/db/schema/ui-state.ts`: `export const uiState = sqliteTable("ui_state", {...},
  (t) => [primaryKey({ columns: [t.budgetId, t.key] })])`. Its columns are `budgetId`, `key`, `value`
  (JSON text) and `updatedAt`. `schema-drift.test.ts` checks them.
- Afterwards delete `.e2e-state`.

## 4. `ui-state` schema: `packages/schema/src/ui-state.ts`

```ts
export const SidebarGroupName = z
  .enum(["starred", "cash", "credit", "loans", "tracking", "closed"]).openapi("SidebarGroupName");

/** Interface state, one line per key. A later Build adds a key here and nowhere else. */
export const UI_STATE_FIELDS = {
  collapsed_account_groups: z.array(SidebarGroupName).max(6),
};
export type UiStateKey = keyof typeof UI_STATE_FIELDS;
export const UiState = z.object(UI_STATE_FIELDS).partial().openapi("UiState");          // response
export const UiStatePatch = z.strictObject(UI_STATE_FIELDS).partial().openapi("UiStatePatch"); // PUT body
export const UiStateResponse = dataEnvelope(z.object({ ui_state: UiState })).openapi("UiStateResponse");
export type UiState = z.infer<typeof UiState>;
export type UiStatePatch = z.infer<typeof UiStatePatch>;
```

Do not use `.default()` on any field. Zod 4 would fill it into a partial PUT, and the merge would then
overwrite keys the caller did not send.

## 5. Repository, service and route

**`apps/worker/src/repositories/ui-state.ts`**
- `list(db, budgetId): Promise<UiStateRow[]>`.
- `upsertStmt(db, budgetId, key, valueJson, now)`. It returns an **unexecuted** insert, using
  `.onConflictDoUpdate({ target: [budgetId, key], set: { value, updatedAt } })`.

**`apps/worker/src/services/ui-state.ts`**
- `getUiState(env, budgetId): Promise<UiState>`.
  - A missing plan throws `NotFound("Plan")` (`budgetsRepo.findActive`).
  - Build an object from the rows. Keep a row only if its key is in `UI_STATE_FIELDS` and
    `UI_STATE_FIELDS[key].safeParse(JSON.parse(value))` succeeds. Catch bad JSON as well. Skip every
    other row silently.
- `setUiState(env, budgetId, patch: unknown): Promise<UiState>`.
  - Parse with `UiStatePatch`. A failure throws the `ZodError`, but the route has already validated, so it
    only reaches MCP or direct callers.
  - Check the plan the same way as `getUiState`.
  - Normalise `collapsed_account_groups`: remove duplicates and order by `SidebarGroupName.options`.
  - Run one `db.batch` of `upsertStmt` for each key sent. With no keys, skip the batch.
  - Return `getUiState(env, budgetId)`.
  - There is **no** `changeLogInsert` and no actor parameter.

**`apps/worker/src/routes/ui-state.ts`**
- Copy the shape of `routes/accounts.ts`: the `defaultHook` that turns validation errors into 422, the
  `budgetParam` and the `errors`. Use `tags: ["Interface state"]`.
- `GET /budgets/{budget_id}/ui-state` returns `200 UiStateResponse`.
- `PUT /budgets/{budget_id}/ui-state` takes a required JSON body of `UiStatePatch` and returns
  `200 UiStateResponse`, plus 403, 404 and 422.

No MCP tool.

**Test** (`apps/worker/test/ui-state.test.ts`):
- The surface: `apiPaths()` contains `/api/v1/budgets/{budget_id}/ui-state`.
- GET on a new plan → `{ data: { ui_state: {} } }`.
- PUT `["loans","starred","loans"]` → 200 `["starred","loans"]`. GET returns the same.
- PUT `{}` → unchanged. PUT `[]` → `[]`.
- An `INSERT` into `ui_state` of key `future_key` survives a PUT. It is still in the table and not in the
  GET.
- A stored row of `collapsed_account_groups` with value `'"x"'` is skipped by the GET (it returns `{}`).
- Each of these is a 422:
  - `{nope: 1}`;
  - `{collapsed_account_groups: ["savings"]}`;
  - `{collapsed_account_groups: "cash"}`;
  - 7 names.
- An unknown plan id is a 404 for both GET and PUT.
- `select count(*) from change_log where budget_id = ?` gives the same number before and after the PUTs.
- Two plans: a PUT on one leaves the other's GET `{}`.

## 6. Web API

**`apps/web/src/api/accounts.ts`**
- `useAccounts` now calls `listAccounts(budgetId, { includeClosed: true })`. Keep the key
  `["accounts", budgetId]` and the name. Update the doc comment to say "all accounts, closed included, in
  display order".

**`apps/web/src/api/ui-state.ts`** (new)
- `getUiState(budgetId)`: `GET` with the schema `UiStateResponse`, returning `.data.ui_state`.
- `putUiState(budgetId, patch: UiStatePatch)`: `PUT` with the body `patch` and the schema
  `UiStateResponse`.
- `uiStateKey = (budgetId) => ["ui-state", budgetId]`.
- `useUiState(budgetId: string | undefined)`: `useQuery`, `enabled: !!budgetId`, `staleTime: Infinity`.
- `useSaveUiState(budgetId)`: `useMutation` with these options:
  - `scope: { id: \`ui-state:${budgetId}\` }`, so saves run one after another;
  - `onMutate`, which writes `{ ...old, ...patch }` into `uiStateKey(budgetId)` at once;
  - no `onError` rollback and no message;
  - no invalidation.

## 7. Sidebar (`apps/web/src/shell/`)

**`accountTypeLabels.ts`**
- Replace `SIDEBAR_GROUPS` with `SIDEBAR_LABELS: Record<SidebarSection, string>`:
  STARRED, CASH, CREDIT, LOANS, TRACKING, CLOSED.

**`icons.tsx`**
- Add `ChevronDownIcon` (the existing right chevron rotated: own path, `viewBox 0 0 12 12`) and
  `PencilIcon` (own path, filled, `viewBox 0 0 12 12`).
- Use only our own artwork.

**`SidebarAccounts.tsx`**

Rewrite it with this signature:

```ts
export function SidebarAccounts(props: {
  budgetId: string; accounts: Account[]; onEdit?: (accountId: string) => void; // EXF-486 wires onEdit
})
```

What the component does:
- It reads `useUiState(budgetId)` and `useSaveUiState(budgetId)`.
  - While the ui-state query is pending, return `null`.
  - The collapsed list is `data?.collapsed_account_groups ?? []`. On an error, use `[]`.
- It finds the current account with `useMatch("/:budgetId/accounts/:accountId/*")?.params.accountId`.
- A toggle computes the next list and calls `save.mutate({ collapsed_account_groups: next })`.
- Money is `const money = (m) => formatMoney(m).replace("-", "−")`.
- The colour class is `negative` when the amount is below 0, `zero` when it is 0, `positive` otherwise.
  The section `loans` adds the class `loans` to its group, and the CSS turns off the red there.

DOM, one `<section className="nav-accounts" aria-label="Accounts">`:

```text
div.nav-account-group[data-group=<name>] (.loans for loans)
  button.nav-account-block[type=button][aria-label="collapse CASH"|"open CASH"][aria-expanded]
    ChevronDownIcon|ChevronRightIcon .chevron
    span.label  «CASH»
    span.value.<sign> «$1.00»            (omitted for closed)
    span.slot-right                      (empty)
  (when expanded) div.nav-account-row(.is-selected) per row, key `${section}:${id}`
    button.edit[type=button][title="Edit Account"][aria-label="Edit Account"] > PencilIcon
        onClick: e.preventDefault(); onEdit?.(a.id)
    NavLink.nav-account-link to=accountPath(budgetId, a.id)
      span.slot-left                      (empty: EXF-463 dot)
      span.name[title=a.name] «name»
      span.value.<sign> «−$150.00»
      span.slot-right                     (empty: EXF-465)
```

The two `slot-left` elements share the left slot: the empty dot slot stays under the absolutely
positioned pencil.

**`Sidebar.tsx`**
- No logic change is expected. The existing conditions already give the design's states once
  `useAccounts` includes closed accounts: groups when there are accounts, the "No Accounts" card when there
  are none.
- Pass nothing new: `onEdit` stays undefined until EXF-486.

**`global.css`**

Replace the `.nav-account-group h6` and `.nav-account-row*` rules with the following. Use tokens only, and
add a token to `tokens.css` only if a value is missing.

- **`.nav-account-group`**: `padding-top: var(--space-2)`.
- **`.nav-account-block`**
  - Layout: `display: flex`, `align-items: center`, `width: calc(100% - 13px - var(--sidebar-resizer))`,
    `height: 32px`.
  - Margin: the same as the old `h6`.
  - Reset: `padding: 0`, `border: 0`, `background: none`, `color: var(--labelPrimary)`,
    `cursor: pointer`, `font: inherit`. No hover change.
  - `.chevron`: `width/height 8px`, `margin: 0 8px 0 12px`, `flex: none`.
  - `.label`: `flex: 1 1 0`, `text-align: left`, 12px/500, `letter-spacing: 1.36px`, `line-height: 1.2`,
    ellipsis.
  - `.slot-right`: `width 16px`, `margin: 0 8px`, `flex: none`.
- **`.nav-account-row`**
  - `position: relative`, `height: 32px`, the same margin, `border-radius: var(--radius-md)`.
  - `:hover:not(.is-selected)` sets `background: var(--sidebarHover)`. `.is-selected` sets
    `background: var(--sidebarActive)`.
- **`.nav-account-link`**: `display: flex`, `align-items: center`, `height: 100%`, `color` inherit, no
  underline.
  - `.slot-left`: `width 16px`, `margin: 0 8px`, `flex: none`.
  - `.name`: `flex: 1 1 0`, `min-width: 0`, ellipsis, 14px/500, `line-height: 32px`.
  - `.slot-right`: `width 20px`, `margin: 0 8px`, `flex: none`.
- **`.nav-account-row .edit`**
  - `position: absolute`, `left: 8px`, `top: 8px`, `width/height: 16px`.
  - Reset: `padding: 0`, `border: 0`, `background: none`, `color: var(--labelPrimary)`.
  - Hidden by default: `visibility: hidden`, `opacity: .7`. The svg is 12px and centred.
  - `.nav-account-row:hover .edit` and `.nav-account-row .edit:focus-visible` set `visibility: visible`.
  - `.edit:hover` sets `opacity: 1`.
- **`.value`** (header and row)
  - `flex: none`, `max-width: 13rem`, 12px/500, `font-variant-numeric: tabular-nums`, `white-space: nowrap`,
    `color: var(--labelPrimary)`.
  - `.value.negative`: `color: var(--labelNegative)`, `font-weight: 600`, `padding: 2px 6px`,
    `border-radius: 1000px`, `background: transparent`, `margin: 0 -0.265rem 0.2em 0.5rem`.
  - `.nav-account-group.loans .value.negative`: `color: inherit`, `font-weight: inherit`, `padding: 0`,
    `margin: 0`.
- Keep `.nav-accounts { flex: 1; min-height: 0; overflow-y: auto }`.

**Verify.** Run `pnpm dev`, create a Checking, a Credit Card, an Asset and a Liability, and look at the
sidebar. Toggle a group and reload.

## 8. End-to-end

**`e2e/accounts.spec.ts`**: change only `"-$150.00"` → `"−$150.00"` and `"-$700.00"` → `"−$700.00"`.

**`e2e/sidebar-groups.spec.ts`** (new)

Helpers:
- `newPlan(request)` (as in `accounts.spec.ts`).
- `addAccount(request, id, name, type, balance)`: `POST /api/v1/budgets/{id}/accounts` with
  `authHeaders()`, where `balance` is in milliunits as entered (a positive number for owed amounts).
- `sidebar = page.getByRole("navigation", { name: "Sidebar" })`.
- `headers = sidebar.locator(".nav-account-block .label")`.
- `stubAccounts(page, accounts)`: `page.route("**/api/v1/budgets/*/accounts*", …)`. It fulfils GETs with
  `{ data: { accounts } }`; for any other method it calls `route.continue()`. Build the fixture accounts
  with a `fx(partial)` helper that fills every `Account` field, `group` included, and uses `ZZ-TEST` names.

Tests, mapped to the design's Acceptance cases:
1. **Cases 1, 2 and 4: real accounts.**
   - Checking 250000 → the headers are `["CASH"]`. The total is `$250.00` and there is one row.
   - Add a Credit Card of 150000, an Asset of 5000000 and a Liability of 700000, then reload. The headers
     are `["CASH","CREDIT","TRACKING"]`. CREDIT's total is `−$150.00` and TRACKING's is `$4,300.00`.
   - The card row's `.value` has text `−$150.00` and CSS colour `rgb(238, 88, 103)`. The checking value is
     `rgb(255, 255, 255)`.
2. **Case 5: collapse round-trip.** Click `getByRole("button", { name: "collapse CREDIT" })`.
   - The CREDIT group has 0 `.nav-account-row` and a visible total `−$150.00`.
   - The button `open CREDIT` exists.
   - Reload: still collapsed. `GET …/ui-state` returns `collapsed_account_groups` = `["credit"]`.
   - Click `open CREDIT`, wait for the PUT response, reload: expanded.
3. **Case 6: failed save.** Route `PUT **/ui-state` to status 500. Click `collapse CASH`. The group stays
   collapsed (`open CASH` is visible), and `getByRole("alert")` has count 0.
4. **Cases 3, 7 and 8: fixture.** Use a real plan with the case 3 fixture.
   - The headers are `["STARRED","CASH","CREDIT","LOANS","TRACKING","CLOSED"]`.
   - The totals are checked per group with `[data-group=…] .nav-account-block .value`. The closed group has
     0 `.value` in its header.
   - The LOANS value's colour is not `rgb(238, 88, 103)`.
   - The starred name appears in 2 rows.
   - The CLOSED `.name` texts are `["ZZ-TEST Alpha","ZZ-TEST Zeta"]`.
5. **Case 9: pencil.** Use a real Checking. The row's `Edit Account` button is hidden. After
   `row.hover()` it is visible with `title` "Edit Account". Clicking it leaves `page.url()` unchanged and
   `getByRole("dialog")` has count 0.
6. **Case 10: long name.** Use a real account with a long name. In `evaluate`,
   `scrollWidth > clientWidth`, and `title` is the full name.
7. **Case 11: current row.** `goto /{plan}/accounts/{id}`. The row has class `is-selected` and background
   `rgb(28, 31, 88)`. The other row does not have the class.
8. **Case 12: empty plan.** `.nav-account-group` has count 0. The "No Accounts" heading and the Add Account
   button are visible.

**Gate.** Run `pnpm check`, then `pnpm e2e e2e/sidebar-groups.spec.ts e2e/accounts.spec.ts --repeat-each=3`.
