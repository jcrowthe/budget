import { paymentCategoryOf } from "@budget/schema/card-payments";
import { useQuery } from "@tanstack/react-query";
import { getMonth } from "../api/months";
import { localToday } from "../api/today";

/**
 * The card's payment category Available for the current month (EXF-539). It reads the month the Plan page and the
 * entry row already load (same query key), so a card page adds no request of its own per card or per row.
 * `available` is undefined while loading and null when the account has no payment category.
 */
export function usePaymentAvailable(
  budgetId: string,
  accountId: string,
  enabled: boolean,
): { available: number | null | undefined; settled: boolean } {
  const month = `${localToday().slice(0, 7)}-01` as const;
  const q = useQuery({
    queryKey: ["month", budgetId, month],
    queryFn: () => getMonth(budgetId, month),
    enabled,
  });
  const found = q.data ? paymentCategoryOf(q.data, accountId) : null;
  return {
    available: q.data ? (found?.available ?? null) : undefined,
    settled: q.isSuccess || q.isError,
  };
}
