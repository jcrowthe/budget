-- Plan formats (EXF-468): each plan's currency, number format, currency placement and date format.
ALTER TABLE budgets ADD COLUMN currency_iso_code TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE budgets ADD COLUMN number_format TEXT NOT NULL DEFAULT '123,456.78';
ALTER TABLE budgets ADD COLUMN symbol_placement TEXT NOT NULL DEFAULT 'before';
ALTER TABLE budgets ADD COLUMN date_format TEXT NOT NULL DEFAULT 'MM/DD/YYYY';
