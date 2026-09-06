import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { snapshot, type ChangeOp, type SchemaSnapshot } from '@zmdb/migrations';
import { emitDeclarations } from '@zmdb/migrations/declarations';
import type { CatalogSchemaSnapshot } from '@zmdb/migrations/introspect';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

import { sqlite } from './dialect.js';
import { sqliteDriver } from './driver.js';

export interface RoundTripUser extends Table<'round_trip_users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  display_name: string & Sql<'text'>;
  nickname: (string & Sql<'text'>) | null;
}

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const { RoundTripUser: RoundTripUserSchema } = schemasFrom<{ RoundTripUser: RoundTripUser }>(
  import.meta.url,
  ['RoundTripUser'],
  { project: join(ROOT, 'packages/sqlite/tsconfig.json') },
);

function coreProjection(value: CatalogSchemaSnapshot | SchemaSnapshot): unknown {
  return {
    version: value.version,
    tables: value.tables.map(table => ({
      name: table.name,
      columns: table.columns.map(column => ({
        name: column.name,
        type: column.type,
        nullable: column.nullable,
        primaryKey: column.primaryKey,
        ...(column.length === undefined ? {} : { length: column.length }),
      })),
    })),
  };
}

describe('SQLite declaration ownership', () => {
  it('regenerates an equivalent declaration from a live SQLite catalog', async () => {
    const declared = snapshot([RoundTripUserSchema]);
    const declaredTable = declared.tables[0];
    if (declaredTable === undefined) {
      throw new Error('the RoundTripUser declaration produced no table');
    }

    const create: ChangeOp = {
      kind: 'create_table',
      table: declaredTable.name,
      columns: declaredTable.columns,
      primaryKey: declaredTable.primaryKey,
      foreignKeys: declaredTable.foreignKeys,
    };
    const database = new DatabaseSync(':memory:');
    const scratch = await mkdtemp(join(tmpdir(), 'zmdb-sqlite-declarations-669-'));
    try {
      database.exec(sqlite.migrations.emitUp(create));
      const live = await sqlite.introspector.snapshot(sqliteDriver(database));
      const emitted = await emitDeclarations(live, { dialect: 'sqlite' });

      for (const file of emitted.files) {
        const path = join(scratch, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.source);
      }
      const generated = emitted.files.find(file => file.source.includes('interface RoundTripUser'));
      if (generated === undefined) {
        throw new Error('emitter produced no RoundTripUser declaration');
      }

      const project = join(scratch, 'tsconfig.json');
      await writeFile(
        project,
        `${JSON.stringify({ extends: join(ROOT, 'tsconfig.json'), include: ['./**/*.ts'] }, null, 2)}\n`,
      );
      const { RoundTripUser: regenerated } = schemasFrom<{ RoundTripUser: RoundTripUser }>(
        join(scratch, generated.path),
        ['RoundTripUser'],
        { project },
      );

      expect(coreProjection(snapshot([regenerated]))).toEqual(coreProjection(live));
    } finally {
      database.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
