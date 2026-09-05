import { SQL_TYPES } from '@zmdb/schema-core/ir';
import { describe, it, expect } from 'vitest';

import { DDL_TYPES, ddlType, emitUp, snapshot, type ChangeOp, type ColumnSnapshot } from './index.js';

// The DDL type map: what each dialect calls each abstract column type.
//
// The table below is the specification, written out per dialect rather than derived,
// because a derived expectation would agree with a wrong map. The row that pays for the
// whole thing is `timestamp`: it used to reach all three databases as the literal word
// `timestamp`, which Postgres reads as "without time zone" — so every `Date` written
// through a generated migration lost its offset, silently, and the DDL, the validator and
// the JSON Schema each said something different about the same column.

const col = (type: string, extra: Partial<ColumnSnapshot> = {}): ColumnSnapshot => ({
  name: 'c',
  type,
  nullable: false,
  primaryKey: false,
  ...extra,
});

/** abstract type → [postgres, mysql, sqlite, mssql]. */
const TYPES: Readonly<Record<string, readonly [string, string, string, string]>> = {
  serial: ['SERIAL', 'INT AUTO_INCREMENT UNIQUE', 'INTEGER', 'INT IDENTITY(1,1)'],
  integer: ['INTEGER', 'INT', 'INTEGER', 'INT'],
  bigint: ['BIGINT', 'BIGINT', 'INTEGER', 'BIGINT'],
  numeric: ['NUMERIC', 'DECIMAL', 'NUMERIC', 'DECIMAL'],
  text: ['TEXT', 'TEXT', 'TEXT', 'NVARCHAR(MAX)'],
  boolean: ['BOOLEAN', 'TINYINT(1)', 'INTEGER', 'BIT'],
  timestamp: ['TIMESTAMPTZ', 'DATETIME(3)', 'TEXT', 'DATETIMEOFFSET(3)'],
  json: ['JSONB', 'JSON', 'TEXT', 'NVARCHAR(MAX)'],
  jsonEnum: ['TEXT', 'TEXT', 'TEXT', 'NVARCHAR(MAX)'],
};

describe('ddlType', () => {
  it('keeps DDL_TYPES exhaustive over SqlType', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite', 'mssql'] as const) {
      expect(Object.keys(DDL_TYPES[dialect]).toSorted()).toEqual([...SQL_TYPES].toSorted());
    }
  });

  for (const [type, [postgres, mysql, sqlite, mssql]] of Object.entries(TYPES)) {
    it(`renders ${type} per dialect`, () => {
      expect(ddlType('postgres', col(type))).toBe(postgres);
      expect(ddlType('mysql', col(type))).toBe(mysql);
      expect(ddlType('sqlite', col(type))).toBe(sqlite);
      expect(ddlType('mssql', col(type))).toBe(mssql);
    });
  }

  it('puts a varchar length inside the type, where the dialect has one', () => {
    expect(ddlType('postgres', col('varchar', { length: 255 }))).toBe('VARCHAR(255)');
    expect(ddlType('mysql', col('varchar', { length: 255 }))).toBe('VARCHAR(255)');
    expect(ddlType('mssql', col('varchar', { length: 255 }))).toBe('NVARCHAR(255)');
    // No parameterised string type: SQLite's `TEXT` has no length, and declaring one
    // would be decoration — the affinity ignores it.
    expect(ddlType('sqlite', col('varchar', { length: 255 }))).toBe('TEXT');
  });

  it('degrades a length-less varchar to something each dialect can run', () => {
    // Legal in Postgres, and unlimited. A syntax error in MySQL, so `TEXT` instead:
    // emitting DDL that cannot execute is the one outcome with no defence.
    expect(ddlType('postgres', col('varchar'))).toBe('VARCHAR');
    expect(ddlType('mysql', col('varchar'))).toBe('TEXT');
    expect(ddlType('sqlite', col('varchar'))).toBe('TEXT');
    expect(ddlType('mssql', col('varchar'))).toBe('NVARCHAR(MAX)');
  });

  it('keys a MySQL auto-increment column, one way or the other', () => {
    // MySQL requires an AUTO_INCREMENT column to be part of a key. It is the primary key
    // in almost every schema; a non-primary `serial()` is legal, and gets the unique key
    // spelled out rather than quietly losing the auto-increment.
    expect(ddlType('mysql', col('serial', { primaryKey: true }))).toBe('INT AUTO_INCREMENT');
    expect(ddlType('mysql', col('serial'))).toBe('INT AUTO_INCREMENT UNIQUE');
  });

  it('passes an unrecognised type through unchanged', () => {
    // A hand-written snapshot, or a column type added to the schema DSL before this map
    // hears about it. Passing it through is wrong in a way the database will report;
    // mapping it to a guess is wrong in a way nobody will.
    expect(ddlType('postgres', col('citext'))).toBe('citext');
    expect(ddlType('mysql', col('GEOMETRY'))).toBe('GEOMETRY');
  });
});

