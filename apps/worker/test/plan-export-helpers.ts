import { env } from "cloudflare:test";
import { crc32 } from "@budget/schema/zip";
import { expect } from "vitest";
import type { Env } from "../src/env";
import { createBudget } from "../src/services/budgets";
import { actor, type Json, q, send, setSql } from "./bulk-helpers";
import { json } from "./helpers";

export const NOW = "2026-11-16T09:05";
export const PLAN_NAME = "ZZ-TEST Ex/port: 7";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  crcOk: boolean;
  date: string;
  time: string;
}

/** Reads a stored zip: end record, central directory, then each local header (which must agree). */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const time = v.getUint16(p + 12, true);
    const day = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen;
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    expect(v.getUint16(offset + 8, true)).toBe(0); // stored
    expect(v.getUint32(offset + 18, true)).toBe(size);
    expect(v.getUint32(offset + 22, true)).toBe(size);
    const localName = v.getUint16(offset + 26, true);
    expect(dec.decode(bytes.subarray(offset + 30, offset + 30 + localName))).toBe(name);
    const start = offset + 30 + localName + v.getUint16(offset + 28, true);
    const data = bytes.slice(start, start + size);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    out.push({
      name,
      data,
      crcOk: crc32(data) === crc,
      date: `${1980 + (day >> 9)}-${pad((day >> 5) & 15)}-${pad(day & 31)}`,
      time: `${pad(time >> 11)}:${pad((time >> 5) & 63)}`,
    });
  }
  return out;
}

