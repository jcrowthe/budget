import { z } from "zod";
import { pairLoanCategory } from "../../services/loan-pairing";
import { Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "pair_loan_category",
    description: `Pair a loan account with an existing plan category (or re-pair it): the category must be active, visible and not a payment category, in a visible group. Record payments then categorize to it and the loan's page shows its Available and target. Returns { account } as get_account does. A non-loan account is a tool error (not_a_loan_account), and so is a closed loan (account_closed) or a category that cannot be paired. ${MONEY} The change is logged and can be undone from the plan's history.`,
    inputSchema: z.object({ budget_id: Id, loan_account_id: Id, category_id: Id }),
    run: async (
      input: { budget_id: string; loan_account_id: string; category_id: string },
      { env, actor },
    ) => ({
      account: await pairLoanCategory(env, actor, input.budget_id, input.loan_account_id, {
        category_id: input.category_id,
      }),
    }),
  },
];
