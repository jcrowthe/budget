import type { MonthDetail } from "@budget/schema/months";
import { overspentCount, overspentLabel, type PlanView } from "@budget/schema/plan-views";
import { useState } from "react";
import type { ChipEntry } from "../api/customViews";
import { WarningTriangleIcon } from "./icons";
import "./plan-views.css";
import { ViewsMenu } from "./views/ViewsMenu";

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M1 3h14l-5.4 6.3V14L6.4 12.2V9.3z" />
  </svg>
);

/**
 * The chips under the header: All, Overspent (only while something is overspent, with its live count), then the
 * built-in views and the custom views in the saved order, and the Views menu. `selected` is a built-in key or a
 * custom view's id. The selected chip is not saved: the page starts at All.
 */
export function ViewChips({
  detail,
  order,
  selected,
  onSelect,
  onNewView,
  onManageViews,
}: {
  detail: MonthDetail | undefined;
  order: ChipEntry[];
  selected: string;
  onSelect: (key: string) => void;
  onNewView: () => void;
  onManageViews: () => void;
}) {
  const over = detail ? overspentCount(detail) : 0;
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const chip = (key: PlanView | string, label: string, extra = "") => (
    <button
      key={key}
      type="button"
      className={`view-chip${extra}${selected === key ? " is-selected" : ""}`}
      aria-pressed={selected === key}
      title={label}
      onClick={() => onSelect(key)}
    >
      {key === "overspent" && <WarningTriangleIcon width={12} height={12} />}
      {extra.includes("is-custom") ? <span className="view-chip-name">{label}</span> : label}
    </button>
  );
  return (
    <div className="view-chips">
      {chip("all", "All")}
      {over > 0 && chip("overspent", overspentLabel(over), " is-overspent")}
      {order.map((e) => chip(e.key, e.label, e.custom ? " is-custom" : ""))}
      <button
        type="button"
        className="view-menu-button"
        aria-label="Views"
        title="Views"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <FilterIcon />
      </button>
      {menu && (
        <ViewsMenu
          anchor={menu}
          onClose={() => setMenu(null)}
          onNewView={onNewView}
          onManageViews={onManageViews}
        />
      )}
    </div>
  );
}
