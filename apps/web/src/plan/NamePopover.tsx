import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { Popover } from "./Popover";

type Mode = "add-group" | "add-category" | "edit-group" | "edit-category";

const PLACEHOLDER: Record<Mode, string> = {
  "add-group": "New Category Group",
  "add-category": "New Category",
  "edit-group": "Enter category name",
  "edit-category": "Enter category name",
};
const LABEL: Record<Mode, string> = {
  "add-group": "Add Category Group",
  "add-category": "Add Category",
  "edit-group": "Edit Category Group",
  "edit-category": "Edit Category",
};

/** Add (224px: Cancel, OK) or edit (400px: Hide, Delete | Cancel, OK) a group or category name. */
export function NamePopover({
  anchor,
  mode,
  initial = "",
  onSubmit,
  onHide,
  onDelete,
  onClose,
}: {
  anchor: HTMLElement;
  mode: Mode;
  initial?: string;
  /** Rejects with an ApiError to keep the popover open with its message. */
  onSubmit: (name: string) => Promise<void>;
  onHide?: () => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const edit = mode.startsWith("edit");
  const isGroup = mode.endsWith("group");
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't save. Try again.");
      setBusy(false);
    }
  };
  const submit = () => {
    if (busy) return;
    const v = name.trim();
    if (v === "") {
      setError(isGroup ? "The group name is required." : "The category name is required.");
      return;
    }
    if (edit && v === initial) {
      onClose();
      return;
    }
    void run(() => onSubmit(v));
  };

  return (
    <Popover anchor={anchor} width={edit ? 400 : 224} label={LABEL[mode]} onClose={onClose}>
      <input
        ref={input}
        className="popover-input"
        type="text"
        aria-label={isGroup ? "Category group name" : "Category name"}
        placeholder={PLACEHOLDER[mode]}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
      />
      {error && (
        <div className="popover-error" role="alert">
          {error}
        </div>
      )}
      <div className="popover-buttons">
        {edit && (
          <>
            <button
              type="button"
              className="popover-button is-secondary"
              disabled={busy}
              onClick={() => onHide && void run(onHide)}
            >
              Hide
            </button>
            <button
              type="button"
              className="popover-button is-destructive"
              disabled={busy}
              onClick={() => onDelete?.()}
            >
              Delete
            </button>
          </>
        )}
        <span className="popover-spacer" />
        <button type="button" className="popover-button is-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="popover-button is-primary"
          disabled={busy}
          onClick={submit}
        >
          OK
        </button>
      </div>
    </Popover>
  );
}
