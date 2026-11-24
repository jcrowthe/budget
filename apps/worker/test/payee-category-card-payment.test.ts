import { describe, expect, it } from "vitest";
import { account, data, send } from "./account-helpers";
import { json } from "./helpers";
import { type Json, P, payeeWorld } from "./manage-payees-helpers";

describe("a payee's fixed choice cannot be a credit card payment category (EXF-515)", () => {
  it("PATCH category_mode fixed with a payment category is 422; a plain category still works", async () => {
    const w = await payeeWorld();
    await account(w.bid, "creditCard", 100000, "ZZ-TEST Visa");
    const id = await w.tx("ZZ Cafe").then(async () => await w.id("ZZ Cafe"));
    const m = await data(await json(`/api/v1/budgets/${w.bid}/months/2026-11-01`));
    const cats = m.groups.flatMap((g: Json) => g.categories) as Json[];
    const pay = cats.find((c) => c.kind === "credit_card_payment") as Json;
    expect(pay).toBeDefined();
    const res = await send(`${P(w.bid)}/${id}`, "PATCH", {
      category_mode: "fixed",
      fixed_category_id: pay.id,
    });
    expect(res.status).toBe(422);
    expect((((await res.json()) as Json).error as Json).detail).toMatch(/credit card payment/i);
    const listed = (await data(await send(P(w.bid), "GET"))).payees as Json[];
    expect(listed.find((p) => p.id === id)).toMatchObject({
      category_mode: "history",
      fixed_category_id: null,
    });
    const plain = cats.find((c) => c.kind !== "credit_card_payment" && !c.hidden) as Json;
    if (plain) {
      const ok = await send(`${P(w.bid)}/${id}`, "PATCH", {
        category_mode: "fixed",
        fixed_category_id: plain.id,
      });
      expect(ok.status).toBe(200);
    }
  });
});
