import { describe, it, expect } from 'vitest';

import { ddlType, emitUp, snapshot, type ChangeOp, type ColumnSnapshot } from './index.js';

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

/** abstract type → [postgres, mysql, sqlite]. */
const TYPES: Readonly<Record<string, readonly [string, string, string]>> = {
  serial: ['SERIAL', 'INT AUTO_INCREMENT UNIQUE', 'INTEGER'],
  integer: ['INTEGER', 'INT', 'INTEGER'],
  bigint: ['BIGINT', 'BIGINT', 'INTEGER'],
  numeric: ['NUMERIC', 'DECIMAL', 'NUMERIC'],
  text: ['TEXT', 'TEXT', 'TEXT'],
  boolean: ['BOOLEAN', 'TINYINT(1)', 'INTEGER'],
  timestamp: ['TIMESTAMPTZ', 'DATETIME(3)', 'TEXT'],
  json: ['JSONB', 'JSON', 'TEXT'],
  jsonEnum: ['TEXT', 'TEXT', 'TEXT'],
};

describe('ddlType', () => {
  for (const [type, [postgres, mysql, sqlite]] of Object.entries(TYPES)) {
    it(`renders ${type} per dialect`, () => {
      expect(ddlType('postgres', col(type))).toBe(postgres);
      expect(ddlType('mysql', col(type))).toBe(mysql);
      expect(ddlType('sqlite', col(type))).toBe(sqlite);
    });
  }

  it('puts a varchar length inside the type, where the dialect has one', () => {
    expect(ddlType('postgres', col('varchar', { length: 255 }))).toBe('VARCHAR(255)');
    expect(ddlType('mysql', col('varchar', { length: 255 }))).toBe('VARCHAR(255)');
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

  it('maps the target of an alter, in every dialect', () => {
    const alter: ChangeOp = { kind: 'alter_column_type', table: 'events', column: 'at', from: 'text', to: 'timestamp' };
    expect(emitUp(alter, 'postgres')).toContain('TYPE TIMESTAMPTZ');
    expect(emitUp(alter, 'mysql')).toContain('TYPE DATETIME(3)');
    expect(emitUp(alter, 'sqlite')).toContain('TYPE TEXT');
  });
});

describe('the snapshot stays abstract', () => {
  it('records the schema type and the length, and names no dialect', () => {
    const taken = snapshot([
      {
        table: 'users',
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
    // So a snapshot of a schema with no `varchar` is byte-identical to one taken before
    // the field existed, and a stored migration state does not diff against itself.
    const taken = snapshot([{ table: 't', columns: { id: { type: 'integer', flags: { nullable: false } } } }]);
    expect(JSON.stringify(taken)).toBe(
      '{"version":1,"tables":[{"name":"t","columns":[{"name":"id","type":"integer","nullable":false,"primaryKey":false}]}]}',
    );
  });
});
