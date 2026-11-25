# Upcoming design (EXF-505)

The Plan warns when a category's Available money won't cover the scheduled transactions still to come in the
month shown. Base `84059c4`. Status: built. The Architect's decisions, completed by the Build with the measured D1 counts, what was observed
and the PASS/FAIL table.

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
   then `Available After Upcoming`. The whole box is tinted: amber below zero, green at zero and above (`data-tone` on the box; the callout backgrounds).
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
- `GET …/categories/{id}/upcoming` reads the month once (`getPlanMonthWithSources`, `services/months.ts`), which
  returns the figures and the schedules behind them, so the list needs no call of its own.
- D1 calls: a `full` month read goes from 9 to 10, the plan export from 16 to 17, and `listPlanMonths` stays 6.
  None of them grows with the number of schedules (`test/upcoming-calls.test.ts`).

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
- D6 Tests outside the contract's list that a new tool, a new field and one more D1 call force: the tool counts
  (105 to 106) in `test/rename-rules.test.ts` and `test/payee-category-api.test.ts`, the export's 16 calls in
  `test/plan-export-now.test.ts` (to 17), and the exact `CategoryMonth` in `test/month-summary.test.ts` (the three
  fields). Nothing else in them changed.
- D7 The colours the pill uses (`--categoryBalanceWarningBackground`, `--categoryBalanceCautiousLabel`,
  `--categoryBalancePositiveLabel`) are declared in `plan/plan-grid.css` and `plan/panel/target.css`, not in
  `shell/tokens.css`; `upcoming.css` uses them, with `--statusPositive`, `--labelPrimary` and `--separatorStandard`
  from `tokens.css`, and declares none of its own.
- No migration.

## Observed vs assumed

Observed at the source (the ticket, 2026-11-15): the rules, copy and examples above.
Assumed until checked look-only at the source:

- A1 The amber calendar pill wins over a target pill when Available After Upcoming < 0.
- A2 Underfunded takes the larger of the target's to-go and the upcoming shortfall.
- A3 Closed-account and tracking-account schedules do not count.
- A4 Equal dates in the popover are sorted by account name, then id.
- A5 The `Underfunded` view chip is unchanged.

## Measured D1 calls (`test/upcoming-calls.test.ts`, 10 and 100 schedules on one category, identical)

| Read | Calls |
| --- | --- |
| `getPlanMonth` | 10 (was 9) |
| `getMonthCategory` | 10 (was 9) |
| `listUpcomingForCategory` (REST and MCP `list_upcoming_for_category`) | 10 |
| `previewAutoAssign` | 11 |
| `getPlanMonths`, `getCardPaymentStatus` | 10 (was 9) |
| `exportPlan` | 17 (was 16) |
| `listPlanMonths` | 6 (unchanged) |

The spec allowed up to 4 for the list; reusing the month read's schedule set makes it 10 flat with no separate
query, so the Activity popover costs one request.

## Observed vs assumed

No look at the source was made in this build, so A1 to A5 stay assumptions, and so does the box styling: the ticket's "highlighted box, amber below 0, green at 0 or more" is built as a fully tinted box, not observed at the source.
What the build took from the ticket (as the Architect's spec records it) is not re-verified here.

- Pill tooltip: set to the plain Available tooltip (`pillTitle(available)`); the source's tooltip is not observed.
- Whether the box shows in a past month: it does here (the figures are per month, whatever "today" is); not observed.
- Overdue occurrences inside the shown month count (rule 1), including in a past month.

## Results against the ticket's acceptance

| AC | Result | Evidence (fails on main) |
| --- | --- | --- |
| AC1 pill amber with calendar when Available After Upcoming < 0 | PASS | `upcoming.test.ts` "has upcoming, count…"; `e2e/upcoming.spec.ts` AC1 |
| AC2 assigning more clears it | PASS | `upcoming.test.ts` AC2; e2e AC2 (optimistic: pill computed in the browser) |
| AC3 Activity popover lists occurrences | PASS | `upcoming.test.ts` "lists the occurrences…"; e2e AC3 |
| AC4 next month counts that month's occurrences, none carried | PASS | `upcoming.test.ts` AC4; `scheduled-upcoming.test.ts`; e2e AC4 |
| AC5 Auto-Assign Underfunded includes the shortfall | PASS | `upcoming.test.ts` AC5 (three tests); `auto-assign.test.ts` units; e2e AC5a/AC5b |
| AC6 Ready to Assign has no upcoming | PASS | `upcoming.test.ts` AC6; e2e AC6 |
| AC7 server fields on the month-category read and list | PASS | `upcoming.test.ts`, parity test |

AC6 fails on main only because the field is missing (server test): the Ready to Assign rule already held there. The
e2e AC6 passes on main too for the same reason (nothing shows upcoming there); it is a regression guard.
The R8 test "takes the larger of the target's to-go and the shortfall" also passes on main, where the target to-go
alone is the answer.
