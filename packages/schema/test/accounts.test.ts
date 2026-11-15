import { describe, expect, it } from "vitest";
import { AccountCreateRequest } from "../src/accounts";

describe("AccountCreateRequest", () => {
  const ok = { name: "Main", type: "checking", balance: 1000 };
  it("trims the name and needs no date", () => {
    const v = AccountCreateRequest.parse({ ...ok, name: "  Main  " });
    expect(v.name).toBe("Main");
    expect(v.date).toBeUndefined();
  });
  it("refuses bad input", () => {
    for (const bad of [
      { ...ok, name: "   " },
      { ...ok, type: "mortgagee" },
      { ...ok, balance: 1.5 },
      { ...ok, date: "2026-02-30" },
      { ...ok, date: "1899-12-31" },
    ]) {
      expect(AccountCreateRequest.safeParse(bad).success).toBe(false);
    }
    expect(AccountCreateRequest.safeParse({ ...ok, date: "2026-11-15" }).success).toBe(true);
  });
});
