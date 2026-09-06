import type { SqlDialect } from '@zmdb/query-compiler';
import type { DatabaseVertical, TransactionalDriver } from '@zmdb/repository';
import type { ConnectionPool } from 'mssql';

import {
  type mssql,
  type mssqlDriver,
  type mssqlIntrospector,
  type mssqlVertical,
  type MssqlOptions,
  type MssqlPool,
} from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _DialectNameIsExact = Expect<Equal<typeof mssql, SqlDialect<'mssql'>>>;
export type _IntrospectorNameIsExact = Expect<Equal<typeof mssqlIntrospector.name, 'mssql'>>;
export type _DriverReturnIsExact = Expect<Equal<ReturnType<typeof mssqlDriver>, TransactionalDriver<'mssql'>>>;
export type _VerticalContractIsExact = Expect<
  Equal<typeof mssqlVertical, DatabaseVertical<'mssql', MssqlPool, MssqlOptions>>
>;
export type _NodeMssqlPoolIsStructurallyAccepted = Expect<ConnectionPool extends MssqlPool ? true : false>;
