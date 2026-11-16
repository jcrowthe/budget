CREATE TABLE bank_connections (
  id TEXT PRIMARY KEY,
  display_id TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL CHECK (environment IN ('production','sandbox')),
  plaid_item_id TEXT NOT NULL UNIQUE,
  institution_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  institution_logo TEXT,
  nickname TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  last_synced_at TEXT,
  sync_cursor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX bank_connections_environment ON bank_connections (environment, created_at);
CREATE TABLE bank_accounts (
  id TEXT PRIMARY KEY,
  bank_connection_id TEXT NOT NULL REFERENCES bank_connections(id),
  plaid_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mask TEXT,
  type TEXT NOT NULL,
  subtype TEXT,
  current_balance INTEGER,
  available_balance INTEGER,
  balance_updated_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (bank_connection_id, plaid_account_id)
);
