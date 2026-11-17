import type { MonthCategoryDetail } from "@budget/schema/months";
import { usePlanFormatter } from "../../shell/plan-formats-context";

/**
 * The message of an overspent category (EXF-535): credit only (yellow), cash only or cash and credit (red).
 * The amounts are positive ("$65.00"); "Add at least" names the cash part.
 */
export function OverspentMessage({
  c,
}: {
  c: Pick<MonthCategoryDetail, "overspent" | "available">;
}) {
  const fmt = usePlanFormatter();
  const o = c.overspent;
  if (!o || c.available >= 0) return null;
  const total = <strong>{fmt.money(o.cash + o.credit)}</strong>;
  if (o.cash === 0) {
    return (
      <div className="inspector-message cautious" role="note">
        You've overspent this category by {total} with credit. Cover this overspending to avoid
        creating debt!
      </div>
    );
  }
  if (o.credit === 0) {
    return (
      <div className="inspector-message negative" role="note">
        You've overspent this category by {total}. Cover this overspending or you can’t trust your
        plan balances!
      </div>
    );
  }
  return (
    <div className="inspector-message negative" role="note">
      You've overspent this category by {total} with cash and credit. Add at least{" "}
      <strong>{fmt.money(o.cash)}</strong> to this category or you can’t trust your plan balances!
    </div>
  );
}
