// Relations — implementation (#31). Relation DSL builders returning frozen
// RelationMeta per the frozen fixtures.

export type Cardinality = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';

export interface RelationMeta {
  readonly cardinality: Cardinality;
  readonly target: string;
  readonly fk?: string;
  readonly mappedBy?: string;
  readonly through?: string;
  readonly owning: boolean;
}

export function manyToOne(target: string, fk: string): RelationMeta {
  return Object.freeze({ cardinality: 'many-to-one', target, fk, owning: true });
}

export function oneToMany(target: string, mappedBy: string): RelationMeta {
  return Object.freeze({ cardinality: 'one-to-many', target, mappedBy, owning: false });
}

export function oneToOne(target: string, fk: string): RelationMeta {
  return Object.freeze({ cardinality: 'one-to-one', target, fk, owning: true });
}

export function manyToMany(target: string, through: string): RelationMeta {
  return Object.freeze({ cardinality: 'many-to-many', target, through, owning: true });
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
export interface RelationDef {
  readonly meta: RelationMeta;
  readonly entity: unknown;
  readonly cardinality: Cardinality;
}
export type RelationsMap = Record<string, RelationDef>;

// The attached field type for a populated relation: array for to-many,
// single entity for to-one.
type RelationField<R extends RelationDef> = R['cardinality'] extends 'one-to-many' | 'many-to-many'
  ? R['entity'][]
  : R['entity'];

// PopulatedEntity augments Base with related fields ONLY for populated keys K.
// `Relations` is constrained structurally so plain interfaces work as relation
// maps (no string index signature required).
export type PopulatedEntity<
  Base,
  Relations extends Record<string, RelationDef> | { [K: string]: RelationDef },
  K extends keyof Relations,
> = Base & {
  [P in K]: Relations[P] extends RelationDef ? RelationField<Relations[P]> : never;
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
