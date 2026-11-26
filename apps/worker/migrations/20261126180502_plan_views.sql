-- Custom views (EXF-502): a plan's named category sets, and the saved chip positions of the built-in views. See docs/custom-views-design.md.
CREATE TABLE plan_views (
  id TEXT PRIMARY KEY,                -- a UUID for a custom view; 'builtin:{budget_id}:{key}' for a built-in's position row
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  builtin_key TEXT,                   -- underfunded | overfunded | money_available | snoozed; NULL for a custom view
  name TEXT,                          -- NULL for a built-in row
  category_ids TEXT NOT NULL DEFAULT '[]', -- JSON array of category ids; deleted categories are dropped on read
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX plan_views_builtin ON plan_views (budget_id, builtin_key) WHERE builtin_key IS NOT NULL;
CREATE INDEX plan_views_budget ON plan_views (budget_id, sort_order) WHERE deleted_at IS NULL;
