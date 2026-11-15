import { describe, expect, it } from "vitest";
import { apiDocument, apiPaths, routeFilePaths, routeModules } from "./surface";

describe("openapi", () => {
  it("serves an OpenAPI 3.1.0 document", async () => {
    expect((await apiDocument()).openapi).toBe("3.1.0");
  });

  it("every path is under /api/v1/", async () => {
    const offenders = (await apiPaths()).filter((p) => !p.startsWith("/api/v1/"));
    expect(offenders).toEqual([]);
  });

  it("the route glob finds route files", () => {
    expect(Object.keys(routeModules).length).toBeGreaterThan(0);
  });

  it.each(Object.keys(routeModules).sort())(
    "route file %s contributes at least one path",
    async (file) => {
      const mod = routeModules[file];
      if (!mod) throw new Error(`no route module ${file}`);
      const paths = routeFilePaths(mod);
      expect(paths.length).toBeGreaterThan(0);
      expect(await apiPaths()).toEqual(expect.arrayContaining(paths));
    },
  );

  it("every documented path comes from a route file", async () => {
    const fromFiles = [...new Set(Object.values(routeModules).flatMap(routeFilePaths))].sort();
    expect((await apiPaths()).sort()).toEqual(fromFiles);
  });
});
