-- Plan imports (EXF-477): one row per import of a plan from an export file. A large plan is written in steps;
-- its plan row stays hidden (budgets.deleted_at set) until the last step. No foreign key: cleanup deletes the
-- plan and keeps this row as the record that the import was abandoned.
CREATE TABLE plan_imports (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('writing', 'done', 'abandoned')),
  actor TEXT NOT NULL,
  file_name TEXT NOT NULL,
  r2_key TEXT,
  chunk_count INTEGER NOT NULL,
  next_chunk INTEGER NOT NULL,
  chunk_offsets TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX plan_imports_state_updated ON plan_imports (state, updated_at);
