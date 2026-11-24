-- Undo/Redo U2 (plan p_66a8e22e545f480d8c0c4092571b8e09): one row per undone change set. See docs/undo-design.md.
CREATE TABLE change_set_undos (
  budget_id TEXT NOT NULL,
  change_set_id TEXT NOT NULL,
  undo_change_set_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (budget_id, change_set_id)
);
CREATE INDEX change_set_undos_undo ON change_set_undos (budget_id, undo_change_set_id);
