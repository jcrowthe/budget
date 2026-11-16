import { describe, expect, it } from "vitest";
import { type Payee, payeeMenu } from "../src/payees";

const p = (name: string, over: Partial<Payee> = {}): Payee => ({
  id: `id-${name}`,
  name,
  hidden: false,
  system: null,
  last_category_id: null,
  last_inflow_to_ready_to_assign: false,
  transfer_account_id: null,
  ...over,
});

describe("payeeMenu", () => {
  it("shows the hint for an empty plan", () => {
    const m = payeeMenu([], "");
    expect(m.hint).toBe("Start typing to add a payee.");
    expect(m.top).toBeNull();
    expect(m.saved).toEqual([]);
    expect(m.active).toBe(-1);
  });
  it("lists visible payees alphabetically, case-insensitive", () => {
    const m = payeeMenu([p("beta"), p("Alpha"), p("charlie")], "");
    expect(m.saved.map((x) => x.name)).toEqual(["Alpha", "beta", "charlie"]);
    expect(m.hint).toBeNull();
  });
  it("never lists system payees", () => {
    const sys = p("Starting Balance", { system: "starting_balance" });
    const m = payeeMenu([sys, p("Other")], "Start");
    expect(m.saved).toEqual([]);
    expect(m.top).toEqual({ kind: "create", text: "Start" });
    expect(payeeMenu([sys], "").saved).toEqual([]);
  });
  it("offers a hidden payee only for its exact name", () => {
    const h = p("ZZ Hidden", { hidden: true });
    const exact = payeeMenu([h], "ZZ Hidden");
    expect(exact.top).toMatchObject({ kind: "hidden", label: "1 matching payee is hidden" });
    expect(payeeMenu([h], "ZZ Hid").top).toEqual({ kind: "create", text: "ZZ Hid" });
    expect(payeeMenu([h], "ZZ Hid").saved).toEqual([]);
  });
  it("counts several hidden matches", () => {
    const m = payeeMenu(
      [p("A", { hidden: true, id: "1" }), p("A", { hidden: true, id: "2" })],
      "A",
    );
    expect(m.top).toMatchObject({ label: "2 matching payees are hidden" });
  });
  it("shows the help line only without matches, and highlights the first match", () => {
    expect(payeeMenu([p("Alpha")], "zz").help).toBe('"zz" will be created as a payee.');
    const m = payeeMenu([p("D4 Corner Market"), p("Other")], "d4 cor");
    expect(m.help).toBeNull();
    expect(m.saved.map((x) => x.name)).toEqual(["D4 Corner Market"]);
    expect(m.active).toBe(1);
    expect(payeeMenu([], "x").active).toBe(0);
  });
});

describe("payeeMenu transfers", () => {
  const t = (name: string, account: string) =>
    p(`Transfer : ${name}`, { id: `transfer:${account}`, transfer_account_id: account });
  const list = [t("Savings", "a2"), t("Checking", "a1"), t("Brokerage", "a3"), p("Market")];

  it("lists every transfer but the current account's, never among saved payees", () => {
    const m = payeeMenu(list, "", { currentAccountId: "a1" });
    expect(m.transfers.map((x) => x.name)).toEqual(["Transfer : Brokerage", "Transfer : Savings"]);
    expect(m.saved.map((x) => x.name)).toEqual(["Market"]);
    expect(m.transfersHeading).toBe("Payments and Transfers");
  });
  it("filters by the account name or the word transfer, and highlights the first transfer", () => {
    expect(payeeMenu(list, "transfer", { currentAccountId: "a1" }).transfers).toHaveLength(2);
    const m = payeeMenu(list, "sav", { currentAccountId: "a1" });
    expect(m.transfers.map((x) => x.name)).toEqual(["Transfer : Savings"]);
    expect(m.active).toBe(1);
    expect(payeeMenu(list, "to/from sav", { currentAccountId: "a1" }).transfers).toHaveLength(1);
  });
  it("highlights the first saved match ahead of a transfer", () => {
    const m = payeeMenu([...list, p("Transferware")], "transfer", { currentAccountId: "a1" });
    expect(m.active).toBe(1 + m.transfers.length);
  });
  it("hides the section when transfers are off", () => {
    expect(payeeMenu(list, "", { transfers: false }).transfers).toEqual([]);
  });
});
