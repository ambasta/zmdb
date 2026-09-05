// Type-level half of issue #506's six-dialect matrix.
//
// Runtime tests can call the future dialect strings through one checked reflection
// boundary, but the public surface must eventually name them. `@ts-expect-error`
// is the type-level equivalent of `it.fails`: every directive is needed at the
// frozen base and becomes TS2578 the moment the implementation makes its claim
// true, forcing the implementation slice to retire the marker.
//
// No declaration-only value is used here. Every value below is a real initializer,
// so the file cannot claim a callable boundary exists without asking the real API.
import { DIALECT_PARAM_LIMITS, createQueryCompiler, type Dialect } from '../index.js';
import type { ChangeOp, TableSnapshot } from '../migrations/index.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type FrozenDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'cockroach' | 'singlestore';

// @ts-expect-error frozen (#506): the public Dialect union grows to all six entries.
export type _DialectIsTheFrozenSix = Expect<Equal<Dialect, FrozenDialect>>;

// @ts-expect-error frozen (#506): every dialect-keyed table gains all six entries.
export const frozenParameterLimits: Readonly<Record<FrozenDialect, number>> = DIALECT_PARAM_LIMITS;

export const mssqlCompiler = createQueryCompiler('mssql');
// @ts-expect-error frozen (#506): the real public factory accepts CockroachDB.
export const cockroachCompiler = createQueryCompiler('cockroach');
// @ts-expect-error frozen (#506): the real public factory accepts SingleStore.
export const singlestoreCompiler = createQueryCompiler('singlestore');

interface FrozenTableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

// @ts-expect-error frozen (dialects/SPEC.md §5.1): a snapshot carries table-level distribution/storage options.
export type _SnapshotCarriesTableOptions = Expect<Equal<TableSnapshot['tableOptions'], FrozenTableOptions | undefined>>;

type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;

// @ts-expect-error frozen (dialects/SPEC.md §5.1): create_table carries the snapshot's table options into DDL.
type CreateTableOptions = CreateTable['tableOptions'];
export type _CreateTableCarriesTableOptions = Expect<Equal<CreateTableOptions, FrozenTableOptions | undefined>>;
