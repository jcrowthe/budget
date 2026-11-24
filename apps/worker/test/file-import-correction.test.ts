import { describe, expect, it } from "vitest";
import { account, fixture, importText, type Json, plan, rowsOf, send } from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";

pinPlanClock();

describe("a payee correction on a file row teaches a rule (EXF-531, FI-3 AC5)", () => {
  it("is Sample Cafe goes on ZZ-TEST Cafe and the next import follows it", async () => {
    const bid = await plan();
    const aid = await account(bid);
    await importText(bid, aid, "sample.csv", fixture("sample.csv"));
    const row = (await rowsOf(aid)).find((r) => r.payee_name === "Sample Cafe") as Json;
    const res = await send(`/api/v1/budgets/${bid}/transactions/${row.id}`, "PATCH", {
      payee_name: "ZZ-TEST Cafe",
    });
    expect(res.status).toBe(200);
    const payees = ((await (await send(`/api/v1/budgets/${bid}/payees`, "GET")).json()) as Json)
      .data.payees as Json[];
    const target = payees.find((p) => p.name === "ZZ-TEST Cafe") as Json;
    const rules = (
      (await (
        await send(`/api/v1/budgets/${bid}/payees/${target.id}/rename-rules`, "GET")
      ).json()) as Json
    ).data.rules as Json[];
    expect(rules.map((r) => [r.kind, r.text])).toContainEqual(["is", "Sample Cafe"]);

    await importText(
      bid,
      aid,
      "next.csv",
      "Date,Payee,Memo,Outflow,Inflow\n11/20/2026,Sample Cafe,,3.00,",
    );
    const next = (await rowsOf(aid)).find((r) => r.date === "2026-11-20") as Json;
    expect(next.payee_name).toBe("ZZ-TEST Cafe");
  });
});
