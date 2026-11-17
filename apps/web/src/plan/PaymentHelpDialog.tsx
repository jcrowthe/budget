import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** The "Using Credit Cards" explanation behind the Credit Card Payments header's PAYMENT button (EXF-537). */
export function PaymentHelpDialog({ onClose }: { onClose: () => void }) {
  const [more, setMore] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog modal payment-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-help-title"
      >
        <div className="dialog-head">
          <h2 id="payment-help-title">Using Credit Cards</h2>
        </div>
        <div className="payment-help-body">
          <p>
            You assigned money to your categories, then charged a purchase on your card, so we moved
            the money from your categories to your credit card payment.
          </p>
          {more && (
            <p id="payment-help-more">
              When you buy 100 of groceries on a card you still have the 100: the money changes job
              to be ready for the card payment, and the app moves it for you.
            </p>
          )}
          <button
            type="button"
            className="payment-help-more"
            aria-expanded={more}
            aria-controls="payment-help-more"
            onClick={() => setMore((m) => !m)}
          >
            {more ? "Show Less" : "Show More"}
          </button>
        </div>
        <div className="popover-buttons delete-footer">
          <span className="popover-spacer" />
          {/* biome-ignore lint/a11y/noAutofocus: a modal takes focus */}
          <button type="button" className="popover-button" autoFocus onClick={onClose}>
            Got it!
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
