import { applyD1Migrations, env } from "cloudflare:test";
import { guardDb } from "./column-guard";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Every test's database refuses a batched or all() select with two columns of one name (see column-guard.ts).
(env as { DB: D1Database }).DB = guardDb(env.DB);
