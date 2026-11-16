import { describe, expect, it } from "vitest";
import {
  bankDescriptionOf,
  categoryFor,
  daysApart,
  isDue,
  isRecoveryDuplicate,
  linkSet,
  linksCovered,
  minusDays,
  modifiedPlan,
  netChanges,
  type PlaidTxn,
  payeeNameOf,
  pickMatch,
  removedPlan,
  skipReason,
  syncStatusForError,
} from "../src/plaid-import";

const txn = (id: string, over: Partial<PlaidTxn> = {}): PlaidTxn => ({
  transaction_id: id,
  account_id: "acc",
  amount: 1,
  date: "2026-03-01",
  name: "ZZ Shop",
  merchant_name: null,
  original_description: null,
  pending: false,
  ...over,
});
const acct = {
  closed: false,
  importStartDate: "2026-03-01",
  startingBalanceDate: null as string | null,
  latestReconciledDate: null as string | null,
};

describe("syncStatusForError", () => {
  it("maps the codes", () => {
    for (const c of [
      "ITEM_LOGIN_REQUIRED",
      "PENDING_EXPIRATION",
      "PENDING_DISCONNECT",
      "ACCESS_NOT_GRANTED",
      "USER_PERMISSION_REVOKED",
      "ITEM_LOCKED",
      "INVALID_CREDENTIALS",
      "INVALID_MFA",
      "INVALID_UPDATED_USERNAME",
      "INSUFFICIENT_CREDENTIALS",
      "USER_SETUP_REQUIRED",
      "MFA_NOT_SUPPORTED",
      "NO_ACCOUNTS",
    ]) {
      expect(syncStatusForError(400, c), c).toBe("login_required");
    }
    expect(syncStatusForError(400, "ITEM_NOT_FOUND")).toBe("broken");
    expect(syncStatusForError(400, "INVALID_ACCESS_TOKEN")).toBe("broken");
    expect(syncStatusForError(400, "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")).toBe("delayed");
    expect(syncStatusForError(0, null)).toBe("delayed");
    expect(syncStatusForError(500, null)).toBe("delayed");
    expect(syncStatusForError(400, "SOMETHING_NEW")).toBe("delayed");
  });
});

describe("netChanges", () => {
  it("later pages win, removed drops an earlier add, pending is dropped", () => {
    const r = netChanges([
      { added: [txn("a"), txn("b"), txn("p", { pending: true })], modified: [], removed: [] },
      {
        added: [],
        modified: [txn("a", { amount: 2 }), txn("m")],
        removed: [{ transaction_id: "b" }, { transaction_id: "gone" }],
      },
    ]);
    expect(r.upserts.map((u) => [u.txn.transaction_id, u.kind, u.txn.amount])).toEqual([
      ["a", "added", 2],
      ["m", "modified", 1],
    ]);
    expect(r.removed.sort()).toEqual(["b", "gone"]);
  });
});

describe("dates", () => {
  it("minusDays and daysApart", () => {
    expect(minusDays("2026-03-02", 3)).toBe("2026-02-27");
    expect(daysApart("2026-03-01", "2026-03-11")).toBe(10);
    expect(daysApart("2026-03-11", "2026-03-01")).toBe(10);
  });
});

describe("names", () => {
  it("payee and description", () => {
    expect(payeeNameOf(txn("a", { merchant_name: " ZZ Cafe ", name: "ZZ CAFE #1" }))).toBe(
      "ZZ Cafe",
    );
    expect(payeeNameOf(txn("a", { merchant_name: null, name: "ZZ CAFE #1" }))).toBe("ZZ CAFE #1");
    expect(payeeNameOf(txn("a", { merchant_name: null, name: "  " }))).toBeNull();
    expect(payeeNameOf(txn("a", { name: "x".repeat(300) }))?.length).toBe(200);
    expect(bankDescriptionOf(txn("a", { original_description: "RAW" }))).toBe("RAW");
    expect(bankDescriptionOf(txn("a"))).toBe("ZZ Shop");
  });
});

describe("skipReason", () => {
  it("applies the rules in order", () => {
    expect(skipReason({ date: "2026-03-01" }, acct, false)).toBeNull();
    expect(skipReason({ date: "2026-02-28" }, acct, false)).toBe("before_start");
    expect(skipReason({ date: "2026-03-05" }, { ...acct, closed: true }, true)).toBe(
      "account_closed",
    );
    expect(
      skipReason({ date: "2026-03-05" }, { ...acct, startingBalanceDate: "2026-03-06" }, false),
    ).toBe("before_start");
    expect(skipReason({ date: "2026-03-05" }, acct, true)).toBe("known");
  });
  it("reconciled grace: 3 days before is imported, 4 is not", () => {
    const a = { ...acct, importStartDate: null, latestReconciledDate: "2026-03-10" };
    expect(skipReason({ date: "2026-03-07" }, a, false)).toBeNull();
    expect(skipReason({ date: "2026-03-06" }, a, false)).toBe("before_reconciled");
  });
});

