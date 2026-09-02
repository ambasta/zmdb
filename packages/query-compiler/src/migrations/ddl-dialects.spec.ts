import { describe, it, expect } from 'vitest';

import { emitUp, emitDown, type ChangeOp } from './index.ts';

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
    };
    expect(emitUp(createUsers, 'postgres')).toBe('CREATE TABLE "users" ("id" SERIAL PRIMARY KEY)');
    expect(emitDown(createUsers, 'postgres')).toBe('DROP TABLE "users"');
  });
});
