import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ChipEntry } from "../../api/customViews";
import { inTopHalf } from "../dnd";
import { PencilIcon, TrashIcon } from "../icons";
import "./views.css";
import { dropOrder, keyboardOrder } from "./viewsDnd";

type Gap = { id: string; top: boolean };

/**
 * Manage Views: every chip after All and Overspent as a draggable card. Built-in cards only reorder; a custom
 * card also edits and deletes (an inline Cancel | Delete). `paused` while the editor is open over it.
 */
export function ManageViewsDialog({
  order,
  paused,
  onReorder,
  onEdit,
  onDelete,
  onNew,
  onDone,
}: {
  order: ChipEntry[];
  paused: boolean;
  onReorder: (ids: string[]) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onNew: () => void;
  onDone: () => void;
}) {
  const ids = order.map((e) => e.key);
  const [dragging, setDragging] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [failed, setFailed] = useState(false);
  const refocus = useRef<string | null>(null);
  const handles = useRef(new Map<string, HTMLElement>());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paused) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") doneRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [paused]);

  // A moved card keeps keyboard focus on its handle once the list has re-rendered in the new order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the order changes
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id) handles.current.get(id)?.focus();
    refocus.current = null;
  }, [ids.join()]);

  const nameOf = (id: string) => order.find((e) => e.key === id)?.label ?? "";
  const endDrag = () => {
    setDragging(null);
    setGap(null);
  };

  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="dialog modal manage-views-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Manage Views"
      >
        <div className="dialog-head">
          <h2>Manage Views</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onDone}>
            ✕
          </button>
        </div>
        <ul className="manage-view-list">
          {order.map((e) => (
            <li
              key={e.key}
              className={`manage-view-card${dragging === e.key ? " is-dragging" : ""}${
                gap?.id === e.key ? (gap.top ? " gap-before" : " gap-after") : ""
              }`}
              onDragOver={(ev) => {
                if (!dragging) return;
                const next = dropOrder(
                  ids,
                  dragging,
                  e.key,
                  inTopHalf(ev.clientY, ev.currentTarget.getBoundingClientRect()),
                );
                if (!next) {
                  if (gap) setGap(null);
                  return;
                }
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "move";
                const top = inTopHalf(ev.clientY, ev.currentTarget.getBoundingClientRect());
                if (gap?.id !== e.key || gap.top !== top) setGap({ id: e.key, top });
              }}
              onDrop={(ev) => {
                if (!dragging) return;
                ev.preventDefault();
                const next = dropOrder(
                  ids,
                  dragging,
                  e.key,
                  inTopHalf(ev.clientY, ev.currentTarget.getBoundingClientRect()),
                );
                endDrag();
                if (next) onReorder(next);
              }}
            >
              <button
                type="button"
                className="manage-view-handle"
                draggable
                aria-label={`Reorder ${e.label}`}
                ref={(el) => {
                  if (el) handles.current.set(e.key, el);
                  else handles.current.delete(e.key);
                }}
                onDragStart={(ev) => {
                  ev.dataTransfer.effectAllowed = "move";
                  ev.dataTransfer.setData("text/plain", e.key);
                  setTimeout(() => setDragging(e.key), 0);
                }}
                onDragEnd={endDrag}
                onKeyDown={(ev) => {
                  if (!ev.altKey || !ev.shiftKey || ev.ctrlKey || ev.metaKey) return;
                  if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
                  ev.preventDefault();
                  ev.stopPropagation();
                  const m = keyboardOrder(ids, e.key, ev.key === "ArrowUp" ? -1 : 1, nameOf);
                  if (!m) return;
                  setAnnouncement(m.text);
                  refocus.current = e.key;
                  onReorder(m.ids);
                }}
              >
                <svg
                  width="12"
                  height="16"
                  viewBox="0 0 12 16"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="3" cy="3" r="1.5" />
                  <circle cx="9" cy="3" r="1.5" />
                  <circle cx="3" cy="8" r="1.5" />
                  <circle cx="9" cy="8" r="1.5" />
                  <circle cx="3" cy="13" r="1.5" />
                  <circle cx="9" cy="13" r="1.5" />
                </svg>
              </button>
              <span className="manage-view-name" title={e.label}>
                {e.label}
              </span>
              {e.custom &&
                (confirming === e.key ? (
                  <span className="manage-view-confirm">
                    <button
                      type="button"
                      className="manage-view-link"
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </button>
                    <span aria-hidden="true">|</span>
                    <button
                      type="button"
                      className="manage-view-link is-destructive"
                      onClick={() => {
                        setFailed(false);
                        onDelete(e.key)
                          .catch(() => setFailed(true))
                          .finally(() => setConfirming(null));
                      }}
                    >
                      Delete
                    </button>
                  </span>
                ) : (
                  <span className="manage-view-actions">
                    <button
                      type="button"
                      className="manage-view-icon"
                      aria-label={`Edit ${e.label}`}
                      onClick={() => onEdit(e.key)}
                    >
                      <PencilIcon width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      className="manage-view-icon"
                      aria-label={`Delete ${e.label}`}
                      onClick={() => setConfirming(e.key)}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </span>
                ))}
            </li>
          ))}
        </ul>
        {failed && (
          <div className="custom-view-error manage-view-error" role="alert">
            Couldn't delete the view. Try again.
          </div>
        )}
        <div className="views-sr" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className="dialog-footer manage-views-footer">
          <button type="button" className="secondary" onClick={onNew}>
            New View
          </button>
          <button type="button" className="primary" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
