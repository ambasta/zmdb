// Type-level tests for FieldOps operator restrictions and WhereDTO.
// No runtime code: this file is a compile-time gate evaluated by `tsc`.
import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.ts';
import type { FieldOps, WhereDTO } from './index.ts';

interface TestEntity extends Table<'test'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  isTrue: boolean & Sql<'boolean'>;
  count: number & Sql<'integer'>;
  name: string & Sql<'text'>;
}

// Boolean fields allow eq, ne, in, nin, isNull, notNull, but reject range/pattern
export type _BoolOpsLt = FieldOps<boolean>['lt']; // undefined
export type _BoolOpsLike = FieldOps<boolean>['like']; // undefined

// Number fields allow eq, ne, in, nin, lt, lte, gt, gte, isNull, notNull, but reject pattern
export type _NumOpsLt = FieldOps<number>['lt'];
export type _NumOpsLike = FieldOps<number>['like']; // undefined

// String fields allow eq, ne, in, nin, lt, lte, gt, gte, like, ilike, isNull, notNull
export type _StrOpsLike = FieldOps<string>['like'];

// WhereDTO mapping works for TestEntity
export type _WhereDTOType = WhereDTO<TestEntity>;
