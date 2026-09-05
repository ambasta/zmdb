-- zmdb:up
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL
);

-- zmdb:down
DROP TABLE orders;
