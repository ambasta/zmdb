// Direct SQL compilation and DDL concern. Migration execution and catalog
// introspection live under `@zmdb/core/migrations`.

export {
  DISTANCE_OPERATORS,
  EXPR,
  OP_MAP,
  QueryCompilerError,
  UnsupportedFeatureError,
  appendComment,
  coalesce,
  concat,
  createQueryCompiler,
  dec,
  defineSqlDialect,
  dialectCapabilities,
  dialectFamily,
  dialectName,
  dialectSupportsReturning,
  dialectTraits,
  distance,
  extendSqlDialect,
  formatPlaceholder,
  inc,
  isSqlDialect,
  mul,
  not,
  proposed,
  quoteColumn,
  quoteIdentifier,
  quoteTable,
  renderPredicate,
  renumberPlaceholders,
  sanitizeExpression,
  serializeComment,
  stContains,
  stDWithin,
  withComments,
} from '@zmdb/sql';
export type {
  AliasedColumn,
  AliasedDistanceExpression,
  ColumnExpr,
  CommentKey,
  CommentKeys,
  CommentPairs,
  ComparisonPredicate,
  CompiledQuery,
  DatabaseCapabilities,
  DeleteBuilder,
  DialectFeature,
  DialectSqlType,
  DialectTarget,
  DialectTypeMap,
  Direction,
  DistanceExpression,
  DistanceOp,
  ExtensionColumnOf,
  GeoJsonGeometry,
  GeometryColumnOf,
  GeometryValueOf,
  InsertBuilder,
  OnConflictBuilder,
  Operator,
  PaginationTail,
  PlaceholderStyle,
  Predicate,
  PredicateGroup,
  QueryCompiler,
  QueryCompilerOptions,
  QueryTelemetry,
  ResolvedDialectTraits,
  ReturningCapability,
  ReturningStatement,
  ReturningStyle,
  SanitizedExpression,
  SchemaObjectOperation,
  SelectBuilder,
  SetValue,
  SpatialPredicate,
  SqlDialect,
  SqlDialectDefinition,
  SqlDialectExtension,
  UpdateBuilder,
  VectorColumnOf,
} from '@zmdb/sql';

export { escapeFts5Term, ftsSelectFrom } from '@zmdb/sql/fts';
export { type FtsOptions, type FtsSelect, type FtsTableOptions } from '@zmdb/sql/fts';

export { joinableSelectFrom } from '@zmdb/sql/joins';
export { type JoinCondition, type JoinKind, type JoinableSelect } from '@zmdb/sql/joins';

export { aggregateSelectFrom } from '@zmdb/sql/aggregations';
export { type AggregateSelect } from '@zmdb/sql/aggregations';

export { SET_KEYWORD, batch, setOperation } from '@zmdb/sql/set-ops';
export { type BatchHandle, type SetOp } from '@zmdb/sql/set-ops';

export {
  checkConstraintDdl,
  createExtensionDdl,
  createIndexDdl,
  createPolicyDdl,
  createRoutineDdl,
  createSchemaDdl,
  createSequenceDdl,
  createViewDdl,
  ddlType,
  dropRoutineDdl,
  dropViewDdl,
  enableRlsDdl,
  generatedColumnDdl,
  qualify,
  quoteId,
  replaceRoutineStatements,
  routineFingerprint,
} from '@zmdb/sql/schema-objects';
export {
  type ExtensionDef,
  type GeneratedColumn,
  type IndexColumn,
  type IndexDef,
  type IndexMethod,
  type RlsPolicy,
  type RoutineDef,
  type RoutineSqlType,
  type SequenceDef,
  type ViewDef,
} from '@zmdb/sql/schema-objects';

export { singularPascalCase } from '@zmdb/schema/naming';
