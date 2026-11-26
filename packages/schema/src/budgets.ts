import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { currencyFormatOf, DATE_FORMAT_OPTIONS } from "./plan-formats-catalogue";
import { DEFAULT_FLAG_NAMES } from "./transactions";

export const BankEnvironment = z.enum(["production", "sandbox"]).openapi("BankEnvironment", {
  description:
    "Which Plaid environment the plan's bank connections use. production (default) or sandbox (Plaid test banks).",
});

export const CurrencyFormat = z
  .object({
    iso_code: z.string().openapi({ description: "ISO currency code, e.g. USD" }),
    example_format: z.string().openapi({
      description:
        "The number format, e.g. 123,456.78: the character before the last decimal digits is the decimal separator",
    }),
    decimal_digits: z.number().int(),
    decimal_separator: z.string(),
    group_separator: z.string(),
    symbol_first: z.boolean(),
    currency_symbol: z.string(),
    display_symbol: z.boolean().openapi({ description: "false is Currency Placement Don't show" }),
  })
  .openapi("CurrencyFormat");

export const DateFormatObject = z
  .object({ format: z.enum(DATE_FORMAT_OPTIONS) })
  .openapi("DateFormatObject");

export const DEFAULT_CURRENCY_FORMAT = currencyFormatOf("USD", "123,456.78", "before");

export const CurrencyFormatInput = z
  .object({
    iso_code: z.string().optional().openapi({
      description:
        "A currency code of the Plan Settings list (see get_budget for the plan's own). Unknown: 422 unknown_currency.",
    }),
    example_format: z.string().optional().openapi({
      description:
        "A number format offered for the currency's decimal digits. 2 digits: 123,456.78, 123.456,78, 123 456.78, 123'456.78, 123 456-78, 123 456,78, 123,456/78, 1,23,456.78. 3 digits: 123,456.789. 0 digits: 123.456, 123,456, 123 456. Otherwise 422 number_format_not_offered. A changed currency without it takes the currency's default.",
    }),
    symbol_placement: z.enum(["before", "after", "none"]).optional().openapi({
      description:
        "before, after or none (Don't show). A changed currency without it takes the currency's default.",
    }),
  })
  .openapi("CurrencyFormatInput");

export const DateFormatInput = z
  .object({
    format: z.string().openapi({
      description: `One of ${DATE_FORMAT_OPTIONS.join(", ")}; otherwise 422 unknown_date_format. A currency change never changes it.`,
    }),
  })
  .openapi("DateFormatInput");

const flagNameKeys = {
  red: z.string().nullable(),
  orange: z.string().nullable(),
  yellow: z.string().nullable(),
  green: z.string().nullable(),
  blue: z.string().nullable(),
  purple: z.string().nullable(),
};
export const FlagNames = z.object(flagNameKeys).openapi("FlagNames", {
  description:
    "A custom name for each flag colour of the plan; null = the colour's own name (Red, Orange, ...).",
});

export const Budget = z
  .object({
    id: z.uuid(),
    name: z.string(),
    created_at: z.string(),
    last_modified_on: z.string(),
    last_opened_at: z.string().nullable().openapi({
      description: "ISO 8601 time the plan was last opened in the app; null if never",
    }),
    bank_environment: BankEnvironment,
    currency_format: CurrencyFormat.default(DEFAULT_CURRENCY_FORMAT),
    date_format: DateFormatObject.default({ format: "MM/DD/YYYY" }),
    expected_income: Milliunits.nullable().default(null).openapi({
      description:
        "Monthly income the owner expects, in milliunits; null when not set. Compared with the month's targets on the Plan's Cost to Be Me",
    }),
    flag_names: FlagNames.default(DEFAULT_FLAG_NAMES),
  })
  .openapi("Budget");

export const BudgetCreate = z
  .object({
    name: z.string().trim().min(1).max(100),
    bank_environment: BankEnvironment.optional(),
    currency_format: CurrencyFormatInput.optional(),
    date_format: DateFormatInput.optional(),
  })
  .openapi("BudgetCreate");
export const BudgetUpdate = BudgetCreate.partial()
  .extend({
    opened: z.literal(true).optional().openapi({
      description:
        "Set to true to record that the plan was opened (stamps last_opened_at = now). Not a change: no history entry.",
    }),
    expected_income: Milliunits.nullable().optional().openapi({
      description: "0 or null clears it; a negative is 422 negative_expected_income",
    }),
    flag_names: z
      .object({
        red: z.string().nullable().optional(),
        orange: z.string().nullable().optional(),
        yellow: z.string().nullable().optional(),
        green: z.string().nullable().optional(),
        blue: z.string().nullable().optional(),
        purple: z.string().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional()
      .openapi({
        description:
          "Merges into the plan's flag names: a present colour sets that name (trimmed, at most 50 characters, else 422 flag_name_too_long); null, an empty or a blank string clears it to the colour's own name; a missing colour is unchanged; flag_names null resets all six. An unknown colour is refused.",
      }),
  })
  .openapi("BudgetUpdate");

export const BudgetResponse = dataEnvelope(z.object({ budget: Budget })).openapi("BudgetResponse");
export const BudgetListResponse = dataEnvelope(z.object({ budgets: z.array(Budget) })).openapi(
  "BudgetListResponse",
);

export type BankEnvironment = z.infer<typeof BankEnvironment>;
export type Budget = z.infer<typeof Budget>;
export type BudgetCreate = z.infer<typeof BudgetCreate>;
export type BudgetUpdate = z.infer<typeof BudgetUpdate>;
