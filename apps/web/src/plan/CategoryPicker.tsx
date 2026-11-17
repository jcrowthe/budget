import type { MonthCategoryDetail, MonthGroupDetail } from "@budget/schema/months";
import { READY_TO_ASSIGN } from "@budget/schema/moves";
import { useId, useMemo, useRef, useState } from "react";
import { usePlanFormatter } from "../shell/plan-formats-context";

export { READY_TO_ASSIGN };

const RTA_NAME = "Inflow: Ready to Assign";
const LIST_MAX = 240;
const LIST_MARGIN = 8;

/**
 * A category chooser: a text field that filters as you type, over a drop-down headed "Plan Categories" with each
 * group (as "Group:") and its categories with their Available for the month. It knows nothing about what the
 * pick is for (EXF-491 Ready to Assign, EXF-492 move money, EXF-517 the register, EXF-494 delete): the caller
 * passes which categories to leave out.
 *
 * - `groups`: the month read model's groups.
 * - `value`: the picked category id, or null. `onChange(id)` runs when one is picked, and `onChange(null)` when
 *   the text is edited away from the picked name.
 * - `exclude`: category ids to leave out; groups left empty are dropped.
 * - `include`: keeps only the categories it accepts (positive Available for Cover and Fix This).
 * - `readyToAssign`: when set (the month's Ready to Assign), a first entry "Inflow: Ready to Assign" with that
 *   amount; picking it calls `onChange(READY_TO_ASSIGN)`.
 * The list opens upward when there is less room below the field than above, and is never taller than the room.
 * - `includeHidden` (default true): hidden categories and groups of hidden groups stay pickable, as in the source.
 * - `placeholder` (default "Select category"), `label` (the field's accessible name), `autoFocus`.
 * Arrow keys move, Enter picks, Escape closes the list (and stops there, so a dialog around it stays open).
 */
export function CategoryPicker({
  groups,
  value,
  onChange,
  exclude,
  include,
  readyToAssign,
  placeholder = "Select category",
  label,
  includeHidden = true,
  autoFocus,
}: {
  groups: MonthGroupDetail[];
  value: string | null;
  onChange: (id: string | null) => void;
  exclude?: ReadonlySet<string>;
  include?: (c: MonthCategoryDetail) => boolean;
  readyToAssign?: number;
  placeholder?: string;
  label: string;
  includeHidden?: boolean;
  autoFocus?: boolean;
}) {
  const fmt = usePlanFormatter();
  const listId = useId();
  const all = useMemo(
    () =>
      groups
        .filter((g) => includeHidden || !g.hidden)
        .map((g) => ({
          ...g,
          categories: g.categories.filter(
            (c) => !exclude?.has(c.id) && (includeHidden || !c.hidden) && (include?.(c) ?? true),
          ),
        })),
    [groups, exclude, include, includeHidden],
  );
  const selectedName =
    value === READY_TO_ASSIGN
      ? RTA_NAME
      : (all.flatMap((g) => g.categories).find((c) => c.id === value)?.name ?? "");
  const [text, setText] = useState(selectedName);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const needle = text === selectedName ? "" : text.trim().toLowerCase();
  const shown = all
    .map((g) => ({
      ...g,
      categories: g.categories.filter(
        (c) =>
          needle === "" ||
          c.name.toLowerCase().includes(needle) ||
          g.name.toLowerCase().includes(needle),
      ),
    }))
    .filter((g) => g.categories.length > 0);
  const rtaShown =
    readyToAssign !== undefined && (needle === "" || RTA_NAME.toLowerCase().includes(needle));
  const flat: { id: string; name: string }[] = [
    ...(rtaShown ? [{ id: READY_TO_ASSIGN as string, name: RTA_NAME }] : []),
    ...shown.flatMap((g) => g.categories),
  ];
  const input = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<{ up: boolean; max: number }>({ up: false, max: LIST_MAX });
  const measure = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - LIST_MARGIN;
    const above = r.top - LIST_MARGIN;
    const up = below < LIST_MAX && above > below;
    setPlace({ up, max: Math.max(80, Math.min(LIST_MAX, up ? above : below)) });
  };

  const pick = (id: string, name: string) => {
    setText(name);
    setOpen(false);
    onChange(id);
  };

  return (
    <div className="category-picker">
      <input
        ref={input}
        className="picker-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && flat[active] ? `${listId}-${flat[active].id}` : undefined}
        aria-label={label}
        placeholder={placeholder}
        // biome-ignore lint/a11y/noAutofocus: the dialog that holds it asks for it
        autoFocus={autoFocus}
        value={text}
        onFocus={() => {
          measure();
          setOpen(true);
        }}
        onClick={() => {
          measure();
          setOpen(true);
        }}
        onChange={(e) => {
          if (value !== null && e.target.value !== selectedName) onChange(null);
          setText(e.target.value);
          setActive(0);
          measure();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            const n = flat.length;
            if (n > 0) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
          } else if (e.key === "Enter" && open) {
            const c = flat[active];
            if (c) {
              e.preventDefault();
              pick(c.id, c.name);
            }
          }
        }}
      />
      {open && (
        <div
          className={`picker-list${place.up ? " is-up" : ""}`}
          id={listId}
          role="listbox"
          aria-label="Plan Categories"
          style={{ maxHeight: place.max }}
        >
          <div className="picker-heading">Plan Categories</div>
          {rtaShown && readyToAssign !== undefined && (
            <div
              id={`${listId}-${READY_TO_ASSIGN}`}
              role="option"
              tabIndex={-1}
              aria-selected={value === READY_TO_ASSIGN}
              className={`picker-option rta-option${flat[active]?.id === READY_TO_ASSIGN ? " is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(READY_TO_ASSIGN, RTA_NAME)}
              onKeyDown={() => {}}
            >
              <span className="picker-name">{RTA_NAME}</span>
              <span
                className={`picker-available ${
                  readyToAssign === 0 ? "zero" : readyToAssign > 0 ? "positive" : "negative"
                }`}
              >
                {fmt.money(readyToAssign)}
              </span>
            </div>
          )}
          {shown.map((g) => (
            <div key={g.id} className="picker-group" role="presentation">
              <div className="picker-group-name">{g.name}</div>
              {g.categories.map((c) => (
                <div
                  key={c.id}
                  id={`${listId}-${c.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={c.id === value}
                  className={`picker-option${flat[active]?.id === c.id ? " is-active" : ""}`}
                  // mousedown keeps the field focused so the list does not close before the pick
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.id, c.name)}
                  onKeyDown={() => {}}
                >
                  <span className="picker-name">{c.name}</span>
                  <span
                    className={`picker-available ${
                      c.available === 0 ? "zero" : c.available > 0 ? "positive" : "negative"
                    }`}
                  >
                    {fmt.money(c.available)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {flat.length === 0 && <div className="picker-empty">No matching categories</div>}
        </div>
      )}
    </div>
  );
}
