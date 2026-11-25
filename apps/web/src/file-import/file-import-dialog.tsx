import { FILE_IMPORT_COPY } from "@budget/schema/file-import";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../plan-export/plan-export-dialog-focus";
import { InfoCircleIcon } from "../register/icons";
import { CloseIcon } from "../shell/icons";
import "./file-import.css";

/** Dialog 1: what to download, the duplicate note, "Don't show again" and the chooser. */
export function FileImportDialog({
  error,
  dontShow,
  onDontShow,
  onChoose,
  onClose,
  returnTo,
}: {
  error: string | null;
  dontShow: boolean;
  onDontShow: (v: boolean) => void;
  /** Opens the file chooser (the controller's always-mounted input, so the click keeps its user activation). */
  onChoose: () => void;
  onClose: () => void;
  returnTo: () => HTMLElement | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const choose = useRef<HTMLButtonElement>(null);
  useDialogFocus(box, { onEscape: onClose, returnTo, initial: choose });
  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="dialog form file-import-dialog file-import-dialog-one"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-import-title"
      >
        <div className="dialog-head">
          <h2 id="file-import-title">File Import</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className="form-body file-import-body">
          <p>{FILE_IMPORT_COPY.intro}</p>
          <p>
            <em>
              {FILE_IMPORT_COPY.recommended}
              <br />
              {FILE_IMPORT_COPY.supported}
            </em>
          </p>
          <div className="file-import-help" role="note">
            <InfoCircleIcon />
            <span>{FILE_IMPORT_COPY.duplicates}</span>
          </div>
          {error ? (
            <p role="alert" className="file-import-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <label className="file-import-check">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => onDontShow(e.target.checked)}
            />
            {FILE_IMPORT_COPY.dontShowAgain}
          </label>
          <button type="button" className="secondary" onClick={onClose}>
            {FILE_IMPORT_COPY.cancel}
          </button>
          <button type="button" className="primary" ref={choose} onClick={onChoose}>
            {FILE_IMPORT_COPY.chooseFile}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
