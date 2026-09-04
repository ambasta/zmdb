import { describe, it, expect } from 'vitest';

import { emitUp, emitDown, type ChangeOp } from './index.js';

// #43: DDL emitter per dialect (Postgres/MySQL/SQLite).
//
// Two things are dialect-specific in a column definition, and this file covers the
// quoting half: `sql-types.spec.ts` covers the type half.

const addAge: ChangeOp = {
  kind: 'add_column',
  table: 'users',
  column: { name: 'age', type: 'integer', nullable: false, primaryKey: false },
};

describe('DDL emitter — per dialect quoting', () => {
  it('postgres uses double quotes', () => {
    expect(emitUp(addAge, 'postgres')).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL');
  });

  it('mysql uses backticks', () => {
    expect(emitUp(addAge, 'mysql')).toBe('ALTER TABLE `users` ADD COLUMN `age` INT NOT NULL');
  });

  it('sqlite uses double quotes', () => {
    expect(emitUp(addAge, 'sqlite')).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL');
  });
});

describe('DDL emitter — down reverses up per dialect', () => {
  it('mysql down drops the added column with backticks', () => {
    expect(emitDown(addAge, 'mysql')).toBe('ALTER TABLE `users` DROP COLUMN `age`');
  });

  it('create_table down drops the table (postgres)', () => {
    const createUsers: ChangeOp = {
      kind: 'create_table',
      table: 'users',
      columns: [{ name: 'id', type: 'serial', nullable: false, primaryKey: true }],
      primaryKey: ['id'],
      foreignKeys: [],
    };
    expect(emitUp(createUsers, 'postgres')).toBe('CREATE TABLE "users" ("id" SERIAL PRIMARY KEY)');
    expect(emitDown(createUsers, 'postgres')).toBe('DROP TABLE "users"');
  });
});

describe('DDL emitter — native primitive column types', () => {
  const createPrimitives: ChangeOp = {
    kind: 'create_table',
    table: 'primitives',
    columns: [
      { name: 'guid', type: 'uuid', nullable: false, primaryKey: true },
      { name: 'birth_date', type: 'date', nullable: false, primaryKey: false },
      { name: 'alarm_time', type: 'time', nullable: false, primaryKey: false },
      { name: 'price', type: 'decimal', nullable: false, primaryKey: false },
      { name: 'data', type: 'blob', nullable: false, primaryKey: false },
    ],
    primaryKey: ['guid'],
    foreignKeys: [],
  };

  it('postgres maps blob to bytea', () => {
    expect(emitUp(createPrimitives, 'postgres')).toBe(
      'CREATE TABLE "primitives" ("guid" uuid PRIMARY KEY, "birth_date" date NOT NULL, "alarm_time" time NOT NULL, "price" decimal NOT NULL, "data" bytea NOT NULL)',
    );
  });

  it('mysql maps uuid to char(36)', () => {
    expect(emitUp(createPrimitives, 'mysql')).toBe(
      'CREATE TABLE `primitives` (`guid` char(36) PRIMARY KEY, `birth_date` date NOT NULL, `alarm_time` time NOT NULL, `price` decimal NOT NULL, `data` blob NOT NULL)',
    );
  });

  it('sqlite maps uuid to text', () => {
    expect(emitUp(createPrimitives, 'sqlite')).toBe(
      'CREATE TABLE "primitives" ("guid" text PRIMARY KEY, "birth_date" date NOT NULL, "alarm_time" time NOT NULL, "price" decimal NOT NULL, "data" blob NOT NULL)',
    );
  });
});
