# Register search (EXF-528): design

The register's search box filters one account's register, or All Accounts, with free text and typed tokens. The
server parses the same token grammar, so the REST list routes (`?q=`) and the MCP tool `search_transactions` give
the same rows as the UI.

## Grammar (`packages/schema/src/transaction-search.ts`)

- A query is segments separated by `,`. Empty segments are skipped, so a trailing `, ` is harmless. Segments are
  ANDed.
- `label: value`, label case-insensitive, one of `Payee`, `Category`, `Memo`, `Account`, `Flag`, `Is`, `On`,
  `Before`, `After`, `Outflow`, `Inflow`, `Income`. Any other segment, including one with an unknown label such as
  `Transfer : Checking`, is free text matched against any field.
- An empty value (`Payee:`) is skipped. A value that cannot be read (`Is: banana`, `Outflow: abc`, a bad date) is a
  422 `unprocessable_entity` from the API (a tool error in MCP). The UI leaves such segments out while the person is
  still typing them, so it never sees the 422.
- At most 10 tokens and 500 characters (keeps every statement far under D1's 100 bound parameters).

| Token | Matches |
| --- | --- |
| free text | payee, category, memo or account name contains the text |
| `Payee: x` | the payee as the register shows it (`Transfer : <account>` for a transfer) contains `x` |
| `Category: x` | the category name contains `x`; `Ready to Assign` for a Ready to Assign inflow |
| `Memo: x` | the memo contains `x` |
| `Account: x` | the account name contains `x` |
| `Flag: None` / `Red` … `Purple` | no flag / that flag |
| `Is: Uncleared` / `Cleared` / `Reconciled` | `cleared` is that status |
| `Is: Unreconciled` / `Cleared or Reconciled` | not reconciled / cleared or reconciled |
| `Is: Matched` | an import matched to a row entered by hand (`import_id` set, `source` null) |
| `Is: Approved` / `Unapproved` | `approved` |
| `Is: Needs Category` | the needs-category rule of the attention banner |
| `Is: Unapproved or Needs Category` | the attention banner's rule (`needsAttention`) |
| `On:` / `Before:` / `After:` date | date equal / on or before / on or after |
| `Outflow: 20`, `>=20`, `<=20` | an outflow whose size equals / is at least / at most 20.00 |
| `Inflow: …` | the same for inflows |
| `Income: November 2026` | Ready to Assign inflows dated in that month |

Text matching is case-insensitive substring (SQL `lower(...) like ? escape '\'`, with `%`, `_` and `\` escaped, all
values bound as parameters; no FTS). Dates are read in the plan's date format or as ISO `YYYY-MM-DD`; a date without
a year takes the current year. Amounts are read with `.` as the decimal point and an optional currency symbol.

## Split transactions

Each split line is tested on its own: category, memo, amount and payee are the line's (the payee falls back to the
parent's); account, date, flag, status and approval are the parent's. The parent is listed when it matches itself
or when any line matches. The API returns a listed parent with all its lines (the lines still add up to the
amount); the register hides the lines that do not match, with the same predicate (`lineMatches`).

## Server (one statement, constant calls)

`q` is a query parameter of `GET /budgets/{budget_id}/accounts/{account_id}/transactions` and
`GET /budgets/{budget_id}/transactions`. The service parses it with the plan row it already reads (for the date
format), and the repository adds one condition to the existing list statement: the token conditions on the row, or
an `exists` over its live lines. No extra D1 call and no `IN` list: the call count is the same with and without `q`,
for 10 and for 100 rows (`test/transaction-search-calls.test.ts`). The running balance still counts every row of
the account, because its window runs in its own subquery. `q` combines (AND) with `since_date` and `needs`.

## MCP

`search_transactions({ budget_id, query, account_id? })` runs the same service as the REST routes with `q = query`,
and returns the same `data`. The two list operations name it in `test/mcp-coverage/transactions.ts`.

## UI

- The search box at the toolbar's right (`Search <account name>`, magnifier, ⓧ once there is text) is a combobox.
  Suggestions are computed in the browser for the segment after the last comma: context suggestions (categories,
  accounts, flags, the ten Is options, dates, amounts, the Income hint), then the four "Find" entries.
- Choosing a suggestion, or Enter, writes the token and `, `, keeps focus in the box and applies the search. Typing
  applies the search after 250 ms. ArrowUp/ArrowDown move through the list; Escape closes it and keeps the text.
- While a search is applied the register asks the server with `q`, does not apply the View date range or the
  reconciled option (a match is never hidden by them), hides scheduled rows, and shows
  `Some transactions are hidden by your search for "<first token>".` with View All. With no match, that footer is
  the empty state. ⓧ and View All clear the search.
- The search is page state, like the attention filter: not in the URL, not stored, reset when the account changes.

## Departures and assumptions

- **Parameters**: only `q`. The ticket's structured parameters (`payee`, `category_id`, …) are offered as an
  alternative ("or"); they are not added.
- **Banner View**: the ticket's note that the new-transactions banner's View fills
  `Is: Unapproved or Needs Category, ` (EXF-463) is not done here: the banner's chip filter
  (`register/AttentionBanner.tsx`, `register/attention-filter.tsx`) is outside this Build's files, and the
  register-approve specs assert on the chip. Follow-up.
- **Any field**: payee, category, memo and account name. Amounts are not matched by free text (use Outflow/Inflow).
  Assumed; not observed.
- **View options while searching**: assumed that a search spans every date and reconciled row. Not observed.
- **Case**: SQLite's `lower` and `like` fold ASCII only, so `É` and `é` differ.
- **Commas**: a comma ends a token, so text containing a comma, and amounts written with a decimal comma
  (`20,50`), cannot be searched.
- **Category tokens** match by substring, so `Category: Fun` also lists `Fun Money`.
