import type { ManageGroups, Payee } from "@budget/schema/payees";
import { RENAMING } from "@budget/schema/rename-rules";
import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "../shell/icons";
import { useWindowedRows } from "./manage-payees-window";
import { GearIcon } from "./rename-rules-icons";

export type GroupKey = "payees" | "transfers" | "hidden";
export const GROUP_LABEL: Record<GroupKey, string> = {
  payees: "Payees",
  transfers: "Transfer Payees",
  hidden: "Hidden Payees",
};
const ORDER: GroupKey[] = ["payees", "transfers", "hidden"];
const ROW = 33;

type Item = { kind: "header"; group: GroupKey } | { kind: "row"; payee: Payee; group: GroupKey };
const itemKey = (i: Item) => (i.kind === "header" ? `h-${i.group}` : `r-${i.payee.id}`);

/** The left pane's list: three groups, only the rows near the visible part are in the page. */
export function PayeeList({
  groups,
  open,
  onToggleGroup,
  selected,
  onSelectOnly,
  onToggle,
  onToggleGroupAll,
  active,
  onActive,
  showHidden,
}: {
  groups: ManageGroups;
  open: Record<GroupKey, boolean>;
  onToggleGroup: (g: GroupKey) => void;
  selected: ReadonlySet<string>;
  onSelectOnly: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleGroupAll: (g: GroupKey) => void;
  active: string | null;
  onActive: (key: string | null) => void;
  /** Hidden Payees is listed only while a payee is hidden (the search does not change that). */
  showHidden: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const g of ORDER) {
      if (g === "hidden" && !showHidden) continue;
      out.push({ kind: "header", group: g });
      if (open[g]) for (const payee of groups[g]) out.push({ kind: "row", payee, group: g });
    }
    return out;
  }, [groups, open, showHidden]);
  const w = useWindowedRows(items.length, ROW, scroller);
  const index = active === null ? -1 : items.findIndex((i) => itemKey(i) === active);

  // Keep the active item in view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || index < 0) return;
    if (index * ROW < el.scrollTop) el.scrollTop = index * ROW;
    else if ((index + 1) * ROW > el.scrollTop + el.clientHeight)
      el.scrollTop = (index + 1) * ROW - el.clientHeight;
  }, [index]);

  const count = (g: GroupKey) => groups[g].filter((p) => selected.has(p.id)).length;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = (to: number) => {
      const it = items[Math.max(0, Math.min(items.length - 1, to))];
      if (it) onActive(itemKey(it));
      e.preventDefault();
    };
    const cur = items[index];
    if (e.key === "ArrowDown") move(index < 0 ? 0 : index + 1);
    else if (e.key === "ArrowUp") move(index < 0 ? 0 : index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(items.length - 1);
    else if (e.key === " " && cur) {
      e.preventDefault();
      if (cur.kind === "header") onToggleGroupAll(cur.group);
      else onToggle(cur.payee.id);
    } else if (e.key === "Enter" && cur) {
      e.preventDefault();
      if (cur.kind === "header") onToggleGroup(cur.group);
      else onSelectOnly(cur.payee.id);
    } else if (e.key === "ArrowRight" && cur?.kind === "header" && !open[cur.group]) {
      e.preventDefault();
      onToggleGroup(cur.group);
    } else if (e.key === "ArrowLeft" && cur?.kind === "header" && open[cur.group]) {
      e.preventDefault();
      onToggleGroup(cur.group);
    }
  };

  return (
    <div
      ref={scroller}
      className="mp-list"
      // biome-ignore lint/a11y/useSemanticElements: a windowed list with grouped headers and checkboxes is one composite widget
      role="listbox"
      aria-label="Payees"
      aria-multiselectable="true"
      tabIndex={0}
      aria-activedescendant={index >= 0 ? `mp-${itemKey(items[index] as Item)}` : undefined}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: w.padTop }} aria-hidden="true" />
      {items.slice(w.start, w.end).map((it) => {
        const key = itemKey(it);
        const isActive = key === active;
        if (it.kind === "header") {
          const g = it.group;
          const rows = groups[g];
          const n = count(g);
          const all = rows.length > 0 && n === rows.length;
          const label = GROUP_LABEL[g];
          return (
            <div
              key={key}
              id={`mp-${key}`}
              role="option"
              tabIndex={-1}
              aria-selected={all}
              className={`mp-row mp-header${isActive ? " is-active" : ""}`}
            >
              <button
                type="button"
                tabIndex={-1}
                className="mp-chevron"
                aria-label={`${open[g] ? "Collapse" : "Expand"} ${label}`}
                aria-expanded={open[g]}
                onClick={() => onToggleGroup(g)}
              >
                {open[g] ? (
                  <ChevronDownIcon width={12} height={12} />
                ) : (
                  <ChevronRightIcon width={12} height={12} />
                )}
              </button>
              <label className="mp-check">
                <input
                  type="checkbox"
                  tabIndex={-1}
                  aria-label={`${all ? "Uncheck all" : "Check all"} ${label}`}
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = n > 0 && !all;
                  }}
                  onChange={() => onToggleGroupAll(g)}
                />
                <span className="mp-header-label">{n > 0 ? `${label} (${n})` : label}</span>
              </label>
            </div>
          );
        }
        const p = it.payee;
        return (
          <div
            key={key}
            id={`mp-${key}`}
            role="option"
            tabIndex={-1}
            aria-selected={selected.has(p.id)}
            className={`mp-row mp-payee${isActive ? " is-active" : ""}${it.group === "hidden" ? " is-hidden" : ""}`}
          >
            <span className="mp-rules-slot">
              {p.has_rules ? (
                <span role="img" aria-label={RENAMING.listIcon} title={RENAMING.listIcon}>
                  <GearIcon />
                </span>
              ) : null}
            </span>
            <label className="mp-check">
              <input
                type="checkbox"
                tabIndex={-1}
                aria-label={`Check ${p.name}`}
                checked={selected.has(p.id)}
                onChange={() => onToggle(p.id)}
              />
            </label>
            <button
              type="button"
              tabIndex={-1}
              className="mp-name"
              title={p.name}
              aria-label={`Select ${p.name}`}
              onClick={() => onSelectOnly(p.id)}
            >
              {p.name}
            </button>
          </div>
        );
      })}
      <div style={{ height: w.padBottom }} aria-hidden="true" />
    </div>
  );
}
