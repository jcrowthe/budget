import { describe, expect, it } from "vitest";
import { exportFormat, type RegisterEntry, registerFile } from "../src/plan-export";
import { DEFAULT_FORMATTER } from "../src/plan-formats";

// EXF-501 part 2: the register file writes a split schedule like a split, and today's parser reads it.
const cat = (name: string) =>
  ({ kind: "category", group: "ZZ-TEST Group", name, hidden: false }) as never;

describe("a split schedule in the register file", () => {
  it("is written as consecutive Split (k/n) rows dated by its next date", () => {
    const e: RegisterEntry = {
      account: "ZZ-TEST A",
      accountRank: 0,
      date: "2026-12-15",
      amount: -4000,
      payee: "ZZ-TEST Market",
      flag: null,
      cleared: "uncleared",
      memo: null,
      category: { kind: "none" } as never,
      lines: [
        { payee: null, memo: null, amount: -3000, category: cat("Groceries") },
        { payee: null, memo: "fuel", amount: -1000, category: cat("Fun") },
      ],
      scheduled: true,
      createdAt: "2026-11-15T00:00:00Z",
      id: "s1",
    };
    const file = registerFile([e], exportFormat(DEFAULT_FORMATTER.planFormat()));
    const rows = file.split(/\r?\n/).filter((l) => l.includes("Split ("));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Split (1/2) ");
    expect(rows[1]).toContain("Split (2/2) fuel");
    expect(rows.every((r) => r.includes("12/15/2026"))).toBe(true);
  });
});
