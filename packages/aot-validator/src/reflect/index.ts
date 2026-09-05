// Reflection: a TypeScript type → `@zmdb/schema-core/ir`.
//
// This is the front-end that makes type-first declaration possible, and since the
// builder DSL was deleted it is the only one (PRD §6.7, REQ-TF-4 … REQ-TF-7). It reads
// a checker `Type` and produces plain serialisable data; from there the back-ends —
// validator emission, JSON Schema, DDL, the schema value itself — are written against
// the IR and know nothing about where it came from. `PLAN-type-first.md` Phase 4.
//
// Three rules govern everything below, and each one is a reaction to a specific bug:
//
//  1. **Total.** `typeIR` never throws. Every input produces a node, and anything the
//     reflection cannot model produces `{ kind: 'unsupported', reason }`. The
//     alternative — throwing — makes one bad property abort a whole file, and the
//     silent alternative is worse: `f70186c6` was a transformer that inlined a
//     *partial* parse of a type it only half understood, and a partial answer is
//     indistinguishable from a correct one until production.
//
//  2. **Refusals are named.** `unsupported.reason` is prose a human can act on, not
//     `'unknown'`. The emitter turns an `unsupported` node into a build error (plan
//     D4), so the reason is the error message, and a vague one wastes the reader's
//     afternoon.
//
//  3. **Budgeted.** Depth, node count and helper count are capped. A recursive type
//     or a 4000-property union should degrade to a named refusal, not hang the build.
//     Exceeding a cap is an `unsupported` node like any other, so a budget overrun
//     stops the build the same way an unmodellable type does; two mechanisms for one
//     outcome would only be two things to keep in sync.
//
// What the checker actually gives us, and what it does not, was measured rather than
// assumed — `typescript@7` is the Go compiler behind a thin marshalling client, and
// several `Type` members that exist in the `.d.ts` come back `undefined` over the
// wire. The comments at each such site say which, and what is done instead.

import type { SqlType } from '@zmdb/schema-core';
import {
  KNOWN_CONSTRAINT_KINDS,
  PROTO_SCALARS,
  RELATION_KINDS,
  SQL_TYPES,
  TAG_NAMES,
  type ColumnIR,
  type Constraints,
  type ExtensionType,
  type ForeignKeyIR,
  type ObjectIR,
  type PropertyIR,
  type ProtoScalar,
  type ReferentialAction,
  type RelationIR,
  type RelationKind,
  type SchemaIR,
  type ShapeColumnIR,
  type ShapeIR,
  type TagField,
  type TableOptions,
  type TypeIR,
} from '@zmdb/schema-core/ir';
import type { Node } from 'typescript/unstable/ast';
import { SignatureKind, SymbolFlags } from 'typescript/unstable/sync';
import type { Checker, IntersectionType, Symbol as TsSymbol, Type, TypeReference } from 'typescript/unstable/sync';

import type { GrpcMethodIR, GrpcServiceIR } from '../protobuf/grpc-ir.js';

export { projectSourceFileNames } from './session.js';
export type { GrpcMethodIR, GrpcServiceIR } from '../protobuf/grpc-ir.js';

// ---------------------------------------------------------------------------
// Diagnostics and limits
// ---------------------------------------------------------------------------

/**
 * A refusal, recorded rather than thrown. `path` is the property chain that reached
 * it (`'email'`, `'profile.address.zip'`) so the message can point somewhere.
 */
export interface ReflectDiagnostic {
  readonly path: string;
  readonly reason: string;
  /** The type as the checker prints it, when that is more use than the path. */
  readonly source?: string;
}

export interface ReflectLimits {
  /** Nesting depth of object/array/union recursion. */
  readonly maxDepth: number;
  /** Total IR nodes produced by one reflector. */
  readonly maxNodes: number;
  /** Distinct named objects, i.e. hoistable helpers in the emitted code. */
  readonly maxHelpers: number;
}

/**
 * Deliberately generous. These are a guard against pathological input, not a style
 * guide: a legitimate 30-deep nested JSON payload is unusual but not wrong, and a
 * cap that fires on real code trains people to raise it rather than to read it.
 */
export const DEFAULT_LIMITS: ReflectLimits = { maxDepth: 32, maxNodes: 20_000, maxHelpers: 512 };

export interface ReflectOptions {
  readonly limits?: Partial<ReflectLimits>;
  /** Resolved from `zmdb.config.ts` by the caller. Absent means identity. */
  readonly naming?: NamingStrategy;
}

export interface NamingStrategy {
  readonly column?: (property: string, context: { readonly table: string }) => string;
  readonly table?: (declared: string) => string;
  readonly index?: (table: string, columns: readonly string[], unique: boolean) => string;
}

// ---------------------------------------------------------------------------
// Tag reading
// ---------------------------------------------------------------------------

/**
 * The checker reports a `unique symbol` property as `__@<name>@<symbolId>`. The id
 * suffix is what makes plan D5 detectable: two installed copies of
 * `@zmdb/schema-core` declare `zmdbSerial` twice, the two are distinct types, and the
 * escaped names differ only in that number.
 */
const TAG_PATTERN = /^__@(\w+?)@?(\d*)$/;
const PHYSICAL_TAG_NAME = 'zmdbPhysical';

/**
 * The tag vocabulary read the other way round: escaped symbol name → IR field.
 *
 * boundary: `TAG_NAMES` is keyed by `TagField`, but `Object.entries` types its keys as
 * `string` — there is no form of it that keeps them. The assertion restores what the
 * declaration of `TAG_NAMES` already says, and if a key were ever added that is not a
 * `TagField`, `TAG_NAMES`' own type annotation is where that fails, not here.
 */
const TAG_FIELD_BY_NAME: ReadonlyMap<string, TagField> = new Map(
  Object.entries(TAG_NAMES).map(([field, symbolName]) => [symbolName, field as TagField]),
);

interface RecognizedTag {
  readonly name: string;
  /** Present only for a unique-symbol tag, where duplicate installs have distinct ids. */
  readonly identity?: string;
}

/**
 * Normalise both tag encodings without importing the type-only vocabulary.
 *
 * Most tags are unique-symbol properties (`__@zmdbSerial@1`). `Ext` is the single
 * structural marker frozen by the IR contract, and the exact `__zmdbExt` spelling is
 * recognised as the same `zmdbExt` vocabulary entry.
 */
function recognizedTag(symbol: TsSymbol): RecognizedTag | undefined {
  const match = TAG_PATTERN.exec(symbol.escapedName);
  const uniqueName = match?.[1];
  if (uniqueName === PHYSICAL_TAG_NAME) {
    return { name: uniqueName, identity: symbol.escapedName };
  }
  if (uniqueName !== undefined && TAG_FIELD_BY_NAME.has(uniqueName)) {
    return { name: uniqueName, identity: symbol.escapedName };
  }
  // `Ext` contributes an optional structural property. A required application
  // column with the same spelling is ordinary data and must not disappear.
  if (symbol.name === `__${TAG_NAMES.extension}` && (symbol.flags & SymbolFlags.Optional) !== 0) {
    return { name: TAG_NAMES.extension };
  }
  return undefined;
}

// Both vocabularies as sets, behind predicates rather than `has` plus a cast. The tags fix
// each of these to a literal, but the checker hands them back as `string`, so this is the
// one place the narrowing has to be earned — and a predicate earns it for every caller.
const SQL_TYPE_SET: ReadonlySet<string> = new Set<string>(SQL_TYPES);
const RELATION_KIND_SET: ReadonlySet<string> = new Set<string>(RELATION_KINDS);
const PROTO_SCALAR_SET: ReadonlySet<string> = new Set<string>(PROTO_SCALARS);
const REFERENTIAL_ACTION_SET: ReadonlySet<string> = new Set<string>([
  'cascade',
  'restrict',
  'set null',
  'set default',
  'no action',
]);
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isSqlType(value: string): value is SqlType {
  return SQL_TYPE_SET.has(value);
}

function isRelationKind(value: string): value is RelationKind {
  return RELATION_KIND_SET.has(value);
}

function isProtoScalar(value: string): value is ProtoScalar {
  return PROTO_SCALAR_SET.has(value);
}

function isReferentialAction(value: string): value is ReferentialAction {
  return REFERENTIAL_ACTION_SET.has(value);
}

/**
 * A {@link Constraints} under construction.
 *
 * `Constraints` is readonly, and the two places that build one fill it in field by field —
 * one keyword at a time from the tags, and then `Length<N>`'s implied maximum. Naming the
 * mutable form is what lets the finished object be returned as a `Constraints` without an
 * assertion, and it was previously spelled out three times.
 */
type MutableConstraints = { -readonly [K in keyof Constraints]: Constraints[K] };

