import { FILE_IMPORT_COPY, type FileImportResult } from "@budget/schema/file-import";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../plan-export/plan-export-dialog-focus";
import { CloseIcon } from "../shell/icons";
import "./file-import.css";

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
          <p role="status">
            {allMatched
              ? FILE_IMPORT_COPY.matchedMessage(result.matched)
              : FILE_IMPORT_COPY.successMessage(result.imported, result.matched)}
          </p>
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
