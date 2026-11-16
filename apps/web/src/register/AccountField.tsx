import type { Account } from "@budget/schema/accounts";
import { useState } from "react";
import { Option, PickerInput } from "./PickerInput";

/** All Accounts only: the plan's open accounts, in the sidebar's order. */
export function AccountField({
  accounts,
  value,
  disabled,
  title,
  startOpen,
  onChange,
}: {
  accounts: Account[];
  value: string | null;
  disabled?: boolean;
  title?: string;
  startOpen?: boolean;
  onChange: (id: string) => void;
}) {
  const current = accounts.find((a) => a.id === value)?.name ?? "";
  const [typed, setTyped] = useState<string | null>(null);
  const needle = (typed ?? "").trim().toLowerCase();
  const items = accounts.filter((a) => a.name.toLowerCase().includes(needle));
  return (
    <PickerInput<Account>
      label="Account"
      placeholder="account"
      text={typed ?? current}
      onText={setTyped}
      items={items}
      initialActive={typed === null ? items.findIndex((a) => a.id === value) : 0}
      disabled={disabled}
      title={title}
      startOpen={startOpen}
      width={320}
      listLabel="Accounts"
      onBlurCommit={() => setTyped(null)}
      onPick={(a) => {
        onChange(a.id);
        setTyped(null);
      }}
      render={({ active, pick, hover }) =>
        items.length === 0 ? (
          <div className="entry-help">No accounts found with that name.</div>
        ) : (
          items.map((a, i) => (
            <Option
              key={a.id}
              active={active === i}
              name={a.name}
              checked={a.id === value}
              onPick={() => pick(i)}
              onHover={() => hover(i)}
            >
              <span className="entry-option-name">{a.name}</span>
            </Option>
          ))
        )
      }
    />
  );
}
