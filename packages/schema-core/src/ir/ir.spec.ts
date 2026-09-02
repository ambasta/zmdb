import { describe, expect, it } from 'vitest';

import {
  bigint,
  boolean,
  defineSchema,
  integer,
  json,
  jsonEnum,
  numeric,
  references,
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
  objectTypeFromIR,
  schemaFromIR,
  SQL_TYPES,
  wireTypeOf,
  type ColumnIR,
  type PropertyIR,
  type SchemaIR,
  type Variant,
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

describe('schemaFromIR — the value back-end (REQ-TF-10)', () => {
  const Memberships = defineSchema(
    'memberships',
    {
      userId: references(integer().primaryKey(), 'users', 'id'),
      groupId: integer().primaryKey(),
      note: text().nullable().validate({ kind: 'luhn' }),
    },
    { ftsTable: true },
  );

  // The property the whole phase rests on. Everything downstream of a schema value —
  // the query compiler, the DDL emitter, the repository — is a function of the IR the
  // value produces, so a schema value that produces the same IR is the same schema
  // value as far as any of them can tell.
  it('round-trips: the IR of the generated value equals the IR it came from', () => {
    for (const schema of [UserSchema, Memberships]) {
      const ir = irFromSchema(schema);
      expect(irFromSchema(schemaFromIR(ir))).toEqual(ir);
    }
  });

  it('is plain data — no fluent builder, nothing to call', () => {
    // `defineSchema`'s columns are `Column` objects with `notNull()`, `nullable()` and
    // seven more methods on them. The generated value is a literal, so it has to be the
    // case that nothing reads those, and the way to know is that a JSON round trip of
    // the generated value is the generated value.
    const value = schemaFromIR(irFromSchema(UserSchema));
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it('keeps flags to the ones that are set, the way the builder writes them', () => {
    const columns = schemaFromIR(irFromSchema(UserSchema)).columns;
    // `serial()` sets `hasDefault` as well as `autoIncrement`: the database supplies the
    // value, which is a default in every sense the schema cares about.
    expect(columns.id).toEqual({
      type: 'serial',
      flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true },
    });
    expect(columns.active).toEqual({ type: 'boolean', flags: { nullable: false } });
    expect(columns.passwordHash).toEqual({ type: 'text', flags: { nullable: false, sensitive: true } });
  });

  it('writes the constraints back in a fixed order, and keeps a named rule', () => {
    const columns = schemaFromIR(irFromSchema(UserSchema)).columns;
    expect(columns.age?.validation).toEqual([
      { kind: 'minimum', value: 18 },
      { kind: 'maximum', value: 120 },
    ]);
    expect(schemaFromIR(irFromSchema(Memberships)).columns.note?.validation).toEqual([{ kind: 'luhn' }]);
  });

  it('restores a foreign key in both places the schema records one', () => {
    const value = schemaFromIR(irFromSchema(Memberships));
    expect(value.references).toEqual([{ column: 'userId', target: 'users.id' }]);
    expect(value.columns.userId?.references).toEqual({ target: 'users.id' });
    expect(value.primaryKey).toEqual(['userId', 'groupId']);
    expect(value.ftsTable).toBe(true);
  });

  it('drops the three things only a type can say, rather than inventing a spelling', () => {
    // `Numeric<10, 2>`, `Codec<'Money'>` and a `json` payload shape have no home in a
    // `CoreSchema` — `defineSchema` cannot express any of them either. They are dropped
    // here on purpose: the two back-ends that need them read the IR directly. If this
    // ever stops being true, this test is the one that has to change first.
    const ir: SchemaIR = {
      table: 'invoices',
      columns: [
        {
          name: 'total',
          sql: 'numeric',
          nullable: false,
          primaryKey: true,
          serial: false,
          unique: false,
          hasDefault: false,
          sensitive: false,
          precision: [10, 2],
          codec: 'Money',
          payload: { kind: 'unknown' },
          constraints: {},
          rules: [],
        },
      ],
      primaryKey: ['total'],
      relations: [],
    };
    const back = irFromSchema(schemaFromIR(ir));
    expect(back.columns[0]).not.toHaveProperty('precision');
    expect(back.columns[0]).not.toHaveProperty('codec');
    expect(back.columns[0]).not.toHaveProperty('payload');
    expect(back.columns[0]?.sql).toBe('numeric');
  });
});

describe('objectTypeFromIR — the validator back-end (REQ-TF-13)', () => {
  function properties(variant: Variant, layer?: 'app' | 'wire'): readonly PropertyIR[] {
    return objectTypeFromIR(irFromSchema(UserSchema), variant, layer).properties;
  }

  function property(name: string, variant: Variant = 'entity', layer?: 'app' | 'wire'): PropertyIR {
    const found = properties(variant, layer).find(p => p.name === name);
    if (!found) throw new Error(`no property ${name} in the ${variant} payload`);
    return found;
  }

  it('is the entity row, in declaration order, with nothing optional', () => {
    // Not sorted, unlike the JSON Schema back-end: a document is published and its key
    // order is part of it, and a `TypeIR` is read by an emitter that does not care.
    expect(properties('entity').map(p => p.name)).toEqual([
      'id',
      'email',
      'age',
      'nickname',
      'role',
      'createdAt',
      'passwordHash',
      'active',
    ]);
    expect(properties('entity').every(p => !p.optional)).toBe(true);
  });

  it('keeps a sensitive column, unlike the JSON Schema back-end', () => {
    // The distinction REQ-TF-6 actually draws: a published document must not name a
    // password, and a `create` validator that ignored it would reject every real payload.
    expect(properties('create').map(p => p.name)).toContain('passwordHash');
    expect(jsonSchemaFromIR(irFromSchema(UserSchema), 'create').properties).not.toHaveProperty('passwordHash');
  });

  it('drops a serial column from create and makes a defaulted one optional', () => {
    expect(properties('create').map(p => p.name)).not.toContain('id');
    expect(property('createdAt', 'create').optional).toBe(true);
    expect(property('email', 'create').optional).toBe(false);
  });

  it('drops the identity columns from a patch and requires nothing', () => {
    expect(properties('update').map(p => p.name)).not.toContain('id');
    expect(properties('update').every(p => p.optional)).toBe(true);
  });

  it('marks nothing readonly, because a payload is an object the caller just built', () => {
    expect(properties('entity').every(p => !p.readonly)).toBe(true);
  });

  it('renders the layer it was asked for, and not both', () => {
    // The bug this back-end replaces: `valueMatchesColumn` accepted `Date | string` for a
    // `timestamp`, so neither layer was ever wrong and neither was ever checked. A caller
    // now says which side of the boundary it is on.
    expect(property('createdAt').type).toEqual({ kind: 'scalar', scalar: 'date' });
    expect(property('createdAt', 'entity', 'wire').type).toEqual({
      kind: 'scalar',
      scalar: 'string',
      format: 'date-time',
    });
  });

  it('carries the constraints, so one call validates types and bounds together', () => {
    expect(property('age').type).toEqual({
      kind: 'scalar',
      scalar: 'integer',
      constraints: { minimum: 18, maximum: 120 },
    });
    expect(property('email').type).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { pattern: '^\\S+@\\S+$', maxLength: 255 },
    });
    expect(property('role').type).toMatchObject({ kind: 'union' });
    expect(property('nickname').type).toMatchObject({ kind: 'union' });
  });
});
