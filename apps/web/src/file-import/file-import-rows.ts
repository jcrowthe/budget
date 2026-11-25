import {
  buildFileRows,
  columnLabels,
  FILE_IMPORT_ERRORS,
  type FileImportContext,
  type FileImportDateQuestion,
  type FileImportOptions,
  type FileImportRow,
} from "@budget/schema/file-import";
import {
  decodeFileText,
  FileImportError,
  type ParsedFile,
  readFileText,
} from "@budget/schema/file-import-read";
import { useEffect, useMemo, useRef, useState } from "react";

/** The file as the browser reads it (the same reader the Worker uses); a bad file throws a FileImportError. */
export async function readLocalFile(file: File): Promise<ParsedFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readFileText(
    file.name,
    decodeFileText(bytes, (b, label) => new TextDecoder(label).decode(b)),
  );
}

/** The words for a file that cannot be read, as the Worker says them. */
export const readErrorText = (e: unknown): string | null =>
  e instanceof FileImportError ? FILE_IMPORT_ERRORS[e.code] : null;

/** Lower-case hex SHA-256 of the text's UTF-8. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The account's cutoffs from the rows the register already holds (the Worker's two queries, read again on import). */
export function cutoffOf(
  importStart: string | null,
  transactions: readonly { date: string; cleared: string; payee_system: string | null }[],
): FileImportContext["cutoff"] {
  let start: string | null = null;
  let reconciled: string | null = null;
  for (const t of transactions) {
    if (t.payee_system === "starting_balance" && (start === null || t.date < start)) start = t.date;
    if (t.cleared === "reconciled" && (reconciled === null || t.date > reconciled))
      reconciled = t.date;
  }
  return { start, reconciled, importStart };
}

export interface FileRows {
  rows: FileImportRow[];
  skippedBefore: number;
  dateQuestion: FileImportDateQuestion | null;
}

/**
 * Builds the file's rows in the browser on every change of the options or the account's cutoffs: no request.
 * The newest answer wins; `null` until the first one.
 */
export function useFileRows(
  parsed: ParsedFile | null,
  options: FileImportOptions | null,
  ctx: FileImportContext | null,
): FileRows | null {
  const [state, setState] = useState<FileRows | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!parsed || !options || !ctx) return;
    const mine = ++seq.current;
    void buildFileRows(parsed, options, ctx, sha256Hex).then((r) => {
      if (seq.current === mine)
        setState({ rows: r.rows, skippedBefore: r.skippedBefore, dateQuestion: r.dateQuestion });
    });
  }, [parsed, options, ctx]);
  return state;
}

/** The labels of the CSV columns, or null for the other formats. */
export function useLabels(parsed: ParsedFile | null, noHeader: boolean): string[] | null {
  return useMemo(
    () => (parsed && "cells" in parsed ? columnLabels(parsed.cells[0] ?? [], noHeader) : null),
    [parsed, noHeader],
  );
}
