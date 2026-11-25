# Upcoming design (EXF-505)

The Plan warns when a category's Available money won't cover the scheduled transactions still to come in the
month shown. Base `84059c4`. Status: the Architect's decisions. The Build completes this file with the measured
D1 counts, what it observed at the source and the PASS/FAIL table.

## Where upcoming lives

On the Plan only, as the ticket places it: the Available pill on the category row and in the inspector header,
a box in the inspector's Available Balance card, an `Activity` popover listing the occurrences, and Auto-Assign's
Underfunded. No register or account page changes.

Server: the month-category figures (`GET /budgets/{budget_id}/months/{month}/categories/{category_id}` and every
category of `GET /budgets/{budget_id}/months/{month}`) gain `upcoming` (milliunits), `upcoming_count` and
`available_after_upcoming`. A list route `GET /budgets/{budget_id}/months/{month}/categories/{category_id}/upcoming`
and MCP `list_upcoming_for_category` return the occurrences. MCP `get_plan_month` and `get_month_category` carry
the fields.

## Rules

1. `upcoming(C, M)` is the sum of every occurrence dated inside M of every live schedule with category C. The
   occurrences start at `date_next` and step with `nextDate` (`recurrence.ts`). An occurrence before M is never
   carried into M. One that is overdue but inside M counts, because it is not entered.
2. Schedules that count are not deleted, are on an open, on-budget account, have an active category, and are not
   inflows to Ready to Assign. Ready to Assign shows no upcoming cue.
3. `available_after_upcoming = available + upcoming`.
4. Pill: a credit card payment category is unchanged; overspent stays red. Otherwise, when upcoming ≠ 0 and
   Available After Upcoming < 0, the pill is amber (`cautious`) with a calendar icon and still shows Available.
   Otherwise the pill is the existing target pill or the plain pill. The browser computes it from
   `available + upcoming`, so an optimistic Assigned edit moves it at once.
5. Inspector box, only when upcoming ≠ 0: `N Upcoming Transactions` (singular for 1) as a link with the total,
   then `Available After Upcoming`. Amber below zero, green at zero and above.
6. Popover: `Activity` with the category name as subtitle, `ACCOUNT | DATE | PAYEE | MEMO | AMOUNT`, latest
   date first, `Close`.
7. Auto-Assign Underfunded adds, per ordinary category, `max(target to_go_this_month, shortfall)`, where
   `shortfall = max(0, -(available + upcoming))`. One function serves the browser and the service.

## Server shape

- Pure: `packages/schema/src/scheduled-upcoming.ts` (occurrences in a month, totals per category, the sorted list,
  Zod schemas).
- One set query, `listUpcomingSources` (`repositories/scheduled-transactions.ts`), added to the month read's
  existing `Promise.all` (`services/months.ts` `loadInput`, the `full` reads). The fields are attached after
  `computeMonth`, like the notes. The engine (`packages/core`) is not changed.
- D1 calls: a `full` month read goes from 9 to 10, the plan export from 16 to 17, and `listPlanMonths` stays 6.
  None of them grows with the number of schedules (`test/upcoming-calls.test.ts`, 10 and 100).

## Departures from the contract's file list

- D1 The month-category fields need `packages/schema/src/{months,month-categories,month-totals}.ts`,
  `services/months.ts` and the MCP descriptions in `mcp/tools/{months,month-categories}.ts`. The ticket names
  those resources, and the contract's list named only the scheduled-transaction files.
- D2 Underfunded needs `packages/schema/src/auto-assign.ts` and `services/auto-assign.ts`.
- D3 The Plan web files (`plan/format.ts`, `plan/AvailablePill.tsx`, `plan/panel/CategoryInspector.tsx`, new
  `plan/upcoming/*`, `api/upcoming.ts`) are where the ticket places upcoming. The contract's guess ("register
  and/or account pages") did not match. `rows.tsx` and `icons.tsx` (the Recent Moves unit's row icon) are not
  touched: the calendar icon is a new file.
- D4 Existing pinned D1 counts change by one (`test/credit-call-count.test.ts`, `test/plan-export-calls.test.ts`).
  Hand-built `MonthCategoryDetail` fixtures gain the three fields.
- D5 Schedules here have no split lines, so the ticket's split rule has nothing to act on.
- No migration.

## Observed vs assumed

Observed at the source (the ticket, 2026-11-15): the rules, copy and examples above.
Assumed until checked look-only at the source:

- A1 The amber calendar pill wins over a target pill when Available After Upcoming < 0.
- A2 Underfunded takes the larger of the target's to-go and the upcoming shortfall.
- A3 Closed-account and tracking-account schedules do not count.
- A4 Equal dates in the popover are sorted by account name, then id.
- A5 The `Underfunded` view chip is unchanged.
