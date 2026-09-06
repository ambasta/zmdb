import { schemasFromFiles } from '@zmdb/aot-validator/testing';
import type { MigrationProject, SnapshotableSchema } from '@zmdb/migrations';
import { emitDeclarations } from '@zmdb/migrations/declarations';
import { dialectName, type Introspector } from '@zmdb/query-compiler';
import type { Driver } from '@zmdb/repository';
import type { FormatConfig } from 'oxfmt';

import type { ResolvedConfig } from '../config/index.js';
import { configuredDialect, configuredIntrospector } from './database.js';
import { CliInvocationError } from './errors.js';

const FORMAT_OPTIONS: FormatConfig = {
  arrowParens: 'avoid',
  bracketSpacing: true,
  endOfLine: 'lf',
  insertFinalNewline: true,
  objectWrap: 'preserve',
  printWidth: 120,
  quoteProps: 'as-needed',
  semi: true,
  singleQuote: true,
  sortImports: true,
  sortPackageJson: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
};

interface MigrationProjectOptions {
  readonly schemas?: readonly SnapshotableSchema[];
  readonly driver?: Driver;
  readonly introspector?: Introspector;
}

export function migrationProject(config: ResolvedConfig, options: MigrationProjectOptions = {}): MigrationProject {
  return {
    configPath: config.configPath,
    outDir: config.outDir,
    dialect: config.dialect,
    target: configuredDialect(config.dialect),
    schemas: options.schemas ?? [],
    emitDeclarations,
    formatSource,
    ...(config.migrations === undefined ? {} : { migrations: config.migrations }),
    ...(config.introspect === undefined ? {} : { introspect: config.introspect }),
    ...(options.driver === undefined ? {} : { driver: options.driver }),
    ...(options.introspector === undefined ? {} : { introspector: options.introspector }),
  };
}

async function formatSource(path: string, source: string): Promise<string> {
  const { format } = await import('oxfmt');
  const result = await format(path, source, FORMAT_OPTIONS);
  if (result.errors.length > 0) {
    throw new TypeError(`oxfmt could not format generated ${path}: ${JSON.stringify(result.errors)}`);
  }
  return result.code;
}

export function reflectedMigrationProject(config: ResolvedConfig, driver?: Driver): MigrationProject {
  const schemas = schemasFromFiles(config.schemaFiles, {
    project: config.project,
    naming: config.resolvedNaming,
  });
  return migrationProject(config, {
    schemas,
    ...(driver === undefined ? {} : { driver }),
    ...(driver === undefined ? {} : { introspector: configuredIntrospector(driver.dialect ?? config.dialect) }),
  });
}

export async function configuredMigrationDriver(config: ResolvedConfig): Promise<Driver> {
  if (config.driver === undefined) {
    throw new CliInvocationError(`config ${config.configPath} needs a driver for this command`);
  }
  const driver = await config.driver();
  if (driver.dialect !== undefined && dialectName(driver.dialect) !== config.dialect) {
    throw new CliInvocationError(
      `config ${config.configPath} declares ${config.dialect} but its driver declares ${dialectName(driver.dialect)}`,
    );
  }
  return driver;
}

export function rethrowProjectError(error: unknown): never {
  if (error instanceof Error && error.name === 'MigrationProjectError') {
    throw new CliInvocationError(error.message);
  }
  throw error;
}
