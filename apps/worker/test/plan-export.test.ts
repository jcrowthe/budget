import { utcMinute } from "@budget/schema/plan-export";
import { describe, expect, it } from "vitest";
import { type Json, tool } from "./bulk-helpers";
import { json } from "./helpers";
import { buildF, changeLogCount, NOW, readZip, text } from "./plan-export-helpers";
import { apiPaths, listedToolNames } from "./surface";

// EXF-476 (API half): Export Plan. Expected files are written by hand from the ticket's rules and the
// amounts worked out from fixture F (docs/plan-export-design.md, "Acceptance"); nothing is computed by the code under test.

const STEM = "ZZ TEST Ex port 7 as of 2026-11-16 09-05";
const ZIP_NAME = `Budget Export - ${STEM}.zip`;
const BOM = "﻿";

const PLAN_HEADER =
  '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';

// Visible rows first, hidden rows after, per month (Old Hobby and Hobby are hidden).
const month = (
  m: string,
  card: string,
  rent: string,
  groceries: string,
  fun: string,
  hobby: string,
) => [
  `"${m}","Credit Card Payments: Sample Visa","Credit Card Payments","Sample Visa",${card}`,
  `"${m}","Bills: Rent","Bills","Rent",${rent}`,
  `"${m}","Everyday: Groceries 🛒","Everyday","Groceries 🛒",${groceries}`,
  `"${m}","Everyday: Fun ""x"", y","Everyday","Fun ""x"", y",${fun}`,
  `"${m}","Hidden Categories: Old Hobby","Hidden Categories","Old Hobby",$0.00,$0.00,$0.00`,
  `"${m}","Hidden Categories: Hobby","Hidden Categories","Hobby",${hobby}`,
];

// Amounts per month by hand (assigned, activity, available):
// Rent: 900 assigned in Sep and Oct, no activity, so 900 / 1800 and carried.
// Groceries: 200 in Sep; Oct -30 (split line) and -40 (card) = -70, so 130; 50 more in Dec = 180.
// Fun: 50 in Sep; Oct -12.50 = 37.50. Hobby (hidden group): 20 in Sep; Oct -8 = 12.
// Sample Visa payment category: the 40 card purchase moves 40 into it in Oct (activity 40), carried on.
const PLAN_LINES = [
  PLAN_HEADER,
  ...month(
    "Sep 2026",
    "$0.00,$0.00,$0.00",
    "$900.00,$0.00,$900.00",
    "$200.00,$0.00,$200.00",
    "$50.00,$0.00,$50.00",
    "$20.00,$0.00,$20.00",
  ),
  ...month(
    "Oct 2026",
    "$0.00,$40.00,$40.00",
    "$900.00,$0.00,$1800.00",
    "$0.00,-$70.00,$130.00",
    "$0.00,-$12.50,$37.50",
    "$0.00,-$8.00,$12.00",
  ),
  ...month(
    "Nov 2026",
    "$0.00,$0.00,$40.00",
    "$0.00,$0.00,$1800.00",
    "$0.00,$0.00,$130.00",
    "$0.00,$0.00,$37.50",
    "$0.00,$0.00,$12.00",
  ),
  ...month(
    "Dec 2026",
    "$0.00,$0.00,$40.00",
    "$0.00,$0.00,$1800.00",
    "$50.00,$0.00,$180.00",
    "$0.00,$0.00,$37.50",
    "$0.00,$0.00,$12.00",
  ),
];
// Hidden rows follow the visible ones of their month, in walk order (Bills' Old Hobby, then Old's Hobby),
// and the "Old: Hobby" / "Bills: Old Hobby" labels become "Hidden Categories: ...".
const PLAN_TEXT = BOM + PLAN_LINES.join("\r\n");

