import type { PlanFormatter } from "@budget/schema/plan-formats";
import {
  CURRENCIES,
  currenciesNamedBy,
  formatsFromImport,
} from "@budget/schema/plan-formats-catalogue";
import {
  type DateQuestion,
  IMPORT_ACCOUNT_TYPES,
  type ImportAccountType,
  type PlanImportOptions,
  type PlanImportPreview,
} from "@budget/schema/plan-import";
import { DATE_FORMATS } from "@budget/schema/plan-import-read";
import { useEffect, useState } from "react";
import { ACCOUNT_TYPE_LABEL } from "../shell/accountTypeLabels";
import { questionDate } from "./plan-import-dialog-format";
import { Counts, Notes } from "./plan-import-dialog-notes";

type Currency = NonNullable<PlanImportOptions["currency_format"]>;

export interface PreviewProps {
  preview: PlanImportPreview;
  question: DateQuestion | null;
  fmt: PlanFormatter;
  chosenDateFormat: string | undefined;
  name: string;
  onName: (name: string) => void;
  exportText: string;
  onExportText: (text: string) => void;
  exportError: string | null;
  onExportBlur: () => void;
  updating: boolean;
  error: string | null;
  onType: (account: string, type: ImportAccountType) => void;
  onDateFormat: (format: string) => void;
  onCurrency: (patch: Currency) => void;
}

const PLACEMENTS = [
  ["before", "Before amount"],
  ["after", "After amount"],
  ["none", "Don't show"],
] as const;

/**
 * The plan's currency, offered when the symbol read from the file does not name exactly one currency of the
 * catalogue (no symbol, an unknown one, or one several currencies share). The detected currency comes first; only
 * currencies with the file's decimal digits are offered, as amounts are never converted.
 */
