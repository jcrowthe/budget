import { describe, expect, it } from "vitest";
import {
  barActions,
  bulkRefusalText,
  clearOp,
  countLabel,
  DELETE_TEXT,
  deleteConfirm,
  rangeIds,
  type SelAccount,
  type SelRow,
  selectedTotal,
  takesCategory,
} from "../src/register-selection";

const checking: SelAccount = { id: "c", type: "checking", on_budget: true, closed: false };
const savings: SelAccount = { id: "s", type: "savings", on_budget: true, closed: false };
const asset: SelAccount = { id: "t", type: "otherAsset", on_budget: false, closed: false };
const card: SelAccount = { id: "k", type: "creditCard", on_budget: true, closed: false };
const accts: Record<string, SelAccount> = { c: checking, s: savings, t: asset, k: card };
const accountOf = (id: string) => accts[id] ?? null;

let n = 0;
const row = (over: Partial<SelRow> = {}): SelRow => ({
  id: `r${++n}`,
  account_id: "c",
  amount: -1000,
  cleared: "uncleared",
  approved: true,
  import_id: null,
  source: null,
  transfer_account_id: null,
  transfer_transaction_id: null,
  subtransactions: [],
  payee_system: null,
  flag_color: null,
  category_id: null,
  inflow_to_ready_to_assign: false,
  ...over,
});

describe("selectedTotal and countLabel", () => {
  it("is the signed sum: +250.00 and -4.50 is 245.50", () => {
    expect(selectedTotal([row({ amount: 250000 }), row({ amount: -4500 })])).toEqual({
      count: 2,
      total: 245500,
    });
    expect(selectedTotal([])).toEqual({ count: 0, total: 0 });
  });
  it("names one and many", () => {
    expect(countLabel(1)).toBe("1 Transaction");
    expect(countLabel(2)).toBe("2 Transactions");
  });
});

describe("takesCategory", () => {
  it("is false for reconciled, split, tracking, on-plan transfer and credit Starting Balance rows", () => {
    expect(takesCategory(row(), checking, null)).toBe(true);
    expect(takesCategory(row({ cleared: "reconciled" }), checking, null)).toBe(false);
    expect(
      takesCategory(row({ subtransactions: [{} as never, {} as never] }), checking, null),
    ).toBe(false);
    expect(takesCategory(row({ account_id: "t" }), asset, null)).toBe(false);
    expect(takesCategory(row({ transfer_account_id: "s" }), checking, savings)).toBe(false);
    expect(takesCategory(row({ transfer_account_id: "t" }), checking, asset)).toBe(true);
    expect(takesCategory(row({ payee_system: "starting_balance" }), card, null)).toBe(false);
  });
});

describe("clearOp", () => {
  it("clears when any live row is uncleared, unclears when all are cleared, else nothing", () => {
    expect(clearOp([row(), row({ cleared: "cleared" })])).toBe("clear");
    expect(clearOp([row({ cleared: "cleared" }), row({ cleared: "cleared" })])).toBe("unclear");
    expect(clearOp([row({ cleared: "cleared" }), row({ cleared: "reconciled" })])).toBe("unclear");
    expect(clearOp([row({ cleared: "reconciled" })])).toBeNull();
    expect(clearOp([])).toBeNull();
  });
});

describe("barActions", () => {
  const imp = (over: Partial<SelRow> = {}) =>
    row({ approved: false, import_id: "i", source: "plaid", ...over });
  it("approve needs an unapproved row; reject needs every row an unapproved non-transfer import", () => {
    expect(barActions([row()], accountOf)).toMatchObject({ approve: false, reject: false });
    expect(barActions([imp()], accountOf)).toMatchObject({ approve: true, reject: true });
    expect(barActions([imp(), row()], accountOf)).toMatchObject({
      approve: true,
      reject: false,
    });
    expect(barActions([imp({ transfer_account_id: "s" })], accountOf).reject).toBe(false);
    expect(barActions([row({ approved: false })], accountOf).reject).toBe(false);
  });
  it("categorize needs a row that takes a category; Make Repeating is one row; move is one account's register", () => {
    const tr = row({ transfer_account_id: "s" });
    expect(barActions([tr], accountOf).categorize).toBe(false);
    expect(barActions([tr, row()], accountOf).categorize).toBe(true);
    expect(barActions([row()], accountOf).makeRepeating).toBe(true);
    expect(barActions([row(), row()], accountOf).makeRepeating).toBe(false);
    // EXF-636: Move to Account is offered on All Accounts too.
    expect(barActions([row()], accountOf).move).toBe(true);
    expect(barActions([row()], accountOf).move).toBe(true);
    expect(barActions([row({ flag_color: "red" })], accountOf).anyFlagged).toBe(true);
  });
});

describe("deleteConfirm", () => {
  const none = () => false;
  it("asks nothing for plain rows, and for one transfer", () => {
    expect(deleteConfirm([row(), row()], none)).toBeNull();
    expect(deleteConfirm([row({ transfer_account_id: "s" })], none)).toBeNull();
  });
  it("one reconciled row", () => {
    expect(deleteConfirm([row({ cleared: "reconciled" })], none)).toEqual({
      title: "Delete Reconciled Transaction?",
      paragraphs: [
        "Deleting a reconciled transaction will bring the reconciliation out of balance.",
      ],
    });
  });
  it("several rows with a transfer, a reconciled row, or a reconciled other side", () => {
    const tr = row({ transfer_account_id: "s" });
    expect(deleteConfirm([tr, row()], none)).toEqual({
      title: "Delete 2 Transactions?",
      paragraphs: [DELETE_TEXT.transferBody],
    });
    expect(deleteConfirm([row({ cleared: "reconciled" }), row()], none)?.paragraphs).toEqual([
      DELETE_TEXT.reconciledBody,
    ]);
    expect(deleteConfirm([tr, row()], (r) => r.id === tr.id)?.paragraphs).toEqual([
      DELETE_TEXT.transferBody,
      DELETE_TEXT.matchingBody,
    ]);
    expect(deleteConfirm([row(), row()], none, true)?.paragraphs).toEqual([
      DELETE_TEXT.matchingBody,
    ]);
  });
  it("uses the ticket's words", () => {
    expect(DELETE_TEXT.transferBody).toBe(
      "Deleting a transfer transaction will delete the transfer in both accounts.",
    );
    expect(DELETE_TEXT.matchingBody).toBe(
      "Some matching transfers in other accounts have been reconciled. Deleting these transactions could bring those account's reconciliations out of balance.",
    );
  });
});

describe("bulkRefusalText", () => {
  const id = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
  it("swaps the id for the row's label and capitalises the reason", () => {
    expect(
      bulkRefusalText(`Transaction ${id}: it is reconciled`, () => "Fee on 11/10/2026 (-$45.00)"),
    ).toBe("Fee on 11/10/2026 (-$45.00): It is reconciled");
  });
  it("names an unknown id as one of the selected transactions", () => {
    expect(bulkRefusalText(`Transaction ${id}: nope`, () => null)).toBe(
      "1 of the selected transactions: Nope",
    );
  });
  it("leaves a detail without the prefix alone", () => {
    expect(bulkRefusalText("Something else", () => "x")).toBe("Something else");
  });
});

describe("rangeIds", () => {
  const order = ["a", "b", "c", "d", "e"];
  it("is inclusive and in display order either way round", () => {
    expect(rangeIds(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeIds(order, "c", "c")).toEqual(["c"]);
  });
  it("is null when an end is not in the list", () => {
    expect(rangeIds(order, "a", "z")).toBeNull();
    expect(rangeIds(order, "z", "a")).toBeNull();
  });
});
