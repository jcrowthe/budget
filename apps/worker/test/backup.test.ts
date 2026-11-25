import { env } from "cloudflare:test";
import { BACKUP_CRON, BACKUP_KEEP, BACKUP_PREFIX, BACKUP_STATE_KEY } from "@budget/schema/backup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cronRun, scheduled } from "../src/scheduled";
import { backupRun } from "../src/services/backup";
import type { requestSync } from "../src/services/plaid-sync";
import {
  brokenFiles,
  clearBackups,
  dbCounts,
  keysUnder,
  readManifest,
  readParts,
  seedPlan,
  sha256Hex,
} from "./backup-helpers";
import { account, plan, q } from "./bulk-helpers";
import { brokenDb, captureErrors } from "./error-log-helpers";
import { sched, setNext } from "./scheduled-helpers";

beforeEach(clearBackups);

// The default run size splits 10,000 rows over the unfinished tables; the harness database accumulates rows, so
// tests that need a backup to finish in one invocation give it room.
const BIG = { rowsPerRun: 100_000 };
const at = (d: string) => new Date(`${d}T04:00:00Z`);
const ctx = {
  waitUntil() {},
  passThroughOnException() {},
  props: {},
} as unknown as ExecutionContext;
const cron = (c: string) => ({ cron: c }) as ScheduledController;

async function untilManifest(id: string, now: Date, rowsPerRun?: number) {
  for (let i = 0; i < 40; i++) {
    await backupRun(env, now, { rowsPerRun });
    if (await env.FILES.head(`${BACKUP_PREFIX}${id}.manifest.json`)) return i + 1;
  }
  throw new Error("backup never finished");
}

