import {
  CUSTOM_VIEW_ERRORS,
  CUSTOM_VIEW_NAME_MAX,
  editedViewCategoryIds,
} from "@budget/schema/custom-views";
import type { MonthGroupDetail } from "@budget/schema/months";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../../api/client";
import "./views.css";

/**
 * New Custom View / Edit Custom View: a name and one checkbox per visible category, grouped. Hidden categories are
 * not offered; on edit the view's hidden members stay in it (`editedViewCategoryIds`).
 */
export function CustomViewDialog({
  mode,
  groups,
  storedIds,
  initialName,
  onSave,
  onCancel,
}: {
  mode: "new" | "edit";
  groups: MonthGroupDetail[];
  /** The view's members as the server holds them (edit); empty for a new view. */
  storedIds: readonly string[];
  initialName: string;
  onSave: (name: string, categoryIds: string[]) => Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const title = mode === "new" ? "New Custom View" : "Edit Custom View";
  const shown = useMemo(
    () =>
      groups
        .filter((g) => !g.hidden)
        .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.hidden) }))
        .filter((g) => g.categories.length > 0),
    [groups],
  );
  const shownIds = useMemo(() => shown.flatMap((g) => g.categories.map((c) => c.id)), [shown]);
  const [name, setName] = useState(initialName);
  const [checked, setChecked] = useState(
    () => new Set(storedIds.filter((id) => shownIds.includes(id))),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const save = async () => {
    if (busy) return;
    if (name.trim() === "") {
      setError(CUSTOM_VIEW_ERRORS.nameRequired);
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(
        name.trim(),
        editedViewCategoryIds(
          storedIds,
          shownIds,
          shownIds.filter((id) => checked.has(id)),
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't save. Try again.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog form custom-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="form-body">
            <p className="custom-view-sub">
              Choose a set of categories to include in this custom view.
            </p>
            <label htmlFor={`${titleId}-name`}>View Name</label>
            <input
              id={`${titleId}-name`}
              ref={nameRef}
              className="field"
              type="text"
              maxLength={CUSTOM_VIEW_NAME_MAX}
              placeholder="Keep 'em short & sweet!"
              value={name}
              aria-invalid={error !== null}
              aria-describedby={error ? `${titleId}-error` : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && (
              <div id={`${titleId}-error`} className="custom-view-error" role="alert">
                {error}
              </div>
            )}
            <p className="custom-view-pick">Select the categories below to include.</p>
            <div className="custom-view-groups">
              {shown.map((g) => (
                <fieldset key={g.id} className="custom-view-group">
                  <legend>{g.name}</legend>
                  {g.categories.map((c) => (
                    <label key={c.id} className="custom-view-category">
                      <input
                        type="checkbox"
                        checked={checked.has(c.id)}
                        onChange={(e) =>
                          setChecked((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(c.id);
                            else n.delete(c.id);
                            return n;
                          })
                        }
                      />
                      <span>{c.name}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
          <div className="dialog-footer">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
