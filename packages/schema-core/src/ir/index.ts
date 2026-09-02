// @zmdb/schema-core/ir — the intermediate representation every walker consumes.
//
// This module exists because the repo grew four independent walkers over the same
// column metadata (`PLAN-type-first.md` §1): the AOT's `emitCheck`, its runtime
// `matches`/`collectIssues`, `openapi`'s `scalarSchema`, and the repository's
// `valueMatchesColumn`. Each had its own vocabulary and its own gaps, and they
// disagreed with each other. Adding a fifth for tagged types would have made it
// worse, so the tags land on top of one IR instead.
//
//   FRONT-ENDS                  IR                       BACK-ENDS
//   tagged type ──┐                          ┌── predicate JS  (is)
//                 ├──▶ SchemaIR / TypeIR ────┼── JSON Schema   (openapi/llm/web)
//   defineSchema ─┘        (pure data)        ├── runtime walker (fallback)
//                                            └── SQL / DDL     (query-compiler)
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

import type { ColumnMeta, CoreSchema, SqlType } from '../index.ts';

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
}

// ---------------------------------------------------------------------------
// Schema IR
// ---------------------------------------------------------------------------

export type RelationKind = 'manyToOne' | 'oneToMany' | 'oneToOne' | 'manyToMany';

export interface RelationIR {
  readonly name: string;
  readonly relation: RelationKind;
  readonly target: string;
  /** The foreign-key column, or the join table for `manyToMany`. */
  readonly via: string;
}

export interface ColumnIR {
  readonly name: string;
  /** Abstract SQL type. The dialect renders the spelling — see plan D3. */
  readonly sql: SqlType;
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
   * Not declaration order, and deliberately so. The other producer of this IR reads
   * `'free' | 'pro' | 'enterprise'` back out of the checker, which normalises string-literal
   * union members and hands them over in its own order — declaration order is simply not
   * recoverable from a type. A set of permitted values has no order to lose, so both
   * producers sort and the two agree by construction rather than by luck. (They agreed by
   * luck until `codemod.spec.ts`: the only enum in the equivalence corpus was
   * `'admin' | 'editor' | 'viewer'`, which is already sorted.)
   *
   * Emitters may therefore rely on this being stable across front-ends and TypeScript
   * versions, which the checker's order is not.
   */
  readonly enum?: readonly string[];
  readonly references?: string;
  readonly codec?: string;
  readonly constraints: Constraints;
  /** Named custom rules (`Rule<'name'>`) an emitter must resolve or refuse. */
  readonly rules: readonly string[];
  readonly default?: unknown;
  /** Set for `json` columns whose payload shape is known. */
  readonly payload?: TypeIR;
}

export interface SchemaIR {
  readonly table: string;
  readonly columns: readonly ColumnIR[];
  readonly primaryKey: readonly string[];
  readonly relations: readonly RelationIR[];
  readonly ftsTable?: string | boolean;
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
 * The tag vocabulary as data: **IR field → the escaped name of the tag's symbol
 * slot**. `../tags` is types-only and must stay that way, so the reflection cannot
 * import the tags themselves; it matches on the escaped name the checker reports
 * (`__@zmdbSerial@1`) instead.
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
  sql: 'zmdbSqlType',
  primaryKey: 'zmdbPrimaryKey',
  serial: 'zmdbSerial',
  unique: 'zmdbUnique',
  hasDefault: 'zmdbDefault',
  sensitive: 'zmdbSensitive',
  references: 'zmdbReferences',
  length: 'zmdbLength',
  precision: 'zmdbNumeric',
  codec: 'zmdbCodec',
  relation: 'zmdbRelation',
  minimum: 'zmdbMin',
  maximum: 'zmdbMax',
  minLength: 'zmdbMinLength',
  maxLength: 'zmdbMaxLength',
  pattern: 'zmdbPattern',
  rules: 'zmdbRule',
} as const;

/** An IR field a tag can set. */
export type TagField = keyof typeof TAG_NAMES;

// These two functions bridge two ways of spelling the same constraint, and the pair is
// deliberately small — see plan D6.
//
// `ValidationRule.kind` is an open `string`, and two things write it. `defineSchema`
// writes the IR's own keyword (`{ kind: 'minimum', value: n }`), which is a JSON Schema
// keyword and stays that way. `@zmdb/aot-validator`'s runtime `Rule` writes the **tag's**
// name — `tags.Min(n)` → `{ kind: 'Min', args: [n] }` — because that is what you write in
// a type, and one spelling per constraint means the type's. The two differ for exactly
// two constraints.
//
// This used to be a case fold (`'Minimum'` → `'minimum'`), which happened to work and
// accepted a great deal more than the two names that actually needed accepting. A table
// is the same length and says which spellings exist.

function ruleArgument(rule: { readonly value?: unknown; readonly args?: readonly unknown[] }): unknown {
  return rule.value ?? rule.args?.[0];
}

