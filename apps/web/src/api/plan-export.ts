import { ApiError } from "./client";

const two = (n: number) => String(n).padStart(2, "0");

/** The browser's local minute as the export's `now`: "YYYY-MM-DDTHH:mm". */
export function exportNow(at: Date): string {
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
}

/** GET /api/v1/budgets/{id}/export?now=…; saves the zip under the server's file name and returns it. */
export async function downloadPlanExport(budgetId: string, now: string): Promise<string> {
  const res = await fetch(`/api/v1/budgets/${budgetId}/export?now=${encodeURIComponent(now)}`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    let id = String(res.status);
    let name = "error";
    let detail = res.statusText;
    try {
      const body = (await res.json()) as {
        error?: { id?: string; name?: string; detail?: string };
      };
      if (body.error) {
        id = body.error.id ?? id;
        name = body.error.name ?? name;
        detail = body.error.detail ?? detail;
      }
    } catch {
      // not JSON: keep the status text
    }
    throw new ApiError(res.status, id, name, detail);
  }
  const fileName =
    /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ??
    "Budget Export.zip";
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return fileName;
}
