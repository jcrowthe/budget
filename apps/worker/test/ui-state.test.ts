import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

async function plan() {
  return (
    await createBudget(env, "user:tester@localhost", { name: `ZZ-TEST ${crypto.randomUUID()}` })
  ).id;
}
const url = (bid: string) => `/api/v1/budgets/${bid}/ui-state`;
const get = async (bid: string) => (await (await json(url(bid))).json()) as Json;
const put = (bid: string, body: unknown) => json(url(bid), { method: "PUT" }, body);
const COLLAPSED = "collapsed_account_groups";
const logRows = async (bid: string) =>
  (
    await env.DB.prepare("select count(*) n from change_log where budget_id = ?")
      .bind(bid)
      .first<{ n: number }>()
  )?.n;

describe("ui-state", () => {
  it("lists its path", async () => {
    expect(await apiPaths()).toContain("/api/v1/budgets/{budget_id}/ui-state");
  });

  it("starts empty, round-trips, normalises and merges", async () => {
    const bid = await plan();
    expect(await get(bid)).toEqual({ data: { ui_state: {} } });
    const res = await put(bid, { [COLLAPSED]: ["loans", "starred", "loans"] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).data.ui_state[COLLAPSED]).toEqual(["starred", "loans"]);
    expect((await get(bid)).data.ui_state[COLLAPSED]).toEqual(["starred", "loans"]);
    expect((await put(bid, {})).status).toBe(200);
    expect((await get(bid)).data.ui_state[COLLAPSED]).toEqual(["starred", "loans"]);
    await put(bid, { [COLLAPSED]: [] });
    expect((await get(bid)).data.ui_state[COLLAPSED]).toEqual([]);
  });

  it("keeps unknown stored keys and skips invalid stored values", async () => {
    const bid = await plan();
    await env.DB.prepare(
      "insert into ui_state (budget_id, key, value, updated_at) values (?, 'future_key', '1', 'x')",
    )
      .bind(bid)
      .run();
    await put(bid, { [COLLAPSED]: ["cash"] });
    expect((await get(bid)).data.ui_state).toEqual({ [COLLAPSED]: ["cash"] });
    const kept = await env.DB.prepare(
      "select count(*) n from ui_state where key = 'future_key'",
    ).first<{
      n: number;
    }>();
    expect(kept?.n).toBe(1);
    const bid2 = await plan();
    await env.DB.prepare(
      `insert into ui_state (budget_id, key, value, updated_at) values (?, '${COLLAPSED}', '"x"', 'x')`,
    )
      .bind(bid2)
      .run();
    expect((await get(bid2)).data.ui_state).toEqual({});
  });

  it.each([
    ["unknown key", { nope: 1 }],
    ["unknown group", { [COLLAPSED]: ["savings"] }],
    ["not a list", { [COLLAPSED]: "cash" }],
    ["too many", { [COLLAPSED]: ["cash", "cash", "cash", "cash", "cash", "cash", "cash"] }],
  ])("rejects %s with 422", async (_n, body) => {
    expect((await put(await plan(), body)).status).toBe(422);
  });

  it("404s an unknown plan", async () => {
    const id = crypto.randomUUID();
    expect((await json(url(id))).status).toBe(404);
    expect((await put(id, {})).status).toBe(404);
  });

  it("writes no history row and is per plan", async () => {
    const a = await plan();
    const b = await plan();
    const before = await logRows(a);
    await put(a, { [COLLAPSED]: ["cash"] });
    await put(a, { [COLLAPSED]: [] });
    expect(await logRows(a)).toBe(before);
    expect((await get(b)).data.ui_state).toEqual({});
  });
});
