import type { Month } from "@budget/core/month";
import { autoAssignOptions } from "@budget/schema/auto-assign";
import { VIEW_NO_CATEGORIES } from "@budget/schema/plan-views";
import { type AutoAssignScope, useAutoAssign, useAutoAssignPreview } from "../api/autoAssign";
import { money } from "./format";

/**
 * The eight Auto-Assign buttons with the Worker's previews, for the card and for the Assign popover. One click
 * applies the option; every button of the month is disabled from the click until the month has been read again.
 */
export function AutoAssignOptions({
  budgetId,
  month,
  scope,
  onViewAll,
  onApplied,
}: {
  budgetId: string;
  month: Month;
  scope: AutoAssignScope;
  onViewAll: () => void;
  onApplied?: () => void;
}) {
  const preview = useAutoAssignPreview(budgetId, month, scope).data;
  const { apply, busy, failed } = useAutoAssign(budgetId, month);
  if (!preview) return <div className="auto-assign-body" aria-busy="true" />;
  if (preview.category_count === 0) {
    return (
      <div className="auto-assign-body">
        <p className="auto-assign-empty">
          {VIEW_NO_CATEGORIES}
          <button type="button" className="view-all is-ghost" onClick={onViewAll}>
            View All Categories
          </button>
        </p>
      </div>
    );
  }
  const one = "categoryIds" in scope && scope.categoryIds.length === 1;
  const options = autoAssignOptions(preview, one ? "one" : "many");
  const groups = [1, 2, 3].map((g) => options.filter((o) => o.group === g));
  return (
    <div className="auto-assign-body">
      {groups
        .filter((g) => g.length > 0)
        .map((g) => (
          <div key={g[0]?.group} className="auto-assign-group">
            {g.map((o) => (
              <button
                key={o.strategy}
                type="button"
                className="auto-assign-option"
                title={o.title ?? undefined}
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  void apply(o.strategy, scope);
                  onApplied?.();
                }}
              >
                <span>{o.label}</span>
                <strong title={money(o.amount)}>{money(o.amount)}</strong>
              </button>
            ))}
          </div>
        ))}
      {failed && (
        <p className="target-error" role="alert">
          Couldn't auto-assign.
        </p>
      )}
    </div>
  );
}
