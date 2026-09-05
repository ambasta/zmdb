import { postgres } from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { describe, it, expect } from 'vitest';

import { ValidationError } from '../index.js';
import type { Ext, Sql, Table } from '../tags/index.js';
import { UserSchema, type User } from './fixtures.js';
import { compileWhere, type WhereDTO, type WhereTarget } from './index.js';

// Fake builder that records the where/orWhere calls (compiler-agnostic).
function recorder() {
  const calls: [string, string, string, unknown][] = [];
  interface B {
    where(c: string, o: string, v: unknown): B;
    orWhere(c: string, o: string, v: unknown): B;
    whereExists?(sub: unknown): B;
    orWhereExists?(sub: unknown): B;
    whereNotExists?(sub: unknown): B;
    orWhereNotExists?(sub: unknown): B;
    calls: typeof calls;
  }
  const mk = (): B => ({
    where: (c: string, o: string, v: unknown) => (calls.push(['and', c, o, v]), mk()),
    orWhere: (c: string, o: string, v: unknown) => (calls.push(['or', c, o, v]), mk()),
    whereExists: (sub: unknown) => (calls.push(['and', '', 'EXISTS', sub]), mk()),
    orWhereExists: (sub: unknown) => (calls.push(['or', '', 'EXISTS', sub]), mk()),
    whereNotExists: (sub: unknown) => (calls.push(['and', '', 'NOT EXISTS', sub]), mk()),
    orWhereNotExists: (sub: unknown) => (calls.push(['or', '', 'NOT EXISTS', sub]), mk()),
    calls,
  });
  const b = mk();
  return { b, calls };
}

interface VectorItem extends Table<'vector_items'> {
  readonly embedding: readonly number[] & Ext<'vector', 'vector', [3]>;
  readonly title: string & Sql<'text'>;
}

describe('WhereDTO + operator set (#179)', () => {
  it('bare value ⇒ eq', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = { role: 'admin' };
    compileWhere(b, where);
    expect(calls).toEqual([['and', 'role', '=', 'admin']]);
  });

  it('comparison + membership operators map to SQL', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = {
      age: { gte: 18, lt: 65 },
      id: { in: [1, 2, 3] },
    };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'age', '>=', 18],
      ['and', 'age', '<', 65],
      ['and', 'id', 'in', [1, 2, 3]],
    ]);
  });

  it('nin/like/ilike', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = {
      role: { nin: ['admin'] },
      email: { like: '%@x.com', ilike: '%@Y.com' },
    };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'role', 'not in', ['admin']],
      ['and', 'email', 'like', '%@x.com'],
      ['and', 'email', 'ilike', '%@Y.com'],
    ]);
  });

  it('maps vector distance operators only from a vector-typed WhereDTO field', () => {
    const { b, calls } = recorder();
    const queryVector = [0.1, 0.2, 0.3] as const;
    const where: WhereDTO<VectorItem> = {
      embedding: { l2: queryVector, cosine: queryVector, ip: queryVector },
    };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'embedding', 'l2', queryVector],
      ['and', 'embedding', 'cosine', queryVector],
      ['and', 'embedding', 'ip', queryVector],
    ]);

    const vectorBuilder = createQueryCompiler(postgres).selectFrom('vector_items');
    const cosineWhere: WhereDTO<VectorItem> = { embedding: { cosine: queryVector } };
    expect(compileWhere<VectorItem, typeof vectorBuilder>(vectorBuilder, cosineWhere).compile()).toEqual({
      text: 'SELECT * FROM "vector_items" WHERE "embedding" <=> $1',
      parameters: ['[0.1,0.2,0.3]'],
    });
  });

  it('isNull / notNull', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = {
      email: { isNull: true },
      role: { notNull: true },
    };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['and', 'email', 'is null', null],
      ['and', 'role', 'is not null', null],
    ]);
  });

  it('or group ORs its members', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = { or: [{ role: 'admin' }, { age: { gt: 90 } }] };
    compileWhere(b, where);
    expect(calls).toEqual([
      ['or', 'role', '=', 'admin'],
      ['or', 'age', '>', 90],
    ]);
  });

  it('empty where adds nothing', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = {};
    compileWhere(b, where);
    expect(calls).toEqual([]);
  });

  it('subquery comparison operators in FieldOps', () => {
    const qb = createQueryCompiler(postgres);
    const sub = qb.selectFrom('orders').select(['user_id']).where('total', '>', 100);
    const builder = compileWhere(qb.selectFrom('users'), {
      id: { in: sub },
      age: { gt: { table: 'users_stats', select: ['avg_age'] } },
    } as WhereDTO<User>);

    const compiled = builder.compile();
    expect(compiled.text).toBe(
      'SELECT * FROM "users" WHERE "id" IN (SELECT "user_id" FROM "orders" WHERE "total" > $1) AND "age" > (SELECT "avg_age" FROM "users_stats")',
    );
    expect(compiled.parameters).toEqual([100]);
  });

  it('EXISTS operator containing nested filter definitions and subqueries', () => {
    const qb = createQueryCompiler(postgres);
    const builder = compileWhere(qb.selectFrom('users'), {
      role: 'admin',
      exists: {
        table: 'orders',
        where: {
          total: { gte: 500 },
        },
      },
    } as unknown as WhereDTO<User>);

    const compiled = builder.compile();
    expect(compiled.text).toBe(
      'SELECT * FROM "users" WHERE "role" = $1 AND EXISTS (SELECT * FROM "orders" WHERE "total" >= $2)',
    );
    expect(compiled.parameters).toEqual(['admin', 500]);
  });

  it('throws an error if builder lacks whereExists support', () => {
    const fakeBuilder = {
      dialect: postgres,
      where: () => fakeBuilder,
      orWhere: () => fakeBuilder,
    };
    expect(() =>
      compileWhere(
        fakeBuilder as unknown as WhereTarget,
        {
          exists: { table: 'orders' },
        } as WhereDTO<User>,
      ),
    ).toThrow('Builder does not support whereExists');
  });

  describe('schema column and operator validation', () => {
    it('throws ValidationError when filtering by unknown column if schema is provided', () => {
      const { b } = recorder();
      expect(() => compileWhere(b, { unknownCol: 'value' } as unknown as WhereDTO<User>, UserSchema)).toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError when in operator receives non-array value', () => {
      const { b } = recorder();
      expect(() => compileWhere(b, { id: { in: 123 as unknown as number[] } } as WhereDTO<User>, UserSchema)).toThrow(
        ValidationError,
      );
    });

    it('throws ValidationError when scalar operator receives array value', () => {
      const { b } = recorder();
      expect(() =>
        compileWhere(b, { age: { gt: [10, 20] as unknown as number } } as WhereDTO<User>, UserSchema),
      ).toThrow(ValidationError);
    });

    it('throws ValidationError when eq bare value receives array value', () => {
      const { b } = recorder();
      expect(() => compileWhere(b, { role: ['admin'] as unknown as 'admin' } as WhereDTO<User>, UserSchema)).toThrow(
        ValidationError,
      );
    });
  });
});

