CREATE TABLE target_snoozes (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (category_id, month)
);
CREATE INDEX target_snoozes_budget ON target_snoozes(budget_id);
