import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  diff,
  emitDown,
  emitUp,
  snapshot,
  type ChangeOp,
  type Dialect,
  type SchemaSnapshot,
  type SnapshotableSchema,
} from '@zmdb/query-compiler/migrations';
import type { Migration } from '@zmdb/query-compiler/migrations/runner';

export interface GenerateMigrationOptions {
  readonly dir: string;
  readonly name?: string;
  readonly dialect?: Dialect;
  readonly schemas: readonly SnapshotableSchema[];
}

export interface MigrationResult {
  readonly generated: boolean;
  readonly message?: string;
  readonly version?: number;
  readonly name?: string;
  readonly file?: string;
  readonly upSql?: string;
  readonly downSql?: string;
  readonly ops?: readonly ChangeOp[];
}

export function generateMigration(options: GenerateMigrationOptions): MigrationResult {
  const { dir, name = 'auto_migration', dialect = 'postgres', schemas } = options;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const snapshotPath = join(dir, 'snapshot.json');
  let prevSnapshot: SchemaSnapshot = { version: 1, tables: [], extensions: [] };
  if (existsSync(snapshotPath)) {
    try {
      prevSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as SchemaSnapshot;
    } catch {
      prevSnapshot = { version: 1, tables: [], extensions: [] };
    }
  }

  const nextSnapshot = snapshot(schemas);
  const ops = diff(prevSnapshot, nextSnapshot);

  if (ops.length === 0) {
    return { generated: false, message: 'No schema changes detected.' };
  }

  const upSql = ops.map(op => emitUp(op, dialect)).join(';\n') + ';';
  const downSql =
    ops
      .toReversed()
      .map(op => emitDown(op, dialect))
      .join(';\n') + ';';

  const version = Date.now();
  const fileName = `${version}_${name}.json`;
  const filePath = join(dir, fileName);

  const migrationData: Migration = {
    version,
    name,
    up: upSql,
    down: downSql,
  };

  writeFileSync(filePath, JSON.stringify(migrationData, null, 2) + '\n');
  writeFileSync(snapshotPath, JSON.stringify(nextSnapshot, null, 2) + '\n');

  return {
    generated: true,
    version,
    name,
    file: filePath,
    upSql,
    downSql,
    ops,
  };
}

export function loadMigrations(dir: string): readonly Migration[] {
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir);
  const migrations: Migration[] = [];

  for (const file of files) {
    if (file === 'snapshot.json' || !file.endsWith('.json')) continue;
    const fullPath = join(dir, file);
    try {
      const content = JSON.parse(readFileSync(fullPath, 'utf8')) as Partial<Migration>;
      if (typeof content.version === 'number' && typeof content.name === 'string' && typeof content.up === 'string') {
        migrations.push({
          version: content.version,
          name: content.name,
          up: content.up,
          down: content.down ?? '',
        });
      }
    } catch {
      // Ignore unparseable or non-migration JSON files
    }
  }

  return migrations.toSorted((a, b) => a.version - b.version);
}
