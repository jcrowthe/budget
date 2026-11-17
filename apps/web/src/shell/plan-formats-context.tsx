import { DEFAULT_FORMATTER, type PlanFormatter, planFormatter } from "@budget/schema/plan-formats";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useCurrentPlan } from "./useCurrentPlan";

const Ctx = createContext<PlanFormatter>(DEFAULT_FORMATTER);

/** The open plan's formats for every amount and date below (the plan list the shell already loads). */
export function PlanFormatsProvider({ children }: { children: ReactNode }) {
  const { plan } = useCurrentPlan();
  const currency = plan?.currency_format;
  const date = plan?.date_format;
  const formatter = useMemo(
    () =>
      currency && date
        ? planFormatter({ currency_format: currency, date_format: date })
        : DEFAULT_FORMATTER,
    [currency, date],
  );
  return <Ctx.Provider value={formatter}>{children}</Ctx.Provider>;
}

/** The formatter of the open plan; the default formats outside a plan. */
export function usePlanFormatter(): PlanFormatter {
  return useContext(Ctx);
}
