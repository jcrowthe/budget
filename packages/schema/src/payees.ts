import { z } from "@hono/zod-openapi";
import { dataEnvelope } from "./common/envelope";

export const PAYEE_SYSTEMS = [
  "starting_balance",
  "manual_adjustment",
  "reconciliation_adjustment",
] as const;
export const PayeeSystem = z.enum(PAYEE_SYSTEMS);
export type PayeeSystem = z.infer<typeof PayeeSystem>;

export const Payee = z
  .object({
    id: z.string(),
    name: z.string(),
    hidden: z.boolean(),
    system: PayeeSystem.nullable(),
    last_category_id: z.string().nullable(),
  })
  .openapi("Payee");
export type Payee = z.infer<typeof Payee>;

export const PayeeListResponse = dataEnvelope(z.object({ payees: z.array(Payee) }));

export const PayeeListQuery = z.object({
  q: z.string().max(200).optional(),
  include_hidden: z.enum(["true", "false"]).optional(),
});

/** Case-insensitive, then exact, then id: a stable order for lists. */
export function compareNames(
  a: { id: string; name: string },
  b: { id: string; name: string },
): number {
  const la = a.name.toLowerCase();
  const lb = b.name.toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type PayeeMenu = {
  top: null | { kind: "create"; text: string } | { kind: "hidden"; payees: Payee[]; label: string };
  help: string | null;
  heading: "Saved Payees";
  saved: Payee[];
  hint: string | null;
  /** Index into [top, ...saved] (or into saved when top is null); -1 when nothing is highlighted. */
  active: number;
};

/** What the payee picker lists for the typed text. Pure. */
export function payeeMenu(payees: Payee[], text: string): PayeeMenu {
  const t = text.trim();
  const visible = payees.filter((p) => !p.hidden && p.system === null).sort(compareNames);
  if (t === "") {
    return {
      top: null,
      help: null,
      heading: "Saved Payees",
      saved: visible,
      hint: visible.length === 0 ? "Start typing to add a payee." : null,
      active: -1,
    };
  }
  const needle = t.toLowerCase();
  const saved = visible.filter((p) => p.name.toLowerCase().includes(needle));
  const hiddenExact = payees.filter((p) => p.hidden && p.system === null && p.name === t);
  const top: PayeeMenu["top"] =
    hiddenExact.length > 0
      ? {
          kind: "hidden",
          payees: hiddenExact,
          label:
            hiddenExact.length === 1
              ? "1 matching payee is hidden"
              : `${hiddenExact.length} matching payees are hidden`,
        }
      : { kind: "create", text: t };
  return {
    top,
    help: top.kind === "create" && saved.length === 0 ? `"${t}" will be created as a payee.` : null,
    heading: "Saved Payees",
    saved,
    hint: null,
    active: saved.length > 0 ? 1 : 0,
  };
}
