import { describe, expect, it } from "vitest";
import { tools } from "../src/mcp/tools/bank-connections";

describe("the bank connection tools say what each status asks of the owner", () => {
  it("list_bank_connections and get_bank_connection carry the status's action", () => {
    for (const name of ["list_bank_connections", "get_bank_connection"]) {
      const d = tools.find((t) => t.name === name)?.description ?? "";
      expect(d).toContain("login_required (the owner must sign in to the bank again");
      expect(d).toContain("broken (cannot be repaired");
      expect(d).toContain("more than 3 days old, suggest Reset in Bank Connections");
    }
  });
});
