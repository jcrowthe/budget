import type { TargetBehavior } from "@budget/schema/targets";
import { useEffect, useRef, useState } from "react";
import { CaretDownIcon, CheckCircleFillIcon } from "../icons";
import { Popover } from "../Popover";

export interface BehaviorOption {
  value: TargetBehavior;
  title: string;
  use: string;
  tagline: string | null;
  badge: string | null;
}

/** "Next month I want to" / "I want to": a button that opens the options above it, each with its help text. */
export function BehaviorDropdown({
  labelId,
  options,
  value,
  onChange,
  disabled,
}: {
  /** The id of the label (`dt`) that names the control. */
  labelId: string;
  options: BehaviorOption[];
  value: TargetBehavior;
  onChange: (v: TargetBehavior) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const shown = options.find((o) => o.value === value) ?? options[0];
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="target-dropdown"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <span className="target-dropdown-text">{shown?.title}</span>
        <CaretDownIcon width={9} height={9} />
      </button>
      {open && button.current && (
        <Popover
          anchor={button.current}
          width={button.current.offsetWidth}
          label="Options"
          placement="above"
          dismissOnOutside
          className="target-popup behavior-popup"
          onClose={() => setOpen(false)}
        >
          <Options
            options={options}
            value={value}
            onPick={(v) => {
              onChange(v);
              close();
            }}
            onEscape={close}
          />
        </Popover>
      )}
    </>
  );
}

function Options({
  options,
  value,
  onPick,
  onEscape,
}: {
  options: BehaviorOption[];
  value: TargetBehavior;
  onPick: (v: TargetBehavior) => void;
  onEscape: () => void;
}) {
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    items.current[
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      )
    ]?.focus();
  }, [options, value]);
  const move = (from: number, by: number) =>
    items.current[(from + by + options.length) % options.length]?.focus();
  return (
    <div className="behavior-options" role="listbox" aria-label="Options">
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            items.current[i] = el;
          }}
          type="button"
          role="option"
          aria-selected={o.value === value}
          className={`behavior-option${o.value === value ? " is-selected" : ""}`}
          onClick={() => onPick(o.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              move(i, e.key === "ArrowDown" ? 1 : -1);
            } else if (e.key === "Escape") {
              // Only the dropdown closes; the form and the selection stay.
              e.preventDefault();
              e.stopPropagation();
              onEscape();
            }
          }}
        >
          <span className="behavior-title">
            {o.value === value && <CheckCircleFillIcon width={16} height={16} />}
            {o.title}
          </span>
          <em className="behavior-use">{o.use}</em>
          {o.badge && <span className="behavior-badge">{o.badge}</span>}
          {o.tagline && <span className="behavior-tagline">{o.tagline}</span>}
        </button>
      ))}
    </div>
  );
}
