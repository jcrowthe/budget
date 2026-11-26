import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { json } from "./helpers";
import { NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport } from "./plan-import-helpers";
import { account, category, plan, sched } from "./scheduled-helpers";

// EXF-501 part 2: a split schedule exports as consecutive `Split (k/n)` rows and imports back as ONE split schedule.
pinPlanClock();

describe("scheduled splits: export, import", () => {
  it("round-trips a split schedule with its lines, a memo and a Ready to Assign line", async () => {
    const b = await plan();
    const a = await account(b, "checking", 0);
    const c1 = await category(b, "Groceries");
    const c2 = await category(b, "Transportation");
    await sched(b, {
      account_id: a,
      date_first: "2026-12-15",
      frequency: "never",
      amount: -35000,
      payee_name: "ZZ-TEST Market",
      subtransactions: [
        { amount: -30000, category_id: c1 },
        { amount: -10000, category_id: c2, memo: "ZZ-TEST fuel" },
        { amount: 5000, category_id: null, inflow_to_ready_to_assign: true },
      ],
    });
    const res = await json(`/api/v1/budgets/${b}/export?now=${encodeURIComponent(NOW)}`);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const name = /filename="([^"]+)"/.exec(
      res.headers.get("Content-Disposition") ?? "",
    )?.[1] as string;
    const register = text(readZip(bytes)[1]?.data as Uint8Array);
    expect(register).toContain("Split (1/3) ");
    expect(register).toContain("Split (2/3) ZZ-TEST fuel");
    expect(register).toContain("Split (3/3) ");
    expect(register.match(/"12\/15\/2026"/g)).toHaveLength(3);

    const done = await body(await postImport(importForm([{ name, data: bytes }])), 201);
    expect(done.state).toBe("done");
    expect(JSON.stringify(done)).not.toContain("scheduled_not_supported");
    const nb = done.budget_id as string;
    const parents = (await q(
      "select s.id, s.amount, s.frequency, s.date_next, s.category_id, p.name as payee_name from scheduled_transactions s left join payees p on p.id = s.payee_id where s.budget_id = ? and s.deleted_at is null",
      nb,
    )) as Json[];
    expect(parents).toHaveLength(1);
    expect(parents[0]).toMatchObject({
      amount: -35000,
      frequency: "never",
      date_next: "2026-12-15",
      category_id: null,
      payee_name: "ZZ-TEST Market",
    });
    const lines = (await q(
      "select l.amount, l.memo, l.inflow_to_ready_to_assign as rta, c.name as category_name from scheduled_subtransactions l left join categories c on c.id = l.category_id where l.scheduled_transaction_id = ? and l.deleted_at is null order by l.sort",
      parents[0]?.id,
    )) as Json[];
    expect(lines.map((l) => l.amount)).toEqual([-30000, -10000, 5000]);
    expect(lines.map((l) => l.memo)).toEqual([null, "ZZ-TEST fuel", null]);
    expect(lines.map((l) => l.rta)).toEqual([0, 0, 1]);
    expect(lines.map((l) => l.category_name?.replace(/^[^A-Za-z]+/, "") ?? null)).toEqual([
      "Groceries",
      "Transportation",
      null,
    ]);
    const real = await q(
      "select count(*) n from transactions where budget_id = ? and parent_transaction_id is not null",
      nb,
    );
    expect(real[0]?.n).toBe(0);
  });
});
