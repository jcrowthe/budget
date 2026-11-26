import { paymentDisplay } from "@budget/schema/card-payments";
import { bulkRefusalText, countLabel } from "@budget/schema/register-selection";
import {
  SCHEDULED_CATEGORIZE_NONE,
  type ScheduledBulkRequest,
  scheduledCategorizeSkip,
  scheduledSkipText,
} from "@budget/schema/scheduled-transactions";
import type { FlagColor } from "@budget/schema/transactions";
import { transferCellText } from "@budget/schema/transfers";
import { type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAccounts } from "../api/accounts";
import { ApiError } from "../api/client";
import { useScheduledBulk } from "../api/scheduledTransactions";
import { useEditFlagsDialog } from "../flag-names/useEditFlagsDialog";
import { usePlanFormatter } from "../shell/plan-formats-context";
import { useCurrentPlan } from "../shell/useCurrentPlan";
import { Tip } from "./BarTip";
import { BulkCategorize } from "./BulkCategorize";
import { MemoDialog } from "./BulkDialogs";
import { FlagMenu } from "./FlagMenu";
import { CategorizeIcon, CloseSmallIcon, FlagFilledIcon, MoreDotsIcon } from "./icons";
import { MoreMenu, PointAnchor } from "./MoreMenu";
import { REPEAT_ON_SCHEDULED } from "./makeRepeating";
import { useOpenAccounts } from "./openAccounts";
import { scheduledRowKey } from "./scheduledKeys";
import { useSelection } from "./selection";

const noop = () => {};

/**
 * The floating bar of a selection of scheduled rows. Enter Now and Delete come in through props; Categorize,
 * Flag, Memo and Move to Account (EXF-657) are sent from here, to the bulk route, on the series ids of the
 * selection. Duplicate and Export stay disabled with their reason. A selection that mixes real and scheduled rows
 * shows this bar and acts on the scheduled rows only, as the bar already did. It is drawn like the real rows' bar.
 */
