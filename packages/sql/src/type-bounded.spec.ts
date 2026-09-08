import { describe, it, expect } from 'vitest';

import { createQueryCompiler } from './index.js';
import { postgresDialect } from './testing/official-dialects.fixture.js';

// Sample schema definition matching CoreSchema structure without package cross-dependency
interface UserSchema {
  table: 'users';
  columns: {
    id: { type: 'serial'; flags: { nullable: false } };
    email: { type: 'text'; flags: { nullable: false } };
    role: { type: 'jsonEnum'; flags: { nullable: false; enum: ['admin', 'user'] } };
    age: { type: 'integer'; flags: { nullable: true } };
    active: { type: 'boolean'; flags: { nullable: false } };
    meta: { type: 'json'; flags: { nullable: false }; __payload: { theme: string } };
  };
  primaryKey: ['id'];
  references: [];
}

// Plain interface entity matching schema
interface UserEntity {
  id: number;
  email: string;
  role: 'admin' | 'user';
  age: number | null;
  active: boolean;
}

describe('Type-Bounded Query Builders in @zmdb/query-compiler', () => {
  const qcSchema = createQueryCompiler<UserSchema>(postgresDialect);
  const qcEntity = createQueryCompiler<UserEntity>(postgresDialect);

  it('compiles valid schema-bound SELECT query with CoreSchema bound', () => {
    const q = qcSchema
      .selectFrom('users')
      .select(['id', 'email', 'role'])
      .where('email', '=', 'test@example.com')
      .andWhere('role', 'in', ['admin', 'user'])
      .orderBy('age', 'desc')
      .limit(10)
      .compile();

    expect(q.text).toBe(
      'SELECT "id", "email", "role" FROM "users" WHERE "email" = $1 AND "role" IN ($2, $3) ORDER BY "age" DESC LIMIT 10',
    );
    expect(q.parameters).toEqual(['test@example.com', 'admin', 'user']);
  });

  it('compiles valid schema-bound SELECT query with Entity record bound', () => {
    const q = qcEntity
      .selectFrom('users')
      .select(['id', 'email'])
      .where('email', '=', 'a@b.com')
      .orderBy('id', 'asc')
      .compile();

    expect(q.text).toBe('SELECT "id", "email" FROM "users" WHERE "email" = $1 ORDER BY "id" ASC');
    expect(q.parameters).toEqual(['a@b.com']);
  });

  it('compiles valid schema-bound INSERT, UPDATE, DELETE queries', () => {
    const insertQ = qcSchema
      .insertInto<Partial<UserEntity>>('users')
      .values({ email: 'new@example.com', role: 'user', active: true })
      .returning(['id', 'email'])
      .compile();

    expect(insertQ.text).toBe(
      'INSERT INTO "users" ("email", "role", "active") VALUES ($1, $2, $3) RETURNING "id", "email"',
    );

    const updateQ = qcSchema
      .updateTable<Partial<UserEntity>>('users')
      .set({ active: false })
      .where('id', '=', 1)
      .returning(['*'])
      .compile();

    expect(updateQ.text).toBe('UPDATE "users" SET "active" = $1 WHERE "id" = $2 RETURNING *');

    const deleteQ = qcSchema.deleteFrom('users').where('id', '=', 1).returning(['id']).compile();

    expect(deleteQ.text).toBe('DELETE FROM "users" WHERE "id" = $1 RETURNING "id"');
  });

  it('supports inline schema bounding on compiler method calls', () => {
    const untypedQc = createQueryCompiler(postgresDialect);
    const q = untypedQc.selectFrom<UserEntity>('users').where('role', '=', 'admin').compile();

    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" = $1');
  });

  it('maintains backwards compatibility for untyped query builders', () => {
    const untypedQc = createQueryCompiler(postgresDialect);
    const q = untypedQc
      .selectFrom('arbitrary_table')
      .select(['foo', 'bar'])
      .where('any_col', '=', 'any_value')
      .orderBy('foo', 'asc')
      .compile();

    expect(q.text).toBe('SELECT "foo", "bar" FROM "arbitrary_table" WHERE "any_col" = $1 ORDER BY "foo" ASC');
  });

  // Type-level verification tests (failures caught by tsc --noEmit)
  it('type-level verification for column name and value type validation', () => {
    const boundQc = createQueryCompiler<UserEntity>(postgresDialect);

    // @ts-expect-error - invalid column name in select
    boundQc.selectFrom('users').select(['invalid_column']);

    // @ts-expect-error - invalid column name in where
    boundQc.selectFrom('users').where('invalid_column', '=', 'value');

    // @ts-expect-error - invalid column name in orderBy
    boundQc.selectFrom('users').orderBy('invalid_column', 'asc');

    // @ts-expect-error - value type mismatch: email expects string, got number
    boundQc.selectFrom('users').where('email', '=', 123);

    // @ts-expect-error - value type mismatch for in operator: id expects number[], got string[]
    boundQc.selectFrom('users').where('id', 'in', ['a', 'b']);

    // @ts-expect-error - invalid column in insert values
    boundQc.insertInto('users').values({ invalid_col: 'bad' });

    // @ts-expect-error - value type mismatch in insert values: email expects string, got number
    boundQc.insertInto('users').values({ email: 123 });

    // @ts-expect-error - invalid column in update set
    boundQc.updateTable('users').set({ invalid_col: 'bad' });

    // @ts-expect-error - value type mismatch in update set: active expects boolean, got string
    boundQc.updateTable('users').set({ active: 'yes' });

    // @ts-expect-error - invalid column in delete where
    boundQc.deleteFrom('users').where('invalid_col', '=', 1);
  });
});