const CONSTRAINT_ALIASES: Readonly<Record<string, ConstraintKind>> = {
  minimum: 'minimum',
  Min: 'minimum',
  maximum: 'maximum',
  Max: 'maximum',
  minLength: 'minLength',
  MinLength: 'minLength',
  maxLength: 'maxLength',
  MaxLength: 'maxLength',
  pattern: 'pattern',
  Pattern: 'pattern',
};

function normaliseKind(kind: string): ConstraintKind | undefined {
  return CONSTRAINT_ALIASES[kind];
}

// ---------------------------------------------------------------------------
// Front-end: schema value → IR
// ---------------------------------------------------------------------------

function constraintsFromColumn(col: ColumnMeta): { constraints: Constraints; rules: readonly string[] } {
  const out: {
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  } = {};
  const rules: string[] = [];

  for (const rule of col.validation ?? []) {
    const kind = normaliseKind(rule.kind);
    if (kind === undefined) {
      rules.push(rule.kind);
      continue;
    }
    const arg = ruleArgument(rule);
    if (kind === 'pattern') {
      if (typeof arg === 'string') out.pattern = arg;
      continue;
    }
    if (typeof arg === 'number') out[kind] = arg;
  }

  return { constraints: out, rules };
}

/**
 * The value front-end. It exists so the tagged front-end can be *proved* against
 * it — "the IR from `User` equals the IR from `UserSchema`" is what lets the
 * existing SQL and JSON Schema snapshots serve as the correctness argument for
 * type-first declaration. Per plan D2 it is scaffolding with a demolition date:
 * it goes when `defineSchema` does.
 */
export function irFromSchema(schema: CoreSchema<string>): SchemaIR {
  const referenceByColumn = new Map(schema.references.map(r => [r.column, r.target]));

  const columns: ColumnIR[] = Object.entries(schema.columns).map(([name, col]) => {
    const { constraints, rules } = constraintsFromColumn(col);
    const target = referenceByColumn.get(name) ?? col.references?.target;
    return {
      name,
      sql: col.type,
      nullable: col.flags.nullable === true,
      primaryKey: col.flags.primaryKey === true,
      serial: col.flags.autoIncrement === true,
      unique: col.flags.unique === true,
      hasDefault: col.flags.hasDefault === true,
      sensitive: col.flags.sensitive === true,
      ...(col.flags.length === undefined ? {} : { length: col.flags.length }),
      ...(col.flags.enum === undefined ? {} : { enum: [...col.flags.enum].toSorted() }),
      ...(target === undefined ? {} : { references: target }),
      constraints,
      rules,
      ...(col.default === undefined ? {} : { default: col.default }),
    };
  });

  return {
    table: schema.table,
    columns,
    primaryKey: [...schema.primaryKey],
    relations: [],
    ...(schema.ftsTable === undefined ? {} : { ftsTable: schema.ftsTable }),
  };
}

// ---------------------------------------------------------------------------
// The three types of a column (plan D3 / REQ-TF-13)
// ---------------------------------------------------------------------------

function withNull(type: TypeIR, nullable: boolean): TypeIR {
  return nullable ? { kind: 'union', members: [type, { kind: 'null' }] } : type;
}

function constrained(scalar: ScalarKind, col: ColumnIR, format?: string): ScalarIR {
  const constraints: Constraints =
    col.length !== undefined && col.constraints.maxLength === undefined
      ? { ...col.constraints, maxLength: col.length }
      : col.constraints;
  return {
    kind: 'scalar',
    scalar,
    ...(format === undefined ? {} : { format }),
    ...(Object.keys(constraints).length === 0 ? {} : { constraints }),
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
      return col.payload ?? { kind: 'unknown' };
  }
}

/**
 * The **wire** type: what a JSON body actually contains. A `timestamp` is an
 * ISO-8601 string, because a `Date` cannot survive JSON, and a `bigint` is a
 * string for the same reason. Anything else matches the app type.
 */
export function wireTypeOf(col: ColumnIR): TypeIR {
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
  if (col.nullable && typeof base.type === 'string') base.type = [base.type, 'null'];

  return base;
}

/**
 * The document for a variant. Byte-for-byte the contract `toJsonSchema` already
 * publishes; the point is that it is now a pure function of IR, so the value
 * front-end and the tagged front-end cannot produce different documents
 * (REQ-TF-7). That AC stops being a test to chase and becomes the only thing the
 * code can do.
 */
export function jsonSchemaFromIR(ir: SchemaIR, variant: Variant = 'entity'): JsonSchemaObject {
  const isResponse = variant === 'entity' || variant === 'get' || variant === 'list' || variant === 'search';

  const visible = ir.columns
    // Sensitive columns never appear in a generated specification. create/update
    // additionally drop database-generated columns; response variants keep all.
    .filter(col => !col.sensitive && (isResponse ? true : !col.serial))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const col of visible) {
    properties[col.name] = jsonSchemaForColumn(col);
    if (variant === 'update') continue; // a patch requires nothing
    if (isResponse) {
      if (!col.nullable) required.push(col.name);
    } else if (!col.hasDefault && !col.nullable) {
      required.push(col.name);
    }
  }

  return { type: 'object', properties, required: required.toSorted() };
}
