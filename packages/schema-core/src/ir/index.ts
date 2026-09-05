// @zmdb/schema-core/ir — the intermediate representation every walker consumes.
//
// This module exists because the repo grew four independent walkers over the same
// column metadata (`PLAN-type-first.md` §1): the AOT's `emitCheck`, its runtime
// `matches`/`collectIssues`, `openapi`'s `scalarSchema`, and the repository's
// `valueMatchesColumn`. Each had its own vocabulary and its own gaps, and they
// disagreed with each other. Adding a fifth for tagged types would have made it
// worse, so the tags land on top of one IR instead.
//
//   FRONT-END                   IR                       BACK-ENDS
//                                            ┌── predicate JS   (is)
//   tagged type ────▶ SchemaIR / TypeIR ─────┼── JSON Schema    (openapi/llm/web)
//                         (pure data)        ├── runtime walker (fallback, repository)
//                                            ├── schema value   (schemaFromIR)
//                                            └── SQL / DDL      (query-compiler)
//
// There used to be a second front-end — `irFromSchema`, which read the IR back out of a
// `defineSchema` value — and its whole purpose was to be the thing the tagged front-end
// was proved equal to. It went when `defineSchema` did. `schemaFromIR` is what remains,
// and it points the other way: the value is now a projection of the IR, not a source of it.
//
// Two hard constraints on everything below:
//
//  1. **The IR is serialisable JSON.** No symbols, no functions, no class
//     instances. That is what lets the codegen CLI write it to disk, lets golden
//     tests snapshot it, and keeps `typescript` out of every runtime bundle.
//  2. **`sql` stays abstract.** A `timestamp` column carries `'timestamp'`, never
//     `'timestamptz'`. A column has three types — wire, app and db — and each
//     layer renders the one it owns (plan D3). Rendering a dialect's spelling is
//     the dialect's job; baking one in here would force every other back-end to
//     parse it back out.

import type { ColumnMeta, CoreSchema, SqlType, ValidationRule } from '../index.js';

// ---------------------------------------------------------------------------
// Type IR
// ---------------------------------------------------------------------------

/**
 * Numeric and string bounds. Deliberately a flat record rather than the old
 * `ValidationRule[]`: the four walkers disagreed partly because `TypeDescriptor`
 * had `minimum` and `maxLength` but no `maximum` and no `minLength`, so a
 * `Min<18> & Max<120>` column validated differently depending on which one you
 * asked.
 */
