import type { PlaidHandler } from "./plaid-stub";

const ACCOUNTS: Record<string, Record<string, unknown>> = {
  "acc-chk": {
    account_id: "acc-chk",
    name: "ZZ Checking",
    mask: "0000",
    type: "depository",
    subtype: "checking",
    balances: { current: 1250.5, available: null },
  },
  "acc-sav": {
    account_id: "acc-sav",
    name: "ZZ Savings",
    mask: "0000",
    type: "depository",
    subtype: "savings",
    balances: { current: 300, available: null },
  },
  "acc-new": {
    account_id: "acc-new",
    name: "ZZ Rewards",
    mask: "4321",
    type: "credit",
    subtype: "credit card",
    balances: { current: 50, available: null },
  },
};

/** A handler for `/accounts/get` answering with the chosen accounts in Plaid's shape (as `stubBank` does). */
export const listed =
  (...ids: string[]): PlaidHandler =>
  () => ({
    body: {
      item: { institution_id: "ins_109508" },
      accounts: ids.map((id) => ({ ...ACCOUNTS[id] })),
    },
  });

export { ACCOUNTS };
