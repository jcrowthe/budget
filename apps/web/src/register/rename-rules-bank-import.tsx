import { RENAMING } from "@budget/schema/rename-rules";
import type { TransactionDetail } from "@budget/schema/transactions";
import { useRef, useState } from "react";
import { Tooltip } from "../account/Tooltip";
import { ApiError } from "../api/client";
import { useSaveTransaction } from "../api/transactions";
import { InfoCircleIcon } from "./icons";
import { Popover } from "./Popover";

/**
 * An imported row's payee name. A renamed row says what the bank sent in the register's own tooltip (`Tooltip`,
 * as the account header's and the action bar's: shown on hover and focus, Escape hides it); the others keep the
 * `title` the register's plain payee cells have.
 */
export function ImportedPayeeName({
  tx,
}: {
  tx: Pick<TransactionDetail, "payee_name" | "import_payee_name">;
}) {
  const { payee_name: payee, import_payee_name: imported } = tx;
  if (payee && imported && payee !== imported) {
    return (
      <Tooltip content={RENAMING.importedAs(payee, imported)} placement="below" align="start">
        {(tip) => (
          <span {...tip} className="import-payee-name">
            {payee}
          </span>
        )}
      </Tooltip>
    );
  }
  return (
    <span className="import-payee-name" title={payee ?? undefined}>
      {payee}
    </span>
  );
}

/**
 * The info button of an imported row's payee cell (EXF-467) and its popover: what the statement said, what was
 * imported, and, when the payee differs from the imported name, `Don't rename as <Payee>` (the row's ordinary edit:
 * the Worker then removes the rules that renamed it).
 */
export function BankImportButton({ budgetId, tx }: { budgetId: string; tx: TransactionDetail }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const save = useSaveTransaction(budgetId);
  const imported = tx.import_payee_name;
  // A matched row keeps the payee its owner typed: no rule renamed it, so there is nothing to undo.
  const renamed =
    !tx.matched && !!tx.payee_name && imported !== null && tx.payee_name !== imported;

  const close = () => {
    setOpen(false);
    setError(null);
    button.current?.focus();
  };
  const dontRename = async () => {
    if (busy.current || imported === null) return;
    busy.current = true;
    setError(null);
    try {
      await save.mutateAsync({ id: tx.id, body: { payee_name: imported, approved: tx.approved } });
      close();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "That did not work",
      );
    } finally {
      busy.current = false;
    }
  };

  return (
    <>
      <Tooltip content={RENAMING.bankImport} placement="below" align="start">
        {(tip) => (
          <button
            {...tip}
            ref={button}
            type="button"
            className="bank-import-info"
            aria-label={RENAMING.bankImport}
            aria-haspopup="dialog"
            aria-expanded={open}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <InfoCircleIcon />
          </button>
        )}
      </Tooltip>
      {open && button.current && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the panel's controls take the keys; this only keeps portal clicks off the row
        // biome-ignore lint/a11y/useKeyWithClickEvents: the same
        <div onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Popover
            anchor={button.current}
            placement="below"
            align="start"
            role="dialog"
            label={RENAMING.bankImport}
            width={Math.min(320, window.innerWidth - 16)}
            className="is-match"
            bodyClass="is-match"
            onClose={close}
          >
            <div className="bank-import-panel">
              <h2>{RENAMING.bankImport}</h2>
              <section>
                <h3>{RENAMING.statement}</h3>
                <p>{tx.bank_description ?? ""}</p>
              </section>
              <section>
                <h3>{RENAMING.imported}</h3>
                <p>{imported ?? ""}</p>
              </section>
              {renamed ? (
                <button
                  type="button"
                  className="bank-import-link"
                  onClick={() => void dontRename()}
                >
                  {RENAMING.dontRename(tx.payee_name as string)}
                </button>
              ) : null}
              {error && (
                <p role="alert" className="match-error">
                  {error}
                </p>
              )}
            </div>
          </Popover>
        </div>
      )}
    </>
  );
}
