import type { SpendingItem } from "@budget/schema/reports";
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { money } from "./format";
import { sliceColor } from "./SpendingDonut";

export function SpendingList({
  items,
  mode,
  noCategories,
  activeId,
  onPick,
}: {
  items: SpendingItem[];
  mode: "category" | "group";
  noCategories: boolean;
  activeId?: string | null;
  onPick: (item: SpendingItem, x: number, y: number) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const measure = useCallback(() => {
    const el = body.current;
    if (el) setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the rows change
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, items]);
  const click = (item: SpendingItem) => (e: MouseEvent<HTMLButtonElement>) => {
    // A keyboard activation has no pointer position: aim at the row's centre.
    if (e.detail === 0) {
      const r = e.currentTarget.getBoundingClientRect();
      onPick(item, r.left + r.width / 2, r.top + r.height / 2);
    } else onPick(item, e.clientX, e.clientY);
  };
  return (
    <section className="sb-card sb-list-card" aria-label="Spending list">
      <div className="sb-list-head">
        <span>{mode === "group" ? "Groups" : "Categories"}</span>
        <span>Total Spending</span>
      </div>
      <div className="sb-list-body" ref={body} onScroll={measure}>
        {items.length === 0 ? (
          <p className="sb-list-empty">
            {noCategories ? "No spending to show" : "No spending to show yet"}
          </p>
        ) : (
          items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={activeId === item.id ? "sb-row active" : "sb-row"}
              data-id={item.id}
              aria-label={`${item.name} ${money(item.total)} ${item.share_pct}%`}
              onClick={click(item)}
            >
              <span className="sb-row-name">{item.name}</span>
              <span className="sb-row-amount">{money(item.total)}</span>
              <span className="sb-row-track">
                <span
                  className="sb-bar"
                  style={{ width: `${item.share_pct}%`, background: sliceColor(i) }}
                />
              </span>
              <span className="sb-row-pct">{item.share_pct}%</span>
            </button>
          ))
        )}
      </div>
      <div className={more ? "sb-list-fade" : "sb-list-fade hidden"} aria-hidden="true" />
    </section>
  );
}
