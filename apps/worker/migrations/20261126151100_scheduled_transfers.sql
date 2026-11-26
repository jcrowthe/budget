-- Scheduled transfers (EXF-501 part 1): a schedule may be a transfer to another account of the plan; the other side is derived on read.
ALTER TABLE scheduled_transactions ADD COLUMN transfer_account_id TEXT REFERENCES accounts(id);
-- An account's register lists the transfer schedules whose other side it is; deleting an account ends them.
CREATE INDEX scheduled_transactions_transfer_account ON scheduled_transactions (transfer_account_id);
