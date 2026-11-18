import type { Budget } from "@budget/schema/budgets";
import { lastUsedText } from "@budget/schema/plans-list-time";
import { Link } from "react-router";
import { PlanIcon, TrashIcon } from "../shell/icons";
import { planPath } from "../shell/planPaths";

/** One plan: a link over the whole card, and a trash button that shows on hover and on keyboard focus. */
export function PlansListCard({
  plan,
  now,
  onDelete,
}: {
  plan: Budget;
  now: number;
  onDelete: (p: Budget, trigger: HTMLButtonElement) => void;
}) {
  return (
    <li className="plans-list-card">
      <Link
        className="plans-list-open"
        to={planPath(plan.id)}
        aria-labelledby={`plans-list-name-${plan.id}`}
        aria-describedby={`plans-list-used-${plan.id}`}
      >
        <span className="plans-list-thumb" aria-hidden="true">
          <PlanIcon />
        </span>
        <span id={`plans-list-name-${plan.id}`} className="plans-list-name" title={plan.name}>
          {plan.name}
        </span>
        <span id={`plans-list-used-${plan.id}`} className="plans-list-used">
          {lastUsedText(plan.last_opened_at, now)}
        </span>
      </Link>
      <button
        type="button"
        className="plans-list-delete"
        aria-label="Delete Plan"
        title="Delete Plan"
        onClick={(e) => onDelete(plan, e.currentTarget)}
      >
        <TrashIcon />
      </button>
    </li>
  );
}
