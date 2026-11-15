import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  type AccountGroup,
  type AccountType,
  accountGroup,
  DISPLAY_GROUPS,
  type DisplayGroup,
  displayGroup,
  isLoanType,
  isOnBudget,
  positiveMeansOwed,
  type SidebarAccountLike,
  sidebarSections,
  startingBalanceAmount,
  startingBalanceFeedsReadyToAssign,
} from "../src/account-types";

const GROUPS: Record<AccountType, AccountGroup> = {
  checking: "cash",
  savings: "cash",
  cash: "cash",
  creditCard: "credit",
  lineOfCredit: "credit",
  mortgage: "loan",
  autoLoan: "loan",
  studentLoan: "loan",
  personalLoan: "loan",
  medicalDebt: "loan",
  otherDebt: "loan",
  otherAsset: "tracking",
  otherLiability: "tracking",
};

describe("account type rules", () => {
  it("groups every type", () => {
    expect(Object.keys(GROUPS).sort()).toEqual([...ACCOUNT_TYPES].sort());
    for (const t of ACCOUNT_TYPES) expect(accountGroup(t)).toBe(GROUPS[t]);
  });

  it("knows loans and on-plan types", () => {
    expect(ACCOUNT_TYPES.filter(isLoanType)).toHaveLength(6);
    const onPlan = ["checking", "savings", "cash", "creditCard", "lineOfCredit"];
    for (const t of onPlan) expect(isOnBudget(t as AccountType)).toBe(true);
    expect(isOnBudget("otherAsset")).toBe(false);
    expect(isOnBudget("otherLiability")).toBe(false);
  });

  it("says which types owe on a positive entry", () => {
    const owed = ACCOUNT_TYPES.filter(positiveMeansOwed);
    expect(owed).toEqual([
      "creditCard",
      "lineOfCredit",
      "mortgage",
      "autoLoan",
      "studentLoan",
      "personalLoan",
      "medicalDebt",
      "otherDebt",
      "otherLiability",
    ]);
  });

  it("applies the sign rule", () => {
    expect(startingBalanceAmount("checking", 250000)).toBe(250000);
    expect(startingBalanceAmount("checking", -20000)).toBe(-20000);
    expect(startingBalanceAmount("otherAsset", 5000000)).toBe(5000000);
    expect(startingBalanceAmount("creditCard", 150000)).toBe(-150000);
    expect(startingBalanceAmount("lineOfCredit", -5000)).toBe(5000);
    expect(startingBalanceAmount("otherLiability", 700000)).toBe(-700000);
    expect(Object.is(startingBalanceAmount("creditCard", 0), 0)).toBe(true);
  });

  it("feeds Ready to Assign only for cash", () => {
    for (const t of ACCOUNT_TYPES) {
      expect(startingBalanceFeedsReadyToAssign(t)).toBe(GROUPS[t] === "cash");
    }
  });
});

const DISPLAY: Record<AccountType, DisplayGroup> = {
  checking: "cash",
  savings: "cash",
  cash: "cash",
  creditCard: "credit",
  lineOfCredit: "credit",
  mortgage: "loans",
  autoLoan: "loans",
  studentLoan: "loans",
  personalLoan: "loans",
  medicalDebt: "loans",
  otherDebt: "loans",
  otherAsset: "tracking",
  otherLiability: "tracking",
};

describe("displayGroup", () => {
  it.each(ACCOUNT_TYPES)("%s, open and closed", (t) => {
    expect(displayGroup(t, false)).toBe(DISPLAY[t]);
    expect(displayGroup(t, true)).toBe("closed");
    expect(DISPLAY_GROUPS).toContain(DISPLAY[t]);
  });
});

let n = 0;
const acc = (p: Partial<SidebarAccountLike> = {}): SidebarAccountLike => ({
  id: `a${++n}`,
  name: `n${n}`,
  starred: false,
  closed: false,
  group: "cash",
  balance: 0,
  ...p,
});

describe("sidebarSections", () => {
  it("sums the ticket's examples", () => {
    const s = sidebarSections([
      acc({ group: "credit", balance: -150000 }),
      acc({ group: "credit", balance: -75000 }),
      acc({ group: "tracking", balance: 5000000 }),
      acc({ group: "tracking", balance: -700000 }),
      acc({ group: "cash", starred: true, balance: 312500 }),
    ]);
    const total = (name: string) => s.find((x) => x.name === name)?.total;
    expect(total("credit")).toBe(-225000);
    expect(total("tracking")).toBe(4300000);
    expect(total("starred")).toBe(312500);
    expect(s.map((x) => x.name)).toEqual(["starred", "cash", "credit", "tracking"]);
  });
  it("leaves empty sections out", () => {
    expect(sidebarSections([])).toEqual([]);
  });
  it("lists a starred open account twice, a starred closed one only in closed", () => {
    const open = acc({ starred: true });
    const closed = acc({ starred: true, closed: true, group: "closed" });
    const s = sidebarSections([open, closed]);
    expect(s.map((x) => x.name)).toEqual(["starred", "cash", "closed"]);
    expect(s[0]?.rows).toEqual([open]);
    expect(s[2]?.rows).toEqual([closed]);
  });
  it("sorts closed by name and gives it no total", () => {
    const s = sidebarSections(
      ["b", "A", "c"].map((name) => acc({ name, closed: true, group: "closed", balance: 5 })),
    );
    expect(s).toHaveLength(1);
    expect(s[0]?.rows.map((r) => r.name)).toEqual(["A", "b", "c"]);
    expect(s[0]?.total).toBeNull();
  });
});
