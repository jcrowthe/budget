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
    /** True when the payee's latest transaction is an inflow to Ready to Assign (then `last_category_id` is null); always false for system payees and transfer entries. */
    last_inflow_to_ready_to_assign: z.boolean(),
    /** Set on the "Transfer : <account>" entries, which stand for an open account of the plan. */
    transfer_account_id: z.string().nullable(),
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
  transfersHeading: "Payments and Transfers";
  /** The transfer entries ("Transfer : <account>"), all but the current account's. */
  transfers: Payee[];
  heading: "Saved Payees";
  saved: Payee[];
  hint: string | null;
  /** Index into [top?, ...transfers, ...saved]; -1 when nothing is highlighted. */
  active: number;
};

const TRANSFER_NAME_PREFIX = "Transfer : ";

/** What the payee picker lists for the typed text. Pure. */
export function payeeMenu(
  payees: Payee[],
  text: string,
  opts: {
    currentAccountId?: string | null;
    transfers?: boolean;
    /** The label an entry shows; the typed text matches it too (default: "To/From <account>"). */
    transferLabel?: (p: Payee) => string;
  } = {},
): PayeeMenu {
  const t = text.trim();
  const ordinary = payees.filter((p) => !p.transfer_account_id);
  const visible = ordinary.filter((p) => !p.hidden && p.system === null).sort(compareNames);
  const needle = t.toLowerCase();
  const transfers =
    opts.transfers === false
      ? []
      : payees
          .filter((p) => p.transfer_account_id && p.transfer_account_id !== opts.currentAccountId)
          .filter((p) => {
            if (needle === "") return true;
            const name = p.name.startsWith(TRANSFER_NAME_PREFIX)
              ? p.name.slice(TRANSFER_NAME_PREFIX.length)
              : p.name;
            return (
              p.name.toLowerCase().includes(needle) ||
              `to/from ${name}`.toLowerCase().includes(needle) ||
              (opts.transferLabel?.(p) ?? "").toLowerCase().includes(needle)
            );
          })
          .sort(compareNames);
  if (t === "") {
    return {
      top: null,
      help: null,
      transfersHeading: "Payments and Transfers",
      transfers,
      heading: "Saved Payees",
      saved: visible,
      hint: visible.length === 0 ? "Start typing to add a payee." : null,
      active: -1,
    };
  }
  const saved = visible.filter((p) => p.name.toLowerCase().includes(needle));
  const hiddenExact = ordinary.filter((p) => p.hidden && p.system === null && p.name === t);
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
  // [top, ...transfers, ...saved]: the first saved match, else the first transfer, else the top item.
  const active = saved.length > 0 ? 1 + transfers.length : transfers.length > 0 ? 1 : 0;
  return {
    top,
    help:
      top.kind === "create" && saved.length === 0 && transfers.length === 0
        ? `"${t}" will be created as a payee.`
        : null,
    transfersHeading: "Payments and Transfers",
    transfers,
    heading: "Saved Payees",
    saved,
    hint: null,
    active,
  };
}
