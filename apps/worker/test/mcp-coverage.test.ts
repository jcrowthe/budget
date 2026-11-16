import { describe, expect, it } from "vitest";
import { type OperationKey, operations, toolsWithoutOperation } from "./mcp-coverage-map";
import { apiDocument, listedToolNames } from "./surface";

const METHODS = ["get", "post", "put", "patch", "delete"];

async function documentOperations(): Promise<string[]> {
  const doc = await apiDocument();
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.keys(item as object)
      .filter((k) => METHODS.includes(k))
      .map((k) => `${k.toUpperCase()} ${path.slice("/api/v1".length)}`),
  );
}

function mapped(): [OperationKey, string][] {
  return (Object.entries(operations) as [OperationKey, (typeof operations)[OperationKey]][])
    .filter((e): e is [OperationKey, { tool: string }] => "tool" in e[1])
    .map(([op, c]) => [op, c.tool]);
}

describe("mcp-coverage", () => {
  it("every REST operation has an MCP tool or a stated exclusion", async () => {
    const missing = (await documentOperations()).filter((op) => !(op in operations));
    expect(
      missing,
      "REST operations with no MCP tool and no exclusion. For each, add its tool in apps/worker/src/mcp/tools/ and one line in apps/worker/test/mcp-coverage-map.ts, or an { excluded: reason } line (docs/conventions.md step 7).",
    ).toEqual([]);
  });

  it("every mapped tool is in tools/list", async () => {
    const listed = await listedToolNames();
    const missing = mapped()
      .filter(([, tool]) => !listed.includes(tool))
      .map(([op, tool]) => `${op} → ${tool}`);
    expect(
      missing,
      "Mapped tools that tools/list does not offer. Add the tool in apps/worker/src/mcp/tools/ or fix the line in apps/worker/test/mcp-coverage-map.ts.",
    ).toEqual([]);
  });

  it("every tool line names an operation of the document", async () => {
    const ops = await documentOperations();
    const stale = mapped()
      .map(([op]) => op as string)
      .filter((op) => !ops.includes(op));
    expect(
      stale,
      "Stale lines in apps/worker/test/mcp-coverage-map.ts: the OpenAPI document has no such operation. Fix or remove the line.",
    ).toEqual([]);
  });

  it("every listed tool maps to an operation or is listed as a tool without one", async () => {
    const known = new Set([...mapped().map(([, t]) => t), ...Object.keys(toolsWithoutOperation)]);
    const orphans = (await listedToolNames()).filter((t) => !known.has(t));
    expect(
      orphans,
      "Tools that map to no REST operation. Add a line for the operation in apps/worker/test/mcp-coverage-map.ts, or list the tool in toolsWithoutOperation with its reason.",
    ).toEqual([]);
  });

  it("tools without an operation are listed and map to none", async () => {
    const listed = await listedToolNames();
    const mappedTools = mapped().map(([, t]) => t);
    const bad = Object.keys(toolsWithoutOperation).filter(
      (t) => !listed.includes(t) || mappedTools.includes(t),
    );
    expect(
      bad,
      "toolsWithoutOperation in apps/worker/test/mcp-coverage-map.ts names a tool that is not listed or that also maps to an operation.",
    ).toEqual([]);
  });

  it("every exclusion and note states a reason", () => {
    const short = Object.entries(operations)
      .filter(([, c]) => {
        const text = "excluded" in c ? c.excluded : c.note;
        return text !== undefined && text.length < 10;
      })
      .map(([op]) => op);
    expect(short, "Exclusions and notes need a reason of at least 10 characters.").toEqual([]);
  });
});
