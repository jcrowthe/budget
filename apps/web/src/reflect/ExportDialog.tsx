import { useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "./icons";

export function ExportDialog({
  onCancel,
  onExport,
}: {
  onCancel: () => void;
  onExport: (dontShowAgain: boolean) => void;
}) {
  const [dont, setDont] = useState(false);
  return createPortal(
    <div className="dialog-backdrop">
      <div className="dialog form export-dialog" role="dialog" aria-label="Export Report">
        <div className="dialog-head">
          <h2>Export Report</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onCancel}>
            <CloseIcon width={20} height={20} />
          </button>
        </div>
        <div className="form-body">
          <p className="export-text">
            Your data is just that—yours! All the requested data will be exported in CSV format so
            it's easy to open in other applications.
          </p>
          <label className="export-check">
            <input type="checkbox" checked={dont} onChange={(e) => setDont(e.target.checked)} />
            Don't show again
          </label>
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => onExport(dont)}>
            Export
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
