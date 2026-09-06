import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { schemasFromFiles } from '@zmdb/aot-validator/testing';
import { isSqlDialect, type DialectTarget } from '@zmdb/query-compiler';
import { diff, emitDown, emitUp, snapshot, type ChangeOp, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';

import type { ResolvedConfig } from '../../config/index.js';
import { writeTextAtomically } from '../atomic.js';
import { configuredDialect } from '../database.js';

const EMPTY_SNAPSHOT: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

export type GenerateResult =
  | { readonly ops: readonly ChangeOp[] }
  | {
      readonly file: string;
      readonly version: number;
      readonly name: string;
      readonly ops: readonly ChangeOp[];
    };

export interface GenerateOptions {
  readonly name?: string;
  readonly now?: Date;
}

/** Load declarations, diff once, emit the plan unchanged, and persist both artefacts. */
export async function generateMigration(
  config: ResolvedConfig,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const schemas = schemasFromFiles(config.schemaFiles, {
    project: config.project,
    naming: config.resolvedNaming,
  });
  const next = snapshot(schemas);
  const snapshotPath = join(config.outDir, 'snapshot.json');
  const previous = await readSnapshot(snapshotPath);
  const ops = diff(previous, next, { dialect: config.dialect });
  if (ops.length === 0) return { ops };

  const name = migrationName(options.name, ops);
  const versionText = migrationVersion(options.now ?? new Date());
  const migrationPath = join(config.outDir, `${versionText}_${name}.sql`);
  const dialect = configuredDialect(config.dialect);
  const up = ops.map(operation => configuredEmitUp(operation, dialect));
  const down = downStatements(ops, previous, dialect);
  const migration = `-- zmdb:up\n${statements(up)}-- zmdb:down\n${statements(down)}`;

  await writeTextAtomically(migrationPath, migration);
  await writeTextAtomically(snapshotPath, `${JSON.stringify(next, null, 2)}\n`);

  return {
    file: migrationPath,
    version: Number(versionText),
    name,
    ops,
  };
}

function downStatements(ops: readonly ChangeOp[], previous: SchemaSnapshot, dialect: DialectTarget): readonly string[] {
  return ops
    .toReversed()
    .filter(operation => operation.kind !== 'create_extension')
    .map(operation => {
      if (operation.kind !== 'drop_foreign_key') {
        return isSqlDialect(dialect) ? emitDown(dialect.migrations, operation) : emitDown(operation, dialect);
      }
      const table = previous.tables.find(candidate => candidate.name === operation.table);
      const foreignKey = table?.foreignKeys?.find(candidate => candidate.name === operation.name);
      if (foreignKey === undefined) {
        throw new Error(
          `cannot generate the down migration for foreign key "${operation.name}" on "${operation.table}": ` +
            'the previous snapshot does not contain its columns and referential actions',
        );
      }
      return configuredEmitUp({ kind: 'add_foreign_key', table: operation.table, fk: foreignKey }, dialect);
    });
}

function configuredEmitUp(operation: ChangeOp, dialect: DialectTarget): string {
  return isSqlDialect(dialect) ? emitUp(dialect.migrations, operation) : emitUp(operation, dialect);
}

async function readSnapshot(path: string): Promise<SchemaSnapshot> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return EMPTY_SNAPSHOT;
    throw new Error(
      `could not read stored snapshot ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

function migrationVersion(now: Date): string {
  return now.toISOString().replaceAll(/\D/g, '').slice(0, 14);
}

function migrationName(requested: string | undefined, ops: readonly ChangeOp[]): string {
  const source = requested ?? derivedName(ops);
  const slug = source
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
  if (slug.length === 0) throw new Error(`migration name ${JSON.stringify(source)} has no letters or digits`);
  return slug;
}

function derivedName(ops: readonly ChangeOp[]): string {
  if (ops.length !== 1) return 'schema_change';
  const operation = ops[0];
  if (operation === undefined) return 'schema_change';
  switch (operation.kind) {
    case 'create_extension':
      return `create_${operation.name}_extension`;
    case 'create_table':
      return `create_${operation.table}`;
    case 'drop_table':
      return `drop_${operation.table}`;
    case 'add_column':
      return `add_${operation.table}_${operation.column.name}`;
    case 'drop_column':
      return `drop_${operation.table}_${operation.column}`;
    case 'alter_column_type':
      return `alter_${operation.table}_${operation.column}`;
    case 'alter_primary_key':
      return `alter_${operation.table}_primary_key`;
    case 'add_foreign_key':
      return `add_${operation.table}_${operation.fk.name}`;
    case 'drop_foreign_key':
      return `drop_${operation.table}_${operation.name}`;
  }
}

function statements(values: readonly string[]): string {
  return values.length === 0 ? '' : `${values.join(';\n')};\n`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}
