import { CardIcon } from "../account/icons";
import { CaretDownIcon, FileUpIcon, PlusCircleIcon, RedoIcon, SearchIcon, UndoIcon } from "./icons";

// Drawn, not wired: each button names the ticket that attaches its behaviour.
export function RegisterToolbar({
  name,
  onAdd,
  closed = false,
  onRecordPayment,
  paymentDisabled = false,
}: {
  name: string;
  onAdd: () => void;
  closed?: boolean;
  /** A credit account's page only (EXF-539). */
  onRecordPayment?: () => void;
  paymentDisabled?: boolean;
}) {
  return (
    <div className="register-toolbar" role="toolbar" aria-label="Register toolbar">
      <div className="toolbar-group left">
        <button
          type="button"
          className="toolbar-button"
          title="Add new transaction"
          data-ticket="EXF-517"
          onClick={onAdd}
          disabled={closed}
        >
          <PlusCircleIcon />
          Add Transaction
        </button>
        <button
          type="button"
          className="toolbar-button"
          title="Import transactions from a bank file."
          aria-label="File Import"
          data-ticket="EXF-531"
          disabled={closed}
        >
          <FileUpIcon />
          <span className="toolbar-label can-hide">File Import</span>
        </button>
        {onRecordPayment ? (
          <button
            type="button"
            className="toolbar-button"
            title="Record a payment to this card"
            onClick={onRecordPayment}
            disabled={paymentDisabled}
          >
            <CardIcon />
            <span className="toolbar-label">Record Payment</span>
          </button>
        ) : null}
        <hr className="toolbar-divider" />
        <button
          type="button"
          className="toolbar-button"
          data-ticket="EXF-530"
          aria-label="Undo"
          disabled
        >
          <UndoIcon />
          <span className="toolbar-label can-hide">Undo</span>
        </button>
        <button
          type="button"
          className="toolbar-button"
          data-ticket="EXF-530"
          aria-label="Redo"
          disabled
        >
          <RedoIcon />
          <span className="toolbar-label can-hide">Redo</span>
        </button>
      </div>
      <div className="toolbar-group right">
        <button
          type="button"
          className="toolbar-button"
          title="Set view options like date range, reconciliation status, and more."
          data-ticket="EXF-529"
        >
          View
          <CaretDownIcon />
        </button>
        <span className="search-box">
          <SearchIcon />
          <input
            type="search"
            placeholder={`Search ${name}`}
            aria-label="Find the transactions you're looking for..."
            data-ticket="EXF-528"
          />
        </span>
      </div>
    </div>
  );
}
