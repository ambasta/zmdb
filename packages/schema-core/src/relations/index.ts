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
  formatPlaceholder,
  quoteIdentifier,
  renderPredicate,
  UnsupportedFeatureError,
  type ComparisonPredicate,
  type Dialect,
} from '@zmdb/query-compiler';

import type { SchemaIR } from '../ir/index.js';
import { singularizeWord } from '../openapi/index.js';

export function inferFkName(tableName: string): string {
  const tableParts = tableName.split('.');
  const table = tableParts[tableParts.length - 1] ?? tableName;
  const parts = table.split(/[-_]+/);
  const lastIndex = parts.length - 1;
  const lastWord = parts[lastIndex];
  if (lastWord !== undefined) {
    parts[lastIndex] = singularizeWord(lastWord);
  }
  const camel = parts
    .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join('');
  return `${camel}Id`;
}

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
  readonly isManyToMany?: boolean;
  /** Where the related rows live. */
  readonly targetTable: string;
  /** Ordered columns on the declaring table whose values the join matches. */
  readonly parentKey: readonly string[];
  /** Ordered columns on the target table, positionally paired with `parentKey`. */
  readonly targetKey: readonly string[];
  /** `true` for `oneToMany` or `manyToMany`: the relation attaches an array, empty where nothing matched. */
  readonly toMany: boolean;
  /** For manyToMany: the pivot/join table name. */
  readonly through?: string;
  /** For manyToMany: FK on pivot pointing to base table. */
  readonly baseFk?: string;
  /** For manyToMany: FK on pivot pointing to target table. */
  readonly targetFk?: string;
}

/**
 * Resolve one relation of a table by name.
 *
 * Throws for a name the type does not declare — naming the ones it does, because a
 * misspelled `populate` is the common case.
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
    const through = rel.via;
    const baseFk = rel.fk ?? inferFkName(ir.table);
    const targetFk = rel.mappedBy ?? inferFkName(rel.target);
    const parentKey = primaryKeyOf(ir);
    const targetKey = ['id'];
    return {
      name,
      isManyToMany: true,
      targetTable: rel.target,
      parentKey,
      targetKey,
      toMany: true,
      through,
      baseFk,
      targetFk,
    };
  }
  if (rel.relation === 'oneToMany') {
    // The inverse side: the foreign key is a column of the *target*, holding this row's key.
    return inverseRelation(ir, name, rel, true);
  }
  const via = relationColumns(ir, name, rel.via);
  if (rel.relation === 'oneToOne' && !via.every(column => ir.columns.some(candidate => candidate.name === column))) {
    // A one-to-one pair is symmetric, so `OneToOne<'profiles', 'userId'>` does not say which
    // of the two tables holds the key — and the answer is "the one with the column". Declared
    // on `users`, which has no `userId`, it is the inverse side, joined from the primary key
    // exactly as a to-many is; it just cannot match twice.
    return inverseRelation(ir, name, rel, false);
  }
  // The owning side: this row holds the foreign key, and the column it points at is written
  // down on that column, as `References<'users.id'>`.
  return {
    name,
    targetTable: rel.target,
    parentKey: via,
    targetKey: via.map(column => referencedColumn(ir, name, rel.target, column, via.length > 1)),
    toMany: false,
  };
}

function relationColumns(ir: SchemaIR, relation: string, via: string): readonly string[] {
  const columns = via.split(',').map(column => column.trim());
  if (columns.some(column => column.length === 0)) {
    throw new Error(`${ir.table}.${relation}: relation via "${via}" contains an empty column name`);
  }
  return columns;
}

/** The column a foreign key points at, per its `References<'table.column'>`; `id` without one. */
function referencedColumn(
  ir: SchemaIR,
  relation: string,
  target: string,
  fk: string,
  requireReference: boolean,
): string {
  const reference = ir.columns.find(col => col.name === fk)?.references;
  const separator = reference?.lastIndexOf('.') ?? -1;
  if (reference !== undefined && separator > 0 && separator < reference.length - 1) {
    return reference.slice(separator + 1);
  }
  if (requireReference) {
    throw new Error(
      `${ir.table}.${relation}: composite relation via column "${fk}" must carry ` +
        `References<'${target}.column'>; every via column must name its target`,
    );
  }
  return 'id';
}

function primaryKeyOf(ir: SchemaIR): readonly string[] {
  if (ir.primaryKey.length === 0) {
    throw new Error(`schema ${ir.table} has no primary key, so its relations have nothing to join from`);
  }
  return ir.primaryKey;
}

function relationTag(relation: 'manyToOne' | 'oneToMany' | 'oneToOne'): string {
  switch (relation) {
    case 'manyToOne':
      return 'ManyToOne';
    case 'oneToMany':
      return 'OneToMany';
    case 'oneToOne':
      return 'OneToOne';
  }
}

