import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { account, data, logs, tool } from "./account-helpers";
import { type Json, plan, send } from "./bulk-helpers";
import { apiPaths, listedToolNames } from "./surface";

const V = (b: string, a: string) => `/api/v1/budgets/${b}/accounts/${a}/view_settings`;
const ALL = (b: string) => `/api/v1/budgets/${b}/view_settings/all_accounts`;
const mk = async () => {
  const b = await plan();
  const a = (await account(b, "checking", 0)).id as string;
  return { b, a };
};
const DEFAULTS = {
  preset: "all_dates",
  range_from: null,
  range_to: null,
  show_reconciled: false,
  show_running_balance: false,
  show_flags: true,
  show_images: true,
};

describe("view settings REST (EXF-529)", () => {
  it("answers the defaults, then merges partial updates", async () => {
    const { b, a } = await mk();
    const first = await data(await send(V(b, a), "GET"));
    expect(first.view_settings).toEqual({ account_id: a, ...DEFAULTS });
    const put = await send(V(b, a), "PUT", { show_running_balance: true });
    expect(put.status).toBe(200);
    await send(V(b, a), "PUT", { preset: "this_month" });
    const got = (await data(await send(V(b, a), "GET"))).view_settings;
    expect(got).toEqual({
      account_id: a,
      ...DEFAULTS,
      preset: "this_month",
      show_running_balance: true,
    });
    const range = (
      await data(await send(V(b, a), "PUT", { range_from: "2026-01-01", range_to: "2026-03-01" }))
    ).view_settings;
    expect(range).toMatchObject({
      preset: "custom",
      range_from: "2026-01-01",
      range_to: "2026-03-01",
    });
    const back = (await data(await send(V(b, a), "PUT", { preset: "last_year" }))).view_settings;
    expect(back).toMatchObject({ preset: "last_year", range_from: null, range_to: null });
  });

  it("accepts From later than To", async () => {
    const { b, a } = await mk();
    const res = await send(V(b, a), "PUT", { range_from: "2026-05-01", range_to: "2026-01-01" });
    expect(res.status).toBe(200);
  });

  it("refuses bad combinations with 422", async () => {
    const { b, a } = await mk();
    for (const body of [
      { preset: "custom" },
      { range_from: "2026-01-01" },
      { preset: "this_month", range_from: "2026-01-01", range_to: "2026-02-01" },
      { preset: "someday" },
      { range_from: "2026-01-15", range_to: "2026-02-01" },
      { show_flags: "yes" },
      { unknown: 1 },
    ]) {
      expect((await send(V(b, a), "PUT", body)).status, JSON.stringify(body)).toBe(422);
    }
    expect((await data(await send(V(b, a), "GET"))).view_settings).toEqual({
      account_id: a,
      ...DEFAULTS,
    });
  });

  it("answers 404 for a missing plan, a missing account, another plan's account and a deleted one", async () => {
    const { b, a } = await mk();
    const other = await mk();
    expect((await send(V(crypto.randomUUID(), a), "GET")).status).toBe(404);
    expect((await send(V(b, crypto.randomUUID()), "GET")).status).toBe(404);
    expect((await send(V(b, other.a), "GET")).status).toBe(404);
    expect((await send(V(b, other.a), "PUT", { show_flags: false })).status).toBe(404);
    expect((await send(ALL(crypto.randomUUID()), "GET")).status).toBe(404);
    const del = await send(`/api/v1/budgets/${b}/accounts/${a}`, "DELETE");
    if (del.status === 200 || del.status === 204)
      expect((await send(V(b, a), "GET")).status).toBe(404);
  });

  it("works on a closed account", async () => {
    const { b, a } = await mk();
    const closed = await send(`/api/v1/budgets/${b}/accounts/${a}/close`, "POST");
    expect(closed.status).toBe(200);
    expect((await send(V(b, a), "GET")).status).toBe(200);
    expect((await send(V(b, a), "PUT", { show_flags: false })).status).toBe(200);
  });

  it("keeps All Accounts apart from each account and refuses a running balance there", async () => {
    const { b, a } = await mk();
    await send(V(b, a), "PUT", { show_reconciled: true, show_running_balance: true });
    const all = (await data(await send(ALL(b), "GET"))).view_settings;
    expect(all).toEqual({
      preset: "all_dates",
      range_from: null,
      range_to: null,
      show_reconciled: false,
      show_flags: true,
      show_images: true,
    });
    expect((await send(ALL(b), "PUT", { show_running_balance: true })).status).toBe(422);
    const put = (
      await data(await send(ALL(b), "PUT", { show_reconciled: true, preset: "this_year" }))
    ).view_settings;
    expect(put).toMatchObject({ show_reconciled: true, preset: "this_year" });
    expect(put).not.toHaveProperty("show_running_balance");
    expect((await data(await send(V(b, a), "GET"))).view_settings.preset).toBe("all_dates");
  });

  it("writes one change_log row per write with the actor, and ui-state does not list the keys", async () => {
    const { b, a } = await mk();
    await send(V(b, a), "PUT", { show_flags: false });
    await send(V(b, a), "PUT", { show_images: false });
    await send(ALL(b), "PUT", { show_reconciled: true });
    const rows = (await logs(a)).filter((r: Json) => r.entity_type === "view_settings");
    expect(rows).toHaveLength(2);
    expect(rows.map((r: Json) => r.action)).toEqual(["create", "update"]);
    expect(rows[0]).toMatchObject({ actor: "user:tester@localhost", entity_type: "view_settings" });
    expect(JSON.parse(rows[0].before_json).show_flags).toBe(true);
    expect(JSON.parse(rows[0].after_json).show_flags).toBe(false);
    expect(JSON.parse(rows[1].after_json)).toMatchObject({ show_flags: false, show_images: false });
    const all = await logs("all_accounts");
    expect(all.some((r: Json) => r.entity_type === "view_settings" && r.action === "create")).toBe(
      true,
    );
    const ui = (await data(await send(`/api/v1/budgets/${b}/ui-state`, "GET"))).ui_state;
    expect(ui).toEqual({});
  });
});

