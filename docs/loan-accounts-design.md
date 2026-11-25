# Loan accounts design (EXF-482)

Add Unlinked Account for the six **Mortgages and Loans** types (Mortgage, Auto Loan, Student Loan, Personal
Loan, Medical Debt, Other Debt): the balance, interest rate and required monthly payment, an escrow step for
Mortgage, and an optional category pairing (existing category, or a new one in an existing or new group).
This ticket only **records** the values; the loan page, payoff and paired-category targets are area 6.
Builds on [accounts-design.md](accounts-design.md) (EXF-481).

## Source: observed vs assumed

Studied read-only on 2026-11-25 in the owner's signed-in session, without pressing Skip or the final Next
(nothing was created). The owner's own plan data was not recorded: only structure and copy.

**Observed**

- Choosing Mortgage replaces "What is your current account balance?" with a split row: "Current account
  balance" (left) and "Interest rate" (right, a `%` label inside the input), then full-width "Monthly
  payment required by your lender", then two notes in italics: "Enter the total amount you are required to
  pay your lender each month, including principal, interest, escrow, fees, etc." and "You can add extra
  payments as a target in your plan later."
- Next on step 1 is enabled only when nickname, type, balance, interest rate **and** monthly payment are all
  non-empty. Clearing either the rate or the payment disables it again. Rate `0`, `101` and `abc` all enable
  Next, and `abc` goes on to the next step: the source does not check the rate there.
