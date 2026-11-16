import { env } from "cloudflare:test";
import { crc32, utf8 } from "@budget/schema/zip";
import { expect } from "vitest";
import type { Env } from "../src/env";
import { type Json, q } from "./bulk-helpers";
import { authed, call } from "./helpers";
import { counting } from "./plan-export-helpers";

// EXF-477 test inputs. Every file is written by hand from the text of EXF-476 and EXF-477 or made by the clone's
// own export; nothing here is taken from the source app.
export const BOM = "﻿";
export const PLAN_HEADER =
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';
export const REGISTER_HEADER =
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"';

export const SAMPLE_ZIP_NAME = "YNAB Export - Sample Plan as of 2026-11-15 19-51.zip";
export const SAMPLE_STEM = "Sample Plan as of 2026-11-15 19-51";

/** EXF-476's two samples, as the source writes them: BOM, CRLF, no line end after the last row, `$` amounts. */
export function sampleFiles(): { plan: string; register: string } {
  const plan = [
    PLAN_HEADER,
    '"Oct 2026","Bills: Rent","Bills","Rent",$900.00,-$900.00,$0.00',
    '"Oct 2026","Everyday: Groceries 🛒","Everyday","Groceries 🛒",$300.00,-$120.50,$179.50',
    '"Oct 2026","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa",$0.00,$40.00,$40.00',
    '"Oct 2026","Hidden Categories: Old Hobby","Hidden Categories","Old Hobby",$0.00,$0.00,$0.00',
    '"Nov 2026","Bills: Rent","Bills","Rent",$900.00,$0.00,$900.00',
  ].join("\r\n");
  const register = [
    REGISTER_HEADER,
    '"Main Checking","","12/01/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Uncleared"',
    '"Main Checking","Red","11/14/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","Split (1/2) food",$30.00,$0.00,"Cleared"',
    '"Main Checking","Red","11/14/2026","Corner Shop","Fun: Games","Fun","Games","Split (2/2) ",$12.50,$0.00,"Cleared"',
    '"Main Checking","","11/10/2026","Transfer : Rainy Day Savings","","","","",$200.00,$0.00,"Reconciled"',
    '"Rainy Day Savings","","11/10/2026","Transfer : Main Checking","","","","",$0.00,$200.00,"Reconciled"',
    '"Main Checking","Tax","11/05/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","\\=bonus",$0.00,$2500.00,"Cleared"',
    '"Main Checking","","11/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"',
  ].join("\r\n");
  return { plan: BOM + plan, register: BOM + register };
}

export interface ZipInput {
  name: string;
  data: Uint8Array | string;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A compressed ZIP (method 8) written here with its own headers, as the source's export is. */
export async function deflatedZip(files: ZipInput[]): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const le = (n: number, bytes: number) => {
    const b = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) b[i] = Math.floor(n / 2 ** (8 * i)) & 0xff;
    return b;
  };
  const cat = (...parts: Uint8Array[]) => {
    const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
    let p = 0;
    for (const x of parts) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  };
  for (const f of files) {
    const raw = typeof f.data === "string" ? new TextEncoder().encode(f.data) : f.data;
    const body = await deflate(raw);
    const name = utf8(f.name);
    const common = [
      le(20, 2),
      le(0x0800, 2),
      le(8, 2),
      le(0x6000, 2),
      le(0x5a6f, 2),
      le(crc32(raw), 4),
      le(body.length, 4),
      le(raw.length, 4),
      le(name.length, 2),
      le(0, 2),
    ];
    const local = cat(le(0x04034b50, 4), ...common, name, body);
    central.push(
      cat(
        le(0x02014b50, 4),
        le(20, 2),
        ...common,
        le(0, 2),
        le(0, 2),
        le(0, 2),
        le(0, 4),
        le(offset, 4),
        name,
      ),
    );
    chunks.push(local);
    offset += local.length;
  }
  const cd = cat(...central);
  return cat(
    ...chunks,
    cd,
    le(0x06054b50, 4),
    le(0, 2),
    le(0, 2),
    le(files.length, 2),
    le(files.length, 2),
    le(cd.length, 4),
    le(offset, 4),
    le(0, 2),
  );
}

export const sampleZip = async () => {
  const f = sampleFiles();
  return deflatedZip([
    { name: `${SAMPLE_STEM} - Plan.csv`, data: f.plan },
    { name: `${SAMPLE_STEM} - Register.csv`, data: f.register },
  ]);
};

export type Upload = { name: string; data: Uint8Array | string };

