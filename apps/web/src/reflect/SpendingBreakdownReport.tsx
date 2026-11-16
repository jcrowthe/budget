import { monthOfDate } from "@budget/schema/report-range";
import type { SpendingGroupBy, SpendingItem } from "@budget/schema/reports";
import { UNCATEGORIZED_ID } from "@budget/schema/reports";
import { useState } from "react";
import { useMonth } from "../api/months";
import { useSpendingBreakdown } from "../api/reports";
import { categoryItems, leafIds, scopeToGroup } from "./filters";
import { money } from "./format";
import type { Drill } from "./SpendingBreakdownPage";
import { SpendingDonut } from "./SpendingDonut";
import { SpendingList } from "./SpendingList";
import { useReportState } from "./state";
import { TransactionPopover } from "./TransactionPopover";
import "./spending-breakdown.css";

interface PopoverState {
  title: string;
  selector: { category_id: string } | { group_id: string } | { uncategorized: true };
  x: number;
  y: number;
}

export function SpendingBreakdownReport({
  mode,
  drill,
  onMode,
  onDrill,
}: {
  mode: SpendingGroupBy;
  drill: Drill | null;
  onMode: (m: SpendingGroupBy) => void;
  onDrill: (d: Drill | null) => void;
}) {
  const { budgetId, span, settings, today } = useReportState();
  const groupBy = drill ? "category" : mode;
  const { data } = useSpendingBreakdown(
    budgetId,
    span,
    settings.excluded_category_ids,
    settings.excluded_account_ids,
    groupBy,
    drill?.id ?? null,
    today,
  );
  const { data: month } = useMonth(budgetId, monthOfDate(today));
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  // "No categories selected": every listed category (of the drilled group) is ticked off.
  const ids = leafIds(scopeToGroup(categoryItems(month), drill?.id ?? null));
  const excluded = new Set(settings.excluded_category_ids);
  const noCategories = ids.length > 0 && ids.every((id) => excluded.has(id));

  if (!data) return null;
  const empty = data.total === 0;
  const pick = (item: SpendingItem, x: number, y: number) => {
    setHoverId(null);
    if (item.id === UNCATEGORIZED_ID) {
      setPopover({ title: item.name, selector: { uncategorized: true }, x, y });
    } else if (groupBy === "group") {
      onDrill({ id: item.id, name: item.name });
    } else {
      setPopover({ title: item.name, selector: { category_id: item.id }, x, y });
    }
  };
  const frequentLabel = groupBy === "group" ? "Most Frequent Group" : "Most Frequent Category";
  const count = data.most_frequent?.transaction_count ?? 0;

  return (
    <div className="sb-layout">
      <div className="sb-left">
        <section className="sb-card" aria-label="Total spending">
          <div className="sb-head">
            <div>
              <div className="nw-caption">Total Spending</div>
              <div className="sb-total" data-testid="sb-total">
                {money(data.total)}
              </div>
            </div>
            {!drill && (
              <div className="sb-toggle" role="radiogroup" aria-label="Breakdown by">
                {(["category", "group"] as const).map((m) => (
                  // biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form radio
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    className="sb-toggle-option"
                    onClick={() => onMode(m)}
                  >
                    {m === "category" ? "Categories" : "Groups"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <SpendingDonut
            items={data.items}
            total={data.total}
            hoverId={hoverId}
            onHover={setHoverId}
            onPick={pick}
          />
          {empty && !noCategories && (
            <p className="sb-callout">
              Your spending breakdown will appear once you start recording your spending.
            </p>
          )}
        </section>
        <section className="sb-card sb-metrics" aria-label="Spending metrics">
          <div className="sb-metric">
            <div className="nw-caption">Average Monthly Spending</div>
            <div className="sb-metric-value" data-testid="sb-average-monthly">
              {money(data.average_monthly)}
            </div>
          </div>
          <div className="sb-metric">
            <div className="nw-caption">Average Daily Spending</div>
            <div className="sb-metric-value" data-testid="sb-average-daily">
              {money(data.average_daily)}
            </div>
          </div>
          <div className="sb-metric">
            <div className="nw-caption">{frequentLabel}</div>
            <div className="sb-metric-value" data-testid="sb-most-frequent">
              {data.most_frequent?.name ?? "n/a"}
            </div>
            {data.most_frequent && (
              <div className="sb-metric-sub" data-testid="sb-most-frequent-count">
                {count} {count === 1 ? "transaction" : "transactions"}
              </div>
            )}
          </div>
          <div className="sb-metric">
            <div className="nw-caption">Largest Outflow</div>
            <div className="sb-metric-value" data-testid="sb-largest">
              {data.largest_outflow ? (data.largest_outflow.payee_name ?? "No payee") : "n/a"}
            </div>
            {data.largest_outflow && (
              <div className="sb-metric-sub" data-testid="sb-largest-amount">
                {money(data.largest_outflow.amount)}
              </div>
            )}
          </div>
        </section>
      </div>
      <SpendingList
        items={data.items}
        mode={groupBy}
        noCategories={noCategories}
        activeId={
          popover
            ? "category_id" in popover.selector
              ? popover.selector.category_id
              : UNCATEGORIZED_ID
            : null
        }
        onPick={pick}
      />
      {popover && <TransactionPopover {...popover} onClose={() => setPopover(null)} />}
    </div>
  );
}
