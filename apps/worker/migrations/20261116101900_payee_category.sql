-- EXF-515: what a payee remembers for its category. category_mode: history | fixed | off. The fixed choice and the
-- stored history default each are a category or Ready to Assign (a separate flag, never a sentinel id).
-- Definitions: docs/payee-category-design.md.
ALTER TABLE payees ADD COLUMN category_mode TEXT NOT NULL DEFAULT 'history' CHECK (category_mode IN ('history', 'fixed', 'off'));
ALTER TABLE payees ADD COLUMN fixed_category_id TEXT;
ALTER TABLE payees ADD COLUMN fixed_inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payees ADD COLUMN default_category_id TEXT;
ALTER TABLE payees ADD COLUMN default_inflow_to_ready_to_assign INTEGER NOT NULL DEFAULT 0;

-- Backfill of every live ordinary payee: the value held by at least 2 of its last 3 counted rows, else its most
-- recent counted row (today's suggestion, where there is no majority). A counted row is a live, categorised (or
-- Ready to Assign) row of an open-or-closed live account, not a split line or parent, not a transfer; recency is
-- date DESC, created_at ASC, id ASC. Literal copy of repositories/payee-category.ts (recomputeDefaultsStmt).
UPDATE payees SET
  default_category_id = nv.cid,
  default_inflow_to_ready_to_assign = nv.rta
FROM (
  SELECT p.id AS pid,
    CASE WHEN m.payee_id IS NOT NULL THEN m.cid ELSE f.cid END AS cid,
    CASE WHEN m.payee_id IS NOT NULL THEN m.rta ELSE COALESCE(f.rta, 0) END AS rta
  FROM payees p
  LEFT JOIN (
    SELECT payee_id, cid, rta FROM (
      SELECT t.payee_id AS payee_id,
        CASE WHEN t.inflow_to_ready_to_assign = 1 THEN NULL ELSE t.category_id END AS cid,
        t.inflow_to_ready_to_assign AS rta,
        ROW_NUMBER() OVER (PARTITION BY t.payee_id ORDER BY t.date DESC, t.created_at ASC, t.id ASC) AS rn
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
      WHERE t.payee_id IS NOT NULL AND t.deleted_at IS NULL AND t.parent_transaction_id IS NULL
        AND t.transfer_account_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM transactions l WHERE l.parent_transaction_id = t.id AND l.deleted_at IS NULL)
        AND (t.inflow_to_ready_to_assign = 1 OR EXISTS (
          SELECT 1 FROM categories c JOIN category_groups g ON g.id = c.group_id AND g.deleted_at IS NULL
          WHERE c.id = t.category_id AND c.budget_id = t.budget_id AND c.deleted_at IS NULL))
    ) WHERE rn <= 3 GROUP BY payee_id, cid, rta HAVING COUNT(*) >= 2
  ) m ON m.payee_id = p.id
  LEFT JOIN (
    SELECT payee_id, cid, rta FROM (
      SELECT t.payee_id AS payee_id,
        CASE WHEN t.inflow_to_ready_to_assign = 1 THEN NULL ELSE t.category_id END AS cid,
        t.inflow_to_ready_to_assign AS rta,
        ROW_NUMBER() OVER (PARTITION BY t.payee_id ORDER BY t.date DESC, t.created_at ASC, t.id ASC) AS rn
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id AND a.deleted_at IS NULL
      WHERE t.payee_id IS NOT NULL AND t.deleted_at IS NULL AND t.parent_transaction_id IS NULL
        AND t.transfer_account_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM transactions l WHERE l.parent_transaction_id = t.id AND l.deleted_at IS NULL)
        AND (t.inflow_to_ready_to_assign = 1 OR EXISTS (
          SELECT 1 FROM categories c JOIN category_groups g ON g.id = c.group_id AND g.deleted_at IS NULL
          WHERE c.id = t.category_id AND c.budget_id = t.budget_id AND c.deleted_at IS NULL))
    ) WHERE rn = 1
  ) f ON f.payee_id = p.id
  WHERE p.deleted_at IS NULL AND p.system IS NULL
) nv
WHERE payees.id = nv.pid;
