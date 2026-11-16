-- Plaid import (EXF-462): import columns on transactions, tombstones, sync state on connections.
ALTER TABLE transactions ADD COLUMN import_id TEXT;
ALTER TABLE transactions ADD COLUMN source TEXT;
ALTER TABLE transactions ADD COLUMN imported_payee TEXT;
ALTER TABLE transactions ADD COLUMN bank_description TEXT;
ALTER TABLE transactions ADD COLUMN import_date TEXT;
ALTER TABLE transactions ADD COLUMN import_amount INTEGER;
ALTER TABLE transactions ADD COLUMN import_payee_name TEXT;
CREATE UNIQUE INDEX transactions_budget_import ON transactions (budget_id, import_id)
  WHERE import_id IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE import_tombstones (
  account_id TEXT NOT NULL,
  import_id TEXT NOT NULL,
  budget_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  transaction_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, import_id)
);
CREATE INDEX import_tombstones_budget ON import_tombstones (budget_id, import_id);
ALTER TABLE bank_connections ADD COLUMN sync_error_since TEXT;
ALTER TABLE bank_connections ADD COLUMN sync_accounts TEXT;
ALTER TABLE bank_connections ADD COLUMN sync_loop_cursor TEXT;
