import type { MonthDetail } from "@budget/schema/months";
import { describe, expect, it } from "vitest";
import { type DragItem, keyboardMove } from "./dnd";

type Groups = MonthDetail["groups"];
const cat = (id: string, o: object = {}) => ({
  id,
  name: `ZZ-TEST ${id}`,
  kind: null,
  hidden: false,
  ...o,
});
const grp = (id: string, categories: object[], o: object = {}) =>
  ({
    id,
    name: `ZZ-TEST ${id}`,
    kind: null,
    hidden: false,
    categories,
    ...o,
  }) as unknown as Groups[number];
const groups = [
  grp("pay", [cat("p1", { kind: "credit_card_payment" })], { kind: "credit_card_payments" }),
  grp("g1", [cat("a"), cat("b")]),
  grp("g2", [cat("c")], { hidden: true }),
  grp("g3", [cat("d"), cat("e", { hidden: true })]),
  grp("g4", []),
] as Groups;
const it_ = (id: string, groupId: string, payment = false): DragItem => ({
  kind: "category",
  id,
  groupId,
  payment,
});

describe("keyboardMove across a group edge", () => {
  it("down from the last: start of the next visible group, skipping a hidden one", () => {
    expect(keyboardMove(it_("b", "g1"), groups, 1)?.body).toEqual({
      group_id: "g3",
      before_category_id: "d",
    });
  });
  it("up from the first: end of the previous visible group", () => {
    expect(keyboardMove(it_("d", "g3"), groups, -1)?.body).toEqual({
      group_id: "g1",
      after_category_id: "b",
    });
  });
  it("an empty group takes it with no anchor", () => {
    expect(keyboardMove(it_("d", "g3"), groups, 1)?.body).toEqual({ group_id: "g4" });
  });
  it("names the new group", () => {
    expect(keyboardMove(it_("b", "g1"), groups, 1)?.text).toContain("ZZ-TEST g3");
  });
  it("never moves into the Credit Card Payments group, or past the last group", () => {
    expect(keyboardMove(it_("a", "g1"), groups, -1)).toBeNull();
    expect(keyboardMove(it_("x", "g4"), groups, 1)).toBeNull();
  });
  it("a payment category stays in its group", () => {
    expect(keyboardMove(it_("p1", "pay", true), groups, 1)).toBeNull();
    expect(keyboardMove(it_("p1", "pay", true), groups, -1)).toBeNull();
  });
});
