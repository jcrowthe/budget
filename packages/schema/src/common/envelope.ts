import { z } from "@hono/zod-openapi";

// The envelope shapes ({data} / {error:{id,name,detail}}) follow YNAB's public API.
export const ErrorBody = z
  .object({ error: z.object({ id: z.string(), name: z.string(), detail: z.string() }) })
  .openapi("ErrorBody");

export const dataEnvelope = <T extends z.ZodType>(s: T) => z.object({ data: s });
