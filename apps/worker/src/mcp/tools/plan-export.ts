import { PlanExportQuery } from "@budget/schema/plan-export";
import { z } from "zod";
import { exportPlan } from "../../services/plan-export";
import { Id } from "../tool-text";
import type { McpToolDef } from "../types";

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(parts.join(""));
}

export const tools: McpToolDef[] = [
  {
    name: "export_budget",
    description:
      "Export the whole plan as a ZIP of two files, the same as the REST download. Returns { file_name, content_base64, bytes }: the ZIP's name ('Budget Export - <plan> as of <YYYY-MM-DD HH-mm>.zip'), its bytes in base64 and its length. '<plan> as of <stamp> - Plan.csv' has one row per category per month (Month, Category Group/Category, Category Group, Category, Assigned, Activity, Available) from the plan's first month to the current month or the last month with money assigned; '... - Register.csv' has every transaction of every account, closed and tracking ones included (one row per split line, transfers as 'Transfer : <account>'), and each scheduled transaction once at its next date as Uncleared, newest first. Amounts and dates in the files are formatted text in the plan's own currency, number and date formats (US dollars with MM/DD/YYYY dates by default); read them with get_budget. now is the caller's local date and time, YYYY-MM-DDTHH:mm (default: the server's UTC time). Read-only. An unknown plan is a tool error.",
    inputSchema: z.object({ budget_id: Id, now: PlanExportQuery.shape.now }),
    run: async (input: { budget_id: string; now?: string }, { env }) => {
      const { fileName, bytes } = await exportPlan(env, input.budget_id, { now: input.now });
      return { file_name: fileName, content_base64: toBase64(bytes), bytes: bytes.length };
    },
  },
];
