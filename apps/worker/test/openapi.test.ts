import { describe, expect, it } from "vitest";
import { json } from "./helpers";

describe("openapi", () => {
  it("lists every glob-registered route", async () => {
    const res = await json("/api/v1/openapi.json");
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(
      [
        "/api/v1/budgets",
        "/api/v1/budgets/{budget_id}/months",
        "/api/v1/budgets/{budget_id}/months/{month}",
        "/api/v1/budgets/{id}",
        "/api/v1/health",
      ].sort(),
    );
  });
});
