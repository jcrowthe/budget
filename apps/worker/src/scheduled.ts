import type { Env } from "./env";

// TODO: nightly backup Build (export to R2) and scheduled-transactions Build hook in here.
export async function scheduled(
  _controller: ScheduledController,
  _env: Env,
  _ctx: ExecutionContext,
): Promise<void> {}
