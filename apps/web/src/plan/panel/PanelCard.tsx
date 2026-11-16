import type { ReactNode } from "react";
import { CardChevronDownIcon, CardChevronRightIcon } from "../icons";

/**
 * A card of the right panel. With `onToggle` its header is a button that rolls the body up and down; without
 * it the header is static (Notes).
 */
export function PanelCard({
  id,
  title,
  collapsed = false,
  onToggle,
  right,
  icon,
  ruled = false,
  children,
}: {
  id: string;
  title: string;
  collapsed?: boolean;
  onToggle?: () => void;
  right?: ReactNode;
  /** Beside the title (the Target card's donut). */
  icon?: ReactNode;
  /** A static header over a rule and a body padded 16 all round (the Target form). */
  ruled?: boolean;
  children: ReactNode;
}) {
  if (!onToggle && ruled) {
    return (
      <section className="panel-card">
        <h2 className="panel-card-title panel-card-ruled-title">{title}</h2>
        <div id={id} className="panel-card-ruled-body">
          {children}
        </div>
      </section>
    );
  }
  if (!onToggle) {
    return (
      <section className="panel-card">
        <div className="panel-card-static">
          <h2 className="panel-card-title">{title}</h2>
          <div id={id}>{children}</div>
        </div>
      </section>
    );
  }
  return (
    <section className="panel-card">
      <button
        type="button"
        className="card-roll-up"
        aria-expanded={!collapsed}
        aria-controls={id}
        onClick={onToggle}
      >
        <h2 className="panel-card-title">{title}</h2>
        {icon}
        {collapsed ? <CardChevronRightIcon /> : <CardChevronDownIcon />}
        {right && <span className="card-roll-up-right">{right}</span>}
      </button>
      <div id={id} className="panel-card-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}
