# Clone journal

## 2026-11-15 · Exchange 1: discovery before the architecture proposal

Start mode: discover. Repository was empty (README only). No tickets, no children yet (0 of 200).

### Access rules the person set (apply to every child)

- Source test space: the YNAB plan "Test Budget" (`542b334b-696e-4418-937a-5e2c21a8b45c`). Free to modify.
- Plan "Programmatik" (`85810fb1-…`): view only, never modify. The one account page the person named
  (`/accounts/f6b37d1e-…`) is the reference for a live linked account.
- No other plan may be opened or read. Do not open the plan switcher list unless a ticket needs it, and
  record nothing from it.
- Gather no more of the person's data than a ticket needs. No real balances, payees or amounts in tickets,
  fixtures, screenshots committed to the repo, or this journal.

### What I saw in the source app

- Shell: left sidebar (plan name menu, Plan, Reflect, All Accounts, account groups with balances, Add Account,
  Bank Connections), dark theme.
- Plan screen: month navigator with month note, Ready to Assign pill, view chips (All, Underfunded, Overfunded,
  Money Available, Snoozed), toolbar (Category Group, Undo, Redo, Recent Moves), grid of groups and categories
  with Assigned / Activity / Available, right panel (month summary, Cost to Be Me, Auto-Assign, Assigned in
  Future Months).
- Category inspector: available balance breakdown (cash left over, assigned this month, cash spending, credit
  spending), Target (Weekly / Monthly / Yearly / Custom, amount, due day, "next month I want to" behaviour),
  Auto-Assign (Assigned Last Month, Spent Last Month, Average Assigned, Average Spent, Reset Available,
  Reset Assigned), notes.
- Add Account: bank search plus "Add an Unlinked Account". Types: Checking, Savings, Cash; Credit Card,
  Line of Credit; Mortgage, Auto Loan, Student Loan, Personal Loan, Medical Debt, Other Debt; Asset, Liability.
- Account register: cleared + uncleared = working balance, Reconcile, Add Transaction, File Import, Undo/Redo,
  View, search; columns flag, date, payee, category, memo, outflow, inflow, cleared. Linked account shows a
  "N new transactions to approve or categorize" banner, "This needs a category" pills, and a
  "Connection Repair Needed" state with a Repair button.
- Reflect: Spending Breakdown, Spending Trends, Net Worth, Income v Expense, Age of Money.

### Facts checked outside the app

- `doxen.dev` is on Cloudflare nameservers. `budget.doxen.dev` already has an A record pointing at a private
  LAN address; the deploy has to replace it. Needs the person's OK.
- No Cloudflare or Plaid credentials are in the environment yet.
- Plaid dashboard: the team still has four tasks open before it gets production data (select products, choose
  plan, verify business, submit request). Only the person can finish them. Plaid's free Trial plan: 10 Items,
  removed Items do not free a slot, OAuth banks such as Chase included, for teams created on or after
  2026-04-15. So tests must never spend a production Item: Sandbox only.
- Cloudflare Access "Managed OAuth" on a self-hosted application lets MCP clients sign in through Access; the
  Worker still receives `Cf-Access-Jwt-Assertion`. Whether Managed OAuth and a Service Auth policy work on the
  same application is not documented: verify in the scaffold, fall back to a second Access application on
  `/mcp`.
- Cloudflare's stateless MCP handler (`createMcpHandler`, streamable HTTP) runs in a plain Worker; `McpAgent`
  is deprecated. Check the exact package versions at scaffold time.

### Decisions I made and why

- No Plaid webhooks: polling from a Durable Object alarm instead. A webhook needs a public path outside
  Access, and the person made "everything behind Access" a hard requirement.
- YNAB history import from YNAB's export file, not the YNAB API: an API token would expose every plan to the
  children, which the person forbade.
- Proposed plan after approval: scaffold Build first, Discover children for the areas in the proposal in
  parallel, then Builds by disjoint manifest.