const REGISTER_LINES = [
  '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"',
  '"Main Checking","","12/01/2026","Landlord","Bills: Rent","Bills","Rent","monthly",$900.00,$0.00,"Uncleared"',
  '"Old Cash","","10/25/2026","Manual Balance Adjustment","Inflow: Ready to Assign","Inflow","Ready to Assign","Closed Account",$10.00,$0.00,"Cleared"',
  '"Main Checking","","10/23/2026","Memo Test","","","","a ""q"", b\nc 🛒",$0.00,$1.00,"Uncleared"',
  '"Main Checking","","10/21/2026","Unapproved","","","","",$3.00,$0.00,"Uncleared"',
  '"Main Checking","","10/20/2026","Sixty","","","","",$60.00,$0.00,"Uncleared"',
  '"Main Checking","","10/20/2026","Five","","","","",$5.00,$0.00,"Uncleared"',
  '"Main Checking","","10/20/2026","Seven","","","","",$0.00,$7.00,"Uncleared"',
  '"House","","10/18/2026","Appraiser","","","","",$0.00,$100.00,"Uncleared"',
  '"Sample Visa","","10/15/2026","Card Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","",$40.00,$0.00,"Uncleared"',
  '"Main Checking","Red","10/14/2026","Corner Shop","Everyday: Groceries 🛒","Everyday","Groceries 🛒","Split (1/2) food",$30.00,$0.00,"Cleared"',
  '"Main Checking","Red","10/14/2026","Corner Shop","Everyday: Fun ""x"", y","Everyday","Fun ""x"", y","Split (2/2) ",$12.50,$0.00,"Cleared"',
  '"Main Checking","","10/12/2026","Hobby Shop","Hidden Categories: Hobby","Hidden Categories","Hobby","",$8.00,$0.00,"Uncleared"',
  '"Main Checking","","10/10/2026","Transfer : Rainy Day","","","","",$200.00,$0.00,"Reconciled"',
  '"Rainy Day","","10/10/2026","Transfer : Main Checking","","","","",$0.00,$200.00,"Reconciled"',
  '"Main Checking","","10/05/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","\\=bonus",$0.00,$2500.00,"Cleared"',
  '"Sample Visa","","09/01/2026","Starting Balance","","","","",$25.00,$0.00,"Cleared"',
  '"Old Cash","","09/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$10.00,"Cleared"',
  '"Rainy Day","","09/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$50.00,"Cleared"',
  '"Main Checking","","09/01/2026","Starting Balance","Inflow: Ready to Assign","Inflow","Ready to Assign","",$0.00,$1000.00,"Cleared"',
  '"House","","09/01/2026","Starting Balance","","","","",$0.00,$2000.00,"Cleared"',
];
const REGISTER_TEXT = BOM + REGISTER_LINES.join("\r\n");

const exportUrl = (bid: string, q = `?now=${NOW}`) => `/api/v1/budgets/${bid}/export${q}`;
const fetchZip = async (bid: string, q?: string) => {
  const res = await json(exportUrl(bid, q));
  expect(res.status).toBe(200);
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
};

