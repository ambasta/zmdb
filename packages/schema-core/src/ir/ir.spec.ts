// The IR, and the four back-ends that read it.
//
// This file used to open with `defineSchema('users', { id: serial().primaryKey(), … })` and get
// its IR by running `irFromSchema` over the result. Both are gone: a table is declared as a type
// now, and the IR is what the reflection reads out of the declaration. So the fixtures below are
// interfaces, and `schemaIrsFrom` does at test time what the transform does at build time —
// through the same reflection, so what is under test here is the shipped path.
//
// Two consequences worth naming, because they changed what this file can assert.
//
// The IR gained facts. `Numeric<10, 2>`, `Codec<'Money'>`, `WireAs<W>` and a json column's
// payload shape are all things a type can say and a column map cannot, and three of the tests
// below exist because of them — `appTypeOf` on a codec column, `wireTypeOf` refusing one that
// does not declare its wire form, and the payload a `json` column carries. Under the old front
// end those were unreachable, so they were written as hand-built `ColumnIR` literals with a
// comment saying a declaration would know better. Some still are, where the point is a
// consumer's behaviour rather than the reflection's.
//
// And `probe` changed meaning. It used to build a one-column schema and read the IR back out of
// it, which made every assertion about a consumer also an assertion about the front end. It now
// writes the `ColumnIR` directly. That is the honest shape for this file: the front end has its
// own golden in `compiler/src/reflect/reflect.spec.ts`, and what is left here is what the
// back-ends do with an IR however it arrived.

import { schemaIrsFrom } from '@zmdb/compiler/testing';
import { describe, expect, it } from 'vitest';

import type {
  Ext,
  Fts,
  HasDefault,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  Pattern,
  PrimaryKey,
  References,
  Rule,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
} from '../tags/index.js';
import {
  appTypeOf,
  dbDecodedColumns,
  decodeDbValue,
  decodeWire,
  encodeWire,
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
} from './index.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'> & Length<255> & Unique & Pattern<'^\\S+@\\S+$'>;
  age: number & Sql<'integer'> & Min<18> & Max<120>;
  nickname: (string & Sql<'varchar'> & Length<64> & MinLength<3> & HasDefault) | null;
  role: ('admin' | 'viewer') & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  passwordHash: string & Sql<'text'> & Sensitive;
  active: boolean & Sql<'boolean'>;
}

export interface Membership extends Table<'memberships'>, Fts<true> {
  userId: number & Sql<'integer'> & PrimaryKey & References<'users.id'>;
  groupId: number & Sql<'integer'> & PrimaryKey;
  note: (string & Sql<'text'> & Rule<'luhn'>) | null;
}

export interface Event extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  at: Date & Sql<'timestamp'>;
  seq: bigint & Sql<'bigint'>;
  closedAt: (Date & Sql<'timestamp'>) | null;
}

export interface Note extends Table<'notes'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  body: (string & Sql<'text'>) | null;
}

/** One column per `SqlType`, so the coverage test below cannot be satisfied by a subset. */
export interface Everything extends Table<'all'> {
  a: number & Sql<'integer'> & Serial & PrimaryKey;
  b: number & Sql<'integer'>;
  c: bigint & Sql<'bigint'>;
  d: number & Sql<'numeric'>;
  e: string & Sql<'text'>;
  f: string & Sql<'varchar'> & Length<10>;
  g: boolean & Sql<'boolean'>;
  h: Date & Sql<'timestamp'>;
  i: { x: number } & Sql<'json'>;
  j: 'x';
}

/** A table with nothing a driver can hand back in two forms, for `dbDecodedColumns`. */
export interface Tag extends Table<'tags'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
}

export interface GeoJsonPoint {
  readonly type: 'Point';
  readonly coordinates: readonly [number, number];
}

