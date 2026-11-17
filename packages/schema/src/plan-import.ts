/**
 * Import Plan, the pure builder: the rows of a Plan file and a Register file become the plan they describe
 * (`ImportPlan`, integer keys; the Worker gives ids), with warnings, counts and the formats it read. No I/O.
 * Design: docs/plan-import-design.md.
 */
import { z } from "@hono/zod-openapi";
import { IsoDate } from "./common/dates";
import { dataEnvelope } from "./common/envelope";
import { Milliunits } from "./common/money";
import {
  DATE_FORMATS,
  type DateFormat,
  dateCandidates,
  detectDecimal,
  ImportError,
  type NamedText,
  type ParsedAmount,
  parseAmount,
  parseDate,
  parseExportName,
  parseMonthLabel,
  readDelimited,
  stripBom,
  unguard,
} from "./plan-import-read";
import { FLAG_NAMES, type FlagColor, isCalendarDate } from "./transactions";
import { transferPayeeName } from "./transfers";

export { ImportError, type ImportErrorCode } from "./plan-import-read";

export const IMPORT_ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "creditCard",
  "lineOfCredit",
  "otherAsset",
  "otherLiability",
] as const;
export type ImportAccountType = (typeof IMPORT_ACCOUNT_TYPES)[number];
/** On the plan: the cash and credit types (a Worker test checks it against the core's `isOnBudget`). */
export const IMPORT_ON_BUDGET: Record<ImportAccountType, boolean> = {
  checking: true,
  savings: true,
  cash: true,
  creditCard: true,
  lineOfCredit: true,
  otherAsset: false,
  otherLiability: false,
};
const CREDIT_TYPES: readonly string[] = ["creditCard", "lineOfCredit"];

export const IMPORT_LIMITS = {
  uploadBytes: 20 * 2 ** 20,
  registerRows: 200_000,
  planRows: 400_000,
  warnings: 100,
  mismatches: 200,
};
export const HIDDEN_GROUP = "Hidden Categories";
export const PAYMENT_GROUP = "Credit Card Payments";
const STARTING_BALANCE = "Starting Balance";
const MANUAL_ADJUSTMENT = "Manual Balance Adjustment";
const TRANSFER_PREFIX = "Transfer : ";

// ---- Schemas ----

const RealDate = IsoDate.refine(
  (s) => isCalendarDate(s) && s >= "1900-01-01" && s <= "2199-12-31",
  { message: "must be a real date between 1900 and 2199" },
);

export const PlanImportOptions = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    export_date: RealDate.optional(),
    date_format: z.enum(DATE_FORMATS).optional(),
    account_types: z.record(z.string(), z.enum(IMPORT_ACCOUNT_TYPES)).optional(),
    currency_format: z
      .object({
        currency_symbol: z.string().max(8).optional(),
        symbol_placement: z.enum(["before", "after", "none"]).optional(),
        decimal_separator: z.enum([".", ",", "-", "/"]).optional(),
        decimal_digits: z.number().int().min(0).max(3).optional(),
      })
      .optional(),
  })
  .openapi("PlanImportOptions");
export type PlanImportOptions = z.infer<typeof PlanImportOptions>;

export const ImportFormats = z
  .object({
    delimiter: z.enum(["comma", "tab"]),
    currency_symbol: z.string(),
    symbol_placement: z.enum(["before", "after", "none"]),
    decimal_separator: z.string(),
    decimal_digits: z.number().int(),
    date_format: z.enum(DATE_FORMATS),
  })
  .openapi("ImportFormats");
export type ImportFormats = z.infer<typeof ImportFormats>;

export const ImportWarning = z
  .object({ code: z.string(), message: z.string(), count: z.number().int() })
  .openapi("ImportWarning");
export type ImportWarning = z.infer<typeof ImportWarning>;

export const ImportMismatch = z
  .object({
    category: z.string(),
    month: z.string(),
    column: z.enum(["activity", "available"]),
    expected: Milliunits,
    got: Milliunits,
  })
  .openapi("ImportMismatch");
export type ImportMismatch = z.infer<typeof ImportMismatch>;

export const ImportAccount = z
  .object({
    name: z.string(),
    type: z.enum(IMPORT_ACCOUNT_TYPES),
    proposed_type: z.enum(IMPORT_ACCOUNT_TYPES),
    reason: z.string(),
    on_budget: z.boolean(),
    transactions: z.number().int(),
  })
  .openapi("ImportAccount");
export type ImportAccount = z.infer<typeof ImportAccount>;

export const ImportCounts = z
  .object({
    accounts: z.number().int(),
    groups: z.number().int(),
    categories: z.number().int(),
    payees: z.number().int(),
    months: z.number().int(),
    assignments: z.number().int(),
    transactions: z.number().int(),
    splits: z.number().int(),
    split_lines: z.number().int(),
    transfers_paired: z.number().int(),
    scheduled: z.number().int(),
  })
  .openapi("ImportCounts");
export type ImportCounts = z.infer<typeof ImportCounts>;

export const DateQuestion = z
  .object({
    question: z.string(),
    first_transaction: z.string(),
    options: z.array(z.object({ date_format: z.enum(DATE_FORMATS), date: z.string() })),
  })
  .openapi("ImportDateQuestion");
