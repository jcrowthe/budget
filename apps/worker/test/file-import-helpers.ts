import { env } from "cloudflare:test";
import { expect } from "vitest";
import type { Env } from "../src/env";
import { account, actor, DAY, type Json, plan, q, send, tx } from "./bulk-helpers";
import { authed, call, json } from "./helpers";

export { account, actor, DAY, type Json, plan, q, send, tx };

const fixtures = import.meta.glob<string>("../../../packages/schema/test/fixtures/file-import/*", {
  eager: true,
  query: "?raw",
  import: "default",
});

/** A fixture of packages/schema/test/fixtures/file-import, as text. */
export function fixture(name: string): string {
  const t = fixtures[`../../../packages/schema/test/fixtures/file-import/${name}`];
  if (t === undefined) throw new Error(`no fixture ${name}`);
  return t;
}

export const TODAY = "2026-11-24";
export const base = (bid: string, aid: string) => `/api/v1/budgets/${bid}/accounts/${aid}/imports`;

export const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** `n` rows with distinct payees (`ZZ-TEST Vendor <i>`), dated in November 2026, amounts all different. */
export function rowsCsv(n: number, prefix = "ZZ-TEST Vendor"): string {
  const lines = ["Date,Payee,Memo,Outflow,Inflow"];
  for (let i = 0; i < n; i++) {
    const day = String((i % 20) + 10).padStart(2, "0");
    lines.push(`11/${day}/2026,${prefix} ${i},memo ${i},${(i + 1) / 100 + 1000},`);
  }
  return lines.join("\n");
}

export function previewReq(
  bid: string,
  aid: string,
  fileName: string,
  text: string | Uint8Array,
  options?: Json,
  envOverride: Partial<Env> = {},
) {
  const form = new FormData();
  form.set("file", new File([text as unknown as ArrayBuffer], fileName));
  if (options !== undefined) form.set("options", JSON.stringify(options));
  return authed({ method: "POST", body: form }).then((init) =>
    call(`${base(bid, aid)}/preview`, init, envOverride),
  );
}

export async function preview(
  bid: string,
  aid: string,
  fileName: string,
  text: string,
  options?: Json,
  envOverride: Partial<Env> = {},
): Promise<Json> {
  const res = await previewReq(bid, aid, fileName, text, options, envOverride);
  const body = (await res.json()) as Json;
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

export const importReq = (bid: string, aid: string, body: Json, envOverride: Partial<Env> = {}) =>
  authed({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((init) => call(base(bid, aid), init, envOverride));

export async function importOk(
  bid: string,
  aid: string,
  fileId: string,
  options: Json = {},
  envOverride: Partial<Env> = {},
): Promise<Json> {
  const res = await importReq(
    bid,
    aid,
    { file_id: fileId, options: { today: TODAY, ...options } },
    envOverride,
  );
  const body = (await res.json()) as Json;
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.data;
}

/** Preview, then import, a file text; returns { result, preview }. */
export async function importText(
  bid: string,
  aid: string,
  fileName: string,
  text: string,
  options: Json = {},
  envOverride: Partial<Env> = {},
) {
  const p = await preview(bid, aid, fileName, text, { today: TODAY, ...options }, envOverride);
  const result = await importOk(bid, aid, p.file_id, options, envOverride);
  return { result, preview: p };
}

/** An account whose Starting Balance is dated `date` (default 2026-11-10). */
export async function accountOn(bid: string, balance: number, date = DAY, type = "checking") {
  const res = await send(`/api/v1/budgets/${bid}/accounts`, "POST", {
    name: `ZZ ${crypto.randomUUID().slice(0, 8)}`,
    type,
    balance,
    date,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.account.id as string;
}

export const rowsOf = (aid: string) =>
  q(
    "select * from transactions where account_id = ? and deleted_at is null order by date, created_at, id",
    aid,
  );

export const getAccount = async (bid: string, aid: string): Promise<Json> =>
  ((await (await json(`/api/v1/budgets/${bid}/accounts/${aid}`)).json()) as Json).data.account;

export const rtaOf = async (bid: string, month = "2026-11-01"): Promise<number> =>
  ((await (await json(`/api/v1/budgets/${bid}/months/${month}`)).json()) as Json).data
    .ready_to_assign;

/** The plan's change_log rows of one entity type, oldest first. */
export const logRows = (bid: string, entityType: string) =>
  q(
    "select * from change_log where budget_id = ? and entity_type = ? order by rowid",
    bid,
    entityType,
  );

export const countLogs = async (bid: string) =>
  (await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n as number;

/** The plan's categories ZZ-TEST Groceries / Fun / Phone, in a new group. */
export async function cats(bid: string): Promise<Record<string, string>> {
  const g = (
    (await (
      await send(`/api/v1/budgets/${bid}/category_groups`, "POST", { name: "ZZ-TEST G" })
    ).json()) as Json
  ).data.category_group;
  const ids: Record<string, string> = {};
  for (const name of ["Groceries", "Fun", "Phone"]) {
    const res = await send(`/api/v1/budgets/${bid}/categories`, "POST", {
      group_id: g.id,
      name: `ZZ-TEST ${name}`,
    });
    ids[name] = ((await res.json()) as Json).data.category.id as string;
  }
  return ids;
}

export const payeeList = async (bid: string): Promise<Json[]> =>
  ((await (await json(`/api/v1/budgets/${bid}/payees?include_hidden=true`)).json()) as Json).data
    .payees;

export const r2Keys = async (prefix = "file-imports/"): Promise<string[]> =>
  (await env.FILES.list({ prefix })).objects.map((o) => o.key);

export const setSqlOf = (id: string, set: string) =>
  q(`update transactions set ${set} where id = ?`, id);
