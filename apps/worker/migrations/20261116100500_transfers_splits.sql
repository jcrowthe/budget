-- Transfers (a linked pair of rows) and split transactions (a parent with line rows), EXF-526 and EXF-524.
ALTER TABLE transactions ADD COLUMN transfer_account_id TEXT;
ALTER TABLE transactions ADD COLUMN transfer_transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN parent_transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN split_index INTEGER;
CREATE INDEX transactions_transfer ON transactions(transfer_transaction_id);
CREATE INDEX transactions_parent ON transactions(parent_transaction_id);