describe("EXF-476 Export Plan (API half)", () => {
  it("case 1: names the zip and its two entries", async () => {
    const f = await buildF();
    const { res, bytes } = await fetchZip(f.bid);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${ZIP_NAME}"`);
    const zip = readZip(bytes);
    expect(zip.map((e) => e.name)).toEqual([`${STEM} - Plan.csv`, `${STEM} - Register.csv`]);
    for (const e of zip) {
      expect(e.crcOk).toBe(true);
      expect(e.date).toBe("2026-11-16");
      expect(e.time).toBe("09:05");
    }
  });

  it("case 1: without now the stamp is the UTC minute of the call", async () => {
    const f = await buildF();
    const before = utcMinute(new Date());
    const { res } = await fetchZip(f.bid, "");
    const after = utcMinute(new Date());
    const stamp = (m: string) => `${m.slice(0, 10)} ${m.slice(11, 13)}-${m.slice(14, 16)}`;
    const names = [before, after].map(
      (m) => `attachment; filename="Budget Export - ZZ TEST Ex port 7 as of ${stamp(m)}.zip"`,
    );
    expect(names).toContain(res.headers.get("Content-Disposition"));
  });

  it("case 2: BOM, CRLF only, no trailing line end, quoted text and bare amounts", async () => {
    const f = await buildF();
    const zip = readZip((await fetchZip(f.bid)).bytes);
    for (const e of zip) {
      const t = text(e.data);
      expect(Array.from(e.data.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      expect(t.endsWith("\n")).toBe(false);
      // Outside quotes every line break is CRLF; inside a quoted field a lone LF may stay.
      let quoted = false;
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (ch === '"') quoted = !quoted;
        else if (!quoted && ch === "\n") expect(t[i - 1]).toBe("\r");
        else if (!quoted && ch === "\r") expect(t[i + 1]).toBe("\n");
      }
      expect(quoted).toBe(false);
    }
    expect(text((zip[0] as { data: Uint8Array }).data).split("\r\n")[0]).toBe(BOM + PLAN_HEADER);
    expect(text((zip[1] as { data: Uint8Array }).data).split("\r\n")[0]).toBe(
      BOM + (REGISTER_LINES[0] as string),
    );
  });

  it("case 5: the Plan file, every category of every month, in screen order", async () => {
    const f = await buildF();
    const zip = readZip((await fetchZip(f.bid)).bytes);
    expect(text((zip[0] as { data: Uint8Array }).data)).toBe(PLAN_TEXT);
    // Each row's three amounts are the Plan page's own figures for that category.
    const byName: Record<string, string> = {
      Rent: f.ids.rent,
      "Groceries 🛒": f.ids.groceries,
      'Fun "x", y': f.ids.fun,
      Hobby: f.ids.hobby,
    };
    const money = (s: string) =>
      Math.round(Number(s.replace("$", "").replace("-", "")) * 1000) * (s.startsWith("-") ? -1 : 1);
    for (const m of ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]) {
      const page = ((await (await json(`/api/v1/budgets/${f.bid}/months/${m}`)).json()) as Json)
        .data;
      const cats = new Map<string, Json>(
        page.groups.flatMap((g: Json) => g.categories).map((c: Json) => [c.id, c]),
      );
      for (const [name, id] of Object.entries(byName)) {
        const c = cats.get(id) as Json;
        const label = new Date(`${m}T00:00:00Z`).toLocaleString("en-US", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });
        const line = PLAN_LINES.find(
          (l) => l.startsWith(`"${label}"`) && l.includes(`,"${name.replaceAll('"', '""')}",`),
        ) as string;
        // Amounts are never quoted and hold no comma: the last three fields of the line.
        const [a, b, d] = line.split(",").slice(-3);
        expect(
          [money(a as string), money(b as string), money(d as string)],
          `${name} ${m}`,
        ).toEqual([c.assigned, c.activity, c.available]);
      }
    }
    expect(PLAN_TEXT).not.toContain('Groceries",');
    expect(PLAN_TEXT).not.toContain("Inflow: Ready to Assign");
  });

  it("cases 6 and 7: the Register file, order, splits, transfers, flags, schedules, cleared states, formula guard", async () => {
    const f = await buildF();
    const zip = readZip((await fetchZip(f.bid)).bytes);
    expect(text((zip[1] as { data: Uint8Array }).data)).toBe(REGISTER_TEXT);
    expect(REGISTER_TEXT).toContain('"\\=bonus"');
  });

  it("case 8: the MCP tool returns the same zip", async () => {
    const f = await buildF();
    const { bytes } = await fetchZip(f.bid);
    const r = await tool("export_budget", { budget_id: f.bid, now: NOW });
    const out = JSON.parse(r.result.content[0].text) as {
      file_name: string;
      content_base64: string;
      bytes: number;
    };
    expect(out.file_name).toBe(ZIP_NAME);
    const decoded = Uint8Array.from(atob(out.content_base64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
    expect(out.bytes).toBe(bytes.length);
  });

  it("case 9: read-only, and errors", async () => {
    const f = await buildF();
    const before = await changeLogCount(f.bid);
    await fetchZip(f.bid);
    await tool("export_budget", { budget_id: f.bid, now: NOW });
    expect(await changeLogCount(f.bid)).toBe(before);
    expect((await json(exportUrl("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
    const missing = await tool("export_budget", {
      budget_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(missing.result.isError).toBe(true);
    for (const bad of ["2026-11-16 09:05", "2026-02-30T10:00", "2026-11-16T24:00"]) {
      expect((await json(exportUrl(f.bid, `?now=${encodeURIComponent(bad)}`))).status, bad).toBe(
        422,
      );
    }
  });

  it("case 12: the surface lists the route and the tool", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining(["/api/v1/budgets/{budget_id}/export"]),
    );
    expect(await listedToolNames()).toEqual(expect.arrayContaining(["export_budget"]));
  });
});
