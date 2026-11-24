/**
 * The plan settings catalogue (EXF-468): the currencies of the Plan Settings dialog in its order, their symbols,
 * decimal digits and defaults, the number formats per decimal digits and the seven date formats. Pure data and
 * small helpers; no I/O. Design: docs/plan-formats-design.md.
 */
import type { DateFormat } from "./plan-import-read";

export type Placement = "before" | "after" | "none";
export type Digits = 0 | 2 | 3;

export interface Currency {
  code: string;
  name: string;
  /** As the ticket gives it: spaces and U+200F kept. */
  symbol: string;
  decimal_digits: Digits;
  number_format: string;
  placement: "before" | "after";
}

/** The eight fields a plan carries as `currency_format`. */
export interface CurrencyFormat {
  iso_code: string;
  example_format: string;
  decimal_digits: number;
  decimal_separator: string;
  group_separator: string;
  symbol_first: boolean;
  currency_symbol: string;
  display_symbol: boolean;
}

export interface StoredFormats {
  iso_code: string;
  example_format: string;
  symbol_placement: Placement;
  date_format: DateFormat;
}

function c(
  code: string,
  name: string,
  symbol: string,
  decimal_digits: Digits,
  number_format: string,
  placement: "before" | "after",
): Currency {
  return { code, name, symbol, decimal_digits, number_format, placement };
}

