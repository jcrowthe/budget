import { type ReactNode, useRef, useState } from "react";
import { filterLabel } from "./filters";
import { CaretDownIcon } from "./icons";

export function FilterButton({
  kind,
  total,
  selected,
  children,
}: {
  kind: "categories" | "accounts";
  total: number;
  selected: number;
  children: (p: {
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    close: () => void;
  }) => ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { text, count } = filterLabel(kind, total, selected);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="filter-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count === null ? text : `${count} ${text}`}
        onClick={() => setOpen((o) => !o)}
      >
        {count !== null && <span className="count-pill">{count}</span>}
        <span>{text}</span>
        <CaretDownIcon width={16} height={16} />
      </button>
      {open && children({ anchorRef: ref, close: () => setOpen(false) })}
    </>
  );
}
