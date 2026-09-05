#!/usr/bin/env node
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

import type { Dialect, SnapshotableSchema } from '@zmdb/query-compiler/migrations';
import { driverMigrationConnection, runCli } from '@zmdb/query-compiler/migrations/runner';
import { sqliteDriver } from '@zmdb/sqlite';

import { generateMigration, loadMigrations } from './generator.js';

export interface CliOptions {
  readonly schemas?: readonly SnapshotableSchema[];
}

function extractSchemas(mod: Record<string, unknown>): SnapshotableSchema[] {
  const schemas: SnapshotableSchema[] = [];
  const addIfSchema = (val: unknown) => {
    if (val && typeof val === 'object' && 'table' in val && 'columns' in val) {
      schemas.push(val as SnapshotableSchema);
    }
  };
  for (const val of Object.values(mod)) {
    if (Array.isArray(val)) {
      for (const item of val) addIfSchema(item);
    } else {
      addIfSchema(val);
    }
  }
  return schemas;
}

function parseArgs(args: readonly string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }

  return { command: positional[0] || 'status', flags };
}

export async function main(argv = process.argv.slice(2), opts?: CliOptions): Promise<string> {
  const { command, flags } = parseArgs(argv);

  const dir = resolve(process.cwd(), flags.dir || 'migrations');
  const dialect = (flags.dialect || 'sqlite') as Dialect;
  const dbPath = flags.db || ':memory:';

  switch (command) {
    case 'generate': {
      let schemas: SnapshotableSchema[] = opts?.schemas ? [...opts.schemas] : [];
      if (flags.schema) {
        const schemaPath = resolve(process.cwd(), flags.schema);
        const mod = (await import(pathToFileURL(schemaPath).href)) as Record<string, unknown>;
        schemas = schemas.concat(extractSchemas(mod));
      }

      const res = generateMigration({
        dir,
        name: flags.name || 'auto_migration',
        dialect,
        schemas,
      });

      if (!res.generated) {
        return res.message || 'No schema changes detected.';
      }
      return `Generated migration ${res.version}_${res.name} at ${res.file}`;
    }

    case 'up':
    case 'down':
    case 'status': {
      const sqliteDb = new DatabaseSync(dbPath);
      const driver = sqliteDriver(sqliteDb);
      const conn = driverMigrationConnection(driver, dialect);
      const migrations = loadMigrations(dir);

      return await runCli(command, conn, migrations);
    }

    default: {
      return `Unknown command: ${command}. Valid commands: generate, up, down, status.`;
    }
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('/cli.ts') || process.argv[1].endsWith('/cli.js') || process.argv[1].endsWith('/zmdb'))
) {
  main().then(
    msg => {
      console.log(msg);
      process.exit(0);
    },
    err => {
      console.error(err);
      process.exit(1);
    },
  );
}
