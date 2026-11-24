import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  autoMap,
  buildFileRows,
  columnLabels,
  detectDateFormat,
  FILE_DATE_FORMATS,
  FILE_IMPORT_COPY,
  FileImportOptions,
  FileImportPreview,
  FileImportResult,
  MAX_FILE_BYTES,
  MAX_FILE_ROWS,
  parseFileDate,
} from "../src/file-import";
import { readCsv, readFileText, readOfx, readQif } from "../src/file-import-read";

const fx = (n: string) =>
  readFileSync(join(import.meta.dirname, "fixtures/file-import", n), "utf8");
const sha256 = async (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const ctx = {
  today: "2026-11-24",
  cutoff: { start: null, reconciled: null, importStart: null } as {
    start: string | null;
    reconciled: string | null;
    importStart: string | null;
  },
  accountId: "acc-1",
  planFormat: "MM/DD/YYYY" as const,
};
const opts = (o: Record<string, unknown> = {}) =>
  FileImportOptions.parse({ today: "2026-11-24", ...o });
const MAP5 = { date: 0, payee: 1, memo: 2, outflow: 3, inflow: 4 };

const csv = (text: string, o: Record<string, unknown> = {}, c: Partial<typeof ctx> = {}) =>
  buildFileRows({ format: "csv", ...readCsv(text, ",") }, opts(o), { ...ctx, ...c }, sha256);
const file = (name: string, o: Record<string, unknown> = {}, c: Partial<typeof ctx> = {}) =>
  buildFileRows(readFileText(name, fx(name)), opts(o), { ...ctx, ...c }, sha256);
const brief = (r: {
  date: string | null;
  payee_text: string;
  memo: string | null;
  amount: number | null;
  skip: string | null;
}) => [r.date, r.payee_text, r.memo, r.amount, r.skip];

describe("AC1 the EXF-531 sample", () => {
  it("EXF-531 sample: readCsv and autoMap map Date, Payee, Memo, Outflow, Inflow to 0-4", () => {
    const { cells } = readCsv(fx("sample.csv"), ",");
    expect(autoMap(columnLabels(cells[0] ?? [], false))).toEqual({
      date: 0,
      payee: 1,
      memo: 2,
      outflow: 3,
      inflow: 4,
    });
  });

  it("EXF-531 sample: two rows with signed milliunits in plan format MM/DD/YYYY", async () => {
    const r = await file("sample.csv");
    expect(r.rows.map(brief)).toEqual([
      ["2026-11-10", "Sample Cafe", "latte", -4500, null],
      ["2026-11-12", "Sample Payroll", "salary", 250000, null],
    ]);
    expect(r.rows.map((x) => x.line)).toEqual([2, 3]);
    expect(r.dateQuestion).toBeNull();
    expect(r.dateFormat).toBe("MM/DD/YYYY");
  });
});

describe("AC2 swap", () => {
  it("swap_inflow_outflow negates both amounts", async () => {
    const r = await file("sample.csv", { swap_inflow_outflow: true });
    expect(r.rows.map((x) => x.amount)).toEqual([4500, -250000]);
  });
});

describe("AC3 no header row", () => {
  it("no_header: labels are A-E and the date format is a question whose first_value is Date", async () => {
    const { cells } = readCsv(fx("sample.csv"), ",");
    expect(columnLabels(cells[0] ?? [], true)).toEqual(["A", "B", "C", "D", "E"]);
    expect(detectDateFormat(["Date", "11/10/2026", "11/12/2026"], "MM/DD/YYYY")).toEqual({
      format: null,
      question: { first_value: "Date", formats: FILE_DATE_FORMATS },
    });
    const r = await file("sample.csv", { no_header: true, mapping: MAP5 });
    expect(r.dateQuestion?.first_value).toBe("Date");
    expect(r.dateFormat).toBeNull();
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((x) => x.key === null)).toBe(true);
    expect(r.skippedBefore).toBe(0);
  });

  it("no_header with date_format MM/DD/YYYY: the header row is invalid and two rows remain", async () => {
    const r = await file("sample.csv", {
      no_header: true,
      mapping: MAP5,
      date_format: "MM/DD/YYYY",
    });
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((x) => [x.line, x.skip])).toEqual([
      [1, "invalid"],
      [2, null],
      [3, null],
    ]);
    expect(r.rows.slice(1).map(brief)).toEqual([
      ["2026-11-10", "Sample Cafe", "latte", -4500, null],
      ["2026-11-12", "Sample Payroll", "salary", 250000, null],
    ]);
    expect(r.dateQuestion).toBeNull();
  });
});

