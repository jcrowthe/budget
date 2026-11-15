import { expect, test } from "./fixtures";
import { authHeaders, testName } from "./support/auth";

test("REST slice: create, list, patch, delete, idempotency", async ({ request }) => {
  const headers = await authHeaders();
  const name = testName("api");
  const created = await request.post("/api/v1/budgets", { headers, data: { name } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()).data.budget;

  const list = await request.get("/api/v1/budgets", { headers });
  expect((await list.json()).data.budgets.map((b: { id: string }) => b.id)).toContain(id);

  const patched = await request.patch(`/api/v1/budgets/${id}`, {
    headers,
    data: { name: `${name} b` },
  });
  expect((await patched.json()).data.budget.name).toBe(`${name} b`);

  expect((await request.delete(`/api/v1/budgets/${id}`, { headers })).status()).toBe(200);
  const gone = await request.get(`/api/v1/budgets/${id}`, { headers });
  expect(gone.status()).toBe(404);
  expect(await gone.json()).toMatchObject({ error: { id: "404", name: "not_found" } });

  const empty = await request.post("/api/v1/budgets", { headers, data: { name: "" } });
  expect(empty.status()).toBe(400);

  const key = { ...headers, "Idempotency-Key": `k-${Date.now()}-${Math.random()}` };
  const first = await request.post("/api/v1/budgets", {
    headers: key,
    data: { name: testName("idem") },
  });
  const body = await first.json();
  const second = await request.post("/api/v1/budgets", {
    headers: key,
    data: { name: body.data.budget.name },
  });
  expect(second.headers()["idempotent-replayed"]).toBe("true");
  expect((await second.json()).data.budget.id).toBe(body.data.budget.id);
  const other = await request.post("/api/v1/budgets", {
    headers: key,
    data: { name: testName("diff") },
  });
  expect(other.status()).toBe(422);
});

test("the OpenAPI document lists the registered routes", async ({ request }) => {
  const res = await request.get("/api/v1/openapi.json", { headers: await authHeaders() });
  const paths = Object.keys((await res.json()).paths);
  expect(paths).toEqual(
    expect.arrayContaining(["/api/v1/budgets", "/api/v1/budgets/{id}", "/api/v1/health"]),
  );
});
