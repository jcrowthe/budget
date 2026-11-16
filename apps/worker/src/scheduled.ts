import type { Env } from "./env";
import { syncDueConnections } from "./services/plaid-sync";

// TODO: nightly backup Build (export to R2) and scheduled-transactions Build hook in here.
export async function scheduled(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const run = syncDueConnections(env);
  ctx.waitUntil(run);
  await run;
}
