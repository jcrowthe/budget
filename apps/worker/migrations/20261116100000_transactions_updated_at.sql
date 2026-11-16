ALTER TABLE transactions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE transactions SET updated_at = max(created_at, coalesce((SELECT max(c.created_at) FROM change_log c WHERE c.entity_type = 'transaction' AND c.entity_id = transactions.id AND c.budget_id = transactions.budget_id), created_at));
