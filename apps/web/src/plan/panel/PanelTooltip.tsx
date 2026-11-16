import { type ReactElement, useId, useState } from "react";

type TriggerProps = {
  "aria-describedby": string | undefined;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/**
 * Shows `text` under the trigger while it is hovered or focused; Escape hides it. The delay is CSS
 * (`--panelTooltipDelay`), so the tooltip is in the document at once and becomes visible after it.
 */
export function PanelTooltip({
  text,
  children,
}: {
  text: string;
  children: (props: TriggerProps) => ReactElement;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="panel-tip-anchor">
      {children({
        "aria-describedby": open ? id : undefined,
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
      {open && (
        <span id={id} role="tooltip" className="panel-tooltip">
          {text}
        </span>
      )}
    </div>
  );
}
