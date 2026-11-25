-- EXF-482: loan accounts record their interest rate (decimal string), monthly payment and escrow (milliunits)
-- and an optional paired category. Additive: existing rows keep NULL in all four.
ALTER TABLE accounts ADD COLUMN interest_rate text;
ALTER TABLE accounts ADD COLUMN minimum_payment integer;
ALTER TABLE accounts ADD COLUMN escrow_amount integer;
ALTER TABLE accounts ADD COLUMN paired_category_id text;
