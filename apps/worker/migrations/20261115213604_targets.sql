CREATE TABLE targets (
  category_id TEXT PRIMARY KEY REFERENCES categories(id),
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  cadence TEXT NOT NULL,
  behavior TEXT NOT NULL,
  amount INTEGER NOT NULL,
  day_of_week INTEGER,
  day_of_month INTEGER,
  due_date TEXT,
  due_month TEXT,
  repeat_every INTEGER,
  repeat_unit TEXT,
  created_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX targets_budget ON targets (budget_id);
