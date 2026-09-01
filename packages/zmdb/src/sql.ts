// Direct SQL compilation and DDL concern. Migration execution and catalog
// introspection live under `zmdb/migrations`.

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
  serializeComment,
  stContains,
  stDWithin,
  windowFunction,
  withComments,
} from '@zmdb/query-compiler';
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
  SchemaObjectOperation,
  SelectBuilder,
  SetValue,
  SpatialPredicate,
  SqlDialect,
  SqlDialectDefinition,
  SqlDialectExtension,
  UpdateBuilder,
  VectorColumnOf,
} from '@zmdb/query-compiler';

export { escapeFts5Term, ftsSelectFrom } from '@zmdb/query-compiler/fts';
export type { FtsOptions, FtsSelect, FtsTableOptions } from '@zmdb/query-compiler/fts';

export { joinableSelectFrom } from '@zmdb/query-compiler/joins';
export type { JoinCondition, JoinKind, JoinableSelect } from '@zmdb/query-compiler/joins';

export { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';
export type { AggregateSelect } from '@zmdb/query-compiler/aggregations';

export { SET_KEYWORD, batch, setOperation } from '@zmdb/query-compiler/set-ops';
export type { BatchHandle, SetOp } from '@zmdb/query-compiler/set-ops';

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
} from '@zmdb/query-compiler/schema-objects';
export type {
  ExtensionDef,
  GeneratedColumn,
  IndexColumn,
  IndexDef,
  IndexMethod,
  RlsPolicy,
  RoutineDef,
  RoutineSqlType,
  SequenceDef,
  ViewDef,
} from '@zmdb/query-compiler/schema-objects';

export { singularPascalCase } from '@zmdb/query-compiler/naming';