function inverseRelation(
  ir: SchemaIR,
  name: string,
  rel: SchemaIR['relations'][number],
  toMany: boolean,
): ResolvedRelation {
  if (rel.relation !== 'oneToMany' && rel.relation !== 'oneToOne') {
    throw new Error(`${ir.table}.${name}: ${rel.relation} is not an inverse relation`);
  }
  const parentKey = primaryKeyOf(ir);
  const targetKey = relationColumns(ir, name, rel.via);
  if (parentKey.length !== targetKey.length) {
    const tag = relationTag(rel.relation);
    const missing = Math.max(0, parentKey.length - targetKey.length);
    const suggestedVia = [...parentKey.slice(0, missing), ...targetKey].join(',');
    const targetLabel = targetKey.length === 1 ? 'column' : 'columns';
    throw new Error(
      `${ir.table}.${name}: ${tag}<'${rel.target}', '${rel.via}'> supplies ${String(targetKey.length)} target ` +
        `${targetLabel} for a ${String(parentKey.length)}-column parent key (${parentKey.join(', ')}); ` +
        `name every column, in key order — ${tag}<'${rel.target}', '${suggestedVia}'>`,
    );
  }
  return { name, targetTable: rel.target, parentKey, targetKey, toMany };
}

export type PopulateDialect = Dialect;

export interface PopulateQuery {
  readonly kind: 'join' | 'batched';
  readonly sql: string;
  readonly parameters: readonly unknown[];
  readonly pivotQuery?: PopulateQuery | undefined;
  readonly targetQuery?: ((intermediateTargetIds: readonly unknown[]) => PopulateQuery) | undefined;
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

function sameKeyValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return Object.is(left, right);
}

