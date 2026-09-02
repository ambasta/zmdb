import { describe, expect, it } from 'vitest';

import {
  bigint,
  boolean,
  defineSchema,
  integer,
  json,
  jsonEnum,
  numeric,
  serial,
  text,
  timestamp,
  varchar,
  type ColumnMeta,
} from '../index.ts';
import {
  appTypeOf,
  irFromSchema,
  jsonSchemaForColumn,
  jsonSchemaFromIR,
  KNOWN_CONSTRAINT_KINDS,
  SQL_TYPES,
  wireTypeOf,
  type ColumnIR,
} from './index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: varchar(255).unique().validate({ kind: 'pattern', value: '^\\S+@\\S+$' }),
  age: integer().validate({ kind: 'minimum', value: 18 }).validate({ kind: 'maximum', value: 120 }),
  nickname: varchar(64).nullable().defaultTo('anon').validate({ kind: 'minLength', value: 3 }),
  role: jsonEnum(['admin', 'viewer']).defaultTo('viewer'),
  createdAt: timestamp().defaultTo('now()'),
  passwordHash: text().sensitive(),
  active: boolean(),
});

function column(name: string): ColumnIR {
  const found = irFromSchema(UserSchema).columns.find(c => c.name === name);
  if (!found) throw new Error(`no column ${name}`);
  return found;
}

// A one-column probe. `defineSchema` insists on a primary key, so the column
// under test rides alongside one.
function probe(col: ColumnMeta): ColumnIR {
  const found = irFromSchema(defineSchema('probe', { id: serial().primaryKey(), v: col })).columns.find(
    c => c.name === 'v',
  );
  if (!found) throw new Error('no probe column');
  return found;
}

describe('irFromSchema — the value front-end', () => {
  it('carries every flag the four walkers each knew only part of', () => {
    expect(column('id')).toMatchObject({ sql: 'serial', primaryKey: true, serial: true, nullable: false });
    expect(column('email')).toMatchObject({ sql: 'varchar', unique: true, length: 255 });
    expect(column('passwordHash')).toMatchObject({ sql: 'text', sensitive: true });
    expect(column('nickname')).toMatchObject({ sql: 'varchar', nullable: true, hasDefault: true });
  });

  it('records the full constraint set, including the ones TypeDescriptor lacked', () => {
    // `TypeDescriptor` had `minimum` and `maxLength` but no `maximum` and no
    // `minLength`, which is how a `Min<18> & Max<120>` column came to validate
    // differently in each walker. All five are first-class here.
    expect(column('age').constraints).toEqual({ minimum: 18, maximum: 120 });
    expect(column('nickname').constraints).toEqual({ minLength: 3 });
    expect(column('email').constraints).toEqual({ pattern: '^\\S+@\\S+$' });
  });

  it('reads both spellings of every constraint, and only those', () => {
    // `ValidationRule.kind` is an open string with two writers: `defineSchema` uses the
    // IR's own keyword, and `@zmdb/aot-validator`'s runtime `Rule` uses the tag's name
    // (`tags.Min(n)` → `{ kind: 'Min' }`). Both have to land on the same field, and the
    // table that says so has to stay total — a sixth constraint kind added without a
    // spelling would silently become a named custom rule instead.
    const spellings: readonly [string, string, unknown, Record<string, unknown>][] = [
      ['minimum', 'Min', 5, { minimum: 5 }],
      ['maximum', 'Max', 5, { maximum: 5 }],
      ['minLength', 'MinLength', 5, { minLength: 5 }],
      ['maxLength', 'MaxLength', 5, { maxLength: 5 }],
      ['pattern', 'Pattern', '^a$', { pattern: '^a$' }],
    ];
    expect(spellings.map(([keyword]) => keyword)).toEqual([...KNOWN_CONSTRAINT_KINDS]);
    for (const [keyword, tag, value, expected] of spellings) {
      expect(probe(integer().validate({ kind: keyword, value })).constraints).toEqual(expected);
      expect(probe(integer().validate({ kind: tag, args: [value] })).constraints).toEqual(expected);
    }
  });

  it('keeps an unrecognised rule kind as a named rule instead of dropping it', () => {
    // Silently ignoring it is what the old mapper did. A named rule an emitter
    // cannot resolve has to become a build error, not a check that never runs.
    expect(probe(integer().validate({ kind: 'luhn' })).rules).toEqual(['luhn']);
    expect(probe(integer().validate({ kind: 'luhn' })).constraints).toEqual({});
  });

  it('is serialisable JSON, which is what lets the codegen CLI write it to disk', () => {
    const ir = irFromSchema(UserSchema);
    expect(JSON.parse(JSON.stringify(ir))).toEqual(ir);
  });

  it('covers every SqlType', () => {
    const s = defineSchema('all', {
      a: serial().primaryKey(),
      b: integer(),
      c: bigint(),
      d: numeric(),
      e: text(),
      f: varchar(10),
      g: boolean(),
      h: timestamp(),
      i: json<{ x: number }>(),
      j: jsonEnum(['x']),
    });
    expect(
      irFromSchema(s)
        .columns.map(c => c.sql)
        .toSorted(),
    ).toEqual([...SQL_TYPES].toSorted());
  });
});