/** Whether a property symbol is one of our tag slots rather than real data. */
function isTagProperty(symbol: TsSymbol): boolean {
  return recognizedTag(symbol) !== undefined;
}

/**
 * Whether a property is a phantom slot — keyed by a `unique symbol` — rather than data.
 * A superset of `isTagProperty`: it also covers brands from
 * `aot-validator/src/advanced`, `io-ts`-style nominal markers, and anyone else's
 * phantom parameter.
 *
 * Treating those as data rather than as phantom is what made `Brand<number, 'UserId'>`
 * refuse: the brand object looked like a second data part of the intersection. And a
 * symbol-keyed property is never data in a checked position anyway — it cannot cross a
 * JSON boundary, so there is nothing to check and nothing lost by ignoring it.
 */
function isPhantomProperty(symbol: TsSymbol): boolean {
  return isTagProperty(symbol) || symbol.escapedName.startsWith('__@');
}

const OPTIONAL = SymbolFlags.Optional;

// ---------------------------------------------------------------------------
// Reflector
// ---------------------------------------------------------------------------

/** A property type taken apart: `(string & Min<3>) | null` → nullable, `[string & Min<3>]`. */
interface NullableSplit {
  readonly nullable: boolean;
  readonly optional: boolean;
  readonly rest: readonly Type[];
}

interface Frame {
  readonly id: number;
  /** Assigned lazily: an anonymous type only needs a name if a cycle refers to it. */
  name: string | undefined;
  referenced: boolean;
}

/**
 * One reflector per file, not per type: the budget, the helper names and the
 * duplicate-tag detector are all whole-program facts, and splitting them per type
 * would let a 200-type file blow past every cap one type at a time.
 */
export class Reflector {
  readonly diagnostics: ReflectDiagnostic[] = [];

  readonly #checker: Checker;
  readonly #location: Node;
  readonly #limits: ReflectLimits;
  readonly #naming: NamingStrategy;

  #nodes = 0;
  /** Types currently being walked, innermost last. The cycle guard. */
  readonly #stack: Frame[] = [];
  /** Name → the type id that claimed it, so two `User`s do not share a helper. */
  readonly #names = new Map<string, number>();
  #anonymous = 0;
  /** Tag basename → the full escaped name first seen for it. Plan D5. */
  readonly #tagIdentity = new Map<string, string>();

  constructor(checker: Checker, location: Node, options: ReflectOptions = {}) {
    this.#checker = checker;
    this.#location = location;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.#naming = options.naming ?? {};
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /** The structural IR of a type. Total: always returns a node. */
  typeIR(type: Type, path = ''): TypeIR {
    return this.#type(type, path, 0);
  }

  /**
   * The structural IR of a protobuf message, with field-number validation enabled.
   *
   * Ordinary validators may reflect an object whose properties have no protobuf
   * numbers; only a protobuf call makes complete numbering mandatory. Keeping that
   * decision here means every protobuf back-end receives the same checked IR.
   */
  protobufIR(type: Type): TypeIR {
    const name = typeName(type) ?? 'message';
    const node = this.#type(type, name, 0);
    this.#validateProtoNumbers(node, name, new Set<ObjectIR>());
    return node;
  }

  /**
   * Reflect a gRPC service while keeping every message on the protobuf path.
   *
   * The service shell is not a protobuf message: its properties are methods,
   * and each method owns two message roots. Reflecting those roots here keeps
   * field-number validation and every downstream codec on the one TypeIR walk.
   */
  grpcServiceIR(type: Type): GrpcServiceIR {
    const methods: GrpcMethodIR[] = [];
    for (const methodSymbol of this.#checker.getPropertiesOfType(type)) {
      if (isTagProperty(methodSymbol)) continue;
      const method = methodSymbol.name;
      const methodType = this.#typeOf(methodSymbol);
      if (methodType === undefined) {
        this.#refuse(method, 'the checker did not resolve a type for this gRPC method');
        continue;
      }

      const requestType = this.#grpcMember(methodType, method, 'request');
      const responseType = this.#grpcMember(methodType, method, 'response');
      if (requestType === undefined || responseType === undefined) continue;

      const requestName = typeName(requestType) ?? `${pascalIdentifier(method)}Request`;
      const responseName = typeName(responseType) ?? `${pascalIdentifier(method)}Response`;
      const request = this.#type(requestType, requestName, 0);
      const response = this.#type(responseType, responseName, 0);
      this.#validateProtoNumbers(request, requestName, new Set<ObjectIR>());
      this.#validateProtoNumbers(response, responseName, new Set<ObjectIR>());

      methods.push({
        name: method,
        request,
        requestName,
        response,
        responseName,
        requestStream: this.#grpcStreamFlag(methodType, method, 'requestStream'),
        responseStream: this.#grpcStreamFlag(methodType, method, 'responseStream'),
      });
    }
    if (methods.length === 0) {
      this.#refuse(typeName(type) ?? 'service', 'a gRPC service must declare at least one method');
    }
    return { methods };
  }

  /**
   * The schema IR of a *tagged entity* type: the only way a table's IR is produced.
   *
   * There used to be a second producer that read the same document back out of a builder
   * value, and for the length of the migration the two had to agree node for node. Now this
   * is it, so every SQL snapshot, DDL golden and JSON Schema contract in the repository is
   * downstream of what this returns (REQ-TF-7, REQ-TF-12). `reflect.spec.ts` writes out the
   * answer for the two-table corpus, which is what stands in for that differential.
   */
  schemaIR(type: Type, fallbackTable?: string): SchemaIR {
    const tags = this.#readTags(type);
    const table = literalOf(this.#nonNullable(tags.get('table')));

    const name = typeName(type);
    const tableName = typeof table === 'string' ? table : (fallbackTable ?? name ?? 'unknown');
    const explicitPhysicalTable = this.#physicalNameOf(type);
    const physicalTable =
      explicitPhysicalTable ?? (this.#naming.table === undefined ? tableName : this.#naming.table(tableName));
    if (typeof table !== 'string') {
      this.#refuse(name ?? 'entity', "no Table<'name'> tag; the table name cannot be guessed from the type name");
    }

    const columns: ColumnIR[] = [];
    const relations: RelationIR[] = [];

    for (const symbol of this.#checker.getPropertiesOfType(type)) {
      if (isTagProperty(symbol)) continue;
      const property = symbol.name;
      const propertyType = this.#typeOf(symbol);
      if (!propertyType) {
        this.#refuse(property, 'the checker did not resolve a type for this property');
        continue;
      }

      // Nullability is TypeScript's job, not a tag's (REQ-TF-2). Splitting it off
      // first is not cosmetic: `getPropertiesOfType` on `(string & Min<3>) | null`
      // returns NOTHING, because a union only has the properties every member has and
      // `null` has none. Reading tags off the whole property type would therefore find
      // none, and the column would come back untagged and unconstrained.
      const split = this.#splitNullable(propertyType);
      const propertyTags = this.#mergeTags(split.rest);

      const relation = this.#relationOf(property, propertyTags);
      if (relation) {
        relations.push(relation);
        continue;
      }
      columns.push(this.#column(property, split, propertyTags, tableName));
    }

    const fts = literalOf(this.#nonNullable(tags.get('ftsTable')));
    const shardKey = this.#tableColumnList('ShardKey', tags.get('shardKey'));
    const sortKey = this.#tableColumnList('SortKey', tags.get('sortKey'));
    const rowstore = tags.has('rowstore');
    const softDeleteTag = this.#nonNullable(tags.get('softDelete'));
    const softDeleteName = literalOf(softDeleteTag);
    const primaryKey = columns.filter(c => c.primaryKey).map(c => c.name);
    if (primaryKey.length > 1) {
      const serialKey = columns.find(column => column.primaryKey && column.serial);
      if (serialKey) {
        this.#refuse(
          tableName,
          `${tableName}.${serialKey.name}: a \`Serial\` column cannot be part of a composite primary key ` +
            `(key is (${primaryKey.join(', ')})); give the table a single-column surrogate key or drop \`Serial\``,
        );
      }
    }
    const foreignKeys = this.#foreignKeysOf(tableName, tags, columns);
    const columnNames = new Set(columns.map(column => column.name));
    for (const [label, names] of [
      ['ShardKey', shardKey],
      ['SortKey', sortKey],
    ] as const) {
      for (const column of names ?? []) {
        if (!columnNames.has(column)) {
          this.#refuse(tableName, `${label} names unknown column "${column}" on "${tableName}"`);
        }
      }
    }
    const physicalColumns = new Map<string, string>();
    for (const column of columns) {
      const previous = physicalColumns.get(column.physicalName);
      if (previous === undefined) {
        physicalColumns.set(column.physicalName, column.name);
        continue;
      }
      this.#refuse(
        tableName,
        `\`${previous}\` and \`${column.name}\` both map to the column \`${column.physicalName}\`; ` +
          "rename one property or give one an explicit Physical<'…'>",
      );
    }

    // A table with no primary key is refused rather than accepted with an empty one. This is
    // the one rule `defineSchema` enforced that has no other home: it threw a `SchemaError`,
    // synchronously, on a column map with no `primaryKey()` in it. The reason outlives the
    // function — `findById`, `update` and `delete` all build their `WHERE` out of
    // `primaryKey`, so an empty one compiles a statement with no conditions. `delete(1)` on a
    // key-less table is `DELETE FROM users`.
    if (typeof table === 'string' && primaryKey.length === 0) {
      this.#refuse(
        tableName,
        'no PrimaryKey column. Every table needs one: findById, update and delete build their ' +
          'WHERE clause from it, and an empty key compiles to a statement with no conditions.',
      );
    }

    const tableOptions: TableOptions | undefined =
      shardKey === undefined && sortKey === undefined && !rowstore
        ? undefined
        : {
            ...(shardKey === undefined ? {} : { shardKey }),
            ...(sortKey === undefined ? {} : { sortKey }),
            ...(rowstore ? { rowstore: true } : {}),
          };
    let softDelete: SchemaIR['softDelete'];
    if (softDeleteTag !== undefined) {
      if (typeof softDeleteName !== 'string') {
        this.#refuse(tableName, "SoftDelete<'column'> needs a string literal column name");
      } else {
        const column = columns.find(candidate => candidate.name === softDeleteName);
        if (column === undefined) {
          this.#refuse(tableName, `SoftDelete<'${softDeleteName}'> names a column that does not exist on ${tableName}`);
        } else {
          if (!column.nullable) {
            this.#refuse(
              tableName,
              `${tableName}: SoftDelete<'${softDeleteName}'> names a non-nullable column; ` +
                'a soft-delete column must be nullable because IS NULL is what "live" means',
            );
          }
          if (column.sql !== 'timestamp') {
            this.#refuse(
              tableName,
              `${tableName}: SoftDelete<'${softDeleteName}'> names a ${String(column.sql)} column; ` +
                "a soft-delete column must use Sql<'timestamp'>",
            );
          }
          if (column.nullable && column.sql === 'timestamp') softDelete = { column: softDeleteName };
        }
      }
    }

    return {
      table: tableName,
      physicalTable,
      columns,
      primaryKey,
      relations,
      foreignKeys,
      ...(typeof fts === 'string' || fts === true ? { ftsTable: fts } : {}),
      ...(tableOptions === undefined ? {} : { tableOptions }),
      ...(softDelete === undefined ? {} : { softDelete }),
    };
  }

