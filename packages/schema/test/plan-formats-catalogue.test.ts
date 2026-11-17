import { describe, expect, it } from "vitest";
import {
  COMMON_CURRENCY_CODES,
  CURRENCIES,
  currencyByCode,
  currencyFormatOf,
  DATE_FORMAT_OPTIONS,
  formatsFromImport,
  NUMBER_FORMATS,
  numberFormatParts,
  placementOf,
} from "../src/plan-formats-catalogue";
import { DATE_FORMATS } from "../src/plan-import-read";

// The ticket's list of "All Currencies", in its order.
const TICKET_LABELS = [
  "Albanian Lek–ALL",
  "Algerian Dinar–DZD",
  "Angolan Kwanza–AOA",
  "Argentine Peso–ARS",
  "Armenian Dram–AMD",
  "Aruban Florin–AWG",
  "Australian Dollar–AUD",
  "Azerbaijanian Manat–AZN",
  "Bahamian Dollar–BSD",
  "Bahraini Dinar–BHD",
  "Bangladeshi Taka–BDT",
  "Barbadian Dollar–BBD",
  "Belarusian Ruble–BYN",
  "Belize Dollar–BZD",
  "Boliviano–BOB",
  "Bosnian Convertible Mark–BAM",
  "Botswana Pula–BWP",
  "Brazilian Real–BRL",
  "Brunei Dollar–BND",
  "Bulgarian Lev–BGN",
  "Cambodian Riel–KHR",
  "Canadian Dollar–CAD",
  "Cape Verdean Escudo–CVE",
  "Caribbean Guilder–XCG",
  "Cayman Islands Dollar–KYD",
  "Central African CFA Franc–XAF",
  "CFP Franc–XPF",
  "Chilean Peso–CLP",
  "Chinese Renminbi (Yuan)–CNY",
  "Colombian Peso–COP",
  "Costa Rican Colon–CRC",
  "Croatian Kuna–HRK",
  "Czech Koruna–CZK",
  "Danish Krone–DKK",
  "Djiboutian Franc–DJF",
  "Dominican Peso–DOP",
  "Eastern Caribbean Dollar–XCD",
  "Egyptian Pound–EGP",
  "Estonian Kroon–EEK",
  "Ethiopian Birr–ETB",
  "Euro–EUR",
  "Fijian Dollar–FJD",
  "Gambian Dalasi–GMD",
  "Georgian Lari–GEL",
  "Ghanaian Cedi–GHS",
  "Guatemalan Quetzal–GTQ",
  "Guyanese Dollar–GYD",
  "Haitian Gourde–HTG",
  "Honduran Lempira–HNL",
  "Hong Kong Dollar–HKD",
  "Hungarian Forint–HUF",
  "Icelandic Krona–ISK",
  "Indian Rupee–INR",
  "Indonesian Rupiah–IDR",
  "Iranian Rial–IRR",
  "Iraqi Dinar–IQD",
  "Israeli New Shekel–ILS",
  "Jamaican Dollar–JMD",
  "Japanese Yen–JPY",
  "Jordanian Dinar–JOD",
  "Kazakhstani Tenge–KZT",
  "Kenyan Shilling–KES",
  "Korean Won–KRW",
  "Kuwaiti Dinar–KWD",
  "Kyat–MMR",
  "Kyrgyzstani Som–KGS",
  "Lao Kip–LAK",
  "Lebanese Pound–LBP",
  "Liberian Dollar–LRD",
  "Libyan Dinar–LYD",
  "Macao Pataca–MOP",
  "Macedonian Denar–MKD",
  "Malagasy Ariary–MGA",
  "Malawi Kwacha–MWK",
  "Malaysian Ringgit–MYR",
  "Maldivian Rufiyaa–MVR",
  "Maltese Lira–MTL",
  "Mauritian Rupee–MUR",
  "Mexican Peso–MXN",
  "Moldovan Leu–MDL",
  "Mongolian Tugrik–MNT",
  "Moroccan Dirham–MAD",
  "Mozambican Metical–MZN",
  "Nepalese Rupee–NPR",
  "New Taiwan Dollar–TWD",
  "New Zealand Dollar–NZD",
  "Nicaraguan Cordoba Oro–NIO",
  "Nigerian Naira–NGN",
  "Norwegian Krone–NOK",
  "Omani Rial–OMR",
  "Pakistan Rupee–PKR",
  "Panamanian Balboa–PAB",
  "Papua New Guinean Kina–PGK",
  "Paraguay Guarani–PYG",
  "Peruvian Nuevo Sol–PEN",
  "Philippine Peso–PHP",
  "Polish Zloty–PLN",
  "Qatari Rial–QAR",
  "Romanian Leu–RON",
  "Russian Ruble–RUB",
  "Russian Ruble–RUR",
  "Rwandan Franc–RWF",
  "Saudi Riyal–SAR",
  "Serbian Dinar–RSD",
  "Sierra Leonean Leone–SLL",
  "Singapore Dollar–SGD",
  "Slovak Koruna–SKK",
  "Slovenian Tolar–SIT",
  "South African Rand–ZAR",
  "Sri Lankan Rupee–LKR",
  "Sudanese Pound–SDG",
  "Swedish Krona–SEK",
  "Swiss Franc–CHF",
  "Syrian Pound–SYP",
  "Tanzanian Shilling–TZS",
  "Thai Baht–THB",
  "Tongan Dollar–TOP",
  "Trinidad Dollar–TTD",
  "Tunisian Dinar–TND",
  "Turkish Lira–TRY",
  "UAE Dirham–AED",
  "Ugandan Shilling–UGX",
  "UK Pound Sterling–GBP",
  "Ukrainian Hryvnia–UAH",
  "Uruguayan Peso–UYU",
  "US Dollar–USD",
  "Uzbekistan Sum–UZS",
  "Venezuelan Bolivar–VEB",
  "Vietnamese Dong–VND",
  "West African CFA Franc–XOF",
  "Yemeni Rial–YER",
  "Zambian Kwacha–ZMW",
  "Zimbabwe Dollar–ZWD",
];

