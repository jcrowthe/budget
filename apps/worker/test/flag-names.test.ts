import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../src/db/client";
import { budgets } from "../src/db/schema/budgets";
import type { Env } from "../src/env";
import { setFlagNames } from "../src/services/budgets";
import { actor, type Json, logs, mcp, plan, send } from "./category-helpers";
import { listedToolNames } from "./surface";

// EXF-480: flag_names on the plan. Per-colour custom names, null = the colour's own name.

const NONE = { red: null, orange: null, yellow: null, green: null, blue: null, purple: null };
const patch = (id: string, body: unknown) => send("PATCH", `/api/v1/budgets/${id}`, body);
const read = async (id: string) =>
  ((await (await send("GET", `/api/v1/budgets/${id}`)).json()) as Json).data.budget as Json;
const column = async (id: string) =>
  (await getDb(env).select().from(budgets).where(eq(budgets.id, id)))[0]?.flagNames;
const names = async (id: string, body: unknown) =>
  ((await (await patch(id, body)).json()) as Json).data.budget.flag_names as Json;

describe("flag_names over REST", () => {
  it("is all null on a new plan, in GET and in the list", async () => {
    const bid = await plan();
    expect((await read(bid)).flag_names).toEqual(NONE);
    const list = ((await (await send("GET", "/api/v1/budgets")).json()) as Json).data.budgets;
    expect(list.find((b: Json) => b.id === bid).flag_names).toEqual(NONE);
    expect(await column(bid)).toBeNull();
  });

  it("sets a trimmed name and leaves the others null; GET agrees", async () => {
    const bid = await plan();
    const res = await patch(bid, { flag_names: { red: "  Tax  " } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.budget.flag_names).toEqual({ ...NONE, red: "Tax" });
    expect((await read(bid)).flag_names).toEqual({ ...NONE, red: "Tax" });
    expect(await column(bid)).toBe('{"red":"Tax"}');
  });

  it("merges: a second patch keeps the first name", async () => {
    const bid = await plan();
    await patch(bid, { flag_names: { red: "Tax" } });
    expect(await names(bid, { flag_names: { blue: "Bills" } })).toEqual({
      ...NONE,
      red: "Tax",
      blue: "Bills",
    });
  });

  it("empty, blank and null each clear one colour; flag_names null resets all and stores NULL", async () => {
    const bid = await plan();
    for (const cleared of ["", "   ", null]) {
      await patch(bid, { flag_names: { red: "Tax", green: "Keep" } });
      expect(await names(bid, { flag_names: { red: cleared } })).toEqual({
        ...NONE,
        green: "Keep",
      });
    }
    expect(await column(bid)).toBe('{"green":"Keep"}');
    expect(await names(bid, { flag_names: null })).toEqual(NONE);
    expect(await column(bid)).toBeNull();
  });

  it("clearing the last name stores NULL", async () => {
    const bid = await plan();
    await patch(bid, { flag_names: { red: "Tax" } });
    await patch(bid, { flag_names: { red: "" } });
    expect(await column(bid)).toBeNull();
  });

  it("limits the trimmed name to 50: 51 is 422 and writes nothing, 50 and padded 50 pass", async () => {
    const bid = await plan();
    const before = (await logs(bid, "budget")).length;
    const bad = await patch(bid, { flag_names: { red: "x".repeat(51) } });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { name: "flag_name_too_long" } });
    expect((await read(bid)).flag_names).toEqual(NONE);
    expect((await logs(bid, "budget")).length).toBe(before);
    expect(await names(bid, { flag_names: { red: "y".repeat(50) } })).toMatchObject({
      red: "y".repeat(50),
    });
    expect(await names(bid, { flag_names: { blue: ` ${"z".repeat(50)} ` } })).toMatchObject({
      blue: "z".repeat(50),
    });
  });

  it("refuses an unknown colour and writes nothing", async () => {
    const bid = await plan();
    const before = (await logs(bid, "budget")).length;
    const res = await patch(bid, { flag_names: { pink: "x" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await read(bid)).flag_names).toEqual(NONE);
    expect((await logs(bid, "budget")).length).toBe(before);
  });

  it("logs one change_log row per patch, with the actor and the names", async () => {
    const bid = await plan();
    const before = (await logs(bid, "budget")).length;
    await patch(bid, { flag_names: { red: "Tax" } });
    const rows = await logs(bid, "budget");
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1] as NonNullable<(typeof rows)[number]>;
    expect(last.actor).toBe(actor);
    expect(JSON.parse(last.before_json ?? "{}").flag_names).toEqual(NONE);
    expect(JSON.parse(last.after_json ?? "{}").flag_names).toEqual({ ...NONE, red: "Tax" });
  });
});

