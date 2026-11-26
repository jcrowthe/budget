import { describe, expect, it } from "vitest";
import { account, category, type Json, plan, q, send, tx } from "./bulk-helpers";
import { createView, listViews, planCategories } from "./custom-views-helpers";
import { json } from "./helpers";
import { NOW, pinPlanClock, readZip } from "./plan-export-helpers";
import { body, importForm, postImport } from "./plan-import-helpers";

// Plan-level data through Export Plan and Import Plan: the plan's custom flag names (EXF-480), its expected
// income (EXF-525) and its custom views (EXF-502). Design: docs/plan-export-design.md, "Plan settings".
pinPlanClock();

async function exportOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
  expect(res.status).toBe(200);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A plan's views as the API lists them: the order as names (built-ins by key) and each custom view's members by "group: category". */
async function viewsOf(bid: string) {
  const cats = new Map<string, string>();
  const month = (await (
    await send(`/api/v1/budgets/${bid}/months/2026-11-01`, "GET")
  ).json()) as Json;
  for (const g of month.data.groups) {
    for (const c of g.categories) cats.set(c.id, `${g.name}: ${c.name}`);
  }
  const l = await listViews(bid);
  const byId = new Map<string, Json>(l.views.map((v: Json) => [v.id, v]));
  return l.order.map((id: string) => {
    const v = byId.get(id);
    return v ? { name: v.name, members: v.category_ids.map((c: string) => cats.get(c)) } : id;
  });
}

describe("flag names, expected income and views survive export then import", () => {
  it("a round trip keeps the flag colours, flag_names, expected income and views", async () => {
    const bid = await plan();
    const acct = await account(bid);
    const groceries = await category(bid, "Groceries");
    const flagged: Record<string, string> = {};
    for (const [color, memo] of [
      ["red", "ZZ one"],
      ["red", "ZZ two"],
      ["blue", "ZZ three"],
    ] as const) {
      const t = await tx(bid, {
        account_id: acct,
        date: "2026-11-05",
        amount: -12000,
        memo,
        category_id: groceries,
      });
      expect(
        (await send(`/api/v1/budgets/${bid}/transactions/${t.id}`, "PATCH", { flag_color: color }))
          .status,
      ).toBe(200);
      flagged[memo] = t.id;
    }
    await tx(bid, {
      account_id: acct,
      date: "2026-11-06",
      amount: -5000,
      memo: "ZZ plain",
      category_id: groceries,
    });
    expect(
      (
        await send(`/api/v1/budgets/${bid}`, "PATCH", {
          flag_names: { red: "ZZ Tax", blue: "ZZ Blue Bills" },
          expected_income: 4_000_000,
        })
      ).status,
    ).toBe(200);

    const all = await planCategories(bid);
    const members = all.slice(0, 3).map((c) => c.id);
    await createView(bid, "ZZ Empty", []);
    const withCats = await createView(bid, "ZZ Picks", members);
    // Reordered: the second custom view first, a built-in in between.
    const before = await listViews(bid);
    const ids: string[] = before.order;
    const custom = before.views.map((v: Json) => v.id as string);
    const builtins = ids.filter((i) => !custom.includes(i));
    expect(withCats.id).toBe(custom[1]);
    const order = [builtins[0], custom[1], builtins[1], custom[0], ...builtins.slice(2)];
    expect(
      (await send(`/api/v1/budgets/${bid}/views/reorder`, "POST", { ids: order })).status,
    ).toBe(200);

    const first = await exportOf(bid);
    const res = await postImport(
      importForm([{ name: first.name, data: first.bytes }], { date_format: "MM/DD/YYYY" }),
    );
    const data = await body(res, 201);
    const nb = data.budget_id as string;

    const src = ((await (await send(`/api/v1/budgets/${bid}`, "GET")).json()) as Json).data.budget;
    const dst = ((await (await send(`/api/v1/budgets/${nb}`, "GET")).json()) as Json).data.budget;
    expect(dst.flag_names).toEqual(src.flag_names);
    expect(dst.flag_names.red).toBe("ZZ Tax");
    expect(dst.expected_income).toBe(4_000_000);

    const flags = async (b: string) =>
      (await q(
        "select memo, flag_color from transactions where budget_id = ? and deleted_at is null and memo like 'ZZ %' order by memo",
        b,
      )) as Json[];
    expect(await flags(nb)).toEqual(await flags(bid));
    expect((await flags(nb)).map((r) => r.flag_color)).toEqual([null, "red", "blue", "red"]);

    expect(await viewsOf(nb)).toEqual(await viewsOf(bid));
    const imported = await viewsOf(nb);
    expect(imported.filter((v: Json) => typeof v !== "string").map((v: Json) => v.name)).toEqual([
      "ZZ Picks",
      "ZZ Empty",
    ]);
    expect(readZip(first.bytes).length).toBeGreaterThanOrEqual(2);
  });
});
