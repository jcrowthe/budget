import { categoryMenu } from "@budget/schema/register";
import { useMemo, useRef, useState } from "react";
import { useMonth } from "../api/months";
import { localToday } from "../api/today";
import { CaretRightIcon } from "./icons";
import { Popover } from "./Popover";

/**
 * The category menu for several rows, opened from the bar's Categorize button: one entry per category group
 * ("Inflow" first); the active group opens a submenu of its categories. A pick applies it to all the rows.
 */
export function BulkCategorize({
  anchor,
  budgetId,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  budgetId: string;
  /** A category id, or "ready_to_assign". */
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const month = useMonth(budgetId, `${localToday().slice(0, 7)}-01`).data;
  const menu = useMemo(
    () => categoryMenu(month?.groups ?? [], month?.ready_to_assign ?? 0, ""),
    [month],
  );
  const [active, setActive] = useState<string | null>(null);
  const rowBtn = useRef<HTMLButtonElement | null>(null);
  const activeGroup = menu.groups.find((g) => g.name === active);
  return (
    <Popover anchor={anchor} placement="above" width={232} label="Categories" onClose={onClose}>
      <ul className="bulk-list">
        {menu.groups.map((g) => (
          <li key={g.name}>
            <button
              ref={g.name === active ? rowBtn : undefined}
              type="button"
              role="menuitem"
              className={`bulk-item${g.name === active ? " is-active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={g.name === active}
              onMouseEnter={() => setActive(g.name)}
              onClick={() => setActive(g.name)}
            >
              <span className="bulk-item-label">{g.name}</span>
              <span className="bulk-chevron" aria-hidden="true">
                <CaretRightIcon />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {activeGroup && rowBtn.current ? (
        <Popover
          anchor={rowBtn.current}
          placement="right"
          dx={-5}
          width={256}
          label={activeGroup.name}
          className="is-submenu"
          onClose={onClose}
        >
          <ul className="bulk-list">
            {activeGroup.rows.map((r) => (
              <li key={r.id ?? "rta"}>
                <button
                  type="button"
                  role="menuitem"
                  className="bulk-item"
                  onClick={() => onPick(r.kind === "rta" ? "ready_to_assign" : (r.id as string))}
                >
                  <span className="bulk-item-label">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}
    </Popover>
  );
}