export interface ExtensionRow extends Table<'extension_rows'> {
  id: number & Sql<'integer'> & PrimaryKey;
  embedding: readonly number[] & Ext<'vector', 'vector', [1536]>;
  location: GeoJsonPoint & Ext<'postgis', 'geometry', ['Point', 4326]>;
  handle: string & Ext<'citext', 'citext'> & MinLength<3> & MaxLength<64> & Pattern<'^[a-z]+$'>;
}

export interface InvalidExtensionRow extends Table<'invalid_extension_rows'> {
  id: number & Sql<'integer'> & PrimaryKey;
  embedding: readonly number[] & Ext<'vector', 'vector', ['not valid SQL']>;
}

const {
  Event: eventsIR,
  ExtensionRow: extensionIR,
  Everything: everythingIR,
  Membership: membershipsIR,
  Note: notesIR,
  Tag: tagsIR,
  User: usersIR,
} = schemaIrsFrom(import.meta.url, ['User', 'Membership', 'Event', 'Note', 'Everything', 'Tag', 'ExtensionRow']);

function column(name: string, ir: SchemaIR = usersIR): ColumnIR {
  const found = ir.columns.find(c => c.name === name);
  if (!found) throw new Error(`no column ${name}`);
  return found;
}

/**
 * One column, written out.
 *
 * Named `probe` because it is the same role the old helper played — a single column to hand to
 * one back-end — but it no longer routes through a schema to get there. The defaults are the
 * six booleans plus the two collections, so a call names only what it is about.
 */
type Defaulted =
  | 'physicalName'
  | 'nullable'
  | 'primaryKey'
  | 'serial'
  | 'unique'
  | 'hasDefault'
  | 'sensitive'
  | 'constraints'
  | 'rules';
function probe(facts: Omit<ColumnIR, 'name' | Defaulted> & Partial<Pick<ColumnIR, 'name' | Defaulted>>): ColumnIR {
  const name = facts.name ?? 'v';
  return {
    name,
    physicalName: name,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    ...facts,
  };
}

describe('the IR of a declared table', () => {
  it('carries every flag the four walkers each knew only part of', () => {
    expect(column('id')).toMatchObject({ sql: 'serial', primaryKey: true, serial: true, nullable: false });
    expect(column('email')).toMatchObject({ sql: 'varchar', unique: true, length: 255 });
    expect(column('passwordHash')).toMatchObject({ sql: 'text', sensitive: true });
    expect(column('nickname')).toMatchObject({ sql: 'varchar', nullable: true, hasDefault: true });
  });

  it('records the full constraint set, including the ones TypeDescriptor lacked', () => {
    // `TypeDescriptor` had `minimum` and `maxLength` but no `maximum` and no `minLength`, which
    // is how a `Min<18> & Max<120>` column came to validate differently in each walker. All
    // five are first-class here.
    expect(column('age').constraints).toEqual({ minimum: 18, maximum: 120 });
    expect(column('nickname').constraints).toEqual({ minLength: 3 });
    expect(column('email').constraints).toEqual({ pattern: '^\\S+@\\S+$' });
  });

  it('interprets every constraint keyword it claims to know, and only those', () => {
    // `KNOWN_CONSTRAINT_KINDS` is the set a back-end interprets, as opposed to the open
    // `string` a rule kind is. The table has to stay total in both directions: a sixth keyword
    // added without a back-end reading it is a constraint that silently never runs, and a
    // keyword a back-end reads that is not listed is one `Rule<…>` would swallow as a custom
    // rule instead. So each one is asked for and has to come out the other side.
    const emitted: readonly [(typeof KNOWN_CONSTRAINT_KINDS)[number], ColumnIR, unknown][] = [
      ['minimum', probe({ sql: 'integer', constraints: { minimum: 5 } }), 5],
      ['maximum', probe({ sql: 'integer', constraints: { maximum: 5 } }), 5],
      ['minLength', probe({ sql: 'text', constraints: { minLength: 5 } }), 5],
      ['maxLength', probe({ sql: 'text', constraints: { maxLength: 5 } }), 5],
      ['pattern', probe({ sql: 'text', constraints: { pattern: '^a$' } }), '^a$'],
    ];
    expect(emitted.map(([keyword]) => keyword)).toEqual([...KNOWN_CONSTRAINT_KINDS]);
    for (const [keyword, col, value] of emitted) {
      expect(jsonSchemaForColumn(col), keyword).toMatchObject({ [keyword]: value });
      expect(appTypeOf(col), keyword).toMatchObject({ constraints: { [keyword]: value } });
    }
  });

  it('keeps an unrecognised rule kind as a named rule instead of dropping it', () => {
    // `Rule<'luhn'>` is a rule no back-end can interpret, and silently ignoring it is what the
    // old mapper did. A named rule an emitter cannot resolve has to become a build error, not
    // a check that never runs — so it survives to the IR under its own name and nothing tries
    // to read it as a constraint.
    expect(column('note', membershipsIR).rules).toEqual(['luhn']);
    expect(column('note', membershipsIR).constraints).toEqual({});
  });

  it('is serialisable JSON, which is what lets the codegen CLI write it to disk', () => {
    expect(JSON.parse(JSON.stringify(usersIR))).toEqual(usersIR);
  });

  it('covers every SqlType', () => {
    expect(everythingIR.columns.map(c => c.sql).toSorted()).toEqual([...SQL_TYPES].toSorted());
  });
});