export interface Constraints {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/**
 * `integer` is separate from `number` so an emitter can produce
 * `Number.isInteger`, and `date` is separate from `string` so the app type and
 * the wire type can differ without either lying (plan D3).
 */
export type ScalarKind = 'string' | 'number' | 'integer' | 'bigint' | 'boolean' | 'date';

export interface ScalarIR {
  readonly kind: 'scalar';
  readonly scalar: ScalarKind;
  /** Protobuf scalar spelling, when the declaration made width/signedness explicit. */
  readonly proto?: ProtoScalar;
  /** JSON Schema `format`, when the scalar has a conventional one. */
  readonly format?: string;
  readonly constraints?: Constraints;
}

export interface LiteralIR {
  readonly kind: 'literal';
  readonly value: string | number | boolean;
}

export interface NullIR {
  readonly kind: 'null';
}

export interface UndefinedIR {
  readonly kind: 'undefined';
}

export interface UnknownIR {
  readonly kind: 'unknown';
}

export interface UnionIR {
  readonly kind: 'union';
  readonly members: readonly TypeIR[];
}

export interface ArrayIR {
  readonly kind: 'array';
  readonly element: TypeIR;
  readonly constraints?: Constraints;
}

export interface TupleIR {
  readonly kind: 'tuple';
  readonly elements: readonly TypeIR[];
}

export interface ObjectIR {
  readonly kind: 'object';
  /** Set when the type had a name, so emitters can hoist a shared helper. */
  readonly name?: string;
  readonly properties: readonly PropertyIR[];
}

/** A back-reference to a named `ObjectIR` already on the stack. Cycle guard. */
export interface RefIR {
  readonly kind: 'ref';
  readonly name: string;
}

/**
 * A first-class node, not an absence. A gap has to be visible: the transformer
 * bug fixed in `f70186c6` happened because an unrecognised type produced a
 * *partial* answer that looked like a real one. An `unsupported` node makes the
 * emitter refuse and the build fail with the reason (plan D4).
 */
export interface UnsupportedIR {
  readonly kind: 'unsupported';
  readonly reason: string;
  /** The type as written, when the producer can recover it. */
  readonly source?: string;
}

export type TypeIR =
  | ScalarIR
  | LiteralIR
  | NullIR
  | UndefinedIR
  | UnknownIR
  | UnionIR
  | ArrayIR
  | TupleIR
  | ObjectIR
  | RefIR
  | UnsupportedIR;

export interface PropertyIR {
  readonly name: string;
  readonly type: TypeIR;
  readonly optional: boolean;
  readonly readonly: boolean;
  /** Stable protobuf identity. Required only when this object is emitted as a message. */
  readonly protoField?: number;
}

// ---------------------------------------------------------------------------
// Schema IR
// ---------------------------------------------------------------------------

export interface TableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

/**
 * The four cardinalities, as data so a reader can check a string against them.
 *
 * Written this way round — the list first, the type derived — because `../tags` fixes
 * `kind` to a literal per tag, but the reflection reads it back off the checker as a
 * `string`. Deriving the type from the list is what lets that read be a check rather than
 * an assertion, and keeps the two from drifting.
 */
export const RELATION_KINDS = ['manyToOne', 'oneToMany', 'oneToOne', 'manyToMany'] as const;

export type RelationKind = (typeof RELATION_KINDS)[number];

export type ReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

export interface RelationIR {
  readonly name: string;
  readonly relation: RelationKind;
  readonly target: string;
  /** The foreign-key column, or the join table for `manyToMany`. */
  readonly via: string;
}

export interface ForeignKeyIR {
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
}

/** A SQL type installed by a database extension rather than the closed core vocabulary. */
export interface ExtensionType {
  readonly extension: string;
  readonly name: string;
  readonly args?: readonly (string | number)[];
}

export interface ColumnIR {
  readonly name: string;
  /** The database column name resolved by the build-time naming strategy. */
  readonly physicalName: string;
  /** Abstract SQL type. The dialect renders the spelling — see plan D3. */
  readonly sql: SqlType | ExtensionType;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  /** Database-generated. Absent from `CreateDTO`, not merely optional. */
  readonly serial: boolean;
  readonly unique: boolean;
  readonly hasDefault: boolean;
  readonly sensitive: boolean;
  readonly length?: number;
  readonly precision?: readonly [number, number];
  /**
   * The permitted values, **sorted**.
   *
   * Not declaration order, and deliberately so. The producer reads
   * `'free' | 'pro' | 'enterprise'` back out of the checker, which normalises string-literal
   * union members and hands them over in its own order — declaration order is simply not
   * recoverable from a type. A set of permitted values has no order to lose, so sorting is
   * what makes this a function of the declaration rather than of the compiler's internals.
   *
   * Emitters may therefore rely on this being stable across TypeScript versions, which the
   * checker's order is not.
   */
  readonly enum?: readonly string[];
  readonly references?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly codec?: string;
  /**
   * The declared wire type (`WireAs<W>`), for a column whose wire form does not follow
   * from `sql`. A codec's does not: only the declaration knows whether `Money` crosses
   * as a decimal string, a `{ cents }` object or a pair.
   */
  readonly wire?: TypeIR;
  readonly constraints: Constraints;
  /** Named custom rules (`Rule<'name'>`) an emitter must resolve or refuse. */
  readonly rules: readonly string[];
  readonly default?: unknown;
  /**
   * The declared app type: a `json` column's payload shape, or the type behind a codec.
   *
   * There is nowhere in `ColumnMeta` for this to go, which is why `CoreSchema` carries the
   * IR rather than only its projection — a `Settings & Sql<'json'>` read back off the flags
   * alone is just `json`, and the emitted validator would check nothing about the payload.
   */
  readonly payload?: TypeIR;
}

export interface SchemaIR {
  readonly table: string;
  /** The database table name resolved by the build-time naming strategy. */
  readonly physicalTable: string;
  readonly columns: readonly ColumnIR[];
  readonly primaryKey: readonly string[];
  readonly relations: readonly RelationIR[];
  readonly foreignKeys: readonly ForeignKeyIR[];
  readonly ftsTable?: string | boolean;
  /** The nullable timestamp column managed by soft delete. */
  readonly softDelete?: { readonly column: string };
  readonly tableOptions?: TableOptions;
}

// ---------------------------------------------------------------------------
// Vocabulary coverage (REQ-TF-1)
// ---------------------------------------------------------------------------

/** Every `SqlType`, as data. `sql-types.type-test.ts` asserts exhaustiveness. */
export const SQL_TYPES = [
  'serial',
  'integer',
  'bigint',
  'numeric',
  'text',
  'varchar',
  'boolean',
  'timestamp',
  'json',
  'jsonEnum',
] as const satisfies readonly SqlType[];

/**
 * `ValidationRule.kind` is an open `string`, so this is the set any back-end
 * interprets rather than the set a consumer may write. Anything else is a named
 * custom rule and lands in `ColumnIR.rules`.
 */
export const KNOWN_CONSTRAINT_KINDS = ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern'] as const;

export type ConstraintKind = (typeof KNOWN_CONSTRAINT_KINDS)[number];

/**
 * The tag vocabulary as data: **IR field → the tag name the reflection recognises**.
 * `../tags` is types-only and must stay that way, so the reflection cannot import the
 * tags themselves. It matches the escaped unique-symbol name the checker reports
 * (`__@zmdbSerial@1`), except for `Ext`'s frozen structural `__zmdbExt` marker.
 *
 * Keyed by the IR field rather than by the tag's public name because that is the
 * mapping every consumer actually wants, and because keeping it in one table is what
 * lets `vocabulary.type-test.ts` prove the two vocabularies line up. A tag added to
 * `../tags` without an entry here is invisible to the reflection, which is precisely
 * the silent-gap failure the whole IR exists to prevent.
 */
export const TAG_NAMES = {
  table: 'zmdbTable',
  ftsTable: 'zmdbFts',
  shardKey: 'zmdbShardKey',
  sortKey: 'zmdbSortKey',
  rowstore: 'zmdbRowstore',
  softDelete: 'zmdbSoftDelete',
  sql: 'zmdbSqlType',
  extension: 'zmdbExt',
  primaryKey: 'zmdbPrimaryKey',
  serial: 'zmdbSerial',
  unique: 'zmdbUnique',
  hasDefault: 'zmdbDefault',
  sensitive: 'zmdbSensitive',
  references: 'zmdbReferences',
  onDelete: 'zmdbOnDelete',
  onUpdate: 'zmdbOnUpdate',
  foreignKeys: 'zmdbForeignKey',
  length: 'zmdbLength',
  precision: 'zmdbNumeric',
  codec: 'zmdbCodec',
  wire: 'zmdbWire',
  relation: 'zmdbRelation',
  minimum: 'zmdbMin',
  maximum: 'zmdbMax',
  minLength: 'zmdbMinLength',
  maxLength: 'zmdbMaxLength',
  pattern: 'zmdbPattern',
  rules: 'zmdbRule',
  protoField: 'zmdbProtoField',
  protoScalar: 'zmdbProtoScalar',
} as const;

/** An IR field a tag can set. */
export type TagField = keyof typeof TAG_NAMES;

/** The closed protobuf scalar vocabulary carried by {@link ScalarIR}. */
export const PROTO_SCALARS = [
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'float',
  'double',
  'bool',
  'string',
  'bytes',
] as const;

export type ProtoScalar = (typeof PROTO_SCALARS)[number];

// ---------------------------------------------------------------------------
// Back-end: IR → schema value (REQ-TF-10)
// ---------------------------------------------------------------------------

/**
 * The constraints, in the spelling `ColumnMeta.validation` uses.
 *
 * Emitted in `KNOWN_CONSTRAINT_KINDS` order rather than any order they arrived in: the
 * IR holds them in a record, which has none to preserve, so a fixed order is the only
 * one that makes the output a function of the input. Named custom rules keep their name
 * and lose their arguments, because `ColumnIR.rules` only ever held the name.
 */
function validationFromIR(col: ColumnIR): readonly ValidationRule[] {
  const rules: ValidationRule[] = [];
  for (const kind of KNOWN_CONSTRAINT_KINDS) {
    const value = col.constraints[kind];
    if (value !== undefined) rules.push({ kind, value });
  }
  for (const kind of col.rules) rules.push({ kind });
  return rules;
}

/**
 * A column's metadata. Flags are written only when set — a plain `text` column gives
 * `{ nullable: false }` and nothing else — so the generated literal stays as small as
 * the declaration it came from.
 */
function columnMetaFromIR(col: ColumnIR): ColumnMeta {
  const validation = validationFromIR(col);
  return {
    type: col.sql,
    flags: {
      nullable: col.nullable,
      ...(col.primaryKey ? { primaryKey: true } : {}),
      ...(col.serial ? { autoIncrement: true } : {}),
      ...(col.unique ? { unique: true } : {}),
      ...(col.hasDefault ? { hasDefault: true } : {}),
      ...(col.sensitive ? { sensitive: true } : {}),
      ...(col.length === undefined ? {} : { length: col.length }),
      ...(col.enum === undefined ? {} : { enum: col.enum }),
    },
    ...(col.default === undefined ? {} : { default: col.default }),
    ...(col.references === undefined ? {} : { references: { target: col.references } }),
    ...(validation.length === 0 ? {} : { validation }),
  };
}

/**
 * The schema value, from the IR — and the only way to get one (REQ-TF-10).
 *
 * The query compiler wants the table name and the column types as *data*, and this is
 * data. `@zmdb/aot-validator` emits the result of this function as a frozen literal, so
 * `schemaOf<T>()` costs nothing at runtime and the tagged type stays the only place the
 * schema is written.
 *
 * The IR itself is carried through on `ir` rather than left behind. Three things a
 * `ColumnMeta` has no field for — `Numeric<P, S>` precision, a `Codec<'Name'>`, a `json`
 * payload shape — used to be dropped here and were unrecoverable afterwards, because the
 * only way back to an IR was to walk the flags. Keeping the IR makes the value a superset
 * of what it projects rather than a lossy copy, and it is what let `irFromSchema` go: no
 * consumer has to reconstruct from `columns` what the declaration already said.
 *
 * Nothing is registered. A generated literal is not a call and has nowhere to do that,
 * and a global "which schema was that?" lookup is for code that has lost track of its own
 * schema — which type-first code, by construction, has not.
 */
export function schemaFromIR(ir: SchemaIR): CoreSchema<string> {
  const key = new Set(ir.primaryKey);
  const columnNames = new Set(ir.columns.map(column => column.name));
  const missing = ir.primaryKey.filter(column => !columnNames.has(column));
  if (missing.length > 0) {
    throw new Error(
      `${ir.table}: primary key names ${missing.map(column => `"${column}"`).join(', ')}, ` +
        `${missing.length === 1 ? 'a column' : 'columns'} the table does not have`,
    );
  }

  const normalizedColumns = ir.columns.map(column => {
    const primaryKey = key.has(column.name);
    return column.primaryKey === primaryKey ? column : { ...column, primaryKey };
  });
  const normalizedIr = normalizedColumns.every((column, index) => column === ir.columns[index])
    ? ir
    : { ...ir, columns: normalizedColumns };

  const physicalNames = new Map<string, string>();
  for (const column of normalizedIr.columns) {
    const previous = physicalNames.get(column.physicalName);
    if (previous !== undefined) {
      throw new Error(
        `${normalizedIr.table}: \`${previous}\` and \`${column.name}\` both map to the column ` +
          `\`${column.physicalName}\``,
      );
    }
    physicalNames.set(column.physicalName, column.name);
  }

  const physicalByProperty = new Map(normalizedIr.columns.map(column => [column.name, column.physicalName]));
  const columns: Record<string, ColumnMeta> = {};
  for (const col of normalizedIr.columns) columns[col.physicalName] = columnMetaFromIR(col);

  return {
    table: normalizedIr.physicalTable,
    columns,
    primaryKey: normalizedIr.primaryKey.map(column => physicalByProperty.get(column) ?? column),
    references: normalizedIr.columns.flatMap(col =>
      col.references === undefined ? [] : [{ column: col.physicalName, target: col.references }],
    ),
    ...(normalizedIr.ftsTable === undefined ? {} : { ftsTable: normalizedIr.ftsTable }),
    ir: normalizedIr,
  };
}

// ---------------------------------------------------------------------------
// The three types of a column (plan D3 / REQ-TF-13)
// ---------------------------------------------------------------------------

function withNull(type: TypeIR, nullable: boolean): TypeIR {
  return nullable ? { kind: 'union', members: [type, { kind: 'null' }] } : type;
}

function constrained(scalar: ScalarKind, col: ColumnIR, format?: string): ScalarIR {
  const withLength: Constraints =
    col.length !== undefined && col.constraints.maxLength === undefined
      ? { ...col.constraints, maxLength: col.length }
      : col.constraints;
  const derived = format === undefined ? undefined : FORMAT_PATTERNS[format];
  const constraints: Constraints =
    derived !== undefined && withLength.pattern === undefined ? { ...withLength, pattern: derived } : withLength;
  return {
    kind: 'scalar',
    scalar,
    ...(format === undefined ? {} : { format }),
    ...(Object.keys(constraints).length === 0 ? {} : { constraints }),
  };
}

function extensionDimension(type: ExtensionType): number | undefined {
  if (type.name !== 'vector') return undefined;
  const dimension = type.args?.[0];
  return typeof dimension === 'number' && Number.isInteger(dimension) && dimension >= 0 ? dimension : undefined;
}

function extensionAppBase(col: ColumnIR, type: ExtensionType): TypeIR {
  if (type.name === 'vector') {
    const dimension = extensionDimension(type);
    return {
      kind: 'array',
      element: { kind: 'scalar', scalar: 'number' },
      ...(dimension === undefined ? {} : { constraints: { minLength: dimension, maxLength: dimension } }),
    };
  }
  if (type.name === 'citext') return constrained('string', col);
  return {
    kind: 'unsupported',
    reason:
      `extension type "${type.name}" on column "${col.name}" needs its declared application shape ` +
      'carried in the IR',
  };
}

/**
 * The **app** type: what handler code sees. A `timestamp` is a `Date` here, and
 * a `bigint` is a `bigint`.
 */
export function appTypeOf(col: ColumnIR): TypeIR {
  return withNull(appBaseOf(col), col.nullable);
}

function appBaseOf(col: ColumnIR): TypeIR {
  if (typeof col.sql !== 'string') {
    if (col.sql.name === 'vector' || col.sql.name === 'citext') return extensionAppBase(col, col.sql);
    if (col.payload !== undefined) return col.payload;
    return extensionAppBase(col, col.sql);
  }

  // A declared app type wins over the SQL type it is stored as. `amount: Money &
  // Sql<'integer'> & Codec<'Money'>` is an integer in the database and a `Money` in the
  // app, and a validator that checked `integer` here would reject every valid value.
  if (col.payload !== undefined) return col.payload;

  switch (col.sql) {
    case 'serial':
    case 'integer':
      return constrained('integer', col);
    case 'bigint':
      return constrained('bigint', col);
    case 'numeric':
      return constrained('number', col);
    case 'text':
    case 'varchar':
      return constrained('string', col);
    case 'boolean':
      return { kind: 'scalar', scalar: 'boolean' };
    case 'timestamp':
      return { kind: 'scalar', scalar: 'date' };
    case 'jsonEnum':
      return col.enum === undefined || col.enum.length === 0
        ? constrained('string', col)
        : { kind: 'union', members: col.enum.map(value => ({ kind: 'literal', value }) as const) };
    case 'json':
      return JSON_CONTAINER;
  }
}

/**
 * A `json` column whose payload shape is not known: anything JSON puts in a column, and
 * nothing else. An object with no declared properties accepts any record, and an array of
 * `unknown` accepts any array, so together they are "not a primitive".
 *
 * Not `{ kind: 'unknown' }`, which accepts `123`. A declaration that says what the payload
 * is — `lines: Line[] & Sql<'json'>` — gets that type instead, via `ColumnIR.payload`; this
 * is the answer for a bare `object & Sql<'json'>`, which really does permit any record. It
 * is the weakest true statement rather than no statement, which is the difference between a
 * validator that rejects `settings: 123` and one that does not.
 */
const JSON_CONTAINER: TypeIR = {
  kind: 'union',
  members: [
    { kind: 'object', properties: [] },
    { kind: 'array', element: { kind: 'unknown' } },
  ],
};

/**
 * The assertion behind a `format`, as a `pattern`.
 *
 * `format` is an annotation in JSON Schema, not an assertion — a document may say
 * `date-time` and a conforming validator may check nothing. Neither the runtime walk nor the
 * emitter reads `format` at all, so a wire type that only said `{scalar:'string',
 * format:'date-time'}` accepted `"tomorrow"`, and plan D3's claim that a `Wire<T>` validator
 * checks the ISO string was not true of any validator. Lowering it to a `pattern` makes it
 * true through machinery that already exists in both walks, which is the reason it is spelled
 * this way rather than as a sixth constraint kind: a new keyword would need the emitter, the
 * walker and their equivalence test, and would then check exactly what a pattern checks.
 *
 * `date-time` is RFC 3339, so the offset is **required**. `2020-01-01T00:00:00` is a valid
 * ISO-8601 string and `new Date()` reads it as local time, which is the same lost-offset bug
 * `TIMESTAMPTZ` exists to prevent — the wire is where that has to be refused, because by the
 * time it is a `Date` the offset it was read at is gone.
 *
 * `int64` is `asBigInt`'s own `DECIMAL`, so what the wire validator accepts and what the
 * decoder can convert are one expression rather than two that agree today.
 */
/** What `asBigInt` will convert. Declared here so the wire pattern is not a second copy. */
const DECIMAL = /^-?\d+$/;

const FORMAT_PATTERNS: Readonly<Record<string, string>> = {
  'date-time': '^\\d{4}-\\d{2}-\\d{2}[Tt ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:[Zz]|[+-]\\d{2}:\\d{2})$',
  int64: DECIMAL.source,
};

/**
 * The **wire** type: what a JSON body actually contains. A `timestamp` is an
 * ISO-8601 string, because a `Date` cannot survive JSON, and a `bigint` is a
 * string for the same reason. Anything else matches the app type.
 */
export function wireTypeOf(col: ColumnIR): TypeIR {
  if (col.wire !== undefined) return withNull(col.wire, col.nullable);
  if (col.codec !== undefined) {
    // A gap, and gaps are visible (plan D4). A codec exists because the app type is not
    // the stored type; what it puts on the wire is a third choice that nothing but the
    // declaration knows, and guessing "the same as the app type" is how a `Money`
    // instance reaches `JSON.stringify`.
    return {
      kind: 'unsupported',
      reason: `the codec "${col.codec}" does not say what column "${col.name}" looks like on the wire; add WireAs<…> to the declaration`,
    };
  }
  if (typeof col.sql !== 'string') return appTypeOf(col);
  if (col.sql === 'timestamp') return withNull(constrained('string', col, 'date-time'), col.nullable);
  if (col.sql === 'bigint') return withNull(constrained('string', col, 'int64'), col.nullable);
  return appTypeOf(col);
}

// ---------------------------------------------------------------------------
// Back-end: IR → JSON Schema
// ---------------------------------------------------------------------------

export type Variant = 'entity' | 'create' | 'update' | 'get' | 'list' | 'search';

export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

/**
 * A single column's JSON Schema. Emitted from the **wire** type, which is why a
 * `timestamp` becomes `{type:'string',format:'date-time'}` here and a `Date` in
 * `Entity<T>` — one column, two correct answers, each in its own layer.
 */
export function jsonSchemaForColumn(col: ColumnIR): Record<string, unknown> {
  const base: Record<string, unknown> = {};

  const declared = declaredWireKeywords(col);
  if (declared) return nullableType(declared, col.nullable);

  if (typeof col.sql !== 'string') return nullableType(extensionJsonSchema(col, col.sql), col.nullable);

  switch (col.sql) {
    case 'serial':
    case 'integer':
      base.type = 'integer';
      break;
    case 'bigint':
      base.type = 'integer';
      base.format = 'int64';
      break;
    case 'numeric':
      base.type = 'number';
      break;
    case 'text':
    case 'varchar':
      base.type = 'string';
      if (col.length !== undefined) base.maxLength = col.length;
      break;
    case 'boolean':
      base.type = 'boolean';
      break;
    case 'timestamp':
      base.type = 'string';
      base.format = 'date-time';
      break;
    case 'jsonEnum':
      base.type = 'string';
      base.enum = [...(col.enum ?? [])];
      break;
    case 'json':
      break;
  }

  const c = col.constraints;
  if (c.minimum !== undefined) base.minimum = c.minimum;
  if (c.maximum !== undefined) base.maximum = c.maximum;
  if (c.minLength !== undefined) base.minLength = c.minLength;
  if (c.maxLength !== undefined) base.maxLength = c.maxLength;
  if (c.pattern !== undefined) base.pattern = c.pattern;

  // Nullable widens the `type` keyword. A `json` column has no `type` to widen,
  // which is the pre-existing behaviour and is preserved deliberately.
  return nullableType(base, col.nullable);
}

function extensionJsonSchema(col: ColumnIR, type: ExtensionType): Record<string, unknown> {
  if (type.name === 'vector') {
    const dimension = extensionDimension(type);
    return {
      type: 'array',
      items: { type: 'number' },
      ...(dimension === undefined ? {} : { minItems: dimension, maxItems: dimension }),
    };
  }
  if (type.name === 'citext') return jsonSchemaForType(constrained('string', col));
  return col.payload === undefined ? {} : jsonSchemaForType(col.payload);
}

function jsonSchemaForType(type: TypeIR): Record<string, unknown> {
  switch (type.kind) {
    case 'scalar': {
      const scalar = JSON_SCALAR_TYPES[type.scalar];
      if (scalar === undefined) return {};
      return {
        type: scalar,
        ...(type.format === undefined ? {} : { format: type.format }),
        ...(type.constraints?.minimum === undefined ? {} : { minimum: type.constraints.minimum }),
        ...(type.constraints?.maximum === undefined ? {} : { maximum: type.constraints.maximum }),
        ...(type.constraints?.minLength === undefined ? {} : { minLength: type.constraints.minLength }),
        ...(type.constraints?.maxLength === undefined ? {} : { maxLength: type.constraints.maxLength }),
        ...(type.constraints?.pattern === undefined ? {} : { pattern: type.constraints.pattern }),
      };
    }
    case 'literal':
      return { const: type.value };
    case 'null':
      return { type: 'null' };
    case 'array':
      return {
        type: 'array',
        items: jsonSchemaForType(type.element),
        ...(type.constraints?.minLength === undefined ? {} : { minItems: type.constraints.minLength }),
        ...(type.constraints?.maxLength === undefined ? {} : { maxItems: type.constraints.maxLength }),
      };
    case 'tuple':
      return {
        type: 'array',
        prefixItems: type.elements.map(jsonSchemaForType),
        minItems: type.elements.length,
        maxItems: type.elements.length,
      };
    case 'object': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const property of type.properties) {
        properties[property.name] = jsonSchemaForType(property.type);
        if (!property.optional) required.push(property.name);
      }
      return { type: 'object', properties, required };
    }
    case 'union':
      return { anyOf: type.members.map(jsonSchemaForType) };
    case 'undefined':
    case 'unknown':
    case 'ref':
    case 'unsupported':
      return {};
  }
}

