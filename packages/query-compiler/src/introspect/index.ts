import type { CompiledQuery, Dialect } from '../index.js';
import type { CatalogSchemaSnapshot } from './common.js';
import { mysqlIntrospector } from './mysql.js';
import { postgresIntrospector } from './postgres.js';
import { sqliteIntrospector } from './sqlite.js';

export {
  emitDeclarations,
  type EmitDeclarationsResult,
  type EmittedDeclarationFile,
  type EmitOptions,
} from './emit.js';
export { detectDrift, type DriftOptions, type DriftReport } from './drift.js';
export {
  CatalogRowError,
  type CatalogColumnSnapshot,
  type CatalogForeignKeySnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type CatalogWarning,
  type ReferentialAction,
} from './common.js';

export interface IntrospectionDriver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface IntrospectOptions {
  readonly schemas?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
}

export interface Introspector {
  readonly dialect: Dialect;
  snapshot(driver: IntrospectionDriver, options?: IntrospectOptions): Promise<CatalogSchemaSnapshot>;
}

export function createIntrospector(dialect: Dialect): Introspector {
  switch (dialect) {
    case 'postgres':
      return postgresIntrospector;
    case 'mysql':
      return mysqlIntrospector;
    case 'sqlite':
      return sqliteIntrospector;
  }
}
