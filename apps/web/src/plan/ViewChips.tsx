import type { MonthDetail } from "@budget/schema/months";
import {
  overspentCount,
  overspentLabel,
  type PlanView,
  VIEW_CHIP_LABEL,
} from "@budget/schema/plan-views";
import { WarningTriangleIcon } from "./icons";
import "./plan-views.css";

const CHIPS = ["all", "underfunded", "overfunded", "money_available", "snoozed"] as const;

/**
 * The chips under the header: All, Overspent (only while something is overspent, with its live count), then the
 * other views. The selected chip is not saved: the page starts at All.
 */
export function ViewChips({
  detail,
  view,
  onView,
}: {
  detail: MonthDetail | undefined;
  view: PlanView;
  onView: (v: PlanView) => void;
}) {
  const over = detail ? overspentCount(detail) : 0;
  const chip = (v: PlanView, label: string, extra = "") => (
    <button
      key={v}
      type="button"
      className={`view-chip${extra}${view === v ? " is-selected" : ""}`}
      aria-pressed={view === v}
      title={label}
      onClick={() => onView(v)}
    >
      {v === "overspent" && <WarningTriangleIcon width={12} height={12} />}
      {label}
    </button>
  );
  return (
    <div className="view-chips">
      {chip("all", VIEW_CHIP_LABEL.all)}
      {over > 0 && chip("overspent", overspentLabel(over), " is-overspent")}
      {CHIPS.slice(1).map((v) => chip(v, VIEW_CHIP_LABEL[v]))}
    </div>
  );
}
