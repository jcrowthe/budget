import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "../shell/icons";
import { KeyCaps } from "./KeyCaps";
import { SHORTCUT_SECTIONS, SHORTCUTS } from "./registry";
import "./shortcuts.css";

export function KeyboardShortcutsDialog({
  onClose,
}: {
  budgetId?: string | null;
  onClose: () => void;
}) {
  const opener = useState(() => document.activeElement)[0];
  const scroll = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);
  const [overflowed, setOverflowed] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = scroll.current;
    el?.focus({ preventScroll: true });
    const measure = () => el && setOverflowed(el.scrollHeight > el.clientHeight);
    measure();
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === "Tab") {
        e.preventDefault();
        const first = closeBtn.current;
        const last = okBtn.current;
        const to = e.shiftKey
          ? document.activeElement === last
            ? first
            : last
          : document.activeElement === first
            ? last
            : first;
        to?.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("keydown", onKey, true);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  return createPortal(
    <div className="dialog-backdrop">
      <div
        className={`dialog shortcuts${overflowed ? " overflowed" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className="dialog-head">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button
            type="button"
            ref={closeBtn}
            className="icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="shortcuts-scroll" ref={scroll} tabIndex={-1}>
          {SHORTCUT_SECTIONS.map((sec) => (
            <section key={sec.id}>
              <h3>{sec.title}</h3>
              <ul>
                {SHORTCUTS.filter((s) => s.section === sec.id).map((s) => (
                  <li key={s.id}>
                    <span className="desc">{s.description}</span>
                    <KeyCaps caps={s.caps} variant="dialog" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="dialog-footer">
          <button type="button" ref={okBtn} className="primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
