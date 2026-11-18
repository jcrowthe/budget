import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import * as accountsRepo from "../src/repositories/accounts";
import * as repo from "../src/repositories/bank-connections";
import * as importsRepo from "../src/repositories/imports";
import { linkAccount, seedConnections } from "./connection-list-helpers";

describe("EXF-881: one-parameter id lists", () => {
  it("deleteUnlistedStmt removes 120 unlisted bank accounts of one connection", async () => {
    const s = await seedConnections("sandbox", 1, 121);
    const conn = s.connections[0];
    if (!conn) throw new Error("no seed");
    await linkAccount(s.plan, conn.bankAccountIds[0] as string);
    const db = getDb(env);
    await db.batch([
      repo.deleteUnlistedStmt(db, conn.id, conn.bankAccountIds, repo.connectionExists(db, conn.id)),
    ]);
    const left = await env.DB.prepare(
      "select count(*) n from bank_accounts where bank_connection_id = ?",
    )
      .bind(conn.id)
      .first<{ n: number }>();
    expect(left?.n).toBe(1);
  });

  it("markMissingStmt marks a link among 60 missing bank accounts", async () => {
    const s = await seedConnections("sandbox", 1, 60);
    const conn = s.connections[0];
    if (!conn) throw new Error("no seed");
    const account = await linkAccount(s.plan, conn.bankAccountIds[59] as string);
    const db = getDb(env);
    const at = "2026-11-18T00:00:00.000Z";
    await db.batch([
      accountsRepo.markMissingStmt(
        db,
        conn.id,
        conn.bankAccountIds,
        at,
        repo.connectionExists(db, conn.id),
      ),
    ]);
    const row = await env.DB.prepare("select link_missing_since s from accounts where id = ?")
      .bind(account)
      .first<{ s: string | null }>();
    expect(row?.s).toBe(at);
  });

  it("livePlanIds answers for 150 plan ids", async () => {
    const s = await seedConnections("sandbox", 1, 1);
    const ids = [s.plan, ...Array.from({ length: 149 }, () => crypto.randomUUID())];
    expect(await importsRepo.livePlanIds(getDb(env), ids)).toEqual(new Set([s.plan]));
  });
});
