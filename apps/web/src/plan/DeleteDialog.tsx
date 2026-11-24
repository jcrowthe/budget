import type { MonthGroupDetail } from "@budget/schema/months";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCategoryActions } from "../api/categories";
import { ApiError } from "../api/client";
import { CategoryPicker } from "./CategoryPicker";

/** The dialog for deleting a category or group that has history: pick where the history goes. */
export function DeleteDialog({
  budgetId,
  kind,
  id,
  name,
  ids,
  categoryCount,
  transactionCount,
  scheduledCount,
  groups,
  onDone,
  onCancel,
}: {
  budgetId: string;
  kind: "category" | "group";
  /** The id of the category or group being deleted. */
  id: string;
  name: string;
  /** The categories being deleted (all of the group's, for a group). */
  ids: string[];
  categoryCount: number;
  transactionCount: number;
  scheduledCount: number;
  groups: MonthGroupDetail[];
  /** The delete went through (the months are already refetched). */
  onDone: () => void;
  onCancel: () => void;
}) {
  const actions = useCategoryActions(budgetId);
  const [target, setTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exclude = useMemo(() => new Set(ids), [ids]);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const targetName = useMemo(
    () =>
      groups.flatMap((g) => g.categories).find((c) => c.id === target)?.name ?? "the new category",
    [groups, target],
  );
  const title = kind === "group" ? "Delete Category Group" : "Delete Category";

  useEffect(() => {
    // The picker stops Escape while its list is open, so this only sees the one that closes the dialog.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const remove = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await (kind === "group"
        ? actions.deleteGroup(id, target)
        : actions.deleteCategory(id, target));
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Couldn't delete. Try again.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog modal delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
        </div>
        <div className="delete-body">
          {kind === "group" ? (
            <p>
              All <strong>{categoryCount}</strong> categories in the group <strong>{name}</strong>{" "}
              will be reassigned to the selected category.
            </p>
          ) : (
            <p>
              Before you can delete the category <strong>{name}</strong>, you'll need to reassign
              your past activity to a new category.
            </p>
          )}
          <CategoryPicker
            groups={groups}
            value={target}
            onChange={setTarget}
            exclude={exclude}
            include={(c) => c.kind === null}
            label="Select category"
            autoFocus
          />
          <p className="delete-what">Here's what will be reassigned to the new category:</p>
          <ul className="delete-list">
            <li>
              All transactions <span className="count-badge">{transactionCount}</span>
            </li>
            <li>All assigned amounts</li>
            <li>Any remaining available amount</li>
          </ul>
          {scheduledCount > 0 && (
            <p className="delete-scheduled">
              {scheduledCount} scheduled transaction{scheduledCount === 1 ? "" : "s"} will move to{" "}
              {target ? targetName : "the new category"}
            </p>
          )}
          {error && (
            <div className="popover-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="popover-buttons delete-footer">
          <span className="popover-spacer" />
          <button type="button" className="popover-button is-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="popover-button is-destructive"
            disabled={!target || busy}
            onClick={remove}
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
