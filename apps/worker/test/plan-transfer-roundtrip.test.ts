import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport } from "./plan-import-helpers";
import { account, category, plan, S, sched, TODAY } from "./scheduled-helpers";

// EXF-501: a transfer schedule exports as two scheduled rows and imports back as ONE transfer schedule.
pinPlanClock();

describe("scheduled transfers: export, import", () => {
  it("round-trips a transfer schedule (on-plan and tracking) and a plain one", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const s = await account(b, "savings", 0);
    const t = await account(b, "otherAsset", 0);
    const c = await category(b);
    const names = new Map<string, string>(
      (await q("select id, name from accounts where budget_id = ?", b)).map((r: Json) => [
        r.id,
        r.name,
      ]),
    );
    await sched(b, {
      account_id: a,
      transfer_account_id: s,
      date_first: "2026-12-15",
      frequency: "never",
      amount: -100000,
      memo: "ZZ-TEST rent",
    });
    await sched(b, {
      account_id: a,
      transfer_account_id: t,
      date_first: "2026-12-16",
      frequency: "never",
      amount: -25000,
      category_id: c,
      memo: "ZZ-TEST invest",
    });
    await sched(b, {
      account_id: a,
      date_first: "2026-12-17",
      frequency: "never",
      amount: -1000,
      payee_name: "ZZ-TEST Plain",
    });
    const res = await json(`/api/v1/budgets/${b}/export?now=${encodeURIComponent(NOW)}`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const name = /filename="([^"]+)"/.exec(
      res.headers.get("Content-Disposition") ?? "",
    )?.[1] as string;
    const register = text(readZip(bytes)[1]?.data as Uint8Array);
    const an = names.get(a) as string;
    const sn = names.get(s) as string;
    expect(register).toMatch(
      new RegExp(
        `"${an}","","12/15/2026","Transfer : ${sn}",[^\\n]*"ZZ-TEST rent",\\$100\\.00,\\$0\\.00,"Uncleared"`,
      ),
    );
    expect(register).toMatch(
      new RegExp(
        `"${sn}","","12/15/2026","Transfer : ${an}",[^\\n]*"ZZ-TEST rent",\\$0\\.00,\\$100\\.00,"Uncleared"`,
      ),
    );

    const done = await body(await postImport(importForm([{ name, data: bytes }])), 201);
    expect(done.state).toBe("done");
    const nb = done.budget_id as string;
    expect(done.warnings ?? []).not.toContain("scheduled_not_supported");
    expect(JSON.stringify(done)).not.toContain("scheduled_not_supported");
    const rows = (await q(
      "select s.amount, s.memo, s.frequency, s.category_id, s.payee_id, s.transfer_account_id, a.name as account_name, ta.name as other_name from scheduled_transactions s join accounts a on a.id = s.account_id left join accounts ta on ta.id = s.transfer_account_id where s.budget_id = ? and s.deleted_at is null order by s.date_next",
      nb,
    )) as Json[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      amount: -100000,
      memo: "ZZ-TEST rent",
      frequency: "never",
      category_id: null,
      payee_id: null,
      account_name: an,
      other_name: sn,
    });
    expect(rows[1]).toMatchObject({
      amount: -25000,
      memo: "ZZ-TEST invest",
      other_name: names.get(t),
    });
    expect(rows[1]?.category_id).not.toBeNull();
    expect(rows[2]?.transfer_account_id).toBeNull();
    // no future real transfer rows
    const real = (await q(
      "select count(*) n from transactions where budget_id = ? and date > '2026-11-16' and deleted_at is null",
      nb,
    )) as Json[];
    expect(real[0]?.n).toBe(0);
    // the new plan lists the mirror in the other account
    const bs = (await q(
      "select id from accounts where budget_id = ? and name = ?",
      nb,
      sn,
    )) as Json[];
    const listed = (await (
      await json(`${S(nb)}?today=${TODAY}&account_id=${bs[0]?.id}`)
    ).json()) as Json;
    expect(listed.data.scheduled_transactions.map((x: Json) => x.mirror)).toEqual([true]);
  });
});
