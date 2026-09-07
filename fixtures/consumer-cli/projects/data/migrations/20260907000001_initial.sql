-- zmdb:up
CREATE TABLE ledger_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
-- zmdb:down
DROP TABLE ledger_users;
