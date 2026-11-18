import { type Payee, payeeMenu } from "@budget/schema/payees";
import { transferPayeeLabel } from "@budget/schema/transfers";
import { useCallback, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { ManagePayeesDialog } from "../payees/manage-payees-dialog";
import { PlusCircleIcon } from "./icons";
import { Option, PickerInput } from "./PickerInput";

type Item =
  | { kind: "create"; text: string }
  | { kind: "hidden"; payee: Payee }
  | { kind: "transfer"; payee: Payee }
  | { kind: "saved"; payee: Payee };

const accountOfTransfer = (p: Payee) => p.name.replace(/^Transfer : /, "");

/** The payee combobox: Saved Payees, `Create "<text>" Payee`, and the hidden-payee line (EXF-507). */
export function PayeeField({
  payees,
  value,
  disabled,
  title,
  currentAccountId,
  transfers = true,
  onChange,
  onPicked,
  onTransfer,
  transferLabel,
}: {
  payees: Payee[];
  value: { id: string | null; name: string };
  disabled?: boolean;
  title?: string;
  /** The register's account (or the row's chosen one): it is not offered as a transfer. */
  currentAccountId?: string | null;
  /** False for a split line: no "Payments and Transfers" section. */
  transfers?: boolean;
  onChange: (v: { id: string | null; name: string }) => void;
  /** After a saved or hidden payee is chosen (to fill an empty category). */
  onPicked: (p: Payee) => void;
  /** A "To/From <account>" entry was chosen. */
  onTransfer?: (accountId: string, name: string, label: string) => void;
  /** The label of a transfer entry; "To/From <account>" by default, "Payment from <account>" for a card's cash sources. */
  transferLabel?: (p: Payee) => string;
}) {
  const { budgetId } = useParams();
  const [managing, setManaging] = useState(false);
  const inputRef = useRef<HTMLElement | null>(null);
  const labelOf = useCallback(
    (p: Payee) => transferLabel?.(p) ?? transferPayeeLabel(accountOfTransfer(p)),
    [transferLabel],
  );
  const menu = useMemo(
    () => payeeMenu(payees, value.name, { currentAccountId, transfers, transferLabel: labelOf }),
    [payees, value.name, currentAccountId, transfers, labelOf],
  );
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (menu.top?.kind === "create") out.push({ kind: "create", text: menu.top.text });
    if (menu.top?.kind === "hidden") {
      const first = menu.top.payees[0];
      if (first) out.push({ kind: "hidden", payee: first });
    }
    for (const p of menu.transfers) out.push({ kind: "transfer", payee: p });
    for (const p of menu.saved) out.push({ kind: "saved", payee: p });
    return out;
  }, [menu]);
  // `active` indexes [top?, ...transfers, ...saved]; -1 with nothing typed.
  const initialActive = menu.active;

  return (
    <>
      <PickerInput<Item>
        label="Payee"
        placeholder="payee"
        text={value.name}
        onText={(name) => onChange({ id: null, name })}
        items={items}
        initialActive={initialActive}
        disabled={disabled}
        title={title ?? (value.name || undefined)}
        width={320}
        listLabel="Payees"
        onPick={(item) => {
          if (item.kind === "create") onChange({ id: null, name: value.name });
          else if (item.kind === "transfer") {
            onTransfer?.(
              item.payee.transfer_account_id as string,
              item.payee.name,
              labelOf(item.payee),
            );
          } else {
            onChange({ id: item.payee.id, name: item.payee.name });
            onPicked(item.payee);
          }
        }}
        footer={
          <button
            type="button"
            className="entry-footer-button"
            data-ticket="EXF-510"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // The field's combobox still has the focus (mousedown was cancelled): the dialog gives it back on close.
              inputRef.current = document.activeElement as HTMLElement | null;
              setManaging(true);
            }}
          >
            Manage Payees
          </button>
        }
        header={({ active, pick, hover }) => {
          const top = items[0];
          if (!top || top.kind === "saved" || top.kind === "transfer") return null;
          const name =
            top.kind === "create"
              ? `Create "${top.text}" Payee`
              : (menu.top as { label: string }).label;
          return (
            <Option
              active={active === 0}
              name={name}
              variant="create"
              onPick={() => pick(0)}
              onHover={() => hover(0)}
            >
              {top.kind === "create" ? <PlusCircleIcon width={12} height={12} /> : null}
              <span>{name}</span>
            </Option>
          );
        }}
        render={({ active, pick, hover }) => {
          let n = items[0] && (items[0].kind === "create" || items[0].kind === "hidden") ? 1 : 0;
          const next = () => n++;
          return (
            <>
              {menu.help ? <div className="entry-help">{menu.help}</div> : null}
              {menu.transfers.length > 0 ? (
                <div role="presentation" className="entry-heading">
                  {menu.transfersHeading}
                </div>
              ) : null}
              {menu.transfers.map((p) => {
                const i = next();
                const label = labelOf(p);
                return (
                  <Option
                    key={p.id}
                    active={active === i}
                    name={label}
                    onPick={() => pick(i)}
                    onHover={() => hover(i)}
                  >
                    <span>{label}</span>
                  </Option>
                );
              })}
              {menu.saved.length > 0 || menu.hint ? (
                <div role="presentation" className="entry-heading">
                  {menu.heading}
                </div>
              ) : null}
              {menu.hint ? <div className="entry-help">{menu.hint}</div> : null}
              {menu.saved.map((p) => {
                const i = next();
                return (
                  <Option
                    key={p.id}
                    active={active === i}
                    name={p.name}
                    checked={p.id === value.id}
                    onPick={() => pick(i)}
                    onHover={() => hover(i)}
                  >
                    <span>{p.name}</span>
                  </Option>
                );
              })}
            </>
          );
        }}
      />
      {managing ? (
        <ManagePayeesDialog
          budgetId={budgetId ?? null}
          returnTo={() => inputRef.current}
          onClose={() => setManaging(false)}
        />
      ) : null}
    </>
  );
}
