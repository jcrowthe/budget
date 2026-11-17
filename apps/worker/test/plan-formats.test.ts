import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { json } from "./helpers";
import { apiPaths, mcpRpc } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const patch = (id: string, body: unknown) =>
  json(`/api/v1/budgets/${id}`, { method: "PATCH" }, body);
const read = async (id: string): Promise<Json> =>
  ((await (await json(`/api/v1/budgets/${id}`)).json()) as Json).data.budget;
async function make(body: Record<string, unknown> = {}): Promise<string> {
  const res = await json(
    "/api/v1/budgets",
    { method: "POST" },
    { name: `ZZ-TEST ${crypto.randomUUID()}`, ...body },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as Json).data.budget.id;
}
const logCount = async (id: string) =>
  (
    await env.DB.prepare(
      "select count(*) as n from change_log where entity_type = 'budget' and entity_id = ? and action = 'update'",
    )
      .bind(id)
      .first<{ n: number }>()
  )?.n ?? 0;
async function mcp(name: string, args: Record<string, unknown>): Promise<Json> {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  return (await mcpRpc("tools/call", { name, arguments: args }, 2)).body.result;
}

const DEFAULT_CF = {
  iso_code: "USD",
  example_format: "123,456.78",
  decimal_digits: 2,
  decimal_separator: ".",
  group_separator: ",",
  symbol_first: true,
  currency_symbol: "$",
  display_symbol: true,
};

describe("plan formats: REST", () => {
  it("a new plan reads with the defaults, in the list and alone", async () => {
    const id = await make();
    const one = await read(id);
    expect(one.currency_format).toEqual(DEFAULT_CF);
    expect(one.date_format).toEqual({ format: "MM/DD/YYYY" });
    const list = ((await (await json("/api/v1/budgets")).json()) as Json).data.budgets;
    expect(list.find((b: Json) => b.id === id)).toMatchObject({
      currency_format: DEFAULT_CF,
      date_format: { format: "MM/DD/YYYY" },
    });
  });

  it("PATCH takes each field", async () => {
    const id = await make();
    let res = await patch(id, { currency_format: { iso_code: "EUR" } });
    expect(res.status).toBe(200);
    expect((await read(id)).currency_format).toMatchObject({
      iso_code: "EUR",
      currency_symbol: "€",
    });
    res = await patch(id, { currency_format: { example_format: "123.456,78" } });
    expect((await read(id)).currency_format).toMatchObject({
      example_format: "123.456,78",
      decimal_separator: ",",
      group_separator: ".",
    });
    res = await patch(id, { currency_format: { symbol_placement: "after" } });
    expect((await read(id)).currency_format).toMatchObject({
      symbol_first: false,
      display_symbol: true,
    });
    res = await patch(id, { currency_format: { symbol_placement: "none" } });
    expect((await read(id)).currency_format).toMatchObject({ display_symbol: false });
    res = await patch(id, { date_format: { format: "DD.MM.YYYY" } });
    expect(res.status).toBe(200);
    const b = await read(id);
    expect(b.date_format).toEqual({ format: "DD.MM.YYYY" });
    expect(b.currency_format.iso_code).toBe("EUR");
  });

  it("a changed currency takes its defaults and leaves the date format; a date-only PATCH keeps the currency", async () => {
    const id = await make({ date_format: { format: "YYYY-MM-DD" } });
    await patch(id, { currency_format: { iso_code: "SEK" } });
    let b = await read(id);
    expect(b.currency_format).toMatchObject({
      iso_code: "SEK",
      example_format: "123.456,78",
      symbol_first: false,
      currency_symbol: "kr",
    });
    expect(b.date_format).toEqual({ format: "YYYY-MM-DD" });
    await patch(id, { date_format: { format: "DD/MM/YYYY" } });
    b = await read(id);
    expect(b.currency_format.iso_code).toBe("SEK");
    expect(b.date_format.format).toBe("DD/MM/YYYY");
  });

  it("refuses an unknown currency, a number format not offered and an unknown date format; nothing changes", async () => {
    const id = await make();
    const before = await read(id);
    const logs = await logCount(id);
    for (const [body, name] of [
      [{ currency_format: { iso_code: "XXX" } }, "unknown_currency"],
      [
        { currency_format: { iso_code: "JPY", example_format: "123,456.78" } },
        "number_format_not_offered",
      ],
      [{ date_format: { format: "D/M/Y" } }, "unknown_date_format"],
    ] as const) {
      const res = await patch(id, { name: "ZZ-TEST renamed too", ...body });
      expect(res.status).toBe(422);
      const err = ((await res.json()) as Json).error;
      expect(err.name).toBe(name);
      expect(err.detail.length).toBeGreaterThan(10);
    }
    expect(await read(id)).toEqual(before);
    expect(await logCount(id)).toBe(logs);
  });

  it("POST takes the formats and refuses the same way", async () => {
    const id = await make({
      currency_format: { iso_code: "JPY" },
      date_format: { format: "YYYY.MM.DD" },
    });
    const b = await read(id);
    expect(b.currency_format).toMatchObject({
      iso_code: "JPY",
      decimal_digits: 0,
      example_format: "123,456",
    });
    expect(b.date_format.format).toBe("YYYY.MM.DD");
    const bad = await json(
      "/api/v1/budgets",
      { method: "POST" },
      { name: "ZZ-TEST x", currency_format: { iso_code: "ZZZ" } },
    );
    expect(bad.status).toBe(422);
  });

  it("the change_log update row holds the new formats and the actor", async () => {
    const id = await make();
    await patch(id, {
      currency_format: { iso_code: "EUR" },
      date_format: { format: "DD.MM.YYYY" },
    });
    const row = await env.DB.prepare(
      "select actor, after_json as after from change_log where entity_type = 'budget' and entity_id = ? and action = 'update'",
    )
      .bind(id)
      .first<{ actor: string; after: string }>();
    expect(row?.actor).toMatch(/^user:/);
    const after = JSON.parse(row?.after ?? "{}");
    expect(after.currency_format.iso_code).toBe("EUR");
    expect(after.date_format.format).toBe("DD.MM.YYYY");
  });

  it("the surface lists the plan path", async () => {
    expect(await apiPaths()).toEqual(expect.arrayContaining(["/api/v1/budgets/{id}"]));
  });
});

