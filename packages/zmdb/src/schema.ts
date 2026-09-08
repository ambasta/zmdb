// Complete schema concern: declarations, derivation, DTOs, relations, IR,
// JSON Schema, custom codecs, and naming. Every name delegates by identity.

export { ValidationError, claimsValidationIssues, validationIssuesOf } from '@zmdb/validator';
export { aliasRow, attachPopulated, compilePopulate } from '@zmdb/orm/relations';
export { applyOrderBy, applyPagination, compileWhere } from '@zmdb/orm/dto';
export { buildListResult, isRecord, resolveRelation, schemaOf } from '@zmdb/schema';
export { createStateUpdatePayload, defineEntityStateMachine, defineStateTransitions } from '@zmdb/schema';
export {
  type AllowedTargetStates,
  type EntityStateMachine,
  type EntityStateMachineOptions,
  type StateTransitions,
  type StateUpdateDTO,
} from '@zmdb/schema';
export {
  type ColumnFlags,
  type ColumnMeta,
  type ColumnsMap,
  type CoreSchema,
  type CreateDTO,
  type DeclaredTable,
  type Entity,
  type ListDTO,
  type ListResult,
  type OrderByDTO,
  type PaginationDTO,
  type Populated,
  type PopulatedEntity,
  type PrimaryKeyOf,
  type ReadDTO,
  type ResolvedRelation,
  type SqlType,
  type TaggedSchema,
  type UpdateDTO,
  type ValidationRule,
  type WhereDTO,
} from '@zmdb/schema';
export { type JoinRow, type PopulateDialect, type PopulateQuery } from '@zmdb/orm/relations';
export { type OrderTarget } from '@zmdb/orm/dto';
export { type ValidationIssue } from '@zmdb/validator';

export {
  type AnyRelation,
  type Codec,
  type ColumnSqlType,
  type Ext,
  type ForeignKey,
  type Fts,
  type HasDefault,
  type Length,
  type ManyToMany,
  type ManyToOne,
  type Max,
  type MaxLength,
  type Min,
  type MinLength,
  type NonNull,
  type Nullable,
  type Numeric,
  type OnDelete,
  type OnUpdate,
  type OneToMany,
  type OneToOne,
  type Pattern,
  type Physical,
  type PrimaryKey,
  type Proto,
  type ProtoField,
  type References,
  type ReferentialAction,
  type RelationKind,
  type Rowstore,
  type Rule,
  type Sensitive,
  type Serial,
  type ShardKey,
  type SoftDelete,
  type SortKey,
  type Sql,
  type Table,
  type Unique,
  type WireAs,
} from '@zmdb/schema/tags';

export {
  type ColumnKeys,
  type DefaultKeys,
  type GetDTO,
  type GetOptions,
  type KeysCarrying,
  type NullableKeys,
  type PrimaryKeyKeys,
  type Projection,
  type RelationKeys,
  type SensitiveKeys,
  type SerialKeys,
  type SoftDeleteKeys,
  type UniqueKeys,
  type Wire,
  type WireCreateDTO,
} from '@zmdb/schema/derive';

export { applyKeysetFilter } from '@zmdb/orm/dto';
export { buildSearchResult, decodeCursor, describeAggregate, encodeCursor, getResult, project } from '@zmdb/schema/dto';
export {
  type AggFn,
  type AggregateColumn,
  type AggregateResult,
  type AggregateSpec,
  type ComputedSpec,
  type FieldOps,
  type CursorOrderByDTO,
  type CursorOrderSpec,
  type CursorPage,
  type CursorValue,
  type OffsetPage,
  type OrderBySpec,
  type OrderDir,
  type PaginationSpec,
  type SearchDTO,
  type SearchHit,
  type SearchResult,
  type SubqueryTarget,
  type UnknownRow,
} from '@zmdb/schema/dto';
export { type WhereTarget } from '@zmdb/orm/dto';

export {
  KNOWN_CONSTRAINT_KINDS,
  PROTO_SCALARS,
  RELATION_KINDS,
  SQL_TYPES,
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
  objectTypeFromIR,
  objectTypeFromShape,
  schemaFromIR,
  shapeOfVariant,
  wireTypeOf,
} from '@zmdb/schema/ir';
export {
  type ArrayIR,
  type CodecRegistry,
  type ColumnIR,
  type ConstraintKind,
  type Constraints,
  type ExtensionType,
  type ForeignKeyIR,
  type JsonValue,
  type Layer,
  type LiteralIR,
  type NullIR,
  type ObjectIR,
  type PropertyIR,
  type ProtoScalar,
  type RefIR,
  type RelationIR,
  type ScalarIR,
  type ScalarKind,
  type SchemaIR,
  type ShapeColumnIR,
  type ShapeIR,
  type TableOptions,
  type TagField,
  type TupleIR,
  type TypeIR,
  type UndefinedIR,
  type UnionIR,
  type UnknownIR,
  type UnsupportedIR,
} from '@zmdb/schema/ir';

export {
  componentName,
  toJsonSchema,
  toJsonSchemaWithRelations,
  toListSchema,
  toOpenApiComponents,
  toSearchSchema,
} from '@zmdb/schema/openapi';
export { type EnvelopeSchema, type JsonSchemaObject, type Variant } from '@zmdb/schema/openapi';

export { decodeValue, defineType, encodeValue, wireCodec } from '@zmdb/schema/custom-types';
export { type CustomType } from '@zmdb/schema/custom-types';

export { resolveNaming, snakeCase, snakeCasePlural } from '@zmdb/schema/naming';
export { type NamingStrategy, type NamingStrategyConfig, type NamingStrategyName } from '@zmdb/schema/naming';
