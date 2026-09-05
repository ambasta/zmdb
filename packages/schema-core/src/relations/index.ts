// Relations, resolved from the declaration.
//
// This module used to be a second way of writing a relation down. `manyToOne(UserSchema,
// 'userId')` and friends returned a frozen `RelationMeta` — cardinality, target table, and
// the foreign key under one of three names (`fk`, `mappedBy`, `through`) depending on which
// builder produced it — and a `RelationsMap` of those was handed to a repository so it could
// learn what `populate: ['orders']` meant. The declaration already said it:
//
//   orders?: Order[] & OneToMany<'orders', 'userId'>
//
// so the map restated the target and the key, and `PopulatedEntity<Base, Relations, K>` had
// three conditional types whose whole job was to dig the target's row type back out of a
// value that had been built from the type in the first place. `../derive/query.ts` derives it
// from `T` directly; the builders, the map, the `RelationMeta` shape and the derivation types
// are gone.
//
// What is left is the part that was never a duplicate: `resolveRelation`, which turns one
// `RelationIR` into the pair of columns a query needs, and the two row helpers.
import {
  quoteIdentifier,
  formatPlaceholder,
  renderPredicate,
  type ComparisonPredicate,
  type Dialect,
} from '@zmdb/query-compiler';

import type { SchemaIR } from '../ir/index.js';

/**
 * One relation, resolved to the pair of columns a join or a batched select matches on.
 *
 * A `RelationIR` says *which* table and *which* column, but not which side holds it — and
 * that is the only thing standing between a declaration and a query. Both readers of a
 * relation resolve it through here, so the join and the batched select cannot disagree about
 * the same declaration (they used to: the repository's join read `fk`/`mappedBy` with one set
 * of fallbacks and its batched select read `childFk`/`parentKey` with another).
 */
export interface ResolvedRelation {
  readonly name: string;
  /** Where the related rows live. */
  readonly targetTable: string;
  /** The column on the declaring table whose value the join matches. */
  readonly parentKey: string;
  /** The column on the target table carrying the matching value. */
  readonly targetKey: string;
  /** `true` for `oneToMany`: the relation attaches an array, empty where nothing matched. */
  readonly toMany: boolean;
}

/**
 * Resolve one relation of a table by name.
 *
 * Throws for a name the type does not declare — naming the ones it does, because a
 * misspelled `populate` is the common case — and for `manyToMany`, whose `via` is a join
 * table rather than a column: two hops cannot be expressed as one `IN`, and guessing the
 * join table's two foreign keys from the table names either side is how a wrong query gets
 * built quietly.
 */
export function resolveRelation(ir: SchemaIR, name: string): ResolvedRelation {
  const declared = ir.relations;
  const rel = declared.find(candidate => candidate.name === name);
  if (!rel) {
    const known = declared.map(candidate => candidate.name);
    throw new Error(
      `unknown relation "${name}" on ${ir.table}: ` +
        (known.length > 0 ? `the type declares ${known.join(', ')}` : 'the type declares none'),
    );
  }
  if (rel.relation === 'manyToMany') {
    throw new Error(
      `relation "${name}" on ${ir.table} is many-to-many through "${rel.via}", which populate ` +
        'does not resolve — join the two tables explicitly',
    );
  }
  if (rel.relation === 'oneToMany') {
    // The inverse side: the foreign key is a column of the *target*, holding this row's key.
    return { name, targetTable: rel.target, parentKey: primaryKeyOf(ir), targetKey: rel.via, toMany: true };
  }
  if (rel.relation === 'oneToOne' && !ir.columns.some(col => col.name === rel.via)) {
    // A one-to-one pair is symmetric, so `OneToOne<'profiles', 'userId'>` does not say which
    // of the two tables holds the key — and the answer is "the one with the column". Declared
    // on `users`, which has no `userId`, it is the inverse side, joined from the primary key
    // exactly as a to-many is; it just cannot match twice.
    return { name, targetTable: rel.target, parentKey: primaryKeyOf(ir), targetKey: rel.via, toMany: false };
  }
  // The owning side: this row holds the foreign key, and the column it points at is written
  // down on that column, as `References<'users.id'>`.
  return {
    name,
    targetTable: rel.target,
    parentKey: rel.via,
    targetKey: referencedColumn(ir, rel.via),
    toMany: false,
  };
}

/** The column a foreign key points at, per its `References<'table.column'>`; `id` without one. */
function referencedColumn(ir: SchemaIR, fk: string): string {
  const [, column] = (ir.columns.find(col => col.name === fk)?.references ?? '').split('.');
  return column ?? 'id';
}

