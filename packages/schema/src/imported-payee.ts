/**
 * The payee an imported name resolves to (EXF-518), shared by the file import and, later, the bank sync. Pure.
 * Design: docs/file-import-design.md.
 */
import { foldRuleText, type MatchableRule, pickRenameRule } from "./rename-rules";

export const IMPORTED_PAYEE_NAME_MAX = 200;

export interface ImportPayee {
  id: string;
  name: string;
  /** Null for an ordinary payee; a transfer or other system payee is never a target. */
  system: string | null;
  deletedAt?: string | null;
}

export type ResolvedPayee = ({ payee_id: string } | { new_name: string }) & { rule_id?: string };

/** ALL-CAPS text (a letter, no lower-case letter) is title-cased word by word; anything else is unchanged. */
export function titleCaseAllCaps(s: string): string {
  if (!/\p{L}/u.test(s) || /\p{Ll}/u.test(s)) return s;
  return s
    .split(/(\s+)/)
    .map((part) =>
      /^\s*$/.test(part) ? part : part.toLowerCase().replace(/\p{L}/u, (c) => c.toUpperCase()),
    )
    .join("");
}

/**
 * 1. empty text: null. 2. the winning rule whose payee is live and ordinary: that payee and `rule_id`.
 * 3. a live ordinary payee with the same folded name. 4. a new payee named after the text.
 */
export function resolveImportedPayee(
  text: string | null,
  rules: readonly MatchableRule[],
  payees: readonly ImportPayee[],
): ResolvedPayee | null {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return null;
  const live = payees.filter((p) => p.system === null && !p.deletedAt);
  const liveIds = new Set(live.map((p) => p.id));

  const rule = pickRenameRule(
    trimmed,
    rules.filter((r) => liveIds.has(r.payeeId)),
  );
  if (rule) return { payee_id: rule.payeeId, rule_id: rule.id };

  const folded = foldRuleText(trimmed);
  const same = live.filter((p) => foldRuleText(p.name) === folded);
  if (same.length > 0) {
    const exact = same.find((p) => p.name === trimmed);
    if (exact) return { payee_id: exact.id };
    const first = same.reduce((a, b) => (b.id < a.id ? b : a));
    return { payee_id: first.id };
  }

  return { new_name: titleCaseAllCaps(trimmed).slice(0, IMPORTED_PAYEE_NAME_MAX).trimEnd() };
}
