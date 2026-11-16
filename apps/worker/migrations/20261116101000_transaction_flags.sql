-- A transaction's colour flag (red, orange, yellow, green, blue, purple). Nullable, no default: no row is rewritten.
ALTER TABLE transactions ADD COLUMN flag_color TEXT;
