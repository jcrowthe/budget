import type { AccountCreateRequest } from "@budget/schema/accounts";
import type { MonthGroupDetail } from "@budget/schema/months";
import { useMonth } from "../api/months";
import { localToday } from "../api/today";
import "./add-account-loan-steps.css";

/** The loan fields the form holds as typed text. */
export type LoanFields = { rate: string; payment: string };

export function LoanBalanceFields({
  balance,
  rate,
  payment,
  onBalance,
  onRate,
  onPayment,
}: {
  balance: string;
  rate: string;
  payment: string;
  onBalance: (v: string) => void;
  onRate: (v: string) => void;
  onPayment: (v: string) => void;
}) {
  return (
    <>
      <div className="loan-balance-row">
        <div className="loan-balance">
          <label htmlFor="account-balance">Current account balance</label>
          <input
            id="account-balance"
            className="account-field"
            inputMode="decimal"
            value={balance}
            onChange={(e) => onBalance(e.target.value)}
          />
        </div>
        <div className="loan-rate">
          <label htmlFor="account-rate">Interest rate</label>
          <div className="loan-rate-box">
            <input
              id="account-rate"
              className="account-field"
              inputMode="decimal"
              value={rate}
              onChange={(e) => onRate(e.target.value)}
            />
            <span className="loan-rate-suffix" aria-hidden="true">
              %
            </span>
          </div>
        </div>
      </div>
      <label htmlFor="account-payment">Monthly payment required by your lender</label>
      <input
        id="account-payment"
        className="account-field"
        inputMode="decimal"
        value={payment}
        onChange={(e) => onPayment(e.target.value)}
      />
      <p className="help">
        Enter the total amount you are required to pay your lender each month, including principal,
        interest, escrow, fees, etc.
      </p>
      <p className="help">You can add extra payments as a target in your plan later.</p>
    </>
  );
}

export function EscrowStep({
  yes,
  amount,
  onYes,
  onAmount,
}: {
  yes: boolean;
  amount: string;
  onYes: (v: boolean) => void;
  onAmount: (v: string) => void;
}) {
  return (
    <>
      <p className="label">
        Are there escrow installments or other fees included in your mortgage payments?
      </p>
      <p className="loan-step-text">
        This would only apply if your bank collects your property taxes on behalf of your city or if
        it collects other fees as part of your payment.
      </p>
      <label className="loan-choice">
        <input type="radio" name="escrow" checked={!yes} onChange={() => onYes(false)} />
        <span>No</span>
      </label>
      <label className="loan-choice">
        <input type="radio" name="escrow" checked={yes} onChange={() => onYes(true)} />
        <span>Yes</span>
      </label>
      {yes ? (
        <>
          <label htmlFor="account-escrow">How much is the monthly escrow or fee?</label>
          <input
            id="account-escrow"
            className="account-field"
            inputMode="decimal"
            value={amount}
            onChange={(e) => onAmount(e.target.value)}
          />
        </>
      ) : null}
    </>
  );
}

export const NEW_GROUP = "__new__";

/** The pairing step's choices. `groupChoice` is "" (none yet), NEW_GROUP or a group id. */
export type PairState = {
  mode: "existing" | "new";
  categoryId: string;
  name: string;
  groupChoice: string;
  groupName: string;
};
export const emptyPair: PairState = {
  mode: "existing",
  categoryId: "",
  name: "",
  groupChoice: "",
  groupName: "",
};

/** Next is enabled when a category is chosen, or a name and a group (and a group name for a new group). */
export function pairReady(p: PairState): boolean {
  if (p.mode === "existing") return p.categoryId !== "";
  if (!p.name.trim() || p.groupChoice === "") return false;
  return p.groupChoice !== NEW_GROUP || !!p.groupName.trim();
}

export function pairRequest(
  p: PairState,
): Pick<AccountCreateRequest, "paired_category_id" | "new_category"> {
  if (p.mode === "existing") return { paired_category_id: p.categoryId };
  return {
    new_category:
      p.groupChoice === NEW_GROUP
        ? { name: p.name.trim(), new_group_name: p.groupName.trim() }
        : { name: p.name.trim(), group_id: p.groupChoice },
  };
}

const usable = (g: MonthGroupDetail) => !g.hidden && g.kind === null;

export function PairCategoryStep({
  budgetId,
  value,
  onChange,
}: {
  budgetId: string;
  value: PairState;
  onChange: (v: PairState) => void;
}) {
  const month = useMonth(budgetId, `${localToday().slice(0, 7)}-01`);
  const groups = (month.data?.groups ?? []).filter(usable);
  const set = (patch: Partial<PairState>) => onChange({ ...value, ...patch });
  return (
    <>
      <h3 className="loan-step-heading">Pair your loan with a plan category</h3>
      <p className="loan-step-text">
        Pairing with a plan category helps better show how your payments will affect your debt.
        Pairing works best when there is a one-to-one relationship between your loan account and a
        plan category.
      </p>
      <p className="label">Which category do you want to pair your loan with?</p>
      <label className="loan-choice">
        <input
          type="radio"
          name="pair-mode"
          checked={value.mode === "existing"}
          onChange={() => set({ mode: "existing" })}
        />
        <span>
          Select an existing category
          <span className="loan-choice-sub">Pair with a category already in your plan</span>
        </span>
      </label>
      {value.mode === "existing" ? (
        <>
          <label htmlFor="pair-category">Select a category</label>
          <select
            id="pair-category"
            className="account-field"
            value={value.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
          >
            <option value="" />
            {groups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                {g.categories
                  .filter((c) => !c.hidden && c.kind === null)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </>
      ) : null}
      <label className="loan-choice">
        <input
          type="radio"
          name="pair-mode"
          checked={value.mode === "new"}
          onChange={() => set({ mode: "new" })}
        />
        <span>
          Create a new category
          <span className="loan-choice-sub">Pair with a brand new category</span>
        </span>
      </label>
      {value.mode === "new" ? (
        <>
          <label htmlFor="pair-name">Give your category a name</label>
          <input
            id="pair-name"
            className="account-field"
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
          />
          <label htmlFor="pair-group">Add to category group</label>
          <select
            id="pair-group"
            className="account-field"
            value={value.groupChoice}
            onChange={(e) => set({ groupChoice: e.target.value })}
          >
            <option value="" hidden disabled />
            <option value={NEW_GROUP}>New Category Group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {value.groupChoice === NEW_GROUP ? (
            <>
              <label htmlFor="pair-group-name">New category group name</label>
              <input
                id="pair-group-name"
                className="account-field"
                value={value.groupName}
                onChange={(e) => set({ groupName: e.target.value })}
              />
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
