-- Scheduled splits (EXF-501 part 2): the lines of a split schedule. Additive: a plain schedule has none.
-- A line is soft-deleted only when an edit replaces it; deleting or ending the schedule leaves its lines alone,
-- and every read joins a live parent (docs/scheduled-splits-design.md).
CREATE TABLE scheduled_subtransactions (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id),
  scheduled_transaction_id TEXT NOT NULL REFERENCES scheduled_transactions(id),
  amount INTEGER NOT NULL,
  payee_id TEXT REFERENCES payees(id),
  category_id TEXT REFERENCES categories(id),
  inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0,
  memo TEXT,
  sort INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
-- A schedule reads its lines in order.
CREATE INDEX scheduled_subtransactions_parent ON scheduled_subtransactions (scheduled_transaction_id, sort);
-- Deleting or combining a category or payee finds the lines that name it.
CREATE INDEX scheduled_subtransactions_category ON scheduled_subtransactions (category_id);
CREATE INDEX scheduled_subtransactions_payee ON scheduled_subtransactions (payee_id);