export type DateQuestion = z.infer<typeof DateQuestion>;

export const ImportSummary = z
  .object({
    name: z.string(),
    export_date: z.string(),
    file_names: z.object({ plan: z.string(), register: z.string() }),
    first_month: z.string().nullable(),
    last_month: z.string().nullable(),
    formats: ImportFormats,
    accounts: z.array(ImportAccount),
    counts: ImportCounts,
    warnings: z.array(ImportWarning),
    warning_count: z.number().int(),
    mismatches: z.array(ImportMismatch),
    mismatch_count: z.number().int(),
  })
  .openapi("ImportSummary");
export type ImportSummary = z.infer<typeof ImportSummary>;

export const PlanImportPreview = ImportSummary.extend({
  date_question: DateQuestion.nullable(),
}).openapi("PlanImportPreview");
export type PlanImportPreview = z.infer<typeof PlanImportPreview>;

export const PlanImportResult = z
  .object({
    import_id: z.string(),
    state: z.enum(["writing", "done"]),
    /** The new plan; null until the import is done (a half-imported plan is invisible). */
    budget_id: z.string().nullable(),
    progress: z.object({ chunks_done: z.number().int(), chunk_count: z.number().int() }),
    summary: ImportSummary,
  })
  .openapi("PlanImportResult");
export type PlanImportResult = z.infer<typeof PlanImportResult>;

export const PlanImportCancelResult = z
  .object({ import_id: z.string(), state: z.literal("abandoned") })
  .openapi("PlanImportCancelResult");
export type PlanImportCancelResult = z.infer<typeof PlanImportCancelResult>;

export const PlanImportPreviewResponse = dataEnvelope(PlanImportPreview);
export const PlanImportResultResponse = dataEnvelope(PlanImportResult);
export const PlanImportCancelResponse = dataEnvelope(PlanImportCancelResult);

// ---- The plan an import describes ----

export type Cleared = "uncleared" | "cleared" | "reconciled";

export interface ImportPlan {
  name: string;
  exportDate: string;
  firstMonth: string | null;
  months: string[];
  formats: ImportFormats;
  dateQuestion: DateQuestion | null;
  fileNames: { plan: string; register: string };
  accounts: {
    name: string;
    type: ImportAccountType;
    proposedType: ImportAccountType;
    reason: string;
    onBudget: boolean;
    sort: number;
    transactions: number;
  }[];
  groups: { name: string; sort: number; kind: "credit_card_payments" | null }[];
  categories: {
    group: number;
    name: string;
    sort: number;
    hidden: boolean;
    paymentAccount: number | null;
  }[];
  assignments: { category: number; month: string; assigned: number }[];
  payees: { name: string; system: "starting_balance" | "manual_adjustment" | null }[];
  transactions: {
    account: number;
    date: string;
    payee: number | null;
    payeeName: string | null;
    category: number | null;
    inflowToRta: boolean;
    memo: string | null;
    amount: number;
    cleared: Cleared;
    flag: FlagColor | null;
    order: number;
    transfer: number | null;
    transferAccount: number | null;
    parent: number | null;
    splitIndex: number | null;
  }[];
  schedules: {
    account: number;
    date: string;
    payee: number | null;
    category: number | null;
    inflowToRta: boolean;
    memo: string | null;
    amount: number;
    flag: FlagColor | null;
    order: number;
  }[];
  planRows: { month: string; category: number; activity: number; available: number }[];
  warnings: ImportWarning[];
  warningCount: number;
  counts: ImportCounts;
}

const FLAG_BY_NAME = new Map<string, FlagColor>(
  (Object.entries(FLAG_NAMES) as [FlagColor, string][]).map(([c, n]) => [n.toLowerCase(), c]),
);
const CLEARED: Record<string, Cleared> = {
  uncleared: "uncleared",
  cleared: "cleared",
  reconciled: "reconciled",
};
const SPLIT_PREFIX = /^Split \((\d+)\/(\d+)\) /;

interface RegRow {
  account: number;
  flag: FlagColor | null;
  date: string;
  payee: string;
  group: string;
  cat: string;
  memo: string;
  amount: number;
  cleared: Cleared;
}

export interface BuildInput {
  plan: NamedText;
  register: NamedText;
  delimiter: "," | "\t";
  planDelimiter?: "," | "\t";
  zipName: string | null;
  options: PlanImportOptions;
  serverToday: string;
}

