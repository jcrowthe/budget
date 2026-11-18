-- EXF-464: the hand entry's amount before a manual match, for unmatch. Null for every other row.
ALTER TABLE transactions ADD COLUMN match_entry_amount integer;