export function importForm(files: Upload[], fields: Record<string, string> = {}): FormData {
  const form = new FormData();
  for (const f of files) form.append("file", new File([f.data as BlobPart], f.name));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

export async function postImport(form: FormData, query = "", envOverride: Partial<Env> = {}) {
  return call(
    `/api/v1/budgets/import${query}`,
    await authed({ method: "POST", body: form }),
    envOverride,
  );
}

export async function continueImportRest(importId: string, envOverride: Partial<Env> = {}) {
  return call(
    `/api/v1/budgets/import/${importId}/continue`,
    await authed({ method: "POST" }),
    envOverride,
  );
}

export async function body(res: Response, status: number): Promise<Json> {
  const b = (await res.json()) as Json;
  expect(res.status, JSON.stringify(b).slice(0, 600)).toBe(status);
  return b.data ?? b;
}

/** Calls continue until the import is done; returns the final data and the number of continue calls. */
export async function runToDone(first: Json, envOverride: Partial<Env> = {}) {
  let data = first;
  let calls = 0;
  while (data.state !== "done") {
    const res = await continueImportRest(data.import_id, envOverride);
    calls++;
    data = (await res.json()).data;
    expect(calls).toBeLessThan(500);
  }
  return { data, calls };
}

/** D1 calls as `plan-export-helpers.counting`, plus every method called on the R2 bucket. */
export function countingEnv() {
  const c = counting();
  let r2 = 0;
  const files = new Proxy(env.FILES, {
    get(t, k) {
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      if (typeof v !== "function") return v;
      return (...a: unknown[]) => {
        r2 += 1;
        return (v as (...x: unknown[]) => unknown).apply(t, a);
      };
    },
  });
  const e = { ...c.env, FILES: files } as Env;
  return {
    env: e,
    d1: c.calls,
    r2: () => r2,
    reset: () => {
      c.reset();
      r2 = 0;
    },
  };
}

export const rows = async (table: string, bid: string) =>
  (await q(`select count(*) n from ${table} where budget_id = ?`, bid))[0]?.n as number;

export const TABLES_OF_PLAN = [
  "accounts",
  "category_groups",
  "categories",
  "payees",
  "month_categories",
  "transactions",
  "scheduled_transactions",
  "change_log",
] as const;

export async function planCounts(bid: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLES_OF_PLAN) out[t] = await rows(t, bid);
  return out;
}

export async function allCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of [...TABLES_OF_PLAN, "budgets", "plan_imports"]) {
    out[t] = ((await q(`select count(*) n from ${t}`))[0] as Json).n;
  }
  return out;
}

