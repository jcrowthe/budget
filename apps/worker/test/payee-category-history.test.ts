import { describe, expect, it } from "vitest";
import { data, send } from "./account-helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";

/** A plan with Fun, Groceries, Rent and Phone categories; rows go in through REST, payees are read from REST. */
async function world() {
  const w = await payeeWorld();
  const g = (
    await data(await send(`/api/v1/budgets/${w.bid}/category_groups`, "POST", { name: "ZZ G" }))
  ).category_group as Json;
  const ids: Record<string, string> = {};
  for (const name of ["Fun", "Groceries", "Rent", "Phone"]) {
    ids[name] = (
      await data(
        await send(`/api/v1/budgets/${w.bid}/categories`, "POST", {
          group_id: g.id,
          name: `ZZ ${name}`,
        }),
      )
    ).category.id as string;
  }
  const names = new Map(Object.entries(ids).map(([n, id]) => [id, n]));
  const nameOf = (id: string | null | undefined) => (id ? (names.get(id) ?? id) : null);
  const enter = (payee: string, date: string, category: keyof typeof ids) =>
    w.tx(payee, { date, category_id: ids[category] });
  const payee = async (name: string) => (await w.list()).find((p) => p.name === name) as Json;
  /** The payee as listed, with one log line: what base suggests (last_category_id), what this build stores, and the expectation. */
  const check = async (row: string, name: string, expected: string | null) => {
    const p = await payee(name);
    console.log(
      `A1 ${row} base_suggestion=${nameOf(p.last_category_id)} default=${nameOf(p.default_category_id)} expected=${expected}`,
    );
    expect(nameOf(p.default_category_id)).toBe(expected);
    return p;
  };
  const patch = async (name: string, body: Json) =>
    send(`${P(w.bid)}/${(await payee(name)).id}`, "PATCH", body);
  return { ...w, ids, enter, check, patch, payee };
}

describe("payee default: the ticket's table, entered through REST (EXF-515)", () => {
  it("ZZ Cafe A: 11/15 Fun, 11/15 Fun → Fun", async () => {
    const s = await world();
    await s.enter("ZZ Cafe A", "2026-11-15", "Fun");
    await s.enter("ZZ Cafe A", "2026-11-15", "Fun");
    await s.check("Cafe A row 1", "ZZ Cafe A", "Fun");
  });

  it("ZZ Cafe A: then 11/15 Groceries ×2 (last 3: Fun, Fun, Groceries) → Fun", async () => {
    const s = await world();
    await s.enter("ZZ Cafe A", "2026-11-15", "Fun");
    await s.enter("ZZ Cafe A", "2026-11-15", "Fun");
    await s.enter("ZZ Cafe A", "2026-11-15", "Groceries");
    await s.enter("ZZ Cafe A", "2026-11-15", "Groceries");
    await s.check("Cafe A row 2", "ZZ Cafe A", "Fun");
  });

  it("ZZ Cafe C: Groceries 11/10, Groceries 11/11, Fun 11/12 → Groceries", async () => {
    const s = await world();
    await s.enter("ZZ Cafe C", "2026-11-10", "Groceries");
    await s.enter("ZZ Cafe C", "2026-11-11", "Groceries");
    await s.enter("ZZ Cafe C", "2026-11-12", "Fun");
    await s.check("Cafe C", "ZZ Cafe C", "Groceries");
  });

  it("ZZ Cafe D: Groceries 11/10, Fun 11/12 → Groceries (a tie keeps)", async () => {
    const s = await world();
    await s.enter("ZZ Cafe D", "2026-11-10", "Groceries");
    await s.enter("ZZ Cafe D", "2026-11-12", "Fun");
    await s.check("Cafe D row 1", "ZZ Cafe D", "Groceries");
  });

  it("ZZ Cafe D: then Rent 11/13 (3-way tie) → Groceries", async () => {
    const s = await world();
    await s.enter("ZZ Cafe D", "2026-11-10", "Groceries");
    await s.enter("ZZ Cafe D", "2026-11-12", "Fun");
    await s.enter("ZZ Cafe D", "2026-11-13", "Rent");
    await s.check("Cafe D row 2", "ZZ Cafe D", "Groceries");
  });

  it("ZZ Cafe E: Fun 11/12 entered first, then Groceries 11/10 → Fun", async () => {
    const s = await world();
    await s.enter("ZZ Cafe E", "2026-11-12", "Fun");
    await s.enter("ZZ Cafe E", "2026-11-10", "Groceries");
    await s.check("Cafe E", "ZZ Cafe E", "Fun");
  });

  it("ZZ Phone Co: history Phone, fixed Fun → Fun", async () => {
    const s = await world();
    await s.enter("ZZ Phone Co", "2026-11-10", "Phone");
    expect(
      (await s.patch("ZZ Phone Co", { category_mode: "fixed", fixed_category_id: s.ids.Fun }))
        .status,
    ).toBe(200);
    await s.check("Phone Co", "ZZ Phone Co", "Fun");
  });

  it("ZZ Cafe A: off → null", async () => {
    const s = await world();
    await s.enter("ZZ Cafe A", "2026-11-15", "Fun");
    await s.enter("ZZ Cafe A", "2026-11-15", "Fun");
    expect((await s.patch("ZZ Cafe A", { category_mode: "off" })).status).toBe(200);
    await s.check("Cafe A off", "ZZ Cafe A", null);
  });
});
