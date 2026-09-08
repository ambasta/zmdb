import type { SchemaIR } from '@zmdb/schema/ir';
import { resolveRelation } from '@zmdb/schema/relations';
import {
  dialectName,
  dialectTraits,
  formatPlaceholder,
  quoteIdentifier,
  renderPredicate,
  UnsupportedFeatureError,
  type ComparisonPredicate,
  type DialectTarget,
} from '@zmdb/sql';

export type PopulateDialect = DialectTarget;

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
 * `resolveRelation`, the same call `@zmdb/orm`'s `populate` makes.
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
  if (!dialectTraits(dialect).rowValueIn) {
    const name = dialectName(dialect);
    throw new UnsupportedFeatureError(
      `composite-key populate for relation "${relationName}"`,
      name,
      `${ir.table}.${relationName}: dialect "${name}" does not support row-value IN for a composite-key populate`,
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
