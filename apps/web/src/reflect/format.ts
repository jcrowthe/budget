// Money, axis and date formatting live in the schema package (pure, unit-tested): a zero is never negative (EXF-591).
export {
  debtsMoney,
  drillAmount,
  reportMoney as money,
  signedChange,
  tickMoney,
} from "@budget/schema/reflect-format";

const pct = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const percent = (p: number): string => `${pct.format(p)}%`;
export const changeClass = (n: number): "positive" | "negative" | "zero" =>
  n > 0 ? "positive" : n < 0 ? "negative" : "zero";
