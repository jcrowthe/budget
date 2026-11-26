import { LoanNewCategory } from "@budget/schema/accounts";
import { z } from "zod";
import { pairLoanCategory } from "../../services/loan-pairing";
import { Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

type Input = {
  budget_id: string;
  loan_account_id: string;
  category_id?: string | null;
  new_category?: z.input<typeof LoanNewCategory>;
};

export const tools: McpToolDef[] = [
  {
    name: "pair_loan_category",
    description: `Pair a loan account with a plan category, create a new category to pair it with, or unpair it. Send exactly one of: category_id (an existing category, to pair or re-pair: it must be active, visible and not a payment category, in a visible group), category_id null (unpair: paired_category_id becomes null; the category stays in the plan with its money and target; an already unpaired loan is returned unchanged), or new_category { name, and group_id (an existing visible group) or new_group_name (a new group created with it) }, which creates the category (and group) and pairs the loan with it in one change. Record payments then categorize to the category and the loan's page shows its Available and target. Returns { account } as get_account does (paired_category_id carries the new id). A non-loan account is a tool error (not_a_loan_account), and so is a closed loan (account_closed), a category or group that cannot be used, a taken category or group name, and sending both or neither of category_id and new_category. ${MONEY} The change is logged and can be undone from the plan's history.`,
    inputSchema: z.object({
      budget_id: Id,
      loan_account_id: Id,
      category_id: Id.nullable().optional(),
      new_category: LoanNewCategory.optional(),
    }),
    run: async (input: Input, { env, actor }) => {
      const { budget_id, loan_account_id, ...rest } = input;
      return {
        account: await pairLoanCategory(env, actor, budget_id, loan_account_id, rest),
      };
    },
  },
];
