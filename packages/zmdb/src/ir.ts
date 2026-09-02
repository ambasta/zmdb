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
  dbDecodedColumns,
  decodeDbValue,
  decodeWire,
  decodeWireValue,
  encodeWire,
  encodeWireValue,
  irFromSchema,
  jsonSchemaForColumn,
  jsonSchemaFromIR,
  jsonSchemaFromShape,
  KNOWN_CONSTRAINT_KINDS,
  objectTypeFromIR,
  objectTypeFromShape,
  schemaFromIR,
  shapeOfVariant,
  SQL_TYPES,
  wireTypeOf,
} from '@zmdb/schema-core/ir';
export type {
  ArrayIR,
  Codec,
  CodecRegistry,
  ColumnIR,
  ConstraintKind,
  Constraints,
  JsonSchemaObject,
  Layer,
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
  ShapeColumnIR,
  ShapeIR,
  TupleIR,
  TypeIR,
  UndefinedIR,
  UnionIR,
  UnknownIR,
  UnsupportedIR,
  Variant,
} from '@zmdb/schema-core/ir';
