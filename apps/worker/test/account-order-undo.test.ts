import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { A, account, data, plan, send } from "./account-helpers";
import { setOf, undo } from "./undo-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed response bodies in tests
type Json = any;

const put = (bid: string, ids: string[]) => send(`${A(bid)}/order`, "PUT", { account_ids: ids });
const cash = async (bid: string) =>
  ((await data(await send(A(bid), "GET"))).accounts as Json[]).map((a) => a.id as string);
const sorts = async (bid: string, ids: string[]) =>
  Promise.all(
    ids.map(
      async (id) =>
        (
          await env.DB.prepare("select sort_order as s from accounts where id = ?")
            .bind(id)
            .first<{ s: number }>()
        )?.s,
    ),
  );

describe("undo of an account reorder", () => {
  it("restores the order and the original sort values", async () => {
    const bid = await plan();
    const [a, b, c] = [await account(bid), await account(bid), await account(bid)].map(
      (x) => x.id as string,
    ) as [string, string, string];
    const orig = await sorts(bid, [a, b, c]);
    const res = await put(bid, [c, a, b]);
    expect(res.status).toBe(200);
    expect(await cash(bid)).toEqual([c, a, b]);
    const u = await undo(bid, setOf(res));
    expect(u.status).toBe(200);
    expect(await cash(bid)).toEqual([a, b, c]);
    expect(await sorts(bid, [a, b, c])).toEqual(orig);
  });

  it("is stale once another reorder touched the rows", async () => {
    const bid = await plan();
    const [a, b, c] = [await account(bid), await account(bid), await account(bid)].map(
      (x) => x.id as string,
    ) as [string, string, string];
    const first = await put(bid, [c, a, b]);
    await put(bid, [b, c, a]);
    const u = await undo(bid, setOf(first));
    expect(u.status).toBe(409);
    expect(u.body.error.name).toBe("undo_stale");
  });
});
