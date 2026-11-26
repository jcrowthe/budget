import { describe, expect, it } from "vitest";
import { dropOrder, keyboardOrder } from "./viewsDnd";

const order = ["a", "b", "c", "d"];

describe("dropOrder", () => {
  it("drops before a target in its top half, after it in its bottom half", () => {
    expect(dropOrder(order, "d", "b", true)).toEqual(["a", "d", "b", "c"]);
    expect(dropOrder(order, "a", "c", false)).toEqual(["b", "c", "a", "d"]);
  });
  it("is null on itself or when the order would not change", () => {
    expect(dropOrder(order, "b", "b", true)).toBeNull();
    expect(dropOrder(order, "b", "c", true)).toBeNull();
    expect(dropOrder(order, "c", "b", false)).toBeNull();
  });
  it("is null for an id that is not in the list", () => {
    expect(dropOrder(order, "x", "b", true)).toBeNull();
    expect(dropOrder(order, "a", "x", true)).toBeNull();
  });
});

describe("keyboardOrder", () => {
  it("moves one place and says where", () => {
    expect(keyboardOrder(order, "b", -1, (id) => id)).toEqual({
      ids: ["b", "a", "c", "d"],
      text: "Moved b to position 1 of 4.",
    });
    expect(keyboardOrder(order, "b", 1, (id) => id.toUpperCase())?.text).toBe(
      "Moved B to position 3 of 4.",
    );
  });
  it("is null at either end", () => {
    expect(keyboardOrder(order, "a", -1, (id) => id)).toBeNull();
    expect(keyboardOrder(order, "d", 1, (id) => id)).toBeNull();
  });
});