// #364. The operator allowlist was a truthy read on an object literal, so every
// `Object.prototype` member passed it — as a function or an object — and reached the
// compiler. Where-DTOs are the path user JSON takes into the query builder, so these
// keys arrive from outside the process.
//
// The payloads are deliberately ones the type system cannot describe, so this is the
// one place that widens, and `__proto__` has to come through `JSON.parse`: in an
// object literal it sets the prototype instead of becoming a key.
function fromUserJson(json: string): WhereDTO<User> {
  const parsed: unknown = JSON.parse(json);
  return parsed as WhereDTO<User>;
}

describe('compileWhere: the operator allowlist fails closed (#364)', () => {
  const inherited = [
    'toString',
    'toLocaleString',
    'valueOf',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    '__proto__',
  ];

  it.each(inherited)('rejects the inherited key %s instead of emitting it', key => {
    const { b, calls } = recorder();
    const where = fromUserJson(`{"email":{${JSON.stringify(key)}:"x"}}`);

    expect(() => compileWhere(b, where)).toThrow(ValidationError);
    expect(() => compileWhere(b, where)).toThrow(`unknown operator "${key}" on column "email"`);
    // Nothing partially applied: the throw happens instead of the predicate, not after it.
    expect(calls).toEqual([]);
  });

  it('rejects a misspelled operator rather than dropping the predicate', () => {
    const { b } = recorder();

    expect(() => compileWhere(b, fromUserJson('{"age":{"equals":42}}'))).toThrow(
      'compileWhere: unknown operator "equals" on column "age"',
    );
  });

  it('names the column and lists the operators it would have accepted', () => {
    const { b } = recorder();
    let issues: readonly { path: string; message: string; expected?: string }[] = [];
    try {
      compileWhere(b, fromUserJson('{"age":{"greaterThan":42}}'));
    } catch (error) {
      if (error instanceof ValidationError) issues = error.issues;
    }

    expect(issues).toEqual([
      {
        path: 'age',
        message: 'unknown operator "greaterThan"',
        expected: 'eq | ne | lt | lte | gt | gte | in | nin | like | ilike | l2 | cosine | ip | isNull | notNull',
        value: 42,
      },
    ]);
  });

  it('still accepts every operator it names, from untyped input', () => {
    const { b, calls } = recorder();
    compileWhere(
      b,
      fromUserJson(
        '{"age":{"eq":1,"ne":2,"lt":3,"lte":4,"gt":5,"gte":6,"like":"a","ilike":"b"},"email":{"isNull":true},"role":{"notNull":true}}',
      ),
    );

    expect(calls.map(call => call[2])).toEqual([
      '=',
      '!=',
      '<',
      '<=',
      '>',
      '>=',
      'like',
      'ilike',
      'is null',
      'is not null',
    ]);
  });
});

