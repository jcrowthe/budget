import { env } from "cloudflare:test";
import { json } from "./helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
export type Json = any;

/** POST the undo route: status, parsed body and the Budget-Change-Set header. */
export async function undo(bid: string, setId: string) {
  const res = await json(`/api/v1/budgets/${bid}/changes/${setId}/undo`, { method: "POST" });
  const text = await res.text();
  let body: Json = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, header: res.headers.get("Budget-Change-Set") };
}

/** The change set a write response carries. */
export function setOf(res: Response): string {
  const id = res.headers.get("Budget-Change-Set");
  if (!id) throw new Error("no Budget-Change-Set header");
  return id;
}

const TABLES = [
  "transactions",
  "payees",
  "payee_rename_rules",
  "scheduled_transactions",
  "categories",
  "category_groups",
  "month_categories",
  "targets",
  "accounts",
  "import_tombstones",
  "change_log",
] as const;

/** The row count of every table an undo may touch, for "nothing was written" checks. */
export async function counts(bid: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES) {
    const r = await env.DB.prepare(`select count(*) n from ${t} where budget_id = ?`)
      .bind(bid)
      .first<{ n: number }>();
    out[t] = r?.n ?? 0;
  }
  return out;
}

/** Every column of every row the undo may touch, to prove an refused undo left them alone. */
export async function fingerprint(bid: string): Promise<string> {
  const parts: string[] = [];
  for (const t of TABLES) {
    const { results } = await env.DB.prepare(`select * from ${t} where budget_id = ? order by 1, 2`)
      .bind(bid)
      .all();
    parts.push(JSON.stringify(results));
  }
  return parts.join("|");
}
