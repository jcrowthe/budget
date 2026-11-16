import type { Month } from "@budget/core/month";
import {
  type AutoAssignPreview,
  type AutoAssignStrategy,
  autoAssignOptions,
} from "@budget/schema/auto-assign";
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
  const one = "categoryIds" in scope && scope.categoryIds.length === 1;
  if (!preview) {
    // Every row the list can have, in its final layout, disabled and without figures: the card keeps the
    // height it will have, and no amount of another selection is shown.
    const all: AutoAssignPreview = { ...BLANK, underfunded: 1, reduce_overfunding: 1 };
    return (
      <div className="auto-assign-body" aria-busy="true">
        <OptionList options={autoAssignOptions(all, one ? "one" : "many")} loading />
      </div>
    );
  }
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
  const options = autoAssignOptions(preview, one ? "one" : "many");
  return (
    <div className="auto-assign-body">
      <OptionList
        options={options}
        busy={busy}
        onPick={(strategy) => {
          if (busy) return;
          // The popover closes once the run succeeded; a failure stays visible under the buttons.
          void apply(strategy, scope).then((ok) => {
            if (ok) onApplied?.();
          });
        }}
      />
      {failed && (
        <p className="target-error" role="alert">
          Couldn't auto-assign.
        </p>
      )}
    </div>
  );
}

const BLANK: AutoAssignPreview = {
  category_count: 0,
  underfunded: 0,
  assigned_last_month: 0,
  spent_last_month: 0,
  average_assigned: 0,
  average_spent: 0,
  reduce_overfunding: 0,
  reset_available: 0,
  reset_assigned: 0,
};

/**
 * The groups of buttons. The list keeps the height of all eight rows (`.auto-assign-list`), so the cards below
 * do not move when the preview arrives, hides Underfunded or Reduce Overfunding, or the selection changes.
 */
function OptionList({
  options,
  loading = false,
  busy = false,
  onPick,
}: {
  options: ReturnType<typeof autoAssignOptions>;
  loading?: boolean;
  busy?: boolean;
  onPick?: (strategy: AutoAssignStrategy) => void;
}) {
  const groups = [1, 2, 3].map((g) => options.filter((o) => o.group === g));
  return (
    <div className="auto-assign-list">
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
                disabled={loading || busy}
                onClick={() => onPick?.(o.strategy)}
              >
                <span>{o.label}</span>
                {loading ? (
                  <strong aria-hidden="true">–</strong>
                ) : (
                  <strong title={money(o.amount)}>{money(o.amount)}</strong>
                )}
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
