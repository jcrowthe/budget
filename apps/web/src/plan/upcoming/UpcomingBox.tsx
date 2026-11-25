import type { Month } from "@budget/core/month";
import type { MonthCategoryDetail } from "@budget/schema/months";
import { useRef, useState } from "react";
import { usePlanFormatter } from "../../shell/plan-formats-context";
import { UpcomingPopover } from "./UpcomingPopover";
import "./upcoming.css";

/**
 * EXF-505, under the Available Balance rows: how many scheduled transactions fall inside the month, their total,
 * and what Available would be after them. Nothing when there are none. Computed from the cached month, so an
 * edit to Assigned moves it at once.
 */
export function UpcomingBox({
  budgetId,
  month,
  c,
}: {
  budgetId: string;
  month: Month;
  c: Pick<MonthCategoryDetail, "id" | "name" | "available" | "upcoming" | "upcoming_count">;
}) {
  const fmt = usePlanFormatter();
  const link = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (c.upcoming === 0) return null;
  const after = c.available + c.upcoming;
  const label = `${c.upcoming_count} Upcoming Transaction${c.upcoming_count === 1 ? "" : "s"}`;
  return (
    <div
      className="upcoming-box"
      data-testid="upcoming-box"
      data-tone={after < 0 ? "cautious" : "positive"}
    >
      <div className="upcoming-row">
        <button ref={link} type="button" className="upcoming-link" onClick={() => setOpen(true)}>
          {label}
        </button>
        <span className="upcoming-amount">{fmt.money(c.upcoming)}</span>
      </div>
      <div className="upcoming-row" data-testid="upcoming-after">
        <span className="upcoming-after-label">Available After Upcoming</span>
        <span className="upcoming-after-value">{fmt.money(after)}</span>
      </div>
      {open && link.current && (
        <UpcomingPopover
          budgetId={budgetId}
          month={month}
          category={c}
          anchor={link.current}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