describe("AC4 the 13 date formats", () => {
  it("FILE_DATE_FORMATS has the 13 formats of EXF-531 in order", () => {
    expect([...FILE_DATE_FORMATS]).toEqual([
      "MM/DD/YYYY",
      "DD/MM/YYYY",
      "DD/MMM/YYYY",
      "DD/MMMM/YYYY",
      "YYYY/MM/DD",
      "YYYY/DD/MM",
      "MM-DD-YYYY",
      "DD-MM-YY",
      "DD-MM-YYYY",
      "YYYY-MM-DD",
      "DD.MM.YYYY",
      "YYYY.MM.DD",
      "MM/DD'YYYY",
    ]);
  });

  it.each([
    ["MM/DD/YYYY", "11/10/2026", "02/31/2026"],
    ["DD/MM/YYYY", "10/11/2026", "31/02/2026"],
    ["DD/MMM/YYYY", "10/Nov/2026", "31/Feb/2026"],
    ["DD/MMMM/YYYY", "10/November/2026", "31/February/2026"],
    ["YYYY/MM/DD", "2026/11/10", "2026/02/31"],
    ["YYYY/DD/MM", "2026/10/11", "2026/31/02"],
    ["MM-DD-YYYY", "11-10-2026", "02-31-2026"],
    ["DD-MM-YY", "10-11-26", "31-02-26"],
    ["DD-MM-YYYY", "10-11-2026", "31-02-2026"],
    ["YYYY-MM-DD", "2026-11-10", "2026-02-31"],
    ["DD.MM.YYYY", "10.11.2026", "31.02.2026"],
    ["YYYY.MM.DD", "2026.11.10", "2026.02.31"],
    ["MM/DD'YYYY", "11/10'2026", "02/31'2026"],
  ] as const)("%s parses its sample and refuses 31 February", (fmt, sample, impossible) => {
    expect(parseFileDate(sample, fmt)).toBe("2026-11-10");
    expect(parseFileDate(impossible, fmt)).toBeNull();
  });

  it("month names are English and case-insensitive", () => {
    expect(parseFileDate("10/nov/2026", "DD/MMM/YYYY")).toBe("2026-11-10");
    expect(parseFileDate("10/NOVEMBER/2026", "DD/MMMM/YYYY")).toBe("2026-11-10");
    expect(parseFileDate("10/Nox/2026", "DD/MMM/YYYY")).toBeNull();
  });

  it("detectDateFormat uses the plan format when every cell parses, else the only format, else asks", () => {
    expect(detectDateFormat(["11/10/2026"], "DD/MM/YYYY")).toEqual({
      format: "DD/MM/YYYY",
      question: null,
    });
    expect(detectDateFormat(["2026-11-10"], "MM/DD/YYYY")).toEqual({
      format: "YYYY-MM-DD",
      question: null,
    });
    const q = detectDateFormat(["11/10/2026"], "YYYY-MM-DD");
    expect(q.format).toBeNull();
    expect(q.question?.first_value).toBe("11/10/2026");
  });
});