describe('the three types of a column (REQ-TF-13)', () => {
  it('a timestamp is a Date to the app and an ISO string on the wire', () => {
    expect(appTypeOf(column('createdAt'))).toEqual({ kind: 'scalar', scalar: 'date' });
    expect(wireTypeOf(column('createdAt'))).toEqual({ kind: 'scalar', scalar: 'string', format: 'date-time' });
    expect(jsonSchemaForColumn(column('createdAt'))).toEqual({ type: 'string', format: 'date-time' });
  });

  it('a bigint is a bigint to the app and a string on the wire', () => {
    expect(appTypeOf(probe(bigint()))).toEqual({ kind: 'scalar', scalar: 'bigint' });
    expect(wireTypeOf(probe(bigint()))).toEqual({ kind: 'scalar', scalar: 'string', format: 'int64' });
  });

  it('distinguishes integer from number so an emitter can check integrality', () => {
    expect(appTypeOf(column('id'))).toMatchObject({ scalar: 'integer' });
    expect(appTypeOf(probe(numeric()))).toMatchObject({ scalar: 'number' });
  });

  it('renders an enum column as a literal union, not as a bare string', () => {
    expect(appTypeOf(column('role'))).toEqual({
      kind: 'union',
      members: [
        { kind: 'literal', value: 'admin' },
        { kind: 'literal', value: 'viewer' },
      ],
    });
  });

  it('wraps a nullable column in a union with null rather than losing it', () => {
    // Nullability was absent from `TypeDescriptor` entirely, so the AOT could not
    // emit the null arm at all.
    expect(appTypeOf(column('nickname'))).toMatchObject({ kind: 'union' });
    expect(appTypeOf(column('nickname'))).toEqual({
      kind: 'union',
      members: [{ kind: 'scalar', scalar: 'string', constraints: { minLength: 3, maxLength: 64 } }, { kind: 'null' }],
    });
  });
});

describe('jsonSchemaFromIR — the emitter is a pure function of IR', () => {
  it('omits sensitive columns from every variant', () => {
    for (const variant of ['entity', 'create', 'update', 'get', 'list', 'search'] as const) {
      expect(Object.keys(jsonSchemaFromIR(irFromSchema(UserSchema), variant))).toContain('properties');
      expect(jsonSchemaFromIR(irFromSchema(UserSchema), variant).properties).not.toHaveProperty('passwordHash');
    }
  });

  it('drops database-generated columns from create but keeps them in responses', () => {
    expect(jsonSchemaFromIR(irFromSchema(UserSchema), 'create').properties).not.toHaveProperty('id');
    expect(jsonSchemaFromIR(irFromSchema(UserSchema), 'entity').properties).toHaveProperty('id');
  });

  it('requires nothing on update', () => {
    expect(jsonSchemaFromIR(irFromSchema(UserSchema), 'update').required).toEqual([]);
  });

  it('treats defaulted and nullable columns as optional on create', () => {
    const required = jsonSchemaFromIR(irFromSchema(UserSchema), 'create').required;
    expect(required).not.toContain('createdAt');
    expect(required).not.toContain('nickname');
    expect(required).toContain('email');
  });

  it('widens a nullable type keyword and leaves a json column alone', () => {
    expect(jsonSchemaForColumn(column('nickname'))).toMatchObject({ type: ['string', 'null'] });
    expect(jsonSchemaForColumn(probe(json().nullable()))).toEqual({});
  });

  it('emits every constraint keyword, in a stable order', () => {
    expect(Object.keys(jsonSchemaForColumn(column('age')))).toEqual(['type', 'minimum', 'maximum']);
    expect(jsonSchemaForColumn(column('age'))).toEqual({ type: 'integer', minimum: 18, maximum: 120 });
  });

  it('lets an explicit maxLength rule win over the varchar length', () => {
    expect(jsonSchemaForColumn(probe(varchar(255).validate({ kind: 'maxLength', value: 10 })))).toEqual({
      type: 'string',
      maxLength: 10,
    });
  });
});
