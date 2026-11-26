-- A plan archived by Make a Fresh Start (EXF-478) stops entering its scheduled transactions: the due-job skips
-- plans with archived_at set. Additive and nullable. Backfills the archives Fresh Start has already made.
ALTER TABLE budgets ADD COLUMN archived_at TEXT;
UPDATE budgets SET archived_at = (
  SELECT min(c.created_at) FROM change_log c
  WHERE c.entity_type = 'fresh_start' AND c.budget_id = budgets.id
    AND json_extract(c.after_json, '$.archived_budget_id') = budgets.id
) WHERE deleted_at IS NULL;
