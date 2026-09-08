import { DatabaseSync } from 'node:sqlite';

import { runEmbedded, type EmbeddedConnection } from '@zmdb/sqlite/embedded';
import { expect, it } from 'vitest';

it('applies and records a migration through the SQLite public entry only once', async () => {
  const db = new DatabaseSync(':memory:');
  const connection: EmbeddedConnection = {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, parameters) {
      db.prepare(sql).run(...parameters);
    },
    async rows(sql, parameters) {
      return db.prepare(sql).all(...parameters);
    },
  };
  const migration = {
    version: 1,
    name: 'create_notes',
    up: 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)',
    checksum: 'sha256:create-notes',
  };

  try {
    await expect(runEmbedded(connection, [migration])).resolves.toEqual([1]);
    db.prepare('INSERT INTO notes (id, body) VALUES (?, ?)').run(7, 'migration applied');
    expect(db.prepare('SELECT body FROM notes WHERE id = ?').get(7)).toMatchObject({
      body: 'migration applied',
    });
    expect(db.prepare('SELECT version, name, checksum FROM _zmdb_migrations').all()).toEqual([
      { version: migration.version, name: migration.name, checksum: migration.checksum },
    ]);

    await expect(runEmbedded(connection, [migration])).resolves.toEqual([]);
    expect(db.prepare('SELECT count(*) AS count FROM _zmdb_migrations').get()).toMatchObject({ count: 1 });
  } finally {
    db.close();
  }
});
