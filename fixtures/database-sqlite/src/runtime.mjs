import assert from 'node:assert/strict';

const builtinsBefore = new Set(process.moduleLoadList.filter(name => name.startsWith('NativeModule node:')));
const { sqlite, sqliteDriver, sqliteVertical } = await import('@zmdb/sqlite');
const { runEmbedded } = await import('@zmdb/sqlite/embedded');
const { sqliteDriver: nodeSqliteDriver } = await import('@zmdb/sqlite/node');
const newlyLoadedBuiltins = process.moduleLoadList
  .filter(name => name.startsWith('NativeModule node:'))
  .filter(name => !builtinsBefore.has(name));
assert.deepEqual(
  newlyLoadedBuiltins,
  [],
  `importing @zmdb/sqlite public subpaths loaded Node built-ins: ${newlyLoadedBuiltins.join(', ')}`,
);
assert.equal(nodeSqliteDriver, sqliteDriver);
assert.equal(typeof runEmbedded, 'function');

const { DatabaseSync } = await import('node:sqlite');
const database = new DatabaseSync(':memory:');
try {
  let prepareCalls = 0;
  const observedDatabase = {
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      prepareCalls += 1;
      return database.prepare(sql);
    },
  };
  const driver = sqliteDriver(observedDatabase, { maxCacheSize: 1 });
  assert.equal(sqliteVertical.dialect, sqlite);
  assert.equal(sqliteVertical.driver, sqliteDriver);
  assert.equal(driver.dialect, sqlite);

  const createUsers = {
    kind: 'create_table',
    table: 'users',
    columns: [
      { name: 'email', type: 'text', nullable: false, primaryKey: false },
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
    ],
    primaryKey: ['id'],
    foreignKeys: [],
  };
  const migrations = sqlite.migrations.connection(driver);
  await migrations.ensureVersionTable();
  await migrations.transaction(async transaction => {
    assert.ok(transaction);
    await transaction.exec(sqlite.migrations.emitUp(createUsers));
    await transaction.recordApplied(202609050669, 'create_users', 'sha256:packed-consumer');
  });
  assert.deepEqual(await migrations.appliedVersions(), [202609050669]);

  await driver.execute({
    text: 'INSERT INTO users (id, email, visits) VALUES (?, ?, ?)',
    parameters: [1, 'first@example.test', 1],
  });
  await driver.execute({
    text:
      'INSERT INTO users (id, email, visits) VALUES (?, ?, ?) ' +
      'ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, visits = EXCLUDED.visits',
    parameters: [1, 'updated@example.test', 2],
  });
  assert.deepEqual(
    (
      await driver.execute({
        text: 'SELECT id, email, visits FROM users WHERE id = ?',
        parameters: [1],
      })
    ).map(row => ({ ...row })),
    [{ id: 1, email: 'updated@example.test', visits: 2 }],
  );
  await driver.execute({ text: 'UPDATE users SET visits = ? WHERE id = ?', parameters: [3, 1] });

  const stream = driver.stream;
  assert.ok(stream);

  const activeSql = 'SELECT 1 AS id UNION ALL SELECT 2 AS id ORDER BY id /* active statement */';
  const prepareCallsBeforeActive = prepareCalls;
  const active = stream({ text: activeSql, parameters: [] })[Symbol.asyncIterator]();
  const firstActive = await active.next();
  assert.equal(firstActive.done, false);
  assert.deepEqual({ ...firstActive.value }, { id: 1 });
  assert.deepEqual(
    (await driver.execute({ text: activeSql, parameters: [] })).map(row => ({ ...row })),
    [{ id: 1 }, { id: 2 }],
  );
  const secondActive = await active.next();
  assert.equal(secondActive.done, false);
  assert.deepEqual({ ...secondActive.value }, { id: 2 });
  await driver.execute({ text: 'SELECT 3 AS id /* cannot evict active statement */', parameters: [] });
  await active.return();
  await driver.execute({ text: activeSql, parameters: [] });
  assert.equal(prepareCalls - prepareCallsBeforeActive, 3, 'an active cached statement was reused or evicted');

  const controller = new AbortController();
  const abortReason = new Error('packed consumer stopped between rows');
  const aborting = stream(
    { text: 'SELECT 1 AS id UNION ALL SELECT 2 AS id ORDER BY id /* abort */', parameters: [] },
    { signal: controller.signal },
  )[Symbol.asyncIterator]();
  const firstAborting = await aborting.next();
  assert.equal(firstAborting.done, false);
  assert.deepEqual({ ...firstAborting.value }, { id: 1 });
  controller.abort(abortReason);
  await assert.rejects(aborting.next(), error => error === abortReason);

  const streamed = [];
  for await (const row of stream({ text: 'SELECT id, visits FROM users ORDER BY id', parameters: [] })) {
    streamed.push(row);
  }
  assert.deepEqual(
    streamed.map(row => ({ ...row })),
    [{ id: 1, visits: 3 }],
  );

  await assert.rejects(
    driver.transaction(async transaction => {
      await transaction.execute({
        text: 'INSERT INTO users (id, email, visits) VALUES (?, ?, ?)',
        parameters: [2, 'rollback@example.test', 1],
      });
      throw new Error('rollback');
    }),
    /rollback/,
  );
  assert.deepEqual(await driver.execute({ text: 'SELECT id FROM users WHERE id = ?', parameters: [2] }), []);

  const snapshot = await sqlite.introspector.snapshot(driver);
  const declared = {
    version: 1,
    extensions: [],
    tables: [
      {
        name: 'users',
        columns: createUsers.columns,
        primaryKey: createUsers.primaryKey,
        foreignKeys: createUsers.foreignKeys,
      },
    ],
  };
  const normalized = sqlite.introspector.normalizeForDrift(snapshot, 'live');
  const normalizedDeclared = sqlite.introspector.normalizeForDrift(declared, 'declared');
  assert.deepEqual(normalized, normalizedDeclared);
  const users = snapshot.tables.find(table => table.name === 'users');
  assert.deepEqual(users?.primaryKey, ['id']);
  assert.deepEqual(
    users?.columns.map(column => [column.name, column.type]),
    [
      ['email', 'text'],
      ['id', 'serial'],
      ['visits', 'integer'],
    ],
  );

  await driver.execute({ text: 'DELETE FROM users WHERE id = ?', parameters: [1] });
  assert.deepEqual(await driver.execute({ text: 'SELECT id FROM users', parameters: [] }), []);

  process.stdout.write('packed @zmdb/sqlite migration CRUD streaming abort rollback drift introspection OK\n');
} finally {
  database.close();
}
