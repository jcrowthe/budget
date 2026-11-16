import { type ReactNode, useEffect, useState } from "react";
import { Dropdown } from "./Dropdown";
import { CaretDownIcon, CheckIcon } from "./icons";

export type PickerRender = {
  active: number;
  pick: (index: number) => void;
  hover: (index: number) => void;
};

/**
 * A text field with a list under it (payee, category, account). Keys: ArrowUp/ArrowDown move the highlight;
 * Enter picks it only after the user typed or moved (otherwise Enter saves the row); Tab picks it once the user typed or moved.
 * Options take `mousedown` without moving focus out of the field.
 */
export function PickerInput<T>({
  label,
  placeholder,
  text,
  onText,
  items,
  initialActive,
  onPick,
  onBlurCommit,
  disabled,
  title,
  startOpen,
  width,
  listLabel,
  header,
  footer,
  render,
}: {
  label: string;
  placeholder: string;
  text: string;
  onText: (text: string) => void;
  items: T[];
  initialActive: number;
  onPick: (item: T) => void;
  onBlurCommit?: () => void;
  disabled?: boolean;
  title?: string;
  startOpen?: boolean;
  width: number;
  listLabel: string;
  /** A fixed block above the scrolling list. */
  header?: (ctx: PickerRender) => ReactNode;
  footer?: ReactNode;
  render: (ctx: PickerRender) => ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(!!startOpen);
  const [moved, setMoved] = useState(false);
  const [active, setActive] = useState(initialActive);

  // The highlight follows the typed text (and the list when it loads) until the user moves it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart from initialActive only when it or the text changes
  useEffect(() => {
    setActive(initialActive);
  }, [initialActive, text]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll again whenever the highlight moves
  useEffect(() => {
    if (!open) return;
    document
      .querySelector('.entry-dropdown [role="option"][aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (i: number) => {
    const item = items[i];
    if (item === undefined) return;
    onPick(item);
    setOpen(false);
    setMoved(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setOpen(true);
      setMoved(true);
      setActive((a) => {
        if (!open) return a < 0 ? 0 : a;
        const next = a + (e.key === "ArrowDown" ? 1 : -1);
        return Math.max(0, Math.min(items.length - 1, next));
      });
    } else if (e.key === "Enter") {
      if (open && moved && items[active] !== undefined) {
        e.preventDefault();
        e.stopPropagation();
        pick(active);
      }
    } else if (e.key === "Tab") {
      if (open && moved && items[active] !== undefined) pick(active);
    }
  };

  return (
    <div className="entry-input entry-picker" ref={setAnchor}>
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        value={text}
        disabled={disabled}
        title={title}
        onFocus={() => {
          setOpen(true);
          setMoved(false);
          setActive(initialActive);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          onText(e.target.value);
          setOpen(true);
          setMoved(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setOpen(false);
          setMoved(false);
          onBlurCommit?.();
        }}
      />
      <CaretDownIcon className="entry-caret" />
      {open && anchor && !disabled ? (
        <Dropdown
          anchor={anchor}
          label={listLabel}
          width={width}
          footer={footer}
          header={header?.({ active, pick, hover: (i) => setActive(i) })}
        >
          {render({
            active,
            pick,
            hover: (i) => setActive(i),
          })}
        </Dropdown>
      ) : null}
    </div>
  );
}

/** One selectable row. `mousedown` is cancelled so the field keeps focus; the click picks. */
export function Option({
  active,
  name,
  onPick,
  onHover,
  checked,
  variant,
  children,
}: {
  active: boolean;
  name: string;
  onPick: () => void;
  onHover: () => void;
  /** Draws the check in the leading slot (the current value). */
  checked?: boolean;
  variant?: "create";
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field's own keys drive the list
    <div
      role="option"
      aria-selected={active}
      aria-label={name}
      tabIndex={-1}
      className={`entry-option${variant ? ` is-${variant}` : ""}${active ? " is-active" : ""}`}
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <div className="entry-option-inner">
        {variant ? null : (
          <span className="entry-check-slot">
            {checked ? <CheckIcon width={16} height={16} /> : null}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