function CurrencyChoice({
  formats: f,
  onCurrency,
}: {
  formats: PlanImportPreview["formats"];
  onCurrency: (patch: Currency) => void;
}) {
  const [open, setOpen] = useState(false);
  const named = currenciesNamedBy(f.currency_symbol, f.decimal_digits);
  if (f.symbol_placement !== "none" && named.length === 1) return null;
  const detected = formatsFromImport({ ...f, iso_code: undefined }).iso_code;
  const same = CURRENCIES.filter((c) => c.decimal_digits === f.decimal_digits);
  const list = [
    ...same.filter((c) => c.code === detected),
    ...same.filter((c) => c.code !== detected),
  ];
  const sym = f.currency_symbol.trim();
  // The dollar sign is shared by several currencies, and USD is the sensible default: show it, with a way to
  // change. A symbol shared by currencies without USD (no sensible default) keeps the select up front.
  const plainDollar =
    f.symbol_placement !== "none" && named.length > 1 && named.some((c) => c.code === "USD");
  if (plainDollar && !open) {
    return (
      <div className="plan-import-dialog-currency plan-import-dialog-currency-text">
        <span>Plan currency</span>
        <strong>{f.iso_code ?? "USD"}</strong>
        <button type="button" className="plan-import-dialog-change" onClick={() => setOpen(true)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="plan-import-dialog-currency">
      <label htmlFor="plan-import-currency">Plan currency</label>
      <select
        id="plan-import-currency"
        className="field"
        value={f.iso_code ?? detected}
        onChange={(e) => onCurrency({ iso_code: e.target.value })}
      >
        {list.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
      <small className="plan-import-dialog-more">
        {sym !== "" && f.symbol_placement !== "none"
          ? `The symbol “${sym}” does not name one currency of the list.`
          : "The file shows no currency symbol, so it does not name one currency."}{" "}
        Choose the plan's currency; amounts are not converted.
      </small>
    </div>
  );
}

export function PlanImportPreviewBody(p: PreviewProps) {
  const { preview, question } = p;
  const f = preview.formats;
  const [symbol, setSymbol] = useState(f.currency_symbol);
  useEffect(() => setSymbol(f.currency_symbol), [f.currency_symbol]);
  return (
    <>
      {p.error ? (
        <p role="alert" className="plan-import-dialog-error">
          {p.error}
        </p>
      ) : null}
      {p.updating ? (
        <p role="status" className="plan-import-dialog-more">
          Updating preview…
        </p>
      ) : null}
      <div className="plan-import-dialog-fields">
        <div>
          <label htmlFor="plan-import-name">Plan name</label>
          <input
            id="plan-import-name"
            className="field"
            maxLength={100}
            value={p.name}
            onChange={(e) => p.onName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="plan-import-export-date">Export date</label>
          <input
            id="plan-import-export-date"
            className="field"
            value={p.exportText}
            aria-invalid={p.exportError ? true : undefined}
            onChange={(e) => p.onExportText(e.target.value)}
            onBlur={p.onExportBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onExportBlur();
            }}
          />
          {p.exportError ? <span className="plan-import-dialog-error">{p.exportError}</span> : null}
        </div>
      </div>

      {question ? (
        <fieldset className="plan-import-dialog-question">
          <legend>{question.question}</legend>
          {question.options.map((o) => (
            <label key={o.date_format} className="plan-import-dialog-radio">
              <input
                type="radio"
                name="plan-import-date-question"
                checked={p.chosenDateFormat === o.date_format}
                onChange={() => p.onDateFormat(o.date_format)}
              />
              {questionDate(o.date)} ({o.date_format})
            </label>
          ))}
        </fieldset>
      ) : null}

      <section className="plan-import-dialog-section">
        <h3>Formats read</h3>
        <div className="plan-import-dialog-fields four">
          <div>
            <label htmlFor="plan-import-symbol">Currency symbol</label>
            <input
              id="plan-import-symbol"
              className="field"
              maxLength={8}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onBlur={() => {
                if (symbol !== f.currency_symbol)
                  p.onCurrency({ currency_symbol: symbol, iso_code: undefined });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && symbol !== f.currency_symbol)
                  p.onCurrency({ currency_symbol: symbol, iso_code: undefined });
              }}
            />
          </div>
          <div>
            <label htmlFor="plan-import-placement">Symbol placement</label>
            <select
              id="plan-import-placement"
              className="field"
              value={f.symbol_placement}
              onChange={(e) =>
                p.onCurrency({ symbol_placement: e.target.value as Currency["symbol_placement"] })
              }
            >
              {PLACEMENTS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="plan-import-decimal">Decimal separator</label>
            <select
              id="plan-import-decimal"
              className="field"
              value={f.decimal_separator}
              onChange={(e) =>
                p.onCurrency({ decimal_separator: e.target.value as Currency["decimal_separator"] })
              }
            >
              {[".", ",", "-", "/"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="plan-import-date-format">Date format</label>
            <select
              id="plan-import-date-format"
              className="field"
              value={f.date_format}
              onChange={(e) => p.onDateFormat(e.target.value)}
            >
              {DATE_FORMATS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        <CurrencyChoice formats={f} onCurrency={p.onCurrency} />
      </section>

      <section className="plan-import-dialog-section">
        <h3>Accounts</h3>
        <div className="plan-import-dialog-accounts">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th>Proposed</th>
                <th>Transactions</th>
              </tr>
            </thead>
            <tbody>
              {preview.accounts.map((a) => (
                <tr key={a.name}>
                  <td className="plan-import-dialog-name" title={a.name}>
                    {a.name}
                  </td>
                  <td>
                    <select
                      className="field"
                      aria-label={`Type of ${a.name}`}
                      value={a.type}
                      onChange={(e) => p.onType(a.name, e.target.value as ImportAccountType)}
                    >
                      {IMPORT_ACCOUNT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ACCOUNT_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {ACCOUNT_TYPE_LABEL[a.proposed_type]}
                    <small>{a.reason}</small>
                  </td>
                  <td>{a.transactions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Counts counts={preview.counts} />
      <Notes summary={preview} fmt={p.fmt} />
    </>
  );
}
