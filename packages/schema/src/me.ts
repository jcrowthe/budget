import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const Me = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), email: z.string() }),
    z.object({ kind: z.literal("service"), name: z.string() }),
  ])
  .openapi("Me", {
    description: "Who is signed in: a user (email) or a service token (its name).",
  });
export const MeResponse = dataEnvelope(Me).openapi("MeResponse");
export type Me = z.infer<typeof Me>;