export function buildImportPlan(input: BuildInput): ImportPlan {
  const { options, serverToday } = input;
  const warnings = new Map<string, ImportWarning>();
  const warn = (code: string, subject: string, message: string) => {
    const key = `${code}\u0000${subject}`;
    const w = warnings.get(key);
    if (w) w.count += 1;
    else warnings.set(key, { code, message, count: 1 });
  };

  // ---- Raw rows
  const planRaw = readDelimited(stripBom(input.plan.text), input.planDelimiter ?? input.delimiter);
  const regRaw = readDelimited(stripBom(input.register.text), input.delimiter);
  if (regRaw.length - 1 > IMPORT_LIMITS.registerRows) {
    throw new ImportError(
      "too_large",
      `The Register file has more than ${IMPORT_LIMITS.registerRows} rows`,
    );
  }
  if (planRaw.length - 1 > IMPORT_LIMITS.planRows) {
    throw new ImportError(
      "too_large",
      `The Plan file has more than ${IMPORT_LIMITS.planRows} rows`,
    );
  }

  // ---- Decimal separator: the option, else the first amount cell that reveals it (Plan Assigned, Activity, Available,
  // then Register Outflow, Inflow). Fixed before any amount is read, so grouped amounts are unambiguous.
  let decimal: string | null = options.currency_format?.decimal_separator ?? null;
  if (decimal === null) {
    const scan = (rows: string[][], cols: number[]) => {
      for (let i = 1; i < rows.length && decimal === null; i++) {
        for (const c of cols) {
          decimal = detectDecimal((rows[i] as string[])[c] ?? "");
          if (decimal !== null) break;
        }
      }
    };
    scan(planRaw, [4, 5, 6]);
    if (decimal === null) scan(regRaw, [8, 9]);
  }

  // ---- Amount formats (first non-zero amount decides; a different one later is a warning)
  let fmt: ParsedAmount | null = null;
  let fallback: ParsedAmount | null = null;
  let inconsistent = 0;
  const amount = (cell: string, file: string, line: number, column: string): number => {
    const t = cell.trim();
    if (t === "" && file === "Register file") return 0;
    const p = parseAmount(t, decimal);
    if (!p)
      throw new ImportError(
        "bad_amount",
        `${file} line ${line}, column ${column}: "${cell}" is not an amount`,
      );
    fallback ??= p;
    if (fmt === null) {
      if (p.milliunits !== 0) fmt = p;
    } else if (
      p.symbol !== fmt.symbol ||
      p.placement !== fmt.placement ||
      (p.separator !== null && fmt.separator !== null && p.separator !== fmt.separator)
    ) {
      inconsistent++;
    }
    return p.milliunits;
  };

  // ---- Plan file
  interface PlanCat {
    group: string;
    name: string;
    hidden: boolean;
    payment: boolean;
  }
  const planCats: PlanCat[] = [];
  const catKeys = new Map<string, number[]>();
  const occurrences = new Map<string, number>();
  const planCells: {
    month: string;
    cat: number;
    assigned: number;
    activity: number;
    available: number;
  }[] = [];
  const monthSet = new Set<string>();
  for (let i = 1; i < planRaw.length; i++) {
    const r = planRaw[i] as string[];
    const line = i + 1;
    if (r.length < 7) {
      throw new ImportError(
        "not_recognized",
        `Plan file line ${line} has ${r.length} fields, expected 7`,
      );
    }
    const month = parseMonthLabel(r[0] as string);
    if (!month)
      throw new ImportError(
        "bad_month",
        `Plan file line ${line}: "${r[0]}" is not a month such as Nov 2026`,
      );
    monthSet.add(month);
    const group = unguard(r[2] as string);
    const name = unguard(r[3] as string);
    const key = `${group}\u0000${name}`;
    const occ = `${month}\u0000${key}`;
    const k = occurrences.get(occ) ?? 0;
    occurrences.set(occ, k + 1);
    let list = catKeys.get(key);
    if (!list) {
      list = [];
      catKeys.set(key, list);
    }
    let cat = list[k];
    if (cat === undefined) {
      cat = planCats.length;
      planCats.push({
        group,
        name,
        hidden: group === HIDDEN_GROUP,
        payment: group === PAYMENT_GROUP,
      });
      list.push(cat);
    }
    planCells.push({
      month,
      cat,
      assigned: amount(r[4] as string, "Plan file", line, "Assigned"),
      activity: amount(r[5] as string, "Plan file", line, "Activity"),
      available: amount(r[6] as string, "Plan file", line, "Available"),
    });
  }
  const months = [...monthSet].sort();

  // ---- Register: the date format
  const dateTexts = new Set<string>();
  for (let i = 1; i < regRaw.length; i++) {
    const r = regRaw[i] as string[];
    if (r.length < 11) {
      throw new ImportError(
        "not_recognized",
        `Register file line ${i + 1} has ${r.length} fields, expected 11`,
      );
    }
    dateTexts.add((r[2] as string).trim());
  }
  const firstDateText = regRaw.length > 1 ? ((regRaw[1] as string[])[2] as string).trim() : "";
  let dateFormat: DateFormat = options.date_format ?? "MM/DD/YYYY";
  let dateQuestion: DateQuestion | null = null;
  if (options.date_format) {
    for (const t of dateTexts) {
      if (parseDate(t, options.date_format) === null) {
        const line = regRaw.findIndex((r, ix) => ix > 0 && (r[2] as string).trim() === t) + 1;
        throw new ImportError(
          "bad_date",
          `Register line ${line}: ${t} is not a ${options.date_format} date`,
        );
      }
    }
  } else if (dateTexts.size > 0) {
    // Formats that read every date alike (all days equal to their months) are one answer, not a question.
    const seen = new Set<string>();
    const candidates = dateCandidates([...dateTexts]).filter((f) => {
      const signature = [...dateTexts].map((t) => parseDate(t, f)).join("|");
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
    if (candidates.length === 0) {
      throw new ImportError("bad_date", "No date format reads every date of the Register file");
    }
    dateFormat = candidates[0] as DateFormat;
    if (candidates.length > 1) {
      dateQuestion = {
        question: `The date format of ${input.register.name} is unclear. The first transaction reads ${firstDateText}. What date is this?`,
        first_transaction: firstDateText,
        options: candidates.map((f) => ({
          date_format: f,
          date: parseDate(firstDateText, f) as string,
        })),
      };
    }
  }
  const isoOf = new Map<string, string>();
  for (const t of dateTexts) isoOf.set(t, parseDate(t, dateFormat) as string);

  // ---- Register rows
  const accountIndex = new Map<string, number>();
  const accountNames: string[] = [];
  const accountOf = (name: string): number => {
    let ix = accountIndex.get(name);
    if (ix === undefined) {
      ix = accountNames.length;
      accountIndex.set(name, ix);
      accountNames.push(name);
    }
    return ix;
  };
  const rows: RegRow[] = [];
  for (let i = 1; i < regRaw.length; i++) {
    const r = regRaw[i] as string[];
    const line = i + 1;
    const accountName = unguard(r[0] as string);
    if (accountName === "")
      throw new ImportError("not_recognized", `Register file line ${line} has no account`);
    const flagText = unguard(r[1] as string).trim();
    let flag: FlagColor | null = null;
    if (flagText !== "") {
      flag = FLAG_BY_NAME.get(flagText.toLowerCase()) ?? null;
      if (!flag)
        warn(
          "flag_name_unknown",
          flagText,
          `The flag "${flagText}" is not a colour; those rows have no flag`,
        );
    }
    const clearedText = (r[10] as string).trim();
    let cleared: Cleared = "uncleared";
    const c = CLEARED[clearedText.toLowerCase()];
    if (c) cleared = c;
    else
      warn(
        "cleared_unknown",
        clearedText,
        `The cleared state "${clearedText}" is unknown; those rows are uncleared`,
      );
    const out = amount(r[8] as string, "Register file", line, "Outflow");
    const inflow = amount(r[9] as string, "Register file", line, "Inflow");
    rows.push({
      account: accountOf(accountName),
      flag,
      date: isoOf.get((r[2] as string).trim()) as string,
      payee: unguard(r[3] as string),
      group: unguard(r[5] as string),
      cat: unguard(r[6] as string),
      memo: unguard(r[7] as string),
      amount: inflow - out + 0,
      cleared,
    });
  }
  if (inconsistent > 0) {
    warn(
      "currency_inconsistent",
      "amounts",
      `${inconsistent} amounts are written in another currency format than the first one`,
    );
  }

  // ---- Export name and date
  const named =
    (input.zipName ? parseExportName(input.zipName) : null) ??
    parseExportName(input.register.name) ??
    parseExportName(input.plan.name);
  let name = options.name ?? named?.name;
  if (!name) {
    name = "Imported Plan";
    warn(
      "name_missing",
      "name",
      "The file names give no plan name; the plan is called Imported Plan",
    );
  }
  name = name.slice(0, 100);
  let exportDate = options.export_date ?? named?.exportDate;
  if (!exportDate) {
    exportDate = serverToday;
    warn(
      "export_date_missing",
      "export_date",
      `The file names give no export date; ${serverToday} (today) is used`,
    );
  }

  // ---- Accounts known from the Plan file's payment rows, and the Starting Balance of each account
  const startingOf = new Map<number, RegRow>();
  for (const r of rows) {
    if (r.payee === STARTING_BALANCE && !startingOf.has(r.account)) startingOf.set(r.account, r);
  }
  const paymentNames = new Set<string>();
  for (const pc of planCats) if (pc.payment) paymentNames.add(pc.name);
  // A hidden category named like an account whose Starting Balance is an uncategorized outflow is a closed card's payment category.
  const hiddenPayment = new Set<number>();
  planCats.forEach((pc, ix) => {
    if (!pc.hidden) return;
    const a = accountIndex.get(pc.name);
    if (a === undefined || paymentNames.has(pc.name)) return;
    const s = startingOf.get(a);
    if (s && s.amount < 0 && s.group === "" && s.cat === "") {
      hiddenPayment.add(ix);
      paymentNames.add(pc.name);
      warn(
        "hidden_payment_category",
        pc.name,
        `The hidden category "${pc.name}" is the payment category of the card of that name and is shown`,
      );
    }
  });
  const withoutRows = new Set<number>();
  for (const pn of paymentNames) {
    if (!accountIndex.has(pn)) {
      withoutRows.add(accountOf(pn));
      warn(
        "card_without_account",
        pn,
        `No Register account is named "${pn}": a credit card account with no transactions is created`,
      );
    }
  }

  // ---- Account types
  const nAccounts = accountNames.length;
  const proposed: ImportAccountType[] = [];
  const reasons: string[] = [];
  for (let a = 0; a < nAccounts; a++) {
    const nm = accountNames[a] as string;
    const s = startingOf.get(a);
    if (paymentNames.has(nm)) {
      proposed.push("creditCard");
      reasons.push("A Credit Card Payments category has this account's name");
    } else if (s && s.group === "" && s.cat === "" && s.amount >= 0) {
      proposed.push("otherAsset");
      reasons.push("Its Starting Balance is an uncategorized inflow");
    } else if (s && s.group === "" && s.cat === "") {
      proposed.push("otherLiability");
      reasons.push(
        "Its Starting Balance is an uncategorized outflow (a loan or debt, kept as a tracking liability)",
      );
    } else {
      proposed.push("checking");
      reasons.push("Checking is the default type");
    }
  }
  const types: ImportAccountType[] = [...proposed];
  for (const [acct, type] of Object.entries(options.account_types ?? {})) {
    const a = accountIndex.get(acct);
    if (a === undefined)
      throw new ImportError(
        "bad_option",
        `account_types names "${acct}", which is not an account in the file`,
      );
    if (!IMPORT_ACCOUNT_TYPES.includes(type))
      throw new ImportError("bad_option", `The account type "${type}" cannot be created`);
    if (paymentNames.has(acct) && !CREDIT_TYPES.includes(type)) {
      throw new ImportError(
        "bad_option",
        `"${acct}" has a credit card payment category: its type must be creditCard or lineOfCredit`,
      );
    }
    types[a] = type;
  }
  types.forEach((t, a) => {
    if (t === "otherLiability" && proposed[a] === "otherLiability") {
      const nm = accountNames[a] as string;
      warn(
        "loan_as_tracking_liability",
        nm,
        `"${nm}" looks like a loan or debt, which the app cannot create yet: it is a tracking liability`,
      );
    }
  });
  const onBudget = types.map((t) => IMPORT_ON_BUDGET[t]);

  // ---- Groups and categories
  const groups: ImportPlan["groups"] = [];
  const categories: ImportPlan["categories"] = [];
  const groupIx = new Map<string, number>();
  const catsInGroup: number[] = [];
  const hiddenGroups: string[] = [];
  const hiddenNames = new Map<string, number>();
  let paymentGroup = -1;
  const groupOf = (gname: string, kind: "credit_card_payments" | null = null): number => {
    let g = groupIx.get(gname);
    if (g === undefined) {
      g = groups.length;
      groups.push({ name: gname, sort: 0, kind });
      catsInGroup.push(0);
      groupIx.set(gname, g);
    }
    return g;
  };
  const addCategory = (
    g: number,
    cname: string,
    hidden: boolean,
    paymentAccount: number | null,
  ): number => {
    categories.push({
      group: g,
      name: cname,
      sort: catsInGroup[g] as number,
      hidden,
      paymentAccount,
    });
    catsInGroup[g] = (catsInGroup[g] as number) + 1;
    return categories.length - 1;
  };
  const paymentCat = new Map<number, number>();
  const ensurePaymentGroup = () => {
    if (paymentGroup < 0) paymentGroup = groupOf(PAYMENT_GROUP, "credit_card_payments");
    return paymentGroup;
  };
  const hiddenGroupOf = (cname: string): number => {
    const k = hiddenNames.get(cname) ?? 0;
    hiddenNames.set(cname, k + 1);
    const gname = k === 0 ? HIDDEN_GROUP : `${HIDDEN_GROUP} (${k + 1})`;
    if (!groupIx.has(gname)) hiddenGroups.push(gname);
    return groupOf(gname);
  };
  // Visible groups first (so the hidden ones sort last), in the Plan file's order.
  const catOfPlan: number[] = new Array(planCats.length).fill(-1);
  const deferredHidden: number[] = [];
  planCats.forEach((pc, ix) => {
    if (pc.payment || hiddenPayment.has(ix)) {
      const a = accountIndex.get(pc.name);
      if (a === undefined) return;
      if (!CREDIT_TYPES.includes(types[a] as string) || paymentCat.has(a)) {
        // A payment row for an account that is not a credit account, or repeated: an ordinary category.
        catOfPlan[ix] = addCategory(groupOf(pc.group), pc.name, false, null);
        return;
      }
      const c = addCategory(ensurePaymentGroup(), pc.name, false, a);
      paymentCat.set(a, c);
      catOfPlan[ix] = c;
    } else if (pc.hidden) deferredHidden.push(ix);
    else catOfPlan[ix] = addCategory(groupOf(pc.group), pc.name, false, null);
  });
  for (let a = 0; a < nAccounts; a++) {
    if (CREDIT_TYPES.includes(types[a] as string) && !paymentCat.has(a)) {
      paymentCat.set(a, addCategory(ensurePaymentGroup(), accountNames[a] as string, false, a));
    }
  }
  const catByKey = new Map<string, number>();
  planCats.forEach((pc, ix) => {
    const c = catOfPlan[ix];
    if (c !== undefined && c >= 0 && !catByKey.has(`${pc.group}\u0000${pc.name}`)) {
      catByKey.set(`${pc.group}\u0000${pc.name}`, c);
    }
  });
  // Register-only categories join their group after the Plan file's, hidden ones come last.
  const hiddenOrder = () => {
    for (const ix of deferredHidden) {
      const pc = planCats[ix] as PlanCat;
      catOfPlan[ix] = addCategory(hiddenGroupOf(pc.name), pc.name, true, null);
      const key = `${pc.group}\u0000${pc.name}`;
      if (!catByKey.has(key)) catByKey.set(key, catOfPlan[ix] as number);
    }
  };

  // ---- Splits, transfers, scheduled
  interface Entry {
    first: number;
    rows: number[];
    split: boolean;
  }
  const entries: Entry[] = [];
  const transferCandidate = new Map<string, number[]>();
  const N = rows.length;
  const splitMatch = (r: RegRow) => SPLIT_PREFIX.exec(r.memo);
  for (let i = 0; i < N; ) {
    const r = rows[i] as RegRow;
    const m = splitMatch(r);
    if (m && Number(m[1]) === 1 && Number(m[2]) >= 2) {
      const n = Number(m[2]);
      let ok = i + n <= N;
      for (let j = 0; ok && j < n; j++) {
        const x = rows[i + j] as RegRow;
        const mx = splitMatch(x);
        ok =
          mx !== null &&
          Number(mx[1]) === j + 1 &&
          Number(mx[2]) === n &&
          x.account === r.account &&
          x.date === r.date &&
          x.flag === r.flag &&
          x.cleared === r.cleared;
      }
      if (ok) {
        entries.push({ first: i, rows: Array.from({ length: n }, (_, j) => i + j), split: true });
        i += n;
        continue;
      }
    }
    if (m) {
      warn(
        "split_incomplete",
        "run",
        "Rows with a Split (k/n) memo that do not make a complete split are imported as plain rows",
      );
    }
    entries.push({ first: i, rows: [i], split: false });
    i++;
  }
  const isTransferPayee = (p: string) => p.startsWith(TRANSFER_PREFIX);
  const partnerOf = new Map<number, number>();
  const accountNameIs = (n: string) => accountIndex.get(n);
  for (const e of entries) {
    if (e.split) continue;
    const r = rows[e.first] as RegRow;
    if (!isTransferPayee(r.payee)) continue;
    const other = accountNameIs(r.payee.slice(TRANSFER_PREFIX.length));
    if (other === undefined || other === r.account) continue;
    const key = `${r.account}|${other}|${r.date}|${r.amount}`;
    const list = transferCandidate.get(key);
    if (list) list.push(e.first);
    else transferCandidate.set(key, [e.first]);
  }
  const used = new Set<number>();
  const cursor = new Map<string, number>();
  for (const e of entries) {
    if (e.split) continue;
    const ri = e.first;
    if (used.has(ri)) continue;
    const r = rows[ri] as RegRow;
    if (!isTransferPayee(r.payee)) continue;
    const other = accountNameIs(r.payee.slice(TRANSFER_PREFIX.length));
    if (other === undefined || other === r.account) continue;
    const ckey = `${other}|${r.account}|${r.date}|${0 - r.amount + 0}`;
    const list = transferCandidate.get(ckey);
    let found = -1;
    if (list) {
      let c = cursor.get(ckey) ?? 0;
      while (c < list.length && used.has(list[c] as number)) c++;
      cursor.set(ckey, c);
      if (c < list.length) found = list[c] as number;
    }
    if (found >= 0) {
      used.add(ri);
      used.add(found);
      partnerOf.set(ri, found);
      partnerOf.set(found, ri);
    }
  }

  // ---- Categories of rows
  const catOfRow = (r: RegRow): { category: number | null; rta: boolean } => {
    if (r.group === "" && r.cat === "") return { category: null, rta: false };
    if (r.group === "Inflow" && r.cat === "Ready to Assign") return { category: null, rta: true };
    if (r.group === PAYMENT_GROUP) {
      const a = accountIndex.get(r.cat);
      const c = a === undefined ? undefined : paymentCat.get(a);
      if (c === undefined) {
        warn(
          "category_not_in_plan_file",
          `${r.group}: ${r.cat}`,
          `The category "${r.group}: ${r.cat}" is no payment category of an account; its rows are uncategorized`,
        );
        return { category: null, rta: false };
      }
      if (a === r.account) {
        warn(
          "card_own_payment_category",
          r.cat,
          `Rows of the card "${r.cat}" categorized to its own payment category are imported uncategorized`,
        );
        return { category: null, rta: false };
      }
      return { category: c, rta: false };
    }
    const key = `${r.group}\u0000${r.cat}`;
    let c = catByKey.get(key);
    if (c === undefined) {
      warn(
        "category_not_in_plan_file",
        `${r.group}: ${r.cat}`,
        `The category "${r.group}: ${r.cat}" is not in the Plan file: it is created without assigned money`,
      );
      if (r.group === HIDDEN_GROUP) c = addCategory(hiddenGroupOf(r.cat), r.cat, true, null);
      else c = addCategory(groupOf(r.group === "" ? "Imported" : r.group), r.cat, false, null);
      catByKey.set(key, c);
    }
    return { category: c, rta: false };
  };

  // ---- Payees
  const payees: ImportPlan["payees"] = [];
  const payeeIx = new Map<string, number>();
  const payeeOf = (text: string): number | null => {
    if (text === "") return null;
    let p = payeeIx.get(text);
    if (p === undefined) {
      p = payees.length;
      payees.push({
        name: text,
        system:
          text === STARTING_BALANCE
            ? "starting_balance"
            : text === MANUAL_ADJUSTMENT
              ? "manual_adjustment"
              : null,
      });
      payeeIx.set(text, p);
    }
    return p;
  };

  hiddenOrder();

  // ---- Emit
  const out: ImportPlan["transactions"] = [];
  const schedules: ImportPlan["schedules"] = [];
  const txOfRow = new Map<number, number>();
  const perAccount = new Array<number>(nAccounts).fill(0);
  let splits = 0;
  let splitLines = 0;
  let paired = 0;
  const rowCategory = (r: RegRow, account: number) => {
    const c = catOfRow(r);
    if (!onBudget[account]) {
      if (c.category !== null || c.rta) {
        warn(
          "tracking_category_dropped",
          accountNames[account] as string,
          `Rows of the tracking account "${accountNames[account]}" have no category`,
        );
      }
      return { category: null, rta: false };
    }
    return c;
  };
  for (const e of entries) {
    const r = rows[e.first] as RegRow;
    const acct = r.account;
    if (e.split && onBudget[acct]) {
      splits++;
      splitLines += e.rows.length;
      const parentIx = out.length;
      const lineRows = e.rows.map((ri) => rows[ri] as RegRow);
      const firstPayee = lineRows[0]?.payee ?? "";
      const total = lineRows.reduce((s, x) => s + x.amount, 0);
      const pp = payeeOf(firstPayee);
      out.push({
        account: acct,
        date: r.date,
        payee: pp,
        payeeName: pp === null ? null : (payees[pp] as { name: string }).name,
        category: null,
        inflowToRta: false,
        memo: null,
        amount: total + 0,
        cleared: r.cleared,
        flag: r.flag,
        order: e.first,
        transfer: null,
        transferAccount: null,
        parent: null,
        splitIndex: null,
      });
      lineRows.forEach((x, k) => {
        const c = rowCategory(x, acct);
        if (isTransferPayee(x.payee) && x.payee !== firstPayee) {
          warn(
            "split_transfer_line",
            x.payee,
            `A split line with the payee "${x.payee}" stays a payee: no transfer is made`,
          );
        }
        const lp = x.payee === firstPayee ? null : payeeOf(x.payee);
        out.push({
          account: acct,
          date: x.date,
          payee: lp,
          payeeName: lp === null ? null : (payees[lp] as { name: string }).name,
          category: c.category,
          inflowToRta: c.rta,
          memo: x.memo.slice((SPLIT_PREFIX.exec(x.memo) as RegExpExecArray)[0].length) || null,
          amount: x.amount,
          cleared: x.cleared,
          flag: null,
          order: e.rows[k] as number,
          transfer: null,
          transferAccount: null,
          parent: parentIx,
          splitIndex: k,
        });
      });
      perAccount[acct] = (perAccount[acct] as number) + 1;
      continue;
    }
    if (e.split) {
      warn(
        "split_on_tracking",
        accountNames[acct] as string,
        `A split on the tracking account "${accountNames[acct]}" is imported as separate rows`,
      );
    }
    for (const ri of e.rows) {
      const x = rows[ri] as RegRow;
      const memoText = e.split
        ? x.memo.slice((SPLIT_PREFIX.exec(x.memo) as RegExpExecArray)[0].length)
        : x.memo;
      const partner = partnerOf.get(ri);
      if (partner === undefined && x.date > exportDate && !e.split) {
        const c = rowCategory(x, acct);
        schedules.push({
          account: acct,
          date: x.date,
          payee: payeeOf(x.payee),
          category: c.category,
          inflowToRta: c.rta,
          memo: memoText || null,
          amount: x.amount,
          flag: x.flag,
          order: ri,
        });
        if (isTransferPayee(x.payee)) {
          warn(
            "transfer_unpaired",
            x.payee,
            `A row with the payee "${x.payee}" has no matching row in the other account: it is a plain row`,
          );
        }
        continue;
      }
      if (x.date > exportDate) {
        warn(
          "scheduled_not_supported",
          e.split ? "split" : "transfer",
          "A split or a transfer dated after the export date is imported as a transaction, not as a schedule",
        );
      }
      let c = rowCategory(x, acct);
      let payee: number | null = null;
      let payeeName: string | null = null;
      let transferAccount: number | null = null;
      if (partner !== undefined) {
        const other = (rows[partner] as RegRow).account;
        transferAccount = other;
        payeeName = transferPayeeName(accountNames[other] as string);
        if (onBudget[acct] && onBudget[other]) c = { category: null, rta: false };
        if (ri < partner) paired++;
      } else {
        if (isTransferPayee(x.payee)) {
          warn(
            "transfer_unpaired",
            x.payee,
            `A row with the payee "${x.payee}" has no matching row in the other account: it is a plain row`,
          );
        }
        payee = payeeOf(x.payee);
        payeeName = payee === null ? null : (payees[payee] as { name: string }).name;
      }
      txOfRow.set(ri, out.length);
      out.push({
        account: acct,
        date: x.date,
        payee,
        payeeName,
        category: c.category,
        inflowToRta: c.rta,
        memo: memoText || null,
        amount: x.amount,
        cleared: x.cleared,
        flag: x.flag,
        order: ri,
        transfer: null,
        transferAccount,
        parent: null,
        splitIndex: null,
      });
      perAccount[acct] = (perAccount[acct] as number) + 1;
    }
  }
  for (const [ri, partner] of partnerOf) {
    const a = txOfRow.get(ri);
    const b = txOfRow.get(partner);
    if (a !== undefined && b !== undefined) (out[a] as { transfer: number | null }).transfer = b;
  }
  if (schedules.length > 0) {
    warn(
      "scheduled_frequency_unknown",
      "schedules",
      `${schedules.length} rows dated after the export date became one-time scheduled transactions; their repeat is not in the file`,
    );
  }
  // Every group gets its sort now: the visible ones in creation order, the hidden ones last.
  let sort = 0;
  const hiddenSet = new Set(hiddenGroups);
  groups.forEach((g) => {
    if (g.kind) g.sort = -1;
  });
  for (const g of groups) if (!g.kind && !hiddenSet.has(g.name)) g.sort = sort++;
  for (const gname of hiddenGroups)
    (groups[groupIx.get(gname) as number] as { sort: number }).sort = sort++;

  // ---- Assignments and plan rows (after every category exists)
  const assignments: ImportPlan["assignments"] = [];
  const planRows: ImportPlan["planRows"] = [];
  for (const c of planCells) {
    const cat = catOfPlan[c.cat] as number;
    if (c.assigned !== 0) assignments.push({ category: cat, month: c.month, assigned: c.assigned });
    planRows.push({ month: c.month, category: cat, activity: c.activity, available: c.available });
  }

  // ---- Account order: ties in (date, amount) between consecutive entries keep the export's rank order.
  const edges = new Set<string>();
  const seq: { account: number; date: string; amount: number; scheduled: boolean }[] = [];
  for (const e of entries) {
    const r = rows[e.first] as RegRow;
    if (e.split && !onBudget[r.account]) {
      for (const ri of e.rows) {
        const x = rows[ri] as RegRow;
        seq.push({
          account: x.account,
          date: x.date,
          amount: x.amount,
          scheduled: x.date > exportDate,
        });
      }
    } else {
      const total = e.rows.reduce((s, ri) => s + (rows[ri] as RegRow).amount, 0) + 0;
      seq.push({
        account: r.account,
        date: r.date,
        amount: total,
        scheduled: !e.split && r.date > exportDate && !partnerOf.has(e.first),
      });
    }
  }
  const succ: Set<number>[] = Array.from({ length: nAccounts }, () => new Set<number>());
  for (let i = 0; i + 1 < seq.length; i++) {
    const a = seq[i] as (typeof seq)[number];
    const b = seq[i + 1] as (typeof seq)[number];
    if (
      a.account !== b.account &&
      a.date === b.date &&
      a.amount === b.amount &&
      a.scheduled === b.scheduled
    ) {
      const key = `${a.account}>${b.account}`;
      if (!edges.has(key)) {
        edges.add(key);
        (succ[a.account] as Set<number>).add(b.account);
      }
    }
  }
  const indeg = new Array<number>(nAccounts).fill(0);
  for (const s of succ) for (const b of s) indeg[b] = (indeg[b] as number) + 1;
  const placed = new Array<boolean>(nAccounts).fill(false);
  const sortOf = new Array<number>(nAccounts).fill(0);
  for (let n = 0; n < nAccounts; n++) {
    let pick = -1;
    for (let a = 0; a < nAccounts; a++) {
      if (!placed[a] && indeg[a] === 0) {
        pick = a;
        break;
      }
    }
    if (pick < 0) pick = placed.findIndex((p) => !p);
    placed[pick] = true;
    sortOf[pick] = n;
    for (const b of succ[pick] as Set<number>) indeg[b] = (indeg[b] as number) - 1;
  }

  // ---- Formats
  const f = fmt ?? fallback;
  const cf = options.currency_format ?? {};
  const formats: ImportFormats = {
    delimiter: (input.delimiter === "\t" ? "tab" : "comma") as "tab" | "comma",
    currency_symbol: cf.currency_symbol ?? (f as ParsedAmount | null)?.symbol ?? "",
    symbol_placement: cf.symbol_placement ?? (f as ParsedAmount | null)?.placement ?? "none",
    decimal_separator:
      cf.decimal_separator ?? decimal ?? (f as ParsedAmount | null)?.separator ?? ".",
    decimal_digits: cf.decimal_digits ?? (f as ParsedAmount | null)?.digits ?? 2,
    date_format: dateFormat,
  };

  const kept = [...warnings.values()];
  const firstMonth = months[0] ?? null;
  return {
    name,
    exportDate,
    firstMonth,
    months,
    formats,
    dateQuestion,
    fileNames: { plan: input.plan.name, register: input.register.name },
    accounts: accountNames.map((nm, a) => ({
      name: nm,
      type: types[a] as ImportAccountType,
      proposedType: proposed[a] as ImportAccountType,
      reason: reasons[a] as string,
      onBudget: onBudget[a] as boolean,
      sort: sortOf[a] as number,
      transactions: perAccount[a] as number,
    })),
    groups,
    categories,
    assignments,
    payees,
    transactions: out,
    schedules,
    planRows,
    warnings: kept.slice(0, IMPORT_LIMITS.warnings),
    warningCount: kept.length,
    counts: {
      accounts: nAccounts,
      groups: groups.length,
      categories: categories.length,
      payees: payees.length,
      months: months.length,
      assignments: assignments.length,
      transactions: out.length - splitLines,
      splits,
      split_lines: splitLines,
      transfers_paired: paired,
      scheduled: schedules.length,
    },
  };
}
