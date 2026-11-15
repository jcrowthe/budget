import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";

/** One object per Plaid Item. Stub: the sync Build fills it in. */
export class PlaidItemSync extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return new Response("Not implemented", { status: 501 });
  }
}