  /**
   * The columns of any object type, each with its own optionality — what the JSON
   * Schema back-end consumes (`jsonSchemaFromShape`).
   *
   * `schemaIR` above is for a tagged *entity*: it wants a `Table<'name'>` tag, reads
   * relations, and computes a primary key. A document is generated from something
   * weaker and more general — `CreateDTO<User>`, `ReadDTO<User>`, or a `Pick` of either
   * — and none of those carry a table name, because a mapped type drops the
   * symbol-keyed entity tags along with everything else non-string. Demanding one would
   * make the type-driven `toJsonSchema<T>()` work on exactly one shape per table.
   *
   * The optionality is the type's own, read off the property symbol. That is the whole
   * reason this is not `schemaIR` with a flag: `CreateDTO<User>` has already applied the
   * "a column with a default may be omitted" rule that the `'create'` variant applies by
   * hand, and reading it back off the type is what makes the two paths agree by
   * construction rather than by a rule written twice.
   *
   * Relations are skipped, as they are in `schemaIR`: a join target is not a column and
   * has no place in a column's document. `toJsonSchemaWithRelations` adds `$ref`s on top.
   */
  shapeIR(type: Type): ShapeIR {
    const shape: ShapeColumnIR[] = [];

    for (const symbol of this.#checker.getPropertiesOfType(type)) {
      if (isTagProperty(symbol)) continue;
      const property = symbol.name;
      const propertyType = this.#typeOf(symbol);
      if (!propertyType) {
        this.#refuse(property, 'the checker did not resolve a type for this property');
        continue;
      }

      // Same order as `schemaIR`, and for the same reason: reading tags off
      // `(string & Min<3>) | null` finds none, because a union only has the properties
      // every member has and `null` has none.
      const split = this.#splitNullable(propertyType);
      const propertyTags = this.#mergeTags(split.rest);
      if (this.#relationOf(property, propertyTags)) continue;

      shape.push({
        column: this.#column(property, split, propertyTags),
        optional: (symbol.flags & OPTIONAL) !== 0,
      });
    }

    return shape;
  }

  // -------------------------------------------------------------------------
  // Structural walk
  // -------------------------------------------------------------------------

  #type(type: Type, path: string, depth: number): TypeIR {
    if (depth > this.#limits.maxDepth) {
      return this.#unsupported(path, `nesting deeper than ${this.#limits.maxDepth} levels`);
    }
    if (++this.#nodes > this.#limits.maxNodes) {
      return this.#unsupported(path, `more than ${this.#limits.maxNodes} IR nodes in one file`);
    }

    // A type parameter is not a type yet. Reflecting `T` would produce a check for
    // whatever constraint it happens to have, which is a check for the wrong thing,
    // so it is refused where it is written rather than at the instantiation site.
    if (type.isTypeParameter()) {
      return this.#unsupported(path, 'a generic type parameter has no shape to reflect', this.#print(type));
    }
    if (type.isErrorType()) {
      return this.#unsupported(path, 'the checker could not resolve this type', this.#print(type));
    }

    const intrinsic = this.#intrinsic(type, path);
    if (intrinsic) return intrinsic;

    const literal = this.#literal(type, path);
    if (literal) return literal;

    const template = this.#template(type, path);
    if (template) return template;

    if (type.isUnionType()) return this.#union(type.getTypes(), path, depth);
    if (type.isIntersectionType()) return this.#intersection(type, path, depth);

    return this.#object(type, path, depth, this.#readTags(type));
  }

