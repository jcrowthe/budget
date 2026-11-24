import type {
  DateQuestion,
  ImportAccountType,
  PlanImportOptions,
  PlanImportPreview,
} from "@budget/schema/plan-import";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlocker, useNavigate } from "react-router";
import { ApiError } from "../api/client";
import { previewImport } from "../api/plan-import";
import { useDialogFocus } from "../plan-export/plan-export-dialog-focus";
import { CloseIcon } from "../shell/icons";
import { PlanImportDrop } from "./plan-import-dialog-drop";
import { checkImportFiles } from "./plan-import-dialog-files";
import { previewFormatter } from "./plan-import-dialog-format";
import { latestOnly } from "./plan-import-dialog-latest";
import { Counts, Notes } from "./plan-import-dialog-notes";
import { PlanImportPreviewBody } from "./plan-import-dialog-preview";
import { type RunStep, useImportRun } from "./plan-import-dialog-run";
import "./plan-import-dialog.css";

type Step =
  | { kind: "file"; error: string | null }
  | { kind: "reading" }
  | { kind: "preview"; updating: boolean; error: string | null; startFailed?: boolean }
  | RunStep;

type Confirm = "cancel" | "close" | "leave" | null;

const KEEP_OPEN =
  "Keep this page open until the import finishes. If it stops, the new plan never appears and what was written is removed later.";

