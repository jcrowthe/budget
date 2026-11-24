-- File import (FI-2): the stored files, the remembered options per account and format, and the file's own memo.
CREATE TABLE file_imports (
  id text PRIMARY KEY, budget_id text NOT NULL, account_id text NOT NULL, actor text NOT NULL,
  file_name text NOT NULL, format text NOT NULL, byte_size integer NOT NULL, r2_key text NOT NULL,
  created_at text NOT NULL, expires_at text NOT NULL, deleted_at text
);
CREATE INDEX file_imports_expiry ON file_imports(deleted_at, expires_at);
CREATE TABLE account_import_settings (
  account_id text NOT NULL, format text NOT NULL, budget_id text NOT NULL,
  options_json text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL,
  PRIMARY KEY (account_id, format)
);
ALTER TABLE transactions ADD COLUMN import_memo text;
