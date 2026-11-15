import type { MonthDetail } from "./months";

type Tok = { op: "+" | "-" | "*" | "/" } | { n: number };

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if ("+-*/".includes(ch)) {
      out.push({ op: ch as "+" | "-" | "*" | "/" });
      i++;
    } else {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(s.slice(i));
      if (!m) return null;
      out.push({ n: Number(m[0]) });
      i += m[0].length;
    }
  }
  return out;
}

/** expr := term (('+'|'-') term)*, term := factor (('*'|'/') factor)*, factor := '-'? number. Null when invalid. */
function evaluate(toks: Tok[]): number | null {
  let p = 0;
  const factor = (): number | null => {
    let sign = 1;
    const t = toks[p];
    if (t && "op" in t && t.op === "-") {
      sign = -1;
      p++;
    }
    const n = toks[p];
    if (!n || !("n" in n)) return null;
    p++;
    return sign * n.n;
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null) {
      const t = toks[p];
      if (!t || !("op" in t) || (t.op !== "*" && t.op !== "/")) break;
      p++;
      const r = factor();
      if (r === null) return null;
      v = t.op === "*" ? v * r : v / r;
    }
    return v;
  };
  let v = term();
  while (v !== null) {
    const t = toks[p];
    if (!t) break;
    if (!("op" in t) || (t.op !== "+" && t.op !== "-")) return null;
    p++;
    const r = term();
    if (r === null) return null;
    v = t.op === "+" ? v + r : v - r;
  }
  return p === toks.length ? v : null;
}

/** The milliunits the text in the Assigned field means. `before` is the amount before the edit. 0 when unparseable. */
export function evaluateAssigned(text: string, before: number): number {
  let s = text
    .replace(/[,\s]/g, "")
    .replace(/[xX×]/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/^\$/, "");
  if (/^[+*/]/.test(s)) s = String(before / 1000) + s;
  if (s === "") return 0;
  const toks = tokenize(s);
  const r = toks ? evaluate(toks) : null;
  if (r === null || !Number.isFinite(r)) return 0;
  const cents = Math.round(Number((Math.abs(r) * 100).toPrecision(12)));
  const m = Math.sign(r) * cents * 10;
  if (!Number.isFinite(m) || Math.abs(m) > Number.MAX_SAFE_INTEGER) return 0;
  return m === 0 ? 0 : m;
}

const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The field's initial text: `0.00`, `1,234.50`, `-12.00`. */
export function formatAssignedInput(m: number): string {
  const s = fmt.format(m / 1000);
  return s === "-0.00" ? "0.00" : s;
}

/** The cached month after setting a category's Assigned: category, group, Ready to Assign (targets are refetched). */
export function applyAssigned(detail: MonthDetail, categoryId: string, assigned: number) {
  const group = detail.groups.find((g) => g.categories.some((c) => c.id === categoryId));
  const old = group?.categories.find((c) => c.id === categoryId);
  if (!group || !old) return detail;
  const delta = assigned - old.assigned;
  if (delta === 0) return detail;
  return {
    ...detail,
    ready_to_assign: detail.ready_to_assign - delta,
    rta_breakdown: {
      ...detail.rta_breakdown,
      assigned_in_month: detail.rta_breakdown.assigned_in_month - delta,
    },
    groups: detail.groups.map((g) =>
      g !== group
        ? g
        : {
            ...g,
            assigned: g.assigned + delta,
            available: g.available + delta,
            categories: g.categories.map((c) =>
              c.id === categoryId
                ? { ...c, assigned: c.assigned + delta, available: c.available + delta }
                : c,
            ),
          },
    ),
  };
}
