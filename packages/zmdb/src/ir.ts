// zmdb/ir — explicit named re-exports of the schema IR: the one representation every
// back-end consumes. (No `export *`: each symbol is enumerated so the compatibility
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
  jsonSchemaForColumn,
  jsonSchemaFromIR,
  jsonSchemaFromShape,
  jsonSchemaFromTypeIR,
  KNOWN_CONSTRAINT_KINDS,
  objectTypeFromIR,
  objectTypeFromShape,
  PROTO_SCALARS,
  RELATION_KINDS,
  schemaFromIR,
  shapeOfVariant,
  SQL_TYPES,
  wireTypeOf,
} from '@zmdb/schema/ir';
export {
  type ArrayIR,
  type Codec,
  type CodecRegistry,
  type ColumnIR,
  type ConstraintKind,
  type Constraints,
  type ExtensionType,
  type JsonSchemaObject,
  type JsonValue,
  type Layer,
  type LiteralIR,
  type NullIR,
  type ObjectIR,
  type PropertyIR,
  type ProtoScalar,
  type RefIR,
  type RelationIR,
  type RelationKind,
  type ScalarIR,
  type ScalarKind,
  type SchemaIR,
  type ShapeColumnIR,
  type ShapeIR,
  type TupleIR,
  type TypeIR,
  type UndefinedIR,
  type UnionIR,
  type UnknownIR,
  type UnsupportedIR,
  type Variant,
} from '@zmdb/schema/ir';
