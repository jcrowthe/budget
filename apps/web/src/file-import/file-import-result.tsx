import { FILE_IMPORT_COPY, type FileImportResult } from "@budget/schema/file-import";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../plan-export/plan-export-dialog-focus";
import { CloseIcon } from "../shell/icons";
import "./file-import.css";

const noun = (n: number) => (n === 1 ? "transaction" : "transactions");

/** One line per non-zero count; "No new transactions were imported" when nothing was. */
export function resultLines({ imported, matched, skipped }: FileImportResult): string[] {
  const lines = [
    imported > 0 ? `${imported} ${noun(imported)} imported` : "No new transactions were imported",
  ];
  if (matched > 0) lines.push(`${matched} matched to existing ${noun(matched)}`);
  if (skipped > 0) lines.push(`${skipped} skipped`);
  return lines;
}

/** The result dialog: the counts the Worker settled on. Every row matched: "Import Matched". */
export function FileImportResultDialog({
  result,
  onClose,
  returnTo,
}: {
  result: FileImportResult;
  onClose: () => void;
  returnTo: () => HTMLElement | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useDialogFocus(box, { onEscape: onClose, returnTo, initial: ok });
  const allMatched = result.imported === 0 && result.matched > 0;
  const lines = resultLines(result);
  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="dialog form file-import-dialog file-import-dialog-one"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-import-result-title"
      >
        <div className="dialog-head">
          <h2 id="file-import-result-title">
            {allMatched ? FILE_IMPORT_COPY.matchedTitle : FILE_IMPORT_COPY.successTitle}
          </h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className="form-body file-import-body">
          <div role="status">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
        <div className="dialog-footer">
          <button type="button" className="primary" ref={ok} onClick={onClose}>
            {FILE_IMPORT_COPY.ok}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