export async function r2Keys(): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.FILES.list({ prefix: "plan-imports/", cursor });
    out.push(...l.objects.map((o) => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * A source-style plan of the size of a real one, written for the test: compressed `YNAB Export - … .zip` with the two
 * files, Plan and Register, consistent (Activity and Available follow from the rows). Returns the expected counts.
 */
export async function sourceStyleLarge(p: {
  accounts: number;
  categories: number;
  months: number;
  transactions: number;
}) {
  const money = (m: number) => `${m < 0 ? "-" : ""}$${(Math.abs(m) / 1000).toFixed(2)}`;
  const nCards = 4;
  const nTracking = 2;
  const nCash = p.accounts - nCards - nTracking;
  const nHidden = 6;
  const nPlain = p.categories - nCards;
  const groupSize = 10;
  const acct = (i: number) =>
    i < nCash
      ? `Account ${i}`
      : i < nCash + nCards
        ? `Card ${i - nCash}`
        : `Asset ${i - nCash - nCards}`;
  const cats = Array.from({ length: nPlain }, (_, i) => ({
    group: `Group ${Math.floor(i / groupSize)}`,
    name: `Category ${i}`,
    hidden: i >= nPlain - nHidden,
  }));
  const label = (m: number) => {
    const y = 2010 + Math.floor(m / 12);
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m % 12]} ${y}`;
  };
  // The plan's months end at Oct 2026, the month before the export date (2026-11-15).
  const lastIndex = (2026 - 2010) * 12 + 9; // Oct 2026
  const first = lastIndex - p.months + 1;
  const mm = (m: number) => `${2010 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  const catPath = (c: (typeof cats)[number]) =>
    c.hidden
      ? { full: `Hidden Categories: ${c.name}`, group: "Hidden Categories" }
      : { full: `${c.group}: ${c.name}`, group: c.group };

  type Row = {
    account: string;
    date: string;
    payee: string;
    cat: number | null;
    rta: boolean;
    memo: string;
    amount: number;
    cleared: string;
    m: number;
    n: number;
  };
  const reg: Row[] = [];
  const spend = new Map<string, number>();
  let n = 0;
  let splits = 0;
  let transfers = 0;
  const day = (i: number) => String((i % 27) + 1).padStart(2, "0");
  const cell = (m: number, d: string) => `${mm(m).slice(5)}/${d}/${mm(m).slice(0, 4)}`;
  for (let a = 0; a < p.accounts; a++) {
    const card = a >= nCash && a < nCash + nCards;
    const tracking = a >= nCash + nCards;
    reg.push({
      account: acct(a),
      date: cell(first, "01"),
      payee: "Starting Balance",
      cat: null,
      rta: !card && !tracking,
      memo: "",
      amount: card ? -100000 : tracking ? 1000000 : 5000000,
      cleared: "Cleared",
      m: first,
      n: n++,
    });
  }
  let rowsMade = 0;
  for (let i = 0; rowsMade < p.transactions; i++) {
    const cat = i % nPlain;
    const m = first + (Math.floor(i / nPlain) % p.months);
    const a = i % nCash;
    const d = day(i);
    if (i % 40 === 39) {
      const b = (a + 1) % nCash;
      const amt = 1000 * (5 + (i % 30));
      reg.push({
        account: acct(a),
        date: cell(m, d),
        payee: `Transfer : ${acct(b)}`,
        cat: null,
        rta: false,
        memo: "",
        amount: -amt,
        cleared: "Cleared",
        m,
        n: n++,
      });
      reg.push({
        account: acct(b),
        date: cell(m, d),
        payee: `Transfer : ${acct(a)}`,
        cat: null,
        rta: false,
        memo: "",
        amount: amt,
        cleared: "Cleared",
        m,
        n: n++,
      });
      transfers++;
      rowsMade += 2;
    } else if (i % 50 === 49) {
      const c2 = (cat + 1) % nPlain;
      const x = 1000 * (3 + (i % 17));
      const y = 1000 * (2 + (i % 11));
      reg.push({
        account: acct(a),
        date: cell(m, d),
        payee: `Payee ${i % 300}`,
        cat,
        rta: false,
        memo: `Split (1/2) part ${i}`,
        amount: -x,
        cleared: "Cleared",
        m,
        n: n++,
      });
      reg.push({
        account: acct(a),
        date: cell(m, d),
        payee: `Payee ${i % 300}`,
        cat: c2,
        rta: false,
        memo: "Split (2/2) ",
        amount: -y,
        cleared: "Cleared",
        m,
        n: n++,
      });
      spend.set(`${m}|${cat}`, (spend.get(`${m}|${cat}`) ?? 0) - x);
      spend.set(`${m}|${c2}`, (spend.get(`${m}|${c2}`) ?? 0) - y);
      splits++;
      rowsMade += 2;
    } else {
      const x = 1000 * (1 + (i % 40));
      reg.push({
        account: acct(a),
        date: cell(m, d),
        payee: `Payee ${i % 300}`,
        cat,
        rta: false,
        memo: i % 7 === 0 ? `memo ${i}` : "",
        amount: -x,
        cleared: i % 5 === 0 ? "Uncleared" : "Cleared",
        m,
        n: n++,
      });
      spend.set(`${m}|${cat}`, (spend.get(`${m}|${cat}`) ?? 0) - x);
      rowsMade += 1;
    }
  }
  const planLines = [PLAN_HEADER];
  const assigned = 200000;
  const avail = new Array<number>(nPlain).fill(0);
  for (let m = first; m <= lastIndex; m++) {
    for (let k = 0; k < nCards; k++) {
      const name = `Card ${k}`;
      planLines.push(
        `"${label(m)}","Credit Card Payments: ${name}","Credit Card Payments","${name}",$0.00,$0.00,$0.00`,
      );
    }
    const hiddenRows: string[] = [];
    cats.forEach((c, ci) => {
      const act = spend.get(`${m}|${ci}`) ?? 0;
      avail[ci] = (avail[ci] as number) + assigned + act;
      const path = catPath(c);
      const row = `"${label(m)}","${path.full}","${path.group}","${c.name}",${money(assigned)},${money(act)},${money(avail[ci] as number)}`;
      (c.hidden ? hiddenRows : planLines).push(row);
    });
    planLines.push(...hiddenRows);
  }
  const stamp = "2026-11-15 19-51";
  const stem = `Large Plan as of ${stamp}`;
  const regLines = [REGISTER_HEADER];
  const sorted = [...reg].sort((a, b) => {
    const da = `${a.date.slice(6)}${a.date.slice(0, 2)}${a.date.slice(3, 5)}`;
    const db = `${b.date.slice(6)}${b.date.slice(0, 2)}${b.date.slice(3, 5)}`;
    return da < db ? 1 : da > db ? -1 : 0 || a.n - b.n;
  });
  // Rows of one split stay together: they share a date and have consecutive n.
  for (const r of sorted) {
    const c = r.cat === null ? null : cats[r.cat];
    const path = c ? catPath(c) : null;
    const catCells = r.rta
      ? '"Inflow: Ready to Assign","Inflow","Ready to Assign"'
      : path && c
        ? `"${path.full}","${path.group}","${c.name}"`
        : '"","",""';
    regLines.push(
      `"${r.account}","","${r.date}","${r.payee}",${catCells},"${r.memo}",${r.amount < 0 ? money(-r.amount) : "$0.00"},${r.amount > 0 ? money(r.amount) : "$0.00"},"${r.cleared}"`,
    );
  }
  const zip = await deflatedZip([
    { name: `${stem} - Plan.csv`, data: BOM + planLines.join("\r\n") },
    { name: `${stem} - Register.csv`, data: BOM + regLines.join("\r\n") },
  ]);
  return {
    name: `YNAB Export - ${stem}.zip`,
    bytes: zip,
    expected: {
      accounts: p.accounts,
      categories: p.categories,
      months: p.months,
      planRows: planLines.length - 1,
      registerRows: reg.length,
      splits,
      transfers,
    },
  };
}
