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
  dbDecodedColumns,
  decodeDbValue,
  decodeWire,
  encodeWire,
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

  it('says what it knows about a json column and no more', () => {
    // `json<Config>()` erases its type parameter, so the value front-end cannot name the
    // payload. The weakest true statement is still a statement: an object or an array,
    // which is "not a primitive" and rejects `settings: 123`. `{ kind: 'unknown' }` would
    // accept it, and did — the repository's own check had always spelled this
    // `typeof value === 'object' && value !== null`.
    expect(appTypeOf(probe(json()))).toEqual({
      kind: 'union',
      members: [
        { kind: 'object', properties: [] },
        { kind: 'array', element: { kind: 'unknown' } },
      ],
    });
    // A tagged declaration does know, and gets the payload type it declared.
    expect(appTypeOf({ ...probe(json()), payload: { kind: 'scalar', scalar: 'string' } })).toEqual({
      kind: 'scalar',
      scalar: 'string',
    });
  });

  it("takes a codec's app type from the declaration, since the SQL type is not it", () => {
    // `amount: Money & Sql<'integer'> & Codec<'Money'>` is an integer in the database and
    // a `Money` in the app. A validator that checked `integer` here would reject every
    // valid value, which is why the declared type wins.
    const money: ColumnIR = {
      ...probe(integer()),
      codec: 'Money',
      payload: { kind: 'object', properties: [] },
      wire: { kind: 'scalar', scalar: 'string' },
    };
    expect(appTypeOf(money)).toEqual({ kind: 'object', properties: [] });
    expect(wireTypeOf(money)).toEqual({ kind: 'scalar', scalar: 'string' });
    expect(jsonSchemaForColumn(money)).toEqual({ type: 'string' });
  });

  it('refuses a codec column that does not say what it puts on the wire', () => {
    // A gap has to be visible (plan D4). "The same as the app type" is a guess, and the
    // one it gets wrong is the case a codec exists for. The emitter turns an
    // `unsupported` node into a build error naming the column.
    const refused = wireTypeOf({ ...probe(integer()), codec: 'Money' });
    expect(refused.kind).toBe('unsupported');
    expect(refused).toMatchObject({ reason: expect.stringContaining('WireAs') });
    // The app type is still answerable: it is the column's own type until a declaration
    // says otherwise.
    expect(appTypeOf({ ...probe(integer()), codec: 'Money' })).toMatchObject({ scalar: 'integer' });
  });

  it('carries a declared wire type through nullability and through an enum', () => {
    const nullable: ColumnIR = {
      ...probe(integer().nullable()),
      codec: 'Money',
      wire: { kind: 'scalar', scalar: 'string' },
    };
    expect(wireTypeOf(nullable)).toEqual({
      kind: 'union',
      members: [{ kind: 'scalar', scalar: 'string' }, { kind: 'null' }],
    });
    expect(jsonSchemaForColumn(nullable)).toEqual({ type: ['string', 'null'] });

    // A wire form JSON Schema has a keyword for is published; one it does not gets no
    // `type` rather than a wrong one, which is what a `json` column has always done.
    const enumerated: ColumnIR = {
      ...probe(integer()),
      codec: 'Grade',
      wire: {
        kind: 'union',
        members: [
          { kind: 'literal', value: 'pass' },
          { kind: 'literal', value: 'fail' },
        ],
      },
    };
    expect(jsonSchemaForColumn(enumerated)).toEqual({ enum: ['pass', 'fail'] });
    expect(
      jsonSchemaForColumn({
        ...probe(integer()),
        codec: 'Point',
        wire: { kind: 'array', element: { kind: 'unknown' } },
      }),
    ).toEqual({});
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

describe('decodeWire / encodeWire — the crossing between the layers (plan D3)', () => {
  const Events = defineSchema('events', {
    id: serial().primaryKey(),
    name: text(),
    at: timestamp(),
    seq: bigint(),
    closedAt: timestamp().nullable(),
  });
  const ir = irFromSchema(Events);
  const ISO = '2026-01-01T12:30:00.000Z';

  it('turns a JSON body into the values the app layer holds', () => {
    expect(decodeWire(ir, 'create', { name: 'launch', at: ISO, seq: '90071992547409910', closedAt: null })).toEqual({
      name: 'launch',
      at: new Date(ISO),
      seq: 90071992547409910n,
      closedAt: null,
    });
  });

  it('turns a row back into something JSON can carry', () => {
    expect(encodeWire(ir, { id: 1, name: 'launch', at: new Date(ISO), seq: 7n, closedAt: null })).toEqual({
      id: 1,
      name: 'launch',
      at: ISO,
      seq: '7',
      closedAt: null,
    });
  });

  it('round-trips a well-formed body', () => {
    const body = { name: 'launch', at: ISO, seq: '7', closedAt: ISO };
    expect(encodeWire(ir, decodeWire(ir, 'create', body))).toEqual(body);
  });

  it('leaves a value it cannot convert for the validator to reject', () => {
    // The trap this avoids: `new Date('nonsense')` is an `Invalid Date`, which passes
    // `instanceof Date` and reaches the driver. The string survives instead, and the app
    // validator then says `expected Date` — which is true, and actionable.
    expect(decodeWire(ir, 'create', { at: 'nonsense' }).at).toBe('nonsense');
    expect(decodeWire(ir, 'create', { at: 12 }).at).toBe(12);
    // `BigInt('0x10')` is 16 and `BigInt('')` is 0. Neither is a number anyone sent.
    expect(decodeWire(ir, 'create', { seq: '0x10' }).seq).toBe('0x10');
    expect(decodeWire(ir, 'create', { seq: '' }).seq).toBe('');
    expect(encodeWire(ir, { at: new Date('nonsense') }).at).toBeInstanceOf(Date);
  });

  it('copies a key the variant does not have, instead of dropping it', () => {
    // Dropping it here would hide it from the one place that decides what a payload may
    // contain — the repository's excess check, which names the offending key.
    expect(decodeWire(ir, 'create', { id: 5, bogus: 1 })).toEqual({ id: 5, bogus: 1 });
  });

  it('uses the codec a column names, and refuses when there is none', () => {
    const money: ColumnIR = { ...column('age'), name: 'total', sql: 'numeric', codec: 'Money', constraints: {} };
    const withCodec: SchemaIR = { ...ir, columns: [...ir.columns, money] };
    const codecs = {
      Money: { decode: (wire: unknown) => ({ cents: Number(wire) }), encode: (app: unknown) => String(app) },
    };
    expect(decodeWire(withCodec, 'create', { total: '1250' }, codecs).total).toEqual({ cents: 1250 });
    // A named codec with nothing behind it is a gap, and a gap has to be visible: the
    // alternative is storing whatever JSON carried in the one column that needed
    // converting.
    expect(() => decodeWire(withCodec, 'create', { total: '1250' })).toThrow(/not in the registry/);
    expect(() => encodeWire(withCodec, { total: 1250 })).toThrow(/"Money"/);
  });
});

describe('decodeDbValue — the db→app crossing, whatever the driver handed back', () => {
  const Events = defineSchema('events', {
    id: serial().primaryKey(),
    name: text(),
    at: timestamp(),
    seq: bigint(),
  });
  const ir = irFromSchema(Events);
  const col = (name: string): ColumnIR => {
    const found = ir.columns.find(c => c.name === name);
    if (!found) throw new Error(`no column ${name}`);
    return found;
  };
  const ISO = '2026-01-01T12:30:00.000Z';

  it('takes both storage forms of a timestamp to a Date', () => {
    // `pg` hands back a `Date` for `TIMESTAMPTZ`, `node:sqlite` the `TEXT` it stored. The
    // app type is the same either way, which is the point: a repository's caller cannot
    // be asked which driver is underneath.
    expect(decodeDbValue(col('at'), ISO)).toEqual(new Date(ISO));
    const already = new Date(ISO);
    expect(decodeDbValue(col('at'), already)).toBe(already);
  });

  it('takes both storage forms of a bigint to a bigint', () => {
    // `pg` reads `int8` as a decimal string to avoid the precision loss; `node:sqlite`
    // reads `INTEGER` as a number.
    expect(decodeDbValue(col('seq'), '90071992547409910')).toBe(90071992547409910n);
    expect(decodeDbValue(col('seq'), 7)).toBe(7n);
  });

  it('leaves a number that has already lost digits alone', () => {
    // Past 2^53 a `number` no longer distinguishes consecutive integers, so converting one
    // would state a value the database never held. Handing the number back keeps the damage
    // visible to the validator instead of laundering it into a plausible `bigint`.
    // Written as an expression because the literal itself is a lint error, which is the
    // point being made.
    const lossy = Number.MAX_SAFE_INTEGER + 1;
    expect(decodeDbValue(col('seq'), lossy)).toBe(lossy);
  });

  it('passes null and undefined through, and anything unconvertible with them', () => {
    expect(decodeDbValue(col('at'), null)).toBeNull();
    expect(decodeDbValue(col('seq'), undefined)).toBeUndefined();
    expect(decodeDbValue(col('at'), 'nonsense')).toBe('nonsense');
    expect(decodeDbValue(col('seq'), '0x10')).toBe('0x10');
    expect(decodeDbValue(col('name'), 'launch')).toBe('launch');
  });

  it('names only the columns that can change, so a plain schema skips the walk', () => {
    expect(dbDecodedColumns(ir).map(c => c.name)).toEqual(['at', 'seq']);
    expect(dbDecodedColumns(irFromSchema(UserSchema)).map(c => c.name)).toEqual(['createdAt']);
    expect(dbDecodedColumns(irFromSchema(defineSchema('tags', { id: serial().primaryKey() })))).toEqual([]);
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

  it('makes a nullable column optional on the way in and required on the way out', () => {
    // The document has always treated a nullable column as not required on create, and the
    // repository has always accepted the payload without it. `CreateDTO<T>` demanded the key
    // until this back-end existed to compare them, so a client that followed the published
    // contract wrote a payload the type rejected. Both say optional now.
    const Notes = defineSchema('notes', { id: serial().primaryKey(), body: text().nullable() });
    expect(objectTypeFromIR(irFromSchema(Notes), 'create').properties).toEqual([
      { name: 'body', type: appTypeOf(irFromSchema(Notes).columns[1] as ColumnIR), optional: true, readonly: false },
    ]);
    expect(jsonSchemaFromIR(irFromSchema(Notes), 'create').required).toEqual([]);
    // A row that came back has every column, `null` included, so nothing is optional there.
    expect(objectTypeFromIR(irFromSchema(Notes), 'entity').properties.every(p => !p.optional)).toBe(true);
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
