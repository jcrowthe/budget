import type { Account } from "@budget/schema/accounts";
import {
  CSV_FIELD_LABELS,
  type CsvField,
  FILE_IMPORT_COPY,
  type FileDateFormat,
  type FileImportContext,
  type FileImportOptions,
  type FileImportRow,
} from "@budget/schema/file-import";
import type { ParsedFile } from "@budget/schema/file-import-read";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../api/client";
import { importFile, previewFileImport } from "../api/file-imports";
import { useAccountTransactions } from "../api/transactions";
import { useDialogFocus } from "../plan-export/plan-export-dialog-focus";
import { localToday } from "../register/format";
import { CloseIcon } from "../shell/icons";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { FileImportDate } from "./file-import-date";
import {
  cutoffOf,
  type FileRows,
  readErrorText,
  readLocalFile,
  useFileRows,
  useLabels,
} from "./file-import-rows";
import "./file-import.css";

/** The ticket's wording: always plural, where FI-1's copy singularises a single row. */
const SKIP_COPY = {
  willSkip: (n: number) => `${n} transactions will be skipped`,
  include: (n: number) =>
    `Include ${n} transactions dated before account start date or last reconciliation`,
};

const CSV_FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[];
const ASCII = (s: string) => s.replace("−", "-");

/** Dialog 2: the header with its account, the mapping, the options, the skipped note and the live preview. */
export function FileImportPreview({
  budgetId,
  file,
  accounts,
  initialAccountId,
  onFailed,
  onClose,
  onDone,
  returnTo,
}: {
  budgetId: string;
  file: File;
  accounts: Account[];
  initialAccountId: string;
  /** The file cannot be read or uploaded: back to dialog 1 with the words. */
  onFailed: (message: string) => void;
  onClose: () => void;
  onDone: (result: { imported: number; matched: number; skipped: number }) => void;
  returnTo: () => HTMLElement | null;
}) {
  const qc = useQueryClient();
  const fmt = usePlanFormatter();
  const [today] = useState(localToday);
  const [target, setTarget] = useState(initialAccountId);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [options, setOptions] = useState<FileImportOptions | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const failed = useRef(onFailed);
  failed.current = onFailed;

  // The first read: the browser's own parse for the instant preview, the Worker's upload for the file id and the
  // options it settled on (remembered settings, the mapping it used).
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per file; the account is changed below
  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const [parsed, up] = await Promise.all([
          readLocalFile(file),
          previewFileImport(budgetId, initialAccountId, file, { today }, ctl.signal),
        ]);
        const pinned =
          up.options.mapping === null && up.mapping !== null
            ? { ...up.options, mapping: up.mapping }
            : up.options;
        setParsed(parsed);
        setOptions(pinned);
        setFileId(up.file_id);
      } catch (e) {
        if (ctl.signal.aborted) return;
        const detail =
          e instanceof ApiError ? e.detail : (readErrorText(e) ?? "The file could not be read.");
        failed.current(`This file cannot be imported: ${detail}`);
      }
    })();
    return () => ctl.abort();
  }, [file]);

  const isCsv = parsed !== null && "cells" in parsed;
  const labels = useLabels(parsed, options?.no_header ?? false);

  // The target account's cutoffs, read from the rows the register holds.
  const account = accounts.find((a) => a.id === target);
  const txs = useAccountTransactions(budgetId, target);
  const ctx = useMemo<FileImportContext | null>(() => {
    if (!txs.data) return null;
    return {
      today,
      cutoff: cutoffOf(account?.import_start_date ?? null, txs.data.transactions),
      accountId: target,
      planFormat: fmt.dateFormat,
    };
  }, [txs.data, account?.import_start_date, target, today, fmt.dateFormat]);
  const built: FileRows | null = useFileRows(parsed, options, ctx);

  const kept = useMemo(() => (built ? built.rows.filter((r) => r.skip === null) : []), [built]);
  const n = kept.length;

  const edit = (patch: Partial<FileImportOptions>) =>
    setOptions((o) => (o ? { ...o, ...patch } : o));
  const setField = (field: CsvField, value: string) =>
    setOptions((o) =>
      o?.mapping
        ? { ...o, mapping: { ...o.mapping, [field]: value === "" ? null : Number(value) } }
        : o,
    );

  // A new account: the same file is uploaded again for it (the stored file belongs to one account).
  const changeAccount = async (id: string) => {
    if (!options || id === target) return;
    setTarget(id);
    setFileId(null);
    setError(null);
    const mine = ++seq.current;
    try {
      const up = await previewFileImport(budgetId, id, file, { ...options, today });
      if (seq.current === mine) setFileId(up.file_id);
    } catch (e) {
      if (seq.current === mine)
        setError(e instanceof ApiError ? e.detail : "The file could not be sent.");
    }
  };

  const reupload = async (): Promise<void> => {
    if (!options) return;
    const mine = ++seq.current;
    setFileId(null);
    const up = await previewFileImport(budgetId, target, file, { ...options, today });
    if (seq.current === mine) setFileId(up.file_id);
  };

  const run = async () => {
    if (!options || !fileId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importFile(budgetId, target, fileId, { ...options, today });
      await qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
      onDone(res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        try {
          await reupload();
          setError("The file was uploaded again; press Import again.");
        } catch {
          setError("The file could not be sent. Check the connection and try again.");
        }
      } else setError(e instanceof ApiError ? e.detail : "The connection failed.");
      setBusy(false);
    }
  };

  const loading = !parsed || !options || !built;
  const canImport = !loading && !busy && fileId !== null && built.dateQuestion === null && n > 0;

  useDialogFocus(box, {
    onEscape: () => (popOpen ? setPopOpen(false) : onClose()),
    returnTo,
    initial: cancel,
  });

  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        className="dialog form file-import-dialog file-import-dialog-two"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-import-two-title"
      >
        <div className="dialog-head">
          <h2 id="file-import-two-title">{FILE_IMPORT_COPY.title}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <CloseIcon width={16} height={16} />
          </button>
        </div>
        <div className="form-body file-import-body file-import-body-two">
          {loading ? (
            <p role="status">Reading the file…</p>
          ) : (
            <>
              <div className="file-import-header">
                <span>{FILE_IMPORT_COPY.header(n, file.name)}</span>
                <select
                  aria-label="Account"
                  value={target}
                  onChange={(e) => void changeAccount(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              {isCsv && labels ? (
                <div className="file-import-mapping">
                  <p className="file-import-help-text">{FILE_IMPORT_COPY.mappingHelp}</p>
                  <div className="file-import-selects">
                    {CSV_FIELDS.map((f) => (
                      <div key={f} className="file-import-select">
                        <div className="file-import-select-head">
                          <label htmlFor={`file-import-${f}`}>
                            {FILE_IMPORT_COPY.selectLabels[f]}
                          </label>
                          {f === "date" && built.dateQuestion ? (
                            <FileImportDate
                              fileName={file.name}
                              question={built.dateQuestion}
                              open={popOpen}
                              onOpen={setPopOpen}
                              onSave={(format: FileDateFormat) => {
                                edit({ date_format: format });
                                setPopOpen(false);
                              }}
                            />
                          ) : null}
                        </div>
                        <select
                          id={`file-import-${f}`}
                          value={String(options.mapping?.[f] ?? "")}
                          onChange={(e) => setField(f, e.target.value)}
                        >
                          <option value="" />
                          {labels.map((l, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: the column index is the value
                            <option key={i} value={String(i)}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="file-import-preview-head">
                  <h3>{FILE_IMPORT_COPY.preview}</h3>
                  {built.dateQuestion ? (
                    <FileImportDate
                      fileName={file.name}
                      question={built.dateQuestion}
                      open={popOpen}
                      onOpen={setPopOpen}
                      onSave={(format: FileDateFormat) => {
                        edit({ date_format: format });
                        setPopOpen(false);
                      }}
                    />
                  ) : null}
                </div>
              )}
              <div className="file-import-table-wrap">
                <PreviewTable rows={kept} csv={isCsv} fmt={fmt} />
              </div>
              <fieldset className="file-import-options">
                <legend className="file-import-sr">Options</legend>
                {isCsv ? (
                  <Check
                    label={FILE_IMPORT_COPY.noHeaderRow}
                    checked={options.no_header}
                    onChange={(v) => edit({ no_header: v })}
                  />
                ) : (
                  <>
                    <Check
                      label={FILE_IMPORT_COPY.importMemos}
                      checked={options.import_memos}
                      onChange={(v) => edit({ import_memos: v })}
                    />
                    <Check
                      label={FILE_IMPORT_COPY.swapPayeeMemo}
                      checked={options.swap_payee_memo}
                      onChange={(v) => edit({ swap_payee_memo: v })}
                    />
                  </>
                )}
                <Check
                  label={FILE_IMPORT_COPY.swapInflowOutflow}
                  checked={options.swap_inflow_outflow}
                  onChange={(v) => edit({ swap_inflow_outflow: v })}
                />
                <Check
                  label={FILE_IMPORT_COPY.remember}
                  checked={options.remember}
                  onChange={(v) => edit({ remember: v })}
                />
              </fieldset>
              {built.skippedBefore > 0 ? (
                <div className="file-import-skipped">
                  <button
                    type="button"
                    className="file-import-skip-toggle"
                    aria-expanded={skipOpen}
                    onClick={() => setSkipOpen((v) => !v)}
                  >
                    {SKIP_COPY.willSkip(built.skippedBefore)} {skipOpen ? "▾" : "▸"}
                  </button>
                  {skipOpen ? <p>{FILE_IMPORT_COPY.skipExplanation}</p> : null}
                  <Check
                    label={SKIP_COPY.include(built.skippedBefore)}
                    checked={options.include_before_start}
                    onChange={(v) => edit({ include_before_start: v })}
                  />
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="file-import-error">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" ref={cancel} onClick={onClose}>
            {FILE_IMPORT_COPY.cancel}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canImport}
            onClick={() => void run()}
          >
            {FILE_IMPORT_COPY.import}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="file-import-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function PreviewTable({
  rows,
  csv,
  fmt,
}: {
  rows: FileImportRow[];
  csv: boolean;
  fmt: ReturnType<typeof usePlanFormatter>;
}) {
  const cols = FILE_IMPORT_COPY.columns;
  return (
    <table className="file-import-table" aria-label={csv ? "Preview" : undefined}>
      <thead>
        <tr>
          {csv ? (
            <>
              <th className="file-import-sr">Date</th>
              <th className="file-import-sr">Payee</th>
              <th className="file-import-sr">Memo</th>
              <th className="file-import-sr">Amount</th>
            </>
          ) : (
            <>
              <th>{cols.date}</th>
              <th>{cols.payee}</th>
              <th>{cols.memo}</th>
              <th className="num">{cols.outflow}</th>
              <th className="num">{cols.inflow}</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.line}>
            <td>{r.date ? fmt.date(r.date) : ""}</td>
            <td>{r.payee_text}</td>
            <td>{r.memo ?? ""}</td>
            {csv ? (
              <td className="num">{r.amount === null ? "" : ASCII(fmt.signed(r.amount))}</td>
            ) : (
              <>
                <td className="num">
                  {r.amount !== null && r.amount < 0 ? fmt.abs(r.amount) : ""}
                </td>
                <td className="num">
                  {r.amount !== null && r.amount > 0 ? fmt.abs(r.amount) : ""}
                </td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
