// Reflection: a TypeScript type → `@zmdb/schema-core/ir`.
//
// This is the front-end that makes type-first declaration possible (PRD §6.7,
// REQ-TF-4 … REQ-TF-7). It reads a checker `Type` and produces plain serialisable
// data; from there the existing back-ends — validator emission, JSON Schema, DDL —
// are already written against the IR and do not know or care which front-end
// produced it. `PLAN-type-first.md` Phase 4.
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
  SQL_TYPES,
  TAG_NAMES,
  type ColumnIR,
  type Constraints,
  type PropertyIR,
  type RelationIR,
  type RelationKind,
  type SchemaIR,
  type TagField,
  type TypeIR,
} from '@zmdb/schema-core/ir';
import type { Node } from 'typescript/unstable/ast';
import { SignatureKind, SymbolFlags } from 'typescript/unstable/sync';
import type { Checker, IntersectionType, Symbol as TsSymbol, Type, TypeReference } from 'typescript/unstable/sync';

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

const TAG_FIELD_BY_NAME: ReadonlyMap<string, TagField> = new Map(
  Object.entries(TAG_NAMES).map(([field, symbolName]) => [symbolName, field as TagField]),
);

const SQL_TYPE_SET: ReadonlySet<string> = new Set<string>(SQL_TYPES);

