import {
  DeleteTransactionImageResponse,
  TransactionImageResponse,
} from "@budget/schema/transaction-images";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch } from "./client";

export const transactionImageUrl = (budgetId: string, id: string): `/api/v1/${string}` =>
  `/api/v1/budgets/${budgetId}/transactions/${encodeURIComponent(id)}/image`;

/**
 * Attaches `file` to the transaction (a second upload replaces the image). Multipart, so a raw fetch; any non-2xx
 * answer is an ApiError (413 file_too_large, 415 unsupported_media_type).
 */
export async function uploadTransactionImage(budgetId: string, id: string, file: File) {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(transactionImageUrl(budgetId, id), {
    method: "PUT",
    body: form,
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
  const parsed = TransactionImageResponse.safeParse(body);
  if (!parsed.success)
    throw new ApiError(res.status, String(res.status), "error", "The answer could not be read.");
  return parsed.data.data;
}

/** Not undoable (docs/transaction-images-design.md): no change set is recorded. */
export const deleteTransactionImage = async (budgetId: string, id: string) =>
  (
    await apiFetch(transactionImageUrl(budgetId, id), {
      method: "DELETE",
      schema: DeleteTransactionImageResponse,
    })
  ).data;

/** The name the upload had, from the response's Content-Disposition (`filename*` first). */
export function fileNameFromDisposition(header: string | null): string {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header ?? "")?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {
      // fall through to the plain name
    }
  }
  return /filename="([^"]*)"/i.exec(header ?? "")?.[1] || "transaction-photo";
}

/** Saves the original bytes under the name they were uploaded with. */
export async function downloadTransactionImage(budgetId: string, id: string): Promise<void> {
  const res = await fetch(transactionImageUrl(budgetId, id), { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const fileName = fileNameFromDisposition(res.headers.get("Content-Disposition"));
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

const useInvalidatePlan = (budgetId: string) => {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes(budgetId) });
};

export function useUploadTransactionImage(budgetId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: (v: { id: string; file: File }) => uploadTransactionImage(budgetId, v.id, v.file),
    onSuccess: invalidate,
  });
}

export function useDeleteTransactionImage(budgetId: string) {
  const invalidate = useInvalidatePlan(budgetId);
  return useMutation({
    mutationFn: (id: string) => deleteTransactionImage(budgetId, id),
    onSuccess: invalidate,
  });
}
