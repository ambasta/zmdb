import { type mssql, type mssqlDriver, type mssqlIntrospector, type MssqlPool } from '@zmdb/mssql';
import type { SqlDialect } from '@zmdb/query-compiler';
import type { TransactionalDriver } from '@zmdb/repository';
import type { ConnectionPool } from 'mssql';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _PublishedDialectIsExact = Expect<Equal<typeof mssql, SqlDialect<'mssql'>>>;
export type _PublishedDriverIsTransactional = Expect<
  Equal<ReturnType<typeof mssqlDriver>, TransactionalDriver<'mssql'>>
>;
export type _PublishedIntrospectorIsNamed = Expect<Equal<typeof mssqlIntrospector.name, 'mssql'>>;
export type _RealConnectionPoolFitsStructuralBoundary = Expect<ConnectionPool extends MssqlPool ? true : false>;
