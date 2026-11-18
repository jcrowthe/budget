import { describe, expect, it } from "vitest";
import {
  MATCH_TEXT,
  type MatchRow,
  matchActions,
  matchLabel,
  matchRefusal,
  matchRole,
  unmatchRefusal,
} from "../src/manual-match";
import { DEFAULT_FORMATTER } from "../src/plan-formats";

const fmt = DEFAULT_FORMATTER;
let n = 0;
const row = (over: Partial<MatchRow> = {}): MatchRow => ({
  id: `id-${++n}`,
  account_id: "acct",
  date: "2026-03-12",
  payee_name: "ZZ Cafe",
  amount: -12340,
  cleared: "uncleared",
  approved: true,
  import_id: null,
  source: null,
  transfer_account_id: null,
  subtransactions: [],
  match_details: null,
  ...over,
});
const imp = (over: Partial<MatchRow> = {}) =>
  row({
    payee_name: "ZZ Bank Cafe",
    date: "2026-04-01",
    amount: -13000,
    cleared: "cleared",
    approved: false,
    import_id: "bank-1",
    source: "plaid",
    ...over,
  });
const matched = (over: Partial<MatchRow> = {}) =>
  row({
    import_id: "bank-1",
    amount: -13000,
    cleared: "cleared",
    match_details: { date: "2026-04-01", amount: -13000, payee_name: "ZZ Bank Cafe" },
    ...over,
  });
const ctx = (closed: string[] = []) => ({ closed: (id: string) => closed.includes(id), fmt });
const L = (r: MatchRow) => matchLabel(r, fmt);

describe("matchRefusal", () => {
  it("1: two accounts", () => {
    const a = row();
    const b = imp({ account_id: "other" });
    expect(matchRefusal(a, b, ctx())).toEqual({
      name: "not_matchable",
      detail: MATCH_TEXT.differentAccounts(L(a), L(b)),
    });
  });
  it("2: a closed account", () => {
    expect(matchRefusal(row(), imp(), ctx(["acct"]))?.name).toBe("account_closed");
  });
  it("3: already matched, the first one named", () => {
    const m = matched();
    expect(matchRefusal(imp(), m, ctx())?.detail).toBe(MATCH_TEXT.alreadyMatched(L(m)));
    expect(matchRefusal(m, imp(), ctx())?.detail).toBe(MATCH_TEXT.alreadyMatched(L(m)));
  });
  it("4: two imports, two entries", () => {
    const want = { name: "not_matchable", detail: MATCH_TEXT.needOneOfEach };
    expect(matchRefusal(imp(), imp({ import_id: "bank-2" }), ctx())).toEqual(want);
    expect(matchRefusal(row(), row(), ctx())).toEqual(want);
  });
  it("5: an approved import", () => {
    const i = imp({ approved: true });
    expect(matchRefusal(row(), i, ctx())?.detail).toBe(MATCH_TEXT.importApproved(L(i)));
  });
  it("6: a split or a transfer import", () => {
    const s = imp({ subtransactions: [{} as never] });
    expect(matchRefusal(row(), s, ctx())?.detail).toBe(MATCH_TEXT.importSplit(L(s)));
    const t = imp({ transfer_account_id: "x" });
    expect(matchRefusal(row(), t, ctx())?.detail).toBe(MATCH_TEXT.importTransfer(L(t)));
  });
  it("7: a reconciled import", () => {
    const i = imp({ cleared: "reconciled" });
    expect(matchRefusal(row(), i, ctx())).toEqual({
      name: "transaction_reconciled",
      detail: MATCH_TEXT.importReconciled(L(i)),
    });
  });
  it("8a, 8b, 8c: amounts differ", () => {
    expect(matchRefusal(row({ subtransactions: [{} as never] }), imp(), ctx())?.detail).toBe(
      MATCH_TEXT.splitMismatch("−$12.34", "−$13.00"),
    );
    expect(matchRefusal(row({ transfer_account_id: "x" }), imp(), ctx())?.detail).toBe(
      MATCH_TEXT.transferMismatch("−$12.34", "−$13.00"),
    );
    const e = row({ cleared: "reconciled" });
    expect(matchRefusal(e, imp(), ctx())).toEqual({
      name: "transaction_reconciled",
      detail: MATCH_TEXT.entryReconciled(L(e), "−$13.00"),
    });
  });
  it("matches at any distance, with equal amounts too, split, transfer or reconciled", () => {
    expect(matchRefusal(row({ date: "2026-01-01" }), imp(), ctx())).toBeNull();
    const same = { amount: -13000 };
    expect(matchRefusal(row({ ...same, subtransactions: [{} as never] }), imp(), ctx())).toBeNull();
    expect(matchRefusal(row({ ...same, transfer_account_id: "x" }), imp(), ctx())).toBeNull();
    expect(matchRefusal(row({ ...same, cleared: "reconciled" }), imp(), ctx())).toBeNull();
    expect(matchRefusal(imp(), row(), ctx())).toBeNull();
  });
});

describe("unmatchRefusal", () => {
  it("each refusal in order", () => {
    const e = row();
    expect(unmatchRefusal(e, ctx())).toEqual({
      name: "not_matched",
      detail: MATCH_TEXT.notMatched(L(e)),
    });
    expect(unmatchRefusal(matched(), ctx(["acct"]))?.name).toBe("account_closed");
    const r = matched({ cleared: "reconciled" });
    expect(unmatchRefusal(r, ctx())).toEqual({
      name: "transaction_reconciled",
      detail: MATCH_TEXT.unmatchReconciled(L(r)),
    });
    const n0 = matched({ match_details: null });
    expect(unmatchRefusal(n0, ctx())).toEqual({
      name: "not_matched",
      detail: MATCH_TEXT.noBankCopy(L(n0)),
    });
    expect(unmatchRefusal(matched(), ctx())).toBeNull();
  });
});

describe("matchActions", () => {
  const acct = () => ({ closed: false });
  it("offers nothing for 0 or 3 rows", () => {
    expect(matchActions([], acct, fmt)).toEqual({ match: null, unmatch: null });
    expect(matchActions([row(), row(), imp()], acct, fmt)).toEqual({ match: null, unmatch: null });
  });
  it("Match for two rows: enabled, or disabled with its reason", () => {
    expect(matchActions([row(), imp()], acct, fmt).match).toEqual({ enabled: true, reason: null });
    expect(matchActions([row(), row()], acct, fmt).match).toEqual({
      enabled: false,
      reason: MATCH_TEXT.needOneOfEach,
    });
  });
  it("Unmatch for one matched row only", () => {
    expect(matchActions([matched()], acct, fmt).unmatch).toEqual({ enabled: true, reason: null });
    expect(matchActions([row()], acct, fmt)).toEqual({ match: null, unmatch: null });
    expect(matchActions([matched()], () => ({ closed: true }), fmt).unmatch?.enabled).toBe(false);
  });
});

describe("matchLabel and matchRole", () => {
  it("names a row without a payee, and never by id", () => {
    expect(matchLabel({ payee_name: null, date: "2026-03-12", amount: -12340 }, fmt)).toBe(
      "The transaction on 03/12/2026 (−$12.34)",
    );
  });
  it("tells the roles apart", () => {
    expect(matchRole(row())).toBe("entry");
    expect(matchRole(imp())).toBe("import");
    expect(matchRole(matched())).toBe("matched");
  });
});
