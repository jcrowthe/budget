import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api/client";
import { downloadPlanExport, exportNow } from "../api/plan-export";
import { useSaveUiState, useUiState } from "../api/ui-state";
import { CloseIcon } from "../shell/icons";
import { useDialogFocus } from "./plan-export-dialog-focus";
import "./plan-export-dialog.css";

type Phase = "wait" | "ask" | "working" | "failed";

const returnTo = () => document.querySelector<HTMLElement>(".plan-button, .rail-logo");

/** The plan menu's Export Plan: asks once (unless "Don't show again" was saved), then downloads the zip. */
export function PlanExportDialog({
  budgetId,
  onClose,
}: {
  budgetId: string | null;
  onClose: () => void;
}) {
  const ui = useUiState(budgetId ?? undefined);
  const save = useSaveUiState(budgetId ?? "");
  const [phase, setPhase] = useState<Phase>("wait");
  const [checked, setChecked] = useState(false);
  const [detail, setDetail] = useState("");
  const started = useRef(false);

  const run = () => {
    if (started.current || !budgetId) return;
    started.current = true;
    setPhase("working");
    downloadPlanExport(budgetId, exportNow(new Date())).then(
      () => onClose(),
      (e: unknown) => {
        setDetail(e instanceof ApiError ? e.detail : "");
        setPhase("failed");
      },
    );
  };
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    if (phase !== "wait") return;
    if (ui.isSuccess) {
      if (ui.data.hide_plan_export_dialog) runRef.current();
      else setPhase("ask");
    } else if (ui.isError) setPhase("ask");
  }, [phase, ui.isSuccess, ui.isError, ui.data]);

  if (phase === "wait" || phase === "working") return null;
  return (
    <Frame onClose={onClose}>
      {phase === "ask" ? (
        <>
          <div className="form-body">
            <p>
              Your data is just that—yours! All the requested data will be exported in CSV format so
              it's easy to open in other applications.
            </p>
          </div>
          <div className="dialog-footer">
            <label className="plan-export-dialog-check">
              <input
                type="checkbox"
                checked={checked}
                aria-label="Don't show again"
                onChange={(e) => setChecked(e.target.checked)}
              />
              Don't show again
            </label>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              data-initial
              onClick={() => {
                if (checked) save.mutate({ hide_plan_export_dialog: true });
                run();
              }}
            >
              Export
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="form-body">
            <p role="alert">The plan could not be exported.</p>
            {detail ? <p>{detail}</p> : null}
          </div>
          <div className="dialog-footer">
            <button type="button" className="primary" data-initial onClick={onClose}>
              OK
            </button>
          </div>
        </>
      )}
    </Frame>
  );
}

function Frame({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, { onEscape: onClose, returnTo });
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[data-initial]")?.focus();
  }, []);
  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={box}
        className="dialog form plan-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-export-title"
      >
        <div className="dialog-head">
          <h2 id="plan-export-title">Export Plan</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon width={20} height={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
