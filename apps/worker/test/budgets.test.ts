import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { buildCreateBatch } from "../src/services/budgets";
import { json } from "./helpers";

type B = {
  data: {
    budget: {
      id: string;
      name: string;
      created_at: string;
      last_modified_on: string;
      last_opened_at: string | null;
    };
  };
};

describe("budgets REST", () => {
  it("creates, lists, patches, deletes and logs every change", async () => {
    const created = await json("/api/v1/budgets", { method: "POST" }, { name: "ZZ-TEST A" });
    expect(created.status).toBe(201);
    const { id, name } = ((await created.json()) as B).data.budget;
    expect(name).toBe("ZZ-TEST A");

    const list = (await (await json("/api/v1/budgets")).json()) as {
      data: { budgets: { id: string }[] };
    };
    expect(list.data.budgets.map((b) => b.id)).toContain(id);

    const patched = await json(
      `/api/v1/budgets/${id}`,
      { method: "PATCH" },
      { name: "ZZ-TEST A2" },
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as B).data.budget.name).toBe("ZZ-TEST A2");

    const del = await json(`/api/v1/budgets/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    const gone = await json(`/api/v1/budgets/${id}`);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toMatchObject({ error: { id: "404", name: "not_found" } });
    const list2 = (await (await json("/api/v1/budgets")).json()) as {
      data: { budgets: { id: string }[] };
    };
    expect(list2.data.budgets.map((b) => b.id)).not.toContain(id);

    const { results } = await env.DB.prepare(
      "SELECT action, actor, before_json, after_json FROM change_log WHERE budget_id = ? ORDER BY created_at, rowid",
    )
      .bind(id)
      .all<{
        action: string;
        actor: string;
        before_json: string | null;
        after_json: string | null;
      }>();
    expect(results.map((r) => r.action)).toEqual(["create", "update", "delete"]);
    expect(results.every((r) => r.actor === "user:tester@localhost")).toBe(true);
    expect(results[0]?.before_json).toBeNull();
    expect(JSON.parse(results[0]?.after_json ?? "{}").name).toBe("ZZ-TEST A");
    expect(JSON.parse(results[1]?.before_json ?? "{}").name).toBe("ZZ-TEST A");
    expect(JSON.parse(results[1]?.after_json ?? "{}").name).toBe("ZZ-TEST A2");
    expect(results[2]?.after_json).toBeNull();
  });

  it("rejects an empty name with the error envelope", async () => {
    const res = await json("/api/v1/budgets", { method: "POST" }, { name: "   " });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { id: string; name: string; detail: string } };
    expect(body.error.id).toBe("400");
    expect(body.error.name).toBe("bad_request");
  });

  it("returns 404 for an unknown plan", async () => {
    const res = await json(
      `/api/v1/budgets/${crypto.randomUUID()}`,
      { method: "PATCH" },
      { name: "x" },
    );
    expect(res.status).toBe(404);
  });

  it("answers health with the deploy sha", async () => {
    const res = await json("/api/v1/health");
    expect(await res.json()).toEqual({ status: "ok", deploy_sha: "test" });
  });

  it("is atomic: a failing change_log insert leaves no budget row", async () => {
    const db = getDb(env);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const batch = buildCreateBatch(
      db,
      {
        id,
        name: "ZZ-TEST atomic",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        lastOpenedAt: null,
      },
      {
        budgetId: id,
        actor: "t",
        // violates the CHECK constraint on change_log.action
        action: "bogus" as "create",
        entityType: "budget",
        entityId: id,
        before: null,
        after: null,
      },
    );
    await expect(db.batch([...batch])).rejects.toThrow();
    const row = await env.DB.prepare("SELECT 1 AS x FROM budgets WHERE id = ?").bind(id).first();
    expect(row).toBeNull();
  });
});

describe("last_opened_at (EXF-475)", () => {
  const make = async (name: string) =>
    ((await (await json("/api/v1/budgets", { method: "POST" }, { name })).json()) as B).data.budget;
  const logActions = async (id: string) =>
    (
      await env.DB.prepare("SELECT action FROM change_log WHERE budget_id = ? ORDER BY rowid")
        .bind(id)
        .all<{ action: string }>()
    ).results.map((r) => r.action);
  const open = (id: string) => json(`/api/v1/budgets/${id}`, { method: "PATCH" }, { opened: true });

  it("is null on a new plan in create, get and list", async () => {
    const b = await make("ZZ-TEST N0");
    expect(b.last_opened_at).toBeNull();
    const got = (await (await json(`/api/v1/budgets/${b.id}`)).json()) as B;
    expect(got.data.budget.last_opened_at).toBeNull();
    const list = (await (await json("/api/v1/budgets")).json()) as {
      data: { budgets: B["data"]["budget"][] };
    };
    expect(list.data.budgets.find((x) => x.id === b.id)?.last_opened_at).toBeNull();
  });

  it("opened:true stamps last_opened_at without a change or a modified bump", async () => {
    const b = await make("ZZ-TEST N1");
    const res = await open(b.id);
    expect(res.status).toBe(200);
    const o = ((await res.json()) as B).data.budget;
    expect(Math.abs(Date.parse(o.last_opened_at ?? "") - Date.now())).toBeLessThan(10_000);
    expect(o.last_modified_on).toBe(b.last_modified_on);
    const got = (await (await json(`/api/v1/budgets/${b.id}`)).json()) as B;
    expect(got.data.budget.last_opened_at).toBe(o.last_opened_at);
    expect(got.data.budget.last_modified_on).toBe(b.last_modified_on);
    const list = (await (await json("/api/v1/budgets")).json()) as {
      data: { budgets: B["data"]["budget"][] };
    };
    expect(list.data.budgets.find((x) => x.id === b.id)?.last_opened_at).toBe(o.last_opened_at);
    expect(await logActions(b.id)).toEqual(["create"]);
  });

  it("rejects anything but true with a 400", async () => {
    const b = await make("ZZ-TEST N3");
    for (const opened of [false, "yes"]) {
      const res = await json(`/api/v1/budgets/${b.id}`, { method: "PATCH" }, { opened });
      expect(res.status).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
  });

  it("is a 404 for an unknown or deleted plan", async () => {
    expect((await open(crypto.randomUUID())).status).toBe(404);
    const b = await make("ZZ-TEST N4");
    await json(`/api/v1/budgets/${b.id}`, { method: "DELETE" });
    expect((await open(b.id)).status).toBe(404);
  });

  it("with a name, changes both and logs exactly one update", async () => {
    const b = await make("ZZ-TEST N5");
    const res = await json(
      `/api/v1/budgets/${b.id}`,
      { method: "PATCH" },
      { name: "ZZ-TEST N2", opened: true },
    );
    expect(res.status).toBe(200);
    const o = ((await res.json()) as B).data.budget;
    expect(o.name).toBe("ZZ-TEST N2");
    expect(o.last_opened_at).not.toBeNull();
    expect(await logActions(b.id)).toEqual(["create", "update"]);
  });

  it("a second open is not earlier than the first", async () => {
    const b = await make("ZZ-TEST N6");
    const a = ((await (await open(b.id)).json()) as B).data.budget.last_opened_at ?? "";
    const c = ((await (await open(b.id)).json()) as B).data.budget.last_opened_at ?? "";
    expect(c >= a).toBe(true);
  });
});

describe("concurrency", () => {
  it("two concurrent deletes: one 200, one 404 (or 409), exactly one delete log row", async () => {
    const created = await json("/api/v1/budgets", { method: "POST" }, { name: "ZZ-TEST race-del" });
    const id = ((await created.json()) as B).data.budget.id;
    const [a, b] = await Promise.all([
      json(`/api/v1/budgets/${id}`, { method: "DELETE" }),
      json(`/api/v1/budgets/${id}`, { method: "DELETE" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([404, 409]).toContain(statuses[1]);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ? AND action = 'delete'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("concurrent patches never log a change that did not happen", async () => {
    const created = await json(
      "/api/v1/budgets",
      { method: "POST" },
      { name: "ZZ-TEST race-patch" },
    );
    const id = ((await created.json()) as B).data.budget.id;
    const rs = await Promise.all(
      ["ZZ-TEST p1", "ZZ-TEST p2"].map((name) =>
        json(`/api/v1/budgets/${id}`, { method: "PATCH" }, { name }),
      ),
    );
    const ok = rs.filter((r) => r.status === 200).length;
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM change_log WHERE entity_id = ? AND action = 'update'",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(row?.n).toBe(ok);
    expect(ok).toBeGreaterThanOrEqual(1);
  });
});
