// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type ChangeOp, type TableSnapshot } from '@zmdb/migrations';
import { createQueryCompiler, type SqlDialect } from '@zmdb/sql';

import {
  cockroachDialect,
  mssqlDialect,
  mysqlDialect,
  officialDialects,
  postgresDialect,
  singlestoreDialect,
  sqliteDialect,
  type OfficialDialectName,
} from '../testing/official-dialects.fixture.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type FrozenDialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'cockroach' | 'singlestore';
export type _DialectNamesAreTheFrozenSix = Expect<Equal<OfficialDialectName, FrozenDialect>>;

export const frozenBuiltInParameterLimits: Readonly<Record<OfficialDialectName, number>> = Object.freeze({
  cockroach: cockroachDialect.traits.paramLimit,
  mssql: mssqlDialect.traits.paramLimit,
  mysql: mysqlDialect.traits.paramLimit,
  postgres: postgresDialect.traits.paramLimit,
  singlestore: singlestoreDialect.traits.paramLimit,
  sqlite: sqliteDialect.traits.paramLimit,
});

export const officialDialectObjects: Readonly<Record<OfficialDialectName, SqlDialect>> = officialDialects;
export const officialCompilers = Object.fromEntries(
  Object.entries(officialDialects).map(([name, dialect]) => [name, createQueryCompiler(dialect)]),
) as Readonly<Record<OfficialDialectName, ReturnType<typeof createQueryCompiler>>>;

interface FrozenTableOptions {
  readonly shardKey?: readonly string[];
  readonly sortKey?: readonly string[];
  readonly rowstore?: true;
}

export type _SnapshotCarriesTableOptions = Expect<Equal<TableSnapshot['tableOptions'], FrozenTableOptions | undefined>>;
type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;
export type _CreateTableCarriesTableOptions = Expect<
  Equal<CreateTable['tableOptions'], FrozenTableOptions | undefined>
>;
