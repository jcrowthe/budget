-- Pending bank transactions (EXF-466): never in transactions until entered or posted.
CREATE TABLE pending_transactions (
  id TEXT PRIMARY KEY,                 -- our uuid: the API id, the enter-now path id
  budget_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  plaid_transaction_id TEXT NOT NULL,  -- Plaid's transaction_id of the pending item
  date TEXT NOT NULL,
  amount INTEGER NOT NULL,             -- milliunits, our sign (0 - plaidToMilliunits)
  payee_name TEXT,                     -- after the plan's renaming rules (as an import would name it)
  imported_payee TEXT,                 -- the bank's name, as sent
  import_payee_name TEXT,              -- merchant_name || name, as received (payeeNameOf)
  bank_description TEXT,               -- original_description ?? name
  entered_transaction_id TEXT,         -- set by Enter Now (the row it became)
  resolved_at TEXT,                    -- set by a sync that posted or removed an entered item (undo guard)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX pending_transactions_live ON pending_transactions (budget_id, plaid_transaction_id)
  WHERE deleted_at IS NULL;
CREATE INDEX pending_transactions_account ON pending_transactions (account_id, deleted_at);
CREATE INDEX pending_transactions_plaid ON pending_transactions (budget_id, plaid_transaction_id);
ALTER TABLE transactions ADD COLUMN pending_transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN status TEXT;
CREATE INDEX transactions_pending ON transactions (budget_id, pending_transaction_id)
  WHERE pending_transaction_id IS NOT NULL;
