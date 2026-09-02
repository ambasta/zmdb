import { quoteIdentifier, formatPlaceholder, type Dialect } from '@zmdb/query-compiler';
// Relations — implementation (#31). Relation DSL builders returning frozen
// RelationMeta per the frozen fixtures.

import type { ColumnKeys, DeclaredTable } from '../derive/index.ts';
import type { ColumnsMap, CoreSchema, Entity, TaggedSchema } from '../index.ts';

export type Cardinality = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';

export interface RelationMeta<
  TargetEntity = unknown,
  _Key extends string = string,
  C extends Cardinality = Cardinality,
> {
  readonly cardinality: C;
  readonly target: string;
  readonly fk?: string;
  readonly mappedBy?: string;
  readonly through?: string;
  readonly owning: boolean;
  /** Compile-time phantom property preserving target entity type */
  readonly _targetEntity?: TargetEntity;
}

/**
 * The row type of a relation target.
 *
 * The same crossing as `ColumnNameOf` below, for the same reason: the target is named by
 * *value* because the runtime needs its table, so the declared type comes back off the
 * phantom. A target named by a bare string has no declared type to recover, and says so.
 */
type TargetEntityOf<Target> = Target extends TaggedSchema<infer T extends DeclaredTable> ? Entity<T> : unknown;

function getTableName(target: { table: string } | string): string {
  return typeof target === 'string' ? target : target.table;
}

/** What the relation builders accept as a target: a full schema, anything carrying a `columns` bag, or a bare columns map. */
type RelationTarget = CoreSchema<string> | { columns: ColumnsMap } | ColumnsMap;
/**
 * The column names of a relation target, which is what an fk / mappedBy has to name.
 *
 * A `TaggedSchema<T>` erases its column map to `Record<string, ColumnMeta>` — the *value*
 * has no literal keys to read — so asking it for `keyof columns` answers `string`, and
 * `manyToOne(users, 'bad_col')` would compile. The phantom is where the answer went, so
 * that is where this looks first: same question, asked of the type the schema came from.
 * The other two arms are for a bare columns bag, which some fixtures still pass.
 */
type ColumnNameOf<Target> =
  Target extends TaggedSchema<infer T>
    ? ColumnKeys<T>
    : Target extends { readonly columns: infer C }
      ? keyof C & string
      : keyof Target & string;

export function manyToOne<
  TargetSchema extends RelationTarget = CoreSchema<string>,
  FK extends ColumnNameOf<TargetSchema> = ColumnNameOf<TargetSchema>,
>(target: TargetSchema | string, fk: FK): RelationMeta<TargetEntityOf<TargetSchema>, FK, 'many-to-one'>;
export function manyToOne(
  target: { table: string } | string,
  fk: string,
): RelationMeta<unknown, string, 'many-to-one'> {
  return Object.freeze({ cardinality: 'many-to-one', target: getTableName(target), fk, owning: true });
}

export function oneToMany<
  TargetSchema extends RelationTarget = CoreSchema<string>,
  MappedBy extends ColumnNameOf<TargetSchema> = ColumnNameOf<TargetSchema>,
>(
  target: TargetSchema | string,
  mappedBy: MappedBy,
): RelationMeta<TargetEntityOf<TargetSchema>, MappedBy, 'one-to-many'>;
export function oneToMany(
  target: { table: string } | string,
  mappedBy: string,
): RelationMeta<unknown, string, 'one-to-many'> {
  return Object.freeze({ cardinality: 'one-to-many', target: getTableName(target), mappedBy, owning: false });
}

export function oneToOne<
  TargetSchema extends RelationTarget = CoreSchema<string>,
  FK extends ColumnNameOf<TargetSchema> = ColumnNameOf<TargetSchema>,
>(target: TargetSchema | string, fk: FK): RelationMeta<TargetEntityOf<TargetSchema>, FK, 'one-to-one'>;
export function oneToOne(target: { table: string } | string, fk: string): RelationMeta<unknown, string, 'one-to-one'> {
  return Object.freeze({ cardinality: 'one-to-one', target: getTableName(target), fk, owning: true });
}

