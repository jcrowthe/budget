/** Amount arithmetic of the register's Outflow and Inflow fields (a sibling of assigned-edit.ts). */

type Tok = { n: number } | { op: "+" | "-" | "*" | "/" | "(" | ")" };

function tokenize(text: string): Tok[] | null {
  const s = text.replace(/[\s$,]/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) return null;
      out.push({ n: Number(m[0]) });
      i += m[0].length;
    } else if ("+-*/()".includes(c)) {
      out.push({ op: c as "+" });
      i += 1;
    } else return null;
  }
  return out;
}

/** Milliunits ≥ 0 for the text, or null (empty field) for nothing, zero or anything that does not compute. */
export function evaluateAmountEntry(text: string): number | null {
  const toks = tokenize(text);
  if (!toks || toks.length === 0) return null;
  const last = toks[toks.length - 1];
  if (last && "op" in last && last.op !== ")") toks.pop();
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (t: Tok | undefined, ...ops: string[]) => !!t && "op" in t && ops.includes(t.op);
  const fail = Symbol("bad");

  function primary(): number {
    const t = peek();
    if (!t) throw fail;
    if ("n" in t) {
      pos += 1;
      return t.n;
    }
    if (isOp(t, "-")) {
      pos += 1;
      return -primary();
    }
    if (isOp(t, "+")) {
      pos += 1;
      return primary();
    }
    if (isOp(t, "(")) {
      pos += 1;
      const v = sum();
      if (!isOp(peek(), ")")) throw fail;
      pos += 1;
      return v;
    }
    throw fail;
  }
  function product(): number {
    let v = primary();
    while (isOp(peek(), "*", "/")) {
      const op = (peek() as { op: string }).op;
      pos += 1;
      const r = primary();
      if (op === "/" && r === 0) throw fail;
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function sum(): number {
    let v = product();
    while (isOp(peek(), "+", "-")) {
      const op = (peek() as { op: string }).op;
      pos += 1;
      const r = product();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  try {
    const v = sum();
    if (pos !== toks.length || !Number.isFinite(v)) return null;
    const milli = Math.abs(Math.round(v * 100)) * 10;
    return milli === 0 || milli > Number.MAX_SAFE_INTEGER ? null : milli;
  } catch (e) {
    if (e === fail) return null;
    throw e;
  }
}

/** `1234500` → `1,234.50`: grouped, two decimals, no sign or currency. */
export function formatAmountEntry(milli: number): string {
  return (milli / 1000).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Stored amount: inflow minus outflow. */
export function signedAmount(outflow: number | null, inflow: number | null): number {
  return (inflow ?? 0) - (outflow ?? 0);
}
