import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const Institution = z
  .object({
    institution_id: z.string(),
    name: z.string(),
    country: z.string(),
    url: z.string().nullable(),
    logo: z.string().nullable().openapi({ description: "PNG data URL, or null" }),
  })
  .openapi("Institution");

export const InstitutionSearchQuery = z.object({
  budget_id: z.uuid(),
  query: z.string().trim().min(1).max(100),
});
export const PopularQuery = z.object({ budget_id: z.uuid() });

export const InstitutionListResponse = dataEnvelope(
  z.object({ institutions: z.array(Institution) }),
).openapi("InstitutionListResponse");

export type Institution = z.infer<typeof Institution>;
