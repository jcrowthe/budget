import type { Month } from "@budget/core/month";
import {
  type AutoAssignPreview,
  type AutoAssignScope as AutoAssignScope_,
  type AutoAssignStrategy,
  autoAssignOptions,
  hiddenAmounts,
  monthHiddenInputs,
} from "@budget/schema/auto-assign";
import { VIEW_NO_CATEGORIES, viewCategories } from "@budget/schema/plan-views";
import { type AutoAssignScope, useAutoAssign, useAutoAssignPreview } from "../api/autoAssign";
import { useCachedMonth } from "../api/months";
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
  const detail = useCachedMonth(budgetId, month).data;
  const preview = useAutoAssignPreview(budgetId, month, scope).data;
  const { apply, busy, failed } = useAutoAssign(budgetId, month);
  // The rows come from the cached month through the same pure function as the preview (EXF-616, EXF-624): the
  // card has its final height before the preview arrives, and the cards under it never move.
  const ids = detail
    ? "categoryIds" in scope
      ? scope.categoryIds
      : viewCategories(detail, scope.view).map((c) => c.id)
    : null;
  const empty = (
    <div className="auto-assign-body">
      <p className="auto-assign-empty">
        {VIEW_NO_CATEGORIES}
        <button type="button" className="view-all is-ghost" onClick={onViewAll}>
          View All Categories
        </button>
      </p>
    </div>
  );
  if (ids !== null && ids.length === 0) return empty;
  // One category means one ticked; a view that holds a single category is still plan-wide.
  const lone = "categoryIds" in scope && ids?.length === 1;
  const only = lone ? ids?.[0] : undefined;
  const isPayment =
    detail !== undefined &&
    only !== undefined &&
    detail.groups.some((g) =>
      g.categories.some((c) => c.id === only && c.kind === "credit_card_payment"),
    );
  const mode: AutoAssignScope_ = isPayment ? "payment" : lone ? "one" : "many";
  const hidden = detail && ids ? hiddenAmounts(monthHiddenInputs(detail, ids, lone)) : undefined;
  if (!preview) {
    // Every row the list will have, in its final layout, disabled and without figures: no amount of another
    // selection is shown.
    const rows = hidden ?? { underfunded: 1, reduce_overfunding: 1 };
    return (
      <div className="auto-assign-body" aria-busy="true">
        <OptionList options={autoAssignOptions(BLANK, mode, rows)} loading />
      </div>
    );
  }
  if (preview.category_count === 0) return empty;
  const options = autoAssignOptions(preview, mode, hidden);
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
  paid_last_month: 0,
  average_paid: 0,
  reduce_overfunding: 0,
  reset_available: 0,
  reset_assigned: 0,
};

/** The groups of buttons: only the rows the month data shows, so the card has the source's height (352/304/386). */
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
