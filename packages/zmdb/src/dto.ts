// zmdb/dto — explicit named re-exports of the read/query DTO family.
// (No `export *`: each symbol is enumerated so the compatibility surface is explicit.)
export {
  applyOrderBy,
  applyPagination,
  buildListResult,
  buildSearchResult,
  compileWhere,
  describeAggregate,
  getResult,
  project,
} from '@zmdb/schema-core/dto';
export type {
  AggFn,
  AggregateResult,
  AggregateSpec,
  ComputedSpec,
  FieldOps,
  GetDTO,
  GetOptions,
  ListDTO,
  ListResult,
  OffsetPage,
  OrderByDTO,
  OrderDir,
  OrderTarget,
  PaginationDTO,
  Projection,
  SearchDTO,
  SearchHit,
  SearchResult,
  WhereDTO,
  WhereTarget,
} from '@zmdb/schema-core/dto';
