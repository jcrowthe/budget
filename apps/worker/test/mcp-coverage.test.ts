import { describe, expect, it } from "vitest";
import type { Coverage, OperationKey } from "./mcp-coverage-types";
import { apiDocument, listedToolNames } from "./surface";

type CoverageModule = {
  operations?: Partial<Record<OperationKey, Coverage>>;
  toolsWithoutOperation?: Record<string, string>;
};

// One coverage file per resource in ./mcp-coverage/, collected like routes and tools in surface.ts.
const modules = import.meta.glob<CoverageModule>("./mcp-coverage/*.ts", { eager: true });

const duplicates: string[] = [];
const operations: Record<string, Coverage> = {};
const toolsWithoutOperation: Record<string, string> = {};
for (const [file, mod] of Object.entries(modules)) {
  for (const [op, c] of Object.entries(mod.operations ?? {})) {
    if (op in operations) duplicates.push(`${op} (again in ${file})`);
    operations[op] = c as Coverage;
  }
  for (const [tool, reason] of Object.entries(mod.toolsWithoutOperation ?? {})) {
    if (tool in toolsWithoutOperation) duplicates.push(`tool ${tool} (again in ${file})`);
    toolsWithoutOperation[tool] = reason;
  }
}

const toolsOf = (c: { tool: string | string[] }) => (Array.isArray(c.tool) ? c.tool : [c.tool]);

const METHODS = ["get", "post", "put", "patch", "delete"];

async function documentOperations(): Promise<string[]> {
  const doc = await apiDocument();
  return Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.keys(item as object)
      .filter((k) => METHODS.includes(k))
      .map((k) => `${k.toUpperCase()} ${path.slice("/api/v1".length)}`),
  );
}

function mapped(): [string, string][] {
  return Object.entries(operations).flatMap(([op, c]) =>
    "tool" in c ? toolsOf(c).map((t): [string, string] => [op, t]) : [],
  );
}

describe("mcp-coverage", () => {
  it("no two coverage files claim the same operation or tool without an operation", () => {
    expect(
      duplicates,
      "Two files in apps/worker/test/mcp-coverage/ claim the same entry. Each operation belongs to the file of its resource, once.",
    ).toEqual([]);
  });

  it("every REST operation has an MCP tool or a stated exclusion", async () => {
    const missing = (await documentOperations()).filter((op) => !(op in operations));
    expect(
      missing,
      "REST operations with no MCP tool and no exclusion. For each, add its tool in apps/worker/src/mcp/tools/ and one line in apps/worker/test/mcp-coverage/<resource>.ts, or an { excluded: reason } line (docs/conventions.md step 7).",
    ).toEqual([]);
  });

  it("every mapped tool is in tools/list", async () => {
    const listed = await listedToolNames();
    const missing = mapped()
      .filter(([, tool]) => !listed.includes(tool))
      .map(([op, tool]) => `${op} → ${tool}`);
    expect(
      missing,
      "Mapped tools that tools/list does not offer. Add the tool in apps/worker/src/mcp/tools/ or fix the line in apps/worker/test/mcp-coverage/<resource>.ts.",
    ).toEqual([]);
  });

  it("every tool line names an operation of the document", async () => {
    const ops = await documentOperations();
    const stale = mapped()
      .map(([op]) => op)
      .filter((op) => !ops.includes(op));
    expect(
      stale,
      "Stale lines in apps/worker/test/mcp-coverage/<resource>.ts: the OpenAPI document has no such operation. Fix or remove the line.",
    ).toEqual([]);
  });

  it("every listed tool maps to an operation or is listed as a tool without one", async () => {
    const known = new Set([...mapped().map(([, t]) => t), ...Object.keys(toolsWithoutOperation)]);
    const orphans = (await listedToolNames()).filter((t) => !known.has(t));
    expect(
      orphans,
      "Tools that map to no REST operation. Add a line for the operation in apps/worker/test/mcp-coverage/<resource>.ts, or list the tool in toolsWithoutOperation with its reason.",
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
      "toolsWithoutOperation in apps/worker/test/mcp-coverage/<resource>.ts names a tool that is not listed or that also maps to an operation.",
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
