import { PlanImportOptions } from "@budget/schema/plan-import";
import { z } from "zod";
import { cancelImport, continueImport, startImport } from "../../services/plan-import";
import { dates, Id, MONEY } from "../tool-text";
import type { McpToolDef } from "../types";

function fromBase64(text: string, name: string): Uint8Array {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new Error(`${name}: content_base64 is not valid base64`);
  }
}

const RESULT =
  "{ import_id, state ('writing' or 'done'), budget_id (null until done), progress { chunks_done, chunk_count }, summary }";
const SUMMARY = `summary is { name, export_date, formats (delimiter, currency_symbol, symbol_placement, decimal_separator, decimal_digits, date_format), accounts (name, type, proposed_type, on_budget, transactions), counts, warnings, mismatches (recomputed Activity or Available that differ from the file) }. ${MONEY} ${dates("export_date", "first_month", "last_month", "date")}`;

const fileInput = z.object({
  file_name: z.string().min(1),
  content_base64: z.string().min(1),
});

export const tools: McpToolDef[] = [
  {
    name: "import_budget_export",
    description: `Create a NEW plan from the ZIP of the source app's Export Plan (or this app's export_budget), or from its two .csv/.tsv files (give both in files). It never changes an existing plan. Reads the Plan file (assigned money per category and month) and the Register file (accounts, transactions, splits, transfers, rows dated after export_date as scheduled transactions); Activity and Available are recomputed and compared, not imported. files holds 1 or 2 { file_name, content_base64 }. Options: name, export_date (YYYY-MM-DD), date_format (MM/DD/YYYY, DD/MM/YYYY, YYYY/MM/DD, YYYY-MM-DD, DD-MM-YYYY, DD.MM.YYYY or YYYY.MM.DD: answer it when the file's dates are unclear), account_types ({ "<account name>": "checking|savings|cash|creditCard|lineOfCredit|otherAsset|otherLiability" }), currency_format. dry_run=true writes nothing and returns the preview { ...summary, date_question }. Otherwise returns ${RESULT}: a small file is done at once (state done, budget_id set); for a large one state is writing and you must call continue_budget_import with the import_id until state is done. ${SUMMARY}`,
    inputSchema: z.object({
      files: z.array(fileInput).min(1).max(2),
      name: PlanImportOptions.shape.name,
      export_date: PlanImportOptions.shape.export_date,
      date_format: PlanImportOptions.shape.date_format,
      account_types: PlanImportOptions.shape.account_types,
      currency_format: PlanImportOptions.shape.currency_format,
      dry_run: z.boolean().optional(),
    }),
    run: async (
      input: {
        files: { file_name: string; content_base64: string }[];
        dry_run?: boolean;
      } & PlanImportOptions,
      { env, actor },
    ) => {
      const { files, dry_run, ...options } = input;
      try {
        const out = await startImport(env, actor, {
          files: files.map((f) => ({
            name: f.file_name,
            bytes: fromBase64(f.content_base64, f.file_name),
          })),
          options,
          dryRun: dry_run === true,
        });
        return out.status === 200 ? out.preview : out.result;
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
  },
  {
    name: "continue_budget_import",
    description: `Write the next step of an import that import_budget_export left in state writing. Returns ${RESULT}: call it again until state is done (budget_id is then the new plan). Repeating a step after a lost answer writes nothing twice; on a finished import it returns the same result. A cancelled, expired or unknown import is a tool error. ${SUMMARY}`,
    inputSchema: z.object({ import_id: Id }),
    run: async (input: { import_id: string }, { env }) =>
      (await continueImport(env, input.import_id)).result,
  },
  {
    name: "cancel_budget_import",
    description:
      "Cancel an import that is still writing and remove everything it wrote (the plan was never visible). Returns { import_id, state: 'abandoned' }. A finished import cannot be cancelled: delete the plan instead. An unknown import is a tool error.",
    inputSchema: z.object({ import_id: Id }),
    run: async (input: { import_id: string }, { env }) => cancelImport(env, input.import_id),
  },
];
