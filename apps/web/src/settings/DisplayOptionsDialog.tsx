import type { Settings } from "@budget/schema/settings";
import { useEffect, useRef, useState } from "react";
import { useSaveSettings } from "../api/settings";
import { AvailablePill } from "../plan/AvailablePill";
import { CloseIcon } from "../shell/icons";
import { clearPreview, setPreview, useEffectiveSettings } from "./displayStore";
import { cycleTheme, type ThemeChoice } from "./theme";
import "./display-options.css";

type Choice<V> = { value: V; label: string };

const THEMES: Choice<ThemeChoice>[] = [
  { value: "default", label: "Default" },
  { value: "dark", label: "Dark" },
  { value: "match_system", label: "Match System" },
];
const BARS: Choice<boolean>[] = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];
const BALANCES: Choice<Settings["balance_style"]>[] = [
  { value: "default", label: "Default" },
  { value: "differentiate_without_color", label: "Differentiate Without Color" },
];

function ThemePreview({ theme }: { theme: ThemeChoice }) {
  return (
    <span className={`do-preview do-theme do-theme-${theme}`} aria-hidden="true">
      <span className="do-theme-half do-theme-half-light">
        <i className="do-line wide" />
        <i className="do-line" />
        <i className="do-line short" />
      </span>
      <span className="do-theme-half do-theme-half-dark">
        <i className="do-line wide" />
        <i className="do-line" />
        <i className="do-line short" />
      </span>
    </span>
  );
}

function BarsPreview({ on }: { on: boolean }) {
  return (
    <span className="do-preview do-bars" aria-hidden="true">
      {[70, 40, 90].map((w) => (
        <span className="do-bars-row" key={w}>
          <i className="do-line" />
          {on && <i className="do-bar" style={{ width: `${w}%` }} />}
        </span>
      ))}
    </span>
  );
}

function BalancePreview({ differentiate }: { differentiate: boolean }) {
  const pills = (
    <>
      <AvailablePill display plain={!differentiate} amount={-10000} />
      <AvailablePill display plain={!differentiate} amount={10000} tone="cautious" />
      <AvailablePill display plain={!differentiate} amount={10000} />
    </>
  );
  return (
    <span className="do-preview do-balance" aria-hidden="true">
      {differentiate ? <span className="balance-no-color do-pills">{pills}</span> : pills}
    </span>
  );
}

function Section<V extends string | boolean>({
  title,
  name,
  choices,
  value,
  onSelect,
  preview,
  firstRef,
}: {
  title: string;
  name: string;
  choices: Choice<V>[];
  value: V;
  onSelect: (v: V) => void;
  preview: (v: V) => React.ReactNode;
  firstRef?: boolean;
}) {
  return (
    <section className="do-section">
      <h3>{title}</h3>
      <div className="do-cards" role="radiogroup" aria-label={title}>
        {choices.map((c) => {
          const active = c.value === value;
          return (
            <label className="do-card" key={String(c.value)} data-active={active}>
              {preview(c.value)}
              <span className="do-choice">
                <input
                  type="radio"
                  name={name}
                  aria-label={c.label}
                  checked={active}
                  data-initial-focus={firstRef && active ? "" : undefined}
                  onChange={() => onSelect(c.value)}
                />
                <span className="do-label">{c.label}</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

/** Display Options: theme, progress bars and balance style. Choosing previews at once; Apply saves; Cancel reverts. */
export function DisplayOptionsDialog({
  onClose,
}: {
  budgetId: string | null;
  onClose: () => void;
}) {
  const effective = useEffectiveSettings();
  const save = useSaveSettings();
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    clearPreview();
    onClose();
    document.querySelector<HTMLElement>(".plan-button, .rail-logo")?.focus();
  };
  const applyNow = async () => {
    setFailed(false);
    try {
      await save.mutateAsync(effective);
    } catch {
      setFailed(true);
      return;
    }
    close();
  };
  const latest = useRef({ close, applyNow, effective });
  latest.current = { close, applyNow, effective };

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      const l = latest.current;
      if (e.key === "Escape") {
        e.preventDefault();
        l.close();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setPreview({ theme: cycleTheme(l.effective.theme, e.key === "ArrowRight" ? 1 : -1) });
      } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        void l.applyNow();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearPreview();
    };
  }, []);

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className="dialog display-options"
        role="dialog"
        aria-modal="true"
        aria-label="Display Options"
      >
        <div className="dialog-head">
          <h2>Display Options</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            title="Close"
            onClick={close}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="do-body">
          <Section
            title="Theme"
            name="do-theme"
            choices={THEMES}
            value={effective.theme}
            onSelect={(theme) => setPreview({ theme })}
            preview={(v) => <ThemePreview theme={v} />}
            firstRef
          />
          <Section
            title="Progress Bars"
            name="do-bars"
            choices={BARS}
            value={effective.progress_bars}
            onSelect={(progress_bars) => setPreview({ progress_bars })}
            preview={(v) => <BarsPreview on={v} />}
          />
          <Section
            title="Balance Style"
            name="do-balance"
            choices={BALANCES}
            value={effective.balance_style}
            onSelect={(balance_style) => setPreview({ balance_style })}
            preview={(v) => <BalancePreview differentiate={v === "differentiate_without_color"} />}
          />
          {failed ? (
            <p className="error" role="alert">
              Couldn't save display options.
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={save.isPending} onClick={applyNow}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
