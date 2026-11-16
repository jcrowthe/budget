import { type ReactElement, useId, useState } from "react";
import { KeyCaps } from "./KeyCaps";
import { type ShortcutId, shortcutById } from "./registry";

type TriggerProps = {
  "aria-describedby": string | undefined;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

// The register's own key-cap tooltip (account/Tooltip.tsx) is to be merged into this one later.
/** Shows a shortcut's description and key caps above the trigger while it is hovered or focused. */
export function ShortcutTooltip({
  id,
  align = "center",
  children,
}: {
  id: ShortcutId;
  align?: "center" | "start";
  children: (props: TriggerProps) => ReactElement;
}) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const s = shortcutById(id);
  return (
    <span className="shortcut-tip-anchor">
      {children({
        "aria-describedby": open ? tipId : undefined,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
        onKeyDown: (e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        },
      })}
      {open ? (
        <span id={tipId} role="tooltip" className={`shortcut-tooltip is-${align}`}>
          <span className="desc">{s.description}</span>
          <KeyCaps caps={s.caps} variant="tooltip" />
        </span>
      ) : null}
    </span>
  );
}