describe("AC5 cutoff", () => {
  const cut = { start: "2026-11-11", reconciled: null, importStart: null };

  it("cutoff.start 2026-11-11: the 11/10 row is before_start and counted", async () => {
    const r = await file("sample.csv", {}, { cutoff: cut });
    expect(r.rows.map((x) => x.skip)).toEqual(["before_start", null]);
    expect(r.skippedBefore).toBe(1);
  });

  it("include_before_start: the 11/10 row is not skipped and the count stays", async () => {
    const base = await file("sample.csv", {}, { cutoff: cut });
    const r = await file("sample.csv", { include_before_start: true }, { cutoff: cut });
    expect(r.rows.map((x) => x.skip)).toEqual([null, null]);
    expect(r.skippedBefore).toBe(1);
    expect(r.rows.map((x) => x.key)).toEqual(base.rows.map((x) => x.key));
  });

  it("the reconciled grace and importStart follow skipReason", async () => {
    const rec = await file(
      "sample.csv",
      {},
      { cutoff: { start: null, reconciled: "2026-11-14", importStart: null } },
    );
    expect(rec.rows.map((x) => x.skip)).toEqual(["before_reconciled", null]);
    const imp = await file(
      "sample.csv",
      {},
      { cutoff: { start: null, reconciled: null, importStart: "2026-11-11" } },
    );
    expect(imp.rows.map((x) => x.skip)).toEqual(["before_start", null]);
  });
});

describe("AC6 future dates", () => {
  it("a row dated after today takes today", async () => {
    const r = await file("sample.csv", {}, { today: "2026-11-11" });
    expect(r.rows[1]?.date).toBe("2026-11-11");
    expect(r.rows[0]?.date).toBe("2026-11-10");
    expect(r.rows[1]?.key).toContain(":2026-11-12:");
  });
});

describe("AC7 readers and options", () => {
  it("OFX SGML rows without mapping", async () => {
    const r = await file("sgml.ofx");
    expect(r.rows.map((x) => [x.date, x.payee_text, x.memo, x.amount, x.fitid, x.skip])).toEqual([
      ["2026-11-10", "Sample Cafe", "latte", -4500, "ZZ1001", null],
      ["2026-11-12", "Sample Bread & Co", "salary", 250000, "ZZ1002", null],
      ["2026-11-13", "Sample Cafe", "latte again", -4500, "ZZ1001", "duplicate_in_file"],
    ]);
  });

  it("OFX XML rows without mapping", async () => {
    const r = await file("xml.ofx");
    expect(r.rows.map((x) => [x.date, x.payee_text, x.memo, x.amount, x.fitid])).toEqual([
      ["2026-11-10", "Sample Grocer", "weekly", -12340, "ZZ2001"],
      ["2026-11-11", "Sample Refund", null, 5000, null],
    ]);
  });

  it("QFX rows without mapping", async () => {
    const r = await file("sample.qfx");
    expect(r.rows.map((x) => [x.date, x.payee_text, x.memo, x.amount, x.fitid])).toEqual([
      ["2026-11-14", "SAMPLE DINER", "lunch", -7250, "ZZ3001"],
      ["2026-11-16", "Sample Transfer In", null, 100000, "ZZ3002"],
    ]);
  });

  it("QIF rows without mapping", async () => {
    // The 2026-12-01 row is in the future of the default `today`, so this test looks from a later day.
    const r = await file("sample.qif", {}, { today: "2026-12-31" });
    expect(r.rows.map((x) => [x.date, x.payee_text, x.memo, x.amount])).toEqual([
      ["2026-11-10", "Sample Cafe", "latte", -4500],
      ["2026-11-12", "Sample Payroll", "salary", 250000],
      ["2026-12-01", "Sample Rent", null, -1020000],
    ]);
    expect(r.rows.every((x) => x.fitid === null)).toBe(true);
    expect(r.dateFormat).toBe("MM/DD'YYYY");
    expect(r.dateQuestion).toBeNull();
  });

  it("import_memos false empties the memos and keeps the keys", async () => {
    for (const name of ["sgml.ofx", "sample.qif"]) {
      const on = await file(name);
      const off = await file(name, { import_memos: false });
      expect(off.rows.every((x) => x.memo === null)).toBe(true);
      expect(off.rows.map((x) => x.key)).toEqual(on.rows.map((x) => x.key));
    }
  });

  it("swap_payee_memo swaps payee and memo", async () => {
    const a = await file("sgml.ofx", { swap_payee_memo: true });
    expect(a.rows[0]?.payee_text).toBe("latte");
    expect(a.rows[0]?.memo).toBe("Sample Cafe");
    const b = await file("xml.ofx", { swap_payee_memo: true });
    expect(b.rows[1]?.payee_text).toBe("");
    expect(b.rows[1]?.memo).toBe("Sample Refund");
  });

  it("OFX keys use fitid and a repeated FITID is duplicate_in_file", async () => {
    const r = await file("sgml.ofx");
    expect(r.rows[0]?.key).toBe("file:v1:acc-1:fitid:ZZ1001");
    expect(r.rows[2]?.key).toBe("file:v1:acc-1:fitid:ZZ1001");
    expect(r.rows[2]?.skip).toBe("duplicate_in_file");
    const x = await file("xml.ofx");
    expect(x.rows[1]?.key).toMatch(/^file:v1:acc-1:2026-11-11:5000:[0-9a-f]{16}:1$/);
  });
});

