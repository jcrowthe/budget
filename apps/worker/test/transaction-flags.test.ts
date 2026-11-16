import { describe, expect, it } from "vitest";
import { account, DAY, get, logs, plan, send, setSql, tx } from "./bulk-helpers";

const patch = (b: string, id: string, body: unknown) =>
  send(`/api/v1/budgets/${b}/transactions/${id}`, "PATCH", body);

describe("flag_color", () => {
  it("is null by default and set and cleared by PATCH", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1 });
    expect(r.flag_color).toBeNull();
    expect((await patch(b, r.id, { flag_color: "purple" })).status).toBe(200);
    expect((await get(b, r.id)).flag_color).toBe("purple");
    expect((await patch(b, r.id, { flag_color: "mauve" })).status).toBe(422);
    expect((await patch(b, r.id, { flag_color: null })).status).toBe(200);
    expect((await get(b, r.id)).flag_color).toBeNull();
  });

  it("a flag-only PATCH works on a reconciled, unapproved row and keeps it unapproved", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1, approved: false });
    await setSql(r.id, "cleared = 'reconciled'");
    const before = await logs(b);
    const res = await patch(b, r.id, { flag_color: "red" });
    expect(res.status).toBe(200);
    expect(await get(b, r.id)).toMatchObject({
      flag_color: "red",
      approved: false,
      cleared: "reconciled",
    });
    expect(await logs(b)).toBe(before + 1);
  });

  it("a flag with another field is a normal edit (a reconciled row is refused)", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1 });
    await setSql(r.id, "cleared = 'reconciled'");
    expect((await patch(b, r.id, { flag_color: "red", memo: "x" })).status).toBe(409);
    const ok = await tx(b, { account_id: a, date: DAY, amount: -1 });
    expect((await patch(b, ok.id, { flag_color: "red", memo: "x" })).status).toBe(200);
    expect(await get(b, ok.id)).toMatchObject({ flag_color: "red", memo: "x" });
  });

  it("an edit that does not send flag_color keeps the flag; an unknown id is a 404", async () => {
    const b = await plan();
    const a = await account(b);
    const r = await tx(b, { account_id: a, date: DAY, amount: -1 });
    await patch(b, r.id, { flag_color: "green" });
    await patch(b, r.id, { memo: "m" });
    expect((await get(b, r.id)).flag_color).toBe("green");
    expect((await patch(b, crypto.randomUUID(), { flag_color: "red" })).status).toBe(404);
  });

  it("export is not taken for a transaction id", async () => {
    const b = await plan();
    const res = await send(
      `/api/v1/budgets/${b}/transactions/export?ids=${crypto.randomUUID()}`,
      "GET",
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toContain("json");
  });
});
