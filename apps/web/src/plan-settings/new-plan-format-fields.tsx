import { DEFAULT_PLAN_FORMATS, planFormatter } from "@budget/schema/plan-formats";
import {
  COMMON_CURRENCY_CODES,
  CURRENCIES,
  type Currency,
  type CurrencyFormat,
  currencyByCode,
  DATE_FORMAT_OPTIONS,
  NUMBER_FORMATS,
  type Placement,
  placementOf,
} from "@budget/schema/plan-formats-catalogue";
import type { DateFormat } from "@budget/schema/plan-import-read";
import "./plan-settings.css";

export type FormatValues = {
  code: string;
  numberFormat: string;
  placement: Placement;
  dateFormat: DateFormat;
};

export const formatValuesOf = (f: {
  currency_format: CurrencyFormat;
  date_format: { format: DateFormat };
}): FormatValues => ({
  code: f.currency_format.iso_code,
  numberFormat: f.currency_format.example_format,
  placement: placementOf(f.currency_format),
  dateFormat: f.date_format.format,
});

export const DEFAULT_FORMAT_VALUES: FormatValues = formatValuesOf(DEFAULT_PLAN_FORMATS);

export const formatsInput = (v: FormatValues) => ({
  currency_format: {
    iso_code: v.code,
    example_format: v.numberFormat,
    symbol_placement: v.placement,
  },
  date_format: { format: v.dateFormat },
});

const label = (c: Currency) => `${c.name}–${c.code}`;
const common = COMMON_CURRENCY_CODES.map((code) => currencyByCode(code) as Currency);

/** "30 December of this year" in each date format, as the options show it. */
function dateLabel(format: DateFormat): string {
  const f = planFormatter({ ...DEFAULT_PLAN_FORMATS, date_format: { format } });
  return f.date(`${new Date().getFullYear()}-12-30`);
}

function placementLabel(p: Placement, symbol: string, numberFormat: string): string {
  if (p === "before") return `Before amount (${symbol}${numberFormat})`;
  if (p === "after") return `After amount (${numberFormat}${symbol})`;
  return `Don't show (${numberFormat})`;
}

/** Currency, Currency Placement, Number Format and Date Format: shared by Plan Settings and New Plan. */
export function PlanFormatFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: "plan-settings" | "new-plan";
  value: FormatValues;
  onChange: (next: FormatValues) => void;
}) {
  const currency = currencyByCode(value.code) ?? (currencyByCode("USD") as Currency);

  function changeCurrency(next: string) {
    const c = currencyByCode(next);
    if (!c) return;
    onChange({ ...value, code: next, numberFormat: c.number_format, placement: c.placement });
  }

  const chosen = placementLabel(value.placement, currency.symbol, value.numberFormat);
  return (
    <>
      <label htmlFor={`${idPrefix}-currency`}>Currency</label>
      <select
        id={`${idPrefix}-currency`}
        className="field"
        value={value.code}
        onChange={(e) => changeCurrency(e.target.value)}
      >
        <optgroup label="Common Currencies">
          {common.map((c) => (
            <option key={c.code} value={c.code}>
              {label(c)}
            </option>
          ))}
        </optgroup>
        <optgroup label="All Currencies">
          {CURRENCIES.map((c) => (
            <option key={`${c.code}-${c.name}`} value={c.code}>
              {label(c)}
            </option>
          ))}
        </optgroup>
      </select>
      <label htmlFor={`${idPrefix}-placement`}>Currency Placement</label>
      <select
        id={`${idPrefix}-placement`}
        className="field"
        title={chosen}
        value={value.placement}
        onChange={(e) => onChange({ ...value, placement: e.target.value as Placement })}
      >
        {(["before", "after", "none"] as const).map((p) => (
          <option key={p} value={p}>
            {placementLabel(p, currency.symbol, value.numberFormat)}
          </option>
        ))}
      </select>
      <label htmlFor={`${idPrefix}-number-format`}>Number Format</label>
      <select
        id={`${idPrefix}-number-format`}
        className="field"
        value={value.numberFormat}
        onChange={(e) => onChange({ ...value, numberFormat: e.target.value })}
      >
        {NUMBER_FORMATS[currency.decimal_digits].map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <label htmlFor={`${idPrefix}-date-format`}>Date Format</label>
      <select
        id={`${idPrefix}-date-format`}
        className="field"
        value={value.dateFormat}
        onChange={(e) => onChange({ ...value, dateFormat: e.target.value as DateFormat })}
      >
        {DATE_FORMAT_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {dateLabel(f)}
          </option>
        ))}
      </select>
    </>
  );
}
