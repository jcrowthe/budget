import type { PlanFormatter } from "./plan-formats";
import type { TransactionDetail } from "./transactions";

/**
 * The rule of a manual match and of an unmatch (EXF-464), pure. The Worker's service imports the words
 * (`MATCH_TEXT`) and the label (`matchLabel`), not the decisions; a Worker test runs every case through both.
 * The register's bar asks `matchActions` and shows the reason of a refusal as a tooltip.
 */
export type MatchRow = Pick<
  TransactionDetail,
  | "id"
  | "account_id"
  | "date"
  | "payee_name"
  | "amount"
  | "cleared"
  | "approved"
  | "import_id"
  | "source"
  | "transfer_account_id"
  | "subtransactions"
  | "match_details"
>;
export type MatchFmt = Pick<PlanFormatter, "date" | "money">;
export type Refusal = {
  name: "not_matchable" | "not_matched" | "account_closed" | "transaction_reconciled";
  detail: string;
};
type Ctx = { closed: (accountId: string) => boolean; fmt: MatchFmt };

/** matched: a hand entry that took a bank import; import: a bank row as sent; entry: any other row. */
export const matchRole = (r: Pick<MatchRow, "import_id" | "source">) =>
  r.import_id !== null && r.source === null
    ? ("matched" as const)
    : r.source === "plaid"
      ? ("import" as const)
      : ("entry" as const);

/** A row named by payee, date and amount, never by id. */
export const matchLabel = (r: Pick<MatchRow, "payee_name" | "date" | "amount">, fmt: MatchFmt) =>
  `${r.payee_name || "The transaction"} on ${fmt.date(r.date)} (${fmt.money(r.amount)})`;

export const MATCH_TEXT = {
  differentAccounts: (a: string, b: string) =>
    `${a} and ${b} are in different accounts: only two transactions of one account can be matched.`,
  closedMatch: "This account is closed: its transactions cannot be matched",
  alreadyMatched: (x: string) => `${x} is already matched: unmatch it first.`,
  needOneOfEach:
    "Match requires one manually entered transaction and one imported transaction to be selected.",
  importApproved: (i: string) =>
    `${i} is approved: an approved import is its own transaction, so it cannot be matched.`,
  importSplit: (i: string) => `${i} is split: only an import as the bank sent it can be matched.`,
  importTransfer: (i: string) =>
    `${i} is a transfer: only an import as the bank sent it can be matched.`,
  importReconciled: (i: string) => `${i} is reconciled: it cannot be matched.`,
  splitMismatch: (t: string, e: string) =>
    `Before matching these transactions, you will first need to change the amount of your split transaction from ${t} to match the bank's transaction amount of ${e}.`,
  transferMismatch: (t: string, e: string) =>
    `Before matching these transactions, you will first need to change the amount of your transfer from ${t} to match the bank's transaction amount of ${e}.`,
  entryReconciled: (x: string, e: string) =>
    `${x} is reconciled: its amount cannot change to the bank's ${e}.`,
  notMatched: (x: string) => `${x} is not matched: only a matched transaction can be unmatched.`,
  closedUnmatch: "This account is closed: its transactions cannot be unmatched",
  unmatchReconciled: (x: string) =>
    `${x} is reconciled: unmatching would change a reconciled transaction.`,
  noBankCopy: (x: string) => `${x} has no record of the bank's transaction.`,
};

const refuse = (name: Refusal["name"], detail: string): Refusal => ({ name, detail });

/** Why the two rows cannot be matched, in the order of the design's table; null when they can. */
export function matchRefusal(a: MatchRow, b: MatchRow, ctx: Ctx): Refusal | null {
  const { fmt } = ctx;
  const la = matchLabel(a, fmt);
  const lb = matchLabel(b, fmt);
  if (a.account_id !== b.account_id)
    return refuse("not_matchable", MATCH_TEXT.differentAccounts(la, lb));
  if (ctx.closed(a.account_id)) return refuse("account_closed", MATCH_TEXT.closedMatch);
  if (matchRole(a) === "matched") return refuse("not_matchable", MATCH_TEXT.alreadyMatched(la));
  if (matchRole(b) === "matched") return refuse("not_matchable", MATCH_TEXT.alreadyMatched(lb));
  if (matchRole(a) === matchRole(b)) return refuse("not_matchable", MATCH_TEXT.needOneOfEach);
  const [imp, entry] = matchRole(a) === "import" ? [a, b] : [b, a];
  const li = imp === a ? la : lb;
  const le = imp === a ? lb : la;
  if (imp.approved) return refuse("not_matchable", MATCH_TEXT.importApproved(li));
  if (imp.subtransactions.length > 0) return refuse("not_matchable", MATCH_TEXT.importSplit(li));
  if (imp.transfer_account_id !== null)
    return refuse("not_matchable", MATCH_TEXT.importTransfer(li));
  if (imp.cleared === "reconciled")
    return refuse("transaction_reconciled", MATCH_TEXT.importReconciled(li));
  if (entry.amount !== imp.amount) {
    const t = fmt.money(entry.amount);
    const e = fmt.money(imp.amount);
    if (entry.subtransactions.length > 0)
      return refuse("not_matchable", MATCH_TEXT.splitMismatch(t, e));
    if (entry.transfer_account_id !== null)
      return refuse("not_matchable", MATCH_TEXT.transferMismatch(t, e));
    if (entry.cleared === "reconciled")
      return refuse("transaction_reconciled", MATCH_TEXT.entryReconciled(le, e));
  }
  return null;
}

/** Why the matched row cannot be unmatched, in the order of the design's table; null when it can. */
export function unmatchRefusal(r: MatchRow, ctx: Ctx): Refusal | null {
  const l = matchLabel(r, ctx.fmt);
  if (matchRole(r) !== "matched") return refuse("not_matched", MATCH_TEXT.notMatched(l));
  if (ctx.closed(r.account_id)) return refuse("account_closed", MATCH_TEXT.closedUnmatch);
  if (r.cleared === "reconciled")
    return refuse("transaction_reconciled", MATCH_TEXT.unmatchReconciled(l));
  if (r.match_details === null) return refuse("not_matched", MATCH_TEXT.noBankCopy(l));
  return null;
}

type Action = { enabled: boolean; reason: string | null };

/** What the bar offers for the selection: `Match` for exactly two rows, `Unmatch` for one matched row. */
export function matchActions(
  rows: readonly MatchRow[],
  accountOf: (accountId: string) => { closed: boolean } | null,
  fmt: MatchFmt,
): { match: Action | null; unmatch: Action | null } {
  const ctx: Ctx = { closed: (id) => accountOf(id)?.closed ?? false, fmt };
  const [a, b] = rows;
  const match =
    rows.length === 2 && a && b
      ? (() => {
          const r = matchRefusal(a, b, ctx);
          return { enabled: r === null, reason: r?.detail ?? null };
        })()
      : null;
  const unmatch =
    rows.length === 1 && a && matchRole(a) === "matched"
      ? (() => {
          const r = unmatchRefusal(a, ctx);
          return { enabled: r === null, reason: r?.detail ?? null };
        })()
      : null;
  return { match, unmatch };
}
