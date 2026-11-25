import { env } from "cloudflare:test";
import {
  BACKUP_MAX_D1_CALLS,
  BACKUP_MAX_R2_CALLS,
  BACKUP_PREFIX,
  BACKUP_ROWS_PER_RUN,
} from "@budget/schema/backup";
import { beforeEach, describe, expect, it } from "vitest";
import { scheduled } from "../src/scheduled";
import { backupRun } from "../src/services/backup";
import { clearBackups, countingBackupEnv, seedPlan } from "./backup-helpers";
import { q, stubBank } from "./plaid-sync-helpers";

beforeEach(clearBackups);
const BIG = { rowsPerRun: 100_000 };
const at = (d: string) => new Date(`${d}T04:00:00Z`);

describe("backup call bounds (EXF-976)", () => {
  const line: string[] = [];

  it("a start that finishes: the same D1 calls at 10, 100 and 300 transactions", async () => {
    const seen: number[] = [];
    for (const [i, n] of [10, 100, 300].entries()) {
      await clearBackups();
      await seedPlan(n);
      const c = countingBackupEnv();
      expect(await backupRun(c.env, at(`2031-04-0${i + 1}`), BIG)).toBe("done");
      expect(c.d1()).toBeLessThanOrEqual(BACKUP_MAX_D1_CALLS);
      expect(c.r2()).toBeLessThanOrEqual(BACKUP_MAX_R2_CALLS);
      seen.push(c.d1());
    }
    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).toBe(2);
  });

  it("1,000 transactions take a few bounded invocations", async () => {
    await seedPlan(1000);
    const c = countingBackupEnv();
    let runs = 0;
    for (; runs < 10; runs++) {
      c.reset();
      const o = await backupRun(c.env, at("2031-04-10"));
      expect(c.d1()).toBeLessThanOrEqual(BACKUP_MAX_D1_CALLS);
      expect(c.r2()).toBeLessThanOrEqual(BACKUP_MAX_R2_CALLS);
      if (o === "done") break;
    }
    expect(runs).toBeLessThan(5);
  });

  it("continue is one D1 call; a no-op is none and one R2 get", async () => {
    await seedPlan(300);
    const c = countingBackupEnv();
    expect(await backupRun(c.env, at("2031-04-11"), { rowsPerRun: 50 })).toBe("continuing");
    line.push(`start d1=${c.d1()} r2=${c.r2()}`);
    c.reset();
    expect(await backupRun(c.env, at("2031-04-11"), { rowsPerRun: 50 })).toBe("continuing");
    expect(c.d1()).toBe(1);
    expect(c.r2()).toBeLessThanOrEqual(BACKUP_MAX_R2_CALLS);
    line.push(`continue d1=${c.d1()} r2=${c.r2()}`);
    for (let i = 0; i < 40; i++) if ((await backupRun(c.env, at("2031-04-11"))) === "done") break;
    c.reset();
    expect(await backupRun(c.env, at("2031-04-11"))).toBe("noop");
    expect({ d1: c.d1(), r2: c.r2() }).toEqual({ d1: 0, r2: 1 });
    line.push(`noop d1=${c.d1()} r2=${c.r2()}`);
  });

  it("pruning three sets stays within the R2 bound", async () => {
    for (let i = 1; i <= 17; i++) {
      const id = `2030-05-${String(i).padStart(2, "0")}`;
      await env.FILES.put(`${BACKUP_PREFIX}${id}.manifest.json`, "{}");
      await env.FILES.put(`${BACKUP_PREFIX}${id}/parts/00001.ndjson.gz`, "x");
    }
    const c = countingBackupEnv();
    expect(await backupRun(c.env, at("2031-04-12"), BIG)).toBe("done");
    expect(c.r2()).toBeLessThanOrEqual(BACKUP_MAX_R2_CALLS);
    line.push(`prune d1=${c.d1()} r2=${c.r2()}`);
  });

  it("times an invocation that reads BACKUP_ROWS_PER_RUN rows", async () => {
    await seedPlan(BACKUP_ROWS_PER_RUN + 500);
    const c = countingBackupEnv();
    await backupRun(c.env, at("2031-04-13")); // reads the first slice of every table
    const t0 = Date.now();
    const o = await backupRun(c.env, at("2031-04-13")); // only the big table is left: a full run of rows
    const ms = Date.now() - t0;
    expect(["continuing", "done"]).toContain(o);
    console.log(
      `backup-calls: ${line.join("; ")}; ${BACKUP_ROWS_PER_RUN} rows in one run ms=${ms}`,
    );
  }, 120_000);

  it("the six-hourly invocation makes no R2 call and the same D1 calls as before", async () => {
    stubBank();
    await q("update bank_connections set status = 'broken'");
    const c = countingBackupEnv();
    await scheduled({ cron: "0 3,9,15,21 * * *" } as ScheduledController, c.env, {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
    } as unknown as ExecutionContext);
    expect({ d1: c.d1(), r2: c.r2() }).toEqual({ d1: 3, r2: 0 });
  });
});
