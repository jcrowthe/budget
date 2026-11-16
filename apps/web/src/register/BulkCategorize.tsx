import { formatMoney } from "@budget/core/money";
import { categoryMenu } from "@budget/schema/register";
import { useEffect, useMemo, useState } from "react";
import { useMonth } from "../api/months";
import { localToday } from "../api/today";
import { Dropdown } from "./Dropdown";
import { Option } from "./PickerInput";

const tone = (amount: number) => (amount > 0 ? "positive" : amount < 0 ? "negative" : "zero");

/** The category list for several rows, anchored to the bar's Categorize button; a pick applies it to all of them. */
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
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(-1);
  const menu = useMemo(
    () => categoryMenu(month?.groups ?? [], month?.ready_to_assign ?? 0, typed),
    [month, typed],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.(".entry-dropdown") || anchor.contains(t)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [anchor, onClose]);
  let i = 0;
  return (
    <Dropdown
      anchor={anchor}
      label="Categories"
      width={400}
      header={
        <input
          className="bulk-input"
          // biome-ignore lint/a11y/noAutofocus: the dialog opens for this one input
          autoFocus
          aria-label="Search categories"
          placeholder="category"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      }
    >
      {menu.empty ? (
        <div className="entry-help">No categories found with that name.</div>
      ) : (
        menu.groups.map((g) => (
          <div key={g.name}>
            <div role="presentation" className="entry-heading">
              {g.name}
            </div>
            {g.rows.map((r) => {
              const idx = i++;
              return (
                <Option
                  key={r.id ?? "rta"}
                  active={active === idx}
                  name={r.name}
                  onPick={() => onPick(r.kind === "rta" ? "ready_to_assign" : (r.id as string))}
                  onHover={() => setActive(idx)}
                >
                  <span className="entry-option-name">{r.name}</span>
                  <span className={`entry-available ${tone(r.amount)}`}>
                    {formatMoney(r.amount)}
                  </span>
                </Option>
              );
            })}
          </div>
        ))
      )}
    </Dropdown>
  );
}
