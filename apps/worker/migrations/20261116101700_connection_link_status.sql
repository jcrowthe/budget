-- EXF-866: Account Not Found on a link; the reason of a connection's last failure; the nightly check's last try.
ALTER TABLE accounts ADD COLUMN link_missing_since text;
ALTER TABLE bank_connections ADD COLUMN sync_error_code text;
ALTER TABLE bank_connections ADD COLUMN login_checked_at text;
