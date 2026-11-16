import { env } from "cloudflare:test";
import { DEFAULT_PRESETS, REPORT_SLUGS } from "@budget/schema/reports";
import { describe, expect, it } from "vitest";
import { createBudget } from "../src/services/budgets";
import { json } from "./helpers";
import { apiPaths } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

async function plan() {
  return (
    await createBudget(env, "user:tester@localhost", { name: `ZZ-TEST ${crypto.randomUUID()}` })
  ).id;
}
const url = (bid: string, report = "") => `/api/v1/budgets/${bid}/report-settings${report}`;
const get = async (bid: string) => ((await (await json(url(bid))).json()) as Json).data;
const put = (bid: string, report: string, body: unknown) =>
  json(url(bid, `/${report}`), { method: "PUT" }, body);
const row = (d: Json, report: string) => d.reports.find((r: Json) => r.report === report);

describe("report settings", () => {
  it("lists its paths", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/budgets/{budget_id}/report-settings",
        "/api/v1/budgets/{budget_id}/report-settings/{report}",
      ]),
    );
  });

  it("defaults for a new plan", async () => {
    const d = await get(await plan());
    expect(d.last_report).toBeNull();
    expect(d.reports.map((r: Json) => r.report)).toEqual([...REPORT_SLUGS]);
    for (const r of d.reports) {
      expect(r).toEqual({
        report: r.report,
        preset: DEFAULT_PRESETS[r.report as keyof typeof DEFAULT_PRESETS],
        start_month: null,
        end_month: null,
        excluded_category_ids: [],
        excluded_account_ids: [],
        hide_export_dialog: false,
      });
    }
  });

  it("round-trips custom months and exclusions; a preset clears the months", async () => {
    const bid = await plan();
    const res = await put(bid, "net-worth", {
      preset: "custom",
      start_month: "2026-07-01",
      end_month: "2026-09-01",
      excluded_account_ids: ["a1", "a1", "a2"],
      excluded_category_ids: ["uncategorized"],
    });
    expect(res.status).toBe(200);
    expect(row(await get(bid), "net-worth")).toMatchObject({
      preset: "custom",
      start_month: "2026-07-01",
      end_month: "2026-09-01",
      excluded_account_ids: ["a1", "a2"],
      excluded_category_ids: ["uncategorized"],
    });
    expect(row(await get(bid), "spending-breakdown").preset).toBe("this_month");
    await put(bid, "net-worth", { preset: "last_6_months" });
    expect(row(await get(bid), "net-worth")).toMatchObject({
      preset: "last_6_months",
      start_month: null,
      end_month: null,
      excluded_account_ids: ["a1", "a2"],
    });
  });

  it("rejects bad requests", async () => {
    const bid = await plan();
    expect((await put(bid, "nope", { preset: "this_month" })).status).toBe(422);
    expect((await put(bid, "net-worth", { preset: "custom" })).status).toBe(422);
    expect(
      (
        await put(bid, "net-worth", {
          preset: "custom",
          start_month: "2026-09-01",
          end_month: "2026-07-01",
        })
      ).status,
    ).toBe(422);
    expect(
      (await put(bid, "net-worth", { preset: "this_month", start_month: "2026-07-01" })).status,
    ).toBe(422);
    expect((await put(bid, "net-worth", {})).status).toBe(422);
    expect((await put(bid, "net-worth", { bogus: 1 })).status).toBe(422);
    const missing = await put(crypto.randomUUID(), "net-worth", { preset: "this_month" });
    expect(missing.status).toBe(404);
    expect((await json(url(crypto.randomUUID()))).status).toBe(404);
  });

  it("the export-dialog flag is one per plan", async () => {
    const bid = await plan();
    await put(bid, "net-worth", { hide_export_dialog: true });
    expect((await get(bid)).reports.every((r: Json) => r.hide_export_dialog)).toBe(true);
    await put(bid, "spending-trends", { hide_export_dialog: false });
    expect((await get(bid)).reports.some((r: Json) => r.hide_export_dialog)).toBe(false);
  });

  it("the last visited report is the latest", async () => {
    const bid = await plan();
    await put(bid, "net-worth", { visited: true });
    await new Promise((r) => setTimeout(r, 5));
    await put(bid, "spending-trends", { visited: true });
    expect((await get(bid)).last_report).toBe("spending-trends");
    await new Promise((r) => setTimeout(r, 5));
    await put(bid, "net-worth", { visited: true });
    expect((await get(bid)).last_report).toBe("net-worth");
  });

  it("two plans do not share rows", async () => {
    const [a, b] = [await plan(), await plan()];
    await put(a, "net-worth", { excluded_account_ids: ["x"], hide_export_dialog: true });
    const d = await get(b);
    expect(row(d, "net-worth").excluded_account_ids).toEqual([]);
    expect(row(d, "net-worth").hide_export_dialog).toBe(false);
  });
});