function nullableType(schema: Record<string, unknown>, nullable: boolean): Record<string, unknown> {
  if (nullable && typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  return schema;
}

/**
 * The keywords for a `WireAs<W>` column, when `W` is something JSON Schema has keywords
 * for. A scalar and a union of string literals cover every wire form seen so far — cents
 * as a decimal string, a UUID, an enum.
 *
 * Anything richer (a tuple, an object) gets no `type` keyword rather than a wrong one:
 * the same "widest true statement" a `json` column has always produced, for the same
 * reason. It is a smaller document, not a false one.
 */
function declaredWireKeywords(col: ColumnIR): Record<string, unknown> | undefined {
  if (col.wire === undefined) return undefined;
  const node = col.wire;
  if (node.kind === 'scalar') {
    const type = JSON_SCALAR_TYPES[node.scalar];
    if (type === undefined) return {};
    return { type, ...(node.format === undefined ? {} : { format: node.format }) };
  }
  if (node.kind === 'union' && node.members.every(member => member.kind === 'literal')) {
    // boundary: `every` proves the predicate for every member but returns a `boolean`, so
    // the narrowing does not reach the `map` that follows. Re-testing `kind` inside the map
    // would be the same check twice for a branch that cannot be taken.
    return { enum: node.members.map(member => (member as LiteralIR).value) };
  }
  return {};
}

/** The JSON Schema `type` for a scalar the wire can carry. `date` and `bigint` cannot. */
const JSON_SCALAR_TYPES: Readonly<Record<string, string | undefined>> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
};

