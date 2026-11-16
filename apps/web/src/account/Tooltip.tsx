import { type KeyboardEvent, type ReactElement, type ReactNode, useId, useState } from "react";

type TriggerProps = {
  "aria-describedby": string | undefined;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
};

/** Shows `content` under the trigger while it is hovered or focused; Escape hides it. */
export function Tooltip({
  content,
  delayed = true,
  align = "start",
  children,
}: {
  content: ReactNode;
  delayed?: boolean;
  align?: "start" | "end";
  children: (props: TriggerProps) => ReactElement;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="acct-tip-anchor">
      {children({
        "aria-describedby": open ? id : undefined,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
        onKeyDown: (e) => {
          if (e.key === "Escape") setOpen(false);
        },
      })}
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`acct-tooltip is-${align}${delayed ? " is-delayed" : ""}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