  /** `string`, `number`, `null`, `never`, … — everything with an `intrinsicName`. */
  #intrinsic(type: Type, path: string): TypeIR | undefined {
    if (!type.isIntrinsicType()) return undefined;
    switch (type.intrinsicName) {
      case 'string':
        return { kind: 'scalar', scalar: 'string' };
      case 'number':
        return { kind: 'scalar', scalar: 'number' };
      case 'boolean':
        return { kind: 'scalar', scalar: 'boolean' };
      case 'bigint':
        return { kind: 'scalar', scalar: 'bigint' };
      case 'null':
        return { kind: 'null' };
      case 'undefined':
      case 'void':
        return { kind: 'undefined' };
      // `any` and `unknown` are refused rather than mapped to `UnknownIR`. That node
      // means "a `json` column whose payload shape was not declared", where accepting
      // anything is the documented contract. In a validated position it would mean a
      // validator that always passes, which is a hole with a green test beside it.
      case 'any':
        return this.#unsupported(path, '`any` disables the check it would have to emit; declare the shape');
      case 'unknown':
        return this.#unsupported(path, '`unknown` has no shape to check; declare the shape or use a `json` payload');
      case 'never':
        return this.#unsupported(path, '`never` has no values, so no check can succeed');
      case 'object':
        return this.#unsupported(path, 'bare `object` has no properties to check; declare them');
      case 'symbol':
        return this.#unsupported(path, 'a symbol cannot cross a JSON boundary');
      default:
        return this.#unsupported(path, `unhandled primitive \`${type.intrinsicName}\``);
    }
  }

  #literal(type: Type, path: string): TypeIR | undefined {
    if (type.isStringLiteralType() || type.isNumberLiteralType() || type.isBooleanLiteralType()) {
      return { kind: 'literal', value: type.value };
    }
    // A bigint literal has no JSON spelling and `LiteralIR.value` deliberately does
    // not admit one — a `bigint` column is a string on the wire (plan D3), and a
    // *literal* bigint would have to pick a side.
    if (type.isBigIntLiteralType()) {
      return this.#unsupported(path, 'a bigint literal type has no wire representation', this.#print(type));
    }
    return undefined;
  }

  /**
   * `` `${string}@${string}` `` → a `string` with a derived `pattern`. Needed for its
   * own sake, and needed because without it a template literal type falls through to
   * `#object`: `string` carries a numeric index signature, so the refusal it would
   * collect is "`Record<string, T>` cannot be modelled", which is true of neither the
   * type nor the problem.
   *
   * Only placeholders with an exact character class are derivable. `Uppercase<string>`
   * is not one, and guessing `[\s\S]*` for it would produce a pattern that accepts
   * strings the type rejects — a validator that is wrong in the permissive direction.
   */
  #template(type: Type, path: string): TypeIR | undefined {
    if (type.isStringMappingType()) {
      return this.#unsupported(
        path,
        'a string-mapping type (`Uppercase`, `Capitalize`, …) has no equivalent pattern; spell the constraint with `Pattern<…>`',
        this.#print(type),
      );
    }
    if (!type.isTemplateLiteralType()) return undefined;

    const spans = type.getTypes();
    const parts: string[] = [];
    for (const [index, text] of type.texts.entries()) {
      parts.push(escapeRegExp(text));
      const span = spans[index];
      if (span === undefined) continue;
      const source = placeholderPattern(span);
      if (source === undefined) {
        return this.#unsupported(
          path,
          `the placeholder \`${this.#print(span)}\` in this template literal type has no equivalent pattern; spell the constraint with \`Pattern<…>\``,
          this.#print(type),
        );
      }
      parts.push(source);
    }
    return { kind: 'scalar', scalar: 'string', constraints: { pattern: `^${parts.join('')}$` } };
  }

  #union(members: readonly Type[], path: string, depth: number): TypeIR {
    // `boolean` is `true | false` in the checker, not an intrinsic. Recognising it
    // here is load-bearing: without it the walk falls through to the object branch
    // and emits a property check for a primitive.
    //
    // The data part, not the member itself: `boolean & Sql<'boolean'>` is normalised by
    // the checker into `(false & Sql<'boolean'>) | (true & Sql<'boolean'>)` — the same
    // distribution that makes `(T | null) & Unique` a trap — so a tagged boolean column
    // arrives here as two *intersections*. Reading through them is what stops a tagged
    // boolean column emitting two literal comparisons where a `typeof` check is meant.
    if (members.length === 2 && members.every(m => this.#dataPart(m).isBooleanLiteralType())) {
      return this.#applyConstraints({ kind: 'scalar', scalar: 'boolean' }, this.#mergeTags(members));
    }
    // The checker sorts `null` and `undefined` to the FRONT of a union. `../ir`'s
    // `withNull` puts them at the back, and the IR has to say one of the two — a union
    // whose member order depends on which producer built it turns every golden into
    // `[null, string]` in one place and `[string, null]` in another.
    const nullish = (m: Type): boolean =>
      m.isIntrinsicType() && (m.intrinsicName === 'null' || m.intrinsicName === 'undefined');
    const ordered = [...members.filter(m => !nullish(m)), ...members.filter(nullish)];
    return { kind: 'union', members: ordered.map(m => this.#type(m, path, depth + 1)) };
  }

  /**
   * `number & Min<18>` is an intersection of one data part and one tag part. The tags
   * were already collected by the caller's `#readTags` over the whole intersection —
   * they are just properties — so this only has to find the part that carries data.
   */
  // Typed `IntersectionType` rather than `Type`: `getTypes()` only exists on the
  // narrowed form, and the `isIntersectionType()` guard at the call site is what
  // establishes it. Widening the parameter here would throw the narrowing away.
  #intersection(type: IntersectionType, path: string, depth: number): TypeIR {
    const tags = this.#readTags(type);
    const parts = type.getTypes().filter(part => !this.#isTagOnly(part));

    if (parts.length === 0) {
      return this.#unsupported(path, 'a tags-only intersection carries no value', this.#print(type));
    }
    const [sole] = parts;
    if (parts.length === 1 && sole !== undefined) {
      return this.#applyConstraints(this.#type(sole, path, depth), tags);
    }
    // Several data parts: only an intersection of object types has a meaning we can
    // check (merge the properties). Anything else — `string & number` — is `never` in
    // practice and a mistake in the declaration.
    if (parts.every(part => this.#isPlainObject(part))) {
      return this.#object(type, path, depth, tags);
    }
    return this.#unsupported(
      path,
      'an intersection of unrelated non-object types cannot be checked',
      this.#print(type),
    );
  }

  #object(type: Type, path: string, depth: number, tags: ReadonlyMap<TagField, Type>): TypeIR {
    const checker = this.#checker;

    // Order matters here, and it is not arbitrary. Arrays and tuples have a numeric
    // index signature, so they must be recognised before the index-signature refusal;
    // `Date` is an interface, so it must be recognised before the property walk.
    if (checker.isArrayType(type)) {
      const element = this.#typeArguments(type)[0];
      if (!element) return this.#unsupported(path, 'an array type with no element type', this.#print(type));
      return this.#applyConstraints({ kind: 'array', element: this.#type(element, `${path}[]`, depth + 1) }, tags);
    }

    if (checker.isTupleType(type)) return this.#tuple(type, path, depth);

    const symbol = type.getSymbol();
    if (symbol?.name === 'Date') return this.#applyConstraints({ kind: 'scalar', scalar: 'date' }, tags);

    // A class instance is refused for a reason that is easy to miss: its *declared*
    // shape is checkable, but a validated value that passes it is a plain object, not
    // an instance, so private state, prototype methods and `instanceof` are all
    // silently absent. Naming the refusal is honest; pretending is not.
    if (symbol && (symbol.flags & SymbolFlags.Class) !== 0) {
      return this.#unsupported(
        path,
        `\`${symbol.name}\` is a class; a checked value is a plain object, not an instance`,
      );
    }

    if (checker.getSignaturesOfType(type, SignatureKind.Call).length > 0) {
      return this.#unsupported(path, 'a function cannot be validated or serialised', this.#print(type));
    }
    if (checker.getSignaturesOfType(type, SignatureKind.Construct).length > 0) {
      return this.#unsupported(path, 'a constructor cannot be validated or serialised', this.#print(type));
    }

    if (this.#hasIndexSignature(type)) {
      // Measured, not assumed: `getPropertiesOfType` does not surface index
      // signatures at all, and `getIndexInfosOfType` returns entries whose `keyType`
      // the client fails to marshal. So an index signature is *detectable* but not
      // *readable*, and a `Record<string, T>` would otherwise reflect as an object
      // with zero properties — a validator that accepts `{}` and everything else.
      return this.#unsupported(
        path,
        'an index signature is not readable through the checker API, so `Record<string, T>` cannot be modelled',
        this.#print(type),
      );
    }

    const properties = checker
      .getPropertiesOfType(type)
      .filter(s => !isPhantomProperty(s))
      .map(member => ({ member, type: this.#typeOf(member) }));
    if (properties.length === 0) {
      return this.#unsupported(path, 'an object type with no properties admits every object', this.#print(type));
    }

    // A method makes this a behavioural type rather than a data type, and refusing it
    // here — naming the type — is what rules out `Map`, `Set`, `Promise`, a typed array
    // and any class with a prototype method. One rule instead of a list of special
    // cases, and the message points at the property that gave it away.
    const method = properties.find(
      p => p.type !== undefined && checker.getSignaturesOfType(p.type, SignatureKind.Call).length > 0,
    );
    if (method) {
      return this.#unsupported(
        path,
        `\`${this.#print(type)}\` has a method (\`${method.member.name}\`); only data types can be checked`,
      );
    }

    const cycle = this.#stack.find(frame => frame.id === type.id);
    if (cycle) {
      cycle.referenced = true;
      cycle.name ??= this.#claimName(`Anonymous${++this.#anonymous}`, type.id);
      return { kind: 'ref', name: cycle.name };
    }

    const declared = typeName(type);
    const frame: Frame = {
      id: type.id,
      name: declared === undefined ? undefined : this.#claimName(declared, type.id),
      referenced: false,
    };
    this.#stack.push(frame);

    const members: PropertyIR[] = [];
    for (const { member, type: propertyType } of properties) {
      const childPath = path === '' ? member.name : `${path}.${member.name}`;
      const propertyTags =
        propertyType === undefined
          ? new Map<TagField, Type>()
          : this.#mergeTags(this.#splitNullable(propertyType).rest);
      const protoFieldType = this.#nonNullable(propertyTags.get('protoField'));
      const protoField = numberOf(protoFieldType);
      if (protoFieldType !== undefined && protoField === undefined) {
        this.#refuse(childPath, 'ProtoField<N> needs a number literal argument', this.#print(protoFieldType));
      }
      members.push({
        name: member.name,
        type: propertyType
          ? this.#type(propertyType, childPath, depth + 1)
          : this.#unsupported(childPath, 'the checker did not resolve a type for this property'),
        // An optional property's type does NOT carry `| undefined` here, even under
        // `exactOptionalPropertyTypes` — the checker reports `nickname?: string` as
        // `string`. So `optional` is the only record of absence being allowed, and an
        // emitter that ignores it produces a validator that rejects every value the
        // type accepts.
        optional: (member.flags & OPTIONAL) !== 0,
        // `readonly` is not marshalled onto the symbol, and it is not a runtime
        // distinction anyway: it constrains writes, and validation reads. Recorded as
        // `false` rather than guessed at.
        readonly: false,
        ...(protoField === undefined ? {} : { protoField }),
      });
    }

    this.#stack.pop();

    if (frame.name !== undefined && this.#names.size > this.#limits.maxHelpers) {
      return this.#unsupported(path, `more than ${this.#limits.maxHelpers} named object types in one file`);
    }

    return { kind: 'object', ...(frame.name === undefined ? {} : { name: frame.name }), properties: members };
  }

  #tuple(type: Type, path: string, depth: number): TypeIR {
    // `TupleType.elementFlags` is in the `.d.ts` but comes back `undefined` over the
    // client, so optional and rest elements are not distinguishable structurally.
    // They ARE visible in the printed form, and refusing on that is better than
    // emitting a fixed-length check for a variadic tuple.
    const printed = this.#print(type);
    if (/[?.]/.test(printed.slice(printed.indexOf('[')))) {
      return this.#unsupported(path, 'a tuple with optional or rest elements is not modelled', printed);
    }
    const elements = this.#typeArguments(type);
    return { kind: 'tuple', elements: elements.map((el, i) => this.#type(el, `${path}[${i}]`, depth + 1)) };
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  /**
   * Every tag slot on a type, keyed by the IR field it sets. Reads the whole type
   * rather than an intersection part, because a tag *is* a property and the checker
   * already merged them.
   */
  #readTags(type: Type): ReadonlyMap<TagField, Type> {
    const found = new Map<TagField, Type>();
    for (const symbol of this.#checker.getPropertiesOfType(type)) {
      const tag = recognizedTag(symbol);
      if (tag === undefined) continue;
      this.#rememberTagIdentity(symbol, tag);

      const field = TAG_FIELD_BY_NAME.get(tag.name);
      if (field === undefined) continue;
      const value = this.#typeOf(symbol);
      if (value) found.set(field, value);
    }
    return found;
  }

  /** The internal frozen `Physical<Name>` tag, until its public surface lands with config wiring. */
  #physicalNameOf(type: Type): string | undefined {
    for (const symbol of this.#checker.getPropertiesOfType(type)) {
      const tag = recognizedTag(symbol);
      if (tag?.name !== PHYSICAL_TAG_NAME) continue;
      this.#rememberTagIdentity(symbol, tag);
      const value = this.#typeOf(symbol);
      const physical = value === undefined ? undefined : literalOf(this.#nonNullable(value));
      if (typeof physical === 'string') return physical;
      this.#refuse(symbol.name, 'Physical<Name> needs a string literal argument');
    }
    return undefined;
  }

  #physicalNameFrom(members: readonly Type[]): string | undefined {
    let physical: string | undefined;
    for (const member of members) physical = this.#physicalNameOf(member) ?? physical;
    return physical;
  }

  #rememberTagIdentity(symbol: TsSymbol, tag: RecognizedTag): void {
    if (tag.identity === undefined) return;
    const first = this.#tagIdentity.get(tag.name);
    if (first === undefined) {
      this.#tagIdentity.set(tag.name, tag.identity);
      return;
    }
    if (first === tag.identity) return;
    this.#refuse(
      symbol.name,
      `the tag \`${tag.name}\` resolves to two different declarations (\`${first}\` and \`${tag.identity}\`), ` +
        'which means two copies of @zmdb/schema-core are installed; deduplicate them',
    );
  }

  /** Union members, minus `null` and `undefined`, plus whether either was there. */
  #splitNullable(type: Type): NullableSplit {
    const members = type.isUnionType() ? type.getTypes() : [type];
    const isNullish = (m: Type): boolean =>
      m.isIntrinsicType() && (m.intrinsicName === 'null' || m.intrinsicName === 'undefined');
    return {
      nullable: members.some(m => m.isIntrinsicType() && m.intrinsicName === 'null'),
      optional: members.some(m => m.isIntrinsicType() && m.intrinsicName === 'undefined'),
      rest: members.filter(m => !isNullish(m)),
    };
  }

  /** Tags from every member of a union. A tag on one arm is a tag on the column. */
  #mergeTags(members: readonly Type[]): ReadonlyMap<TagField, Type> {
    const [only] = members;
    if (members.length === 1 && only !== undefined) return this.#readTags(only);
    const merged = new Map<TagField, Type>();
    for (const member of members) for (const [field, value] of this.#readTags(member)) merged.set(field, value);
    return merged;
  }

  /** `string & Length<64>` → `string`. A type with no tag parts is its own data part. */
  #dataPart(type: Type): Type {
    // Written as a positive branch rather than an early return on the negation: the
    // `this is IntersectionType` predicate does not survive `if (!…) return`, and
    // without it `getTypes()` is not in scope.
    if (type.isIntersectionType()) {
      const parts = type.getTypes().filter(part => !this.#isTagOnly(part));
      const [sole] = parts;
      return parts.length === 1 && sole !== undefined ? sole : type;
    }
    return type;
  }

  /**
   * A type whose every property is a phantom slot: `Min<18>`, `Serial`, `Table<'t'>`,
   * and equally `{ readonly [__brand]: 'UserId' }`. Deliberately not restricted to
   * *our* tags — see `isPhantomProperty`.
   */
  #isTagOnly(type: Type): boolean {
    const properties = this.#checker.getPropertiesOfType(type);
    return properties.length > 0 && properties.every(isPhantomProperty);
  }

  #isPlainObject(type: Type): boolean {
    return (
      type.isObjectType() &&
      !this.#checker.isArrayType(type) &&
      !this.#checker.isTupleType(type) &&
      this.#checker.getSignaturesOfType(type, SignatureKind.Call).length === 0
    );
  }

  /** Fold `Min`/`Max`/`MinLength`/`MaxLength`/`Pattern` into a scalar or array node. */
  #applyConstraints(node: TypeIR, tags: ReadonlyMap<TagField, Type>): TypeIR {
    if (node.kind !== 'scalar' && node.kind !== 'array') return node;

    // The node may already carry constraints its *structure* implied — a template
    // literal type derives a `pattern`. Tags win per keyword, so an explicit
    // `Pattern<…>` overrides the derived one, but a `MinLength<3>` beside a template
    // literal type does not silently erase it.
    const constraints = { ...node.constraints, ...this.#constraintsFromTags(tags) };

    // `Sql<'integer'>` on a `number` narrows the scalar: the emitter's integrality
    // check comes from the SQL type, never from a `Min<1>` that happens to be there.
    let scalar = node.kind === 'scalar' ? node.scalar : undefined;
    const sql = this.#sqlOf(tags);
    if (scalar === 'number' && (sql === 'integer' || sql === 'serial')) scalar = 'integer';

    // `Length<N>` is `varchar(N)`; it is also a maximum, and the explicit
    // `MaxLength<N>` wins when both are present.
    const length = numberOf(this.#nonNullable(tags.get('length')));
    if (length !== undefined && constraints.maxLength === undefined) constraints.maxLength = length;

    if (node.kind === 'array') {
      return Object.keys(constraints).length === 0 ? node : { ...node, constraints };
    }
    const proto = this.#protoScalarOf(tags);
    return {
      ...node,
      ...(scalar === undefined ? {} : { scalar }),
      ...(proto === undefined ? {} : { proto }),
      ...(Object.keys(constraints).length === 0 ? {} : { constraints }),
    };
  }

  #constraintsFromTags(tags: ReadonlyMap<TagField, Type>): MutableConstraints {
    const out: MutableConstraints = {};
    for (const kind of KNOWN_CONSTRAINT_KINDS) {
      const value = this.#nonNullable(tags.get(kind));
      if (!value) continue;
      if (kind === 'pattern') {
        const pattern = literalOf(value);
        if (typeof pattern === 'string') out.pattern = pattern;
        else this.#refuse(kind, 'Pattern<S> needs a string literal argument', this.#print(value));
        continue;
      }
      const bound = numberOf(value);
      if (bound !== undefined) out[kind] = bound;
      else this.#refuse(kind, `${kind} needs a number literal argument`, this.#print(value));
    }
    return out;
  }

  #sqlOf(tags: ReadonlyMap<TagField, Type>): SqlType | undefined {
    const declared = literalOf(this.#nonNullable(tags.get('sql')));
    if (typeof declared !== 'string') return undefined;
    if (!isSqlType(declared)) {
      this.#refuse('sql', `\`${declared}\` is not a SQL type; expected one of ${SQL_TYPES.join(', ')}`);
      return undefined;
    }
    return declared;
  }

  #extensionOf(property: string, tags: ReadonlyMap<TagField, Type>): ExtensionType | undefined {
    const spec = this.#nonNullable(tags.get('extension'));
    if (spec === undefined) return undefined;
    if (!this.#checker.isTupleType(spec)) {
      this.#refuse(property, 'Ext<E, N, A> needs an extension name, type name and argument tuple', this.#print(spec));
      return undefined;
    }

    const [extensionType, nameType, argsType] = this.#typeArguments(spec);
    const extension = literalOf(extensionType);
    const name = literalOf(nameType);
    if (typeof extension !== 'string' || typeof name !== 'string' || argsType === undefined) {
      this.#refuse(
        property,
        'Ext<E, N, A> needs literal extension and type names plus an argument tuple',
        this.#print(spec),
      );
      return undefined;
    }
    if (!SQL_IDENTIFIER.test(name)) {
      this.#refuse(property, `extension type name \`${name}\` is not a SQL identifier`, name);
      return undefined;
    }
    if (!this.#checker.isTupleType(argsType)) {
      this.#refuse(
        property,
        'Ext<E, N, A> arguments must be a tuple of string or number literals',
        this.#print(argsType),
      );
      return undefined;
    }

    const args: (string | number)[] = [];
    for (const argumentType of this.#typeArguments(argsType)) {
      const argument = literalOf(argumentType);
      if (typeof argument === 'number' && Number.isFinite(argument)) {
        args.push(argument);
        continue;
      }
      if (typeof argument === 'string' && SQL_IDENTIFIER.test(argument)) {
        args.push(argument);
        continue;
      }
      this.#refuse(
        property,
        'extension type arguments must be finite number literals or SQL identifiers',
        this.#print(argumentType),
      );
      return undefined;
    }

    return { extension, name, ...(args.length === 0 ? {} : { args }) };
  }

  #protoScalarOf(tags: ReadonlyMap<TagField, Type>): ProtoScalar | undefined {
    const tagged = this.#nonNullable(tags.get('protoScalar'));
    const declared = literalOf(tagged);
    if (declared === undefined) return undefined;
    if (typeof declared === 'string' && isProtoScalar(declared)) return declared;
    this.#refuse(
      'protoScalar',
      `Proto<K> needs one protobuf scalar literal; expected one of ${PROTO_SCALARS.join(', ')}`,
      tagged === undefined ? undefined : this.#print(tagged),
    );
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Protobuf field numbering
  // -------------------------------------------------------------------------

  #validateProtoNumbers(node: TypeIR, path: string, seen: Set<ObjectIR>): void {
    switch (node.kind) {
      case 'object': {
        if (seen.has(node)) return;
        seen.add(node);
        const message = node.name ?? path;
        const numbered = new Map<number, PropertyIR[]>();

        for (const property of node.properties) {
          const propertyPath = `${message}.${property.name}`;
          const number = property.protoField;
          if (number === undefined) {
            this.#refuse(
              propertyPath,
              `protobuf message \`${message}\` property \`${property.name}\` has no ProtoField<N> field number`,
            );
          } else if (!Number.isInteger(number) || number < 1 || number > 536_870_911) {
            this.#refuse(
              propertyPath,
              `protobuf field number ${number} on \`${message}.${property.name}\` is outside the valid range 1 … 536870911`,
            );
          } else if (number >= 19_000 && number <= 19_999) {
            this.#refuse(
              propertyPath,
              `protobuf field number ${number} on \`${message}.${property.name}\` is in the reserved range 19000 … 19999`,
            );
          } else {
            const group = numbered.get(number);
            if (group) group.push(property);
            else numbered.set(number, [property]);
          }
          this.#validateProtoNumbers(property.type, propertyPath, seen);
        }

        for (const [number, properties] of numbered) {
          if (properties.length < 2) continue;
          const names = properties.map(property => `\`${property.name}\``).join(', ');
          for (const property of properties) {
            this.#refuse(
              `${message}.${property.name}`,
              `protobuf field number ${number} is duplicated by properties ${names} in message \`${message}\``,
            );
          }
        }
        return;
      }
      case 'array':
        this.#validateProtoNumbers(node.element, `${path}[]`, seen);
        return;
      case 'tuple':
        for (const [index, element] of node.elements.entries()) {
          this.#validateProtoNumbers(element, `${path}[${index}]`, seen);
        }
        return;
      case 'union':
        for (const member of node.members) this.#validateProtoNumbers(member, path, seen);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Columns and relations
  // -------------------------------------------------------------------------

  #relationOf(property: string, tags: ReadonlyMap<TagField, Type>): RelationIR | undefined {
    const spec = this.#nonNullable(tags.get('relation'));
    if (!spec) return undefined;

    const read = (name: string): unknown => {
      const symbol = this.#checker.getPropertyOfType(spec, name);
      if (!symbol) return undefined;
      const type = this.#typeOf(symbol);
      return type ? literalOf(type) : undefined;
    };
    const kind = read('kind');
    const target = read('target');
    // `manyToMany` carries a join table, the other three carry a foreign key. One IR
    // field (`via`) covers both, because every back-end wants "the thing that joins".
    const via = read('fk') ?? read('through');

    if (typeof kind !== 'string' || typeof target !== 'string' || typeof via !== 'string') {
      this.#refuse(property, 'a relation tag needs literal target and foreign-key arguments', this.#print(spec));
      return undefined;
    }
    // Each of the four tags fixes `kind` to a literal, so reaching this refusal means a
    // hand-written `[zmdbRelation]` payload. Checked anyway, for the reason `#sqlOf` checks:
    // an unrecognised cardinality would otherwise reach the SQL back-ends as one, and be
    // read there as whichever branch fell through.
    if (!isRelationKind(kind)) {
      this.#refuse(property, `\`${kind}\` is not a relation kind; expected one of ${RELATION_KINDS.join(', ')}`);
      return undefined;
    }
    return { name: property, relation: kind, target, via };
  }

  #foreignKeysOf(
    table: string,
    tags: ReadonlyMap<TagField, Type>,
    columns: readonly ColumnIR[],
  ): readonly ForeignKeyIR[] {
    const spec = this.#nonNullable(tags.get('foreignKeys'));
    if (!spec) return [];

    const read = (name: string): unknown => {
      const symbol = this.#checker.getPropertyOfType(spec, name);
      if (!symbol) return undefined;
      const type = this.#typeOf(symbol);
      return type ? literalOf(type) : undefined;
    };
    const local = read('columns');
    const targetTable = read('targetTable');
    const target = read('targetColumns');
    if (typeof local !== 'string' || typeof targetTable !== 'string' || typeof target !== 'string') {
      this.#refuse(
        table,
        'ForeignKey<LocalColumns, TargetTable, TargetColumns> needs three string-literal arguments',
        this.#print(spec),
      );
      return [];
    }

    const split = (value: string): readonly string[] => value.split(',').map(column => column.trim());
    const localColumns = split(local);
    const targetColumns = split(target);
    if (
      localColumns.length !== targetColumns.length ||
      localColumns.some(column => column.length === 0) ||
      targetColumns.some(column => column.length === 0)
    ) {
      this.#refuse(
        table,
        `ForeignKey declares ${localColumns.length} local ${localColumns.length === 1 ? 'column' : 'columns'} ` +
          `and ${targetColumns.length} target ${targetColumns.length === 1 ? 'column' : 'columns'}; ` +
          'the lists must be positionally paired and have equal lengths',
      );
      return [];
    }

    const declared = new Set(columns.map(column => column.name));
    const missing = localColumns.filter(column => !declared.has(column));
    if (missing.length > 0) {
      this.#refuse(
        table,
        `ForeignKey names ${missing.map(column => `\`${column}\``).join(', ')}, ` +
          `${missing.length === 1 ? 'which is not a column' : 'which are not columns'} on \`${table}\``,
      );
      return [];
    }

    return [{ columns: localColumns, targetTable, targetColumns }];
  }

  #referentialAction(
    property: string,
    tag: 'OnDelete' | 'OnUpdate',
    declared: Type | undefined,
  ): ReferentialAction | undefined {
    const spec = this.#nonNullable(declared);
    if (!spec) return undefined;
    const value = literalOf(spec);
    if (typeof value === 'string' && isReferentialAction(value)) return value;
    this.#refuse(
      property,
      `${tag}<Action> needs one of ${[...REFERENTIAL_ACTION_SET].map(action => `'${action}'`).join(', ')}`,
      this.#print(spec),
    );
    return undefined;
  }

  #column(property: string, split: NullableSplit, tags: ReadonlyMap<TagField, Type>, declaredTable?: string): ColumnIR {
    const { nullable, rest } = split;
    const explicitPhysicalName = this.#physicalNameFrom(rest);
    const physicalName =
      explicitPhysicalName ??
      (declaredTable === undefined || this.#naming.column === undefined
        ? property
        : this.#naming.column(property, { table: declaredTable }));

    // `('admin' | 'viewer') & Sql<'jsonEnum'>` does not stay written that way: an
    // intersection containing a union normalises to a union of intersections, so each
    // member arrives with the tag attached. Stripping the tag parts is what makes the
    // literal union visible again.
    const data = rest.map(member => this.#dataPart(member));

    // A column whose data part is nothing but tags. Worth its own message because the
    // way a reader gets here is not by writing `Sql<'json'>` on its own — it is by
    // writing `unknown & Sql<'json'>` and not knowing that `unknown & X` *is* `X`, so
    // the type they think they declared is gone before the reflection ever sees it.
    const [first] = data;
    if (first !== undefined && data.every(member => this.#isTagOnly(member))) {
      this.#refuse(
        property,
        "the tags carry no type: `unknown & X` collapses to `X` — an unshaped JSON payload is `object & Sql<'json'>`",
        this.#print(first),
      );
    }

    const enumValues = literalUnion(data);
    const declaredSql = this.#sqlOf(tags);
    const extension = this.#extensionOf(property, tags);
    if (declaredSql !== undefined && extension !== undefined) {
      this.#refuse(property, 'a column cannot carry both Sql<…> and Ext<…>; choose one database type');
    }
    const constraints = this.#constraintsFromTags(tags);
    const length = numberOf(this.#nonNullable(tags.get('length')));
    const precision = this.#precisionOf(tags);
    const references = literalOf(this.#nonNullable(tags.get('references')));
    const onDelete = this.#referentialAction(property, 'OnDelete', tags.get('onDelete'));
    const onUpdate = this.#referentialAction(property, 'OnUpdate', tags.get('onUpdate'));
    const codec = literalOf(this.#nonNullable(tags.get('codec')));
    const wire = this.#nonNullable(tags.get('wire'));

    // `Serial` implies a database default. Not an inference for convenience: a generated
    // column *does* have one, and `hasDefault` is what keeps it out of `CreateDTO` — so a
    // `Serial` that only set `serial` would demand the key the database is about to make.
    const serial = tags.has('serial');
    const hasDefault = serial || tags.has('hasDefault');
    if (serial && extension !== undefined) {
      this.#refuse(property, 'Serial cannot be combined with an extension-backed column type');
    }
    for (const [tag, action] of [
      ['OnDelete', onDelete],
      ['OnUpdate', onUpdate],
    ] as const) {
      if (action === 'set null' && !nullable) {
        this.#refuse(
          property,
          `${tag}<'set null'> on a NOT NULL column; a referential action would have to write NULL into ` +
            "a column that forbids it — make the column nullable, or use 'cascade' or 'restrict'",
        );
      }
      if (action === 'set default' && !hasDefault) {
        this.#refuse(
          property,
          `${tag}<'set default'> on a column with no default; add HasDefault or choose an action ` +
            'that does not write a missing default',
        );
      }
    }
    if ((onDelete !== undefined || onUpdate !== undefined) && typeof references !== 'string') {
      this.#refuse(property, 'OnDelete and OnUpdate require References<…> on the same foreign-key column');
    }

    // A generated `integer` is what `serial` means, and the declaration says it in two tags
    // rather than one because the old `Sql<'serial'>` made a serial key's value unassignable
    // to an `integer` foreign key — see `ColumnSqlType` in `@zmdb/schema-core/tags`. The IR
    // keeps the one-word spelling, because that is the word two of the three dialects want
    // in the DDL and every renderer reads it.
    const coreSql = declaredSql ?? (extension === undefined ? this.#inferSql(property, data, enumValues) : undefined);
    const sql: ColumnIR['sql'] =
      extension ??
      (serial && coreSql === 'integer' ? 'serial' : (coreSql ?? this.#inferSql(property, data, enumValues)));

    const payload = this.#declaredApp(property, data, sql, typeof codec === 'string');

    return {
      name: property,
      physicalName,
      sql,
      nullable,
      primaryKey: tags.has('primaryKey'),
      serial,
      unique: tags.has('unique'),
      hasDefault,
      sensitive: tags.has('sensitive'),
      ...(length === undefined ? {} : { length }),
      ...(precision === undefined ? {} : { precision }),
      ...(sql === 'jsonEnum' && enumValues !== undefined ? { enum: enumValues } : {}),
      ...(typeof references === 'string' ? { references } : {}),
      ...(onDelete === undefined ? {} : { onDelete }),
      ...(onUpdate === undefined ? {} : { onUpdate }),
      ...(typeof codec === 'string' ? { codec } : {}),
      // `WireAs<W>` is the one tag whose payload is a type rather than a literal, so it
      // is reflected like data instead of read with `literalOf`. Only the declaration
      // can say what a codec puts on the wire — see `wireTypeOf`, which refuses a codec
      // column without it rather than assuming the app type crosses unchanged.
      ...(wire === undefined ? {} : { wire: this.#type(wire, property, 1) }),
      constraints,
      rules: this.#rulesOf(tags),
      ...(payload === undefined ? {} : { payload }),
    };
  }

  /**
   * The app type, where only a tagged declaration can say it.
   *
   * Two cases, one IR field. A `json` column's payload shape: `ColumnMeta` records
   * `sql: 'json'` and has nowhere to put the shape, so a consumer reading the column map
   * gets "an object, unspecified". And the type behind a codec: `Money & Sql<'integer'> &
   * Codec<'Money'>` is an integer in the database and a `Money` in the app, and a
   * validator that checked `integer` would reject every valid value. Both are facts only
   * the declaration has, and both are why `CoreSchema` carries its IR.
   *
   * A codec over a *scalar* is left alone deliberately. `string & Sql<'text'> &
   * Length<80> & Codec<'currency'>` is a string on both sides, and recording the bare
   * data part would drop the constraints the tags carry, which `appTypeOf` reads off the
   * column instead. So the field is set only where the app type is a shape the SQL type
   * cannot describe at all.
   *
   * `object & Sql<'json'>` is the declared spelling of a payload-free `json()`, so it
   * leaves the field unset like `unknown` does. That is not a shortcut: `object` means
   * "not a primitive", which is precisely the check an unshaped `json` column emits, so
   * the type and the validator say the same thing rather than one of them saying more.
   */
  #declaredApp(
    property: string,
    data: readonly Type[],
    sql: SqlType | ExtensionType,
    codec: boolean,
  ): TypeIR | undefined {
    if (typeof sql !== 'string') {
      const [only] = data;
      if (data.length !== 1 || only === undefined || isUnknown(only) || isNonPrimitive(only)) return undefined;
      return this.#type(only, property, 1);
    }
    if (!codec && sql !== 'json') return undefined;
    const [only] = data;
    if (data.length !== 1 || only === undefined || isUnknown(only) || isNonPrimitive(only)) return undefined;
    const node = this.#type(only, property, 1);
    if (sql === 'json') return node;
    return node.kind === 'scalar' || node.kind === 'literal' ? undefined : node;
  }

  /**
   * `Sql<T>` is required only where TypeScript is genuinely ambiguous. That is `number`,
   * which is both `integer` and `numeric`, and `string`, which is both `text` and
   * `varchar` — and for `string` there is a defensible default, so only `number` is
   * refused outright. Everywhere else the type says it, and asking for a second spelling
   * would be asking for two sources of truth (REQ-TF-2).
   */
  #inferSql(property: string, members: readonly Type[], enumValues: readonly string[] | undefined): SqlType {
    if (enumValues !== undefined) return 'jsonEnum';
    const only = members.length === 1 ? members[0] : undefined;
    if (!only) return 'json';
    if (only.isIntrinsicType()) {
      switch (only.intrinsicName) {
        case 'string':
          return 'text';
        case 'boolean':
          return 'boolean';
        case 'bigint':
          return 'bigint';
        case 'number':
          this.#refuse(
            property,
            "a `number` column needs Sql<'integer'> or Sql<'numeric'> — TypeScript spells both `number`",
          );
          return 'numeric';
        default:
          break;
      }
    }
    if (only.isBooleanLiteralType()) return 'boolean';
    if (only.getSymbol()?.name === 'Date') return 'timestamp';
    return 'json';
  }

  #precisionOf(tags: ReadonlyMap<TagField, Type>): readonly [number, number] | undefined {
    const spec = this.#nonNullable(tags.get('precision'));
    if (!spec) return undefined;
    const parts = this.#checker.isTupleType(spec) ? this.#typeArguments(spec) : [];
    const [p, s] = parts.map(part => numberOf(part));
    if (p === undefined || s === undefined) {
      this.#refuse('precision', 'Numeric<P, S> needs two number literals', this.#print(spec));
      return undefined;
    }
    return [p, s];
  }

  #tableColumnList(label: 'ShardKey' | 'SortKey', tagged: Type | undefined): readonly string[] | undefined {
    const spec = this.#nonNullable(tagged);
    if (!spec) return undefined;
    const parts = this.#checker.isTupleType(spec) ? this.#typeArguments(spec) : [];
    const columns = parts.map(part => literalOf(part));
    if (columns.length === 0 || columns.some(column => typeof column !== 'string')) {
      this.#refuse(label, `${label}<Columns> needs a non-empty tuple of string literals`, this.#print(spec));
      return undefined;
    }
    const names = columns.filter((column): column is string => typeof column === 'string');
    if (new Set(names).size !== names.length) {
      this.#refuse(label, `${label}<Columns> names each column once`, this.#print(spec));
      return undefined;
    }
    return names;
  }

  /**
   * `Rule<'luhn'>`, or `Rule<'luhn' | 'checksum'>` for more than one. A second
   * `Rule<>` in the same intersection would reuse the same symbol slot and intersect
   * the arguments to `never`, so the union is the spelling — hence a union is read
   * here rather than refused.
   */
  #rulesOf(tags: ReadonlyMap<TagField, Type>): readonly string[] {
    const spec = this.#nonNullable(tags.get('rules'));
    if (!spec) return [];
    const members = spec.isUnionType() ? spec.getTypes() : [spec];
    const names = literalUnion(members);
    if (names === undefined) {
      this.#refuse(
        'rules',
        "Rule<Name> needs a string literal, or a union of them: Rule<'a' | 'b'>",
        this.#print(spec),
      );
      return [];
    }
    return names;
  }

  // -------------------------------------------------------------------------
  // Checker helpers
  // -------------------------------------------------------------------------

  #typeOf(symbol: TsSymbol): Type | undefined {
    return this.#checker.getTypeOfSymbolAtLocation(symbol, this.#location);
  }

  #grpcMember(type: Type, method: string, member: 'request' | 'response'): Type | undefined {
    const symbol = this.#checker.getPropertyOfType(type, member);
    if (symbol === undefined) {
      this.#refuse(`${method}.${member}`, `a gRPC method must declare its ${member} type`);
      return undefined;
    }
    const value = this.#typeOf(symbol);
    if (value === undefined) {
      this.#refuse(`${method}.${member}`, `the checker did not resolve this gRPC ${member} type`);
    }
    return value;
  }

  #grpcStreamFlag(type: Type, method: string, member: 'requestStream' | 'responseStream'): boolean {
    const symbol = this.#checker.getPropertyOfType(type, member);
    if (symbol === undefined) return false;
    const value = this.#typeOf(symbol);
    if (value === undefined || literalOf(this.#nonNullable(value)) !== true) {
      this.#refuse(`${method}.${member}`, `a gRPC stream flag must be the literal type \`true\` when present`);
    }
    return true;
  }

  /**
   * The type arguments of an array, tuple or other generic reference.
   *
   * boundary: `getTypeArguments` takes a `TypeReference`, but `isArrayType` and
   * `isTupleType` answer with a plain `boolean` rather than a predicate, so the check that
   * makes the call sound cannot narrow the argument. Every caller runs one of those two
   * first; the cast lives here, once, instead of at each of them. A reference this is
   * called on wrongly answers with an empty list, and each caller already handles that —
   * an array with no element type is a refusal, and a tuple with none is an empty tuple.
   */
  #typeArguments(type: Type): readonly Type[] {
    return this.#checker.getTypeArguments(type as TypeReference);
  }

  /** Strips `| undefined` off an optional tag slot's type. */
  #nonNullable(type: Type | undefined): Type | undefined {
    if (!type) return undefined;
    return this.#checker.getNonNullableType(type) ?? type;
  }

  #hasIndexSignature(type: Type): boolean {
    try {
      return this.#checker.getIndexInfosOfType(type).length > 0;
    } catch {
      // The client throws while marshalling an `IndexInfo` whose `keyType` it cannot
      // resolve. It only gets that far when there IS one, so a throw is a positive
      // answer, not an error to swallow.
      return true;
    }
  }

  #print(type: Type): string {
    return this.#checker.typeToString(type);
  }

  #refuse(path: string, reason: string, source?: string): void {
    this.diagnostics.push({ path, reason, ...(source === undefined ? {} : { source }) });
  }

  #unsupported(path: string, reason: string, source?: string): TypeIR {
    this.#refuse(path, reason, source);
    return { kind: 'unsupported', reason, ...(source === undefined ? {} : { source }) };
  }

  #claimName(preferred: string, id: number): string {
    const owner = this.#names.get(preferred);
    if (owner === undefined) {
      this.#names.set(preferred, id);
      return preferred;
    }
    if (owner === id) return preferred;
    // Two declarations, one name. Suffixing keeps the emitted helpers distinct; the
    // alternative is one helper silently checking the other's shape.
    let n = 2;
    while (this.#names.has(`${preferred}_${n}`) && this.#names.get(`${preferred}_${n}`) !== id) n++;
    this.#names.set(`${preferred}_${n}`, id);
    return `${preferred}_${n}`;
  }
}