/**
 * A column, plus whether the shape it was read from makes it optional.
 *
 * This is what the JSON Schema back-end actually consumes, and it exists because a
 * variant name and a derived type are two spellings of the same information.
 * `toJsonSchema(schema, 'create')` names the variant, and the rule is "a column with a
 * default is optional here". `toJsonSchema<CreateDTO<User>>()` names the type, and the
 * type has already applied that rule — `createdAt?: Date & …` is optional because
 * `CreateDTO` made it so.
 *
 * Collapsing both onto `optional` is what keeps REQ-TF-7 structural rather than tested.
 * A second document generator that reads optionality off a type would be a fifth walker
 * (`PLAN-type-first.md` §1) and would drift the way the other four did.
 */
export interface ShapeColumnIR {
  readonly column: ColumnIR;
  /** The document does not require this property. */
  readonly optional: boolean;
}

/** The columns a document is generated from, in the order they were declared. */
export type ShapeIR = readonly ShapeColumnIR[];

/**
 * A variant, rewritten as a shape.
 *
 * The three rules the variants used to spell out inline: an input variant has no
 * database-generated columns at all, a patch requires nothing, and an input column with
 * a default may be left out. Each is exactly what the corresponding derived type does to
 * `Entity<T>`, which is the reason this translation exists rather than a coincidence.
 *
 * `update` also drops the primary key, which is what `UpdateDTO<T>` does and what this
 * function did not: a patch body identifies its row in the URL, so a key in the body is
 * either redundant or an attempt to move the row. It only ever showed for a *non-serial*
 * key, since a serial one was already gone, which is why no existing document changes.
 */
