import { describe, expect, it } from "vitest";
import { account, category, DAY, plan, tx } from "./bulk-helpers";
import { json } from "./helpers";

describe("GET transactions/export", () => {
  it("answers a CSV file in the ids' order with the ticket's header and a flag name", async () => {
    const b = await plan();
    const a = await account(b);
    const cat = await category(b);
    const r1 = await tx(b, {
      account_id: a,
      date: DAY,
      amount: -4500,
      memo: 'say "hi"',
      category_id: cat,
    });
    const r2 = await tx(b, { account_id: a, date: DAY, amount: 250000, cleared: "cleared" });
    await json(
      `/api/v1/budgets/${b}/transactions/${r2.id}`,
      { method: "PATCH" },
      { flag_color: "red" },
    );
    const res = await json(`/api/v1/budgets/${b}/transactions/export?ids=${r2.id},${r1.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="Selected Transactions for ZZ-TEST .+ as of \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.csv"; filename\*=UTF-8''/,
    );
    const lines = (await res.text()).replace("﻿", "").trimEnd().split("\n");
    expect(lines[0]).toBe(
      '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Red","11/10/2026"');
    expect(lines[1]).toContain('"$0.00","$250.00","Cleared"');
    expect(lines[2]).toContain('"say ""hi"""');
    expect(lines[2]).toContain('"$4.50","$0.00","Uncleared"');
  });

  it("an unknown id is a 404 naming it; more than 100 ids are a 422", async () => {
    const b = await plan();
    const res = await json(`/api/v1/budgets/${b}/transactions/export?ids=nope`);
    expect(res.status).toBe(404);
    const many = Array.from({ length: 101 }, (_, i) => `x${i}`).join(",");
    expect((await json(`/api/v1/budgets/${b}/transactions/export?ids=${many}`)).status).toBe(422);
  });
});
