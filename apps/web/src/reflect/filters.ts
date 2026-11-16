import type { Account } from "@budget/schema/accounts";
import type { MonthDetail } from "@budget/schema/months";
import { type ReportSlug, UNCATEGORIZED_ID } from "@budget/schema/reports";

/** One row of a filter popover: a leaf (id) or a group/section with leaf children. */
export interface FilterLeaf {
  id: string;
  label: string;
  hidden?: boolean;
}
export interface FilterNode {
  key: string;
  label: string;
  hidden?: boolean;
  /** A top-level item with its own id and no children (Uncategorized Transactions). */
  leaf?: FilterLeaf;
  children: FilterLeaf[];
}

export function categoryItems(month: MonthDetail | undefined): FilterNode[] {
  const nodes: FilterNode[] = [
    {
      key: UNCATEGORIZED_ID,
      label: "Uncategorized Transactions",
      leaf: { id: UNCATEGORIZED_ID, label: "Uncategorized Transactions" },
      children: [],
    },
  ];
  for (const g of month?.groups ?? []) {
    nodes.push({
      key: g.id,
      label: g.name,
      hidden: g.hidden,
      children: g.categories.map((c) => ({
        id: c.id,
        label: c.name,
        hidden: c.hidden || g.hidden,
      })),
    });
  }
  return nodes;
}

type AccountLike = Pick<Account, "id" | "name" | "group" | "on_budget" | "closed">;

export function accountSections(
  accounts: readonly AccountLike[],
  report: ReportSlug,
): FilterNode[] {
  const withTracking = report === "net-worth";
  const defs: { key: string; label: string; pick: (a: AccountLike) => boolean }[] = [
    { key: "cash", label: "Cash Accounts", pick: (a) => a.group === "cash" },
    { key: "credit", label: "Credit Accounts", pick: (a) => a.group === "credit" },
    ...(withTracking
      ? [
          {
            key: "tracking",
            label: "Tracking Accounts",
            pick: (a: AccountLike) => a.group === "tracking" || a.group === "loans",
          },
        ]
      : []),
    {
      key: "closed",
      label: "Closed Accounts",
      pick: (a) => a.group === "closed" && (withTracking || a.on_budget),
    },
  ];
  return defs
    .map((d) => ({
      key: d.key,
      label: d.label,
      children: accounts.filter(d.pick).map((a) => ({ id: a.id, label: a.name })),
    }))
    .filter((s) => s.children.length > 0);
}

export const leafIds = (nodes: readonly FilterNode[]): string[] =>
  nodes.flatMap((n) => (n.leaf ? [n.leaf.id] : n.children.map((c) => c.id)));

export function filterLabel(
  kind: "categories" | "accounts",
  total: number,
  selected: number,
): { text: string; count: number | null } {
  const word = kind === "categories" ? "Categories" : "Accounts";
  if (selected >= total) return { text: `All ${word}`, count: null };
  if (selected === 0) return { text: `No ${word} Selected`, count: null };
  return { text: `Selected ${word}`, count: selected };
}

/** What to store after Done: listed items not selected, plus excluded ids that are not listed (kept). */
export function excludedAfterDone(
  listedIds: readonly string[],
  selectedIds: ReadonlySet<string>,
  previousExcluded: readonly string[],
): string[] {
  const listed = new Set(listedIds);
  return [
    ...listedIds.filter((id) => !selectedIds.has(id)),
    ...previousExcluded.filter((id) => !listed.has(id)),
  ];
}

/** Case-insensitive substring search; groups stay when a child matches and then list only matches. */
export function searchNodes(nodes: readonly FilterNode[], query: string): FilterNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...nodes];
  const hit = (s: string) => s.toLowerCase().includes(q);
  const out: FilterNode[] = [];
  for (const n of nodes) {
    if (n.leaf) {
      if (hit(n.leaf.label)) out.push(n);
      continue;
    }
    const children = n.children.filter((c) => hit(c.label));
    if (children.length) out.push({ ...n, children });
  }
  return out;
}
