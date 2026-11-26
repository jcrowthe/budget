# Assigned in Future Months (EXF-527)

The last card of the Plan's right panel (after the month summary and Auto-Assign). It shows only for the
**current month with nothing selected**: the header reads "Assigned in Future Months" with a chevron and the
total, and the body has one button per later month (circle icon, month name, assigned total). A button opens
that month. The header collapses and expands the body (unsaved `PlanPanel` state; it starts expanded).

## API

`GET /budgets/{id}/months/{month}/summary` (and MCP `get_month_summary`, the same service call) gains:

- `future_assigned: [{ month, assigned }]`, in date order;
- `future_assigned_total`, the sum of the rows. It equals `-rta_breakdown.assigned_in_future` of the same
  month's read.

Rules:

- **No gaps.** One row for every month from the next month to the last month whose summed assigned is not
  zero; with nothing assigned ahead, the next month alone, at 0. A trailing month that sums to zero is trimmed.
- **Whole plan.** `category_ids` and `view` never change the two fields.
- **Active categories.** Each row sums `assigned` over categories that are not deleted and whose group is not
  deleted (the engine's rule): hidden categories and hidden groups count, deleted ones do not.
- **Absent for a non-current month.** Both fields are omitted from the JSON (not empty, not null) unless the
  requested month equals the month of `today` (the `today` query, else the server's UTC date). Past and future
  months have no "future" the person asked about, and the omission keeps their payload unchanged.

## D1 calls

No new call. The rows are computed (`futureAssigned` in `services/months.ts`) from the assignments `loadInput`
already reads for the month, so the summary costs exactly what the month read costs, whatever the number of
categories or months. `apps/worker/test/future-assigned-calls.test.ts` counts the calls for 10 and 100
categories and 3 and 24 future months.

## Web

The panel reads the summary once on its own (an exception to plan-panel-design.md's "sends no request"):
`useFutureAssigned` with the browser's local day as `today`, enabled only when the card shows. Its key is
`["month-list", budgetId, "future-assigned", month]`: not under the `month` prefix, because category writes put
a `MonthDetail` into every query under it, and under `month-list`, which every Assigned write invalidates, so
the card follows edits. Nothing renders until the data has loaded.

Labels: the month name ("December"); a month 12 or more ahead of the current one adds the year
("November 2027"). A click goes to the row's exact month.

## Out of scope

The explainer video; saving the collapsed state; the card on other months or with a selection.
