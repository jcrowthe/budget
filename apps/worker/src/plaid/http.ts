import type { Context } from "hono";
import { PlaidApiError } from "./client";
import { PlaidNotSetUp } from "./credentials";

/** Maps Plaid failures to the API envelope; null means "not a Plaid error, rethrow". */
export function plaidErrorResponse(c: Context, err: unknown): Response | null {
  if (err instanceof PlaidNotSetUp) {
    return c.json(
      {
        error: {
          id: "422",
          name: "bank_connections_not_set_up",
          detail: "Bank connections are not set up",
        },
      },
      422,
    );
  }
  if (err instanceof PlaidApiError) {
    return c.json(
      {
        error: {
          id: "502",
          name: "plaid_error",
          detail: err.displayMessage ?? "Something went wrong. Try again.",
        },
      },
      502,
    );
  }
  return null;
}

/** For route catch blocks: answers a Plaid error, rethrows anything else. Typed `never` for the handler. */
export function plaidFail(c: Context, err: unknown): never {
  const res = plaidErrorResponse(c, err);
  if (res) return res as never;
  throw err;
}
