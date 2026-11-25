import { describe, expect, it } from "vitest";
import { planAccountOrder } from "../src/services/account-order";

const row = (id: string, sortOrder: number, type = "checking") =>
  ({ id, type, closed: false, sortOrder }) as Parameters<typeof planAccountOrder>[0][number];
const written = (p: NonNullable<ReturnType<typeof planAccountOrder>>) =>
  Object.fromEntries(p.entries.filter((e) => e.w === 1).map((e) => [e.i, e.n]));

describe("planAccountOrder", () => {
  const rows = [row("a", 0), row("x", 1, "creditCard"), row("b", 2), row("c", 3)];

  it("permutes the listed accounts' own sort values", () => {
    const p = planAccountOrder(rows, ["c", "a", "b"]);
    expect(p?.renumber).toBe(false);
    expect(written(p as NonNullable<typeof p>)).toEqual({ c: 0, a: 2, b: 3 });
  });

  it("a subset takes only its own slots", () => {
    const p = planAccountOrder(rows, ["c", "a"]);
    expect(written(p as NonNullable<typeof p>)).toEqual({ c: 0, a: 3 });
  });

  it("is null when the order does not change", () => {
    expect(planAccountOrder(rows, ["a", "b", "c"])).toBeNull();
    expect(planAccountOrder(rows, ["b"])).toBeNull();
  });

  it("renumbers the plan when two accounts share a value", () => {
    const tied = [row("a", 5), row("b", 5), row("x", 9, "creditCard"), row("c", 7)];
    const p = planAccountOrder(tied, ["c", "b", "a"]);
    expect(p?.renumber).toBe(true);
    // new display order c, b, x, a -> 0..3
    expect(written(p as NonNullable<typeof p>)).toEqual({ c: 0, b: 1, x: 2, a: 3 });
  });

  it("renumbers when a slot equals an unlisted account's value", () => {
    const clash = [row("a", 1), row("x", 1, "creditCard"), row("b", 4)];
    const p = planAccountOrder(clash, ["b", "a"]);
    expect(p?.renumber).toBe(true);
  });
});
