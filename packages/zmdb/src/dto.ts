// zmdb/dto — explicit named re-exports of the read/query DTO family.
// (No `export *`: each symbol is enumerated so the compatibility surface is explicit.)
export { applyOrderBy, applyPagination, compileWhere } from '@zmdb/orm/dto';
export { buildListResult, buildSearchResult, describeAggregate, getResult, project } from '@zmdb/schema/dto';
export {
  type AggFn,
  type AggregateResult,
  type AggregateSpec,
  type ComputedSpec,
  type FieldOps,
  type GetDTO,
  type GetOptions,
  type CursorOrderByDTO,
  type CursorOrderSpec,
  type CursorPage,
  type CursorValue,
  type ListDTO,
  type ListResult,
  type OffsetPage,
  type OrderByDTO,
  type OrderDir,
  type PaginationDTO,
  type Projection,
  type SearchDTO,
  type SearchHit,
  type SearchResult,
  type WhereDTO,
} from '@zmdb/schema/dto';
export { type OrderTarget, type WhereTarget } from '@zmdb/orm/dto';
