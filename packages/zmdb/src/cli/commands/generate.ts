import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { schemasFromFiles } from '@zmdb/aot-validator/testing';
import { diff, emitDown, emitUp, snapshot, type ChangeOp, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';

import type { ResolvedConfig } from '../../config/index.js';
import { writeTextAtomically } from '../atomic.js';

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
  const schemas = schemasFromFiles(config.schemaFiles, { project: config.project });
  const next = snapshot(schemas);
  const snapshotPath = join(config.outDir, 'snapshot.json');
  const previous = await readSnapshot(snapshotPath);
  const ops = diff(previous, next);
  if (ops.length === 0) return { ops };

  const name = migrationName(options.name, ops);
  const versionText = migrationVersion(options.now ?? new Date());
  const migrationPath = join(config.outDir, `${versionText}_${name}.sql`);
  const up = ops.map(operation => emitUp(operation, config.dialect));
  const down = ops
    .toReversed()
    .filter(operation => operation.kind !== 'create_extension')
    .map(operation => emitDown(operation, config.dialect));
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