/** "All Currencies": alphabetical by name, as the ticket lists them (RUB and RUR are both kept). */
export const CURRENCIES: readonly Currency[] = [
  c("ALL", "Albanian Lek", "Lek", 2, "123.456,78", "after"),
  c("DZD", "Algerian Dinar", "د.ج.\u200f", 2, "123,456.78", "before"),
  c("AOA", "Angolan Kwanza", "Kz", 2, "123,456.78", "before"),
  c("ARS", "Argentine Peso", "$", 2, "123.456,78", "before"),
  c("AMD", "Armenian Dram", "դր.", 2, "123,456.78", "after"),
  c("AWG", "Aruban Florin", "ƒ", 2, "123,456.78", "before"),
  c("AUD", "Australian Dollar", "$", 2, "123,456.78", "before"),
  c("AZN", "Azerbaijanian Manat", "₼", 2, "123 456,78", "after"),
  c("BSD", "Bahamian Dollar", "$", 2, "123,456.78", "before"),
  c("BHD", "Bahraini Dinar", "د.ب.\u200f", 3, "123,456.789", "before"),
  c("BDT", "Bangladeshi Taka", "৳ ", 2, "123,456.78", "before"),
  c("BBD", "Barbadian Dollar", "$", 2, "123,456.78", "before"),
  c("BYN", "Belarusian Ruble", "р.", 2, "123 456,78", "after"),
  c("BZD", "Belize Dollar", "BZ$", 2, "123,456.78", "before"),
  c("BOB", "Boliviano", "$b", 2, "123.456,78", "before"),
  c("BAM", "Bosnian Convertible Mark", "KM", 2, "123.456,78", "after"),
  c("BWP", "Botswana Pula", "P", 2, "123,456.78", "before"),
  c("BRL", "Brazilian Real", "R$", 2, "123.456,78", "before"),
  c("BND", "Brunei Dollar", "$", 2, "123,456.78", "before"),
  c("BGN", "Bulgarian Lev", "лв", 2, "123,456.78", "after"),
  c("KHR", "Cambodian Riel", "៛", 2, "123,456.78", "after"),
  c("CAD", "Canadian Dollar", "$", 2, "123,456.78", "before"),
  c("CVE", "Cape Verdean Escudo", "$", 2, "123,456.78", "before"),
  c("XCG", "Caribbean Guilder", " Cg", 2, "123,456.78", "after"),
  c("KYD", "Cayman Islands Dollar", "$", 2, "123,456.78", "before"),
  c("XAF", "Central African CFA Franc", "FCFA", 0, "123,456", "after"),
  c("XPF", "CFP Franc", "F", 0, "123.456", "after"),
  c("CLP", "Chilean Peso", "$", 0, "123.456", "before"),
  c("CNY", "Chinese Renminbi (Yuan)", "¥", 2, "123,456.78", "before"),
  c("COP", "Colombian Peso", "$", 2, "123.456,78", "before"),
  c("CRC", "Costa Rican Colon", "₡", 2, "123.456,78", "before"),
  c("HRK", "Croatian Kuna", "kn", 2, "123.456,78", "after"),
  c("CZK", "Czech Koruna", "Kč", 2, "123 456,78", "after"),
  c("DKK", "Danish Krone", "kr. ", 2, "123.456,78", "before"),
  c("DJF", "Djiboutian Franc", "Fdj", 0, "123.456", "after"),
  c("DOP", "Dominican Peso", "RD$", 2, "123,456.78", "before"),
  c("XCD", "Eastern Caribbean Dollar", "$\u200f", 2, "123,456.78", "before"),
  c("EGP", "Egyptian Pound", "ج.م.\u200f", 2, "123,456.78", "before"),
  c("EEK", "Estonian Kroon", "kr", 2, "123 456.78", "after"),
  c("ETB", "Ethiopian Birr", "Br", 2, "123,456.78", "before"),
  c("EUR", "Euro", "€", 2, "123,456.78", "before"),
  c("FJD", "Fijian Dollar", "$", 2, "123,456.78", "before"),
  c("GMD", "Gambian Dalasi", "D", 2, "123,456.78", "before"),
  c("GEL", "Georgian Lari", "₾", 2, "123,456.78", "after"),
  c("GHS", "Ghanaian Cedi", "₵", 2, "123,456.78", "before"),
  c("GTQ", "Guatemalan Quetzal", "Q", 2, "123,456.78", "before"),
  c("GYD", "Guyanese Dollar", "$", 2, "123,456.78", "before"),
  c("HTG", "Haitian Gourde", "G", 2, "123,456.78", "after"),
  c("HNL", "Honduran Lempira", "L.", 2, "123,456.78", "before"),
  c("HKD", "Hong Kong Dollar", "HK$", 2, "123,456.78", "before"),
  c("HUF", "Hungarian Forint", " Ft", 0, "123.456", "after"),
  c("ISK", "Icelandic Krona", "kr.", 0, "123.456", "after"),
  c("INR", "Indian Rupee", " ₹", 2, "1,23,456.78", "before"),
  c("IDR", "Indonesian Rupiah", "Rp", 0, "123.456", "before"),
  c("IRR", "Iranian Rial", "ريال", 2, "123,456/78", "before"),
  c("IQD", "Iraqi Dinar", "د.ع.\u200f", 3, "123,456.789", "before"),
  c("ILS", "Israeli New Shekel", "₪", 2, "123,456.78", "before"),
  c("JMD", "Jamaican Dollar", "J$", 2, "123,456.78", "before"),
  c("JPY", "Japanese Yen", "¥", 0, "123,456", "before"),
  c("JOD", "Jordanian Dinar", "د.ا.\u200f", 3, "123,456.789", "before"),
  c("KZT", "Kazakhstani Tenge", "₸", 2, "123 456,78", "before"),
  c("KES", "Kenyan Shilling", "KSh", 2, "123,456.78", "before"),
  c("KRW", "Korean Won", "₩", 0, "123,456", "before"),
  c("KWD", "Kuwaiti Dinar", "د.ك.\u200f", 3, "123,456.789", "before"),
  c("MMR", "Kyat", "K", 0, "123.456", "before"),
  c("KGS", "Kyrgyzstani Som", "c", 2, "123,456.78", "after"),
  c("LAK", "Lao Kip", "₭", 0, "123,456", "before"),
  c("LBP", "Lebanese Pound", "ل.ل.\u200f", 2, "123,456.78", "before"),
  c("LRD", "Liberian Dollar", "L$", 2, "123,456.78", "before"),
  c("LYD", "Libyan Dinar", "د.ل.\u200f", 2, "123,456.78", "before"),
  c("MOP", "Macao Pataca", "MOP", 2, "123,456.78", "before"),
  c("MKD", "Macedonian Denar", "ден.", 2, "123.456,78", "after"),
  c("MGA", "Malagasy Ariary", "Ar", 2, "123,456.78", "after"),
  c("MWK", "Malawi Kwacha", "MK", 2, "123,456.78", "after"),
  c("MYR", "Malaysian Ringgit", "RM", 2, "123,456.78", "before"),
  c("MVR", "Maldivian Rufiyaa", "Rf", 2, "123,456.78", "before"),
  c("MTL", "Maltese Lira", "Lm", 2, "123,456.78", "before"),
  c("MUR", "Mauritian Rupee", "Rs ", 2, "123,456.78", "before"),
  c("MXN", "Mexican Peso", "$", 2, "123,456.78", "before"),
  c("MDL", "Moldovan Leu", "L", 2, "123,456.78", "after"),
  c("MNT", "Mongolian Tugrik", "₮", 2, "123,456.78", "before"),
  c("MAD", "Moroccan Dirham", "د.م.\u200f", 2, "123,456.78", "before"),
  c("MZN", "Mozambican Metical", " MT", 2, "123,456.78", "after"),
  c("NPR", "Nepalese Rupee", "रु", 2, "1,23,456.78", "before"),
  c("TWD", "New Taiwan Dollar", "NT$", 0, "123.456", "before"),
  c("NZD", "New Zealand Dollar", "$", 2, "123,456.78", "before"),
  c("NIO", "Nicaraguan Cordoba Oro", "C$", 2, "123,456.78", "before"),
  c("NGN", "Nigerian Naira", "₦", 2, "123,456.78", "before"),
  c("NOK", "Norwegian Krone", "kr ", 2, "123 456,78", "before"),
  c("OMR", "Omani Rial", "ر.ع.\u200f", 3, "123,456.789", "before"),
  c("PKR", "Pakistan Rupee", "Rs", 2, "123,456.78", "before"),
  c("PAB", "Panamanian Balboa", "B/.", 2, "123,456.78", "before"),
  c("PGK", "Papua New Guinean Kina", "K ", 2, "123,456.78", "before"),
  c("PYG", "Paraguay Guarani", "Gs", 0, "123.456", "before"),
  c("PEN", "Peruvian Nuevo Sol", "S/.", 2, "123,456.78", "before"),
  c("PHP", "Philippine Peso", "₱", 2, "123,456.78", "before"),
  c("PLN", "Polish Zloty", " zł", 2, "123 456,78", "after"),
  c("QAR", "Qatari Rial", "ر.ق.\u200f", 2, "123,456.78", "before"),
  c("RON", "Romanian Leu", "lei", 2, "123.456,78", "after"),
  c("RUB", "Russian Ruble", "₽", 2, "123 456,78", "after"),
  c("RUR", "Russian Ruble", "р.", 2, "123 456,78", "after"),
  c("RWF", "Rwandan Franc", "FRw", 2, "123,456.78", "after"),
  c("SAR", "Saudi Riyal", "ر.س.\u200f", 2, "123,456.78", "before"),
  c("RSD", "Serbian Dinar", "Дин.", 2, "123.456,78", "after"),
  c("SLL", "Sierra Leonean Leone", "Le", 2, "123,456.78", "before"),
  c("SGD", "Singapore Dollar", "$", 2, "123,456.78", "before"),
  c("SKK", "Slovak Koruna", "Sk", 2, "123 456,78", "after"),
  c("SIT", "Slovenian Tolar", "SIT", 2, "123.456,78", "after"),
  c("ZAR", "South African Rand", "R", 2, "123,456.78", "before"),
  c("LKR", "Sri Lankan Rupee", "Rs", 2, "123,456.78", "after"),
  c("SDG", "Sudanese Pound", "ج.س.\u200f", 2, "123,456.78", "before"),
  c("SEK", "Swedish Krona", "kr", 2, "123.456,78", "after"),
  c("CHF", "Swiss Franc", "CHF ", 2, "123'456.78", "before"),
  c("SYP", "Syrian Pound", "ل.س.\u200f", 2, "123,456.78", "before"),
  c("TZS", "Tanzanian Shilling", "TSh", 0, "123,456", "before"),
  c("THB", "Thai Baht", "฿", 2, "123,456.78", "before"),
  c("TOP", "Tongan Dollar", "$", 2, "123,456.78", "before"),
  c("TTD", "Trinidad Dollar", "TT$", 2, "123,456.78", "before"),
  c("TND", "Tunisian Dinar", "د.ت.\u200f", 3, "123,456.789", "before"),
  c("TRY", "Turkish Lira", "₺", 2, "123.456,78", "after"),
  c("AED", "UAE Dirham", "AED", 2, "123,456.78", "before"),
  c("UGX", "Ugandan Shilling", "USh", 0, "123.456", "after"),
  c("GBP", "UK Pound Sterling", "£", 2, "123,456.78", "before"),
  c("UAH", "Ukrainian Hryvnia", " ₴", 2, "123 456,78", "after"),
  c("UYU", "Uruguayan Peso", "$U", 2, "123.456,78", "before"),
  c("USD", "US Dollar", "$", 2, "123,456.78", "before"),
  c("UZS", "Uzbekistan Sum", "сўм", 2, "123 456,78", "after"),
  c("VEB", "Venezuelan Bolivar", "Bs", 2, "123.456,78", "before"),
  c("VND", "Vietnamese Dong", "₫", 0, "123.456", "after"),
  c("XOF", "West African CFA Franc", "FCFA", 0, "123,456", "after"),
  c("YER", "Yemeni Rial", "ر.ي.\u200f", 2, "123,456.78", "before"),
  c("ZMW", "Zambian Kwacha", "ZK", 2, "123,456.78", "before"),
  c("ZWD", "Zimbabwe Dollar", "Z$", 2, "123,456.78", "before"),
];