describe("plan formats: MCP", () => {
  it("round trips through create, update, get and list with an mcp actor", async () => {
    const created = await mcp("create_budget", {
      name: `ZZ-TEST ${crypto.randomUUID()}`,
      currency_format: { iso_code: "CHF" },
      date_format: { format: "DD-MM-YYYY" },
    });
    const id = created.structuredContent.budget.id as string;
    expect(created.structuredContent.budget.currency_format).toMatchObject({
      iso_code: "CHF",
      example_format: "123'456.78",
      currency_symbol: "CHF ",
    });
    const upd = await mcp("update_budget", {
      budget_id: id,
      currency_format: { iso_code: "EUR", symbol_placement: "after" },
    });
    expect(upd.structuredContent.budget.currency_format).toMatchObject({
      iso_code: "EUR",
      symbol_first: false,
    });
    expect(upd.structuredContent.budget.date_format).toEqual({ format: "DD-MM-YYYY" });
    const got = await mcp("get_budget", { budget_id: id });
    expect(got.structuredContent).toEqual({ budget: await read(id) });
    const list = await mcp("list_budgets", {});
    expect(list.structuredContent.budgets.find((b: Json) => b.id === id).date_format.format).toBe(
      "DD-MM-YYYY",
    );
    const actors = (
      await env.DB.prepare(
        "select actor from change_log where entity_type = 'budget' and entity_id = ? and action = 'update'",
      )
        .bind(id)
        .all<{ actor: string }>()
    ).results;
    expect(actors.length).toBe(1);
    expect(actors.every((r) => r.actor.startsWith("mcp:"))).toBe(true);
    const bad = await mcp("update_budget", { budget_id: id, currency_format: { iso_code: "XXX" } });
    expect(bad.isError).toBe(true);
  });
});
