import { applyD1Migrations, env } from "cloudflare:test";
import { setClock } from "./clock";
import { guardDb } from "./column-guard";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Every test's database refuses a batched or all() select with two columns of one name (see column-guard.ts).
(env as { DB: D1Database }).DB = guardDb(env.DB);

// Clock-ahead guard (EXF-977): with WORKER_CLOCK=<ISO date> every test file runs with the clock pinned there
// (time still runs), so a test that reads a fixed month after a write dated by the real clock fails today,
// not when the calendar month turns. `pnpm check` runs the suite at 2026-12-15 and 2027-01-15.
const pinned = env.WORKER_CLOCK;
if (pinned) setClock(pinned);
