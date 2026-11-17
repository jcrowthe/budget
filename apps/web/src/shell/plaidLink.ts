/** Plaid Link is loaded from Plaid's own script at the moment it is needed (no npm package). */
export const PLAID_LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export interface PlaidExitError {
  error_code?: string;
  error_message?: string;
  display_message?: string | null;
}
export interface PlaidSuccessMetadata {
  institution?: { name?: string; institution_id?: string } | null;
}
export interface PlaidCreateConfig {
  token: string;
  receivedRedirectUri?: string;
  onSuccess: (publicToken: string, metadata: PlaidSuccessMetadata) => void;
  onExit: (error: PlaidExitError | null, metadata?: unknown) => void;
}
export interface PlaidHandler {
  open(): void;
  exit?(opts?: { force?: boolean }): void;
  destroy?(): void;
}
export interface PlaidGlobal {
  create(config: PlaidCreateConfig): PlaidHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

let loading: Promise<PlaidGlobal> | null = null;

/** The only non-API error whose message is shown to the user. */
export class PlaidLoadError extends Error {
  constructor(message = "Plaid Link could not be loaded") {
    super(message);
    this.name = "PlaidLoadError";
  }
}

export function loadPlaidLink(): Promise<PlaidGlobal> {
  if (window.Plaid) return Promise.resolve(window.Plaid);
  if (!loading) {
    loading = new Promise<PlaidGlobal>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PLAID_LINK_SRC;
      s.async = true;
      s.onload = () => (window.Plaid ? resolve(window.Plaid) : reject(new PlaidLoadError()));
      s.onerror = () => {
        loading = null;
        s.remove();
        reject(new PlaidLoadError());
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export const LINK_STATE_KEY = "budget.plaidLink";
export interface LinkState {
  link_token: string;
  budget_id: string;
  query: string;
  /** Set when Link was opened from an account's Link Account: /plaid/oauth then links that account. */
  link_account_id?: string;
}

/** Kept in sessionStorage so /plaid/oauth can resume Link after an OAuth bank's redirect. */
export function saveLinkState(state: LinkState): void {
  try {
    sessionStorage.setItem(LINK_STATE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable: the OAuth page will say it cannot resume
  }
}

/** Reads and removes the saved state. */
export function takeLinkState(): LinkState | null {
  try {
    const raw = sessionStorage.getItem(LINK_STATE_KEY);
    sessionStorage.removeItem(LINK_STATE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LinkState>;
    if (typeof v.link_token !== "string" || typeof v.budget_id !== "string") return null;
    return {
      link_token: v.link_token,
      budget_id: v.budget_id,
      query: String(v.query ?? ""),
      ...(typeof v.link_account_id === "string" ? { link_account_id: v.link_account_id } : {}),
    };
  } catch {
    return null;
  }
}

export const plaidExitMessage = (err: PlaidExitError | null): string | null =>
  err?.display_message || err?.error_message || null;
