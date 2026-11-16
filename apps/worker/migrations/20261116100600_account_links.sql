ALTER TABLE accounts ADD COLUMN bank_account_id TEXT;
ALTER TABLE accounts ADD COLUMN import_start_date TEXT;
CREATE UNIQUE INDEX accounts_bank_account_link ON accounts (budget_id, bank_account_id)
  WHERE bank_account_id IS NOT NULL AND deleted_at IS NULL;