export function manyToMany<TargetSchema extends RelationTarget = CoreSchema<string>, Through extends string = string>(
  target: TargetSchema | string,
  through: Through,
): RelationMeta<TargetEntityOf<TargetSchema>, Through, 'many-to-many'>;
export function manyToMany(
  target: { table: string } | string,
  through: string,
): RelationMeta<unknown, string, 'many-to-many'> {
  return Object.freeze({ cardinality: 'many-to-many', target: getTableName(target), through, owning: true });
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

// #33 — compile a populate hint into deterministic SQL.
// to-one (many-to-one / one-to-one) → INNER JOIN on the owning FK.
// to-many (one-to-many / many-to-many) → batched IN() select on the FK.
export function compilePopulate(
  baseTable: string,
  _relationName: string,
  rel: RelationMeta,
  dialect: PopulateDialect,
  parentIds: readonly unknown[] = [],
): PopulateQuery {
  const toOne = rel.cardinality === 'many-to-one' || rel.cardinality === 'one-to-one';
  if (toOne) {
    const fk = rel.fk ?? 'id';
    const sql =
      `SELECT * FROM ${quoteIdentifier(dialect, baseTable)} INNER JOIN ${quoteIdentifier(dialect, rel.target)} ` +
      `ON ${quoteIdentifier(dialect, baseTable)}.${quoteIdentifier(dialect, fk)} = ${quoteIdentifier(dialect, rel.target)}.${quoteIdentifier(dialect, 'id')}`;
    return { kind: 'join', sql, parameters: [] };
  }
  // to-many: batched IN() select against the inverse FK on the target table.
  const sanitized = sanitizeKeys(parentIds);
  const fk = rel.mappedBy ?? 'id';
  if (sanitized.length === 0) {
    const sql = `SELECT * FROM ${quoteIdentifier(dialect, rel.target)} WHERE 1 = 0`;
    return { kind: 'batched', sql, parameters: [] };
  }
  const inList = sanitized.map((_, i) => formatPlaceholder(dialect, i + 1)).join(', ');
  const sql = `SELECT * FROM ${quoteIdentifier(dialect, rel.target)} WHERE ${quoteIdentifier(dialect, fk)} IN (${inList})`;
  return { kind: 'batched', sql, parameters: [...sanitized] };
}

// #32 — compile-time relation type derivation.
// A relations map describes each relation's target entity + cardinality.
export interface RelationDef<TargetEntity = unknown> {
  readonly meta?: RelationMeta<TargetEntity> | undefined;
  readonly entity?: TargetEntity | TaggedSchema<unknown> | undefined;
  readonly cardinality?: Cardinality | undefined;
}
export type RelationsMap = Record<string, RelationDef | RelationMeta>;

// A relations map may name its child either way round: by the schema value, which is what
// the runtime needs, or by the declared type. This is the one place that has to tell them
// apart, and the phantom is how.
type DerivedEntity<T> = T extends TaggedSchema<infer Declared extends DeclaredTable> ? Entity<Declared> : T;

type RelationEntityFromDef<D> =
  D extends RelationMeta<infer E>
    ? [unknown] extends [E]
      ? D extends { entity: infer Ent }
        ? DerivedEntity<NonNullable<Ent>>
        : never
      : DerivedEntity<E>
    : D extends RelationDef<infer E>
      ? [unknown] extends [E]
        ? D extends { entity: infer Ent }
          ? DerivedEntity<NonNullable<Ent>>
          : never
        : DerivedEntity<E>
      : D extends { entity: infer Ent }
        ? DerivedEntity<NonNullable<Ent>>
        : D extends { meta: RelationMeta<infer E> }
          ? DerivedEntity<E>
          : never;

type RelationCardinalityFromDef<D> =
  D extends RelationMeta<unknown, string, infer MC>
    ? MC
    : D extends { cardinality: infer C }
      ? C
      : D extends { meta: { cardinality: infer MC } }
        ? MC
        : never;

// PopulatedEntity augments Base with related fields ONLY for populated keys K.
// `Relations` is constrained structurally so plain interfaces work as relation
// maps (no string index signature required).
export type PopulatedEntity<
  Base,
  Relations extends Record<string, unknown> | { [K: string]: unknown },
  K extends keyof Relations = keyof Relations,
> = Base & {
  [P in K]: RelationCardinalityFromDef<Relations[P]> extends 'one-to-many' | 'many-to-many'
    ? RelationEntityFromDef<Relations[P]>[]
    : RelationEntityFromDef<Relations[P]>;
};

export type Populated<
  Base,
  Relations extends Record<string, unknown> | { [K: string]: unknown },
  K extends keyof Relations = keyof Relations,
> = PopulatedEntity<Base, Relations, K>;

// #191 — attach a populated relation to a parent (non-mutating). Returns a new
// object with `name` set to the related value (array for to-many, object/null
// for to-one). Type widening is expressed by PopulatedEntity above.
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

// #194 — typed join result rows. LEFT: joined columns may be absent.
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
