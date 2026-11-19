-- EXF-467: renaming rules of a plan's payees. match_text is the folded form the Worker compares (foldRuleText).
CREATE TABLE payee_rename_rules (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  payee_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  match_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE UNIQUE INDEX payee_rename_rules_payee ON payee_rename_rules (payee_id, kind, match_text) WHERE deleted_at IS NULL;
CREATE INDEX payee_rename_rules_budget ON payee_rename_rules (budget_id, kind, match_text) WHERE deleted_at IS NULL;
