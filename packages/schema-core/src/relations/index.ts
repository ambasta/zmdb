// Relations — API stubs (red phase). Implementation in #31–#34.

const NOT_IMPL = 'not implemented';

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

export function manyToOne(_target: string, _fk: string): RelationMeta {
  throw new Error(NOT_IMPL);
}
export function oneToMany(_target: string, _mappedBy: string): RelationMeta {
  throw new Error(NOT_IMPL);
}
export function oneToOne(_target: string, _fk: string): RelationMeta {
  throw new Error(NOT_IMPL);
}
export function manyToMany(_target: string, _through: string): RelationMeta {
  throw new Error(NOT_IMPL);
}