describe('the three types of a column (REQ-TF-13)', () => {
  // A wire type's `format` comes with the `pattern` that enforces it, because `format` is an
  // annotation and nothing in either walk reads one. The published document keeps saying
  // `format` and only `format`: that is the keyword JSON Schema has for the concept, and a
  // consumer honouring it needs no help from us.
  it('a timestamp is a Date to the app and an ISO string on the wire', () => {
    expect(appTypeOf(column('createdAt'))).toEqual({ kind: 'scalar', scalar: 'date' });
    expect(wireTypeOf(column('createdAt'))).toEqual({
      kind: 'scalar',
      scalar: 'string',
      format: 'date-time',
      constraints: { pattern: '^\\d{4}-\\d{2}-\\d{2}[Tt ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:[Zz]|[+-]\\d{2}:\\d{2})$' },
    });
    expect(jsonSchemaForColumn(column('createdAt'))).toEqual({ type: 'string', format: 'date-time' });
  });

  it('a bigint is a bigint to the app and a string on the wire', () => {
    expect(appTypeOf(probe({ sql: 'bigint' }))).toEqual({ kind: 'scalar', scalar: 'bigint' });
    // The pattern is `asBigInt`'s own, so the wire validator accepts exactly the strings the
    // decoder can convert — `'0x10'` and `''` are `BigInt()`-legal and meant by nobody.
    expect(wireTypeOf(probe({ sql: 'bigint' }))).toEqual({
      kind: 'scalar',
      scalar: 'string',
      format: 'int64',
      constraints: { pattern: '^-?\\d+$' },
    });
  });

  it('distinguishes integer from number so an emitter can check integrality', () => {
    expect(appTypeOf(column('id'))).toMatchObject({ scalar: 'integer' });
    expect(appTypeOf(probe({ sql: 'numeric' }))).toMatchObject({ scalar: 'number' });
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
    // A `json` column with no payload — `object & Sql<'json'>`, or a column map that never had
    // anywhere to put the shape. The weakest true statement is still a statement: an object or
    // an array, which is "not a primitive" and rejects `settings: 123`. `{ kind: 'unknown' }`
    // would accept it, and did — the repository's own check had always spelled this
    // `typeof value === 'object' && value !== null`.
    expect(appTypeOf(probe({ sql: 'json' }))).toEqual({
      kind: 'union',
      members: [
        { kind: 'object', properties: [] },
        { kind: 'array', element: { kind: 'unknown' } },
      ],
    });
    // A declaration that names the payload gets it, which is the whole reason the field exists.
    expect(appTypeOf(column('i', everythingIR))).toEqual({
      kind: 'object',
      properties: [{ name: 'x', optional: false, readonly: false, type: { kind: 'scalar', scalar: 'number' } }],
    });
  });

  it("takes a codec's app type from the declaration, since the SQL type is not it", () => {
    // `amount: Money & Sql<'integer'> & Codec<'Money'>` is an integer in the database and a
    // `Money` in the app. A validator that checked `integer` here would reject every valid
    // value, which is why the declared type wins.
    const money = probe({
      sql: 'integer',
      codec: 'Money',
      payload: { kind: 'object', properties: [] },
      wire: { kind: 'scalar', scalar: 'string' },
    });
    expect(appTypeOf(money)).toEqual({ kind: 'object', properties: [] });
    expect(wireTypeOf(money)).toEqual({ kind: 'scalar', scalar: 'string' });
    expect(jsonSchemaForColumn(money)).toEqual({ type: 'string' });
  });

  it('refuses a codec column that does not say what it puts on the wire', () => {
    // A gap has to be visible (plan D4). "The same as the app type" is a guess, and the one it
    // gets wrong is the case a codec exists for. The emitter turns an `unsupported` node into
    // a build error naming the column.
    const refused = wireTypeOf(probe({ sql: 'integer', codec: 'Money' }));
    expect(refused.kind).toBe('unsupported');
    expect(refused).toMatchObject({ reason: expect.stringContaining('WireAs') });
    // The app type is still answerable: it is the column's own type until a declaration says
    // otherwise.
    expect(appTypeOf(probe({ sql: 'integer', codec: 'Money' }))).toMatchObject({ scalar: 'integer' });
  });

  it('carries a declared wire type through nullability and through an enum', () => {
    const nullable = probe({
      sql: 'integer',
      nullable: true,
      codec: 'Money',
      wire: { kind: 'scalar', scalar: 'string' },
    });
    expect(wireTypeOf(nullable)).toEqual({
      kind: 'union',
      members: [{ kind: 'scalar', scalar: 'string' }, { kind: 'null' }],
    });
    expect(jsonSchemaForColumn(nullable)).toEqual({ type: ['string', 'null'] });

    // A wire form JSON Schema has a keyword for is published; one it does not gets no `type`
    // rather than a wrong one, which is what a `json` column has always done.
    const enumerated = probe({
      sql: 'integer',
      codec: 'Grade',
      wire: {
        kind: 'union',
        members: [
          { kind: 'literal', value: 'pass' },
          { kind: 'literal', value: 'fail' },
        ],
      },
    });
    expect(jsonSchemaForColumn(enumerated)).toEqual({ enum: ['pass', 'fail'] });
    expect(
      jsonSchemaForColumn(
        probe({ sql: 'integer', codec: 'Point', wire: { kind: 'array', element: { kind: 'unknown' } } }),
      ),
    ).toEqual({});
  });

  it('wraps a nullable column in a union with null rather than losing it', () => {
    // Nullability was absent from `TypeDescriptor` entirely, so the AOT could not emit the null
    // arm at all.
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
      expect(Object.keys(jsonSchemaFromIR(usersIR, variant))).toContain('properties');
      expect(jsonSchemaFromIR(usersIR, variant).properties).not.toHaveProperty('passwordHash');
    }
  });

  it('drops database-generated columns from create but keeps them in responses', () => {
    expect(jsonSchemaFromIR(usersIR, 'create').properties).not.toHaveProperty('id');
    expect(jsonSchemaFromIR(usersIR, 'entity').properties).toHaveProperty('id');
  });

  it('requires nothing on update', () => {
    expect(jsonSchemaFromIR(usersIR, 'update').required).toEqual([]);
  });

  it('treats defaulted and nullable columns as optional on create', () => {
    const required = jsonSchemaFromIR(usersIR, 'create').required;
    expect(required).not.toContain('createdAt');
    expect(required).not.toContain('nickname');
    expect(required).toContain('email');
  });

  it('widens a nullable type keyword and leaves a json column alone', () => {
    expect(jsonSchemaForColumn(column('nickname'))).toMatchObject({ type: ['string', 'null'] });
    expect(jsonSchemaForColumn(probe({ sql: 'json', nullable: true }))).toEqual({});
  });

  it('emits every constraint keyword, in a stable order', () => {
    expect(Object.keys(jsonSchemaForColumn(column('age')))).toEqual(['type', 'minimum', 'maximum']);
    expect(jsonSchemaForColumn(column('age'))).toEqual({ type: 'integer', minimum: 18, maximum: 120 });
  });

  it('lets an explicit maxLength rule win over the varchar length', () => {
    expect(jsonSchemaForColumn(probe({ sql: 'varchar', length: 255, constraints: { maxLength: 10 } }))).toEqual({
      type: 'string',
      maxLength: 10,
    });
  });
});

