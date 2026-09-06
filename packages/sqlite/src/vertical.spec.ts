import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { driverMigrationConnection, up, type ChangeOp, type SchemaSnapshot } from '@zmdb/migrations';
import { detectDrift } from '@zmdb/migrations/introspect';
import {
  createQueryCompiler,
  UnsupportedFeatureError,
  type MigrationPlan,
  type SchemaObjectOperation,
} from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { sqlite } from './dialect.js';
import { sqliteDriver } from './driver.js';
import { sqliteVertical } from './index.js';
import { sqliteIntrospector } from './introspector.js';
import { sqliteMigrations } from './migrations.js';

const USERS: SchemaSnapshot = {
  version: 1,
  extensions: [],
  tables: [
    {
      name: 'users',
      columns: [
        { name: 'email', type: 'text', nullable: false, primaryKey: false },
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'visits', type: 'integer', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
  ],
};

const ALL_TYPES: SchemaSnapshot = {
  version: 1,
  extensions: [],
  tables: [
    {
      name: 'all_types',
      columns: [
        { name: 'active', type: 'boolean', nullable: false, primaryKey: false },
        { name: 'age', type: 'integer', nullable: false, primaryKey: false },
        { name: 'bio', type: 'text', nullable: true, primaryKey: false },
        { name: 'createdAt', type: 'timestamp', nullable: false, primaryKey: false },
        { name: 'email', type: 'varchar', nullable: false, primaryKey: false, length: 255 },
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
        { name: 'passwordHash', type: 'text', nullable: false, primaryKey: false },
        { name: 'role', type: 'jsonEnum', nullable: false, primaryKey: false },
        { name: 'score', type: 'numeric', nullable: true, primaryKey: false },
        { name: 'settings', type: 'json', nullable: false, primaryKey: false },
        { name: 'visits', type: 'bigint', nullable: false, primaryKey: false },
      ],
      primaryKey: ['id'],
      foreignKeys: [],
    },
  ],
};

function createUsers(): Extract<ChangeOp, { readonly kind: 'create_table' }> {
  const table = USERS.tables[0];
  if (table === undefined) throw new Error('missing users table');
  return {
    kind: 'create_table',
    table: table.name,
    columns: table.columns,
    primaryKey: table.primaryKey,
    foreignKeys: table.foreignKeys,
  };
}

describe('@zmdb/sqlite vertical', () => {
  it('carries exact package identity and capability evidence', () => {
    expect(sqliteVertical.dialect).toBe(sqlite);
    expect(sqliteVertical.driver).toBe(sqliteDriver);
    expect(sqlite.introspector).toBe(sqliteIntrospector);
    expect(sqlite.migrations).toBe(sqliteMigrations);
    expect(sqlite).toMatchObject({
      name: 'sqlite',
      family: 'sqlite',
      capabilities: {
        returning: { insert: true, upsert: true, update: true, delete: true },
        transactionalDdl: true,
        schemas: false,
        sequences: false,
        generatedColumns: true,
        partialIndexes: true,
        foreignKeys: true,
        rowLevelSecurity: false,
        streaming: true,
        cancellation: false,
      },
      traits: {
        placeholder: 'positional',
        quote: ['"', '"'],
        upsert: 'onConflict',
        fts: 'companionTable',
        concat: 'operator',
        booleanNot: 'not',
        paramLimit: 30_000,
      },
    });
  });

  it('owns every abstract SQL type and representative statement spelling', () => {
    expect(sqlite.traits.types).toEqual({
      serial: 'INTEGER',
      integer: 'INTEGER',
      bigint: 'INTEGER',
      numeric: 'NUMERIC',
      text: 'TEXT',
      varchar: 'TEXT',
      boolean: 'INTEGER',
      timestamp: 'TEXT',
      json: 'TEXT',
      jsonEnum: 'TEXT',
    });
    expect(sqlite.traits.paginate({ offset: 20, ordered: true })).toBe(' LIMIT -1 OFFSET 20');

    const compiler = createQueryCompiler(sqlite);
    expect(
      compiler
        .selectFrom('users')
        .select(['id', 'email'])
        .where('visits', '>=', 1)
        .orderBy('id', 'asc')
        .limit(10)
        .offset(5)
        .compile(),
    ).toEqual({
      text: 'SELECT "id", "email" FROM "users" WHERE "visits" >= ? ORDER BY "id" ASC LIMIT 10 OFFSET 5',
      parameters: [1],
      returnsRows: true,
      operation: 'select',
      isWrite: false,
    });
    expect(
      compiler
        .insertInto('users')
        .values({ id: 1, email: 'a@example.test', visits: 1 })
        .onConflict('id')
        .doUpdate(['email', 'visits'])
        .returning(['id'])
        .compile().text,
    ).toBe(
      'INSERT INTO "users" ("id", "email", "visits") VALUES (?, ?, ?) ' +
        'ON CONFLICT ("id") DO UPDATE SET "email" = EXCLUDED."email", "visits" = EXCLUDED."visits" RETURNING "id"',
    );
  });

  it('renders every column type for sqlite', async () => {
    const table = ALL_TYPES.tables[0];
    if (table === undefined) throw new Error('missing all-types table');
    const create: Extract<ChangeOp, { readonly kind: 'create_table' }> = {
      kind: 'create_table',
      table: table.name,
      columns: table.columns,
      primaryKey: table.primaryKey,
      foreignKeys: table.foreignKeys,
    };
    const sql = sqlite.migrations.emitUp(create);
    expect(sql).toBe(
      'CREATE TABLE "all_types" ("active" INTEGER NOT NULL, "age" INTEGER NOT NULL, "bio" TEXT, ' +
        '"createdAt" TEXT NOT NULL, "email" TEXT NOT NULL, "id" INTEGER PRIMARY KEY, ' +
        '"passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL, "score" NUMERIC, "settings" TEXT NOT NULL, ' +
        '"visits" INTEGER NOT NULL)',
    );

    const database = new DatabaseSync(':memory:');
    try {
      database.exec(sql);
      const live = await sqlite.introspector.snapshot(sqliteDriver(database));
      expect(sqlite.introspector.normalizeForDrift(live, 'live')).toEqual(
        sqlite.introspector.normalizeForDrift(ALL_TYPES, 'declared'),
      );
    } finally {
      database.close();
    }
  });

  it('round-trips declaration through DDL node:sqlite and introspection', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const driver = sqliteDriver(database);
      database.exec(sqlite.migrations.emitUp(createUsers()));

      const live = await sqlite.introspector.snapshot(driver);
      const normalizedLive = sqlite.introspector.normalizeForDrift(live, 'live');
      const normalizedDeclared = sqlite.introspector.normalizeForDrift(USERS, 'declared');

      expect(normalizedLive).toMatchObject(USERS);
      expect(normalizedLive).toEqual(normalizedDeclared);
      expect(detectDrift(normalizedLive, USERS, { dialect: sqlite })).toMatchObject({
        clean: true,
        onlyInDatabase: [],
        onlyInDeclarations: [],
      });
    } finally {
      database.close();
    }
  });

  it('keeps a supplied non-serial primary key non-null and non-generated', async () => {
    const declared: SchemaSnapshot = {
      version: 1,
      extensions: [],
      tables: [
        {
          name: 'slugs',
          columns: [{ name: 'slug', type: 'text', nullable: false, primaryKey: true }],
          primaryKey: ['slug'],
          foreignKeys: [],
        },
      ],
    };
    const sql = sqlite.migrations.emitUp({
      kind: 'create_table',
      table: 'slugs',
      columns: declared.tables[0]?.columns ?? [],
      primaryKey: ['slug'],
      foreignKeys: [],
    });
    expect(sql).toBe('CREATE TABLE "slugs" ("slug" TEXT PRIMARY KEY NOT NULL)');

    const database = new DatabaseSync(':memory:');
    try {
      database.exec(sql);
      expect(() => database.prepare('INSERT INTO slugs (slug) VALUES (?)').run(null)).toThrow(/NOT NULL/);
      const live = await sqlite.introspector.snapshot(sqliteDriver(database));
      expect(sqlite.introspector.normalizeForDrift(live, 'live')).toEqual(
        sqlite.introspector.normalizeForDrift(declared, 'declared'),
      );
    } finally {
      database.close();
    }
  });

  it('preserves composite keys foreign keys indexes and defaults', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE parents (
          tenant_id INTEGER NOT NULL,
          id INTEGER NOT NULL,
          label TEXT NOT NULL DEFAULT 'new',
          PRIMARY KEY (tenant_id, id)
        );
        CREATE TABLE children (
          tenant_id INTEGER NOT NULL,
          id INTEGER NOT NULL,
          parent_tenant_id INTEGER NOT NULL,
          parent_id INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (tenant_id, id),
          FOREIGN KEY (parent_tenant_id, parent_id)
            REFERENCES parents (tenant_id, id)
            ON DELETE CASCADE
            ON UPDATE RESTRICT
        );
        CREATE UNIQUE INDEX children_active
          ON children (parent_tenant_id, parent_id)
          WHERE active = 1;
      `);
      const snapshot = await sqliteIntrospector.snapshot(sqliteDriver(database));
      const parents = snapshot.tables.find(table => table.name === 'parents');
      const children = snapshot.tables.find(table => table.name === 'children');

      expect(parents?.primaryKey).toEqual(['tenant_id', 'id']);
      expect(parents?.columns.find(column => column.name === 'label')?.default).toBe("'new'");
      expect(children?.primaryKey).toEqual(['tenant_id', 'id']);
      expect(children?.columns.find(column => column.name === 'active')?.default).toBe('1');
      expect(children?.foreignKeys).toEqual([
        {
          name: 'children_parent_tenant_id_parent_id_fkey',
          columns: ['parent_tenant_id', 'parent_id'],
          targetTable: 'parents',
          targetColumns: ['tenant_id', 'id'],
          onDelete: 'cascade',
          onUpdate: 'restrict',
        },
      ]);
      expect(children?.indexes).toContainEqual({
        name: 'children_active',
        columns: ['parent_tenant_id', 'parent_id'],
        unique: true,
        where: 'active = 1',
      });
    } finally {
      database.close();
    }
  });

  it('creates mutually-referencing tables through forward foreign-key references', () => {
    const a: Extract<ChangeOp, { readonly kind: 'create_table' }> = {
      kind: 'create_table',
      table: 'a',
      columns: [
        { name: 'b_id', type: 'integer', nullable: true, primaryKey: false },
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'a_b_id_fkey',
          columns: ['b_id'],
          targetTable: 'b',
          targetColumns: ['id'],
          onDelete: 'no action',
          onUpdate: 'no action',
        },
      ],
    };
    const b: Extract<ChangeOp, { readonly kind: 'create_table' }> = {
      kind: 'create_table',
      table: 'b',
      columns: [
        { name: 'a_id', type: 'integer', nullable: true, primaryKey: false },
        { name: 'id', type: 'serial', nullable: false, primaryKey: true },
      ],
      primaryKey: ['id'],
      foreignKeys: [
        {
          name: 'b_a_id_fkey',
          columns: ['a_id'],
          targetTable: 'a',
          targetColumns: ['id'],
          onDelete: 'no action',
          onUpdate: 'no action',
        },
      ],
    };
    const empty: SchemaSnapshot = { version: 1, tables: [], extensions: [] };
    const after: SchemaSnapshot = {
      version: 1,
      tables: [
        { name: 'a', columns: a.columns, primaryKey: a.primaryKey, foreignKeys: a.foreignKeys },
        { name: 'b', columns: b.columns, primaryKey: b.primaryKey, foreignKeys: b.foreignKeys },
      ],
      extensions: [],
    };
    expect(() => sqlite.migrations.validatePlan({ before: empty, after, operations: [a, b] })).not.toThrow();

    const database = new DatabaseSync(':memory:');
    try {
      database.exec('PRAGMA foreign_keys = ON');
      database.exec(sqlite.migrations.emitUp(a));
      database.exec(sqlite.migrations.emitUp(b));
      expect(database.prepare('PRAGMA foreign_key_list(a)').all()).toHaveLength(1);
      expect(database.prepare('PRAGMA foreign_key_list(b)').all()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it('executes migration CRUD upsert and rollback against live in-memory SQLite', async () => {
    const database = new DatabaseSync(':memory:');
    try {
      const driver = sqliteDriver(database);
      const connection = driverMigrationConnection(driver, sqlite);
      await expect(
        up(connection, [
          {
            version: 202609050001,
            name: 'create_users',
            up: sqlite.migrations.emitUp(createUsers()),
            down: sqlite.migrations.emitDown(createUsers()),
          },
        ]),
      ).resolves.toEqual([202609050001]);

      const compiler = createQueryCompiler(sqlite);
      await driver.execute(
        compiler
          .insertInto('users')
          .values({ id: 1, email: 'first@example.test', visits: 1 })
          .returning(['id'])
          .compile(),
      );
      await driver.execute(
        compiler
          .insertInto('users')
          .values({ id: 1, email: 'updated@example.test', visits: 2 })
          .onConflict('id')
          .doUpdate(['email', 'visits'])
          .compile(),
      );
      expect(
        await driver.execute(
          compiler.selectFrom('users').select(['id', 'email', 'visits']).where('id', '=', 1).compile(),
        ),
      ).toEqual([{ id: 1, email: 'updated@example.test', visits: 2 }]);

      await driver.execute(compiler.updateTable('users').set({ visits: 3 }).where('id', '=', 1).compile());
      expect(
        await driver.execute(compiler.selectFrom('users').select(['visits']).where('id', '=', 1).compile()),
      ).toEqual([{ visits: 3 }]);

      await expect(
        driver.transaction(async transaction => {
          await transaction.execute(
            compiler.insertInto('users').values({ id: 2, email: 'rollback@example.test', visits: 1 }).compile(),
          );
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      expect(await driver.execute(compiler.selectFrom('users').select(['id']).where('id', '=', 2).compile())).toEqual(
        [],
      );

      await driver.execute(compiler.deleteFrom('users').where('id', '=', 1).compile());
      expect(await driver.execute(compiler.selectFrom('users').select(['id']).compile())).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('emits executable partial indexes views and generated columns', () => {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec('CREATE TABLE people (first TEXT NOT NULL, last TEXT NOT NULL, active INTEGER NOT NULL)');
      const generated = sqlite.migrations.emitSchemaObject({
        kind: 'generated_column',
        definition: { name: 'full_name', type: 'TEXT', expression: "first || ' ' || last", stored: true },
      });
      database.exec(`ALTER TABLE people ADD COLUMN ${generated[0]}`);
      for (const sql of sqlite.migrations.emitSchemaObject({
        kind: 'create_index',
        definition: {
          name: 'people_active',
          table: 'people',
          columns: [{ expr: 'lower(last)' }],
          where: 'active = 1',
        },
      })) {
        database.exec(sql);
      }
      for (const sql of sqlite.migrations.emitSchemaObject({
        kind: 'create_view',
        definition: { name: 'active_people', select: 'SELECT full_name FROM people WHERE active = 1' },
      })) {
        database.exec(sql);
      }
      database.prepare('INSERT INTO people (first, last, active) VALUES (?, ?, ?)').run('Ada', 'Lovelace', 1);
      expect(database.prepare('SELECT full_name FROM active_people').all()).toEqual([{ full_name: 'Ada Lovelace' }]);
      for (const sql of sqlite.migrations.emitSchemaObject({ kind: 'drop_view', name: 'active_people' })) {
        database.exec(sql);
      }
      expect(database.prepare("SELECT name FROM sqlite_schema WHERE name = 'active_people'").get()).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it('refuses unsupported ALTER operations explicitly', () => {
    const operations: readonly ChangeOp[] = [
      {
        kind: 'alter_column_type',
        table: 'users',
        column: 'visits',
        from: 'integer',
        to: 'text',
      },
      { kind: 'alter_primary_key', table: 'users', from: ['id'], to: ['email'] },
      {
        kind: 'add_foreign_key',
        table: 'users',
        fk: {
          name: 'users_org_id_fkey',
          columns: ['org_id'],
          targetTable: 'orgs',
          targetColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'no action',
        },
      },
      { kind: 'drop_foreign_key', table: 'users', name: 'users_org_id_fkey' },
    ];
    for (const operation of operations) {
      expect(() => sqlite.migrations.emitUp(operation), operation.kind).toThrow(UnsupportedFeatureError);
    }
  });

  it('refuses serial outside a sole rowid-backed primary key', () => {
    const serial = { name: 'sequence_value', type: 'serial', nullable: false, primaryKey: false } as const;
    expect(() =>
      sqlite.migrations.emitUp({
        kind: 'create_table',
        table: 'events',
        columns: [serial],
        primaryKey: [],
        foreignKeys: [],
      }),
    ).toThrow('sqlite can generate serial values only for a sole INTEGER PRIMARY KEY');
    expect(() =>
      sqlite.migrations.emitUp({
        kind: 'add_column',
        table: 'events',
        column: serial,
      }),
    ).toThrow(UnsupportedFeatureError);
  });

  it('refuses lossy down migrations instead of guessing dropped schema', () => {
    expect(() => sqlite.migrations.emitDown({ kind: 'drop_table', table: 'users' })).toThrow(
      'drop operation carries no columns',
    );
    expect(() => sqlite.migrations.emitDown({ kind: 'drop_column', table: 'users', column: 'email' })).toThrow(
      'drop operation carries no type, nullability, key, or default metadata',
    );
  });

  it.each([
    ['schemas', { kind: 'create_schema', name: 'app' }],
    ['sequences', { kind: 'create_sequence', definition: { name: 'ids' } }],
    ['check constraints', { kind: 'check_constraint', table: 'users', name: 'positive', expression: 'id > 0' }],
    [
      'materialized views',
      {
        kind: 'create_view',
        definition: { name: 'mv', select: 'SELECT 1', materialized: true },
      },
    ],
    ['dropping materialized views', { kind: 'drop_view', name: 'mv', materialized: true }],
    ['row-level security', { kind: 'enable_rls', table: 'users' }],
    [
      'row-level security policies',
      {
        kind: 'create_policy',
        definition: { name: 'users_read', table: 'users', using: 'id > 0' },
      },
    ],
    ['extensions', { kind: 'create_extension', definition: { name: 'vector' } }],
    [
      'creating stored routines',
      {
        kind: 'create_routine',
        definition: {
          kind: 'function',
          name: 'archive',
          params: [],
          returns: { type: 'integer' },
          body: 'SELECT 1',
        },
      },
    ],
    [
      'dropping stored routines',
      {
        kind: 'drop_routine',
        definition: {
          kind: 'function',
          name: 'archive',
          params: [],
          returns: { type: 'integer' },
          body: 'SELECT 1',
        },
      },
    ],
    [
      'replacing stored routines',
      {
        kind: 'replace_routine',
        previous: {
          kind: 'function',
          name: 'archive',
          params: [],
          returns: { type: 'integer' },
          body: 'SELECT 1',
        },
        next: {
          kind: 'function',
          name: 'archive',
          params: [],
          returns: { type: 'integer' },
          body: 'SELECT 2',
        },
      },
    ],
  ] as const)('refuses unsupported schema object %s', (_feature, operation) => {
    expect(() => sqlite.migrations.emitSchemaObject(operation as SchemaObjectOperation)).toThrow(
      UnsupportedFeatureError,
    );
  });

  it('refuses index spellings SQLite cannot represent exactly', () => {
    for (const definition of [
      { name: 'by_id', table: 'users', columns: ['id'], method: 'btree' },
      { name: 'by_id', table: 'users', columns: ['id'], with: { lists: 10 } },
      { name: 'by_id', table: 'users', columns: [{ column: 'id', opclass: 'text_ops' }] },
    ] as const) {
      expect(() =>
        sqlite.migrations.emitSchemaObject({
          kind: 'create_index',
          definition,
        }),
      ).toThrow(UnsupportedFeatureError);
    }
  });

  it('explains how SQLite applications provide stored functions', () => {
    expect(() =>
      sqlite.migrations.emitSchemaObject({
        kind: 'create_routine',
        definition: {
          kind: 'function',
          name: 'archive',
          params: [],
          returns: { type: 'integer' },
          body: 'SELECT 1',
        },
      }),
    ).toThrow(
      'sqlite does not support stored routines (function "archive"); SQLite has no CREATE FUNCTION, ' +
        'so register the function on the connection instead — `node:sqlite` exposes `DatabaseSync#function` — ' +
        'and call it like any other',
    );
  });

  it('validates the complete plan before execution', () => {
    const operation: ChangeOp = {
      kind: 'alter_primary_key',
      table: 'users',
      from: ['id'],
      to: ['email'],
    };
    const plan: MigrationPlan = { before: USERS, after: USERS, operations: [operation] };
    expect(() => sqlite.migrations.validatePlan(plan)).toThrow(/hand-written table rebuild/);
  });

  it('the package root imports without a Node database binding', async () => {
    const packageRoot = resolve(dirname(new URL(import.meta.url).pathname));
    const files = ['index.ts', 'dialect.ts', 'driver.ts', 'introspector.ts', 'migrations.ts'];
    const source = files.map(file => readFileSync(resolve(packageRoot, file), 'utf8')).join('\n');
    expect(source).not.toContain("from 'node:");
    expect(source).not.toContain('from "node:');
    expect(source).not.toMatch(/import\s*\(\s*['"]node:/);
    expect(source).not.toMatch(/from\s+['"](?:better-sqlite3|sqlite3|@libsql\/client)['"]/);
    expect(source).not.toMatch(/import\s*\(\s*['"](?:better-sqlite3|sqlite3|@libsql\/client)['"]\s*\)/);
    const imported = await import('./index.js');
    expect(imported.sqlite).toBe(sqlite);
  });

  it('installs with no third-party runtime dependency', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(new URL('../package.json', import.meta.url).pathname), 'utf8'),
    ) as { dependencies?: Readonly<Record<string, string>> };
    expect(manifest.dependencies).toEqual({
      '@zmdb/migrations': 'workspace:1.0.0-alpha.4',
    });
  });
});