export function shapeOfVariant(ir: SchemaIR, variant: Variant): ShapeIR {
  const isResponse = variant === 'entity' || variant === 'get' || variant === 'list' || variant === 'search';
  return ir.columns
    .filter(col => isResponse || (!col.serial && col.name !== ir.softDelete?.column))
    .filter(col => variant !== 'update' || !col.primaryKey)
    .map(col => ({
      column: col,
      // Nullable is optional on the way in, for the reason `CreateDTO`'s comment gives:
      // omitting the key inserts `NULL`, so requiring it buys nothing. On the way out it
      // is not — a row that came back has every column, `null` included.
      optional: variant === 'update' || (!isResponse && (col.hasDefault || col.nullable)),
    }));
}

/**
 * The document for a shape.
 *
 * `required` is "not optional and not nullable", which is the single rule the three
 * variants were three cases of. A nullable column is never required because the value
 * `null` is admissible for it, so demanding the key adds nothing a validator can act on
 * — that is pre-existing behaviour, preserved deliberately.
 *
 * Sensitive columns are dropped here, in the emitter, and not in the shape. A generated
 * document is published, `Sensitive` means "must not be", and putting the filter at the
 * last step is what makes that unconditional (REQ-TF-6): no variant, and no derived type
 * a caller invents, can route around it. `CreateDTO<User>` deliberately *keeps* a
 * sensitive column — you have to be able to send a password — and its document still
 * must not name it.
 */
