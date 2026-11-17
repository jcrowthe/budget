import { drillTitle } from "@budget/schema/reflect-format";
import type { SpendingTrends } from "@budget/schema/reports";
import { useState } from "react";
import { useSpendingTrends } from "../api/reports";
import { money } from "./format";
import type { TrendsDrill } from "./SpendingTrendsPage";
import { useReportState } from "./state";
import { TransactionPopover } from "./TransactionPopover";
import { TrendsChart } from "./TrendsChart";
import { TrendsTable } from "./TrendsTable";
import "./spending-trends.css";
import { usePlanFormatter } from "../shell/plan-formats-context";

interface PopoverState {
  title: string;
  selector: { category_id: string } | { uncategorized: true };
  span: { start_month: string; end_month: string };
  x: number;
  y: number;
}

export function SpendingTrendsReport({
  drill,
  onDrill,
}: {
  drill: TrendsDrill | null;
  onDrill: (d: TrendsDrill | null) => void;
}) {
  const fmt = usePlanFormatter();
  const { budgetId, span, settings, today } = useReportState();
  const { data, isError } = useSpendingTrends(
    budgetId,
    span,
    settings.excluded_category_ids,
    settings.excluded_account_ids,
    drill?.id ?? null,
    today,
  );
  const [popover, setPopover] = useState<PopoverState | null>(null);
  if (!data)
    return isError ? <p className="sb-popover-note">The report could not be loaded.</p> : null;

  const pick = (series: SpendingTrends["series"][number], month: string, x: number, y: number) => {
    const title = drillTitle(series.name, month);
    const monthSpan = { start_month: month, end_month: month };
    if (drill) {
      setPopover({ title, selector: { category_id: series.id }, span: monthSpan, x, y });
    } else if (series.id === "uncategorized") {
      setPopover({ title, selector: { uncategorized: true }, span: monthSpan, x, y });
    } else {
      setPopover(null);
      onDrill({ id: series.id, name: series.name });
    }
  };

  return (
    <>
      <section className="st-card" aria-label="Spending by month">
        <div className="st-head">
          <div>
            <div className="st-caption">Average Monthly Spending</div>
            <div className="st-average" data-testid="st-average">
              {money(data.average_monthly, fmt)}
            </div>
          </div>
          <div>
            <div className="st-caption">Total Spending</div>
            <div className="st-total" data-testid="st-total">
              {money(data.total, fmt)}
            </div>
          </div>
        </div>
        <TrendsChart data={data} onPick={pick} />
      </section>
      <TrendsTable data={data} />
      {popover && <TransactionPopover {...popover} onClose={() => setPopover(null)} />}
    </>
  );
}
