import type { MonthGroupDetail } from "@budget/schema/months";
import { useId, useMemo, useState } from "react";
import { money } from "./format";

/**
 * A category chooser: a text field that filters as you type, over a drop-down headed "Plan Categories" with each
 * group (as "Group:") and its categories with their Available for the month. It knows nothing about what the
 * pick is for (EXF-491 Ready to Assign, EXF-492 move money, EXF-517 the register, EXF-494 delete): the caller
 * passes which categories to leave out.
 *
 * - `groups`: the month read model's groups.
 * - `value`: the picked category id, or null. `onChange(id)` runs when one is picked.
 * - `exclude`: category ids to leave out; groups left empty are dropped.
 * - `includeHidden` (default true): hidden categories and groups of hidden groups stay pickable, as in the source.
 * - `placeholder` (default "Select category"), `label` (the field's accessible name), `autoFocus`.
 * Arrow keys move, Enter picks, Escape closes the list (and stops there, so a dialog around it stays open).
 */
export function CategoryPicker({
  groups,
  value,
  onChange,
  exclude,
  placeholder = "Select category",
  label,
  includeHidden = true,
  autoFocus,
}: {
  groups: MonthGroupDetail[];
  value: string | null;
  onChange: (id: string) => void;
  exclude?: ReadonlySet<string>;
  placeholder?: string;
  label: string;
  includeHidden?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const all = useMemo(
    () =>
      groups
        .filter((g) => includeHidden || !g.hidden)
        .map((g) => ({
          ...g,
          categories: g.categories.filter(
            (c) => !exclude?.has(c.id) && (includeHidden || !c.hidden),
          ),
        })),
    [groups, exclude, includeHidden],
  );
  const selectedName = all.flatMap((g) => g.categories).find((c) => c.id === value)?.name ?? "";
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
  const flat = shown.flatMap((g) => g.categories);

  const pick = (id: string, name: string) => {
    setText(name);
    setOpen(false);
    onChange(id);
  };

  return (
    <div className="category-picker">
      <input
        className="picker-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={label}
        placeholder={placeholder}
        // biome-ignore lint/a11y/noAutofocus: the dialog that holds it asks for it
        autoFocus={autoFocus}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
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
        <div className="picker-list" id={listId} role="listbox" aria-label="Plan Categories">
          <div className="picker-heading">Plan Categories</div>
          {shown.map((g) => (
            <div key={g.id} className="picker-group" role="presentation">
              <div className="picker-group-name">
                <span className="picker-group-prefix">Group:</span> {g.name}
              </div>
              {g.categories.map((c) => (
                <div
                  key={c.id}
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
                    {money(c.available)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {shown.length === 0 && <div className="picker-empty">No matching categories</div>}
        </div>
      )}
    </div>
  );
}
