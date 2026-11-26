import { describe, expect, it } from "vitest";
import { type Json, q } from "./bulk-helpers";
import { pinClock } from "./clock";
import { json } from "./helpers";
import { NOW, pinPlanClock, readZip, text } from "./plan-export-helpers";
import { body, importForm, postImport } from "./plan-import-helpers";
import { addRule, rulesWorld } from "./rename-rules-helpers";

pinClock("2026-11-15T12:00:00Z"); // fixed-month fixtures (EXF-977)

// EXF-885 point 5a: payee renaming rules go through Export Plan and Import Plan.
// Design: docs/plan-export-design.md and docs/plan-import-design.md, "Payee renaming rules".
pinPlanClock();

async function exportOf(bid: string) {
  const res = await json(`/api/v1/budgets/${bid}/export?now=${encodeURIComponent(NOW)}`);
  expect(res.status).toBe(200);
  const name = /filename="([^"]+)"/.exec(
    res.headers.get("Content-Disposition") ?? "",
  )?.[1] as string;
  return { name, bytes: new Uint8Array(await res.arrayBuffer()) };
}

/** A plan's live rules as payee name, kind, text, in order of creation. */
const rulesOf = (bid: string) =>
  q(
    `select p.name payee, r.kind, r.text from payee_rename_rules r
       join payees p on p.id = r.payee_id
      where r.budget_id = ? and r.deleted_at is null order by r.created_at, r.id`,
    bid,
  ) as Promise<Json[]>;

async function withRules() {
  const w = await rulesWorld(["ZZ Amazon", "ZZ Shop B", "ZZ Café"]);
  const [a, b, c] = [await w.id("ZZ Amazon"), await w.id("ZZ Shop B"), await w.id("ZZ Café")];
  await addRule(w.bid, a, "contains", "amzn mktp");
  await addRule(w.bid, b, "is", "SHOP B #12");
  await addRule(w.bid, a, "is", '="Amazon" ,, + x');
  await addRule(w.bid, c, "contains", "cafe\nnoir");
  return w;
}

const files = (zip: { name: string; bytes: Uint8Array }) => {
  const e = readZip(zip.bytes);
  return { plan: text(e[0]?.data as Uint8Array), register: text(e[1]?.data as Uint8Array) };
};

const upload = (plan: string, register: string) =>
  importForm(
    [
      { name: "Budget Export - R as of 2026-11-16 09-05 - Plan.csv", data: plan },
      { name: "Budget Export - R as of 2026-11-16 09-05 - Register.csv", data: register },
    ],
    { date_format: "MM/DD/YYYY" },
  );

describe("EXF-885 5a: renaming rules in the export and import", () => {
  it("a round trip keeps both kinds, their texts and their order of creation", async () => {
    const w = await withRules();
    const first = await exportOf(w.bid);
    expect(readZip(first.bytes)).toHaveLength(2);
    const res = await postImport(
      importForm([{ name: first.name, data: first.bytes }], { date_format: "MM/DD/YYYY" }),
    );
    const data = await body(res, 201);
    const src = await rulesOf(w.bid);
    expect(src.map((r) => r.kind)).toEqual(["contains", "is", "is", "contains"]);
    expect(await rulesOf(data.budget_id)).toEqual(src);
    expect(data.summary.warnings.map((x: Json) => x.code)).not.toContain(
      "rename_rule_payee_missing",
    );
    // The rules sit on the new plan's own payees, and exporting again gives the same Register.
    const ids = (await q(
      "select r.payee_id from payee_rename_rules r where r.budget_id = ?",
      data.budget_id,
    )) as Json[];
    const srcIds = (await q(
      "select r.payee_id from payee_rename_rules r where r.budget_id = ?",
      w.bid,
    )) as Json[];
    expect(ids).toHaveLength(4);
    for (const r of ids) expect(srcIds.map((s) => s.payee_id)).not.toContain(r.payee_id);
    const second = await exportOf(data.budget_id);
    expect(files(second).register).toBe(files(first).register);
  });

  it("an older export without rules imports with no rules, and a plan with none exports as before", async () => {
    const w = await rulesWorld(["ZZ Amazon"]);
    const first = await exportOf(w.bid);
    const { plan, register } = files(first);
    expect(register.split("\r\n")[0]).toMatch(/"Cleared"$/);
    expect(register).not.toContain("Rename");
    const data = await body(await postImport(upload(plan, register)), 201);
    expect(await rulesOf(data.budget_id)).toEqual([]);
    // The same plan with rules gets rule columns; stripped back to the older shape it imports with none.
    await addRule(w.bid, await w.id("ZZ Amazon"), "is", "amzn");
    const withRule = files(await exportOf(w.bid));
    expect(withRule.register).toContain("Rename");
    const older = withRule.register
      .split("\r\n")
      .filter((l) => !l.startsWith('"","",""'))
      .map((l) => l.replace(/,"[^"]*","[^"]*","[^"]*"$/, ""))
      .join("\r\n");
    expect(older).toBe(register);
    const again = await body(await postImport(upload(withRule.plan, older)), 201);
    expect(await rulesOf(again.budget_id)).toEqual([]);
  });

  it("a rule whose payee is not in the file is dropped with a warning, the others are kept", async () => {
    const w = await withRules();
    const { plan, register } = files(await exportOf(w.bid));
    const edited = register.replace(
      '"ZZ Shop B","is","SHOP B #12"',
      '"ZZ Nobody","is","SHOP B #12"',
    );
    expect(edited).not.toBe(register);
    const data = await body(await postImport(upload(plan, edited)), 201);
    const got = await rulesOf(data.budget_id);
    expect(got.map((r) => r.text)).toEqual(["amzn mktp", '="Amazon" ,, + x', "cafe\nnoir"]);
    const warning = data.summary.warnings.find((x: Json) => x.code === "rename_rule_payee_missing");
    expect(warning).toBeTruthy();
    expect(warning.count).toBe(1);
  });
});