describe("update_flag_names (MCP)", () => {
  it("gives the same budget.flag_names as REST, merges, resets, logs the mcp actor", async () => {
    const bid = await plan();
    const r = await mcp("update_flag_names", { budget_id: bid, flag_names: { red: " Tax " } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.budget.flag_names).toEqual({ ...NONE, red: "Tax" });
    expect(r.structuredContent.budget.flag_names).toEqual((await read(bid)).flag_names);
    const rest = await plan();
    expect(await names(rest, { flag_names: { red: " Tax " } })).toEqual(
      r.structuredContent.budget.flag_names,
    );
    expect((await logs(bid, "budget")).at(-1)?.actor).toMatch(/^mcp:/);
    const m = await mcp("update_flag_names", { budget_id: bid, flag_names: { blue: "Bills" } });
    expect(m.structuredContent.budget.flag_names).toEqual({ ...NONE, red: "Tax", blue: "Bills" });
    const reset = await mcp("update_flag_names", { budget_id: bid, flag_names: null });
    expect(reset.structuredContent.budget.flag_names).toEqual(NONE);
  });

  it("a too-long name is a tool error and changes nothing", async () => {
    const bid = await plan();
    const before = (await logs(bid, "budget")).length;
    const bad = await mcp("update_flag_names", {
      budget_id: bid,
      flag_names: { red: "x".repeat(51) },
    });
    expect(bad.isError).toBe(true);
    expect((await read(bid)).flag_names).toEqual(NONE);
    expect((await logs(bid, "budget")).length).toBe(before);
  });

  it("the service refuses an unknown colour with 422 unknown_flag_color", async () => {
    const bid = await plan();
    await expect(setFlagNames(env, actor, bid, { pink: "x" } as never)).rejects.toMatchObject({
      status: 422,
      code: "unknown_flag_color",
    });
    expect((await read(bid)).flag_names).toEqual(NONE);
  });

  it("is listed among the tools", async () => {
    expect(await listedToolNames()).toEqual(expect.arrayContaining(["update_flag_names"]));
  });
});

/** `env` whose database counts each executed statement and each batch as one call. */
function counting(): { env: Env; calls: () => number; batches: () => number } {
  let n = 0;
  let b = 0;
  const real = new WeakMap<object, D1PreparedStatement>();
  const wrap = (st: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(st, {
      get(t, k) {
        if (k === "bind") return (...a: unknown[]) => wrap(t.bind(...a));
        const v = (t as unknown as Record<string | symbol, unknown>)[k];
        if (k === "run" || k === "all" || k === "first" || k === "raw") {
          return (...a: unknown[]) => {
            n += 1;
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
    real.set(proxy, st);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(t, k) {
      if (k === "prepare") return (q: string) => wrap(t.prepare(q));
      if (k === "batch") {
        return (list: D1PreparedStatement[]) => {
          n += 1;
          b += 1;
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n, batches: () => b };
}

describe("flag_names: D1 calls", () => {
  it("the patch is one batch and a fixed number of calls", async () => {
    const seen: number[] = [];
    for (const input of [
      { red: "Tax" },
      { red: "A", orange: "B", yellow: "C", green: "D", blue: "E", purple: "F" },
    ]) {
      const bid = await plan();
      const c = counting();
      const b = await setFlagNames(c.env, actor, bid, input);
      expect(b.flag_names.red).toBe(input.red);
      expect(c.batches()).toBe(1);
      seen.push(c.calls());
    }
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toBeLessThanOrEqual(3);
  });

  it("reads make the same calls with 0 and 6 names set, and with 1 and 10 plans", async () => {
    const { getBudget, listBudgets } = await import("../src/services/budgets");
    const bid = await plan();
    const run = async () => {
      const g = counting();
      await getBudget(g.env, bid);
      const l = counting();
      await listBudgets(l.env);
      return [g.calls(), l.calls()];
    };
    const zero = await run();
    await setFlagNames(env, actor, bid, {
      red: "A",
      orange: "B",
      yellow: "C",
      green: "D",
      blue: "E",
      purple: "F",
    });
    expect(await run()).toEqual(zero);
    for (let i = 0; i < 9; i++) await setFlagNames(env, actor, await plan(), { red: `T${i}` });
    expect(await run()).toEqual(zero);
  });
});
