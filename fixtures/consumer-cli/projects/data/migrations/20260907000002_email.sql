-- zmdb:up
ALTER TABLE ledger_users ADD COLUMN email TEXT;
-- zmdb:down
ALTER TABLE ledger_users DROP COLUMN email;