function sanitizeCompositeKeys(
  ir: SchemaIR,
  relationName: string,
  keys: readonly unknown[],
  arity: number,
): readonly (readonly unknown[])[] {
  const result: unknown[][] = [];
  for (const key of keys) {
    if (key === null || key === undefined) continue;
    if (!Array.isArray(key)) {
      throw new Error(
        `${ir.table}.${relationName}: composite-key populate expects a ${String(arity)}-column tuple for every parent`,
      );
    }
    if (key.length !== arity) {
      throw new Error(
        `${ir.table}.${relationName}: composite-key populate expected ${String(arity)} values, received ${String(key.length)}`,
      );
    }
    if (key.some(value => value === null || value === undefined)) continue;
    if (result.some(existing => existing.every((value, index) => sameKeyValue(value, key[index])))) continue;
    result.push([...key]);
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
  schemas: readonly SchemaIR[] = [],
): PopulateQuery {
  const rel = resolveRelation(ir, relationName);
  const q = (name: string): string => quoteIdentifier(dialect, name);
  const targetIr = schemas.find(schema => schema.table === rel.targetTable);
  const sourceTable = ir.physicalTable;
  const targetTable = targetIr?.physicalTable ?? rel.targetTable;
  const physicalColumn = (schema: SchemaIR | undefined, declared: string): string => {
    if (schema === undefined) return declared;
    const separator = declared.lastIndexOf('.');
    const property = separator === -1 ? declared : declared.slice(separator + 1);
    const physical = schema.columns.find(column => column.name === property)?.physicalName;
    if (physical === undefined) return declared;
    if (separator === -1) return physical;
    const qualifier = declared.slice(0, separator);
    return `${qualifier === schema.table ? schema.physicalTable : qualifier}.${physical}`;
  };
  const parentKeys = rel.parentKey.map(column => physicalColumn(ir, column));
  const targetKeys = rel.targetKey.map(column => physicalColumn(targetIr, column));
  const physicalFilters = targetFilters.map(predicate => ({
    ...predicate,
    col: physicalColumn(targetIr, predicate.col),
  }));
  const renderFilters = (parameters: unknown[]): string => {
    if (physicalFilters.length === 0) return '';
    const body = physicalFilters
      .map((predicate, index) => {
        const rendered = renderPredicate(dialect, predicate, parameters);
        return index === 0 ? rendered : `${predicate.connector ?? 'AND'} ${rendered}`;
      })
      .join(' ');
    const grouped = targetFilters.some((predicate, index) => index > 0 && predicate.connector === 'OR');
    return `AND ${grouped ? `(${body})` : body}`;
  };

  if (rel.isManyToMany) {
    const sanitized = sanitizeKeys(parentIds);
    const through = rel.through!;
    const baseFk = rel.baseFk!;
    const targetKey = targetKeys[0] ?? 'id';

    let pivotSql: string;
    let pivotParameters: readonly unknown[];
    if (sanitized.length === 0) {
      pivotSql = `SELECT * FROM ${q(through)} WHERE 1 = 0`;
      pivotParameters = [];
    } else {
      const inList = sanitized.map((_, i) => formatPlaceholder(dialect, i + 1)).join(', ');
      pivotSql = `SELECT * FROM ${q(through)} WHERE ${q(baseFk)} IN (${inList})`;
      pivotParameters = [...sanitized];
    }

    const pivotQuery: PopulateQuery = { kind: 'batched', sql: pivotSql, parameters: pivotParameters };

    const targetQuery = (intermediateTargetIds: readonly unknown[] = []): PopulateQuery => {
      const sanitizedTargets = sanitizeKeys(intermediateTargetIds);
      if (sanitizedTargets.length === 0) {
        return {
          kind: 'batched',
          sql: `SELECT * FROM ${q(targetTable)} WHERE 1 = 0`,
          parameters: [],
        };
      }
      const parameters: unknown[] = [...sanitizedTargets];
      const whereFilters = renderFilters(parameters);
      const inList = sanitizedTargets.map((_, i) => formatPlaceholder(dialect, i + 1)).join(', ');
      return {
        kind: 'batched',
        sql: `SELECT * FROM ${q(targetTable)} WHERE ${q(targetKey)} IN (${inList})${
          whereFilters.length === 0 ? '' : ` ${whereFilters}`
        }`,
        parameters,
      };
    };

    return {
      kind: 'batched',
      sql: pivotSql,
      parameters: pivotParameters,
      pivotQuery,
      targetQuery,
    };
  }
  if (!rel.toMany) {
    const parameters: unknown[] = [];
    const filtered = physicalFilters.length > 0;
    const onFilters = renderFilters(parameters);
    const conditions = parentKeys.map((parentKey, index) => {
      const targetKey = targetKeys[index];
      if (targetKey === undefined) {
        throw new Error(`${ir.table}.${relationName}: resolved relation keys have different lengths`);
      }
      return `${q(sourceTable)}.${q(parentKey)} = ${q(targetTable)}.${q(targetKey)}`;
    });
    const sql =
      `SELECT * FROM ${q(sourceTable)} ${filtered ? 'LEFT' : 'INNER'} JOIN ${q(targetTable)} ` +
      `ON ${conditions.join(' AND ')}` +
      (onFilters.length === 0 ? '' : ` ${onFilters}`);
    return { kind: 'join', sql, parameters };
  }
  if (parentIds.length === 0) {
    return { kind: 'batched', sql: `SELECT * FROM ${q(targetTable)} WHERE 1 = 0`, parameters: [] };
  }
  if (targetKeys.length === 1) {
    const sanitized = sanitizeKeys(parentIds);
    if (sanitized.length === 0) {
      return { kind: 'batched', sql: `SELECT * FROM ${q(targetTable)} WHERE 1 = 0`, parameters: [] };
    }
    const [targetKey] = targetKeys;
    if (targetKey === undefined) {
      throw new Error(`${ir.table}.${relationName}: resolved relation has no target key`);
    }
    const inList = sanitized.map((_, i) => formatPlaceholder(dialect, i + 1)).join(', ');
    const parameters: unknown[] = [...sanitized];
    const filters = renderFilters(parameters);
    const sql =
      `SELECT * FROM ${q(targetTable)} WHERE ${q(targetKey)} IN (${inList})` +
      (filters.length === 0 ? '' : ` ${filters}`);
    return { kind: 'batched', sql, parameters };
  }
  if (dialect === 'mssql') {
    throw new UnsupportedFeatureError(
      `composite-key populate for relation "${relationName}"`,
      dialect,
      `${ir.table}.${relationName}: SQL Server does not support row-value IN for a composite-key populate`,
    );
  }
  const sanitized = sanitizeCompositeKeys(ir, relationName, parentIds, targetKeys.length);
  if (sanitized.length === 0) {
    return { kind: 'batched', sql: `SELECT * FROM ${q(targetTable)} WHERE 1 = 0`, parameters: [] };
  }
  const parameters: unknown[] = [];
  const inList = sanitized
    .map(tuple => {
      const placeholders = tuple.map(value => {
        parameters.push(value);
        return formatPlaceholder(dialect, parameters.length);
      });
      return `(${placeholders.join(', ')})`;
    })
    .join(', ');
  const columns = targetKeys.map(targetKey => q(targetKey)).join(', ');
  const filters = renderFilters(parameters);
  const sql =
    `SELECT * FROM ${q(targetTable)} WHERE (${columns}) IN (${inList})` + (filters.length === 0 ? '' : ` ${filters}`);
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