describe("the nightly backup (EXF-976)", () => {
  it("A1: writes a manifest whose row counts equal the database's", async () => {
    await seedPlan(40);
    expect(await backupRun(env, at("2031-01-02"), BIG)).toBe("done");
    const m = await readManifest("2031-01-02");
    const counts = await dbCounts();
    expect(Object.keys(counts)).toHaveLength(25);
    expect(m.tables.map((t) => t.name)).toEqual(Object.keys(counts));
    for (const t of m.tables) expect(t.rows, t.name).toBe(counts[t.name]);
    expect(m.rows_total).toBe(Object.values(counts).reduce((a, b) => a + b, 0));
    const parts = await readParts(m);
    const lines = parts.flat();
    m.tables.forEach((t, i) => {
      expect(
        lines.filter((l) => l[0] === i),
        t.name,
      ).toHaveLength(t.rows);
    });
    for (const p of m.parts) {
      const o = await env.FILES.get(p.key);
      expect(await sha256Hex(await (o as R2ObjectBody).arrayBuffer())).toBe(p.sha256);
    }
    expect(JSON.stringify(m)).not.toContain("ZZ-TEST");
  });

  it("is resumable: a small run size takes several parts, the same counts, then is a no-op", async () => {
    await seedPlan(300);
    const now = at("2031-01-03");
    expect(await backupRun(env, now, { rowsPerRun: 50 })).toBe("continuing");
    expect(await env.FILES.head(`${BACKUP_PREFIX}2031-01-03.manifest.json`)).toBeNull();
    await untilManifest("2031-01-03", now, 50);
    const m = await readManifest("2031-01-03");
    expect(m.parts.length).toBeGreaterThanOrEqual(3);
    const counts = await dbCounts();
    for (const t of m.tables) expect(t.rows, t.name).toBe(counts[t.name]);
    const before = await keysUnder();
    expect(await backupRun(env, now)).toBe("noop");
    expect(await keysUnder()).toEqual(before);
  });

  it("abandons a partial backup when the schema changes, then starts again and completes", async () => {
    await seedPlan(300);
    const now = at("2031-01-04");
    expect(await backupRun(env, now, { rowsPerRun: 50 })).toBe("continuing");
    expect((await keysUnder(`${BACKUP_PREFIX}2031-01-04/`)).length).toBeGreaterThan(0);
    await env.DB.prepare(
      "insert into d1_migrations (name, applied_at) values ('zz_backup_test.sql', ?)",
    )
      .bind("2031-01-04")
      .run();
    try {
      expect(await backupRun(env, now, { rowsPerRun: 50 })).toBe("abandoned");
      expect(await keysUnder(`${BACKUP_PREFIX}2031-01-04/`)).toEqual([]);
      const state = (await (await env.FILES.get(BACKUP_STATE_KEY))?.json()) as {
        in_progress: unknown;
      };
      expect(state.in_progress).toBeNull();
      await untilManifest("2031-01-04", now, 50);
      expect((await readManifest("2031-01-04")).schema_version).toBe("zz_backup_test.sql");
    } finally {
      await q("delete from d1_migrations where name = 'zz_backup_test.sql'");
    }
  });

  it("A3: retention keeps exactly N sets, none orphaned, and drains a backlog three at a time", async () => {
    await seedPlan(5);
    const days = Array.from({ length: 16 }, (_, i) => `2031-02-${String(i + 1).padStart(2, "0")}`);
    for (const [i, d] of days.entries()) {
      expect(await backupRun(env, at(d), BIG)).toBe("done");
      if (i + 1 >= BACKUP_KEEP) {
        const l = await env.FILES.list({ prefix: BACKUP_PREFIX, delimiter: "/" });
        const ids = l.objects.map((o) => o.key).filter((k) => k.endsWith(".manifest.json"));
        expect(ids).toHaveLength(BACKUP_KEEP);
        expect(l.delimitedPrefixes).toHaveLength(BACKUP_KEEP);
        expect(ids.map((k) => k.slice(BACKUP_PREFIX.length, -".manifest.json".length))).toEqual(
          days.slice(i + 1 - BACKUP_KEEP, i + 1),
        );
      }
    }
    const old = Array.from({ length: 6 }, (_, i) => `2030-0${i + 1}-01`);
    for (const id of old) {
      await env.FILES.put(`${BACKUP_PREFIX}${id}.manifest.json`, "{}");
      await env.FILES.put(`${BACKUP_PREFIX}${id}/parts/00001.ndjson.gz`, "x");
    }
    const sets = async () =>
      (await env.FILES.list({ prefix: BACKUP_PREFIX, delimiter: "/" })).delimitedPrefixes.length;
    expect(await sets()).toBe(20);
    expect(await backupRun(env, at("2031-02-17"), BIG)).toBe("done");
    expect(await sets()).toBe(18);
    for (let i = 0; i < 4 && (await sets()) > BACKUP_KEEP; i++) {
      expect(await backupRun(env, at("2031-02-17"))).toBe("noop");
    }
    expect(await sets()).toBe(BACKUP_KEEP);
    const keys = await keysUnder();
    expect(keys.filter((k) => k.endsWith(".manifest.json"))).toHaveLength(BACKUP_KEEP);
    expect(keys.filter((k) => k.includes("/2030-"))).toEqual([]);
  });

  describe("A5: a failure is logged without values and stops nothing", () => {
    const secrets = () => [env.SECRETS_ENCRYPTION_KEY ?? "-", env.LOCAL_JWT_SECRET ?? "-"];
    const expectOneCleanLine = (lines: string[]) => {
      expect(lines.filter((l) => l.startsWith("backup failed | "))).toHaveLength(1);
      expect(lines).toHaveLength(1);
      for (const bad of ["ZZ-TEST", "payee", ...secrets()]) expect(lines[0]).not.toContain(bad);
    };

    it("R2 down", async () => {
      await seedPlan(5);
      const lines = captureErrors();
      expect(await backupRun({ ...env, FILES: brokenFiles() }, at("2031-03-01"))).toBe("failed");
      expectOneCleanLine(lines);
    });

    it("D1 down", async () => {
      await seedPlan(5);
      const lines = captureErrors();
      expect(await backupRun({ ...env, DB: brokenDb("sqlite_master") }, at("2031-03-02"))).toBe(
        "failed",
      );
      expectOneCleanLine(lines);
    });

    it("a failing backup invocation leaves enterDue and the sync to the other cron", async () => {
      const b = await plan();
      const a = await account(b);
      const id = (
        await sched(b, {
          account_id: a,
          date_first: "2030-03-20",
          frequency: "daily",
          amount: -100,
          payee_name: "ZZ Payee",
        })
      ).scheduled_transaction.id as string;
      await setNext(id, "2030-03-09");
      captureErrors();
      await expect(
        scheduled(cron(BACKUP_CRON), { ...env, FILES: brokenFiles() }, ctx),
      ).resolves.toBeUndefined();
      // The backup cron did not enter the schedule ...
      expect(
        await q("select 1 from change_log where actor = 'service:scheduler' and entity_id = ?", id),
      ).toHaveLength(0);
      // ... and the six-hourly one, with the backup bucket broken, still does, and starts the run.
      const run = vi.fn(async () => ({ has_more: false })) as unknown as typeof requestSync;
      await cronRun({ ...env, FILES: brokenFiles() }, new Date("2030-03-10T03:00:00Z"), run);
      expect(
        (
          await q(
            "select 1 from change_log where actor = 'service:scheduler' and entity_id = ?",
            id,
          )
        ).length,
      ).toBeGreaterThan(0);
    });
  });
});
