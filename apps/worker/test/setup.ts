import { applyD1Migrations, env } from "cloudflare:test";
import { setClock } from "./clock";
import { guardDb } from "./column-guard";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Every test's database refuses a batched or all() select with two columns of one name (see column-guard.ts).
(env as { DB: D1Database }).DB = guardDb(env.DB);

// Clock-ahead guard (EXF-977): in the `worker-clock` project (vitest.clock.config.ts) WORKER_CLOCK is set and every test file runs with the clock pinned there
// (time still runs), so a test that reads a fixed month after a write dated by the real clock fails today,
// not when the calendar month turns. `vitest run` runs the suite there next to the normal project.
const pinned = env.WORKER_CLOCK;
if (pinned) setClock(pinned);
