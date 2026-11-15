CREATE TABLE category_groups (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  collapsed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX category_groups_budget ON category_groups (budget_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  group_id TEXT NOT NULL REFERENCES category_groups(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX categories_group ON categories (group_id);
CREATE INDEX categories_budget ON categories (budget_id);

CREATE TABLE month_categories (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  month TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  assigned INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, month, category_id)
);
CREATE INDEX month_categories_category ON month_categories (category_id);

CREATE TABLE months (
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  month TEXT NOT NULL,
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, month)
);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  on_budget INTEGER NOT NULL,
  note TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX accounts_budget ON accounts (budget_id);

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  payee_name TEXT,
  category_id TEXT REFERENCES categories(id),
  inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0,
  memo TEXT,
  amount INTEGER NOT NULL,
  cleared TEXT NOT NULL DEFAULT 'uncleared' CHECK (cleared IN ('uncleared', 'cleared', 'reconciled')),
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX transactions_budget_date ON transactions (budget_id, date);
CREATE INDEX transactions_account ON transactions (account_id);
CREATE INDEX transactions_category ON transactions (category_id);