export const COMMON_CURRENCY_CODES = ["USD", "GBP", "CAD", "AUD", "EUR"] as const;

export const NUMBER_FORMATS: Record<Digits, readonly string[]> = {
  2: [
    "123,456.78",
    "123.456,78",
    "123 456.78",
    "123'456.78",
    "123 456-78",
    "123 456,78",
    "123,456/78",
    "1,23,456.78",
  ],
  3: ["123,456.789"],
  0: ["123.456", "123,456", "123 456"],
};

/** The seven date formats in the dialog's order. */
export const DATE_FORMAT_OPTIONS: readonly DateFormat[] = [
  "YYYY/MM/DD",
  "YYYY-MM-DD",
  "DD-MM-YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",
  "MM/DD/YYYY",
  "YYYY.MM.DD",
];

const BY_CODE = new Map(CURRENCIES.map((cur) => [cur.code, cur]));
export function currencyByCode(code: string): Currency | undefined {
  return BY_CODE.get(code);
}

export function numberFormatParts(f: string): {
  decimal_separator: string;
  group_separator: string;
  decimal_digits: Digits;
  indian: boolean;
} {
  if (NUMBER_FORMATS[0].includes(f)) {
    const group = f[3] as string;
    return {
      decimal_separator: group === "." ? "," : ".",
      group_separator: group,
      decimal_digits: 0,
      indian: false,
    };
  }
  const digits: Digits = f.endsWith("789") ? 3 : 2;
  const decimal = f[f.length - digits - 1] as string;
  const group = f === "1,23,456.78" ? "," : (f[3] as string);
  return {
    decimal_separator: decimal,
    group_separator: group === decimal ? "," : group,
    decimal_digits: digits,
    indian: f === "1,23,456.78",
  };
}

