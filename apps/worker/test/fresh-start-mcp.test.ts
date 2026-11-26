import { describe, expect, it } from "vitest";
import {
  data,
  dump,
  freshStart,
  type Json,
  n,
  plans,
  q,
  rand,
  seedSource,
  T,
  tool,
} from "./fresh-start-helpers";
import { apiPaths, listedToolNames } from "./surface";

describe("Fresh Start: REST = MCP (EXF-478)", () => {
  it("1: the tool answers what POST answers, and both plans end up the same", async () => {
    const [a, b] = [await seedSource(), await seedSource()];
    // the two seeds are identical but for the name
    const stem = rand();
    const rest = await data(
      await freshStart(a.bid, { name: `ZZ-TEST new ${stem} rest`, today: T }),
    );
    const r = await tool("fresh_start_budget", {
      budget_id: b.bid,
      name: `ZZ-TEST new ${stem} mcp`,
      today: T,
      confirm: true,
    });
    expect(r.isError).toBeFalsy();
    expect(Object.keys(r.structuredContent).sort()).toEqual([
      "archived_budget_id",
      "new_budget_id",
    ]);
    expect(r.structuredContent.archived_budget_id).toBe(b.bid);
    expect(Object.keys(rest).sort()).toEqual(["archived_budget_id", "new_budget_id"]);
    const withTx = { startingBalances: true };
    expect(await dump(r.structuredContent.new_budget_id, withTx)).toEqual(
      await dump(rest.new_budget_id, withTx),
    );
    expect(await dump(b.bid, withTx)).toEqual(await dump(a.bid, withTx));
    const log = (bid: string) =>
      q(
        "select action, entity_type from change_log where budget_id = ? and change_set_id is not null and entity_type in ('fresh_start', 'budget') order by entity_type, action",
        bid,
      );
    expect((await log(r.structuredContent.new_budget_id)).length).toBeGreaterThan(0);
    const actors = await q(
      "select distinct actor from change_log where budget_id = ? and entity_type = 'fresh_start'",
      b.bid,
    );
    expect(actors).toEqual([{ actor: "mcp:user:tester@localhost" }]);
    const [ab] = await q("select name from budgets where id = ?", b.bid);
    expect(ab?.name).toBe(`${b.name} (Archived on ${T})`);
  });

  it("2: confirm is required", async () => {
    const s = await seedSource();
    const planCount = (await plans()).length;
    const logs = await n("select count(*) n from change_log");
    for (const args of [
      { budget_id: s.bid, name: `ZZ-TEST ${rand()}`, today: T },
      { budget_id: s.bid, name: `ZZ-TEST ${rand()}`, today: T, confirm: false },
    ]) {
      const r = await tool("fresh_start_budget", args);
      expect(r.isError).toBe(true);
    }
    expect((await plans()).length).toBe(planCount);
    expect((await q("select name from budgets where id = ?", s.bid))[0]?.name).toBe(s.name);
    expect(await n("select count(*) n from change_log")).toBe(logs);
  });

  it("3: a name clash is a tool error", async () => {
    const s = await seedSource();
    const r = (await tool("fresh_start_budget", {
      budget_id: s.bid,
      name: s.name.toUpperCase(),
      confirm: true,
    })) as Json;
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("The plan name already exists.");
  });

  it("4: the surface lists the route and the tool", async () => {
    expect(await apiPaths()).toEqual(expect.arrayContaining(["/api/v1/budgets/{id}/fresh-start"]));
    expect(await listedToolNames()).toContain("fresh_start_budget");
  });
});