// ---------------------------------------------------------------------------
// Free functions
// ---------------------------------------------------------------------------

export interface ReflectResult<T> {
  readonly ir: T;
  readonly diagnostics: readonly ReflectDiagnostic[];
}

/** One type, one IR, plus whatever the reflection had to refuse along the way. */
export function irFromType(
  checker: Checker,
  type: Type,
  location: Node,
  options?: ReflectOptions,
): ReflectResult<TypeIR> {
  const reflector = new Reflector(checker, location, options);
  return { ir: reflector.typeIR(type), diagnostics: reflector.diagnostics };
}

/** A tagged entity type, read to the `SchemaIR` every back-end takes. */
export function schemaIrFromType(
  checker: Checker,
  type: Type,
  location: Node,
  options?: ReflectOptions,
): ReflectResult<SchemaIR> {
  const reflector = new Reflector(checker, location, options);
  return { ir: reflector.schemaIR(type), diagnostics: reflector.diagnostics };
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isUnknown(type: Type): boolean {
  return type.isIntrinsicType() && (type.intrinsicName === 'unknown' || type.intrinsicName === 'any');
}

/** The `object` keyword: any non-primitive, which is any JSON object or array. */
function isNonPrimitive(type: Type): boolean {
  return type.isIntrinsicType() && type.intrinsicName === 'object';
}

function literalOf(type: Type | undefined): string | number | boolean | undefined {
  if (!type) return undefined;
  if (type.isStringLiteralType() || type.isNumberLiteralType() || type.isBooleanLiteralType()) return type.value;
  // `Fts<true>` and a bare `PrimaryKey` both carry the `true` type, which the checker
  // may report as the `boolean` union rather than a literal depending on how it was
  // written; treat that as `true` because `false` is not a spelling any tag admits.
  if (type.isIntrinsicType() && type.intrinsicName === 'true') return true;
  return undefined;
}

function numberOf(type: Type | undefined): number | undefined {
  const value = literalOf(type);
  return typeof value === 'number' ? value : undefined;
}

/**
 * `'a' | 'b'` → `['a', 'b']`, sorted; anything else → `undefined`.
 *
 * Sorted because the order we are handed is not the order the author wrote. The checker
 * normalises union members, so `'free' | 'pro' | 'enterprise'` arrives as `enterprise`,
 * `free`, `pro`. Sorting is what makes the answer stable across an edit that only reorders
 * the union, which is not a change to the table. See `ColumnIR.enum`.
 */
function literalUnion(members: readonly Type[]): readonly string[] | undefined {
  if (members.length === 0) return undefined;
  const values: string[] = [];
  for (const member of members) {
    if (!member.isStringLiteralType()) return undefined;
    values.push(member.value);
  }
  return values.toSorted();
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

function pascalIdentifier(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter(word => word.length > 0);
  if (words.length === 0) return 'Method';
  return words.map(word => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`).join('');
}

/**
 * The regex source for one `${…}` span of a template literal type, or `undefined` when
 * there is no *exact* equivalent.
 *
 * `${number}` is deliberately not derivable. TypeScript's own rule for what text is
 * assignable to it covers exponents, `Infinity` and leading signs, so any regex short
 * enough to write here is either stricter than the type — rejecting values the type
 * accepts — or looser. Refusing and asking for an explicit `Pattern<…>` lets the author
 * pick the numeric grammar they actually mean.
 *
 * There is no union case because the checker never leaves one here: `` `v${1 | 2}` ``
 * is normalised to two template literal types before we see it.
 */
function placeholderPattern(span: Type): string | undefined {
  if (span.isStringLiteralType() || span.isNumberLiteralType()) return escapeRegExp(String(span.value));
  if (span.isIntrinsicType() && span.intrinsicName === 'string') return String.raw`[\s\S]*`;
  return undefined;
}

/**
 * The declared name of a type, or `undefined` for an anonymous one. `__type` and
 * `__object` are the checker's placeholders for a type literal, not names.
 */
function typeName(type: Type): string | undefined {
  const name = type.getAliasSymbol()?.name ?? type.getSymbol()?.name;
  if (name === undefined || name.startsWith('__')) return undefined;
  return name;
}
