import { RENAME_RULE_KINDS } from "@budget/schema/rename-rules";
import { z } from "zod";
import {
  createRenameRule,
  deleteRenameRule,
  listRenameRules,
  updateRenameRule,
} from "../../services/payee-rename-rules";
import { Id, timestamps } from "../tool-text";
import type { McpToolDef } from "../types";

const fields =
  "id, payee_id, kind (contains or is), text (as typed, trimmed, 1 to 200 characters), created_at and updated_at";
const matching =
  "A bank import renames a payee by these rules: the imported payee name (the bank's merchant name, else its name) is compared without regard to case or runs of spaces; is matches the whole name, contains matches when the text is a part of the name in the same order (no wildcards); a payee's rules are OR-ed; an is match wins over a contains match, then the most recently created rule wins. Rules are per plan, on ordinary payees and on transfer payees (`transfer:<account id>`); the import applies only those of ordinary payees, a rule on a transfer payee is stored and not applied. A system payee is a tool error.";

export const tools: McpToolDef[] = [
  {
    name: "list_payee_rename_rules",
    description: `List a payee's renaming rules, oldest first. Returns { rules }: each with ${fields}. ${matching} ${timestamps(["created_at", "updated_at"])}`,
    inputSchema: z.object({ budget_id: Id, payee_id: Id }),
    run: async (input: { budget_id: string; payee_id: string }, { env }) => ({
      rules: await listRenameRules(env, input.budget_id, input.payee_id),
    }),
  },
  {
    name: "create_payee_rename_rule",
    description: `Add a renaming rule to a payee. The same kind and text (ignoring case and runs of spaces) twice on one payee is a tool error, and so are empty text and text over 200 characters. Returns { rule } with ${fields}. ${matching} ${timestamps(["created_at", "updated_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_id: Id,
      kind: z.enum(RENAME_RULE_KINDS),
      text: z.string(),
    }),
    run: async (
      input: { budget_id: string; payee_id: string; kind: "contains" | "is"; text: string },
      { env, actor },
    ) => ({
      rule: await createRenameRule(env, actor, input.budget_id, input.payee_id, {
        kind: input.kind,
        text: input.text,
      }),
    }),
  },
  {
    name: "update_payee_rename_rule",
    description: `Change the kind and/or the text of a payee's renaming rule; its id and created_at stay. Give at least one of kind and text. A change that makes it equal to another rule of the payee is a tool error. Returns { rule } with ${fields}. ${timestamps(["created_at", "updated_at"])}`,
    inputSchema: z.object({
      budget_id: Id,
      payee_id: Id,
      rule_id: Id,
      kind: z.enum(RENAME_RULE_KINDS).optional(),
      text: z.string().optional(),
    }),
    run: async (
      input: {
        budget_id: string;
        payee_id: string;
        rule_id: string;
        kind?: "contains" | "is";
        text?: string;
      },
      { env, actor },
    ) => ({
      rule: await updateRenameRule(env, actor, input.budget_id, input.payee_id, input.rule_id, {
        kind: input.kind,
        text: input.text,
      }),
    }),
  },
  {
    name: "delete_payee_rename_rule",
    description: `Delete a payee's renaming rule. Returns { rule }: the rule as it was, with ${fields}. ${timestamps(["created_at", "updated_at"])}`,
    inputSchema: z.object({ budget_id: Id, payee_id: Id, rule_id: Id }),
    run: async (
      input: { budget_id: string; payee_id: string; rule_id: string },
      { env, actor },
    ) => ({
      rule: await deleteRenameRule(env, actor, input.budget_id, input.payee_id, input.rule_id),
    }),
  },
];
