-- Scheduled transactions (EXF-497, EXF-499): one row per series; real transactions are made from it, never stored here.
CREATE TABLE scheduled_transactions (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date_first TEXT NOT NULL,
  date_next TEXT NOT NULL,
  frequency TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payee_id TEXT REFERENCES payees(id),
  category_id TEXT REFERENCES categories(id),
  inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0,
  memo TEXT,
  flag_color TEXT,
  write_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
-- The plan's register lists its schedules in date order.
CREATE INDEX scheduled_transactions_budget_next ON scheduled_transactions (budget_id, date_next);
-- Entering what is due reads every live schedule whose next date has come, across plans.
CREATE INDEX scheduled_transactions_due ON scheduled_transactions (date_next) WHERE deleted_at IS NULL;
-- An account's register lists its own schedules.
CREATE INDEX scheduled_transactions_account ON scheduled_transactions (account_id);
