import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { authed, call } from "./helpers";

const post = async (key: string, body: unknown) =>
  call(
    "/api/v1/budgets",
    await authed({
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  );

describe("idempotency", () => {
  it("replays the same response for the same key and body", async () => {
    const a = await post("k1", { name: "ZZ-TEST idem" });
    const b = await post("k1", { name: "ZZ-TEST idem" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    expect(a.headers.get("Idempotent-Replayed")).toBeNull();
    const ida = (await a.json()) as { data: { budget: { id: string } } };
    const idb = (await b.json()) as { data: { budget: { id: string } } };
    expect(idb.data.budget.id).toBe(ida.data.budget.id);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM budgets WHERE name = 'ZZ-TEST idem'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
  it("rejects the same key with a different body", async () => {
    await post("k2", { name: "ZZ-TEST one" });
    const res = await post("k2", { name: "ZZ-TEST two" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { name: string } }).error.name).toBe(
      "idempotency_key_reused",
    );
  });
  it("treats rows older than 24 h as absent", async () => {
    await post("k3", { name: "ZZ-TEST old" });
    await env.DB.prepare(
      "UPDATE idempotency_keys SET created_at = '2000-01-01T00:00:00.000Z' WHERE key = 'k3'",
    ).run();
    const res = await post("k3", { name: "ZZ-TEST old again" });
    expect(res.status).toBe(201);
    expect(res.headers.get("Idempotent-Replayed")).toBeNull();
  });
});

describe("idempotency under concurrency", () => {
  it("two concurrent same-key POSTs create exactly one plan", async () => {
    const [a, b] = await Promise.all([
      post("race1", { name: "ZZ-TEST race1" }),
      post("race1", { name: "ZZ-TEST race1" }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM budgets WHERE name = 'ZZ-TEST race1'",
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});