describe("pickMatch", () => {
  const c = (id: string, date: string, createdAt = "1", amount = -5) => ({
    id,
    date,
    amount,
    createdAt,
  });
  const imp = { date: "2026-03-10", amount: -5 };
  it("10 days match, 11 do not", () => {
    expect(pickMatch(imp, [c("a", "2026-02-28")], new Set())).toBe("a");
    expect(pickMatch(imp, [c("a", "2026-02-27")], new Set())).toBeNull();
    expect(pickMatch(imp, [c("a", "2026-03-20")], new Set())).toBe("a");
    expect(pickMatch(imp, [c("a", "2026-03-21")], new Set())).toBeNull();
  });
  it("needs the same amount", () => {
    expect(pickMatch(imp, [c("a", "2026-03-10", "1", -6)], new Set())).toBeNull();
  });
  it("closest date, then oldest, then id; a used candidate is skipped", () => {
    expect(pickMatch(imp, [c("far", "2026-03-05"), c("near", "2026-03-08")], new Set())).toBe(
      "near",
    );
    expect(
      pickMatch(imp, [c("new", "2026-03-08", "2"), c("old", "2026-03-12", "1")], new Set()),
    ).toBe("old");
    expect(pickMatch(imp, [c("b", "2026-03-08", "1"), c("a", "2026-03-08", "1")], new Set())).toBe(
      "a",
    );
    expect(
      pickMatch(imp, [c("near", "2026-03-08"), c("far", "2026-03-05")], new Set(["near"])),
    ).toBe("far");
  });
});

describe("recovery and category", () => {
  it("same date and amount", () => {
    expect(isRecoveryDuplicate({ date: "d", amount: 1 }, [{ date: "d", amount: 1 }])).toBe(true);
    expect(isRecoveryDuplicate({ date: "d", amount: 1 }, [{ date: "d", amount: 2 }])).toBe(false);
  });
  it("categoryFor", () => {
    const on = { takesCategory: true, rtaInflow: true };
    expect(categoryFor(on, 5, { lastCategoryId: "c" })).toEqual({
      categoryId: "c",
      inflowToReadyToAssign: false,
    });
    expect(categoryFor(on, 5, null)).toEqual({ categoryId: null, inflowToReadyToAssign: true });
    expect(categoryFor(on, -5, null)).toEqual({ categoryId: null, inflowToReadyToAssign: false });
    expect(
      categoryFor({ takesCategory: false, rtaInflow: false }, 5, { lastCategoryId: "c" }),
    ).toEqual({
      categoryId: null,
      inflowToReadyToAssign: false,
    });
    expect(
      categoryFor({ takesCategory: true, rtaInflow: false }, 5, null).inflowToReadyToAssign,
    ).toBe(false);
  });
});

describe("modifiedPlan and removedPlan", () => {
  const row = (
    approved: boolean,
    source: string | null,
    cleared: "uncleared" | "cleared" | "reconciled",
  ) => ({
    approved,
    source,
    cleared,
  });
  it("follows only an unapproved unmatched import", () => {
    expect(modifiedPlan(row(false, "plaid", "cleared"))).toBe("follow");
    expect(modifiedPlan(row(true, "plaid", "cleared"))).toBe("description_only");
    expect(modifiedPlan(row(true, null, "cleared"))).toBe("description_only");
    expect(removedPlan(row(false, "plaid", "cleared"))).toBe("delete");
    expect(removedPlan(row(true, "plaid", "cleared"))).toBe("keep");
    expect(removedPlan(row(true, null, "cleared"))).toBe("keep");
  });
  it("a reconciled row only takes the description, whatever else", () => {
    for (const approved of [true, false])
      for (const source of ["plaid", null]) {
        expect(modifiedPlan(row(approved, source, "reconciled"))).toBe("bank_description_only");
        expect(removedPlan(row(approved, source, "reconciled"))).toBe("keep");
      }
  });
});

describe("isDue and links", () => {
  const now = Date.parse("2026-03-10T12:00:00.000Z");
  it("is due at exactly 6 hours, not before; never when it needs repair", () => {
    expect(isDue(null, "connected", now)).toBe(true);
    expect(isDue("2026-03-10T06:00:00.000Z", "connected", now)).toBe(true);
    expect(isDue("2026-03-10T06:00:00.001Z", "connected", now)).toBe(false);
    expect(isDue("2026-03-10T11:00:00.000Z", "delayed", now)).toBe(false);
    expect(isDue(null, "login_required", now)).toBe(false);
    expect(isDue(null, "broken", now)).toBe(false);
  });
  it("linkSet is sorted and linksCovered checks containment", () => {
    const s = linkSet([
      { id: "b", importStartDate: "2026-03-02" },
      { id: "a", importStartDate: null },
    ]);
    expect(s).toBe("a:,b:2026-03-02");
    expect(linksCovered(s, s)).toBe(true);
    expect(linksCovered(s, "b:2026-03-02")).toBe(false);
    expect(linksCovered("a:", "a:,b:2026-03-02")).toBe(true);
    expect(linksCovered("", null)).toBe(true);
    expect(linksCovered("a:", null)).toBe(false);
  });
});
