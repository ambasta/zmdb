import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { diff, planMigration, snapshot } from '@zmdb/migrations';
import { emitDeclarations } from '@zmdb/migrations/declarations';
import { createIntrospector } from '@zmdb/migrations/introspect';
import { sqlite, sqliteDriver, sqliteMigrations } from '@zmdb/sqlite';

const expected = JSON.parse(readFileSync('expected.json', 'utf8')).migrations;
const manifest = JSON.parse(readFileSync('node_modules/@zmdb/migrations/package.json', 'utf8'));
assert.deepEqual(Object.keys(manifest.exports).toSorted(), expected.subpaths);
for (const name of ['@zmdb/cli', '@zmdb/compiler', '@zmdb/core'])
  assert.equal(existsSync(join('node_modules', name)), false);
for (const subpath of expected.subpaths) await import(`@zmdb/migrations${subpath === '.' ? '' : subpath.slice(1)}`);

const empty = snapshot([]);
const next = snapshot([
  {
    table: 'publication_rows',
    primaryKey: ['id'],
    columns: {
      id: { type: 'integer', flags: { nullable: false, primaryKey: true } },
      label: { type: 'text', flags: { nullable: false } },
    },
  },
]);
assert.deepEqual(
  next.tables.map(table => table.name),
  ['publication_rows'],
);
assert.deepEqual(
  next.tables[0].columns.map(column => column.name),
  ['id', 'label'],
);
assert.deepEqual(diff(next, next), []);
assert.deepEqual(
  diff(empty, next).map(operation => operation.kind),
  ['create_table'],
);
const plan = planMigration(empty, next, {
  dialect: sqlite,
  emitUp: sqliteMigrations.emitUp,
  emitDown: sqliteMigrations.emitDown,
});
assert.equal(plan.up.length, 1);
assert.equal(plan.down.length, 1);
const database = new DatabaseSync(':memory:');
try {
  for (const sql of plan.up) database.exec(sql);
  database.exec("INSERT INTO publication_rows VALUES (7, 'packed migration')");
  assert.deepEqual(
    { ...database.prepare('SELECT * FROM publication_rows').get() },
    { id: 7, label: 'packed migration' },
  );
  const live = await createIntrospector(sqlite).snapshot(sqliteDriver(database), { include: ['publication_rows'] });
  assert.deepEqual(
    live.tables.map(table => table.name),
    ['publication_rows'],
  );
  assert.deepEqual(
    live.tables[0].columns.map(column => column.name),
    ['id', 'label'],
  );
  const emitted = await emitDeclarations(live, { dialect: sqlite });
  assert.deepEqual(
    emitted.files.map(file => file.path),
    ['publication_rows.ts', 'index.ts'],
  );
  assert.match(emitted.files[0].source, /interface PublicationRow/);
  assert.match(emitted.files[0].source, /Sql<['"]integer['"]>/);
  for (const sql of plan.down) database.exec(sql);
  assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'publication_rows'").get().n, 0);
} finally {
  database.close();
}
process.stdout.write(JSON.stringify({ subpaths: expected.subpaths, snapshotDiffPlanIntrospection: true }) + '\n');