// #608. The sibling of #364, and the one the type system cannot help with: every key of
// `FieldOps` is optional, so `{ age: {} }` type-checks. It is also what a conditionally
// assembled filter produces —
//
//   const where: WhereDTO<User> = { age: min === undefined ? {} : { gte: min } };
//
// — and it used to fold to nothing at all. A dropped predicate is not a wrong answer on a
// `SELECT`, it is every row; on an `UPDATE` or a `DELETE` it is the whole table.
describe('compileWhere: an empty operator map is not a filter (#608)', () => {
  it('refuses a column whose operator map is empty', () => {
    const { b, calls } = recorder();
    const where: WhereDTO<User> = { age: {} };

    expect(() => compileWhere(b, where)).toThrow(ValidationError);
    expect(() => compileWhere(b, where)).toThrow(
      'compileWhere: column "age" has an empty operator map, which would match every row',
    );
    expect(calls).toEqual([]);
  });

  it('names the column and the operators it would have accepted', () => {
    const { b } = recorder();
    let issues: readonly { path: string; message: string; expected?: string }[] = [];
    try {
      compileWhere(b, { email: {} } as WhereDTO<User>);
    } catch (error) {
      if (error instanceof ValidationError) issues = error.issues;
    }

    expect(issues).toEqual([
      {
        path: 'email',
        message: 'empty operator map',
        expected: 'eq | ne | lt | lte | gt | gte | in | nin | like | ilike | l2 | cosine | ip | isNull | notNull',
      },
    ]);
  });

  it('refuses it before applying the predicates that came before it', () => {
    // Order matters for the same reason the #364 throw is placed where it is: a caller who
    // catches the error must not be holding a builder with half the clause on it.
    const { b, calls } = recorder();

    expect(() => compileWhere(b, { role: 'admin', age: {} } as WhereDTO<User>)).toThrow('empty operator map');
    expect(calls).toEqual([['and', 'role', '=', 'admin']]);
  });

  it('refuses an empty map nested inside an or group', () => {
    const { b } = recorder();

    expect(() => compileWhere(b, { or: [{ role: 'admin' }, { age: {} }] } as WhereDTO<User>)).toThrow(
      'compileWhere: column "age" has an empty operator map, which would match every row',
    );
  });

  it('refuses an empty map nested inside an and group', () => {
    const { b } = recorder();

    expect(() => compileWhere(b, { and: [{ email: {} }] } as WhereDTO<User>)).toThrow(
      'compileWhere: column "email" has an empty operator map, which would match every row',
    );
  });

  it('leaves the documented empty WhereDTO alone', () => {
    // §1: "Empty WhereDTO ⇒ no predicate added." That one is deliberate — `list()` with no
    // filter goes through it — and it stays legal. What guards the write path against it is
    // `BaseRepository`'s own refusal to compile an `UPDATE`/`DELETE` with no `WHERE`, not
    // this function. An empty `and`/`or` array is the same case one level down.
    const { b, calls } = recorder();
    compileWhere(b, {});
    compileWhere(b, { and: [], or: [] });
    compileWhere(b, { and: [{}] } as WhereDTO<User>);

    expect(calls).toEqual([]);
  });

  it('still accepts a map with one operator in it', () => {
    // The control: the check counts keys, so it must not have made `{ gte: 18 }` — the shape
    // the conditional above produces on its other branch — any harder to write.
    const { b, calls } = recorder();
    const where: WhereDTO<User> = { age: { gte: 18 } };
    compileWhere(b, where);

    expect(calls).toEqual([['and', 'age', '>=', 18]]);
  });
});
