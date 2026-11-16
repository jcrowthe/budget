import { CaretDownIcon, FileUpIcon, PlusCircleIcon, RedoIcon, SearchIcon, UndoIcon } from "./icons";

// Drawn, not wired: each button names the ticket that attaches its behaviour.
export function RegisterToolbar({ name, onAdd }: { name: string; onAdd: () => void }) {
  return (
    <div className="register-toolbar" role="toolbar" aria-label="Register toolbar">
      <div className="toolbar-group left">
        <button
          type="button"
          className="toolbar-button"
          title="Add new transaction"
          data-ticket="EXF-517"
          onClick={onAdd}
        >
          <PlusCircleIcon />
          Add Transaction
        </button>
        <button
          type="button"
          className="toolbar-button"
          title="Import transactions from a bank file."
          data-ticket="EXF-531"
        >
          <FileUpIcon />
          File Import
        </button>
        <hr className="toolbar-divider" />
        <button type="button" className="toolbar-button" data-ticket="EXF-530">
          <UndoIcon />
          Undo
        </button>
        <button type="button" className="toolbar-button" data-ticket="EXF-530">
          <RedoIcon />
          Redo
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