describe("plan formats catalogue", () => {
  it("lists the ticket's currencies in the ticket's order", () => {
    expect(CURRENCIES.map((c) => `${c.name}–${c.code}`)).toEqual(TICKET_LABELS);
  });
  it("has the Common group in the ticket's order", () => {
    expect([...COMMON_CURRENCY_CODES]).toEqual(["USD", "GBP", "CAD", "AUD", "EUR"]);
    expect(COMMON_CURRENCY_CODES.map((code) => currencyByCode(code)?.name)).toEqual([
      "US Dollar",
      "UK Pound Sterling",
      "Canadian Dollar",
      "Australian Dollar",
      "Euro",
    ]);
  });
  it.each([
    ["JPY", 0, "123,456", "before", "¥"],
    ["KWD", 3, "123,456.789", "before", "د.ك.\u200f"],
    ["SEK", 2, "123.456,78", "after", "kr"],
    ["CHF", 2, "123'456.78", "before", "CHF "],
    ["INR", 2, "1,23,456.78", "before", " ₹"],
    ["EUR", 2, "123,456.78", "before", "€"],
    ["XPF", 0, "123.456", "after", "F"],
  ])("%s defaults", (code, digits, format, placement, symbol) => {
    expect(currencyByCode(code)).toMatchObject({
      decimal_digits: digits,
      number_format: format,
      placement,
      symbol,
    });
  });
  it("each default number format is offered for its digits", () => {
    for (const c of CURRENCIES) expect(NUMBER_FORMATS[c.decimal_digits]).toContain(c.number_format);
  });
  it("date format options are the seven", () => {
    expect(new Set(DATE_FORMAT_OPTIONS)).toEqual(new Set(DATE_FORMATS));
    expect(DATE_FORMAT_OPTIONS).toHaveLength(7);
  });
  it("splits number formats", () => {
    expect(numberFormatParts("123 456-78")).toMatchObject({
      decimal_separator: "-",
      group_separator: " ",
    });
    expect(numberFormatParts("123,456/78")).toMatchObject({
      decimal_separator: "/",
      group_separator: ",",
    });
    expect(numberFormatParts("1,23,456.78")).toMatchObject({ group_separator: ",", indian: true });
    expect(numberFormatParts("123.456")).toMatchObject({ decimal_digits: 0, group_separator: "." });
    expect(numberFormatParts("123,456.789")).toMatchObject({ decimal_digits: 3 });
  });
  it("builds the read shape and its placement", () => {
    const cf = currencyFormatOf("EUR", "123.456,78", "after");
    expect(cf).toEqual({
      iso_code: "EUR",
      example_format: "123.456,78",
      decimal_digits: 2,
      decimal_separator: ",",
      group_separator: ".",
      symbol_first: false,
      currency_symbol: "€",
      display_symbol: true,
    });
    expect(placementOf(cf)).toBe("after");
    expect(placementOf(currencyFormatOf("EUR", "123.456,78", "none"))).toBe("none");
  });
  it("picks the currency of an imported format", () => {
    const base = { date_format: "MM/DD/YYYY" } as const;
    expect(
      formatsFromImport({
        ...base,
        currency_symbol: "$",
        symbol_placement: "before",
        decimal_separator: ".",
        decimal_digits: 2,
      }).iso_code,
    ).toBe("USD");
    const sek = formatsFromImport({
      ...base,
      currency_symbol: "kr",
      symbol_placement: "after",
      decimal_separator: ",",
      decimal_digits: 2,
    });
    expect(sek).toMatchObject({ iso_code: "SEK", example_format: "123.456,78" });
    const eur = formatsFromImport({
      ...base,
      currency_symbol: "€",
      symbol_placement: "before",
      decimal_separator: ",",
      decimal_digits: 2,
    });
    expect(eur).toMatchObject({ iso_code: "EUR", example_format: "123.456,78" });
    expect(
      formatsFromImport({
        ...base,
        currency_symbol: "¥",
        symbol_placement: "before",
        decimal_separator: ".",
        decimal_digits: 0,
      }).iso_code,
    ).toBe("JPY");
  });
});