/** UTF-8 text with the BOM kept. */
export const text = (data: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(data);

/** Copied from credit-call-count.test.ts (not exported there): counts each executed statement and each batch. */
export function counting(): { env: Env; calls: () => number; reset: () => void } {
  let n = 0;
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "run" || k === "all" || k === "first" || k === "raw") {
          return (...a: unknown[]) => {
            n += 1;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    real.set(proxy, st);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(t, k) {
      if (k === "prepare") return (query: string) => wrap(t.prepare(query));
      if (k === "batch") {
        return (list: D1PreparedStatement[]) => {
          n += 1;
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n, reset: () => (n = 0) };
}

const P = (bid: string) => `/api/v1/budgets/${bid}`;

async function ok(res: Response, status = 200): Promise<Json> {
  const body = (await res.json()) as Json;
  expect(res.status, JSON.stringify(body)).toBe(status);
  return body.data;
}

export async function post(bid: string, path: string, body: unknown, status = 201) {
  return ok(await send(`${P(bid)}${path}`, "POST", body), status);
}

/** Fixture F of docs/plan-export-design.md, built through REST with fixed dates. */
export async function buildF() {
  const bid = (await createBudget(env, actor, { name: PLAN_NAME })).id;
  const start = await ok(await json(`${P(bid)}/months/2026-09-01`));
  for (const g of start.groups) {
    if (g.kind === null) {
      await ok(await send(`${P(bid)}/category_groups/${g.id}`, "DELETE"));
    }
  }
  // New groups and categories land at the top, so they are created in reverse screen order.
  const hide = async (path: string) =>
    ok(await send(`${P(bid)}${path}`, "PATCH", { hidden: true }));
  const group = async (name: string, hidden = false) => {
    const id = (await post(bid, "/category_groups", { name })).category_group.id as string;
    if (hidden) await hide(`/category_groups/${id}`);
    return id;
  };
  const cat = async (group_id: string, name: string, hidden = false) => {
    const id = (await post(bid, "/categories", { group_id, name })).category.id as string;
    if (hidden) await hide(`/categories/${id}`);
    return id;
  };
  const old = await group("Old", true);
  const everyday = await group("Everyday");
  const bills = await group("Bills");
  const hobby = await cat(old, "Hobby");
  const fun = await cat(everyday, 'Fun "x", y');
  const groceries = await cat(everyday, "Groceries 🛒");
  const oldHobby = await cat(bills, "Old Hobby", true);
  const rent = await cat(bills, "Rent");

  const acct = async (name: string, type: string, balance: number) =>
    (await post(bid, "/accounts", { name, type, balance, date: "2026-09-01" })).account
      .id as string;
  const main = await acct("Main Checking", "checking", 1000000);
  const rainy = await acct("Rainy Day", "savings", 50000);
  const visa = await acct("Sample Visa", "creditCard", 25000);
  const house = await acct("House", "otherAsset", 2000000);
  const oldCash = await acct("Old Cash", "cash", 10000);

  const assign = async (month: string, id: string, assigned: number) =>
    ok(await send(`${P(bid)}/months/${month}/categories/${id}`, "PATCH", { assigned }));
  await assign("2026-09-01", rent, 900000);
  await assign("2026-10-01", rent, 900000);
  await assign("2026-09-01", groceries, 200000);
  await assign("2026-09-01", fun, 50000);
  await assign("2026-09-01", hobby, 20000);
  await assign("2026-12-01", groceries, 50000);

  const tx = (body: Json) => post(bid, "/transactions", body).then((d) => d.transaction as Json);
  const splitTx = await tx({
    account_id: main,
    date: "2026-10-14",
    amount: -42500,
    payee_name: "Corner Shop",
    cleared: "cleared",
    subtransactions: [
      { amount: -30000, category_id: groceries, memo: "food" },
      { amount: -12500, category_id: fun },
    ],
  });
  await ok(await send(`${P(bid)}/transactions/${splitTx.id}`, "PATCH", { flag_color: "red" }));
  await tx({
    account_id: main,
    date: "2026-10-10",
    amount: -200000,
    transfer_account_id: rainy,
  });
  // Reconciling is not an entry-form field: set it on both sides of the transfer directly.
  await env.DB.prepare(
    "update transactions set cleared = 'reconciled' where budget_id = ? and date = '2026-10-10'",
  )
    .bind(bid)
    .run();
  await tx({
    account_id: main,
    date: "2026-10-05",
    amount: 2500000,
    payee_name: "Employer",
    memo: "=bonus",
    cleared: "cleared",
    inflow_to_ready_to_assign: true,
  });
  for (const [amount, payee] of [
    [-5000, "Five"],
    [-60000, "Sixty"],
    [7000, "Seven"],
  ] as const) {
    await tx({ account_id: main, date: "2026-10-20", amount, payee_name: payee });
  }
  await tx({
    account_id: visa,
    date: "2026-10-15",
    amount: -40000,
    payee_name: "Card Shop",
    category_id: groceries,
  });
  await tx({ account_id: house, date: "2026-10-18", amount: 100000, payee_name: "Appraiser" });
  await tx({
    account_id: main,
    date: "2026-10-12",
    amount: -8000,
    payee_name: "Hobby Shop",
    category_id: hobby,
  });
  const unapproved = await tx({
    account_id: main,
    date: "2026-10-21",
    amount: -3000,
    payee_name: "Unapproved",
  });
  await setSql(unapproved.id, "approved = 0");
  const gone = await tx({
    account_id: main,
    date: "2026-10-22",
    amount: -99000,
    payee_name: "Deleted",
  });
  await ok(await send(`${P(bid)}/transactions/${gone.id}`, "DELETE"));
  await tx({
    account_id: main,
    date: "2026-10-23",
    amount: 1000,
    payee_name: "Memo Test",
    memo: 'a "q", b\nc 🛒',
  });

  await post(bid, "/scheduled-transactions?today=2026-11-15", {
    account_id: main,
    date_first: "2026-12-01",
    frequency: "never",
    amount: -900000,
    payee_name: "Landlord",
    category_id: rent,
    memo: "monthly",
  });
  await post(bid, "/scheduled-transactions?today=2026-11-15", {
    account_id: oldCash,
    date_first: "2026-12-05",
    frequency: "never",
    amount: -1000,
    payee_name: "Closed Schedule",
  });
  await ok(await send(`${P(bid)}/accounts/${oldCash}/close`, "POST", { today: "2026-10-25" }));
  return {
    bid,
    ids: { rent, oldHobby, groceries, fun, hobby },
    accounts: { main, rainy, visa, house, oldCash },
  };
}

export const changeLogCount = async (bid: string) =>
  (await q("select count(*) n from change_log where budget_id = ?", bid))[0]?.n as number;
