import { DEFAULT_PLAN_FORMAT, type ExportFormat, exportFormat } from "./plan-export";
import { FLAG_NAMES, type FlagColor, type PlanTransaction } from "./transactions";

export const REGISTER_CSV_HEADER = [
  "Account",
  "Flag",
  "Date",
  "Payee",
  "Category Group/Category",
  "Category Group",
  "Category",
  "Memo",
  "Outflow",
  "Inflow",
  "Cleared",
] as const;

const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;

const CLEARED_TEXT = {
  uncleared: "Uncleared",
  cleared: "Cleared",
  reconciled: "Reconciled",
} as const;

type Line = {
  payee: string | null;
  group: string | null;
  category: string | null;
  rta: boolean;
  memo: string | null;
  amount: number;
};

/** The CSV of the selected rows: a BOM, the header, then one line per row (one per line of a split). */
export function registerCsv(
  rows: readonly PlanTransaction[],
  fmt: ExportFormat = exportFormat(DEFAULT_PLAN_FORMAT),
  flagLabel: (c: FlagColor) => string = (c) => FLAG_NAMES[c],
): string {
  const out: string[] = [REGISTER_CSV_HEADER.map(quote).join(",")];
  for (const r of rows) {
    const n = r.subtransactions.length;
    const lines: Line[] =
      n > 0
        ? r.subtransactions.map((l, i) => ({
            payee: l.payee_name ?? r.payee_name,
            group: l.category_group_name,
            category: l.category_name,
            rta: l.inflow_to_ready_to_assign,
            memo: `Split (${i + 1}/${n}) ${l.memo ?? r.memo ?? ""}`.trim(),
            amount: l.amount,
          }))
        : [
            {
              payee: r.payee_name,
              group: r.category_group_name,
              category: r.category_name,
              rta: r.inflow_to_ready_to_assign,
              memo: r.memo,
              amount: r.amount,
            },
          ];
    for (const l of lines) {
      const rta = l.rta && !l.category;
      const group = rta ? "Inflow" : (l.group ?? "");
      const category = rta ? "Ready to Assign" : (l.category ?? "");
      const both = group && category ? `${group}: ${category}` : category;
      const fields = [
        r.account_name,
        r.flag_color ? flagLabel(r.flag_color) : "",
        fmt.date(r.date),
        l.payee ?? "",
        both,
        group,
        category,
        l.memo ?? "",
        l.amount < 0 ? fmt.amount(Math.abs(l.amount)) : fmt.amount(0),
        l.amount > 0 ? fmt.amount(Math.abs(l.amount)) : fmt.amount(0),
        CLEARED_TEXT[r.cleared],
      ];
      out.push(fields.map(quote).join(","));
    }
  }
  return `﻿${out.join("\n")}\n`;
}

/** The download's name: the plan and the minute, in the local time or in UTC. */
export function exportFileName(plan: string, at: Date, zone: "local" | "utc"): string {
  const p = (v: number) => String(v).padStart(2, "0");
  const u = zone === "utc";
  const y = u ? at.getUTCFullYear() : at.getFullYear();
  const mo = (u ? at.getUTCMonth() : at.getMonth()) + 1;
  const d = u ? at.getUTCDate() : at.getDate();
  const h = u ? at.getUTCHours() : at.getHours();
  const mi = u ? at.getUTCMinutes() : at.getMinutes();
  return `Selected Transactions for ${plan} as of ${y}-${p(mo)}-${p(d)} ${p(h)}-${p(mi)}.csv`;
}