function primaryKeyOf(ir: SchemaIR): string {
  const pk = ir.primaryKey[0];
  if (!pk) throw new Error(`schema ${ir.table} has no primary key, so its relations have nothing to join from`);
  return pk;
}

export type PopulateDialect = Dialect;

export interface PopulateQuery {
  readonly kind: 'join' | 'batched';
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function sanitizeKeys<T>(keys: readonly T[]): T[] {
  const result: T[] = [];
  const seen = new Set<T>();
  for (const k of keys) {
    if (k !== null && k !== undefined && !seen.has(k)) {
      seen.add(k);
      result.push(k);
    }
  }
  return result;
}

/**
 * Compile a populate hint into SQL: a to-one becomes an `INNER JOIN`, a to-many a batched
 * `IN (…)` select over the parent keys.
 *
 * Takes the declaring table's IR and a relation name rather than a relation object, which is
 * what makes the two spellings one: the columns on either side of the `ON` come out of
 * `resolveRelation`, the same call `@zmdb/repository`'s `populate` makes.
 */
export function compilePopulate(
  ir: SchemaIR,
  relationName: string,
  dialect: PopulateDialect,
  parentIds: readonly unknown[] = [],
  targetFilters: readonly ComparisonPredicate[] = [],
): PopulateQuery {
  const rel = resolveRelation(ir, relationName);
  const q = (name: string): string => quoteIdentifier(dialect, name);
  const renderFilters = (parameters: unknown[]): string => {
    if (targetFilters.length === 0) return '';
    const body = targetFilters
      .map((predicate, index) => {
        const rendered = renderPredicate(dialect, predicate, parameters);
        return index === 0 ? rendered : `${predicate.connector ?? 'AND'} ${rendered}`;
      })
      .join(' ');
    const grouped = targetFilters.some((predicate, index) => index > 0 && predicate.connector === 'OR');
    return `AND ${grouped ? `(${body})` : body}`;
  };
  if (!rel.toMany) {
    const parameters: unknown[] = [];
    const filtered = targetFilters.length > 0;
    const onFilters = renderFilters(parameters);
    const sql =
      `SELECT * FROM ${q(ir.table)} ${filtered ? 'LEFT' : 'INNER'} JOIN ${q(rel.targetTable)} ` +
      `ON ${q(ir.table)}.${q(rel.parentKey)} = ${q(rel.targetTable)}.${q(rel.targetKey)}` +
      (onFilters.length === 0 ? '' : ` ${onFilters}`);
    return { kind: 'join', sql, parameters };
  }
  const sanitized = sanitizeKeys(parentIds);
  if (sanitized.length === 0) {
    return { kind: 'batched', sql: `SELECT * FROM ${q(rel.targetTable)} WHERE 1 = 0`, parameters: [] };
  }
  const inList = sanitized.map((_, i) => formatPlaceholder(dialect, i + 1)).join(', ');
  const parameters: unknown[] = [...sanitized];
  const filters = renderFilters(parameters);
  const sql =
    `SELECT * FROM ${q(rel.targetTable)} WHERE ${q(rel.targetKey)} IN (${inList})` +
    (filters.length === 0 ? '' : ` ${filters}`);
  return { kind: 'batched', sql, parameters };
}

/**
 * Attach a populated relation to a parent row, without mutating it.
 *
 * The type widening is `Populated<T, K>` in `../derive/query.ts`, which reads the declared
 * relation property; this only puts the value there.
 */
export function attachPopulated<P extends Record<string, unknown>, N extends string, V>(
  parent: P,
  name: N,
  value: V,
): P & { [K in N]: V } {
  // boundary: a computed key in an object literal widens to `string`, so TS types
  // this spread as `P & { [x: string]: V }`. `name` is the literal `N` at the call
  // site, which is what the return type states.
  return { ...parent, [name]: value } as P & { [K in N]: V };
}

/**
 * A row from a join written against two tables directly. LEFT: the joined columns may be
 * absent, so they come back optional.
 *
 * `../derive/query.ts` has a `JoinRow<T, K, Kind>` that names the joined side by relation
 * key instead; this is the form for a join whose target is not a declared relation of the
 * base table.
 */
export type JoinRow<Base, Joined, Kind extends 'inner' | 'left' = 'left'> = Kind extends 'inner'
  ? Base & Joined
  : Base & Partial<Joined>;

/** Rename aliased columns per a { alias: outKey } map (stable, non-mutating). */
export function aliasRow<Row extends Record<string, unknown>>(
  row: Row,
  map: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const [alias, outKey] of Object.entries(map)) {
    if (alias in out) {
      out[outKey] = out[alias];
      delete out[alias]; // rename: drop the original aliased key
    }
  }
  return out;
}
