import { BudgetCreate, BudgetUpdate } from "@budget/schema/budgets";
import { DATE_FORMAT_OPTIONS } from "@budget/schema/plan-formats-catalogue";
import { z } from "zod";
import {
  createBudget,
  deleteBudget,
  getBudget,
  listBudgets,
  setExpectedIncome,
  setFlagNames,
  updateBudget,
} from "../../services/budgets";
import { Id, MONEY, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const FIELDS =
  "currency_format { iso_code, example_format, decimal_digits, decimal_separator, group_separator, symbol_first, currency_symbol, display_symbol } and date_format { format } and expected_income (milliunits, or null when not set) and flag_names { red, orange, yellow, green, blue, purple } (a custom name, or null = the colour name)";
const FORMATS_NOTE =
  "Formats are for screens and export files only: amounts stay integer milliunits (1000 = one currency unit) and dates ISO.";
const FORMAT_RULES = `currency_format: { iso_code (a currency code, e.g. USD, EUR, JPY; read the plan's own with get_budget), example_format (the number format: with 2 decimal digits 123,456.78, 123.456,78, "123 456.78", 123'456.78, "123 456-78", "123 456,78", 123,456/78 or 1,23,456.78; with 3 digits (BHD IQD JOD KWD OMR TND) 123,456.789; with 0 digits (JPY KRW XAF XOF XPF LAK TZS CLP DJF HUF ISK IDR MMR TWD PYG UGX VND) 123.456, 123,456 or "123 456"), symbol_placement (before, after or none = Don't show) }; date_format: { format: one of ${DATE_FORMAT_OPTIONS.join(", ")} }. A changed currency without example_format or symbol_placement takes the currency's defaults; the date format is never changed by a currency change; amounts are never converted. An unknown currency, a number format the currency does not offer or an unknown date format is refused and nothing changes. Formats are for screens and export files only: amounts in every tool stay integer milliunits (1000 = one currency unit) and dates ISO.`;
const formatInput = {
  currency_format: z
    .object({
      iso_code: z.string().optional(),
      example_format: z.string().optional(),
      symbol_placement: z.enum(["before", "after", "none"]).optional(),
    })
    .optional(),
  date_format: z.object({ format: z.enum(DATE_FORMAT_OPTIONS) }).optional(),
};
type FormatInput =
  z.infer<(typeof formatInput)["currency_format"]> extends infer C
    ? { currency_format?: C; date_format?: { format: string } }
    : never;

export const tools: McpToolDef[] = [
  {
    name: "list_budgets",
    description: `List every plan (a plan is a budget). Returns { budgets }: each with id, name, bank_environment, ${FIELDS}, created_at, last_modified_on and last_opened_at (null if never opened in the app). ${FORMATS_NOTE} ${timestamps(["created_at", "last_modified_on", "last_opened_at"], ["last_opened_at"])}`,
    inputSchema: z.object({}),
    run: async (_input, { env }) => ({ budgets: await listBudgets(env) }),
  },
  {
    name: "get_budget",
    description: `Read one plan. Returns { budget } with id, name, bank_environment, ${FIELDS}, created_at, last_modified_on and last_opened_at. An unknown or deleted plan is a tool error (Plan not found). ${FORMATS_NOTE} ${timestamps(["created_at", "last_modified_on", "last_opened_at"], ["last_opened_at"])}`,
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env }) => ({
      budget: await getBudget(env, input.budget_id),
    }),
  },
  {
    name: "create_budget",
    description: `Create a plan (budget). name is 1 to 100 characters. bank_environment is the Plaid environment of the plan's bank connections: production (default, real banks) or sandbox (Plaid test banks). A new plan starts with the default category groups Bills, Needs and Wants and their categories (and US Dollar, 123,456.78, symbol first, MM/DD/YYYY unless given). ${FORMAT_RULES} Returns { budget } with id, name, bank_environment, ${FIELDS}, created_at, last_modified_on and last_opened_at (null). ${timestamps(["created_at", "last_modified_on", "last_opened_at"], ["last_opened_at"])}`,
    inputSchema: z.object({
      name: BudgetCreate.shape.name,
      bank_environment: BudgetCreate.shape.bank_environment,
      ...formatInput,
    }),
    run: async (input: z.infer<typeof BudgetCreate>, { env, actor }) => ({
      budget: await createBudget(env, actor, input),
    }),
  },
  {
    name: "update_budget",
    description: `Rename a plan, change its bank_environment (production or sandbox: the Plaid environment its bank connections use), its currency, number format, currency placement or date format. Send only what changes. ${FORMAT_RULES} Returns { budget } with id, name, bank_environment, ${FIELDS}, created_at, last_modified_on and last_opened_at. ${timestamps(["created_at", "last_modified_on", "last_opened_at"], ["last_opened_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      name: BudgetCreate.shape.name.optional(),
      bank_environment: BudgetCreate.shape.bank_environment,
      ...formatInput,
    }),
    run: async (
      input: {
        budget_id: string;
        name?: string;
        bank_environment?: "production" | "sandbox";
      } & FormatInput,
      { env, actor },
    ) => {
      const { budget_id, ...rest } = input;
      if (
        rest.name === undefined &&
        rest.bank_environment === undefined &&
        rest.currency_format === undefined &&
        rest.date_format === undefined
      ) {
        throw new Error(
          "Nothing to update: give name, bank_environment, currency_format or date_format",
        );
      }
      return { budget: await updateBudget(env, actor, budget_id, rest) };
    },
  },
  {
    name: "set_expected_income",
    description: `Set the plan's expected monthly income: the figure the Plan's Cost to Be Me compares with the month's targets. ${MONEY} expected_income is milliunits; 0 or null clears it; a negative is refused and nothing changes. Returns { budget } with id, name, bank_environment, ${FIELDS}, created_at, last_modified_on and last_opened_at. ${timestamps(["created_at", "last_modified_on", "last_opened_at"], ["last_opened_at"])}`,
    inputSchema: z.object({ budget_id: Id, expected_income: z.number().int().nullable() }),
    run: async (input: { budget_id: string; expected_income: number | null }, { env, actor }) => ({
      budget: await setExpectedIncome(env, actor, input.budget_id, input.expected_income),
    }),
  },
  {
    name: "update_flag_names",
    description: `Name the plan's six flag colours (red, orange, yellow, green, blue, purple). flag_names merges: a given colour is set to its trimmed name (at most 50 characters, else refused); null or a blank string clears that colour to its own name; a colour left out is unchanged; flag_names null resets all six. An unknown colour is refused; nothing changes on a refusal. ${MONEY} Returns { budget } with id, name, bank_environment, ${FIELDS}, created_at, last_modified_on and last_opened_at. ${timestamps(["created_at", "last_modified_on", "last_opened_at"], ["last_opened_at"])}`,
    inputSchema: z.object({ budget_id: Id, flag_names: BudgetUpdate.shape.flag_names.unwrap() }),
    run: async (
      input: { budget_id: string; flag_names: Parameters<typeof setFlagNames>[3] },
      { env, actor },
    ) => ({ budget: await setFlagNames(env, actor, input.budget_id, input.flag_names) }),
  },
  {
    name: "delete_budget",
    description:
      "Delete a plan (soft delete): it leaves the plan list and every later read of it is a tool error (Plan not found). Returns { deleted: true }.",
    inputSchema: z.object({ budget_id: Id }),
    run: async (input: { budget_id: string }, { env, actor }) => {
      await deleteBudget(env, actor, input.budget_id);
      return { deleted: true };
    },
  },
];
