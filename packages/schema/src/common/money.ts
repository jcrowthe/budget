import { z } from "@hono/zod-openapi";

/** Money is integer milliunits (1000 = one currency unit), never a float. */
export const Milliunits = z.number().int().safe();