export function jsonSchemaFromShape(shape: ShapeIR): JsonSchemaObject {
  const visible = shape
    .filter(entry => !entry.column.sensitive)
    .toSorted((a, b) => a.column.name.localeCompare(b.column.name));

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const { column, optional } of visible) {
    properties[column.name] = jsonSchemaForColumn(column);
    if (!optional && !column.nullable) required.push(column.name);
  }

  return { type: 'object', properties, required: required.toSorted() };
}

/**
 * The document for a variant. Byte-for-byte the contract `toJsonSchema` already
 * publishes; the point is that it is a pure function of IR, so naming a variant and
 * naming a derived type cannot produce different documents (REQ-TF-7). That AC stops
 * being a test to chase and becomes the only thing the code can do.
 */
export function jsonSchemaFromIR(ir: SchemaIR, variant: Variant = 'entity'): JsonSchemaObject {
  return jsonSchemaFromShape(shapeOfVariant(ir, variant));
}

// ---------------------------------------------------------------------------
// Back-end: IR → validator type (a `TypeIR` for a whole row or payload)
// ---------------------------------------------------------------------------
//
// The repository used to answer "is this a legal payload for this table" with its own
// walk over `ColumnMeta` — `valueMatchesColumn`, the fourth walker of §1, and the one
// that accepted `Date | string` for a `timestamp` while `toJsonSchema` said ISO string
// and the declared type said `Date`. It does not need a walk. It needs the *type* of a payload,
// which is a `TypeIR`, and then the one runtime walker in `@zmdb/aot-validator` checks
// it — the same walker the emitted code is differentially tested against.
//
// So this is the third back-end onto the same shape, beside the JSON Schema one, and it
// takes the same two decisions from the same place: which columns a variant has
// (`shapeOfVariant`) and what each column's type is at this layer (`appTypeOf` /
// `wireTypeOf`). Nothing here decides anything on its own, which is the point.

