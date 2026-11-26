import { FLAG_COLORS, type FlagColor } from "@budget/schema/transactions";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useFlagNames } from "../api/budgets";
import { useEditFlagsDialog } from "../flag-names/useEditFlagsDialog";
import { FlagFilledIcon, FlagOutlineIcon } from "./icons";
import { Popover } from "./Popover";

/** The six colours (the plan's flag names) with their digit keys, then "Edit Flags", which opens its dialog. A digit picks while it is open. */
export function FlagMenu({
  anchor,
  placement,
  flagged,
  onPick,
  onClose,
  onEditFlags,
  belowTrim,
}: {
  anchor: HTMLElement;
  /** Pixels the menu sits closer to its anchor (the flag cell's menu overlaps its arrow more). */
  belowTrim?: number;
  placement: "above" | "below";
  /** True when a target row is flagged: "Clear 0" is listed. */
  flagged: boolean;
  onPick: (color: FlagColor | null) => void;
  onClose: () => void;
  /** "Edit Flags" in the footer; the menu closes first. */
  onEditFlags: () => void;
}) {
  const { label } = useFlagNames();
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !/^[0-6]$/.test(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const n = Number(e.key);
      if (n === 0) {
        if (flagged) pick.current(null);
      } else pick.current(FLAG_COLORS[n - 1] as FlagColor);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [flagged]);

  return (
    <Popover
      anchor={anchor}
      placement={placement}
      width={238}
      label="Flags"
      bodyClass="is-flags"
      belowTrim={belowTrim}
      onClose={onClose}
    >
      <ul className="flags-list">
        {flagged && (
          <li>
            <button
              type="button"
              role="menuitem"
              className="flag-pill"
              aria-label="Clear"
              onClick={() => onPick(null)}
            >
              <FlagOutlineIcon />
              <span className="label">Clear</span>
            </button>
            <kbd>0</kbd>
          </li>
        )}
        {FLAG_COLORS.map((c, i) => (
          <li key={c}>
            <button
              type="button"
              role="menuitem"
              className="flag-pill"
              aria-label={label(c)}
              onClick={() => onPick(c)}
            >
              <FlagFilledIcon className={`flag-${c}`} />
              <span className="label">{label(c)}</span>
            </button>
            <kbd>{i + 1}</kbd>
          </li>
        ))}
      </ul>
      <hr className="flags-hr" />
      <div className="flags-footer">
        <button
          type="button"
          role="menuitem"
          className="edit-flags"
          onClick={() => {
            onClose();
            onEditFlags();
          }}
        >
          Edit Flags
        </button>
      </div>
    </Popover>
  );
}

/** One row's flag cell: the outline flag, or the colour on its pill (title and label = the flag's name in the plan). */
export function FlagCell({
  color,
  onPick,
}: {
  color: FlagColor | null;
  onPick: (color: FlagColor | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const { budgetId } = useParams();
  const { label } = useFlagNames();
  const edit = useEditFlagsDialog(budgetId ?? null);
  const name = color ? label(color) : "Flag";
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`flag-cell-button${color ? ` is-${color}` : ""}`}
        aria-label={name}
        title={color ? name : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {color ? <FlagFilledIcon className={`flag-${color}`} /> : <FlagOutlineIcon />}
      </button>
      {open && btn.current ? (
        <FlagMenu
          anchor={btn.current}
          placement="below"
          belowTrim={5}
          flagged={color !== null}
          onClose={() => setOpen(false)}
          onEditFlags={edit.open}
          onPick={(c) => {
            setOpen(false);
            onPick(c);
          }}
        />
      ) : null}
      {edit.dialog}
    </>
  );
}
