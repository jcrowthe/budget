import { AccountCreateRequest } from "@budget/schema/accounts";
import { z } from "zod";
import { addUnlinkedAccount, listAccounts } from "../../services/accounts";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_accounts",
    description:
      "List a plan's accounts in display order. Each has cleared_balance, uncleared_balance and balance in milliunits (1000 = one currency unit); debts are negative.",
    inputSchema: z.object({ budget_id: z.string().min(1), include_closed: z.boolean().optional() }),
    run: async (input: { budget_id: string; include_closed?: boolean }, { env }) => ({
      accounts: await listAccounts(env, input.budget_id, { includeClosed: input.include_closed }),
    }),
  },
  {
    name: "create_account",
    description:
      "Add an unlinked account with a Starting Balance transaction. balance is integer milliunits entered as shown: for credit cards, lines of credit and liabilities a positive number means money owed and is stored negative. Loan types are not supported yet. date (YYYY-MM-DD) defaults to today (UTC).",
    inputSchema: z.object({ budget_id: z.string().min(1), ...AccountCreateRequest.shape }),
    run: async (
      input: { budget_id: string } & z.input<typeof AccountCreateRequest>,
      { env, actor },
    ) => {
      const { budget_id, ...rest } = input;
      return addUnlinkedAccount(env, actor, budget_id, rest);
    },
  },
];