export function ScheduledBar({
  box,
  count,
  error,
  busy,
  menuAt,
  onCloseMenuAt,
  onDeselect,
  onEnter,
  onDelete,
}: {
  box: { left: number; width: number };
  count: number;
  error: string | null;
  busy: boolean;
  /** A right-click on a scheduled row opened the More menu at this point. */
  menuAt: { x: number; y: number; key: number } | null;
  onCloseMenuAt: () => void;
  onDeselect: () => void;
  onEnter: () => void;
  onDelete: () => void;
}) {
  const { budgetId = "" } = useCurrentPlan();
  const { scheduled, scheduledRows, clear } = useSelection();
  const accountsQ = useAccounts(budgetId);
  const { openAccounts } = useOpenAccounts(budgetId);
  const own = useScheduledBulk(budgetId);
  const editFlags = useEditFlagsDialog(budgetId);
  const fmt = usePlanFormatter();
  const [more, setMore] = useState(false);
  const [pick, setPick] = useState<null | "categorize" | "flag">(null);
  const [memo, setMemo] = useState(false);
  const [localError, setLocalError] = useState<ReactNode>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const catBtn = useRef<HTMLButtonElement>(null);
  const flagBtn = useRef<HTMLButtonElement>(null);
  const working = busy || own.isPending;

  const sel = scheduledRows.filter((r) => scheduled.has(scheduledRowKey(r)));
  const ids = [...new Set(sel.map((r) => r.id))];
  // A series selected only through its mirror row: move leaves it to its own account.
  const mirrorOnly = ids.filter((id) => sel.every((r) => r.id !== id || r.mirror));
  const accountOf = (id: string) => accountsQ.data?.find((a) => a.id === id);
  const canCategorize = sel.some(
    (r) =>
      scheduledCategorizeSkip({
        split: r.subtransactions.length > 0,
        onBudget: accountOf(r.account_id)?.on_budget ?? true,
        other: r.transfer_account_id
          ? { onBudget: accountOf(r.transfer_account_id)?.on_budget ?? true }
          : null,
      }) === null,
  );
  const holdsAll = sel.length > 0 && sel.every((r) => r.account_id === sel[0]?.account_id);
  const moveTo = openAccounts
    .filter((a) => !(holdsAll && a.id === sel[0]?.account_id))
    .map((a) => ({ id: a.id, name: a.name }));

  /** "<payee> on <date> (<amount>)" for the selected row of a series. */
  const labelOf = (id: string): string | null => {
    const r = sel.find((x) => x.id === id);
    if (!r) return null;
    const side = accountOf(r.account_id);
    const other = r.transfer_account_id ? (accountOf(r.transfer_account_id) ?? null) : null;
    const payee =
      (side ? paymentDisplay(side, other)?.payee : undefined) ??
      (r.transfer_account_name ? transferCellText(r.transfer_account_name) : r.payee_name);
    return `${payee ?? "The scheduled transaction"} on ${fmt.date(r.date_next)} (${fmt.money(r.amount)})`;
  };
  const send = async (req: ScheduledBulkRequest, keepSelection = true) => {
    setLocalError(null);
    try {
      const r = await own.mutateAsync(req);
      if (r.skipped.length > 0) {
        setLocalError(
          <>
            {r.skipped.map((k) => {
              const row = sel.find((x) => x.id === k.id);
              const seriesAccountName = row?.mirror ? (row.transfer_account_name ?? "") : "";
              return (
                <div key={k.id}>
                  {labelOf(k.id) ?? "1 of the selected scheduled transactions"}:{" "}
                  {scheduledSkipText(k.reason, { seriesAccountName })}
                </div>
              );
            })}
          </>,
        );
      } else if (!keepSelection && r.results.length > 0) {
        clear();
      }
    } catch (e) {
      setLocalError(
        e instanceof ApiError
          ? bulkRefusalText(e.detail, labelOf)
          : e instanceof Error
            ? e.message
            : "That did not work",
      );
    }
  };
  const closeAll = () => {
    setMore(false);
    setPick(null);
    onCloseMenuAt();
  };
  const menu = (anchor: HTMLElement, placement: "above" | "right") => (
    <MoreMenu
      scheduled
      anchor={anchor}
      placement={placement}
      count={count}
      unclear={false}
      makeRepeating={{ reason: REPEAT_ON_SCHEDULED }}
      moveTo={moveTo}
      onClose={closeAll}
      onUnclear={noop}
      onDuplicate={noop}
      onMemo={() => {
        closeAll();
        setMemo(true);
      }}
      onMove={(accountId) => {
        closeAll();
        // The selection stays when something was skipped, so the alert and the rows remain on screen.
        void send(
          {
            op: "move",
            ids,
            value: accountId,
            ...(mirrorOnly.length > 0 ? { mirror_ids: mirrorOnly } : {}),
          },
          false,
        );
      }}
      onExport={noop}
      onDelete={() => {
        closeAll();
        setLocalError(null);
        onDelete();
      }}
    />
  );
  return (
    <>
      {createPortal(
        <div className="register-action-bar-container" style={{ left: box.left, width: box.width }}>
          {(localError ?? error) ? (
            <div className="register-action-bar-error" role="alert">
              {localError ?? error}
            </div>
          ) : null}
          <div className="register-action-bar-inner" role="toolbar" aria-label="Selection actions">
            <button
              type="button"
              className="action-bar-button action-bar-uncheck"
              title="Deselect all"
              onClick={() => {
                setLocalError(null);
                onDeselect();
              }}
            >
              <CloseSmallIcon />
              {countLabel(count)}
            </button>
            <hr />
            <Tip text="Enter Now" keys={["E"]}>
              {(tip) => (
                <button
                  {...tip}
                  type="button"
                  className="action-bar-button"
                  disabled={working}
                  onClick={() => {
                    setLocalError(null);
                    onEnter();
                  }}
                >
                  Enter Now
                </button>
              )}
            </Tip>
            <button
              ref={catBtn}
              type="button"
              className="action-bar-button"
              aria-haspopup="menu"
              disabled={working || !canCategorize}
              aria-disabled={canCategorize ? undefined : "true"}
              title={canCategorize ? undefined : SCHEDULED_CATEGORIZE_NONE}
              onClick={() => {
                closeAll();
                setPick("categorize");
              }}
            >
              <CategorizeIcon />
              Categorize
            </button>
            <button
              ref={flagBtn}
              type="button"
              className="action-bar-button"
              aria-haspopup="menu"
              disabled={working}
              onClick={() => {
                closeAll();
                setPick("flag");
              }}
            >
              <FlagFilledIcon />
              Flag
            </button>
            <hr />
            <button
              ref={moreBtn}
              type="button"
              className="action-bar-button"
              aria-haspopup="menu"
              onClick={() => {
                onCloseMenuAt();
                setMore((m) => !m);
              }}
            >
              <MoreDotsIcon />
              More
            </button>
          </div>
        </div>,
        document.body,
      )}
      {pick === "categorize" && catBtn.current ? (
        <BulkCategorize
          anchor={catBtn.current}
          budgetId={budgetId}
          onClose={closeAll}
          onPick={(value) => {
            closeAll();
            void send({ op: "categorize", ids, value });
          }}
        />
      ) : null}
      {pick === "flag" && flagBtn.current ? (
        <FlagMenu
          anchor={flagBtn.current}
          placement="above"
          flagged={sel.some((r) => r.flag_color)}
          onClose={closeAll}
          onEditFlags={editFlags.open}
          onPick={(value: FlagColor | null) => {
            closeAll();
            void send({ op: "flag", ids, value });
          }}
        />
      ) : null}
      {memo ? (
        <MemoDialog
          count={ids.length}
          onCancel={() => setMemo(false)}
          onUpdate={(text) => {
            setMemo(false);
            void send({ op: "memo", ids, value: text });
          }}
        />
      ) : null}
      {more && moreBtn.current ? menu(moreBtn.current, "above") : null}
      {menuAt ? (
        <PointAnchor key={menuAt.key} x={menuAt.x} y={menuAt.y}>
          {(anchor) => menu(anchor, "right")}
        </PointAnchor>
      ) : null}
      {editFlags.dialog}
    </>
  );
}
