import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { backupRun } from "../../apps/worker/src/services/backup";
import { BACKUP_CRON, BACKUP_PREFIX } from "../../packages/schema/src/backup";

const root = new URL("../..", import.meta.url).pathname;
const configPath = `${root}apps/worker/wrangler.jsonc`;
const temps: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), `${p}-`));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

const sh = (args: string[], env: Record<string, string> = {}) =>
  spawnSync("bash", ["scripts/restore-backup.sh", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
  });

describe("restore-backup.sh refuses before it calls wrangler (EXF-976)", () => {
  const bin = tmp("restore-bin");
  const log = join(bin, "calls.log");
  for (const name of ["pnpm", "wrangler"]) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const run = (args: string[]) => sh(args, { PATH: `${bin}:${process.env.PATH}` });

  const cases: [string, string[]][] = [
    [
      "restore --remote without the flag",
      ["restore", "--from", "x", "--remote", "--database", "d"],
    ],
    ["fetch --remote without the flag", ["fetch", "2031-01-01", "--out", "x", "--remote"]],
    ["no target", ["restore", "--from", "x"]],
    ["--local without --persist-to", ["restore", "--from", "x", "--local"]],
    [
      "--local with a relative --persist-to",
      ["restore", "--from", "x", "--local", "--persist-to", "rel"],
    ],
    ["both targets", ["restore", "--from", "x", "--local", "--remote", "--persist-to", "/a"]],
    ["an unknown flag", ["restore", "--from", "x", "--local", "--persist-to", "/a", "--force"]],
    ["an unknown command", ["wipe", "--local"]],
  ];
  for (const [name, args] of cases) {
    it(`refuses ${name}`, () => {
      const r = run(args);
      expect(r.status).toBe(2);
      expect(existsSync(log)).toBe(false);
    });
  }
  it("names the flag and the owner's approval", () => {
    const r = run(["restore", "--from", "x", "--remote", "--database", "d"]);
    expect(r.stderr).toContain("--confirm-remote-production");
    expect(r.stderr).toContain("owner's");
  });
  it("lets a confirmed remote target through to wrangler's step (it is the fake here)", () => {
    // Not a real remote: pnpm is the fake above. Proves the guard is the flag, and nothing else.
    const r = run([
      "fetch",
      "2031-01-01",
      "--out",
      tmp("restore-out"),
      "--remote",
      "--confirm-remote-production",
    ]);
    expect(r.stderr).not.toContain("needs --confirm-remote-production");
  });
});

describe("wrangler.jsonc crons", () => {
  it("are the six-hourly one and the backup's", () => {
    const text = readFileSync(configPath, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const crons = JSON.parse(text).triggers.crons;
    expect(crons).toEqual(["0 3,9,15,21 * * *", BACKUP_CRON]);
  });
});

describe("backup then restore into an empty local D1 (EXF-976 A2)", () => {
  it("reproduces every table row for row", { timeout: 180_000 }, async () => {
    const A = tmp("restore-A");
    const B = tmp("restore-B");
    const D = tmp("restore-D");
    const migrate = spawnSync("bash", ["scripts/db-migrate-local.sh", A], {
      cwd: root,
      encoding: "utf8",
    });
    expect(migrate.status, migrate.stderr).toBe(0);

    const proxy = await getPlatformProxy<{ DB: D1Database; FILES: R2Bucket; DEPLOY_SHA: string }>({
      configPath,
      persist: { path: `${A}/v3` },
    });
    let id = "";
    try {
      const db = proxy.env.DB;
      const now = "2031-05-01T00:00:00.000Z";
      await db.batch([
        db
          .prepare(
            "insert into budgets (id, name, created_at, updated_at) values ('zz-b', 'ZZ-TEST plan', ?, ?)",
          )
          .bind(now, now),
      ]);
      await db.batch([
        db
          .prepare(
            "insert into accounts (id, budget_id, name, type, on_budget, sort_order, created_at) values ('zz-a', 'zz-b', 'ZZ ''Quoted'' Account', 'checking', 1, 0, ?)",
          )
          .bind(now),
        db
          .prepare(
            "insert into payees (id, budget_id, name, hidden, created_at, updated_at) values ('zz-p', 'zz-b', 'ZZ Ünï «payee» 日本', 0, ?, ?)",
          )
          .bind(now, now),
        ...[
          [-1234, 'it\'s "ZZ"', "zz-p"],
          [5000.5, null, null],
          [-1, "line\nbreak; drop table x;--", "zz-p"],
        ].map(([amount, memo, payee], i) =>
          db
            .prepare(
              "insert into transactions (id, budget_id, account_id, date, amount, cleared, approved, created_at, updated_at, payee_id, payee_name, memo) values (?, 'zz-b', 'zz-a', '2031-05-01', ?, 'cleared', 1, ?, ?, ?, 'ZZ payee', ?)",
            )
            .bind(`zz-t${i}`, amount, now, now, payee, memo),
        ),
        db
          .prepare(
            "insert into secrets (name, ciphertext, iv, key_version, created_at, updated_at) values ('zz-restore', ?, ?, 1, ?, ?)",
          )
          .bind(new Uint8Array([0, 255, 39, 10]), new Uint8Array([1, 2, 3]), now, now),
      ]);
      const env = { ...proxy.env, DEPLOY_SHA: "test" } as never;
      const when = new Date("2031-05-02T04:00:00Z");
      for (let i = 0; i < 30 && !id; i++) {
        await backupRun(env, when);
        if (await proxy.env.FILES.head(`${BACKUP_PREFIX}2031-05-02.manifest.json`))
          id = "2031-05-02";
      }
      expect(id).toBe("2031-05-02");
    } finally {
      await proxy.dispose();
    }

    const fetched = sh(["fetch", id, "--out", D, "--local", "--persist-to", A]);
    expect(fetched.status, fetched.stderr).toBe(0);
    const restored = sh(["restore", "--from", D, "--local", "--persist-to", B]);
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stdout).toContain("restored 2031-05-02");
    expect(restored.stdout).not.toContain("ZZ");

    const again = sh(["restore", "--from", D, "--local", "--persist-to", B]);
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain("not empty");

    const pa = await getPlatformProxy<{ DB: D1Database }>({
      configPath,
      persist: { path: `${A}/v3` },
    });
    const pb = await getPlatformProxy<{ DB: D1Database }>({
      configPath,
      persist: { path: `${B}/v3` },
    });
    try {
      const tables = (
        await pa.env.DB.prepare(
          "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' order by name",
        ).all<{ name: string }>()
      ).results.map((r) => r.name);
      expect(tables).toHaveLength(27);
      const rows = async (d: D1Database, t: string) =>
        JSON.stringify(
          (await d.prepare(`select rowid as __r, * from "${t}" order by rowid`).all()).results,
        );
      for (const t of tables) expect(await rows(pb.env.DB, t), t).toBe(await rows(pa.env.DB, t));
      const idx = async (d: D1Database) =>
        JSON.stringify(
          (
            await d
              .prepare(
                "select name, tbl_name from sqlite_master where type = 'index' and sql is not null order by name",
              )
              .all()
          ).results,
        );
      expect(await idx(pb.env.DB)).toBe(await idx(pa.env.DB));
      const probe = await pb.env.DB.prepare(
        "select count(*) n from transactions where id like 'zz-t%'",
      ).first<{ n: number }>();
      expect(probe?.n).toBe(3);
    } finally {
      await pa.dispose();
      await pb.dispose();
    }
  });
});
