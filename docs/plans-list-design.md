# Plans list and New Plan design (EXF-469, EXF-471, riders EXF-746, EXF-798)

Web only: no Worker source change, no migration. Brief and tickets: EXF-469 (New Plan with formats), EXF-471
(`/plans`: list, open, create, delete), EXF-746 (cut placement label), EXF-798 (bank logo).

## The source app in this Build

The source app is the owner's real account. The only plan anyone may open is the test plan, at the address of the Clerk's step 2 (`https://app.ynab.com/542b334b-696e-4418-937a-5e2c21a8b45c/budget`).

**What may be looked at and read:** the test plan's Plan page, as it stands in the tab, and **the source's style rules** (its loaded style sheets, read from that tab without navigating). In a tab of your own on the same address you may add throw-away elements with the source's classes to measure a look (a dialog's width, a card, a destructive button), and then close that tab; nothing is saved by that. Reason: an earlier Designer did exactly this and found real differences; it touches none of the owner's data.

**What nobody ever does in the source, each with its reason:**
- **Open the plan menu (the plan's name at the top of the sidebar), its "New Plan" or "Open Plan" entries, or the address `/users/budgets`.** Reason: every one of them lists the owner's other plans by name, and those are private. This is exactly where this Build's screens live in the source, so none of them is opened: EXF-469's text holds what was seen of the New Plan dialog on 15 Nov, and EXF-471 was written from help pages without opening the page.
- **Open Plan Settings, any account page, Add Account, Bank Connections, Reconcile, Reflect; create, edit or delete anything; type into any field.** Reason: it is the owner's account; a Designer who pressed a button in Reconcile signed the whole session out; a plan made or deleted there is the owner's.
- **Leave the tab changed:** an override is set back and the Clerk's tab stays on the test plan's Plan page. Reason: earlier steps left a size override behind and the next step's check failed.

So the behaviour and the layout of this Build are **"not compared: built from the ticket"**, which is a complete and acceptable answer; only looks read from the style rules count as compared. The Designer's work is inside the clone: consistency with the clone's own dialogs (Plan Settings, the confirmation dialogs) and cards, tokens only, both window sizes.

**Each step states in its report, for itself only, every action it took in the source app (reading style rules and probe elements included), or that it opened nothing.**

**Architect, in the source:** a sub-agent read every style sheet rule from the existing test-plan tab (one
`page.evaluate`), opened one own tab on the test-plan address, appended probe elements, read computed styles, took a
screenshot of the probes, closed that tab. Nothing clicked, typed, navigated or resized in the app.

## Source (style rules only: `/workspace/scratch/source/plans-list/notes.md`, `probe-cards-and-dialogs.png`)

From the source's style rules: list page padding 1rem 2rem, heading 1.5rem/700; grid `repeat(auto-fill, 13rem)`,
gap 1rem; card 208 px, radius 0.75rem, padding 0.5rem, no border/shadow, a 9rem tinted thumbnail, name 1rem/600
with ellipsis, "last" line 0.875rem/500 secondary; hover shows a dark overlay and the trash button 0.5em from the
bottom-right corner; a create card with "+" and a 1rem/600 label. Modals 30rem (480 px); in the settings modal the
currency fields sit in a flex row; buttons 2rem high, radius 0.5rem; red button `.button-red`. **The source confirms
a delete inside the card** (`.are-you-sure`); the brief decides for a dialog. Everything else (behaviour, wording,
order, layout): **not compared: built from the ticket**.

## Approach

### 1. EXF-798: the logo
The Worker returns `institution_logo` as a whole data address (`apps/worker/src/services/bank-connections.ts:123`);
`shell/manage-connections-logo.tsx:10` prefixes it again. Fix: `src={c.institution_logo}`. The stand-in
(`e2e/support/bank-link-stub.ts:147`) returns `c.logo ? \`data:image/png;base64,${c.logo}\` : null`, the Worker line's
exact mapping (`logo` stays base64 in `FakeConnection`). Other logo images: `shell/BankSearch.tsx:42,195` use
`institution.logo`, already whole (`apps/worker/src/plaid/institutions.ts:57`): unchanged.

### 2. Shared format fields, New Plan (EXF-469), Plan Settings (EXF-746)
- **One component** `apps/web/src/plan-settings/new-plan-format-fields.tsx` (`PlanFormatFields`): Currency, Currency
  Placement, Number Format, Date Format, with all catalogue logic moved out of `PlanSettingsDialog.tsx` (labels,
  optgroups, currency change resets number format and placement, date labels). `idPrefix` keeps today's ids
  (`plan-settings-currency`, …); New Plan uses `new-plan-*`.
- **EXF-746: both remedies.** Plan Settings becomes 480 px (`.dialog.form`, as New Plan; 440 today) **and** Currency
  and Currency Placement get a full-width row each, in both dialogs. Measured (Figtree 500 14px, canvas): USD label
  185 px, CHF 209, SEK 189, KWD 211, longest in the catalogue (IRR) 220. Side by side at 480 a select leaves ~184 px
  of text room (USD cut); a row of its own ~400. The placement select carries `title` = the chosen label and keeps
  `text-overflow: ellipsis`.
- **Not `scrollWidth`:** a closed `<select>` in Chromium reports `scrollWidth === clientWidth` even when cut (probe:
  118/118 for a 120 px select with a 27-character label), so the ticket's reading cannot fail; the spec measures
  the label's text width (Acceptance 5).
- **New Plan dialog** (`shell/NewPlanDialog.tsx`): title `New Plan`, no ✕, `aria-modal`; Plan Name empty, focused,
  `maxLength 100`; the four fields at `DEFAULT_PLAN_FORMATS` (USD, before, `123,456.78`, `MM/DD/YYYY`); `Cancel`,
  `Create Plan` (disabled only while pending). Empty trimmed name: `Plan name is required.` under the field
  (`aria-invalid`, focus back), nothing sent. `Create Plan` sends **one** `POST /api/v1/budgets` `{ name,
  currency_format: { iso_code, example_format, symbol_placement }, date_format: { format } }`; on success the answer
  is appended to the `["budgets"]` cache (no refetch, no "Plan not found" flash), the dialog closes and
  `/<id>/budget` opens. A refusal shows its message (`role=alert`). Escape and `Cancel` close, nothing sent.
- **`bank_environment`:** none sent, so the server stores `"production"` (`apps/worker/src/services/budgets.ts:146`;
  column default `apps/worker/migrations/20261116002832_budgets_bank_environment.sql:1`), as today. Left as is.

### 3. The plans page (EXF-471)
- `pages/plans.tsx`: `page = { path: "/plans", element: <PlansListPage /> }` (a static segment outranks
  `/:budgetId`); the page lives in `apps/web/src/plans/`. Title `Open Plan`, h1 `Your Plans`, a `<ul
  aria-label="Plans">` grid: cards in `recentOtherPlans(plans, undefined, plans.length)` order (`shell/useCurrentPlan.ts`:
  most recently used first, never opened last, ties in server order), then the `Create New Plan` card.
- **Reads `useBudgets()` only** (the shell's query): no second fetch.
- **Card** (`<li>`): a `<Link to="/<id>/budget">` covering the card, its name the plan name (`aria-labelledby`), the
  last-used line its description (`aria-describedby`); keyboard and "open in new tab" come with the link. A sibling
  `<button aria-label="Delete Plan" title="Delete Plan">` (shell `TrashIcon`) at the bottom-right is
  `visibility: hidden` except under `:hover` **and** `:focus-within` of the card, so Tab from the link reaches it.
  Name: one line, ellipsis, `title` = name.
- **Last used:** pure `lastUsedText(lastOpenedAt: string | null, now: number)` in
  `packages/schema/src/plans-list-time.ts` with tests; the clone's rule (floors of elapsed time, no calendar):

  | `now − last_opened_at` | Text |
  |-|-|
  | `null` or unreadable | `Never opened` |
  | under 60 s, or in the future | `Last used just now` |
  | 1–59 min | `Last used 1 minute ago` / `Last used N minutes ago` |
  | 1–23 h | `Last used 1 hour ago` / `Last used N hours ago` |
  | 24–47 h | `Last used yesterday` |
  | 2–29 days | `Last used N days ago` (72 h → `Last used 3 days ago`) |
  | 30–364 days | `Last used 1 month ago` / `Last used N months ago`, N = min(11, ⌊days/30⌋) |
  | 365 days and more | `Last used 1 year ago` / `Last used N years ago`, N = ⌊days/365⌋ |

  `now` = `Date.now()` at render. No absolute date is shown, so no formatter is involved.
- **`Create New Plan`**: a `<button>` card (`PlusCircleIcon`) opening the same `NewPlanDialog`; Cancel refocuses it.
- **Delete:** the trash opens `plans/plans-list-delete.tsx`: dialog `Delete Plan` (aria-label and h2, ✕ `Close`),
  text `Are you sure you want to delete plan <name>?`, `Cancel` and a red `Delete`, in the classes of the clone's
  Unlink/Remove confirmations (`dialog form edit-account`, `.destructive`). Escape, ✕, Cancel close. `Delete` sends
  **one** `DELETE /api/v1/budgets/{id}` (`useDeleteBudget`, disabled while pending); on success the plan leaves the
  `["budgets"]` cache (no refetch), the card goes, the app stays on `/plans`, focus goes to `Create New Plan`; the
  plan menu and `/` follow from the cache. A refusal shows its message in the dialog (`role=alert`), nothing
  removed. **No other way to delete** (no shortcut, no bulk, no delete without this dialog).
- **No plan at all:** the heading and only `Create New Plan`. Not built: shared plans, Fresh Start.

### 4. Ways in
- `menu-actions/view-all-plans.ts`: `{ entry: "view-all-plans", run: ({ navigate }) => navigate("/plans") }`. The
  registry already lists the entry (not `needsPlan`), so no shell edit enables it. Named by the registry
  convention (`<entry-id>.ts`): the one new file without `plans-list`/`new-plan` in its name.
- **Open Plan always shows** (the Lead's decision): the registry cannot carry it, so the smallest change in
  `shell/PlanMenu.tsx`: drop the `open-plan` row filter; render the submenu whenever `sub`; the `Recent Plans`
  heading, the links and the separator only when `others.length > 0`. With no other plan the submenu is only
  `View All Plans`.
- **Bare `/`:** `pages/home.tsx` renders `<PlansListPage />` (title `Open Plan`) when the list is empty instead of
  "Create your first plan"; with plans it still opens the last used one.

### 5. The shell on `/plans`
`shell/Sidebar.tsx`: `plansPage` = `useMatch("/plans")`, or `/` with a loaded empty list; it joins `notFound` in
every condition that hides plan things: plan button `No Plan Open`; no Plan/Reflect/All Accounts links, account
list, `No Accounts` card, `Add Account`, `Bank Connections`; **the resize handle is not rendered** (the ticket).
The collapse button stays. The menu works: New Plan, Open Plan, Keyboard Shortcuts, Log Out enabled; `needsPlan`
entries disabled (the registry). `PlanScope` is not mounted: no open recorded, no sync.

## What a deleted plan leaves behind (note 6: read, not changed)
- `DELETE` (`apps/worker/src/services/budgets.ts:240-261`): `findActive`, then one batch (change_log +
  `softDeleteStmt`, `repositories/budgets.ts:69-71`). Accounts, their `bank_account_id` and connections are untouched.
- **Nightly:** `scheduled.ts:13-29` → `syncDueConnections` → `listDue` (`repositories/bank-connections.ts:151-162`):
  no plan filter (connections are global). `syncConnection` keeps only live plans' accounts
  (`services/plaid-sync.ts:205-213`), so nothing is imported into a deleted plan, but `fetchBalances`
  (`plaid-sync.ts:226`) still calls Plaid nightly for a connection linked only to deleted plans. → **Found, not
  fixed** (candidate).
- **Plan sync** of a deleted plan: 404 (`syncPlan` → `getBudgetEnvironment` → `findActive`, `plaid-sync.ts:908-910`).
- **Linking elsewhere:** allowed; the unique index (`migrations/20261116100600_account_links.sql:3-4`) and the checks
  (`repositories/accounts.ts:350-389`, `:417`) are per plan. `linkedToConnection`/`noLinksToConnection`
  (`repositories/accounts.ts:463-476`) ignore plan deletion: a connection used only by deleted plans counts as in
  use, and removing it unlinks those accounts with change_log rows on the deleted plan. → **Found, not fixed**
  (candidate).
- **`/` and the menu** read `GET /budgets` (`deleted_at IS NULL`, `repositories/budgets.ts:7-9`); `PlanScope` shows
  "Plan not found" for an id not listed; after a delete here the cache drops the plan at once.

## D1 calls (no Worker operation changes)
`GET /budgets` **1**, `POST /budgets` **1** (`apps/worker/test/plan-formats-calls.test.ts:62,68`); `DELETE
/budgets/{id}` **2** (`findActive` + one batch), measured once with that file's `counting()` in a throw-away test,
since deleted: `DELETE_CALLS=2 LIST_CALLS=1`. The plans page adds no request to the shell's; create = one POST,
delete = one DELETE, neither refetches.

## Where another plan's name can now be seen (note 10)
New: the cards of `/plans`, each card name's `title`, the delete confirmation's text. Before: the Open Plan submenu
(five recent). `/plans` has no plan name in its title (`Open Plan`), address or plan button (`No Plan Open`); nothing
is logged.

## Downstream, out of scope, departures
- Departures: (1) EXF-746's spec measures text width, not `scrollWidth` (§2); (2) EXF-469's Currency and Currency
  Placement are stacked, not side by side (EXF-746); (3) `e2e/plan-menu.spec.ts` test 7 expects `View All Plans`
  enabled and test 8 becomes "a single plan has Open Plan with only View All Plans"; (4) delete confirms in a
  dialog, not the source's in-card overlay (the brief).
- Unchanged and still passing: `plans.spec.ts`, `shortcuts.spec.ts` A4, `plan-urls.spec.ts` C10 (labels and
  `Cancel|Close` still match), `e2e/plan-settings*.spec.ts` (ids and labels kept).
- Out of scope: Worker, migrations, MCP, sharing, Fresh Start, renaming from the list, the light theme, every
  out-of-bounds file of the brief's note 9.

## Acceptance

Specs make their own `ZZ-TEST` plans through the API with unique names, find cards by those names, delete only
their own plans, never assert the number of cards, the first card or the absence of other cards; `realClick`
(`e2e/support/real-click.ts`); `expect.poll` after a click that sends a request; exact names.

1. **EXF-798** (`e2e/plans-list-bank-logo.spec.ts`, first): stand-in connection with `logo` = a 1×1 PNG; in Manage
   Bank Connections the list row's `img` and the detail's bank-account row `img` have `naturalWidth > 0`; no console
   message contains `ERR_INVALID_URL`. Fails before the fix (quote the line); `e2e/manage-connections*.spec.ts` pass.
2. **AC469-1** (`e2e/new-plan.spec.ts`): plan menu → New Plan: title `New Plan`, no `Close` button, Plan Name empty
   and focused, Currency `USD`, placement `Before amount ($123,456.78)`, Number Format `123,456.78`, Date Format
   `12/30/<this year>`, Create Plan enabled.
3. **AC469-2:** JPY → Number Format options exactly `123.456`, `123,456`, `123 456`, `123,456` selected. EUR →
   `Before amount (€123,456.78)`, `After amount (123,456.78€)`, `Don't show (123,456.78)`; format and placement are
   `currencyByCode("EUR")`'s defaults.
4. **AC469-3/4/5:** Cancel, and Escape, send no POST. Empty name (and spaces only) + Create Plan →
   `Plan name is required.`, no POST. Unique name + EUR + `DD.MM.YYYY` + Create Plan → exactly one POST with that
   body; URL `/<id>/budget`; sidebar button has the name; `GET /budgets/<id>` holds EUR and `DD.MM.YYYY`.
5. **EXF-746** (`e2e/new-plan-placement.spec.ts`, first): at 1440×900 and 1024×700, in Plan Settings (own plan) and
   New Plan, for USD, EUR, CHF, SEK, KWD and each placement: the chosen label's text width (canvas, the select's
   computed font) + 24 px (native arrow) ≤ `clientWidth − padding-left − padding-right`; `title` = the label; the
   dialog box inside the viewport. Fails on the present code for USD in Plan Settings (quote the line);
   `e2e/plan-settings*.spec.ts` pass unedited.
6. **AC471-1** (`e2e/plans-list.spec.ts`): P1, P2, P3 created; `PATCH {opened:true}` P2, P3, P1 in turn (poll until
   stamps increase). `/plans`: title `Open Plan`, heading `Your Plans`; own cards in the order P1, P3, P2, each
   `Last used just now`; an own never-opened P4 reads `Never opened`. With `page.clock.setFixedTime(P1 stamp + 3 days
   + 1 min)` before load, P1 reads `Last used 3 days ago`.
7. **AC471-2:** a click on P2's card opens `/<P2>/budget`; Tab to P3's link + Enter opens P3; links' `href` =
   `/<id>/budget`.
8. **AC471-3 hover/focus:** trash hidden at rest; visible with the mouse over the card; visible when the card's link
   has keyboard focus; Tab from the link focuses `Delete Plan`.
9. **AC471-3 delete** (`e2e/plans-list-delete.spec.ts`): own D1, D2. Trash on D1 → `Are you sure you want to delete
   plan <D1>?`; Cancel, Escape, ✕ each close with no DELETE. Delete → exactly one DELETE; D1's card gone; URL
   `/plans`; `GET /budgets/<D1>` 404; D2 200 with its name; Open Plan submenu has no D1. A DELETE answered 409 by
   `page.route` (server error shape) shows its detail in the dialog; the card stays.
10. **AC471-4:** `Create New Plan` opens New Plan; Cancel refocuses the card; creating opens the new plan.
11. **Empty list:** `GET /api/v1/budgets` stood in by `{ data: { budgets: [] } }`, parsed in the spec with
    `BudgetListResponse` (and by `apiFetch` with the same schema: a wrong shape shows `Could not load plans.`). On
    `/plans` and `/`: `Your Plans`, `Create New Plan`, no link in the Plans list; title of `/` `Open Plan`.
12. **One request:** loading `/plans` sends `GET /api/v1/budgets` once; no request URL holds a plan id.
13. **Ways in** (`e2e/plans-list-ways-in.spec.ts`): Open Plan → `View All Plans` (enabled) opens `/plans`. With the
    list cut to one own plan (`showOnlyPlans`): Open Plan shows; its submenu's menuitems are exactly `View All
    Plans`; no `Recent Plans`.
14. **Shell on `/plans`:** button `No Plan Open`; no Plan/Reflect/All Accounts links, `Add Account`,
    `Bank Connections`, `No Accounts`, `.sidebar-resizer`; menu New Plan enabled, Plan Settings `aria-disabled`.
15. **Narrow** (`e2e/plans-list-narrow.spec.ts`, 1024×700): fewer grid columns than at 1440×900; page `scrollWidth ≤
    clientWidth`; a 100-character own name is one line, cut (`scrollWidth > clientWidth`, `text-overflow:
    ellipsis`), `title` = the name; its delete dialog and New Plan lie inside the window.
16. `pnpm check` green, with `plans-list-time.test.ts` (the table's rows) and the repository tests.
17. **Compare:** looks read from the source's style rules (card 208 px, gap 16, name 1rem/600 ellipsis, modal
    480 px) by the Designer; the rest not compared: built from the ticket.

### Looking

For each state below, at 1440×900 and at 1024×700: the Tester drives the clone to that state, takes a **fresh** screenshot in this Thread (not a file a spec or an earlier step wrote), opens it, and writes one sentence on what is seen in it. The report lists `state, size, file, sentence` for every one. A state without its two entries is PARTIAL with the words "not looked at". "A spec is green" is not looking. **On the live app nobody will ever be able to look at the plans page (note 10), so what the Tester sees here is the only time an eye is on it.**

The states:
1. The New Plan dialog as it opens (the defaults, the cursor in Plan Name).
2. The New Plan dialog with Euro chosen, and with the error under an empty Plan Name after `Create Plan`.
3. The Plan Settings dialog for a US dollar plan and for a Swiss franc plan: the closed Currency Placement select (EXF-746).
4. The plan menu's Open Plan submenu with `View All Plans` enabled.
5. The plans page with at least three plans of the Tester's own, used at different times, and the `Create New Plan` card.
6. One card with the mouse over it (the trash button), and the same card reached by the keyboard.
7. The delete confirmation.
8. The plans page with a plan whose name has 100 characters.
9. The plans page with no plan at all (through the stand-in answer of note 7).
10. The Manage Bank Connections list and a connection's detail with a bank that has a logo (EXF-798, with the browser stand-in).

## The order of the work (Implementer: commit after each part)

1. EXF-798: the failing spec, the stand-in's shape, the one-line fix.
2. The shared format fields, the New Plan dialog (EXF-469) and the Plan Settings width (EXF-746, its spec first).
3. The relative-time function with its tests; the plans page with open and create.
4. Delete with its confirmation.
5. The ways in (the menu's row, the Open Plan row with one plan, bare `/` with no plan) and the shell on `/plans`.
6. The narrow window and the long names.

## Manifest

touches: [apps/web/src/shell/manage-connections-logo.tsx, apps/web/src/shell/NewPlanDialog.tsx, apps/web/src/shell/PlanMenu.tsx, apps/web/src/shell/Sidebar.tsx, apps/web/src/shell/tokens.css, apps/web/src/plan-settings/**, apps/web/src/plans/**, apps/web/src/pages/plans.tsx, apps/web/src/pages/home.tsx, apps/web/src/menu-actions/view-all-plans.ts, apps/web/src/api/budgets.ts, packages/schema/src/plans-list-time.ts, packages/schema/test/plans-list-time.test.ts, e2e/plans-list*.spec.ts, e2e/new-plan*.spec.ts, e2e/support/plans-list*.ts, e2e/support/bank-link-stub.ts, e2e/plan-menu.spec.ts, docs/plans-list-design.md, docs/plans-list-spec.md, docs/plans-list-polish.md, docs/README.md]
shared: [apps/web/src/shell/** (manage-connections-logo.tsx: EXF-798 fix; NewPlanDialog.tsx: format fields; PlanMenu.tsx: Open Plan always shows; Sidebar.tsx: no plan items or resize handle on /plans; tokens.css only for a new token)]
migrations: 0