describe("AC8 keys", () => {
  it("the same file read twice gives the same keys", async () => {
    const a = await file("sample.csv");
    const b = await file("sample.csv");
    expect(a.rows.map((x) => x.key)).toEqual(b.rows.map((x) => x.key));
    expect(a.rows.every((x) => x.key !== null)).toBe(true);
  });

  it("two identical rows get :1 and :2", async () => {
    const text =
      "Date,Payee,Memo,Outflow,Inflow\n11/10/2026,Sample Cafe,latte,4.50,\n11/10/2026,Sample Cafe,latte,4.50,\n";
    const r = await csv(text);
    const [k1, k2] = r.rows.map((x) => x.key ?? "");
    const h = (await sha256("sample cafe\u0000latte")).slice(0, 16);
    expect(k1).toBe(`file:v1:acc-1:2026-11-10:-4500:${h}:1`);
    expect(k2).toBe(`file:v1:acc-1:2026-11-10:-4500:${h}:2`);
  });

  it("reordering other rows changes no key", async () => {
    const a = await file("three-rows.csv");
    const reordered =
      "Date,Payee,Memo,Outflow,Inflow\n11/15/2026,Sample Corner Market,,20.00,\n11/10/2026,Sample Cafe,latte,4.50,\n11/12/2026,Sample Payroll,salary,,250.00\n";
    const b = await csv(reordered);
    const byPayee = (rows: { payee_text: string; key: string | null }[]) =>
      Object.fromEntries(rows.map((x) => [x.payee_text, x.key]));
    expect(byPayee(b.rows)).toEqual(byPayee(a.rows));
  });
});

