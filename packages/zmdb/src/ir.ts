// zmdb/ir — explicit named re-exports of the schema IR: the one representation every
// back-end consumes. (No `export *`: each symbol is enumerated so the umbrella
// surface is explicit.)
//
// Plain data in, plain data out. Exported because a consumer generating its own
// artefacts — a client SDK, a form builder, an admin UI — needs the same
// representation the built-in emitters read, and the alternative is reverse-engineering
// `CoreSchema`.
export {
  appTypeOf,
  irFromSchema,
  jsonSchemaForColumn,
  jsonSchemaFromIR,
  KNOWN_CONSTRAINT_KINDS,
  SQL_TYPES,
  wireTypeOf,
} from '@zmdb/schema-core/ir';
export type {
  ArrayIR,
  ColumnIR,
  ConstraintKind,
  Constraints,
  JsonSchemaObject,
  LiteralIR,
  NullIR,
  ObjectIR,
  PropertyIR,
  RefIR,
  RelationIR,
  RelationKind,
  ScalarIR,
  ScalarKind,
  SchemaIR,
  TupleIR,
  TypeIR,
  UndefinedIR,
  UnionIR,
  UnknownIR,
  UnsupportedIR,
  Variant,
} from '@zmdb/schema-core/ir';
