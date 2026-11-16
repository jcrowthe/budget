import type { APIRequestContext, Page } from "@playwright/test";
import { authHeaders } from "./auth";
import { call } from "./register-seed";

export type Sched = {
  id: string;
  account_id: string;
  date_first: string;
  date_next: string;
  frequency: string;
  amount: number;
  payee_name: string | null;
  category_id: string | null;
  memo: string | null;
};

/** The three days the date-dependent specs run under: a mid month, a month end and a year end. */
export const CLOCKS = ["2026-11-15", "2026-11-30", "2026-12-31"] as const;

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mmddyyyy = (iso: string) =>
  `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** The browser's clock, fixed at local noon of `day`: the app's "today" is then `day`. */
export const fixClock = (page: Page, day: string) =>
  page.clock.setFixedTime(new Date(`${day}T12:00:00`));

const base = (plan: string) => `/api/v1/budgets/${plan}/scheduled-transactions`;

/** Creates a schedule through the API with `today` sent, as the web app does. */
export const createSched = async (
  request: APIRequestContext,
  plan: string,
  today: string,
  body: Record<string, unknown>,
) =>
  (await call(request, "POST", `${base(plan)}?today=${today}`, body)) as {
    scheduled_transaction: Sched;
    transaction: { id: string; date: string; approved: boolean } | null;
  };

export const listSched = async (request: APIRequestContext, plan: string, account?: string) =>
  (await call(request, "GET", `${base(plan)}${account ? `?account_id=${account}` : ""}`))
    .scheduled_transactions as Sched[];

export const enterDueApi = async (request: APIRequestContext, plan: string, today: string) =>
  (await call(request, "POST", `${base(plan)}/enter-due?today=${today}`, {})) as {
    entered: { scheduled_transaction_id: string; transaction_id: string; date: string }[];
  };

/** The status of GET .../{id}: 404 once a schedule is deleted or entered as a one-off. */
export const schedStatus = async (request: APIRequestContext, plan: string, id: string) =>
  (await request.get(`${base(plan)}/${id}`, { headers: await authHeaders() })).status();
