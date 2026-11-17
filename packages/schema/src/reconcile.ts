import { z } from "@hono/zod-openapi";
import { Account, PlanDate } from "./accounts";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import { screenMoney } from "./screen-money";
import { Transaction } from "./transactions";

export const RECONCILE_ADJUSTMENT_PAYEE = "Reconciliation Balance Adjustment";
export const RECONCILE_MEMO = "Entered automatically by Budget";

export const reconcileFields = {
  statement_balance: Milliunits.openapi({ description: "The balance at the bank, in milliunits" }),
  create_adjustment: z.boolean().optional().openapi({
    description: "Add an adjustment row for the difference (default false)",
  }),
  cleared_balance: Milliunits.optional().openapi({
    description: "The cleared balance the caller saw and confirmed; a different one answers 409",
  }),
  today: PlanDate.optional().openapi({
    description: "The adjustment's date (YYYY-MM-DD); default the UTC date",
  }),
};
export const ReconcileRequest = z.object(reconcileFields).strict().openapi("ReconcileRequest");
export type ReconcileRequest = z.infer<typeof ReconcileRequest>;

export const ReconcileResult = z.object({
  account: Account,
  reconciled_count: z.number().int().min(0),
  adjustment: Transaction.nullable(),
});
export type ReconcileResult = z.infer<typeof ReconcileResult>;
export const ReconcileResponse = dataEnvelope(ReconcileResult).openapi("ReconcileResponse");

export const ReconcileConflictBody = z
  .object({
    error: z.object({
      id: z.string(),
      name: z.enum(["reconcile_difference", "reconcile_changed"]),
      detail: z.string(),
      difference: Milliunits,
      cleared_balance: Milliunits,
    }),
  })
  .openapi("ReconcileConflict");

/** The bank balance minus the cleared balance. */
export const reconcileDifference = (statement: number, cleared: number) => statement - cleared;

/** "This account's cleared balance in Budget is $100.00 higher than your actual account." / "lower than" / "the same as". */
export function reconcileSentence(difference: number): string {
  const head = "This account's cleared balance in Budget is";
  if (difference === 0) return `${head} the same as your actual account.`;
  const word = difference < 0 ? "higher" : "lower";
  return `${head} ${screenMoney(Math.abs(difference))} ${word} than your actual account.`;
}

/** The Difference modal's three paragraphs. */
export const DIFFERENCE_TEXT = [
  "The balance recorded in Budget doesn’t match the balance at your financial institution.",
  "To correct this, compare each unlocked transaction in Budget against your account to make sure they match. Budget will keep track of the current difference at the top of your register.",
  "If you can’t find the difference, that’s okay! We’ll make an adjustment transaction and you can move on.",
] as const;

/** "a few seconds ago" ... "3 years ago". Future times read as "a few seconds ago". */
export function reconciledAgo(iso: string, nowMs: number): string {
  const s = Math.max(0, (nowMs - new Date(iso).getTime()) / 1000);
  const min = s / 60;
  const h = s / 3600;
  const d = s / 86400;
  if (s < 45) return "a few seconds ago";
  if (s < 90) return "a minute ago";
  if (min < 45) return `${Math.round(min)} minutes ago`;
  if (min < 90) return "an hour ago";
  if (h < 22) return `${Math.round(h)} hours ago`;
  if (h < 36) return "a day ago";
  if (d < 26) return `${Math.round(d)} days ago`;
  if (d < 46) return "a month ago";
  if (d < 320) return `${Math.round(d / 30.4375)} months ago`;
  if (d < 548) return "a year ago";
  return `${Math.round(d / 365.25)} years ago`;
}

/** "Nov 15, 2026, 8:06 PM" in the viewer's local time. */
export function reconciledTitle(iso: string): string {
  return new Date(iso)
    .toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    .replace(/[\u202f\u00a0]/g, " ");
}
