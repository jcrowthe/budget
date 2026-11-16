CREATE TABLE ui_state (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, key)
);
