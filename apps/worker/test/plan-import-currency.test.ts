import { formatsFromImport } from "@budget/schema/plan-formats-catalogue";
import { describe, expect, it } from "vitest";
import { q } from "./bulk-helpers";
import { pinPlanClock } from "./plan-export-helpers";
import { body, importForm, postImport, SAMPLE_ZIP_NAME, sampleZip } from "./plan-import-helpers";

// EXF-877 point 5: the person's choice of the plan's currency (`currency_format.iso_code`).
pinPlanClock();

const FILE_FORMATS = {
  currency_symbol: "Ƶ",
  symbol_placement: "before" as const,
  decimal_separator: ".",
  decimal_digits: 2,
  date_format: "MM/DD/YYYY" as const,
};

describe("the currency of an import", () => {
  it("an unknown symbol takes the first currency with the same digits; iso_code overrides it", () => {
    expect(formatsFromImport(FILE_FORMATS).iso_code).toBe("USD");
    expect(formatsFromImport({ ...FILE_FORMATS, iso_code: "EUR" }).iso_code).toBe("EUR");
    // A code outside the catalogue is ignored, not stored.
    expect(formatsFromImport({ ...FILE_FORMATS, iso_code: "ZZZ" }).iso_code).toBe("USD");
  });

  it("the dry run echoes the choice and the import stores it", async () => {
    const zip = await sampleZip();
    const files = [{ name: SAMPLE_ZIP_NAME, data: zip }];
    const choice = { currency_format: JSON.stringify({ iso_code: "CAD" }) };
    const preview = await body(await postImport(importForm(files, choice), "?dry_run=true"), 200);
    expect(preview.formats.iso_code).toBe("CAD");
    const data = await body(await postImport(importForm(files, choice)), 201);
    const [row] = await q("select currency_iso_code from budgets where id = ?", data.budget_id);
    expect(row?.currency_iso_code).toBe("CAD");
  });
});
