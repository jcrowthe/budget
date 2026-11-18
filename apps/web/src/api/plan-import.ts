import {
  PlanImportCancelResponse,
  type PlanImportCancelResult,
  type PlanImportOptions,
  type PlanImportPreview,
  PlanImportPreviewResponse,
  type PlanImportResult,
  PlanImportResultResponse,
} from "@budget/schema/plan-import";
import { ApiError } from "./client";

const BASE = "/api/v1/budgets/import";

/** The multipart body of an import: the files as `file` parts, the options as text fields (JSON for objects). */
export function importForm(files: readonly File[], options: PlanImportOptions): FormData {
  const form = new FormData();
  for (const f of files) form.append("file", f, f.name);
  if (options.name !== undefined) form.append("name", options.name);
  if (options.export_date !== undefined) form.append("export_date", options.export_date);
  if (options.date_format !== undefined) form.append("date_format", options.date_format);
  if (options.currency_format !== undefined)
    form.append("currency_format", JSON.stringify(options.currency_format));
  if (options.account_types !== undefined)
    form.append("account_types", JSON.stringify(options.account_types));
  return form;
}

/** Sends the request and reads a 2xx answer with `schema`; anything else is an ApiError. Never logs. */
async function send<T>(
  url: string,
  init: RequestInit,
  schema: { safeParse(v: unknown): { success: true; data: { data: T } } | { success: false } },
): Promise<T> {
  const res = await fetch(url, {
    ...init,
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
    if (e)
      throw new ApiError(
        res.status,
        e.id ?? String(res.status),
        e.name ?? "error",
        e.detail ?? res.statusText,
      );
    throw new ApiError(res.status, String(res.status), "error", res.statusText);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(res.status, String(res.status), "error", "The answer could not be read.");
  return parsed.data.data;
}

export const previewImport = (
  files: readonly File[],
  options: PlanImportOptions,
  signal?: AbortSignal,
): Promise<PlanImportPreview> =>
  send(
    `${BASE}?dry_run=true`,
    { method: "POST", body: importForm(files, options), signal },
    PlanImportPreviewResponse,
  );

export const startImport = (
  files: readonly File[],
  options: PlanImportOptions,
): Promise<PlanImportResult> =>
  send(BASE, { method: "POST", body: importForm(files, options) }, PlanImportResultResponse);

export const continueImport = (importId: string): Promise<PlanImportResult> =>
  send(
    `${BASE}/${encodeURIComponent(importId)}/continue`,
    { method: "POST" },
    PlanImportResultResponse,
  );

export const cancelImport = (importId: string): Promise<PlanImportCancelResult> =>
  send(`${BASE}/${encodeURIComponent(importId)}`, { method: "DELETE" }, PlanImportCancelResponse);
