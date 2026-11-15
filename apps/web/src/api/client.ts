import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly id: string,
    readonly errorName: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

/** The web app calls only /api/v1; the zod schemas come from @budget/schema (shared with the Worker). */
export async function apiFetch<S extends z.ZodType>(
  path: `/api/v1/${string}`,
  opts: { method?: string; body?: unknown; idempotencyKey?: string; schema: S },
): Promise<z.infer<S>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: "same-origin",
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { id?: string; name?: string; detail?: string } } | null)?.error;
    throw new ApiError(
      res.status,
      e?.id ?? String(res.status),
      e?.name ?? "error",
      e?.detail ?? res.statusText,
    );
  }
  return opts.schema.parse(data);
}