/** The Import Plan dialog: file, preview with its edits, import with progress, result. */
export function PlanImportDialog({
  onClose,
  returnTo,
}: {
  onClose: () => void;
  returnTo: () => HTMLElement | null;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>({ kind: "file", error: null });
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<PlanImportPreview | null>(null);
  const [question, setQuestion] = useState<DateQuestion | null>(null);
  const [options, setOptions] = useState<PlanImportOptions>({});
  const [name, setName] = useState("");
  const [exportText, setExportText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [cancelling, setCancelling] = useState(false);
  const latest = useRef(latestOnly());
  const box = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLButtonElement>(null);
  const readSeq = useRef(0);

  const fmt = useMemo(() => (preview ? previewFormatter(preview.formats) : null), [preview]);

  const run = useImportRun(
    useCallback((s: RunStep) => setStep(s), []),
    useCallback(
      (detail: string) =>
        setStep({ kind: "preview", updating: false, error: detail, startFailed: true }),
      [],
    ),
  );
  const active = step.kind === "writing" || step.kind === "failed";

  const applyPreview = (p: PlanImportPreview, first: boolean) => {
    setPreview(p);
    if (first) {
      setName(p.name);
      if (p.date_question) setQuestion(p.date_question);
    }
    setExportText(previewFormatter(p.formats).date(p.export_date));
    setExportError(null);
  };

  const refresh = async (next: PlanImportOptions) => {
    setOptions(next);
    const { seq, signal } = latest.current.next();
    setStep({ kind: "preview", updating: true, error: null });
    try {
      const p = await previewImport(files, next, signal);
      if (!latest.current.isLatest(seq)) return;
      applyPreview(p, false);
      setStep({ kind: "preview", updating: false, error: null });
    } catch (e) {
      if (!latest.current.isLatest(seq) || signal.aborted) return;
      setStep({
        kind: "preview",
        updating: false,
        error: e instanceof ApiError ? e.detail : "The connection failed.",
      });
    }
  };

  const choose = async (list: File[]) => {
    const check = checkImportFiles(list);
    if (!check.ok) {
      setStep({ kind: "file", error: check.message });
      return;
    }
    setFiles(list);
    setOptions({});
    setQuestion(null);
    setStep({ kind: "reading" });
    const { seq, signal } = latest.current.next();
    readSeq.current = seq;
    try {
      const p = await previewImport(list, {}, signal);
      if (!latest.current.isLatest(seq)) return;
      applyPreview(p, true);
      setStep({ kind: "preview", updating: false, error: null });
    } catch (e) {
      if (!latest.current.isLatest(seq) || signal.aborted) return;
      setStep({
        kind: "file",
        error:
          e instanceof ApiError
            ? `This file cannot be imported: ${e.detail}`
            : "The files could not be sent. Check the connection and try again.",
      });
    }
  };

  // Edits: the latest answer wins; an older one is aborted and ignored.
  const editType = (account: string, type: ImportAccountType) => {
    if (!preview) return;
    const all = Object.fromEntries(preview.accounts.map((a) => [a.name, a.type]));
    void refresh({
      ...options,
      account_types: { ...all, ...options.account_types, [account]: type },
    });
  };
  const editDateFormat = (format: string) =>
    void refresh({ ...options, date_format: format as PlanImportOptions["date_format"] });
  const editCurrency = (patch: NonNullable<PlanImportOptions["currency_format"]>) => {
    if (!preview) return;
    const f = preview.formats;
    void refresh({
      ...options,
      currency_format: {
        currency_symbol: f.currency_symbol,
        symbol_placement: f.symbol_placement,
        decimal_separator: f.decimal_separator as NonNullable<
          PlanImportOptions["currency_format"]
        >["decimal_separator"],
        ...options.currency_format,
        ...patch,
      },
    });
  };
  const exportBlur = () => {
    if (!preview || !fmt) return;
    const iso = fmt.parseDate(exportText, preview.export_date);
    if (!iso) {
      setExportError(`Use the date format ${preview.formats.date_format}.`);
      return;
    }
    setExportError(null);
    if (iso !== preview.export_date) void refresh({ ...options, export_date: iso });
  };

  const canImport =
    step.kind === "preview" &&
    !step.updating &&
    (!step.error || step.startFailed === true) &&
    preview !== null &&
    preview.date_question === null &&
    name.trim() !== "" &&
    exportError === null &&
    fmt?.parseDate(exportText, preview.export_date) != null;

  const startImport = () => {
    if (!preview || !fmt) return;
    const iso = fmt.parseDate(exportText, preview.export_date) ?? preview.export_date;
    setStep({ kind: "writing", result: pendingResult(preview) });
    void run.start(files, { ...options, name: name.trim(), export_date: iso });
  };

  // Closing, escaping and leaving.
  const closeAsked = () => {
    if (cancelling || confirm) return;
    if (active) setConfirm("close");
    else if (step.kind === "reading") {
      latest.current.next();
      onClose();
    } else onClose();
  };
  const yes = async () => {
    const was = confirm;
    setConfirm(null);
    setCancelling(true);
    const outcome = await run.cancel();
    setCancelling(false);
    const gone = outcome === "cancelled" || outcome === "none";
    if (was === "close" && gone) onClose();
    else if (was === "leave") {
      if (gone) blocker.proceed?.();
      else blocker.reset?.();
    }
  };
  const blocker = useBlocker(active);
  useEffect(() => {
    if (blocker.state === "blocked") setConfirm("leave");
  }, [blocker.state]);
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
  const keepGoing = () => {
    const was = confirm;
    setConfirm(null);
    if (was === "leave") blocker.reset?.();
  };

  useDialogFocus(box, { onEscape: closeAsked, returnTo, initial: drop });
  // A step that removes the focused control must not leave the focus outside the dialog.
  const kind = step.kind;
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each change of step
  useEffect(() => {
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>("[data-initial]") ?? el).focus({ preventScroll: true });
    }
  }, [kind, confirm]);

  const result = step.kind === "done" ? step.result : null;
  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="dialog form plan-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-import-title"
      >
        <div className="dialog-head">
          <h2 id="plan-import-title">Import Plan</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={closeAsked}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className="form-body plan-import-dialog-body">
          {step.kind === "file" ? (
            <PlanImportDrop onFiles={(l) => void choose(l)} error={step.error} buttonRef={drop} />
          ) : null}
          {step.kind === "reading" ? <p role="status">Reading the files…</p> : null}
          {step.kind === "preview" && preview && fmt ? (
            <PlanImportPreviewBody
              preview={preview}
              question={question}
              fmt={fmt}
              chosenDateFormat={options.date_format}
              name={name}
              onName={setName}
              exportText={exportText}
              onExportText={setExportText}
              exportError={exportError}
              onExportBlur={exportBlur}
              updating={step.updating}
              error={step.error}
              onType={editType}
              onDateFormat={editDateFormat}
              onCurrency={editCurrency}
            />
          ) : null}
          {step.kind === "writing" || step.kind === "failed" ? <Progress step={step} /> : null}
          {step.kind === "ended" ? (
            <p role="alert" className="plan-import-dialog-error">
              {step.detail} Nothing was kept.
            </p>
          ) : null}
          {step.kind === "cancelled" ? (
            <p role="status">The import was cancelled. Nothing was kept.</p>
          ) : null}
          {result?.summary ? (
            <>
              <p role="status" className="plan-import-dialog-done">
                Imported {result.summary.name}.
              </p>
              <Counts counts={result.summary.counts} />
              <Notes summary={result.summary} fmt={previewFormatter(result.summary.formats)} />
            </>
          ) : null}
          {cancelling ? <p role="status">Cancelling…</p> : null}
          {confirm ? (
            <p role="alert" className="plan-import-dialog-confirm">
              Cancel this import? Everything written so far is removed.
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          {cancelling ? null : confirm ? (
            <>
              <button type="button" className="secondary" data-initial onClick={keepGoing}>
                Keep importing
              </button>
              <button type="button" className="primary" onClick={() => void yes()}>
                Cancel import
              </button>
            </>
          ) : step.kind === "file" || step.kind === "reading" ? (
            <button type="button" className="secondary" onClick={closeAsked}>
              Cancel
            </button>
          ) : step.kind === "preview" ? (
            <>
              <button type="button" className="secondary" onClick={closeAsked}>
                Cancel
              </button>
              <button type="button" className="primary" disabled={!canImport} onClick={startImport}>
                Import
              </button>
            </>
          ) : step.kind === "writing" ? (
            <button
              type="button"
              className="secondary"
              disabled={step.result.import_id === ""}
              onClick={() => setConfirm("cancel")}
            >
              Cancel import
            </button>
          ) : step.kind === "failed" ? (
            <>
              <button type="button" className="secondary" onClick={() => setConfirm("cancel")}>
                Cancel import
              </button>
              <button
                type="button"
                className="primary"
                data-initial
                onClick={() => void run.retry()}
              >
                Try again
              </button>
            </>
          ) : step.kind === "ended" ? (
            <>
              <button type="button" className="secondary" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="primary"
                data-initial
                onClick={() => setStep({ kind: "file", error: null })}
              >
                Choose another file
              </button>
            </>
          ) : step.kind === "cancelled" ? (
            <button type="button" className="primary" data-initial onClick={onClose}>
              Close
            </button>
          ) : (
            <>
              <button type="button" className="secondary" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="primary"
                data-initial
                onClick={() => {
                  const id = result?.budget_id;
                  onClose();
                  if (id) navigate(`/${id}/budget`);
                }}
              >
                Open Plan
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** What the writing step shows before the first answer: no progress yet. */
function pendingResult(p: PlanImportPreview) {
  return {
    import_id: "",
    state: "writing" as const,
    budget_id: null,
    progress: { chunks_done: 0, chunk_count: 0 },
    summary: p,
  };
}

/**
 * The bar's fill: the steps done plus half of the one in progress, so "Writing step 1 of 3" already shows a
 * started bar (16%), never past the end; a few pixels at least. `aria-valuenow` stays the true count.
 */
function fillStyle(done: number, count: number) {
  if (count === 0) return { width: "0%" };
  const part = Math.min(done + 0.5, count);
  return { width: `${(part / count) * 100}%`, minWidth: 8 };
}

function Progress({ step }: { step: Extract<Step, { kind: "writing" | "failed" }> }) {
  const { chunks_done: done, chunk_count: count } = step.result.progress;
  return (
    <>
      <p role="status" className="plan-import-dialog-step">
        {count === 0
          ? "Starting the import…"
          : `Writing step ${Math.min(done + 1, count)} of ${count}`}
      </p>
      <div
        className="plan-import-dialog-bar"
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuenow={done}
        aria-valuemax={count}
      >
        <div style={fillStyle(done, count)} />
      </div>
      {step.kind === "failed" ? (
        <p role="alert" className="plan-import-dialog-error">
          This step could not be written: {step.detail}
        </p>
      ) : (
        <p className="plan-import-dialog-more">{KEEP_OPEN}</p>
      )}
    </>
  );
}