/**
 * Which of a column's three types to render (plan D3).
 *
 * `'app'` is what handler code holds: a `timestamp` is a `Date`. `'wire'` is what a JSON
 * body contains: the same column is an ISO-8601 string. A validator has to pick one —
 * accepting both is how the disagreement went unnoticed for so long — so the caller says
 * which side of the boundary it is on.
 */
export type Layer = 'app' | 'wire';

/**
 * A shape as the object type a validator checks against.
 *
 * Unlike the JSON Schema back-end this keeps sensitive columns: a payload validator that
 * silently ignored `passwordHash` would reject every legitimate `create`. REQ-TF-6 is
 * about what gets *published*, and nothing here is published.
 *
 * Column order is preserved rather than sorted, because a `TypeIR` is not a contract
 * anybody serialises — the JSON Schema back-end sorts because a document is published
 * and key order is part of it.
 */
export function objectTypeFromShape(shape: ShapeIR, layer: Layer = 'app'): ObjectIR {
  return {
    kind: 'object',
    properties: shape.map(({ column, optional }) => ({
      name: column.name,
      type: layer === 'wire' ? wireTypeOf(column) : appTypeOf(column),
      optional,
      // A DTO is a plain object the caller just built, so nothing about it is readonly.
      // `Entity<T>` is `-readonly` for the same reason.
      readonly: false,
    })),
  };
}

/** The object type of one variant of one table, at one layer. */
export function objectTypeFromIR(ir: SchemaIR, variant: Variant = 'entity', layer: Layer = 'app'): ObjectIR {
  return objectTypeFromShape(shapeOfVariant(ir, variant), layer);
}

// ---------------------------------------------------------------------------
// Back-end: the crossing between the two layers (plan D3)
// ---------------------------------------------------------------------------
//
// Having two layers is only useful if something converts between them, once, at the
// boundary. Otherwise every handler decides for itself whether the `at` it was handed is
// a string or a `Date`, which is the state that let the three types disagree.
//
// So: `decodeWire` turns a JSON body into app values, `encodeWire` turns a row back into
// a JSON body, and both read the same `ColumnIR` the validators and the DDL read. They
// convert and nothing else — a value they cannot convert is passed through untouched for
// the validator to reject. That division matters: a decoder that produced `new
// Date('nonsense')` would hand the app layer an `Invalid Date`, which passes `instanceof
// Date` and reaches the database as `NULL` or an error from the driver. Leaving the string
// alone makes the validator say `expected Date`, which is true and actionable.

/** How one named `Codec<'Name'>` column crosses the boundary. */
export interface Codec {
  readonly decode: (wire: unknown) => unknown;
  readonly encode: (app: unknown) => unknown;
}

