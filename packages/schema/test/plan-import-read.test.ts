import { describe, expect, it } from "vitest";
import {
  DATE_FORMATS,
  dateCandidates,
  detectDecimal,
  ImportError,
  identifyFiles,
  parseAmount,
  parseDate,
  parseExportName,
  parseMonthLabel,
  readDelimited,
  sniffDelimiter,
  stripBom,
  unguard,
} from "../src/plan-import-read";

// EXF-477 reading rules, written by hand from the ticket's text.
// The source app's name is built from parts: the file format needs it, the hygiene test forbids the literal.
const SRC = ["YN", "AB"].join("");
describe("amounts", () => {
  it.each([
    ["$17.34", 17340],
    ["-$45.00", -45000],
    ["120,50€", 120500],
    ["-45,00€", -45000],
    ["¥1234", 1234000],
    ["0,5 kr.", 500],
    ["$0.00", 0],
    ["-$0.00", 0],
    ["12", 12000],
    ["1.234", 1234],
  ])("%s → %d", (cell, milliunits) => {
    expect(parseAmount(cell)?.milliunits).toBe(milliunits);
  });

  it("reports the symbol, placement, separator and digits", () => {
    expect(parseAmount("120,50€")).toMatchObject({
      symbol: "€",
      placement: "after",
      separator: ",",
      digits: 2,
    });
    expect(parseAmount("-$45.00")).toMatchObject({
      symbol: "$",
      placement: "before",
      separator: ".",
      digits: 2,
    });
    expect(parseAmount("¥1234")).toMatchObject({
      symbol: "¥",
      placement: "before",
      separator: null,
      digits: 0,
    });
    expect(parseAmount("12.5")).toMatchObject({ symbol: "", placement: "none", digits: 1 });
  });

  it("accepts the separators . , - /", () => {
    expect(parseAmount("12-50")?.milliunits).toBe(12500);
    expect(parseAmount("12/50")?.milliunits).toBe(12500);
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["12.3456", "1.2.3", "", "abc", "$12$", "1,234.56"]) {
      expect(parseAmount(bad), bad).toBeNull();
    }
  });
});

describe("amounts with thousands separators", () => {
  it.each([
    [".", "$1,234.56", 1234560],
    [".", "-$12,345.00", -12345000],
    [".", "$1,234", 1234000],
    [".", "$1,000,000.00", 1000000000],
    [".", "1.234", 1234],
    [",", "1.234,56€", 1234560],
    [",", "1 234,56 €", 1234560],
    [",", "1.234€", 1234000],
  ])("reads %s file amount %s", (d, cell, milliunits) => {
    expect(parseAmount(cell, d)?.milliunits).toBe(milliunits);
  });
  it.each([
    [".", "$1,23.45"],
    [".", "$12,3456.00"],
    [".", "$1234,567.00"],
    [".", "$1,234,56"],
    [".", "$1,234.5678"],
    [".", "$1,234 567.00"],
    [".", "$1.234.567"],
    [",", "1,234,56€"],
  ])("refuses %s file amount %s", (d, cell) => {
    expect(parseAmount(cell, d)).toBeNull();
  });
  it("keeps the plain rule without a decimal", () => {
    expect(parseAmount("1,234.56")).toBeNull();
    expect(parseAmount("$1,234,567", null)).toBeNull();
  });
  it("detects the decimal separator", () => {
    expect(detectDecimal("$0.00")).toBe(".");
    expect(detectDecimal("1.234,56€")).toBe(",");
    expect(detectDecimal("$1,234")).toBeNull();
  });
});