export function currencyFormatOf(
  code: string,
  numberFormat: string,
  placement: Placement,
): CurrencyFormat {
  const cur = currencyByCode(code) ?? (currencyByCode("USD") as Currency);
  const parts = numberFormatParts(numberFormat);
  return {
    iso_code: cur.code,
    example_format: numberFormat,
    decimal_digits: cur.decimal_digits,
    decimal_separator: parts.decimal_separator,
    group_separator: parts.group_separator,
    symbol_first: placement === "before",
    currency_symbol: cur.symbol,
    display_symbol: placement !== "none",
  };
}

export function placementOf(
  cf: Pick<CurrencyFormat, "symbol_first" | "display_symbol">,
): Placement {
  return !cf.display_symbol ? "none" : cf.symbol_first ? "before" : "after";
}

export const DEFAULT_STORED_FORMATS: StoredFormats = {
  iso_code: "USD",
  example_format: "123,456.78",
  symbol_placement: "before",
  date_format: "MM/DD/YYYY",
};

/** The catalogue in the Plan Settings dialog's order: the common currencies, then all of them. */
const dialogOrderOf = (): Currency[] => [
  ...COMMON_CURRENCY_CODES.map((code) => currencyByCode(code) as Currency),
  ...CURRENCIES,
];

/** The currencies a symbol read from a file names, with the file's decimal digits (EXF-877). */
export function currenciesNamedBy(symbol: string, digits: number): Currency[] {
  const sym = symbol.trim();
  return dialogOrderOf().filter(
    (cur) => cur.symbol.trim() === sym && cur.decimal_digits === digits,
  );
}

/**
 * What the import detected, as the formats a plan stores (design: "Files"). `iso_code`, when it names a
 * currency of the catalogue, is the person's choice and wins over the one the symbol would give.
 */
export function formatsFromImport(f: {
  iso_code?: string;
  currency_symbol: string;
  symbol_placement: Placement;
  decimal_separator: string;
  decimal_digits: number;
  date_format: DateFormat;
}): StoredFormats {
  const digits = f.decimal_digits;
  const sameDigits = (cur: Currency) => cur.decimal_digits === digits;
  const dialogOrder = dialogOrderOf();
  const sym = f.currency_symbol.trim();
  const decimalOf = (cur: Currency) => numberFormatParts(cur.number_format).decimal_separator;
  const matches = dialogOrder.filter((cur) => cur.symbol.trim() === sym && sameDigits(cur));
  const rank = (cur: Currency) =>
    (decimalOf(cur) === f.decimal_separator ? 0 : 2) +
    (cur.placement === f.symbol_placement ? 0 : 1);
  let pick: Currency | undefined;
  if (f.symbol_placement !== "none") {
    pick = matches.reduce<Currency | undefined>(
      (best, cur) => (best === undefined || rank(cur) < rank(best) ? cur : best),
      undefined,
    );
  }
  const chosen = f.iso_code ? currencyByCode(f.iso_code) : undefined;
  pick = chosen ?? pick ?? dialogOrder.find(sameDigits) ?? (currencyByCode("USD") as Currency);
  const formats = NUMBER_FORMATS[pick.decimal_digits];
  const numberFormat =
    decimalOf(pick) === f.decimal_separator
      ? pick.number_format
      : (formats.find((nf) => numberFormatParts(nf).decimal_separator === f.decimal_separator) ??
        pick.number_format);
  return {
    iso_code: pick.code,
    example_format: numberFormat,
    symbol_placement: f.symbol_placement,
    date_format: f.date_format,
  };
}
