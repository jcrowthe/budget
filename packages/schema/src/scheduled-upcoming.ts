import { z } from "@hono/zod-openapi";
import { Month } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { dayBefore, type Frequency, nextDate, occurrenceAfter } from "./recurrence";
import { addMonthsTo } from "./report-range";

/** The schedule fields upcoming needs, one row per live schedule that counts (rules R1 and R2). */
export interface UpcomingSource {
  id: string;
  category_id: string;
  account_id: string;
  account_name: string;
  date_first: string;
  date_next: string;
  frequency: Frequency;
  amount: number;
  payee_id: string | null;
  payee_name: string | null;
  memo: string | null;
}

/** The last day of a month. */
export function monthLastDay(month: string): string {
  return dayBefore(addMonthsTo(month, 1));
}

/**
 * The dates of a schedule inside `month` (first day to last day). An occurrence before the month is not
 * carried into it; one that is overdue but inside it counts.
 */
export function occurrencesInMonth(
  s: Pick<UpcomingSource, "date_first" | "date_next" | "frequency">,
  month: string,
): string[] {
  const end = monthLastDay(month);
  let cur: string | null =
    s.date_next >= month
      ? s.date_next
      : occurrenceAfter(s.date_first, s.frequency, dayBefore(month));
  const out: string[] = [];
  while (cur && cur <= end) {
    // Guard against an anchor whose occurrence is before the month (a one-off already past).
    if (cur >= month) out.push(cur);
    const next: string | null = nextDate(s.date_first, s.frequency, cur);
    if (!next || next <= cur) break;
    cur = next;
  }
  return out;
}

export interface CategoryUpcomingTotals {
  upcoming: number;
  upcoming_count: number;
}

/** Sum and count per category; a category with nothing in the month is absent. */
export function upcomingByCategory(
  sources: readonly UpcomingSource[],
  month: string,
): Map<string, CategoryUpcomingTotals> {
  const out = new Map<string, CategoryUpcomingTotals>();
  for (const s of sources) {
    const n = occurrencesInMonth(s, month).length;
    if (n === 0) continue;
    const cur = out.get(s.category_id) ?? { upcoming: 0, upcoming_count: 0 };
    cur.upcoming += s.amount * n;
    cur.upcoming_count += n;
    out.set(s.category_id, cur);
  }
  return out;
}

export const UpcomingOccurrence = z
  .object({
    scheduled_transaction_id: z.string(),
    account_id: z.string(),
    account_name: z.string(),
    date: z.string(),
    payee_id: z.string().nullable(),
    payee_name: z.string().nullable(),
    memo: z.string().nullable(),
    amount: Milliunits,
  })
  .openapi("UpcomingOccurrence");
export type UpcomingOccurrence = z.infer<typeof UpcomingOccurrence>;

export const CategoryUpcoming = z
  .object({
    category_id: z.string(),
    month: Month,
    upcoming: Milliunits,
    upcoming_count: z.number().int(),
    available: Milliunits,
    available_after_upcoming: Milliunits,
    occurrences: z.array(UpcomingOccurrence),
  })
  .openapi("CategoryUpcoming");
export type CategoryUpcoming = z.infer<typeof CategoryUpcoming>;

export const CategoryUpcomingResponse = dataEnvelope(CategoryUpcoming).openapi(
  "CategoryUpcomingResponse",
);

/** The occurrences of one category in a month: latest date first, ties by account name, then schedule id. */
export function upcomingList(
  sources: readonly UpcomingSource[],
  categoryId: string,
  month: string,
): UpcomingOccurrence[] {
  const rows: UpcomingOccurrence[] = [];
  for (const s of sources) {
    if (s.category_id !== categoryId) continue;
    for (const date of occurrencesInMonth(s, month)) {
      rows.push({
        scheduled_transaction_id: s.id,
        account_id: s.account_id,
        account_name: s.account_name,
        date,
        payee_id: s.payee_id,
        payee_name: s.payee_name,
        memo: s.memo,
        amount: s.amount,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      a.account_name.localeCompare(b.account_name) ||
      a.scheduled_transaction_id.localeCompare(b.scheduled_transaction_id),
  );
}
