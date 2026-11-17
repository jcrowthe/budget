import type { Account } from "@budget/schema/accounts";
import type { BankAccount, BankConnection } from "@budget/schema/bank-connections";
import { bankAccountLabel, planAccountType } from "@budget/schema/bank-link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccounts } from "../api/accounts";
import { errorDetail, invalidateBankLink, linkAccount, startPlanSync } from "../api/bank-link";
import { localToday } from "../api/today";
import { ACCOUNT_TYPE_LABEL } from "./accountTypeLabels";
import { useBankSubline } from "./bank-link-accounts";
import { ChevronRightIcon } from "./icons";
import { usePlanFormatter } from "./plan-formats-context";

/** The plan accounts a bank account can be linked to: open, not linked, not Cash. */
export const linkChoices = (list: Account[] | undefined) =>
  (list ?? []).filter((a) => !a.closed && !a.linked && a.type !== "cash");

export function BankAccountOptions({
  budgetId,
  bank,
  onLinkExisting,
  onAddNew,
  onUnlink,
}: {
  budgetId: string;
  connection: BankConnection;
  bank: BankAccount;
  onLinkExisting: () => void;
  onAddNew: () => void;
  onUnlink: () => void;
}) {
  const accounts = useAccounts(budgetId);
  const subline = useBankSubline();
  const plan = accounts.data?.find((a) => a.id === bank.linked_account_id);
  const sub = subline(bank, plan?.type ?? planAccountType(bank.type, bank.subtype));
  return (
    <div className="account-modal-body">
      <p className="mc-sub" title={sub}>
        {sub}
      </p>
      {bank.linked_account_id !== null ? (
        <>
          <p className="mc-sentence">Linked to "{plan?.name ?? "an account"}" in this plan.</p>
          <button type="button" className="secondary mc-wide" onClick={onUnlink}>
            Unlink
          </button>
        </>
      ) : (
        <ul className="mc-list">
          <li>
            <button type="button" className="mc-row" onClick={onLinkExisting}>
              <span className="mc-lines">
                <span className="mc-line mc-name">Link to an Existing Account</span>
              </span>
              <ChevronRightIcon />
            </button>
          </li>
          <li>
            <button type="button" className="mc-row" onClick={onAddNew}>
              <span className="mc-lines">
                <span className="mc-line mc-name">Add as a new Account</span>
              </span>
              <ChevronRightIcon />
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export function LinkExistingAccount({
  budgetId,
  bank,
  onLinked,
}: {
  budgetId: string;
  bank: BankAccount;
  onLinked: () => void;
}) {
  const qc = useQueryClient();
  const fmt = usePlanFormatter();
  const accounts = useAccounts(budgetId);
  const choices = linkChoices(accounts.data);
  const label = bankAccountLabel(bank.name, bank.mask);
  const link = useMutation({
    mutationFn: (accountId: string) =>
      linkAccount(budgetId, accountId, { bank_account_id: bank.id, today: localToday() }),
    onSuccess: () => {
      invalidateBankLink(qc, budgetId);
      startPlanSync(qc, budgetId);
      onLinked();
    },
  });
  return (
    <div className="account-modal-body">
      <p className="mc-sentence" title={label}>
        Choose the account to link to "{label}".
      </p>
      {link.isError ? (
        <p className="error-bar mc-error" role="alert">
          {errorDetail(link.error)}
        </p>
      ) : null}
      {choices.length === 0 ? (
        <p className="mc-empty">
          There is no account in this plan to link. Add it as a new account instead.
        </p>
      ) : (
        <ul className="mc-list">
          {choices.map((a) => {
            const sub = `${ACCOUNT_TYPE_LABEL[a.type]} | ${fmt.money(a.balance)}`;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  className="mc-row"
                  aria-label={a.name}
                  disabled={link.isPending}
                  onClick={() => link.mutate(a.id)}
                >
                  <span className="mc-lines">
                    <span className="mc-line mc-name" title={a.name}>
                      {a.name}
                    </span>
                    <span className="mc-line" title={sub}>
                      {sub}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