describe('schemaFromIR — the value back-end (REQ-TF-10)', () => {
  // The property the whole phase rests on. `schemaFromIR` is what a declaration becomes at
  // build time, and everything downstream of a schema value — the query compiler, the DDL
  // emitter, the repository — reads either the projected column map or the IR the value
  // carries. So the two halves have to be one fact: project the IR, and the value that comes
  // out carries the IR it was projected from, unchanged.
  it('carries the IR it was built from, not a re-derivation of it', () => {
    for (const ir of [usersIR, membershipsIR]) {
      expect(schemaFromIR(ir).ir).toEqual(ir);
      // And once more through the value, because a consumer that reads `schema.ir` and rebuilds
      // is the case that has to be stable rather than merely correct once.
      expect(schemaFromIR(schemaFromIR(ir).ir)).toEqual(schemaFromIR(ir));
    }
  });

  it('is plain data — nothing to call, nothing to unwrap', () => {
    // The value the emitter inlines is a JSON literal, so it has to be the case that nothing
    // downstream reads a method off a column. The way to know is that a JSON round trip of the
    // value is the value — and that has to hold with the IR nested inside it, which is where a
    // `Date` or a `bigint` in a default would show up.
    const value = schemaFromIR(usersIR);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it('keeps flags to the ones that are set', () => {
    const columns = schemaFromIR(usersIR).columns;
    // `Serial` sets `hasDefault` as well as `autoIncrement`: the database supplies the value,
    // which is a default in every sense the schema cares about.
    expect(columns.id).toEqual({
      type: 'serial',
      flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true },
    });
    expect(columns.active).toEqual({ type: 'boolean', flags: { nullable: false } });
    expect(columns.passwordHash).toEqual({ type: 'text', flags: { nullable: false, sensitive: true } });
  });

  it('writes the constraints back in a fixed order, and keeps a named rule', () => {
    expect(schemaFromIR(usersIR).columns.age?.validation).toEqual([
      { kind: 'minimum', value: 18 },
      { kind: 'maximum', value: 120 },
    ]);
    expect(schemaFromIR(membershipsIR).columns.note?.validation).toEqual([{ kind: 'luhn' }]);
  });

  it('restores a foreign key in both places the schema records one', () => {
    const value = schemaFromIR(membershipsIR);
    expect(value.references).toEqual([{ column: 'userId', target: 'users.id' }]);
    expect(value.columns.userId?.references).toEqual({ target: 'users.id' });
    expect(value.primaryKey).toEqual(['userId', 'groupId']);
    expect(value.ftsTable).toBe(true);
  });

  it('switches the schema value to physical names while preserving the declared IR', () => {
    const ir: SchemaIR = {
      table: 'userAccount',
      physicalTable: 'user_accounts',
      columns: [
        probe({ name: 'id', physicalName: 'account_id', primaryKey: true, sql: 'integer' }),
        probe({ name: 'createdAt', physicalName: 'created_at', sql: 'timestamp' }),
      ],
      primaryKey: ['id'],
      relations: [],
      foreignKeys: [],
    };

    const value = schemaFromIR(ir);
    expect(value.table).toBe('user_accounts');
    expect(Object.keys(value.columns)).toEqual(['account_id', 'created_at']);
    expect(value.primaryKey).toEqual(['account_id']);
    expect(value.ir).toBe(ir);
    expect(value.ir.columns.map(candidate => candidate.name)).toEqual(['id', 'createdAt']);
  });

  it('leaves the three things only a type can say out of the projection, and in the IR', () => {
    // `Numeric<10, 2>`, `Codec<'Money'>` and a json payload shape have no home in a
    // `CoreSchema`'s column map: there is no flag for any of them. They used to be *lost* here,
    // because the value was all a consumer had. Now the value carries its IR, so the projection
    // stays as narrow as it always was and nothing is dropped — which is what closed the gap
    // rather than papering over it, and is why the two back-ends that need these read the IR.
    const ir: SchemaIR = {
      table: 'invoices',
      physicalTable: 'invoices',
      columns: [
        probe({
          name: 'total',
          sql: 'numeric',
          primaryKey: true,
          precision: [10, 2],
          codec: 'Money',
          payload: { kind: 'unknown' },
        }),
      ],
      primaryKey: ['total'],
      relations: [],
      foreignKeys: [],
    };
    const value = schemaFromIR(ir);
    expect(value.columns.total).toEqual({ type: 'numeric', flags: { nullable: false, primaryKey: true } });
    expect(value.ir.columns[0]).toMatchObject({ precision: [10, 2], codec: 'Money', payload: { kind: 'unknown' } });
  });
});

describe('decodeWire / encodeWire — the crossing between the layers (plan D3)', () => {
  const ISO = '2026-01-01T12:30:00.000Z';

  it('turns a JSON body into the values the app layer holds', () => {
    expect(
      decodeWire(eventsIR, 'create', { name: 'launch', at: ISO, seq: '90071992547409910', closedAt: null }),
    ).toEqual({
      name: 'launch',
      at: new Date(ISO),
      seq: 90071992547409910n,
      closedAt: null,
    });
  });

  it('turns a row back into something JSON can carry', () => {
    expect(encodeWire(eventsIR, { id: 1, name: 'launch', at: new Date(ISO), seq: 7n, closedAt: null })).toEqual({
      id: 1,
      name: 'launch',
      at: ISO,
      seq: '7',
      closedAt: null,
    });
  });

  it('round-trips a well-formed body', () => {
    const body = { name: 'launch', at: ISO, seq: '7', closedAt: ISO };
    expect(encodeWire(eventsIR, decodeWire(eventsIR, 'create', body))).toEqual(body);
  });

  it('leaves a value it cannot convert for the validator to reject', () => {
    // The trap this avoids: `new Date('nonsense')` is an `Invalid Date`, which passes
    // `instanceof Date` and reaches the driver. The string survives instead, and the app
    // validator then says `expected Date` — which is true, and actionable.
    expect(decodeWire(eventsIR, 'create', { at: 'nonsense' }).at).toBe('nonsense');
    expect(decodeWire(eventsIR, 'create', { at: 12 }).at).toBe(12);
    // `BigInt('0x10')` is 16 and `BigInt('')` is 0. Neither is a number anyone sent.
    expect(decodeWire(eventsIR, 'create', { seq: '0x10' }).seq).toBe('0x10');
    expect(decodeWire(eventsIR, 'create', { seq: '' }).seq).toBe('');
    expect(encodeWire(eventsIR, { at: new Date('nonsense') }).at).toBeInstanceOf(Date);
  });

  it('copies a key the variant does not have, instead of dropping it', () => {
    // Dropping it here would hide it from the one place that decides what a payload may
    // contain — the repository's excess check, which names the offending key.
    expect(decodeWire(eventsIR, 'create', { id: 5, bogus: 1 })).toEqual({ id: 5, bogus: 1 });
  });

  it('uses the codec a column names, and refuses when there is none', () => {
    const withCodec: SchemaIR = {
      ...eventsIR,
      columns: [...eventsIR.columns, probe({ name: 'total', sql: 'numeric', codec: 'Money' })],
    };
    const codecs = {
      Money: { decode: (wire: unknown) => ({ cents: Number(wire) }), encode: (app: unknown) => String(app) },
    };
    expect(decodeWire(withCodec, 'create', { total: '1250' }, codecs).total).toEqual({ cents: 1250 });
    // A named codec with nothing behind it is a gap, and a gap has to be visible: the
    // alternative is storing whatever JSON carried in the one column that needed converting.
    expect(() => decodeWire(withCodec, 'create', { total: '1250' })).toThrow(/not in the registry/);
    expect(() => encodeWire(withCodec, { total: 1250 })).toThrow(/"Money"/);
  });
});

describe('extension-backed columns', () => {
  const extensionColumn = (name: string): ColumnIR => column(name, extensionIR);

  it('reflects Ext into the SQL type and preserves the declared application shape', () => {
    expect(extensionColumn('embedding')).toMatchObject({
      sql: { extension: 'vector', name: 'vector', args: [1536] },
      payload: { kind: 'array', element: { kind: 'scalar', scalar: 'number' } },
    });
    expect(extensionColumn('location')).toMatchObject({
      sql: { extension: 'postgis', name: 'geometry', args: ['Point', 4326] },
      payload: { kind: 'object', name: 'GeoJsonPoint' },
    });
    expect(extensionColumn('handle')).toMatchObject({
      sql: { extension: 'citext', name: 'citext' },
      payload: { kind: 'scalar', scalar: 'string' },
    });
  });

  it('refuses a non-identifier extension argument during reflection', () => {
    const diagnostics: { readonly path: string; readonly reason: string }[] = [];
    schemaIrsFrom(import.meta.url, ['InvalidExtensionRow'], {
      onDiagnostics: found => diagnostics.push(...found),
    });
    expect(diagnostics).toEqual([
      {
        path: 'embedding',
        reason: 'extension type arguments must be finite number literals or SQL identifiers',
        source: '"not valid SQL"',
      },
    ]);
  });

  it('derives the geometry and citext JSON Schema shapes', () => {
    expect(appTypeOf(extensionColumn('handle'))).toEqual({
      kind: 'scalar',
      scalar: 'string',
      constraints: { minLength: 3, maxLength: 64, pattern: '^[a-z]+$' },
    });
    expect(jsonSchemaForColumn(extensionColumn('location'))).toEqual({
      type: 'object',
      properties: {
        type: { const: 'Point' },
        coordinates: {
          type: 'array',
          prefixItems: [{ type: 'number' }, { type: 'number' }],
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ['type', 'coordinates'],
    });
    expect(jsonSchemaForColumn(extensionColumn('handle'))).toEqual({
      type: 'string',
      minLength: 3,
      maxLength: 64,
      pattern: '^[a-z]+$',
    });
  });

  it('decodes pgvector text without accepting a partial numeric parse', () => {
    const vector = extensionColumn('embedding');
    expect(decodeDbValue(vector, '[1, -2.5, 3e-2]')).toEqual([1, -2.5, 0.03]);
    expect(decodeDbValue(vector, '[1,,3]')).toBe('[1,,3]');
    expect(decodeDbValue(vector, '[1, nope, 3]')).toBe('[1, nope, 3]');
  });

  it('does not validate a vector element-wise on the default read path', () => {
    const vector = extensionColumn('embedding');
    let elementReads = 0;
    const value = new Proxy([0.1, 0.2, 0.3], {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/.test(property)) elementReads++;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(dbDecodedColumns(extensionIR).map(candidate => candidate.name)).toEqual(['embedding']);
    expect(decodeDbValue(vector, value)).toBe(value);
    expect(elementReads).toBe(0);
  });
});

describe('decodeDbValue — the db→app crossing, whatever the driver handed back', () => {
  const col = (name: string): ColumnIR => column(name, eventsIR);
  const ISO = '2026-01-01T12:30:00.000Z';

  it('takes both storage forms of a timestamp to a Date', () => {
    // `pg` hands back a `Date` for `TIMESTAMPTZ`, `node:sqlite` the `TEXT` it stored. The app
    // type is the same either way, which is the point: a repository's caller cannot be asked
    // which driver is underneath.
    expect(decodeDbValue(col('at'), ISO)).toEqual(new Date(ISO));
    const already = new Date(ISO);
    expect(decodeDbValue(col('at'), already)).toBe(already);
  });

  it('takes both storage forms of a bigint to a bigint', () => {
    // `pg` reads `int8` as a decimal string to avoid the precision loss; `node:sqlite` reads
    // `INTEGER` as a number.
    expect(decodeDbValue(col('seq'), '90071992547409910')).toBe(90071992547409910n);
    expect(decodeDbValue(col('seq'), 7)).toBe(7n);
  });

  it('leaves a number that has already lost digits alone', () => {
    // Past 2^53 a `number` no longer distinguishes consecutive integers, so converting one
    // would state a value the database never held. Handing the number back keeps the damage
    // visible to the validator instead of laundering it into a plausible `bigint`.
    // Written as an expression because the literal itself is a lint error, which is the point
    // being made.
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
    expect(dbDecodedColumns(eventsIR).map(c => c.name)).toEqual(['at', 'seq', 'closedAt']);
    expect(dbDecodedColumns(usersIR).map(c => c.name)).toEqual(['createdAt']);
    expect(dbDecodedColumns(tagsIR)).toEqual([]);
  });
});

describe('objectTypeFromIR — the validator back-end (REQ-TF-13)', () => {
  function properties(variant: Variant, layer?: 'app' | 'wire'): readonly PropertyIR[] {
    return objectTypeFromIR(usersIR, variant, layer).properties;
  }

  function property(name: string, variant: Variant = 'entity', layer?: 'app' | 'wire'): PropertyIR {
    const found = properties(variant, layer).find(p => p.name === name);
    if (!found) throw new Error(`no property ${name} in the ${variant} payload`);
    return found;
  }

  it('is the entity row, in declaration order, with nothing optional', () => {
    // Not sorted, unlike the JSON Schema back-end: a document is published and its key order is
    // part of it, and a `TypeIR` is read by an emitter that does not care.
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
    // The distinction REQ-TF-6 actually draws: a published document must not name a password,
    // and a `create` validator that ignored it would reject every real payload.
    expect(properties('create').map(p => p.name)).toContain('passwordHash');
    expect(jsonSchemaFromIR(usersIR, 'create').properties).not.toHaveProperty('passwordHash');
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
    expect(objectTypeFromIR(notesIR, 'create').properties).toEqual([
      { name: 'body', type: appTypeOf(column('body', notesIR)), optional: true, readonly: false },
    ]);
    expect(jsonSchemaFromIR(notesIR, 'create').required).toEqual([]);
    // A row that came back has every column, `null` included, so nothing is optional there.
    expect(objectTypeFromIR(notesIR, 'entity').properties.every(p => !p.optional)).toBe(true);
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
    // `timestamp`, so neither layer was ever wrong and neither was ever checked. A caller now
    // says which side of the boundary it is on.
    expect(property('createdAt').type).toEqual({ kind: 'scalar', scalar: 'date' });
    expect(property('createdAt', 'entity', 'wire').type).toMatchObject({
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
