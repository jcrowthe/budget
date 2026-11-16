ALTER TABLE budgets ADD COLUMN bank_environment TEXT NOT NULL DEFAULT 'production' CHECK (bank_environment IN ('production','sandbox'));