describe('emitUp uses the map', () => {
  const create: ChangeOp = {
    kind: 'create_table',
    table: 'events',
    columns: [
      col('serial', { name: 'id', primaryKey: true }),
      col('varchar', { name: 'name', length: 60 }),
      col('timestamp', { name: 'at', nullable: true }),
    ],
    primaryKey: ['id'],
    foreignKeys: [],
  };

  it('postgres', () => {
    expect(emitUp(create, 'postgres')).toBe(
      'CREATE TABLE "events" ("id" SERIAL PRIMARY KEY, "name" VARCHAR(60) NOT NULL, "at" TIMESTAMPTZ)',
    );
  });

  it('mysql', () => {
    expect(emitUp(create, 'mysql')).toBe(
      'CREATE TABLE `events` (`id` INT AUTO_INCREMENT PRIMARY KEY, `name` VARCHAR(60) NOT NULL, `at` DATETIME(3))',
    );
  });

  it('sqlite', () => {
    expect(emitUp(create, 'sqlite')).toBe(
      'CREATE TABLE "events" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL, "at" TEXT)',
    );
  });

  it('mssql', () => {
    expect(emitUp(create, 'mssql')).toBe(
      'CREATE TABLE [events] ([id] INT IDENTITY(1,1) PRIMARY KEY, [name] NVARCHAR(60) NOT NULL, ' +
        '[at] DATETIMEOFFSET(3))',
    );
  });

  it('maps the target of an alter, in every dialect', () => {
    const alter: ChangeOp = {
      kind: 'alter_column_type',
      table: 'events',
      column: 'at',
      from: 'text',
      to: 'timestamp',
      fromNullable: false,
      toNullable: false,
    };
    expect(emitUp(alter, 'postgres')).toContain('TYPE TIMESTAMPTZ');
    expect(emitUp(alter, 'mysql')).toContain('MODIFY COLUMN `at` DATETIME(3)');
    expect(() => emitUp(alter, 'sqlite')).toThrow('sqlite cannot alter a column type in place');
    expect(emitUp(alter, 'mssql')).toContain('ALTER COLUMN [at] DATETIMEOFFSET(3) NOT NULL');
  });
});

describe('the snapshot stays abstract', () => {
  it('records the schema type and the length, and names no dialect', () => {
    const taken = snapshot([
      {
        table: 'users',
        primaryKey: ['id'],
        columns: {
          id: { type: 'serial', flags: { nullable: false, primaryKey: true } },
          email: { type: 'varchar', flags: { nullable: false, length: 255 } },
          createdAt: { type: 'timestamp', flags: { nullable: false } },
        },
      },
    ]);

    expect(taken.tables[0]?.columns).toEqual([
      { name: 'createdAt', type: 'timestamp', nullable: false, primaryKey: false },
      { name: 'email', type: 'varchar', nullable: false, primaryKey: false, length: 255 },
      { name: 'id', type: 'serial', nullable: false, primaryKey: true },
    ]);
  });

  it('omits length entirely when there is none', () => {
    // The required extension list belongs to the snapshot as a whole; the column still
    // carries no meaningless `length` field.
    const taken = snapshot([
      { table: 't', primaryKey: [], columns: { id: { type: 'integer', flags: { nullable: false } } } },
    ]);
    expect(JSON.stringify(taken)).toBe(
      '{"version":1,"tables":[{"name":"t","columns":[{"name":"id","type":"integer","nullable":false,"primaryKey":false}],"primaryKey":[],"foreignKeys":[]}],"extensions":[]}',
    );
  });
});
