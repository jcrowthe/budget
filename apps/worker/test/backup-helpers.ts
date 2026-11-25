import { env } from "cloudflare:test";
import { BACKUP_PREFIX, type BackupManifest } from "@budget/schema/backup";
import type { Env } from "../src/env";
import { account, plan } from "./bulk-helpers";
import { countingEnv } from "./plaid-sync-helpers";

const R2_METHODS = ["get", "put", "head", "list", "delete"] as const;
export type R2Counts = Record<(typeof R2_METHODS)[number], number>;

/** env.FILES whose get/put/head/list/delete each count one call. */
export function countingR2(base: R2Bucket = env.FILES) {
  const calls: R2Counts = { get: 0, put: 0, head: 0, list: 0, delete: 0 };
  const FILES = Object.create(base) as R2Bucket;
  for (const m of R2_METHODS) {
    (FILES as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
      calls[m]++;
      return (base[m] as (...x: unknown[]) => unknown).apply(base, a);
    };
  }
  const total = () => R2_METHODS.reduce((n, m) => n + calls[m], 0);
  return { FILES, calls, total };
}

/** An env that counts D1 and R2 calls. */
export function countingBackupEnv() {
  const d = countingEnv();
  const r = countingR2();
  const e = { ...d.env, FILES: r.FILES } as Env;
  return {
    env: e,
    d1: () => d.calls.d1,
    r2: () => r.total(),
    r2calls: r.calls,
    reset() {
      d.reset();
      for (const m of R2_METHODS) r.calls[m] = 0;
    },
  };
}

/** An R2 bucket whose every method throws. */
export function brokenFiles(): R2Bucket {
  return new Proxy({} as R2Bucket, {
    get: () => () => {
      throw new Error("R2 is down");
    },
  });
}

/** A ZZ-TEST plan with an account and `n` transactions (SQL, batches of 90), and one secrets row with a BLOB. */
export async function seedPlan(n: number) {
  const bid = await plan();
  const acc = await account(bid);
  const now = "2031-01-01T00:00:00.000Z";
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < n; i++) {
    stmts.push(
      env.DB.prepare(
        "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_name, memo) values (?, ?, ?, '2031-01-01', ?, 'cleared', 1, ?, ?, ?, ?)",
      ).bind(
        `zz-bk-${bid.slice(0, 8)}-${i}`,
        bid,
        acc,
        -(i + 1) * 10,
        now,
        now,
        `ZZ-TEST payee ${i}`,
        i % 3 === 0 ? null : `it's "ZZ" ${i}`,
      ),
    );
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  await env.DB.prepare(
    "insert or replace into secrets (name, ciphertext, iv, key_version, created_at, updated_at) values ('zz-backup-test', ?, ?, 1, ?, ?)",
  )
    .bind(new Uint8Array([0, 1, 2, 255, 254]), new Uint8Array([9, 8, 7]), now, now)
    .run();
  return { bid, acc };
}

/** count(*) per application table (sqlite_master, minus sqlite_% and _cf_%), by name. */
export async function dbCounts(): Promise<Record<string, number>> {
  const names = (
    await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' order by name",
    ).all<{ name: string }>()
  ).results.map((r) => r.name);
  const out: Record<string, number> = {};
  for (const n of names) {
    out[n] = (await env.DB.prepare(`select count(*) n from "${n}"`).first<{ n: number }>())?.n ?? 0;
  }
  return out;
}

export async function readManifest(id: string): Promise<BackupManifest> {
  const o = await env.FILES.get(`${BACKUP_PREFIX}${id}.manifest.json`);
  if (!o) throw new Error(`no manifest ${id}`);
  return (await o.json()) as BackupManifest;
}

async function gunzip(buf: ArrayBuffer): Promise<string> {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).text();
}

/** Every part's lines, parsed, in order. */
export async function readParts(m: BackupManifest): Promise<unknown[][][]> {
  const out: unknown[][][] = [];
  for (const p of m.parts) {
    const o = await env.FILES.get(p.key);
    if (!o) throw new Error("missing part");
    const text = await gunzip(await o.arrayBuffer());
    out.push(
      text
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    );
  }
  return out;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function keysUnder(prefix = BACKUP_PREFIX): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await env.FILES.list({ prefix, cursor });
    keys.push(...r.objects.map((o) => o.key));
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return keys;
}

export async function clearBackups() {
  const keys = await keysUnder();
  for (let i = 0; i < keys.length; i += 100) await env.FILES.delete(keys.slice(i, i + 100));
}
