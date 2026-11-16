import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismiss } from "../plan/useDismiss";
import { type FilterNode, leafIds, searchNodes } from "./filters";
import { EyeSlashIcon, SearchIcon } from "./icons";

const WIDTH = 450;
const MARGIN = 8;

function Check({
  label,
  checked,
  indeterminate,
  onChange,
  hidden,
  className,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  hidden?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <label className={`filter-row ${className ?? ""}`}>
      <input ref={ref} type="checkbox" checked={checked} onChange={onChange} />
      <span className="filter-row-label">{label}</span>
      {hidden && (
        <span className="filter-hidden-tag">
          <EyeSlashIcon width={14} height={14} />
          Hidden
        </span>
      )}
    </label>
  );
}

/** A popover under its anchor holding a draft selection: Done saves it, Cancel/Escape drop it. */
export function FilterPopover({
  anchorRef,
  title,
  searchPlaceholder,
  nodes,
  selected,
  onDone,
  onClose,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  title: string;
  searchPlaceholder: string;
  nodes: FilterNode[];
  selected: ReadonlySet<string>;
  onDone: (selected: Set<string>) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    width: number;
    arrow: number;
  } | null>(null);
  useDismiss(ref, onClose, anchorRef);

  useLayoutEffect(() => {
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
      const centre = r.left + r.width / 2;
      const left = Math.max(
        MARGIN,
        Math.min(centre - width / 2, window.innerWidth - width - MARGIN),
      );
      setPos({
        left,
        top: r.bottom + 15,
        width,
        arrow: Math.max(12, Math.min(centre - left - 15, width - 42)),
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorRef]);

  const all = leafIds(nodes);
  const visible = searchNodes(nodes, query);
  const toggle = (ids: string[], on: boolean) =>
    setDraft((d) => {
      const n = new Set(d);
      for (const id of ids) on ? n.add(id) : n.delete(id);
      return n;
    });
  const maxList = pos ? Math.max(120, window.innerHeight - pos.top - 150) : 290;

  return createPortal(
    <div
      ref={ref}
      className="filter-popover"
      role="dialog"
      aria-label={title}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width: pos?.width ?? WIDTH,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <span className="filter-arrow" aria-hidden="true" style={{ left: pos?.arrow ?? 0 }} />
      <div className="filter-search">
        <SearchIcon width={16} height={16} />
        <input
          type="search"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="filter-list" style={{ maxHeight: maxList }}>
        {visible.map((n) => {
          if (n.leaf) {
            const id = n.leaf.id;
            return (
              <Check
                key={n.key}
                className="group"
                label={n.label}
                checked={draft.has(id)}
                onChange={() => toggle([id], !draft.has(id))}
              />
            );
          }
          const allIds = (nodes.find((x) => x.key === n.key)?.children ?? n.children).map(
            (c) => c.id,
          );
          const count = allIds.filter((id) => draft.has(id)).length;
          return (
            <div key={n.key}>
              <Check
                className="group"
                label={n.label}
                hidden={n.hidden}
                checked={count === allIds.length}
                indeterminate={count > 0}
                onChange={() => toggle(allIds, count !== allIds.length)}
              />
              {n.children.map((c) => (
                <Check
                  key={c.id}
                  className="child"
                  label={c.label}
                  hidden={c.hidden}
                  checked={draft.has(c.id)}
                  onChange={() => toggle([c.id], !draft.has(c.id))}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="filter-footer">
        <button type="button" className="filter-link" onClick={() => toggle(all, true)}>
          Select All
        </button>
        <button type="button" className="filter-link" onClick={() => toggle(all, false)}>
          Select None
        </button>
        <span className="spacer" />
        <button type="button" className="reflect-btn secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="reflect-btn primary" onClick={() => onDone(draft)}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
