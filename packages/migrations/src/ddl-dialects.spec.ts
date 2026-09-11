// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { describe, it, expect } from 'vitest';

import { emitUp, emitDown, type ChangeOp } from './index.js';
import { mysqlDialect, postgresDialect, sqliteDialect } from './testing/official-dialects.fixture.js';

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
    expect(emitUp(addAge, postgresDialect)).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL');
  });

  it('mysql uses backticks', () => {
    expect(emitUp(addAge, mysqlDialect)).toBe('ALTER TABLE `users` ADD COLUMN `age` INT NOT NULL');
  });

  it('sqlite uses double quotes', () => {
    expect(emitUp(addAge, sqliteDialect)).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER NOT NULL');
  });
});

describe('DDL emitter — down reverses up per dialect', () => {
  it('mysql down drops the added column with backticks', () => {
    expect(emitDown(addAge, mysqlDialect)).toBe('ALTER TABLE `users` DROP COLUMN `age`');
  });

  it('create_table down drops the table (postgres)', () => {
    const createUsers: ChangeOp = {
      kind: 'create_table',
      table: 'users',
      columns: [{ name: 'id', type: 'serial', nullable: false, primaryKey: true }],
      primaryKey: ['id'],
      foreignKeys: [],
    };
    expect(emitUp(createUsers, postgresDialect)).toBe('CREATE TABLE "users" ("id" SERIAL PRIMARY KEY)');
    expect(emitDown(createUsers, postgresDialect)).toBe('DROP TABLE "users"');
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
    expect(emitUp(createPrimitives, postgresDialect)).toBe(
      'CREATE TABLE "primitives" ("guid" uuid PRIMARY KEY, "birth_date" date NOT NULL, "alarm_time" time NOT NULL, "price" decimal NOT NULL, "data" bytea NOT NULL)',
    );
  });

  it('mysql maps uuid to char(36)', () => {
    expect(emitUp(createPrimitives, mysqlDialect)).toBe(
      'CREATE TABLE `primitives` (`guid` CHAR(36) PRIMARY KEY, `birth_date` DATE NOT NULL, `alarm_time` TIME NOT NULL, `price` DECIMAL NOT NULL, `data` BLOB NOT NULL)',
    );
  });

  it('sqlite maps uuid to text', () => {
    expect(emitUp(createPrimitives, sqliteDialect)).toBe(
      'CREATE TABLE "primitives" ("guid" TEXT PRIMARY KEY NOT NULL, "birth_date" TEXT NOT NULL, "alarm_time" TEXT NOT NULL, "price" NUMERIC NOT NULL, "data" BLOB NOT NULL)',
    );
  });
});
