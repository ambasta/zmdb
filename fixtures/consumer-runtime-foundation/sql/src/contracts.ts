import {
  createQueryCompiler,
  type CompiledQuery,
  type SqlDialect,
  type QueryCompiler,
  type SelectBuilder,
  type Introspector,
  type MigrationConnection,
} from '@zmdb/sql';

import { dialect } from './dialect.js';

const injected: SqlDialect<'acme'> = dialect;
const compiler: QueryCompiler = createQueryCompiler(dialect);
const select: SelectBuilder = compiler.selectFrom('users').select(['id']);
const query: CompiledQuery = select.where('id', '=', 1).compile();

void [query, injected];

// @ts-expect-error The SQL root accepts an injected dialect, not a historical vendor name.
createQueryCompiler('postgres');
// @ts-expect-error Schema naming belongs to the independent schema root.
export type { singularPascalCase } from '@zmdb/sql';
// @ts-expect-error The historical dialect alias is absent.
export type { Dialect } from '@zmdb/sql';

declare const introspector: Introspector<'acme'>;
declare const connection: MigrationConnection<'acme'>;
// @ts-expect-error The canonical protocol names its dialect through name.
void introspector.dialect;
// @ts-expect-error Migration connections retain name, not the obsolete alias.
void connection.dialect;
