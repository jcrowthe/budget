# Payee category UI (EXF-515, unit U4): design

**Not compared with the source:** the ticket's screenshots are not in the repo. Every look below is copied from
Budget's own `Payee Name` and `Renaming` cards and the `Transactions` popover; the departures to check are listed at the end.

Unit U4 of plan p_e2a21c83. The server side (U1, bd7c4fe) is [payee-category-design.md](payee-category-design.md):
its definitions (counted row, recency order, last 3, value, history rule, effective default) are used here unchanged.
Web only: no Worker, schema or migration change.

## What is built

- **Categorization card** (`apps/web/src/payees/categorization-card.tsx`) in the Manage Payees pane for one ordinary
  payee, between `Payee Name` and `Renaming`. None for a transfer payee, several payees or a mix.
  - A radio group of three options, labels character for character:
    `Auto-categorize based on payee history` (the default), `Always use my choice`, `Do not auto-categorize <Payee>`.
  - Under the first, while it is the saved mode: `Budget will auto-select the category for new <Payee> transactions
    based on how the [last 3 transactions] for this payee were categorized. This is updated when you add or edit a
    transaction.`, then `Current default category:` with `<Group>: <Category>`, `Ready to Assign`, or `Not yet set`.
  - Under the second, while chosen: the register's category picker (`CategoryField`), Ready to Assign included.
  - Each choice saves at once when it has what it needs: `history` and `off` at once; `fixed` once a category is
    picked, or at once when a stored fixed choice is still live. Choosing `Always use my choice` with no category
    sends nothing (decision of the contract).
  - A refusal shows the API's `detail` in the card's red bar. The card dims while deleting, like the other cards.
- **Last 3 transactions popover** (`apps/web/src/payees/categorization-recent.tsx`), opened by the
  `last 3 transactions` link button: `role="dialog"`, columns `DATE`, `CATEGORY`, `AMOUNT` through
  `usePlanFormatter()`, a `Close` button; Escape closes only the popover.
- **Queries** (`apps/web/src/api/payees.ts`): `savePayeeCategory` (PATCH, the answer written into `["payees", b]`)
  and `usePayeeRecentTransactions(b, id)` (`…/recent-transactions?limit=3`). A transaction save invalidates every
  query of the plan (`invalidatePlan`, `api/transactions.ts`), so the card and the popover are fresh without a reload.
- **Register fill** (`apps/web/src/register/entryDraft.ts` `rememberedCategory`): reads the effective default
  `default_category_id` / `default_inflow_to_ready_to_assign` instead of the latest transaction's `last_*`. The add
  row (`EntryRow.tsx` `fillCategory`) and split lines (`SplitLines.tsx`) are unchanged: they fill only an empty
  category. A payee in mode `off` has no effective default, so nothing is filled.

## Choices

- **Which default the card shows.** The API returns the effective default only. It is the history default only while
  the mode is `history`, so the `Auto-categorize…` body and `Current default category` show while that mode is saved.
- **Ready to Assign** is a value (contract decision) and reads `Ready to Assign` in the card and the popover. The
  picker keeps the register's own `Inflow: Ready to Assign` row.
- **Escape inside the dialog.** The dialog's Escape is a window capture listener (`useManagePayeesFocus`) that leaves
  the key to the focused element when it carries `data-dirty` (the rename field's protocol). The popover's controls,
  the link while the popover is open, and the card's combobox while focused carry it, and handle Escape themselves.
  `manage-payees-dialog.tsx` is unchanged.
- **Keys.** Native radios: arrow keys move and choose (and so save). Unchecked radios take `tabindex="-1"`, so the
  dialog's Tab trap stops once on the group, as a browser does.
- **The picker above the dialog.** `Dropdown` draws on `document.body` at z-index 50, under the dialog's backdrop (70);
  a rule in `manage-payees.css` raises it while the dialog is open. The card imports the picker's `entry.css`, which
  is otherwise loaded only with the register.

## Departures to check against the source

1. Card order `Payee Name`, `Categorization`, `Renaming` (docs/manage-payees-design.md, "Pane").
2. The `Auto-categorize…` body and `Current default category` show only while `history` is the saved mode.
3. The popover's CATEGORY column shows the category name (as the `Transactions` popover), `Ready to Assign` for an
   inflow to Ready to Assign; its columns do not sort; its width and empty state are ours.
4. Escape in the card uses the dialog's `data-dirty` protocol; in the card's combobox the first Escape closes the
   list and the next one closes the dialog.
5. The register picker's list is raised above the dialog by a `body:has(.mp-backdrop)` rule.

## Measured

- Fails before (base web, `pnpm e2e e2e/payee-categorization.spec.ts -g "A2|A3"`, saved in the Thread's
  `evidence/fail-before/register-fill.txt`): A3 receives `ZZ Daily: Fun` (expected `ZZ Daily: Groceries`).
  A2 receives an **empty** category, not Fun: base reads the latest row's category and the seed's latest row (11/13)
  is the uncategorised one the contract asks for. It still fails on base. A1 passes on base.
- After: `pnpm e2e e2e/payee-categorization.spec.ts --repeat-each=3` 51 passed.
- Sizes: at 1024×700 and 1440×900 the card is inside `.mp-main` with no horizontal scroll and the popover lies inside
  the window and the dialog (spec A7; screenshots in the Thread's `screenshots/`). At 1024×700 the popover opens above
  the link.
- Money in the popover reads as the plan's formatter prints it (`−$3.46` for -3460 milliunits).
