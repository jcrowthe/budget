import {
  AccountViewSettingsUpdate,
  AllAccountsViewSettingsUpdate,
} from "@budget/schema/view-settings";
import { z } from "@hono/zod-openapi";
import {
  getAccountViewSettings,
  getAllAccountsViewSettings,
  updateAccountViewSettings,
  updateAllAccountsViewSettings,
} from "../../services/view-settings";
import { Id, MONTH } from "../tool-text";
import type { McpToolDef } from "../types";

const FIELDS =
  "preset (this_month, last_month, latest_3_months, this_year, last_year, all_dates or custom), range_from and range_to (months, set only with custom), show_reconciled, show_flags, show_images";
const RULES = `A partial update: a preset other than custom clears the range, range_from and range_to without a preset mean custom (both are needed), and a preset other than custom together with a range is refused. ${MONTH} These settings only change what the register page shows, never the transactions or the balances.`;

export const tools: McpToolDef[] = [
  {
    name: "get_account_view_settings",
    description: `The register view settings of one account (closed accounts too): ${FIELDS}, show_running_balance (a BALANCE column on the account's register). Defaults when nothing was saved: all_dates, show_reconciled false, show_running_balance false, show_flags true, show_images true. ${MONTH} Returns { view_settings: { account_id, preset, range_from, range_to, show_reconciled, show_running_balance, show_flags, show_images } }.`,
    inputSchema: z.object({ budget_id: Id, account_id: Id }),
    run: async (input: { budget_id: string; account_id: string }, { env }) => ({
      view_settings: await getAccountViewSettings(env, input.budget_id, input.account_id),
    }),
  },
  {
    name: "update_account_view_settings",
    description: `Change the register view settings of one account: ${FIELDS}, show_running_balance. ${RULES} Returns { view_settings: { account_id, preset, range_from, range_to, show_reconciled, show_running_balance, show_flags, show_images } } after the change.`,
    inputSchema: z.object({
      budget_id: Id,
      account_id: Id,
      ...AccountViewSettingsUpdate.shape,
    }),
    run: async (
      input: { budget_id: string; account_id: string } & Record<string, unknown>,
      { env, actor },
    ) => {
      const { budget_id, account_id, ...patch } = input;
      return {
        view_settings: await updateAccountViewSettings(env, actor, budget_id, account_id, patch),
      };
    },
  },
  {
    name: "get_all_accounts_view_settings",
    description: `The register view settings of the All Accounts page (one set for the plan, independent of each account's): ${FIELDS}. It has no running balance. ${MONTH} Returns { view_settings: { preset, range_from, range_to, show_reconciled, show_flags, show_images } }.`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      view_settings: await getAllAccountsViewSettings(env, input.budget_id),
    }),
  },
  {
    name: "update_all_accounts_view_settings",
    description: `Change the register view settings of the All Accounts page: ${FIELDS}. It has no running balance. ${RULES} Returns { view_settings: { preset, range_from, range_to, show_reconciled, show_flags, show_images } } after the change.`,
    inputSchema: z.object({ budget_id: Id, ...AllAccountsViewSettingsUpdate.shape }),
    run: async (input: { budget_id: string } & Record<string, unknown>, { env, actor }) => {
      const { budget_id, ...patch } = input;
      return { view_settings: await updateAllAccountsViewSettings(env, actor, budget_id, patch) };
    },
  },
];
