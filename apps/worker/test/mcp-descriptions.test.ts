import { describe, expect, it } from "vitest";
import { operations } from "./mcp-coverage-map";
import { apiDocument, mcpRpc, toolFileNames } from "./surface";

// biome-ignore lint/suspicious/noExplicitAny: JSON schema nodes
type Schema = any;
type Listed = { name: string; description: string; inputSchema: Schema };

const loaded = (async () => {
  await mcpRpc(
    "initialize",
    { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    1,
  );
  const list = await mcpRpc("tools/list", {}, 2);
  return {
    tools: (list.body.result?.tools ?? []) as unknown as Listed[],
    doc: (await apiDocument()) as unknown as { paths: Record<string, Schema>; components?: Schema },
  };
})();

function hasInteger(node: Schema, doc: Schema, seen = new Set<string>()): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => hasInteger(n, doc, seen));
  if (typeof node.$ref === "string") {
    const m = /^#\/components\/schemas\/(.+)$/.exec(node.$ref);
    if (!m || seen.has(m[1] as string)) return false;
    seen.add(m[1] as string);
    return hasInteger(doc.components?.schemas?.[m[1] as string], doc, seen);
  }
  const t = node.type;
  if (t === "integer" || (Array.isArray(t) && t.includes("integer"))) return true;
  return Object.values(node).some((v) => hasInteger(v, doc, seen));
}

const patternsOf = (prop: Schema): string[] =>
  [prop, ...(prop.allOf ?? []), ...(prop.anyOf ?? [])]
    .map((p: Schema) => p?.pattern)
    .filter((p): p is string => typeof p === "string");

const branches = (prop: Schema): Schema[] =>
  prop.anyOf ? prop.anyOf.filter((b: Schema) => b.type !== "null") : [prop];

describe("mcp-descriptions", () => {
  it.each(toolFileNames().sort())("%s describes itself", async (name) => {
    const { tools, doc } = await loaded;
    const tool = tools.find((t) => t.name === name);
    expect(tool, `${name}: listed in tools/list`).toBeDefined();
    const { description, inputSchema } = tool as Listed;
    expect(
      description.length,
      `${name}: description of at least 80 characters`,
    ).toBeGreaterThanOrEqual(80);
    expect(description, `${name}: says what it returns ("Returns ...")`).toMatch(/\bReturns\b/);

    let money = hasInteger(inputSchema, doc);
    for (const [key, c] of Object.entries(operations)) {
      if (!("tool" in c) || c.tool !== name) continue;
      const [method, path] = key.split(" ") as [string, string];
      const responses = doc.paths[`/api/v1${path}`]?.[method.toLowerCase()]?.responses ?? {};
      for (const [status, r] of Object.entries<Schema>(responses)) {
        if (status.startsWith("2") && hasInteger(r?.content?.["application/json"]?.schema, doc)) {
          money = true;
        }
      }
    }
    if (money) {
      expect(description, `${name}: takes or returns money, say "milliunits"`).toContain(
        "milliunits",
      );
      expect(description, `${name}: say "1000 = one currency unit"`).toContain(
        "1000 = one currency unit",
      );
    }

    const props = Object.entries<Schema>(inputSchema.properties ?? {});
    const isMonth = (p: Schema) => patternsOf(p).some((x) => x.endsWith("-01$"));
    const isDate = (p: Schema) => !isMonth(p) && patternsOf(p).includes("^\\d{4}-\\d{2}-\\d{2}$");
    if (props.some(([, p]) => isMonth(p))) {
      expect(description, `${name}: takes a month, say "YYYY-MM-01"`).toContain("YYYY-MM-01");
    }
    if (props.some(([, p]) => isDate(p))) {
      expect(description, `${name}: takes a date, say "YYYY-MM-DD"`).toContain("YYYY-MM-DD");
    }

    for (const [prop, schema] of props) {
      if (prop !== "id" && !prop.endsWith("_id")) continue;
      for (const b of branches(schema)) {
        const ok =
          b.type === "string" &&
          b.minLength === 1 &&
          b.format === undefined &&
          b.pattern === undefined;
        expect(ok, `${name}: ${prop} must be a non-empty string without format or pattern`).toBe(
          true,
        );
      }
    }
  });
});
