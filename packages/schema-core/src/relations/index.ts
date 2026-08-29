// Relations — implementation (#31). Relation DSL builders returning frozen
// RelationMeta per the frozen fixtures.

export type Cardinality =
  | 'many-to-one'
  | 'one-to-many'
  | 'one-to-one'
  | 'many-to-many';

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
