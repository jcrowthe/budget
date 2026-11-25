import {
  type FileImportOptions,
  FileImportPreviewResponse,
  type FileImportPreviewResult,
  type FileImportResult,
  FileImportResultResponse,
} from "@budget/schema/file-import";
import { ApiError, apiFetch } from "./client";

const base = (budgetId: string, accountId: string): `/api/v1/${string}` =>
  `/api/v1/budgets/${budgetId}/accounts/${accountId}/imports`;

/**
 * Uploads `file` and gets the stored file's id with the effective options (EXF-531). Multipart: the file part keeps
 * its name; `options` is JSON text. Any non-2xx answer is an ApiError. Never logs.
 */
export async function previewFileImport(
  budgetId: string,
  accountId: string,
  file: File,
  options: Partial<FileImportOptions> & { today: string },
  signal?: AbortSignal,
): Promise<FileImportPreviewResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("options", JSON.stringify(options));
  const res = await fetch(`${base(budgetId, accountId)}/preview`, {
    method: "POST",
    body: form,
    signal,
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // an empty or unreadable body
  }
  if (!res.ok) {
    const e = (body as { error?: { id?: string; name?: string; detail?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      e?.id ?? String(res.status),
      e?.name ?? "error",
      e?.detail ?? res.statusText,
    );
  }
  const parsed = FileImportPreviewResponse.safeParse(body);
  if (!parsed.success)
    throw new ApiError(res.status, String(res.status), "error", "The answer could not be read.");
  return parsed.data.data;
}

/** Imports the stored file with the options; the Worker re-decides every row, so its counts are final. */
export const importFile = async (
  budgetId: string,
  accountId: string,
  fileId: string,
  options: FileImportOptions,
): Promise<FileImportResult> =>
  (
    await apiFetch(base(budgetId, accountId), {
      method: "POST",
      body: { file_id: fileId, options },
      schema: FileImportResultResponse,
      idempotencyKey: crypto.randomUUID(),
    })
  ).data;
