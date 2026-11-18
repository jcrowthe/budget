import { describe, expect, it } from "vitest";
import { tools as accountTools } from "../src/mcp/tools/accounts";
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

  it("list_bank_connections names status_reason and each value, and the account tools link_missing_since", () => {
    const d = tools.find((t) => t.name === "list_bank_connections")?.description ?? "";
    expect(d).toContain("status_reason");
    for (const v of ["unavailable (", "unsupported (", "reauthorize ("]) expect(d).toContain(v);
    expect(d).toContain("tell the owner to open the app");
    expect(d).toContain("reauthorize with Reauthorize in the app");
    const accounts = accountTools.find((t) => t.name === "list_accounts")?.description ?? "";
    expect(accounts).toContain("link_missing_since");
    expect(accounts).toContain("Linked Account Not Found");
  });
});
