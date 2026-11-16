import type { BankEnvironment } from "@budget/schema/budgets";
import type { Institution } from "@budget/schema/institutions";

/** Ids verified against Plaid's API on 2026-11-16 (institution ids are shared by Sandbox and Production). */
export const POPULAR_INSTITUTIONS: Record<BankEnvironment, string[]> = {
  sandbox: ["ins_109508", "ins_109509", "ins_109510", "ins_109511", "ins_109512"],
  production: [
    "ins_56",
    "ins_127989",
    "ins_127991",
    "ins_5",
    "ins_128026",
    "ins_10",
    "ins_33",
    "ins_25",
    "ins_7",
    "ins_127990",
  ],
};

export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  IE: "Ireland",
  FR: "France",
  ES: "Spain",
  NL: "Netherlands",
  DE: "Germany",
  IT: "Italy",
  PL: "Poland",
  DK: "Denmark",
  NO: "Norway",
  SE: "Sweden",
  EE: "Estonia",
  LT: "Lithuania",
  LV: "Latvia",
  PT: "Portugal",
  BE: "Belgium",
};

export interface PlaidInstitution {
  institution_id: string;
  name: string;
  country_codes?: string[];
  url?: string | null;
  logo?: string | null;
}

export function toInstitution(i: PlaidInstitution): Institution {
  const cc = i.country_codes?.[0];
  return {
    institution_id: i.institution_id,
    name: i.name,
    country: (cc && COUNTRY_NAMES[cc]) ?? cc ?? "",
    url: i.url ?? null,
    logo: i.logo ? `data:image/png;base64,${i.logo}` : null,
  };
}
