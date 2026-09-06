import {
  dialectName,
  type Introspector,
  type IntrospectOptions,
  type SchemaSnapshot,
  type SqlDialect,
} from '@zmdb/query-compiler';

import type { SnapshotableSchema } from './index.js';
import type { CatalogWarning } from './introspect/index.js';
import type { MigrationDriver } from './runner.js';

export interface MigrationProject {
  readonly configPath: string;
  readonly outDir: string;
  readonly dialect: SqlDialect;
  readonly schemas: readonly SnapshotableSchema[];
  readonly migrations?: {
    readonly table?: string;
    readonly schema?: string;
  };
  readonly introspect?: IntrospectOptions;
  readonly driver?: MigrationDriver;
  /** Database-owned catalog reader selected by the caller. */
  readonly introspector?: Introspector;
  /**
   * Declaration generation is injected so the root lifecycle graph does not
   * acquire the formatter owned by `@zmdb/migrations/declarations`.
   */
  readonly emitDeclarations?: (
    snapshot: SchemaSnapshot,
    options: { readonly dialect: SqlDialect },
  ) => Promise<{
    readonly files: readonly { readonly path: string; readonly source: string }[];
    readonly warnings: readonly CatalogWarning[];
  }>;
  /**
   * Generated migration modules are formatted by the caller. The CLI supplies
   * its pinned formatter while non-CLI consumers may provide an equivalent
   * deterministic implementation.
   */
  readonly formatSource?: (path: string, source: string) => Promise<string>;
}

export class MigrationProjectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationProjectError';
  }
}

export function requiredDriver(project: MigrationProject): MigrationDriver {
  const driver = project.driver;
  if (driver === undefined) {
    throw new MigrationProjectError(`config ${project.configPath} needs a driver for this operation`);
  }
  if (driver.dialect !== undefined && dialectName(driver.dialect) !== dialectName(project.dialect)) {
    throw new MigrationProjectError(
      `config ${project.configPath} declares ${dialectName(project.dialect)} but its driver declares ${dialectName(driver.dialect)}`,
    );
  }
  return driver;
}

export function migrationTarget(project: MigrationProject): SqlDialect {
  return project.dialect;
}

export function requiredDeclarationEmitter(
  project: MigrationProject,
): NonNullable<MigrationProject['emitDeclarations']> {
  const emitDeclarations = project.emitDeclarations;
  if (emitDeclarations === undefined) {
    throw new MigrationProjectError(`config ${project.configPath} needs a declaration emitter for this operation`);
  }
  return emitDeclarations;
}

export function requiredIntrospector(project: MigrationProject): Introspector {
  const introspector = project.introspector;
  if (introspector === undefined) {
    throw new MigrationProjectError(`config ${project.configPath} needs an introspector for this operation`);
  }
  return introspector;
}

export function requiredSourceFormatter(project: MigrationProject): NonNullable<MigrationProject['formatSource']> {
  const formatSource = project.formatSource;
  if (formatSource === undefined) {
    throw new MigrationProjectError(`config ${project.configPath} needs a source formatter for this operation`);
  }
  return formatSource;
}
