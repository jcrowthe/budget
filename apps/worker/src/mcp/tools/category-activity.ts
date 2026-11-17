import { Month } from "@budget/schema/common/dates";
import { z } from "zod";
import { listCategoryActivity, PaymentCategoryRefused } from "../../services/category-activity";
import { dates, Id, MONEY, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

export const tools: McpToolDef[] = [
  {
    name: "list_category_transactions",
    description: `List the transactions behind one category's Activity for one month: exactly the rows the plan counts, so activity equals get_month_category's activity for that category and month. Newest first, at most 500 rows; total_count and activity cover all the rows, so a total_count above the list's length means rows are not shown. Split lines are listed (subtransaction_id is set, id is the parent transaction's id); deleted rows, scheduled transactions and transfers between on-plan accounts are not. A credit card payment category is a tool error "payment_category". ${MONEY} ${MONTH} ${dates("date")} Returns { category_id, month, activity, total_count, transactions: [{ id, subtransaction_id, account_id, account_name, date, payee_name, memo, amount }] }.`,
    inputSchema: z.object({ budget_id: Id, category_id: Id, month: Month }),
    run: async (input: { budget_id: string; category_id: string; month: string }, { env }) => {
      try {
        return await listCategoryActivity(env, input.budget_id, input.month, input.category_id);
      } catch (e) {
        if (e instanceof PaymentCategoryRefused) throw new Error(`payment_category: ${e.message}`);
        throw e;
      }
    },
  },
];
