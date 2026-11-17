// biome-ignore-all lint/a11y/useSemanticElements: an ARIA treegrid of divs, as in the source; a table would break the flex rows and sticky head
// biome-ignore-all lint/a11y/useFocusableInteractive: rows and headers are not focusable; their buttons are
import { addMilliunits } from "@budget/core/money";
import type { MonthGroupDetail } from "@budget/schema/months";
import { useRef, useState } from "react";
import { useCategoryActions } from "../api/categories";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { amountClass } from "./format";
import { Popover } from "./Popover";

/**
 * The grid's last row, only when something is hidden: the totals of the hidden categories (those hidden
 * themselves or by their group) as plain text, and a popover to unhide them.
 */
export function HiddenCategoriesRow({
  groups,
  budgetId,
  onError,
}: {
  groups: MonthGroupDetail[];
  budgetId: string;
  /** Runs when an unhide fails (the grid shows its notice). */
  onError: () => void;
}) {
  const fmt = usePlanFormatter();
  const actions = useCategoryActions(budgetId);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  const entries = groups
    .map((g) => ({ g, cats: g.categories.filter((c) => g.hidden || c.hidden) }))
    .filter((e) => e.cats.length > 0 || e.g.hidden);
  const hidden = entries.flatMap((e) => e.cats);
  if (entries.length === 0) return null;
  const sum = (pick: "assigned" | "activity" | "available") =>
    addMilliunits(...hidden.map((c) => c[pick]));

  const act = (fn: () => Promise<unknown>) => {
    setOpen(false);
    fn().catch(onError);
  };

  return (
    <div className="grid-row hidden-categories-row" role="row" aria-level={1}>
      <div className="cell-margin" />
      <div className="cell-collapse" />
      <div className="cell-checkbox" />
      <div className="cell-name" role="rowheader">
        <button
          type="button"
          ref={button}
          className="hidden-categories-label"
          onClick={() => setOpen(true)}
        >
          Hidden Categories
        </button>
      </div>
      <div className="num cell-assigned" role="cell" title={fmt.money(sum("assigned"))}>
        <span className={amountClass(sum("assigned"))}>{fmt.money(sum("assigned"))}</span>
      </div>
      <div className="num cell-activity" role="cell" title={fmt.money(sum("activity"))}>
        <span className={amountClass(sum("activity"))}>{fmt.money(sum("activity"))}</span>
      </div>
      <div className="num cell-available" role="cell" title={fmt.money(sum("available"))}>
        <span className={amountClass(sum("available"))}>{fmt.money(sum("available"))}</span>
      </div>
      <div className="cell-margin" />
      {open && button.current && (
        <Popover
          anchor={button.current}
          width={320}
          label="Hidden Categories"
          className="hidden-popover"
          onClose={() => setOpen(false)}
        >
          <div className="hidden-header">Click to unhide a category</div>
          <div className="hidden-list">
            {entries.map(({ g, cats }) => (
              <div key={g.id} className="hidden-group">
                {g.hidden ? (
                  <button
                    type="button"
                    className="hidden-group-name is-button"
                    onClick={() => act(() => actions.updateGroup(g.id, { hidden: false }))}
                  >
                    Group: {g.name}
                  </button>
                ) : (
                  <div className="hidden-group-name">Group: {g.name}</div>
                )}
                {cats.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className="hidden-category"
                    onClick={() => act(() => actions.updateCategory(c.id, { hidden: false }))}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <button
            type="button"
            className="popover-button is-primary hidden-show-all"
            onClick={() => act(() => actions.unhideAll())}
          >
            Show all hidden categories
          </button>
        </Popover>
      )}
    </div>
  );
}
