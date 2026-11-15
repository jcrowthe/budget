import { drizzle } from "drizzle-orm/d1";
import type { Env } from "../env";

export function getDb(env: Pick<Env, "DB">) {
  return drizzle(env.DB);
}
export type Db = ReturnType<typeof getDb>;
