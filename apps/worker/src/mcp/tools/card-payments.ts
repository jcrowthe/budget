import { IsoDate } from "@budget/schema/common/dates";
import { Milliunits } from "@budget/schema/common/money";
import { z } from "zod";
import { payCreditCard } from "../../services/card-payments";
import { dates, Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "pay_credit_card",
    description: `Pay a credit card or line of credit from an on-plan cash account (checking, savings or cash): creates the transfer pair in one step, cash -amount and card +amount, which counts against the card's payment category. Without amount it pays the Available of the card's payment category in the date's month, and it is a tool error (nothing_to_pay) when that is zero or below; send an amount then. Paying from another card or from a tracking account is a tool error (invalid_payment_source), and so is a closed account (account_closed) or an account that is not a card (not_a_credit_account). ${MONEY} The default date is today (UTC). Returns { amount, from_transaction, to_transaction }, each as get_transaction returns it. ${dates("date")} ${timestamps(["updated_at", "created_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      card_account_id: Id,
      from_account_id: Id,
      amount: Milliunits.positive().optional(),
      date: IsoDate.optional(),
      memo: z.string().max(500).optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        card_account_id: string;
        from_account_id: string;
        amount?: number;
        date?: string;
        memo?: string;
      },
      { env, actor },
    ) => {
      const { budget_id, card_account_id, ...rest } = input;
      return payCreditCard(env, actor, budget_id, card_account_id, rest);
    },
  },
];
