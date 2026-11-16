/**
 * `placeholderData` that keeps the previous data only within one plan (EXF-586). Moving between two months of
 * one plan keeps the old month on screen while the next loads; moving to another plan shows nothing of the old one.
 * The plan id is the query key's second element, as in every plan-scoped key.
 */
export function keepPreviousInPlan<T>(
  budgetId: string,
): (prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }) => T | undefined {
  return (prev, prevQuery) => (prevQuery?.queryKey.includes(budgetId) ? prev : undefined);
}