describe("overlapping writes (EXF-529 review)", () => {
  it("two PUTs of different fields at once keep both fields and log create, then update", async () => {
    for (const scope of ["account", "all"]) {
      const { b, a } = await mk();
      const url = scope === "account" ? V(b, a) : ALL(b);
      const id = scope === "account" ? a : "all_accounts";
      const bodies = [{ show_flags: false }, { show_images: false }];
      const res = await Promise.all(bodies.map((body) => send(url, "PUT", body)));
      expect(res.map((r) => r.status)).toEqual([200, 200]);
      const got = (await data(await send(url, "GET"))).view_settings;
      expect(got).toMatchObject({ show_flags: false, show_images: false });
      const rows = (
        await env.DB.prepare(
          "select action, before_json, after_json from change_log where budget_id = ? and entity_id = ? and entity_type = 'view_settings' order by rowid",
        )
          .bind(b, id)
          .all<Json>()
      ).results;
      expect(rows.map((r: Json) => r.action)).toEqual(["create", "update"]);
      const first = JSON.parse(rows[0].after_json);
      expect(JSON.parse(rows[0].before_json)).toMatchObject({
        show_flags: true,
        show_images: true,
      });
      expect(JSON.parse(rows[1].before_json)).toEqual(first);
      expect(JSON.parse(rows[1].after_json)).toMatchObject({
        show_flags: false,
        show_images: false,
      });
    }
  });
});

describe("view settings MCP (EXF-529)", () => {
  it("tools return the REST data and log as mcp:", async () => {
    const { b, a } = await mk();
    const upd = JSON.parse(
      (
        await tool("update_account_view_settings", {
          budget_id: b,
          account_id: a,
          show_flags: false,
        })
      ).content[0].text,
    );
    expect(upd.view_settings).toMatchObject({ account_id: a, show_flags: false });
    const got = JSON.parse(
      (await tool("get_account_view_settings", { budget_id: b, account_id: a })).content[0].text,
    );
    expect(got).toEqual({ view_settings: (await data(await send(V(b, a), "GET"))).view_settings });
    const allUpd = JSON.parse(
      (await tool("update_all_accounts_view_settings", { budget_id: b, preset: "last_month" }))
        .content[0].text,
    );
    expect(allUpd.view_settings.preset).toBe("last_month");
    const allGot = JSON.parse(
      (await tool("get_all_accounts_view_settings", { budget_id: b })).content[0].text,
    );
    expect(allGot).toEqual(allUpd);
    expect((await logs(a)).find((r: Json) => r.entity_type === "view_settings")?.actor).toMatch(
      /^mcp:/,
    );
    const strict = await tool("update_all_accounts_view_settings", {
      budget_id: b,
      show_running_balance: true,
    });
    expect(strict.isError).toBe(true);
    const bad = await tool("update_account_view_settings", {
      budget_id: b,
      account_id: a,
      preset: "custom",
    });
    expect(bad.isError).toBe(true);
  });

  it("is on the surface", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/accounts/{account_id}/view_settings",
        "/api/v1/budgets/{budget_id}/view_settings/all_accounts",
      ]),
    );
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining([
        "get_account_view_settings",
        "update_account_view_settings",
        "get_all_accounts_view_settings",
        "update_all_accounts_view_settings",
      ]),
    );
  });
});
