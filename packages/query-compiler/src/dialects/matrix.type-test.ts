// Type-level half of issue #506's six-dialect matrix.
//
// The frozen six-member public surface. These equalities make widening or
// accidentally dropping a dialect a typecheck failure.
//
// No declaration-only value is used here. Every value below is a real initializer,
// so the file cannot claim a callable boundary exists without asking the real API.
import { mssql } from '../../../mssql/src/index.js';
import { DIALECT_PARAM_LIMITS, createQueryCompiler, type BuiltInDialect, type Dialect } from '../index.js';
import type { ChangeOp, TableSnapshot } from '../migrations/index.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type FrozenDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'cockroach' | 'singlestore';

export type _DialectIsTheFrozenSix = Expect<Equal<Dialect, FrozenDialect>>;

export const frozenBuiltInParameterLimits: Readonly<Record<BuiltInDialect, number>> = DIALECT_PARAM_LIMITS;
export const mssqlParameterLimit: number = mssql.traits.paramLimit;

export const mssqlCompiler = createQueryCompiler(mssql);
export const cockroachCompiler = createQueryCompiler('cockroach');
export const singlestoreCompiler = createQueryCompiler('singlestore');

interface FrozenTableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

export type _SnapshotCarriesTableOptions = Expect<Equal<TableSnapshot['tableOptions'], FrozenTableOptions | undefined>>;

type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;

type CreateTableOptions = CreateTable['tableOptions'];
export type _CreateTableCarriesTableOptions = Expect<Equal<CreateTableOptions, FrozenTableOptions | undefined>>;
