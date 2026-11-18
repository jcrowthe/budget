import { expect } from "vitest";
import { account, DAY, data, plan, send } from "./account-helpers";

// biome-ignore lint/suspicious/noExplicitAny: parsed responses
export type Json = any;

export const P = (bid: string) => `/api/v1/budgets/${bid}/payees`;

/** A plan with one account, and helpers that put transactions and scheduled transactions on payees by name. */
export async function payeeWorld() {
  const bid = await plan();
  expect((await send(`/api/v1/budgets/${bid}`, "PATCH", { opened: true })).status).toBe(200);
  const acct = (await account(bid, "checking", 100000, "ZZ Checking")).id as string;
  const tx = async (payee_name: string | null, over: Json = {}) =>
    (
      await data(
        await send(`/api/v1/budgets/${bid}/transactions`, "POST", {
          account_id: acct,
          date: DAY,
          amount: -1000,
          ...(payee_name === null ? {} : { payee_name }),
          ...over,
        }),
      )
    ).transaction as Json;
  const sched = async (payee_name: string) =>
    (
      await data(
        await send(`/api/v1/budgets/${bid}/scheduled-transactions`, "POST", {
          account_id: acct,
          date_first: "2099-01-15",
          frequency: "monthly",
          amount: -4000,
          payee_name,
        }),
      )
    ).scheduled_transaction as Json;
  const list = async () =>
    (await data(await send(`${P(bid)}?include_hidden=true`, "GET"))).payees as Json[];
  const id = async (name: string) => (await list()).find((p) => p.name === name)?.id as string;
  return { bid, acct, tx, sched, list, id };
}
