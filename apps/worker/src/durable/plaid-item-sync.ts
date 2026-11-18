import { DurableObject } from "cloudflare:workers";
import type { SyncResult } from "@budget/schema/bank-connections";
import type { Env } from "../env";
import { runSync } from "../services/plaid-sync";

/**
 * One object per Plaid Item: a sync requested while one runs waits for that run and gets its answer, so a
 * connection is never read by two runs at once. It stores nothing (the token is read by each run).
 */
export class PlaidItemSync extends DurableObject<Env> {
  private running: Promise<SyncResult> | null = null;

  override async fetch(request: Request): Promise<Response> {
    let id: unknown;
    let check = false;
    try {
      const body = (await request.json()) as { connection_id?: unknown; check?: unknown };
      id = body.connection_id;
      check = body.check === true;
    } catch {
      id = null;
    }
    if (typeof id !== "string" || id === "") {
      return Response.json({ error: "bad_request" }, { status: 400 });
    }
    this.running ??= runSync(this.env, id, { check }).finally(() => {
      this.running = null;
    });
    try {
      return Response.json(await this.running);
    } catch {
      console.error(`sync failed for connection ${id}`);
      return Response.json({ error: "sync_failed" }, { status: 500 });
    }
  }
}