/** Codec name → its conversions. Supplied by the application, not by zmdb. */
export type CodecRegistry = Readonly<Record<string, Codec>>;

/** An ISO-8601 string, if that is what this is and it parses. */
function asDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

/**
 * A decimal string as a `bigint`.
 *
 * `DECIMAL` rather than a bare `BigInt()` call in a `try`: `BigInt('0x10')` is 16 and
 * `BigInt('')` is 0, neither of which is something a caller meant to send.
 */
function asBigInt(value: unknown): unknown {
  return typeof value === 'string' && DECIMAL.test(value) ? BigInt(value) : value;
}

const VECTOR_COMPONENT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function asVector(value: unknown): unknown {
  if (Array.isArray(value) || typeof value !== 'string' || !value.startsWith('[') || !value.endsWith(']')) {
    return value;
  }
  const body = value.slice(1, -1);
  if (body === '') return [];
  const fields = body.split(',');
  if (fields.some(field => !VECTOR_COMPONENT.test(field.trim()))) return value;
  const vector = fields.map(field => Number(field.trim()));
  return vector.every(Number.isFinite) ? vector : value;
}

function codecFor(col: ColumnIR, codecs: CodecRegistry): Codec | undefined {
  if (col.codec === undefined) return undefined;
  const codec = codecs[col.codec];
  if (!codec) {
    // A named codec with nothing behind it is a gap, and a gap has to be visible (plan
    // D4). Silently passing the value through would store whatever JSON happened to
    // carry in a column whose whole point is that it needs converting.
    throw new Error(`column "${col.name}" names the codec "${col.codec}", which is not in the registry`);
  }
  return codec;
}

/** One column's value, as the app layer holds it. */
export function decodeWireValue(col: ColumnIR, value: unknown, codecs: CodecRegistry = {}): unknown {
  if (value === null || value === undefined) return value;
  const codec = codecFor(col, codecs);
  if (codec) return codec.decode(value);
  if (col.sql === 'timestamp') return asDate(value);
  if (col.sql === 'bigint') return asBigInt(value);
  return value;
}

/** One column's value, as JSON can carry it. */
export function encodeWireValue(col: ColumnIR, value: unknown, codecs: CodecRegistry = {}): unknown {
  if (value === null || value === undefined) return value;
  const codec = codecFor(col, codecs);
  if (codec) return codec.encode(value);
  if (col.sql === 'timestamp' && value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (col.sql === 'bigint' && typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * A JSON body as an app-layer payload: the wire→app decode, once, at the boundary.
 *
 * Keys the variant does not have are copied through rather than dropped, because dropping
 * them here would hide them from the repository's excess check — the decoder's job is to
 * convert, and deciding what a payload may contain belongs to exactly one place.
 */
export function decodeWire(
  ir: SchemaIR,
  variant: Variant,
  body: Readonly<Record<string, unknown>>,
  codecs: CodecRegistry = {},
): Record<string, unknown> {
  const columns = new Map(shapeOfVariant(ir, variant).map(({ column }) => [column.name, column]));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    const column = columns.get(key);
    out[key] = column ? decodeWireValue(column, body[key], codecs) : body[key];
  }
  return out;
}

/**
 * A value that came out of a database, as the app layer holds it — the third layer's
 * crossing (plan D3).
 *
 * Written in terms of what *arrived* rather than in terms of the dialect, and that is the
 * whole design: `pg` hands back a `Date` for a `timestamptz` and a string for an `int8`,
 * SQLite hands back the `TEXT` it stored and a `number` for an `INTEGER`, and a third
 * driver will do something else again. Asking "is this already the app value?" answers all
 * of them, and keeps this function out of the dialect's business — which is the constraint
 * the whole IR is written under.
 *
 * `timestamp` and `bigint` are the only core types whose app values need a distinct JSON
 * wire form. The db crossing also handles extension vectors: their app and wire forms are
 * both number arrays, but a driver without pgvector's parser can return the database text
 * form instead.
 */
export function decodeDbValue(col: ColumnIR, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof col.sql !== 'string') return col.sql.name === 'vector' ? asVector(value) : value;
  if (col.sql === 'timestamp') return asDate(value);
  if (col.sql === 'bigint') {
    // A driver that read an 8-byte integer into a `number`. Safe integers only: past 2^53
    // the number has already lost digits, and `BigInt(9007199254740993)` would state a
    // value the database never held — better to hand back the number the driver gave and
    // let the validator say the app type is not what arrived.
    if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : value;
    return asBigInt(value);
  }
  return value;
}

/** Which columns `decodeDbValue` can change — so a read path can skip the walk entirely. */
export function dbDecodedColumns(ir: SchemaIR): readonly ColumnIR[] {
  return ir.columns.filter(col => {
    if (typeof col.sql === 'string') return col.sql === 'timestamp' || col.sql === 'bigint';
    return col.sql.name === 'vector';
  });
}

/** A row as a JSON body: the app→wire encode, for a response. */
export function encodeWire(
  ir: SchemaIR,
  row: Readonly<Record<string, unknown>>,
  codecs: CodecRegistry = {},
): Record<string, unknown> {
  const columns = new Map(ir.columns.map(column => [column.name, column]));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const column = columns.get(key);
    out[key] = column ? encodeWireValue(column, row[key], codecs) : row[key];
  }
  return out;
}
