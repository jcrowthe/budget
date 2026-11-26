import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { getSettings, updateSettings } from "../src/services/settings";
import { call, localToken } from "./helpers";
import { operations as settingsCoverage } from "./mcp-coverage/settings";
import { apiPaths, listedToolNames } from "./surface";

const DEFAULTS = { theme: "dark", progress_bars: true, balance_style: "default" };

const newActor = () => `zz-test-${crypto.randomUUID()}@localhost`;

async function asUser(email: string, path: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "Cf-Access-Jwt-Assertion": await localToken({ email }) });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return call(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const get = (email: string) => asUser(email, "/api/v1/settings");
const patch = (email: string, body: unknown) => asUser(email, "/api/v1/settings", "PATCH", body);

const rowsFor = async (email: string) =>
  (await env.DB.prepare("select * from user_settings where actor = ?").bind(`user:${email}`).all())
    .results;
const logFor = async (email: string) =>
  (
    await env.DB.prepare(
      "select * from change_log where entity_type = 'user_settings' and entity_id = ? order by created_at, rowid",
    )
      .bind(`user:${email}`)
      .all<Record<string, unknown>>()
  ).results;

/** `env` whose database counts each executed statement and each batch as one call. */
function counting(): { env: Env; calls: () => number } {
  let n = 0;
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
          return t.batch(list.map((s) => real.get(s) ?? s));
        };
      }
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { env: { ...env, DB: db } as Env, calls: () => n };
}

describe("settings: surface and the MCP parity decision (EXF-472)", () => {
  it("is in the API and has no MCP tool", async () => {
    expect(await apiPaths()).toContain("/api/v1/settings");
    const tools = await listedToolNames();
    expect(tools).not.toContain("get_settings");
    expect(tools).not.toContain("update_settings");
  });

  it("both operations are recorded as exclusions (interface state)", () => {
    for (const k of ["GET /settings", "PATCH /settings"] as const) {
      const c = settingsCoverage[k] as { excluded?: string; tool?: unknown } | undefined;
      expect(c?.excluded).toMatch(/interface state/);
      expect(c?.tool).toBeUndefined();
    }
  });
});

describe("GET/PATCH /settings (EXF-472)", () => {
  it("a new actor reads the defaults and no row is written", async () => {
    const u = newActor();
    const res = await get(u);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: DEFAULTS });
    expect(await rowsFor(u)).toHaveLength(0);
  });

  it("a partial PATCH merges and GET reflects it", async () => {
    const u = newActor();
    const r1 = await patch(u, { theme: "default" });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ data: { ...DEFAULTS, theme: "default" } });
    expect(await (await get(u)).json()).toEqual({ data: { ...DEFAULTS, theme: "default" } });
    const r2 = await patch(u, {
      progress_bars: false,
      balance_style: "differentiate_without_color",
    });
    expect(await r2.json()).toEqual({
      data: {
        theme: "default",
        progress_bars: false,
        balance_style: "differentiate_without_color",
      },
    });
    const r3 = await patch(u, { theme: "match_system" });
    expect((await r3.json()) as { data: unknown }).toEqual({
      data: {
        theme: "match_system",
        progress_bars: false,
        balance_style: "differentiate_without_color",
      },
    });
  });

  it.each([
    { theme: "light" },
    { progress_bars: "no" },
    { balance_style: "x" },
    { nope: 1 },
    "text",
    [1],
  ])("rejects %j with 422 and changes nothing", async (body) => {
    const u = newActor();
    await patch(u, { theme: "default" });
    const res = await patch(u, body);
    expect(res.status).toBe(422);
    expect(await (await get(u)).json()).toEqual({ data: { ...DEFAULTS, theme: "default" } });
    expect(await logFor(u)).toHaveLength(1);
  });

  it("an empty body returns the current values and writes no change_log row", async () => {
    const u = newActor();
    const res = await patch(u, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: DEFAULTS });
    expect(await logFor(u)).toHaveLength(0);
    expect(await rowsFor(u)).toHaveLength(0);
  });

  it("each non-empty PATCH writes one change_log row: create, then update", async () => {
    const u = newActor();
    await patch(u, { theme: "default" });
    await patch(u, { progress_bars: false });
    const log = await logFor(u);
    expect(log).toHaveLength(2);
    for (const r of log) {
      expect(r.budget_id).toBeNull();
      expect(r.entity_type).toBe("user_settings");
      expect(r.entity_id).toBe(`user:${u}`);
      expect(r.actor).toBe(`user:${u}`);
    }
    expect(log.map((r) => r.action)).toEqual(["create", "update"]);
    expect(JSON.parse(log[0]?.after_json as string)).toMatchObject({ theme: "default" });
    expect(JSON.parse(log[1]?.before_json as string)).toMatchObject({ progress_bars: true });
    expect(JSON.parse(log[1]?.after_json as string)).toMatchObject({
      theme: "default",
      progress_bars: false,
    });
  });

  it("settings are per actor", async () => {
    const a = newActor();
    const b = newActor();
    await patch(a, { theme: "default", progress_bars: false });
    expect(await (await get(b)).json()).toEqual({ data: DEFAULTS });
  });
});

describe("settings: D1 calls", () => {
  it("GET is 1 call; PATCH is 1 read and 1 batch", async () => {
    const actor = `user:${newActor()}`;
    const g = counting();
    await getSettings(g.env, actor);
    expect(g.calls()).toBe(1);
    const p = counting();
    await updateSettings(p.env, actor, { theme: "default" });
    expect(p.calls()).toBe(2);
    const q = counting();
    await updateSettings(q.env, actor, { theme: "dark" });
    expect(q.calls()).toBe(2);
  });
});
