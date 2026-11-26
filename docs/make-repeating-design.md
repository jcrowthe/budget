# Make Repeating design (EXF-503)

Start a new scheduled series from a real transaction, pre-filled with its details. Web only: no route, no MCP tool,
no schema or migration change.

## Entry points

- Right-click a real row: the row is selected (unless it already is) and the More menu opens with its top-left at the
  pointer. The browser's own menu is suppressed. Right-click on a button, input or checkbox keeps the native menu.
- The action bar's More menu lists the same item.
- Shift+T with one real row selected.

The item is in the Duplicate group with the keys `shift T`. It is greyed out, never hidden, when it cannot work, with
the reason as its tooltip. Right-clicking a scheduled row opens the scheduled More menu at the pointer too, with the item
greyed out.

## Eligibility (first match wins)

1. A scheduled row is selected: "Make Repeating works on a transaction you entered, not on a scheduled one".
2. Not exactly one real row: "Select one transaction to make it repeating".
3. A split or a transfer: "Scheduled splits and transfers are not available yet." (the add row's own message).
4. A system payee (starting balance, adjustment, loan interest): refused by the server's `resolvePayee`.
5. A closed account: "A closed account takes no new transactions".

## Pre-fill

The add row opens (replacing any open row) with the source's account, payee, category (or Ready to Assign mark),
memo and amount. The date is the original plus one month, clamped to the month's end (01/31 → 02/28;
2028-01-31 → 2028-02-29), the date picker is open with the Date field focused, and Repeat is Monthly. The flag and
the cleared state are not copied. Save uses the existing scheduled create (`useCreateScheduled`), so the server,
Undo (change sets), the single `db.batch` with `change_log` and the constant D1 calls are unchanged. Cancel discards the
row; the original is never touched.

## Decisions

- **No MCP tool and no route.** An agent composes get-transaction and `create_scheduled_transaction`; the tool count
  stays at 121.
- **Splits and transfers are disabled.** Scheduled series have no split or transfer columns (EXF-501); copying the
  lines would need a migration.
- **System payees are disabled** because the server refuses them.
- **The flag is not copied.**
- **Greyed out, not hidden, with several rows** (Product Owner). This supersedes case 19 of
  `register-bulk-design.md` ("absent with two rows"), whose spec assertion is updated.

## Known behaviour

An old source whose +1 month is on or before today saves one back-dated, unapproved real row and starts the series
after today (scheduled-transactions rule 2). The user can change the date in the open picker.

## Acceptance cases

`e2e/make-repeating.spec.ts`: the menu at the pointer with the browser menu suppressed; the pre-filled row (+1 month,
picker open, Monthly); Shift+T; Save (a repeating row under Scheduled Transactions, original untouched); Cancel adds
nothing; greyed out on a scheduled row, with several rows, and on a split or a transfer; Escape, an outside press and
a right-click on another row. Unit tests: `apps/web/src/register/makeRepeating.test.ts`.

## Files

`register/makeRepeating.ts` (+ test), `MoreMenu.tsx` (item, `PointAnchor`, `placement`), `ActionBar.tsx`,
`ScheduledBar.tsx`, `selection.tsx` (`menuAt`), `RegisterTable.tsx`, `ScheduledSection.tsx`, `Register.tsx`,
`EntryRow.tsx` (`prefill`), `entryDraft.ts`, `useRegisterKeys.ts`; `e2e/make-repeating.spec.ts`;
`e2e/register-bulk.spec.ts` (two assertions updated).
