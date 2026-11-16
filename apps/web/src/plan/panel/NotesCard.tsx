import { CATEGORY_NOTE_MAX } from "@budget/schema/categories";
import { useRef, useState } from "react";
import { normalizeNote, useSetCategoryNote } from "../../api/categories";
import { PanelCard } from "./PanelCard";

/** The category's note: a block that becomes a textarea on click and saves when the field loses focus. */
export function NotesCard({
  budgetId,
  categoryId,
  note,
}: {
  budgetId: string;
  categoryId: string;
  note: string | null;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSetCategoryNote(budgetId);
  const cancelled = useRef(false);
  const finish = (value: string) => {
    setDraft(null);
    if (cancelled.current) return;
    if (normalizeNote(value) !== note) save.mutate({ categoryId, before: note, note: value });
  };
  return (
    <PanelCard id="panel-notes" title="Notes">
      {draft === null ? (
        <button
          type="button"
          className="note-display"
          onClick={() => {
            save.reset();
            cancelled.current = false;
            setDraft(note ?? "");
          }}
        >
          {note ?? <span className="note-placeholder">Enter a note...</span>}
        </button>
      ) : (
        <textarea
          className="note-field"
          aria-label="Note"
          maxLength={CATEGORY_NOTE_MAX}
          value={draft}
          // biome-ignore lint/a11y/noAutofocus: the field replaces the block that was just clicked
          autoFocus
          onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => finish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              cancelled.current = true;
              setDraft(null);
            }
          }}
        />
      )}
      {save.isError && (
        <div className="panel-error" role="alert">
          Couldn't save the note.
        </div>
      )}
    </PanelCard>
  );
}