/** Whether a property symbol is one of our tag slots rather than real data. */
function isTagProperty(symbol: TsSymbol): boolean {
  const match = TAG_PATTERN.exec(symbol.escapedName);
  return match !== null && TAG_FIELD_BY_NAME.has(match[1] ?? '');
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
  return symbol.escapedName.startsWith('__@');
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
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /** The structural IR of a type. Total: always returns a node. */
  typeIR(type: Type, path = ''): TypeIR {
    return this.#type(type, path, 0);
  }

  /**
   * The schema IR of a *tagged entity* type — the type-first counterpart of
   * `irFromSchema`. The two must agree node for node; `equivalence.spec.ts` is the
   * test that says so, and it is the argument that every existing SQL and JSON
   * Schema snapshot also covers the tagged front-end (REQ-TF-7, REQ-TF-12).
   */
  schemaIR(type: Type, fallbackTable?: string): SchemaIR {
    const tags = this.#readTags(type);
    const table = literalOf(this.#nonNullable(tags.get('table')));

    const name = typeName(type);
    const tableName = typeof table === 'string' ? table : (fallbackTable ?? name ?? 'unknown');
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
      columns.push(this.#column(property, split, propertyTags));
    }

    const fts = literalOf(this.#nonNullable(tags.get('ftsTable')));

    return {
      table: tableName,
      columns,
      primaryKey: columns.filter(c => c.primaryKey).map(c => c.name),
      relations,
      ...(typeof fts === 'string' || fts === true ? { ftsTable: fts } : {}),
    };
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
    if (members.length === 2 && members.every(m => m.isBooleanLiteralType())) {
      return { kind: 'scalar', scalar: 'boolean' };
    }
    // The checker sorts `null` and `undefined` to the FRONT of a union. `../ir`'s
    // `withNull` puts them at the back, and the two front-ends have to agree member
    // for member or the equivalence test compares `[null, string]` with
    // `[string, null]` and fails for no reason a reader would recognise.
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
    if (parts.length === 1) {
      const inner = this.#type(parts[0] as Type, path, depth);
      return this.#applyConstraints(inner, tags);
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
      const element = checker.getTypeArguments(type as TypeReference)[0];
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
    const elements = this.#checker.getTypeArguments(type as TypeReference);
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
      const match = TAG_PATTERN.exec(symbol.escapedName);
      if (!match) continue;
      const field = TAG_FIELD_BY_NAME.get(match[1] ?? '');
      if (field === undefined) continue;

      // Plan D5. `unique symbol` identity is nominal, so two installed copies of
      // `@zmdb/schema-core` give two `zmdbSerial` tags that the type system treats as
      // unrelated. The derived types then quietly stop omitting serial columns while
      // this name-based reflection carries on working — the emitted validator and the
      // derived type disagree, and neither side reports it. The escaped name is the
      // only place that asymmetry is visible, so it is caught here.
      const first = this.#tagIdentity.get(match[1] ?? '');
      if (first === undefined) this.#tagIdentity.set(match[1] ?? '', symbol.escapedName);
      else if (first !== symbol.escapedName) {
        this.#refuse(
          symbol.name,
          `the tag \`${match[1]}\` resolves to two different declarations (\`${first}\` and \`${symbol.escapedName}\`), ` +
            'which means two copies of @zmdb/schema-core are installed; deduplicate them',
        );
      }

      const value = this.#typeOf(symbol);
      if (value) found.set(field, value);
    }
    return found;
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
    if (members.length === 1) return this.#readTags(members[0] as Type);
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
      return parts.length === 1 ? (parts[0] as Type) : type;
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
    // `MaxLength<N>` wins when both are present — the same precedence `../ir`'s
    // `constrained()` applies to the value front-end.
    const length = numberOf(this.#nonNullable(tags.get('length')));
    if (length !== undefined && constraints.maxLength === undefined) constraints.maxLength = length;

    if (node.kind === 'array') {
      return Object.keys(constraints).length === 0 ? node : { ...node, constraints };
    }
    return {
      ...node,
      ...(scalar === undefined ? {} : { scalar }),
      ...(Object.keys(constraints).length === 0 ? {} : { constraints }),
    };
  }

  #constraintsFromTags(tags: ReadonlyMap<TagField, Type>): {
    minimum?: number;
    maximum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  } {
    const out: { minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string } = {};
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
    if (!SQL_TYPE_SET.has(declared)) {
      this.#refuse('sql', `\`${declared}\` is not a SQL type; expected one of ${SQL_TYPES.join(', ')}`);
      return undefined;
    }
    return declared as SqlType;
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
    return { name: property, relation: kind as RelationKind, target, via };
  }

  #column(property: string, split: NullableSplit, tags: ReadonlyMap<TagField, Type>): ColumnIR {
    const { nullable, rest } = split;

    // `('admin' | 'viewer') & Sql<'jsonEnum'>` does not stay written that way: an
    // intersection containing a union normalises to a union of intersections, so each
    // member arrives with the tag attached. Stripping the tag parts is what makes the
    // literal union visible again.
    const data = rest.map(member => this.#dataPart(member));
    const enumValues = literalUnion(data);
    const sql = this.#sqlOf(tags) ?? this.#inferSql(property, data, enumValues);
    const constraints = this.#constraintsFromTags(tags);
    const length = numberOf(this.#nonNullable(tags.get('length')));
    const precision = this.#precisionOf(tags);
    const references = literalOf(this.#nonNullable(tags.get('references')));
    const codec = literalOf(this.#nonNullable(tags.get('codec')));

    // `Serial` implies a database default. Not an inference for convenience: a
    // generated column *does* have one, `serial()` sets `hasDefault` too, and the two
    // front-ends have to agree node for node or the equivalence test is meaningless.
    const serial = tags.has('serial');
    const hasDefault = serial || tags.has('hasDefault');

    return {
      name: property,
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
      ...(typeof codec === 'string' ? { codec } : {}),
      constraints: constraints as Constraints,
      rules: this.#rulesOf(tags),
      // A `json` column's payload shape is something only the tagged front-end knows:
      // `json<Settings>()` carries `Settings` in a phantom type parameter that is gone
      // at runtime, so `irFromSchema` cannot recover it and leaves `payload` unset.
      // That asymmetry is a capability, not a discrepancy, which is why the
      // equivalence corpus has no `json` column and a separate test covers this.
      ...(sql === 'json' && data.length === 1 && !isUnknown(data[0] as Type)
        ? { payload: this.#type(data[0] as Type, property, 1) }
        : {}),
    };
  }

  /**
   * `Sql<T>` is required only where TypeScript is genuinely ambiguous, which is
   * exactly `number`: `integer`, `numeric` and `serial` are all `number`. Everywhere
   * else the type says it, and asking for a second spelling would be asking for two
   * sources of truth (REQ-TF-2).
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
            "a `number` column needs Sql<'integer'>, Sql<'numeric'> or Sql<'serial'> — TypeScript spells all three `number`",
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
    const parts = this.#checker.isTupleType(spec) ? this.#checker.getTypeArguments(spec as TypeReference) : [];
    const [p, s] = parts.map(part => numberOf(part));
    if (p === undefined || s === undefined) {
      this.#refuse('precision', 'Numeric<P, S> needs two number literals', this.#print(spec));
      return undefined;
    }
    return [p, s];
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

/** The tagged front-end's counterpart to `irFromSchema`. */
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

/** `'a' | 'b'` → `['a', 'b']`; anything else → `undefined`. */
function literalUnion(members: readonly Type[]): readonly string[] | undefined {
  if (members.length === 0) return undefined;
  const values: string[] = [];
  for (const member of members) {
    if (!member.isStringLiteralType()) return undefined;
    values.push(member.value);
  }
  return values;
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
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