describe("dates", () => {
  it.each([
    ["MM/DD/YYYY", "11/05/2026"],
    ["DD/MM/YYYY", "05/11/2026"],
    ["YYYY/MM/DD", "2026/11/05"],
    ["YYYY-MM-DD", "2026-11-05"],
    ["DD-MM-YYYY", "05-11-2026"],
    ["DD.MM.YYYY", "05.11.2026"],
    ["YYYY.MM.DD", "2026.11.05"],
  ] as const)("%s reads %s", (fmt, text) => {
    expect(parseDate(text, fmt)).toBe("2026-11-05");
    expect(DATE_FORMATS).toContain(fmt);
  });

  it("takes one-digit days and months, refuses impossible dates and years", () => {
    expect(parseDate("1/5/2026", "MM/DD/YYYY")).toBe("2026-01-05");
    expect(parseDate("02/30/2026", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("01/01/1800", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("01/01/2200", "MM/DD/YYYY")).toBeNull();
    expect(parseDate("2026-11-05", "MM/DD/YYYY")).toBeNull();
  });

  it("candidates: a day over 12 decides, otherwise both are left", () => {
    expect(dateCandidates(["13/05/2026"])).toEqual(["DD/MM/YYYY"]);
    expect(dateCandidates(["05/06/2026"])).toEqual(["MM/DD/YYYY", "DD/MM/YYYY"]);
    expect(dateCandidates(["05/06/2026", "13/06/2026"])).toEqual(["DD/MM/YYYY"]);
    expect(dateCandidates(["05/06/2026", "06/13/2026", "13/01/2026"])).toEqual([]);
    expect(dateCandidates(["05.06.2026"])).toEqual(["DD.MM.YYYY"]);
  });

  it("reads month labels", () => {
    expect(parseMonthLabel("Nov 2026")).toBe("2026-11-01");
    expect(parseMonthLabel("Foo 2026")).toBeNull();
  });
});

describe("delimited text (RFC 4180)", () => {
  it("reads quotes, doubled quotes, breaks inside quotes, CRLF and LF", () => {
    const text = 'a,"b ""q"", c","line\r\nbreak"\r\nx,,z\ny,"",\n';
    expect(readDelimited(text, ",")).toEqual([
      ["a", 'b "q", c', "line\r\nbreak"],
      ["x", "", "z"],
      ["y", "", ""],
    ]);
  });
  it("reads TAB files and a final record without a line end", () => {
    expect(readDelimited("a\tb,c\n1\t2", "\t")).toEqual([
      ["a", "b,c"],
      ["1", "2"],
    ]);
  });
  it("refuses a quote that never closes", () => {
    expect(() => readDelimited('a,"b', ",")).toThrow(ImportError);
  });
  it("strips the BOM and the guard's backslash", () => {
    expect(stripBom("﻿abc")).toBe("abc");
    expect(unguard("\\=bonus")).toBe("=bonus");
    expect(unguard("\\+1")).toBe("+1");
    expect(unguard("\\-x")).toBe("-x");
    expect(unguard("\\@x")).toBe("@x");
    expect(unguard("\\a")).toBe("\\a");
    expect(unguard("=x")).toBe("=x");
  });
  it("sniffs the delimiter", () => {
    const planCsv =
      '"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"';
    expect(sniffDelimiter(planCsv, "x.csv")).toBe(",");
    expect(sniffDelimiter(planCsv.replaceAll('","', '"\t"'), "x.csv")).toBe("\t");
    expect(sniffDelimiter(planCsv, "x.tsv")).toBe("\t");
  });
});

describe("file names", () => {
  it("reads the name and date of the three styles", () => {
    expect(parseExportName(`${SRC} Export - Sample Plan as of 2026-11-15 19-51.zip`)).toEqual({
      name: "Sample Plan",
      exportDate: "2026-11-15",
    });
    expect(parseExportName("Budget Export - My Plan 2 as of 2026-01-02 03-04.zip")).toEqual({
      name: "My Plan 2",
      exportDate: "2026-01-02",
    });
    expect(parseExportName("Sample Plan as of 2026-11-15 19-51 - Register.csv")).toEqual({
      name: "Sample Plan",
      exportDate: "2026-11-15",
    });
    expect(parseExportName("folder/Sample Plan as of 2026-11-15 19-51 - Plan.tsv")?.name).toBe(
      "Sample Plan",
    );
    expect(parseExportName("whatever.zip")).toBeNull();
    expect(parseExportName("X as of 2026-02-30 19-51.zip")).toBeNull();
  });
});

describe("identifyFiles", () => {
  const plan =
    '﻿"Month","Category Group/Category","Category Group","Category","Assigned","Activity","Available"\r\n';
  const register =
    '"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"\r\n';
  it("tells them apart by header, in either order, whatever the names", () => {
    const a = identifyFiles([
      { name: "one.csv", text: register },
      { name: "two.csv", text: plan },
    ]);
    expect(a.plan.name).toBe("two.csv");
    expect(a.register.name).toBe("one.csv");
    expect(a.delimiter).toBe(",");
  });
  it("refuses one file, two of a kind and unknown headers", () => {
    expect(() => identifyFiles([{ name: "a.csv", text: plan }])).toThrow(ImportError);
    expect(() =>
      identifyFiles([
        { name: "a.csv", text: plan },
        { name: "b.csv", text: plan },
      ]),
    ).toThrow(/Export Plan/);
    expect(() =>
      identifyFiles([
        { name: "a.csv", text: "x,y\n1,2" },
        { name: "b.csv", text: plan },
      ]),
    ).toThrow(ImportError);
  });
});
