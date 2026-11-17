import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { SolidCardIcon } from "../account/icons";
import { Tooltip } from "../account/Tooltip";
import {
  CaretDownIcon,
  FileUpIcon,
  MoreDotsIcon,
  PlusCircleIcon,
  RedoIcon,
  SearchIcon,
  UndoIcon,
} from "./icons";
import { Popover } from "./Popover";
import { useRegisterView, ViewOptionsPopover } from "./register-view";

// Toolbar widths (px) below which buttons move into the More button. Source (measured): everything is inline at a
// 1280px window; Undo and Redo overflow at 1150-1200; Record Payment, Undo and Redo overflow at 1024-1100. The
// toolbar is the window minus the 260px sidebar.
const UNDO_REDO_BELOW = 1000;
const RECORD_PAYMENT_BELOW = 880;

type Overflow = { key: string; node: (inMenu: boolean) => ReactNode };

// Drawn, not wired: each button names the ticket that attaches its behaviour.
export function RegisterToolbar({
  name,
  onAdd,
  closed = false,
  onRecordPayment,
  paymentDisabled = false,
  viewScope,
}: {
  name: string;
  onAdd: () => void;
  closed?: boolean;
  /** A credit account's page only (EXF-539). */
  onRecordPayment?: () => void;
  paymentDisabled?: boolean;
  /** An account's page, or All Accounts (no Running Balance option). */
  viewScope: "account" | "all";
}) {
  const view = useRegisterView();
  const viewBtn = useRef<HTMLButtonElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const [menu, setMenu] = useState(false);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const payment: Overflow | null = onRecordPayment
    ? {
        key: "payment",
        node: () => (
          <button
            type="button"
            className="toolbar-button"
            title="Quickly record a credit card payment."
            onClick={() => {
              setMenu(false);
              onRecordPayment();
            }}
            disabled={paymentDisabled}
          >
            <SolidCardIcon />
            <span className="toolbar-label">Record Payment</span>
          </button>
        ),
      }
    : null;
  const undo: Overflow = {
    key: "undo",
    node: () => (
      <button type="button" className="toolbar-button" data-ticket="EXF-530" disabled>
        <UndoIcon />
        <span className="toolbar-label">Undo</span>
      </button>
    ),
  };
  const redo: Overflow = {
    key: "redo",
    node: () => (
      <button type="button" className="toolbar-button" data-ticket="EXF-530" disabled>
        <RedoIcon />
        <span className="toolbar-label">Redo</span>
      </button>
    ),
  };
  const hidden = new Set<string>();
  if (width < UNDO_REDO_BELOW) {
    hidden.add("undo");
    hidden.add("redo");
  }
  if (width < RECORD_PAYMENT_BELOW) hidden.add("payment");
  const inline = (o: Overflow | null) => (o && !hidden.has(o.key) ? o.node(false) : null);
  const inMenu = [payment, undo, redo].filter((o): o is Overflow => !!o && hidden.has(o.key));

  return (
    <div className="register-toolbar" role="toolbar" aria-label="Register toolbar" ref={bar}>
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
          data-ticket="EXF-531"
          disabled={closed}
        >
          <FileUpIcon />
          File Import
        </button>
        {inline(payment)}
        <hr className="toolbar-divider" />
        {inline(undo)}
        {inline(redo)}
        {inMenu.length > 0 ? (
          <button
            type="button"
            ref={moreBtn}
            className="toolbar-button toolbar-more"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <MoreDotsIcon />
            More
          </button>
        ) : null}
      </div>
      <div className="toolbar-group right">
        <Tooltip
          content="Set view options like date range, reconciliation status, and more."
          placement="above"
          align="end"
        >
          {(tip) => (
            <button
              type="button"
              ref={viewBtn}
              className="toolbar-button is-view"
              aria-haspopup="dialog"
              aria-expanded={viewOpen}
              onClick={() => setViewOpen((o) => !o)}
              {...tip}
            >
              View
              <CaretDownIcon />
            </button>
          )}
        </Tooltip>
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
      {viewOpen && viewBtn.current ? (
        <ViewOptionsPopover
          anchor={viewBtn.current}
          scope={viewScope}
          settings={view.settings}
          firstMonth={view.firstMonth}
          today={view.today}
          onSave={view.save}
          onClose={() => setViewOpen(false)}
        />
      ) : null}
      {menu && inMenu.length > 0 && moreBtn.current ? (
        <Popover
          anchor={moreBtn.current}
          placement="below"
          width={232}
          label="More toolbar actions"
          bodyClass="toolbar-overflow-body"
          onClose={() => setMenu(false)}
        >
          {inMenu.map((o) => (
            <div key={o.key}>{o.node(true)}</div>
          ))}
        </Popover>
      ) : null}
    </div>
  );
}
