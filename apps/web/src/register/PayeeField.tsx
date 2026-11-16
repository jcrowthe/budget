import { type Payee, payeeMenu } from "@budget/schema/payees";
import { useMemo } from "react";
import { PlusCircleIcon } from "./icons";
import { Option, PickerInput } from "./PickerInput";

type Item =
  | { kind: "create"; text: string }
  | { kind: "hidden"; payee: Payee }
  | { kind: "saved"; payee: Payee };

/** The payee combobox: Saved Payees, `Create "<text>" Payee`, and the hidden-payee line (EXF-507). */
export function PayeeField({
  payees,
  value,
  disabled,
  title,
  onChange,
  onPicked,
}: {
  payees: Payee[];
  value: { id: string | null; name: string };
  disabled?: boolean;
  title?: string;
  onChange: (v: { id: string | null; name: string }) => void;
  /** After a saved or hidden payee is chosen (to fill an empty category). */
  onPicked: (p: Payee) => void;
}) {
  const menu = useMemo(() => payeeMenu(payees, value.name), [payees, value.name]);
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (menu.top?.kind === "create") out.push({ kind: "create", text: menu.top.text });
    if (menu.top?.kind === "hidden") {
      const first = menu.top.payees[0];
      if (first) out.push({ kind: "hidden", payee: first });
    }
    for (const p of menu.saved) out.push({ kind: "saved", payee: p });
    return out;
  }, [menu]);
  // With nothing typed `active` indexes the saved list; with text it indexes [top, ...saved].
  const initialActive = menu.top ? menu.active : -1;

  return (
    <PickerInput<Item>
      label="Payee"
      placeholder="payee"
      text={value.name}
      onText={(name) => onChange({ id: null, name })}
      items={items}
      initialActive={initialActive}
      disabled={disabled}
      title={title}
      width={320}
      listLabel="Payees"
      onPick={(item) => {
        if (item.kind === "create") onChange({ id: null, name: value.name });
        else {
          onChange({ id: item.payee.id, name: item.payee.name });
          onPicked(item.payee);
        }
      }}
      footer={
        <button
          type="button"
          className="entry-footer-button"
          disabled
          aria-disabled="true"
          data-ticket="EXF-510"
        >
          Manage Payees
        </button>
      }
      header={({ active, pick, hover }) => {
        const top = items[0];
        if (!top || top.kind === "saved") return null;
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
        let n = items[0] && items[0].kind !== "saved" ? 1 : 0;
        const next = () => n++;
        return (
          <>
            {menu.help ? <div className="entry-help">{menu.help}</div> : null}
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
  );
}
