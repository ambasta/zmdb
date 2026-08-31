// Relations — implementation (#31). Relation DSL builders returning frozen
// RelationMeta per the frozen fixtures.

import type { ColumnMeta, CoreSchema, Entity, ExtractColumns } from '../index.ts';

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

type TargetEntityOf<Target> =
  Target extends CoreSchema<string, Record<string, ColumnMeta>>
    ? Entity<Target>
    : Target extends { columns: Record<string, ColumnMeta> }
      ? Entity<Target>
      : Target;

function getTableName(target: { table: string } | string): string {
  return typeof target === 'string' ? target : target.table;
}

export function manyToOne<
  TargetSchema extends
    | CoreSchema<string, Record<string, ColumnMeta>>
    | { columns: Record<string, ColumnMeta> }
    | Record<string, ColumnMeta> = CoreSchema<string, Record<string, ColumnMeta>>,
  FK extends keyof ExtractColumns<TargetSchema> & string = keyof ExtractColumns<TargetSchema> & string,
>(target: TargetSchema | string, fk: FK): RelationMeta<TargetEntityOf<TargetSchema>, FK, 'many-to-one'>;
export function manyToOne(
  target: { table: string } | string,
  fk: string,
): RelationMeta<unknown, string, 'many-to-one'> {
  return Object.freeze({ cardinality: 'many-to-one', target: getTableName(target), fk, owning: true });
}

export function oneToMany<
  TargetSchema extends
    | CoreSchema<string, Record<string, ColumnMeta>>
    | { columns: Record<string, ColumnMeta> }
    | Record<string, ColumnMeta> = CoreSchema<string, Record<string, ColumnMeta>>,
  MappedBy extends keyof ExtractColumns<TargetSchema> & string = keyof ExtractColumns<TargetSchema> & string,
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
  TargetSchema extends
    | CoreSchema<string, Record<string, ColumnMeta>>
    | { columns: Record<string, ColumnMeta> }
    | Record<string, ColumnMeta> = CoreSchema<string, Record<string, ColumnMeta>>,
  FK extends keyof ExtractColumns<TargetSchema> & string = keyof ExtractColumns<TargetSchema> & string,
>(target: TargetSchema | string, fk: FK): RelationMeta<TargetEntityOf<TargetSchema>, FK, 'one-to-one'>;
export function oneToOne(target: { table: string } | string, fk: string): RelationMeta<unknown, string, 'one-to-one'> {
  return Object.freeze({ cardinality: 'one-to-one', target: getTableName(target), fk, owning: true });
}

export function manyToMany<
  TargetSchema extends
    | CoreSchema<string, Record<string, ColumnMeta>>
    | { columns: Record<string, ColumnMeta> }
    | Record<string, ColumnMeta> = CoreSchema<string, Record<string, ColumnMeta>>,
  Through extends string = string,
>(target: TargetSchema | string, through: Through): RelationMeta<TargetEntityOf<TargetSchema>, Through, 'many-to-many'>;
export function manyToMany(
  target: { table: string } | string,
  through: string,
): RelationMeta<unknown, string, 'many-to-many'> {
  return Object.freeze({ cardinality: 'many-to-many', target: getTableName(target), through, owning: true });
}

export type PopulateDialect = 'postgres' | 'mysql' | 'sqlite';

export interface PopulateQuery {
  readonly kind: 'join' | 'batched';
  readonly sql: string;
  readonly parameters: readonly unknown[];
}

function q(dialect: PopulateDialect, ident: string): string {
  const c = dialect === 'mysql' ? '`' : '"';
  return `${c}${ident}${c}`;
}
function placeholder(dialect: PopulateDialect, i: number): string {
  return dialect === 'postgres' ? `$${i}` : '?';
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
      `SELECT * FROM ${q(dialect, baseTable)} INNER JOIN ${q(dialect, rel.target)} ` +
      `ON ${q(dialect, baseTable)}.${q(dialect, fk)} = ${q(dialect, rel.target)}.${q(dialect, 'id')}`;
    return { kind: 'join', sql, parameters: [] };
  }
  // to-many: batched IN() select against the inverse FK on the target table.
  const fk = rel.mappedBy ?? 'id';
  const inList = parentIds.map((_, i) => placeholder(dialect, i + 1)).join(', ');
  const sql = `SELECT * FROM ${q(dialect, rel.target)} WHERE ${q(dialect, fk)} IN (${inList})`;
  return { kind: 'batched', sql, parameters: [...parentIds] };
}

// #32 — compile-time relation type derivation.
// A relations map describes each relation's target entity + cardinality.
export interface RelationDef<TargetEntity = unknown> {
  readonly meta: RelationMeta<TargetEntity>;
  readonly entity?: TargetEntity;
  readonly cardinality: Cardinality;
}
export type RelationsMap = Record<string, RelationDef | RelationMeta>;

// PopulatedEntity augments Base with related fields ONLY for populated keys K.
// `Relations` is constrained structurally so plain interfaces work as relation
// maps (no string index signature required).
export type PopulatedEntity<
  Base,
  Relations extends
    | Record<string, RelationDef<unknown> | RelationMeta<unknown>>
    | { [K: string]: RelationDef<unknown> | RelationMeta<unknown> },
  K extends keyof Relations,
> = Base & {
  [P in K]: Relations[P] extends RelationDef<infer E>
    ? [unknown] extends [E]
      ? never
      : Relations[P]['cardinality'] extends 'one-to-many' | 'many-to-many'
        ? E[]
        : E
    : Relations[P] extends RelationMeta<infer E>
      ? [unknown] extends [E]
        ? never
        : Relations[P]['cardinality'] extends 'one-to-many' | 'many-to-many'
          ? E[]
          : E
      : never;
};

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
