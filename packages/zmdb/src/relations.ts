// zmdb/relations — explicit named re-exports of the relations surface.
export {
  aliasRow,
  attachPopulated,
  compilePopulate,
  manyToMany,
  manyToOne,
  oneToMany,
  oneToOne,
} from '@zmdb/schema-core/relations';
export type {
  Cardinality,
  JoinRow,
  PopulateDialect,
  PopulateQuery,
  PopulatedEntity,
  RelationDef,
  RelationMeta,
  RelationsMap,
} from '@zmdb/schema-core/relations';
