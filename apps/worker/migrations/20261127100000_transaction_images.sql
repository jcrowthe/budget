-- One receipt image per transaction (EXF-536). The bytes live in R2 (budget-files); this row holds the object key,
-- type and size. Additive. At most one live row per transaction; a replaced or deleted image keeps its row
-- (deleted_at) until its object is confirmed removed (object_deleted_at).
CREATE TABLE transaction_images (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  file_name TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  object_deleted_at TEXT
);
CREATE UNIQUE INDEX transaction_images_live ON transaction_images (transaction_id) WHERE deleted_at IS NULL;
CREATE INDEX transaction_images_sweep ON transaction_images (budget_id) WHERE deleted_at IS NOT NULL AND object_deleted_at IS NULL;
