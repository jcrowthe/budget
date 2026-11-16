import type { BankConnection } from "@budget/schema/bank-connections";
import type { Institution } from "@budget/schema/institutions";
import { useEffect, useState } from "react";
import {
  createBankConnection,
  createLinkToken,
  useInstitutionSearch,
  usePopularInstitutions,
} from "../api/bank-connections";
import { ApiError } from "../api/client";
import { BankIcon, ChevronRightIcon } from "./icons";
import {
  loadPlaidLink,
  PlaidLoadError,
  plaidExitMessage,
  saveLinkState,
  takeLinkState,
} from "./plaidLink";

const GENERIC = "Something went wrong. Try again.";
const NOT_SET_UP = "bank_connections_not_set_up";

export function domainOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return url;
  }
}

const errorText = (e: unknown) =>
  e instanceof ApiError || e instanceof PlaidLoadError ? e.message : GENERIC;
const searchErrorText = (e: unknown) =>
  e instanceof ApiError && e.errorName === NOT_SET_UP ? e.detail : GENERIC;

function Logo({ institution, round }: { institution: Institution; round?: boolean }) {
  return institution.logo ? (
    <img src={institution.logo} alt="" className={round ? "bank-logo round" : "bank-logo"} />
  ) : (
    <span className={round ? "bank-logo round placeholder" : "bank-logo placeholder"}>
      <BankIcon />
    </span>
  );
}

export function BankSearch({
  budgetId,
  sandbox,
  variant,
  onUnlinked,
  onConnected,
  onLinkingChange,
}: {
  budgetId: string;
  sandbox: boolean;
  variant: "sidebar" | "connections";
  onUnlinked: () => void;
  onConnected: (c: BankConnection) => void;
  onLinkingChange?: (linking: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const popular = usePopularInstitutions(budgetId);
  const search = useInstitutionSearch(budgetId, debounced);

  function setLink(v: boolean) {
    setLinking(v);
    onLinkingChange?.(v);
  }

  async function startLink(institution: Institution) {
    setLinkError(null);
    setLink(true);
    try {
      const { link_token } = await createLinkToken(budgetId);
      const plaid = await loadPlaidLink();
      // OAuth banks leave the page: /plaid/oauth resumes from this state (production only).
      if (!sandbox) saveLinkState({ link_token, budget_id: budgetId, query });
      plaid
        .create({
          token: link_token,
          onSuccess: async (public_token, metadata) => {
            try {
              const connection = await createBankConnection({
                budget_id: budgetId,
                public_token,
                institution_id: metadata?.institution?.institution_id ?? institution.institution_id,
                institution_name: metadata?.institution?.name ?? institution.name,
              });
              takeLinkState();
              setLink(false);
              onConnected(connection);
            } catch (e) {
              takeLinkState();
              setLinkError(errorText(e));
              setLink(false);
            }
          },
          onExit: (err) => {
            takeLinkState();
            setLinkError(plaidExitMessage(err));
            setLink(false);
          },
        })
        .open();
    } catch (e) {
      takeLinkState();
      setLinkError(errorText(e));
      setLink(false);
    }
  }

  const showResults = debounced !== "";
  const results = search.data ?? [];
  const noMatch =
    showResults && search.isSuccess && !search.isPlaceholderData && results.length === 0;
  const popularNotSetUp =
    popular.error instanceof ApiError && popular.error.errorName === NOT_SET_UP;
  const fieldError = linkError
    ? linkError
    : showResults && search.isError
      ? searchErrorText(search.error)
      : !showResults && popularNotSetUp
        ? (popular.error as ApiError).detail
        : null;

  return (
    <div className="bank-search">
      <div className="bank-label-row">
        <label htmlFor="bank-search">Search for your bank</label>
        {sandbox ? (
          <span className="env-pill" title="Plaid Sandbox: test banks only">
            Sandbox
          </span>
        ) : null}
      </div>
      <input
        id="bank-search"
        className="account-field"
        // biome-ignore lint/a11y/noAutofocus: the source focuses the search when the modal opens
        autoFocus
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLinkError(null);
        }}
      />
      <em className="bank-note">Search by institution name or web address (URL)</em>
      {fieldError ? (
        <p className="field-error bank-error" role="alert">
          {fieldError}
        </p>
      ) : null}

      {!showResults && popular.data && popular.data.length > 0 ? (
        <>
          <h3>Popular Options</h3>
          <div className="popular-grid">
            {popular.data.map((i) => (
              <button
                key={i.institution_id}
                type="button"
                className="bank-tile"
                aria-label={i.name}
                title={i.name}
                disabled={linking}
                onClick={() => startLink(i)}
              >
                {i.logo ? (
                  <img src={i.logo} alt="" />
                ) : (
                  <>
                    <BankIcon />
                    <span>{i.name}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {showResults && results.length > 0 && !search.isError ? (
        <>
          <h3>Results</h3>
          <ul className="institution-list">
            {results.slice(0, 10).map((i) => (
              <li key={i.institution_id}>
                <button
                  type="button"
                  className="institution-row"
                  title={i.url ?? undefined}
                  disabled={linking}
                  onClick={() => startLink(i)}
                >
                  <Logo institution={i} round />
                  <span className="institution-text">
                    <span className="institution-name">{i.name}</span>
                    <span className="institution-country">{i.country}</span>
                    <span className="institution-domain">{domainOf(i.url)}</span>
                  </span>
                  <ChevronRightIcon />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {noMatch ? (
        <p className="bank-no-match">
          We couldn't find a financial institution named "{debounced}" that supports Direct Import.
          <br />
          <br />
          Don't worry, you can still{" "}
          {variant === "sidebar" ? (
            // An inline span (not a <button>) so the sentence wraps inside the phrase.
            // biome-ignore lint/a11y/useSemanticElements: must stay inline to wrap like running text
            <span
              role="button"
              tabIndex={0}
              className="link-button"
              onClick={onUnlinked}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onUnlinked();
                }
              }}
            >
              continue setting up this account
            </span>
          ) : (
            "continue setting up this account"
          )}
          .
        </p>
      ) : null}

      {!showResults && variant === "sidebar" ? (
        <>
          <div className="or-divider">
            <span>or</span>
          </div>
          <button type="button" className="secondary large" onClick={onUnlinked}>
            Add an Unlinked Account
          </button>
        </>
      ) : null}
    </div>
  );
}
