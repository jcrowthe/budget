import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const RENAMING = {
  title: "Renaming",
  intro: "Imported payees that match these rules will be renamed.",
  contains: "Contains",
  is: "Is",
  remove: "Remove renaming rule",
  add: "Add a renaming rule",
  listIcon: "Renaming rules applied",
  severalNote:
    "One or more of these payees have renaming rules. Deleting them will also delete their rules.",
  bankImport: "Bank Import Details",
  statement: "As it appears on your statement",
  imported: "As we imported it",
  dontRename: (payee: string) => `Don't rename as ${payee}`,
  importedAs: (payee: string, imported: string) => `${payee} (Imported as ${imported})`,
} as const;

export const RENAME_RULE_ERRORS = {
  empty: "Renaming rule text cannot be empty",
  tooLong: "Renaming rule text can be at most 200 characters",
  noField: "Give kind or text",
  duplicate: "This payee already has this renaming rule",
} as const;

export const RENAME_RULE_KINDS = ["contains", "is"] as const;
export type RenameRuleKind = (typeof RENAME_RULE_KINDS)[number];
export const RENAME_RULE_TEXT_MAX = 200;

/**
 * The form a rule's text and an imported name are compared in: white space runs are one space, NFC, Unicode lower
 * case. Always computed here, never in SQL (SQLite's lower() knows only ASCII); SQL compares stored folded text.
 */
export function foldRuleText(s: string): string {
  return s.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase();
}

/** The text as stored (trimmed), or why it is refused. */
export function checkRuleText(
  s: string,
): { ok: true; text: string } | { ok: false; error: "empty" | "tooLong" } {
  const text = s.trim();
  if (text === "") return { ok: false, error: "empty" };
  if (text.length > RENAME_RULE_TEXT_MAX) return { ok: false, error: "tooLong" };
  return { ok: true, text };
}

export interface MatchableRule {
  id: string;
  payeeId: string;
  kind: RenameRuleKind;
  matchText: string;
  createdAt: string;
}

/** The winning rule for an imported name, or null: `is` (equal) before `contains` (substring), newest, greater id. */
export function pickRenameRule<R extends MatchableRule>(
  name: string | null,
  rules: readonly R[],
): R | null {
  if (name === null) return null;
  const folded = foldRuleText(name);
  let best: R | null = null;
  const rank = (r: R) => (r.kind === "is" ? 1 : 0);
  for (const r of rules) {
    const hit = r.kind === "is" ? folded === r.matchText : folded.includes(r.matchText);
    if (!hit) continue;
    if (best === null) {
      best = r;
      continue;
    }
    const d = rank(r) - rank(best);
    if (
      d > 0 ||
      (d === 0 &&
        (r.createdAt > best.createdAt || (r.createdAt === best.createdAt && r.id > best.id)))
    )
      best = r;
  }
  return best;
}

const kind = z.enum(RENAME_RULE_KINDS);

export const PayeeRenameRule = z
  .object({
    id: z.string(),
    payee_id: z.string(),
    kind,
    text: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi("PayeeRenameRule");
export type PayeeRenameRule = z.infer<typeof PayeeRenameRule>;

export const RenameRuleCreate = z.object({ kind, text: z.string() }).openapi("RenameRuleCreate");
export type RenameRuleCreate = z.infer<typeof RenameRuleCreate>;

export const RenameRuleUpdate = z
  .object({ kind: kind.optional(), text: z.string().optional() })
  .openapi("RenameRuleUpdate");
export type RenameRuleUpdate = z.infer<typeof RenameRuleUpdate>;

export const RenameRuleIdParam = z.object({
  budget_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "budget_id", in: "path" } }),
  payee_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "payee_id", in: "path" } }),
  rule_id: z
    .string()
    .min(1)
    .openapi({ param: { name: "rule_id", in: "path" } }),
});

export const RenameRulePayeeParam = z.object({
  budget_id: RenameRuleIdParam.shape.budget_id,
  payee_id: RenameRuleIdParam.shape.payee_id,
});

export const RenameRuleResponse = dataEnvelope(z.object({ rule: PayeeRenameRule }));
export const RenameRuleListResponse = dataEnvelope(z.object({ rules: z.array(PayeeRenameRule) }));
