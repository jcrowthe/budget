import { describe, expect, it } from "vitest";
import { tool } from "./bulk-helpers";
import {
  account,
  actor,
  b64,
  fixture,
  importOk,
  type Json,
  logRows,
  plan,
  preview,
  rowsOf,
  TODAY,
} from "./file-import-helpers";
import { pinPlanClock } from "./plan-export-helpers";
import { apiPaths, listedToolNames } from "./surface";

pinPlanClock();

const PREVIEW = "/api/v1/budgets/{budget_id}/accounts/{account_id}/imports/preview";
const IMPORT = "/api/v1/budgets/{budget_id}/accounts/{account_id}/imports";

/** The tool result's data. */
const out = (r: Json): Json => {
  expect(r.result?.isError, JSON.stringify(r).slice(0, 500)).not.toBe(true);
  return r.result.structuredContent;
};
const norm = (v: Json): Json =>
  JSON.parse(
    JSON.stringify(v)
      .replace(/"(file_id|expires_at)":"[^"]*"/g, '"$1":"X"')
      .replace(/file:v1:[0-9a-f-]{36}:/g, "file:v1:ACCOUNT:"),
  );

describe("file import over MCP (AC14)", () => {
  it("lists both operations and both tools", async () => {
    expect(await apiPaths()).toEqual(expect.arrayContaining([PREVIEW, IMPORT]));
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["preview_transactions_file", "import_transactions_file"]),
    );
  });

  it("returns the same data as REST, by file_id and by content", async () => {
    const [b1, b2, b3] = [await plan(), await plan(), await plan()];
    const [a1, a2, a3] = [await account(b1), await account(b2), await account(b3)];
    const text = fixture("sample.csv");
    const restPreview = await preview(b1, a1, "sample.csv", text, { today: TODAY });
    const mcpPreview = out(
      await tool("preview_transactions_file", {
        budget_id: b2,
        account_id: a2,
        file_name: "sample.csv",
        content_base64: b64(text),
        options: { today: TODAY },
      }),
    );
    expect(norm(mcpPreview)).toEqual(norm(restPreview));

    const restResult = await importOk(b1, a1, restPreview.file_id);
    const mcpResult = out(
      await tool("import_transactions_file", {
        budget_id: b2,
        account_id: a2,
        file_id: mcpPreview.file_id,
        options: { today: TODAY },
      }),
    );
    expect(mcpResult).toEqual(restResult);

    const byContent = out(
      await tool("import_transactions_file", {
        budget_id: b3,
        account_id: a3,
        file_name: "sample.csv",
        content_base64: b64(text),
        options: { today: TODAY },
      }),
    );
    expect(byContent).toEqual(restResult);
    const strip = (rows: Json[]) =>
      rows.map((r) => `${r.date}|${r.amount}|${r.payee_name}|${r.cleared}|${r.source}`);
    expect(strip(await rowsOf(a3))).toEqual(strip(await rowsOf(a1)));

    const fileIds = new Set((await rowsOf(a3)).filter((r) => r.source === "file").map((r) => r.id));
    const mcpLogs = (await logRows(b3, "transaction")).filter((l) => fileIds.has(l.entity_id));
    expect(mcpLogs).toHaveLength(2);
    for (const l of mcpLogs) expect(l.actor.startsWith("mcp:")).toBe(true);
    const restIds = new Set((await rowsOf(a1)).filter((r) => r.source === "file").map((r) => r.id));
    const restLogs = (await logRows(b1, "transaction")).filter((l) => restIds.has(l.entity_id));
    expect(restLogs).toHaveLength(2);
    for (const l of restLogs) expect(l.actor).toBe(actor);
  });

  it("refuses both or neither of file_id and content, as a tool error", async () => {
    const bid = await plan();
    const aid = await account(bid);
    const r = await tool("import_transactions_file", {
      budget_id: bid,
      account_id: aid,
      options: { today: TODAY },
    });
    expect(r.result.isError).toBe(true);
    const both = await tool("import_transactions_file", {
      budget_id: bid,
      account_id: aid,
      file_id: "x",
      file_name: "a.csv",
      content_base64: b64("x"),
      options: { today: TODAY },
    });
    expect(both.result.isError).toBe(true);
  });
});
