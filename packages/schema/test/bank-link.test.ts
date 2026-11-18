import { describe, expect, it } from "vitest";
import {
  addAccountsLabel,
  bankAccountLabel,
  connectionLabel,
  defaultAccountName,
  linkStatus,
  planAccountType,
  planBalanceOf,
  planSyncDue,
  syncLine,
} from "../src/bank-link";
import { DUE_AFTER_MS } from "../src/plaid-import";

describe("planAccountType", () => {
  it.each([
    ["depository", "checking", "checking"],
    ["depository", null, "checking"],
    ["depository", "savings", "savings"],
    ["depository", "money market", "savings"],
    ["depository", "CD", "savings"],
    ["depository", "hsa", "savings"],
    ["credit", "credit card", "creditCard"],
    ["loan", "mortgage", "mortgage"],
    ["loan", "auto", "autoLoan"],
    ["loan", "student", "studentLoan"],
    ["loan", "home equity", "personalLoan"],
    ["loan", null, "personalLoan"],
    ["investment", "brokerage", "otherAsset"],
  ])("%s / %s is %s", (t, s, want) => {
    expect(planAccountType(t, s)).toBe(want);
  });
});

describe("planBalanceOf", () => {
  it("signs owed balances negative and never gives -0", () => {
    expect(planBalanceOf("depository", 125050)).toBe(125050);
    expect(planBalanceOf("credit", 42025)).toBe(-42025);
    expect(planBalanceOf("loan", 0)).toBe(0);
    expect(Object.is(planBalanceOf("loan", 0), 0)).toBe(true);
    expect(planBalanceOf("depository", null)).toBe(0);
    expect(planBalanceOf("credit", null)).toBe(0);
  });
});

describe("labels", () => {
  it("names a bank account with an en dash, or alone without a mask", () => {
    expect(bankAccountLabel("ZZ Checking", "0000")).toBe("ZZ Checking – 0000");
    expect(bankAccountLabel("ZZ Savings", null)).toBe("ZZ Savings");
    expect(bankAccountLabel("ZZ Savings", "")).toBe("ZZ Savings");
  });
  it("counts the accounts to add", () => {
    expect(addAccountsLabel(1)).toBe("Add 1 Account");
    expect(addAccountsLabel(2)).toBe("Add 2 Accounts");
  });
  it("names the default account name when the bank's is blank", () => {
    const b = { name: "  ", type: "depository", subtype: "savings", mask: "1234" };
    expect(defaultAccountName(b)).toBe("savings 1234");
    expect(defaultAccountName({ ...b, name: " ZZ " })).toBe("ZZ");
  });
  it("labels each connection status", () => {
    expect(connectionLabel("connected")).toBe("Connected");
    expect(connectionLabel("delayed")).toBe("Imports Delayed");
    expect(connectionLabel("login_required")).toBe("Connection Repair Needed");
    expect(connectionLabel("broken")).toBe("Connection Lost");
    expect(connectionLabel("not_set_up")).toBe("Bank connections are not set up");
  });
  it("reads a linked account without a status as broken, an unlinked one as none", () => {
    expect(linkStatus({ linked: false, connection_status: null })).toBeNull();
    expect(linkStatus({ linked: true, connection_status: null })).toBe("broken");
    expect(linkStatus({ linked: true, connection_status: "delayed" })).toBe("delayed");
  });
});

describe("syncLine", () => {
  const zero = { added: 0, matched: 0, modified: 0, removed: 0, skipped: 0, has_more: false };
  it("words the counts", () => {
    expect(syncLine({ ...zero, status: "connected" })).toBe("Synced: nothing new.");
    expect(syncLine({ ...zero, status: "connected", added: 3, matched: 1 })).toBe(
      "Synced: 3 new, 1 matched.",
    );
    expect(syncLine({ ...zero, status: "delayed", modified: 2 })).toBe(
      "Imports Delayed: 2 updated.",
    );
    expect(syncLine({ ...zero, status: "not_set_up" })).toBe("Bank connections are not set up.");
    expect(syncLine({ ...zero, status: "connected", added: 1, has_more: true })).toBe(
      "Synced: 1 new. More to import: press Sync Now again.",
    );
  });
});

describe("planSyncDue", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const at = (ms: number) => new Date(now - ms).toISOString();
  const acc = (last_synced_at: string | null, over = {}) => ({
    linked: true,
    closed: false,
    last_synced_at,
    ...over,
  });
  it("is due at exactly six hours, never before", () => {
    expect(planSyncDue([acc(at(DUE_AFTER_MS))], now)).toBe(true);
    expect(planSyncDue([acc(at(DUE_AFTER_MS - 60_000))], now)).toBe(false);
  });
  it("is due for a never synced account", () => {
    expect(planSyncDue([acc(null)], now)).toBe(true);
  });
  it("ignores closed and unlinked accounts", () => {
    expect(planSyncDue([acc(null, { closed: true }), acc(null, { linked: false })], now)).toBe(
      false,
    );
    expect(planSyncDue([], now)).toBe(false);
  });
});
