CREATE TABLE report_settings (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  report TEXT NOT NULL,
  preset TEXT,
  start_month TEXT,
  end_month TEXT,
  excluded_category_ids TEXT NOT NULL DEFAULT '[]',
  excluded_account_ids TEXT NOT NULL DEFAULT '[]',
  hide_export_dialog INTEGER NOT NULL DEFAULT 0,
  visited_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, report)
);
