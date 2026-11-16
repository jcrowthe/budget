import { env } from "cloudflare:test";
import { expect } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
export type Json = any;

export const base = (bid: string) => `/api/v1/budgets/${bid}`;
export const send = (method: string, url: string, body?: unknown) => json(url, { method }, body);
export const data = async (res: Response) => ((await res.json()) as Json).data;
export const TODAY = "today=2026-11-15";
export const MAY_NOV = `start_month=2026-05-01&end_month=2026-11-01&${TODAY}`;
export const JUN_NOV = `start_month=2026-06-01&end_month=2026-11-01&${TODAY}`;

export async function plan() {
  return (
    await createBudget(env, "user:tester@localhost", { name: `ZZ-TEST ${crypto.randomUUID()}` })
  ).id;
}
export async function account(
  bid: string,
  name: string,
  type: string,
  balance: number,
  date: string,
) {
  const res = await send("POST", `${base(bid)}/accounts`, { name, type, balance, date });
  expect(res.status).toBe(201);
  return (await data(res)).account.id as string;
}
export async function post(bid: string, body: unknown) {
  const res = await send("POST", `${base(bid)}/transactions`, body);
  expect(res.status).toBe(201);
  return (await data(res)).transaction as Json;
}
/** Creates the group and its categories; the plan order is the order given. */
export async function group(bid: string, name: string, cats: string[]) {
  const g = (await data(await send("POST", `${base(bid)}/category_groups`, { name })))
    .category_group;
  const ids: Record<string, string> = {};
  // A new category goes first in its group: create them last to first so the listed order is the plan order.
  for (const c of [...cats].reverse()) {
    const res = await send("POST", `${base(bid)}/categories`, { group_id: g.id, name: c });
    expect(res.status).toBe(201);
    ids[c] = (await data(res)).category.id;
  }
  return { id: g.id as string, ids };
}

export const SB_ORDER = ["D8 Food", "D8 Fun", "D8 Utilities", "D8 Loan Pmt", "D8 Hidden"];
/** The order of the EXF-552 worked table. */
export const IE_ORDER = ["D8 Hidden", "D8 Loan Pmt", "D8 Utilities", "D8 Fun", "D8 Food"];

/** The EXF-550 / EXF-552 example (today 2026-11-15); `order` is the plan order of the categories. */
export async function examplePlan(o: { order?: string[] } = {}) {
  const bid = await plan();
  const g = await group(bid, "D8 Group", o.order ?? SB_ORDER);
  const sav = await account(bid, "D8 Savings", "savings", 500000, "2026-05-15");
  const chk = await account(bid, "D8 Checking", "checking", 2000000, "2026-06-01");
  const loan = await account(bid, "D8 Car Loan", "otherLiability", 5000000, "2026-06-01");
  const c = g.ids;
  const spend = (date: string, payee: string, cat: string | null, amount: number, extra = {}) =>
    post(bid, {
      account_id: chk,
      date,
      amount,
      payee_name: payee,
      ...(cat ? { category_id: c[cat] } : {}),
      ...extra,
    });
  const income = (date: string) =>
    post(bid, {
      account_id: chk,
      date,
      amount: 3000000,
      payee_name: "D8 Employer",
      inflow_to_ready_to_assign: true,
    });
  await spend("2026-07-10", "D8 Grocer", "D8 Food", -120000, { memo: "weekly shop" });
  await income("2026-07-15");
  await spend("2026-07-22", "D8 Cinema", "D8 Fun", -45000);
  await spend("2026-08-05", "D8 Grocer", "D8 Food", -80500);
  await income("2026-08-15");
  await spend("2026-08-20", "D8 Cinema", "D8 Fun", -25000);
  await post(bid, {
    account_id: chk,
    date: "2026-09-01",
    amount: -200000,
    transfer_account_id: sav,
  });
  await spend("2026-09-03", "D8 Power Co", "D8 Utilities", -60250);
  await spend("2026-09-12", "D8 Grocer", "D8 Food", -99990);
  await income("2026-09-15");
  await spend("2026-09-20", "D8 Mystery", null, -15000);
  await post(bid, {
    account_id: chk,
    date: "2026-10-01",
    amount: -250000,
    transfer_account_id: loan,
    category_id: c["D8 Loan Pmt"],
  });
  await spend("2026-10-07", "D8 Cinema", "D8 Fun", -30000);
  await spend("2026-10-09", "D8 Grocer", "D8 Food", -150000);
  await income("2026-10-15");
  await spend("2026-10-21", "D8 Grocer", "D8 Food", 20000, { memo: "refund" });
  await spend("2026-10-25", "D8 Gift Shop", "D8 Hidden", -40000);
  await spend("2026-11-03", "D8 Grocer", "D8 Food", -55000);
  const hid = await send("PATCH", `${base(bid)}/categories/${c["D8 Hidden"]}`, { hidden: true });
  expect(hid.status).toBe(200);
  return { bid, chk, sav, loan, g };
}

/** The stored files of a ZIP by name (a local-header walker). */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, Uint8Array>();
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const size = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLen));
    out.set(name, bytes.slice(p + 30 + nameLen, p + 30 + nameLen + size));
    p += 30 + nameLen + size;
  }
  return out;
}
