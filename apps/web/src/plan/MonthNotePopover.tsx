import { type RefObject, useRef, useState } from "react";
import { useDismiss } from "./useDismiss";

export function MonthNotePopover({
  note,
  onSave,
  onClose,
  triggerRef,
  style,
}: {
  note: string | null;
  onSave: (note: string | null) => void;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(note ?? "");
  useDismiss(ref, onClose, triggerRef);
  const save = () => {
    const next = text.trim() || null;
    onClose();
    if (next !== (note ?? null)) onSave(next);
    triggerRef.current?.focus();
  };
  return (
    <div
      ref={ref}
      className="month-note-popover"
      role="dialog"
      aria-label="Month note"
      style={style}
    >
      <span className="popover-arrow" aria-hidden="true" />
      <div className="month-note-content">
        <textarea
          className="month-note-input"
          aria-label="Month note"
          placeholder="Enter a note..."
          // biome-ignore lint/a11y/noAutofocus: the popover opens on the person's click and the source focuses the field
          autoFocus
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 168)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>
      <div className="month-note-actions">
        <button type="button" className="month-note-ok" onClick={save}>
          OK
        </button>
      </div>
    </div>
  );
}
