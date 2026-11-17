import type { BankConnection } from "@budget/schema/bank-connections";
import { connectionGroup } from "@budget/schema/manage-connections";
import { BankIcon } from "./icons";

/** The bank's logo (or a glyph); `dot` adds the status dot on its corner (list rows only). */
export function ConnectionLogo({ c, dot = true }: { c: BankConnection; dot?: boolean }) {
  return (
    <span className="mc-logo">
      {c.institution_logo ? (
        <img src={`data:image/png;base64,${c.institution_logo}`} alt="" />
      ) : (
        <BankIcon />
      )}
      {dot ? <span className="mc-dot" data-status={connectionGroup(c.status)} /> : null}
    </span>
  );
}
