-- Undo/Redo U1 (plan p_66a8e22e545f480d8c0c4092571b8e09): one change_set_id per REST/MCP write request. See docs/undo-design.md.
ALTER TABLE change_log ADD COLUMN change_set_id text;
CREATE INDEX change_log_change_set ON change_log(budget_id, change_set_id);
