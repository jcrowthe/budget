import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  type AccountGroup,
  type AccountType,
  accountGroup,
  isLoanType,
  isOnBudget,
  positiveMeansOwed,
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
