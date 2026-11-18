import { CLOSED_NOTICE } from "@budget/schema/connection-status";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { errorDetail, invalidateBankLink, syncConnection } from "../api/bank-link";
import { createUpdateLinkToken, finishReset } from "../api/manage-connections";
import { loadPlaidLink, PlaidLoadError, plaidExitMessage } from "./plaidLink";

/**
 * Repair and Reset (both): the bank's sign-in again for one connection.
 * 1. POST link-token (update mode); 2. the sign-in window; 3. on success POST reset (status connected,
 * last_reset_at now), then one POST sync (not awaited); on exit nothing is written.
 */
export function useConnectionRelink(
  budgetId: string,
  connectionId: string,
  onLinkingChange: (open: boolean) => void,
) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);

  async function start(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setError(null);
    setNotice(null);
    const finish = () => {
      busy.current = false;
      setRunning(false);
      onLinkingChange(false);
    };
    try {
      const { link_token } = await createUpdateLinkToken(budgetId, connectionId);
      const plaid = await loadPlaidLink();
      onLinkingChange(true);
      plaid
        .create({
          token: link_token,
          onSuccess: () => {
            finishReset(budgetId, connectionId)
              .then(() => {
                invalidateBankLink(qc, budgetId);
                syncConnection(budgetId, connectionId)
                  .catch(() => undefined)
                  .finally(() => invalidateBankLink(qc, budgetId));
              })
              .catch((e) => setError(errorDetail(e)))
              .finally(finish);
          },
          onExit: (err) => {
            const message = plaidExitMessage(err);
            if (message) setError(message);
            else setNotice(CLOSED_NOTICE);
            finish();
          },
        })
        .open();
    } catch (e) {
      setError(e instanceof PlaidLoadError ? e.message : errorDetail(e));
      finish();
    }
  }

  return {
    start,
    running,
    error,
    notice,
    clearError: () => {
      setError(null);
      setNotice(null);
    },
  };
}
