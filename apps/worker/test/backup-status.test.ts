import { env } from "cloudflare:test";
import { BACKUP_MAX_R2_CALLS, BACKUP_PREFIX } from "@budget/schema/backup";
import { beforeEach, describe, expect, it } from "vitest";
import { backupRun } from "../src/services/backup";
import { brokenFiles, clearBackups, countingR2, seedPlan } from "./backup-helpers";
import { brokenDb, captureErrors } from "./error-log-helpers";
import { json } from "./helpers";
import { mcpRpc } from "./surface";

// The nightly backup records its outcome in an R2 status object, and a read reports it (EXF-976 follow-up).
const STATUS_KEY = `${BACKUP_PREFIX}status.json`;
const BIG = { rowsPerRun: 100_000 };
const at = (d: string) => new Date(`${d}T04:00:00Z`);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

beforeEach(clearBackups);

type Status = {
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  stale: boolean;
};

async function rest(): Promise<Status> {
  const res = await json("/api/v1/backup-status");
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Status }).data;
}

async function tool(): Promise<Status> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  const r = await mcpRpc("tools/call", { name: "get_backup_status", arguments: {} }, 2);
  return r.body.result?.structuredContent as unknown as Status;
}

const stored = async () => JSON.parse((await (await env.FILES.get(STATUS_KEY))?.text()) ?? "null");

describe("backup status", () => {
  it("a successful run writes last_success_at and no failure", async () => {
    await seedPlan(5);
    expect(await backupRun(env, at("2031-04-01"), BIG)).toBe("done");
    expect(await stored()).toEqual({
      last_success_at: "2031-04-01T04:00:00.000Z",
      last_failure_at: null,
      last_error_code: null,
    });
  });

  it("a failed run writes last_failure_at and a short code, nothing of the data, and a prune failure keeps this run as the success", async () => {
    await seedPlan(5);
    await backupRun(env, at("2031-04-02"), BIG);
    captureErrors();
    expect(await backupRun({ ...env, DB: brokenDb("sqlite_master") }, at("2031-04-03"))).toBe(
      "failed",
    );
    const s = await stored();
    expect(s.last_success_at).toBe("2031-04-02T04:00:00.000Z");
    expect(s.last_failure_at).toBe("2031-04-03T04:00:00.000Z");
    expect(s.last_error_code).toMatch(/^[a-z_]{1,32}$/);
    expect(Object.keys(s).sort()).toEqual([
      "last_error_code",
      "last_failure_at",
      "last_success_at",
    ]);
    expect(JSON.stringify(s)).not.toMatch(/ZZ|payee|secret/i);
  });

  it("a later success clears the failure", async () => {
    await seedPlan(5);
    captureErrors();
    await backupRun({ ...env, DB: brokenDb("sqlite_master") }, at("2031-04-04"));
    expect((await stored()).last_error_code).not.toBeNull();
    expect(await backupRun(env, at("2031-04-05"), BIG)).toBe("done");
    expect(await stored()).toMatchObject({ last_failure_at: null, last_error_code: null });
  });

  it("R2 down: the run still ends 'failed' and never throws", async () => {
    captureErrors();
    expect(await backupRun({ ...env, FILES: brokenFiles() }, at("2031-04-06"))).toBe("failed");
  });

  it("the read is stale with no object, after 36 hours, and not before", async () => {
    expect(await rest()).toEqual({
      last_success_at: null,
      last_failure_at: null,
      last_error_code: null,
      stale: true,
    });
    const put = (h: number) =>
      env.FILES.put(
        STATUS_KEY,
        JSON.stringify({
          last_success_at: hoursAgo(h),
          last_failure_at: null,
          last_error_code: null,
        }),
      );
    await put(37);
    expect((await rest()).stale).toBe(true);
    await put(35);
    expect((await rest()).stale).toBe(false);
  });

  it("the read reports a failure and is fresh when the success is recent", async () => {
    const f = hoursAgo(1);
    await env.FILES.put(
      STATUS_KEY,
      JSON.stringify({
        last_success_at: hoursAgo(20),
        last_failure_at: f,
        last_error_code: "read_failed",
      }),
    );
    expect(await rest()).toEqual({
      last_success_at: expect.any(String),
      last_failure_at: f,
      last_error_code: "read_failed",
      stale: false,
    });
  });

  it("an unreadable object reads as no status", async () => {
    await env.FILES.put(STATUS_KEY, "not json");
    expect((await rest()).stale).toBe(true);
  });

  it("REST = MCP", async () => {
    await env.FILES.put(
      STATUS_KEY,
      JSON.stringify({
        last_success_at: hoursAgo(40),
        last_failure_at: hoursAgo(2),
        last_error_code: "write_failed",
      }),
    );
    const r = await rest();
    expect(r.stale).toBe(true);
    expect(await tool()).toEqual(r);
  });

  it("a failed invocation stays within the R2 bound: the status is one put, no get, and a prune failure keeps this run as the success", async () => {
    await seedPlan(5);
    await backupRun(env, at("2031-05-01"), BIG);
    for (let i = 1; i <= 17; i++) {
      const id = `2030-05-${String(i).padStart(2, "0")}`;
      await env.FILES.put(`${BACKUP_PREFIX}${id}.manifest.json`, "{}");
      await env.FILES.put(`${BACKUP_PREFIX}${id}/parts/00001.ndjson.gz`, "x");
    }
    const c = countingR2();
    const FILES = Object.create(c.FILES) as R2Bucket;
    let deletes = 0;
    // The last of the three prune deletes fails: the run has made its most calls by then.
    FILES.delete = ((...a: Parameters<R2Bucket["delete"]>) => {
      if (++deletes === 3) throw new Error("R2 delete failed");
      return c.FILES.delete(...a);
    }) as R2Bucket["delete"];
    captureErrors();
    expect(await backupRun({ ...env, FILES }, at("2031-05-02"), BIG)).toBe("failed");
    expect(c.total()).toBeLessThanOrEqual(BACKUP_MAX_R2_CALLS);
    expect(c.calls.get).toBe(1);
    const s = await stored();
    // The backup itself finished: only the prune failed, so the success is this run's.
    expect(s.last_error_code).toBe("prune_failed");
    expect(s.last_success_at).toBe("2031-05-02T04:00:00.000Z");
  });

  it("the read is one R2 get, with no list and no D1", async () => {
    const { countingR2 } = await import("./backup-helpers");
    const c = countingR2();
    const { readBackupStatus } = await import("../src/services/backup-status");
    await readBackupStatus({ ...env, FILES: c.FILES });
    expect(c.calls).toEqual({ get: 1, put: 0, head: 0, list: 0, delete: 0 });
  });
});
