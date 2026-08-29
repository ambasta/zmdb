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
