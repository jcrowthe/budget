import { describe, expect, it } from "vitest";
import { apiPaths, listedToolNames } from "./surface";

// New resources assert their own surface in their own test file; do not add them here.
describe("existing-surface", () => {
  it("budgets, months and health paths are documented", async () => {
    expect(await apiPaths()).toEqual(
      expect.arrayContaining([
        "/api/v1/health",
        "/api/v1/budgets",
        "/api/v1/budgets/{id}",
        "/api/v1/budgets/{budget_id}/months",
        "/api/v1/budgets/{budget_id}/months/{month}",
      ]),
    );
  });

  it("budgets and months tools are listed", async () => {
    expect(await listedToolNames()).toEqual(
      expect.arrayContaining(["list_budgets", "create_budget", "get_plan_month"]),
    );
  });
});