- Mortgage step 2 is titled "Add Linked Accounts" (the ticket's copy bug). It asks "Are there escrow
  installments or other fees included in your mortgage payments?", with the help paragraph and radios No
  (checked) and Yes. Yes reveals "How much is the monthly escrow or fee?" (`inputmode="decimal"`). Next stays
  enabled when that field is empty.
- Step 3 is titled "Optional: Pair a Category". It has the heading, paragraph and question from the ticket,
  and radios "Select an existing category" (checked) and "Create a new category", each with a subtitle.
  - **Existing**: a native `<select>` labelled "Select a category". Its first option is empty, then one
    `<optgroup>` per category group. No Credit Card Payments optgroup was present.
  - **New**: "Give your category a name" (text) and "Add to category group" (native select). That select's
    options are an empty first option (selected), then "New Category Group", then the groups. Choosing "New
    Category Group" reveals "New category group name".
  - Footer: Skip (always enabled) and Next. Next is enabled when an existing category is selected, or when
    the name is given and a group is chosen, plus the group name when that group is "New Category Group".
    Clearing any of these disables it again.

**From the ticket, not re-observed** (it would need a create): Auto Loan and the other non-Mortgage loans go
straight to step 3. Skip/Next lead to "Success!". The sidebar row, the Starting Balance row and the Ready to
Assign rule.

**Assumed** (could not be seen without creating something)

- Where a new group and a new category land: at the **end** of the plan's groups, and at the end of the
  chosen group (D6).
- Hidden categories and hidden groups are not offered in either select, nor is the Credit Card Payments
  group or its categories (D5).
- A server refusal at the last step (name taken) returns to step 1 with the nickname error (D11).

## Decisions

- **D1 Storage.** Four nullable columns are added to `accounts`: `interest_rate TEXT` (decimal string),
  `minimum_payment INTEGER` and `escrow_amount INTEGER` (milliunits), and `paired_category_id TEXT`. The loan
  type is `accounts.type`, so there is no separate column. A non-loan account stores NULL in all four.
  Accounts linked from a bank or imported store NULL until the loan's edit dialog (area 6) can set them.
- **D2 Required fields.** For a loan type, `interest_rate` and `minimum_payment` are required, because the
  source will not let you continue without them. `escrow_amount` is optional and stored as 0. Pairing is
  optional.
- **D3 Rate format.** The rate is a string matching `^\d{1,3}(\.\d{1,3})?$`, between 0 and 100. It is
  stored in canonical form ("06.50" → "6.5", "0.0" → "0") using string operations only, never a float.
- **D4 Escrow for any loan type.** The API accepts `escrow_amount` for every loan type, since the ticket
  says "for loan types only". The UI asks for it on Mortgage only.
- **D5 Pairing.** A request sends exactly one of `paired_category_id`, or `new_category {name, group_id |
  new_group_name}` with exactly one of `group_id` and `new_group_name`. The category or group must be active,
  belong to the plan, be visible, and not be the Credit Card Payments group or a payment category.
- **D6 Placement.** A new group goes at the end of the plan's groups. A new category goes at the end of its
  group.
- **D7 Refusals.**
  - Loan fields on a non-loan type, a missing rate or payment, a bad rate, both pairing forms, or an
    unusable category or group: 422 `unprocessable_entity`.
  - The new category's name already used in its group: 422 with "A category with this name already exists
    in this group".
  - The new group's name already used: 422 with "This group name already exists".
  - The account name already used: 409 `name_taken`, unchanged.
  - Through MCP the same refusal is a tool error with the same text, and nothing is written.
- **D8 Reads.** `Account` gains `interest_rate`, `minimum_payment`, `escrow_amount` and
  `paired_category_id` on every read: GET, list, create, update and the MCP tools. The create response keeps
  its shape, `{ account, starting_balance }`.
- **D9 UI checks the rate.** Unlike the source, Budget checks the rate when you press Next on step 1 (0–100,
  up to three decimals). The account is only created two steps later, and a 422 there would point back at a
  field that is no longer on screen.
- **D10 Group select.** It starts with a hidden, disabled empty placeholder, so nothing is chosen. The
  visible options start with "New Category Group" (ticket AC4), and Next stays disabled until a group is
  picked, as in the source.
- **D11 Name taken late.** A `name_taken` answer at the final step returns to step 1 and shows the nickname
  error there.
- **D12 Type picker.** `shell/AccountTypePicker.tsx` disables the loan tiles and is closed to this Build. A
  new `AddAccountTypePicker.tsx` beside the dialog renders the same markup without `disabled`, and the dialog
  uses it. The old file became unused and was removed (EXF-989).
- **D13 Deleting a category (EXF-990).** A category or group delete moves the `paired_category_id` of loans
  paired with it to `reassign_to`, or clears it without one, in the delete's batch with an `account`
  change_log row each (before/after `paired_category_id`); undoing the delete restores it.

## One batch

Creating a loan with `new_category` and a new group is one `db.batch`. Each change_log row is written first,
under the same guard as its row:

1. `category_group create`, then the group row. Guard: the account guard (name free, sort next), the group
   name free, and the group sort next.
2. `category create`, then the category row. Guard: the account guard, the target group active and not a
   payment group, the category name free in that group, and the category sort next.
3. `account create`, then the account row with `paired_category_id`. Guard: the account guard and the paired
   category existing.
4. The Starting Balance system payee if missing, and the transaction and its log row, guarded on the account
   existing (as in EXF-481).

Steps 1–2 do not change anything the account guard reads, and step 2's guard holds only if step 1's did. So
the batch writes everything or nothing, and the pairing never points at a missing row. When the account
insert reports 0 changes, the service re-reads to tell a taken name or a vanished target from a sort race,
which it retries (5 attempts). The number of D1 calls is constant: fixed reads plus one batch, the same for
10 and for 100 categories (`apps/worker/test/loan-accounts-calls.test.ts`).

## Departures

- **The ticket's copy bug.** Step 2's title is "Add Unlinked Account", as the ticket asks (the source says
  "Add Linked Accounts").
- **Rate checked early.** The rate is validated on step 1 (D9). The source does not check it there.
- **Existing assertion flipped.** `e2e/accounts.spec.ts:83` asserted that the Mortgage tile is disabled. That
  placeholder is lifted by this ticket (AC1), so that one line now expects it enabled. No other line changes.
- **Test row unchanged.** `apps/worker/test/accounts.test.ts` keeps its row `{type:"mortgage",
  balance:1000}` → 422. It still holds, because the rate and payment are required (D2).

## Not in this ticket

- Editing loan details (the account's edit dialog, "Loan Details") is area 6.
- What happens to `paired_category_id` when its category is deleted.
- Plan export and import carrying the loan fields.

## Tests and measured D1 calls

- Worker: `apps/worker/test/loan-accounts.test.ts` (AC5–AC8, the 422 matrix over REST and MCP, atomicity,
  change log, MCP parity) and `apps/worker/test/loan-accounts-calls.test.ts` (counting).
- e2e: `e2e/loan-accounts.spec.ts` (AC1–AC5 and the new-category pairing through the UI).
- D1 calls of `addUnlinkedAccount` for a loan, the same at 10 and at 100 categories, always one `db.batch`:
  new category in a new group 8, new category in an existing group 9, existing category 8, no pairing 6.
- AC5's Starting Balance row is read in All Accounts: an off-plan account's own register has no category
  column.
- Also touched outside May touch: `apps/worker/test/accounts.test.ts` (four keys added to one `AccountRow`
  literal so it type-checks).