describe("extras", () => {
  it("autoMap is case-insensitive and trimmed", () => {
    expect(autoMap([" date ", "PAYEE", "x"])).toEqual({
      date: 0,
      payee: 1,
      memo: null,
      outflow: null,
      inflow: null,
    });
  });

  it("columnLabels goes past Z", () => {
    const labels = columnLabels(new Array<string>(27).fill(""), true);
    expect(labels[25]).toBe("Z");
    expect(labels[26]).toBe("AA");
  });

  it("TSV with outflow and inflow on one column is a signed amount", async () => {
    const r = await file("sample.tsv", {
      mapping: { date: 0, payee: 1, memo: 2, outflow: 3, inflow: 3 },
    });
    expect(r.rows.map((x) => x.amount)).toEqual([-4500, 250000]);
    expect(r.dateFormat).toBe("YYYY-MM-DD");
  });

  it("a two-column outflow written negative is still an outflow", async () => {
    const r = await csv("Date,Payee,Memo,Outflow,Inflow\n11/10/2026,Sample Cafe,latte,-4.50,\n");
    expect(r.rows[0]?.amount).toBe(-4500);
  });

  it("an amount with a leading decimal point is read as written, not 100 times too large", async () => {
    const o = await csv(
      "Date,Payee,Memo,Outflow,Inflow\n11/10/2026,Sample Cafe,,.50,\n11/11/2026,Sample Cafe,,,$.99\n",
    );
    expect(o.rows.map((x) => x.amount)).toEqual([-500, 990]);
    const ofx = readOfx(
      "<OFX><STMTTRN><DTPOSTED>20261110<TRNAMT>-.50<FITID>ZZ9<NAME>Sample Cafe</STMTTRN><STMTTRN><DTPOSTED>20261111<TRNAMT>.99<FITID>ZZ10<NAME>Sample Cafe</STMTTRN></OFX>",
    );
    expect(ofx.entries.map((e) => e.amount)).toEqual([-500, 990]);
    expect(
      readQif("!Type:Bank\nD11/10'26\nT-.50\n^\nD11/11'26\nT.99\n^\n").entries.map((e) => e.amount),
    ).toEqual([-500, 990]);
  });

  it("an unparseable amount is invalid", async () => {
    const r = await csv("Date,Payee,Memo,Outflow,Inflow\n11/10/2026,Sample Cafe,latte,abc,\n");
    expect(r.rows[0]?.skip).toBe("invalid");
    expect(r.rows[0]?.amount).toBeNull();
    expect(r.rows[0]?.key).toBeNull();
  });

  it("FileImportOptions defaults", () => {
    expect(FileImportOptions.parse({ today: "2026-11-24" })).toEqual({
      no_header: false,
      mapping: null,
      date_format: null,
      swap_inflow_outflow: false,
      import_memos: true,
      swap_payee_memo: false,
      include_before_start: false,
      remember: true,
      today: "2026-11-24",
    });
    expect(FileImportOptions.safeParse({}).success).toBe(false);
    expect(FileImportResult.parse({ imported: 2, matched: 1, skipped: 0 })).toEqual({
      imported: 2,
      matched: 1,
      skipped: 0,
    });
    expect(FileImportPreview).toBeDefined();
  });

  it("copy never names the source app and asks to match the field", () => {
    expect(FILE_IMPORT_COPY.mappingHelp).toBe("Choose the CSV column to match the field.");
    const source = new RegExp(["y", "nab"].join(""), "i");
    const c = FILE_IMPORT_COPY;
    const text = [
      JSON.stringify(c),
      c.header(2, "a.csv"),
      c.unclearDate("a.csv", "11/10/2026"),
      c.willSkip(1),
      c.include(2),
      c.successMessage(2, 1),
      c.matchedMessage(3),
    ].join("\n");
    expect(text).not.toMatch(source);
    expect(c.header(1, "a.csv")).toBe("1 Transaction from a.csv will be imported into");
    expect(c.header(2, "a.csv")).toBe("2 Transactions from a.csv will be imported into");
    expect(c.unclearDate("a.csv", "11/10/2026")).toBe(
      "The date format of a.csv is unclear. The first transaction reads 11/10/2026. What date is this?",
    );
    expect(c.willSkip(1)).toBe("1 transaction will be skipped");
    expect(c.willSkip(3)).toBe("3 transactions will be skipped");
    expect(c.include(1)).toBe(
      "Include 1 transaction dated before account start date or last reconciliation",
    );
    expect(c.successMessage(2, 1)).toBe(
      "2 transactions have been successfully imported. 1 previously imported transaction has been matched.",
    );
    expect(c.matchedMessage(3)).toBe(
      "3 transactions have been successfully imported. All transactions were matched to already entered or imported transactions, so there's nothing else for you to do!",
    );
  });

  it("MAX_FILE_ROWS and MAX_FILE_BYTES", () => {
    expect(MAX_FILE_ROWS).toBe(2000);
    expect(MAX_FILE_BYTES).toBe(2_000_000);
  });
});
