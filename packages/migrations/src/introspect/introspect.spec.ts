import { describe, expect, it } from 'vitest';

import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from '../index.js';
import { mysqlDialect, postgresDialect } from '../testing/official-dialects.fixture.js';
import { detectDrift, normalizeDriftSnapshot } from './index.js';

type CatalogColumn = ColumnSnapshot & {
  readonly catalogType?: string;
  readonly default?: string;
};

type CatalogTable = Omit<TableSnapshot, 'columns'> & {
  readonly columns: readonly CatalogColumn[];
  readonly indexes?: readonly {
    readonly name: string;
    readonly columns: readonly string[];
    readonly unique: boolean;
    readonly method?: string;
    readonly where?: string;
  }[];
};

function snapshot(tables: readonly CatalogTable[] = []): SchemaSnapshot {
  return { version: 1, tables, extensions: [] };
}

function table(name: string, columns: readonly CatalogColumn[] = []): CatalogTable {
  return { name, columns, primaryKey: [], foreignKeys: [], indexes: [] };
}

describe('vendor-neutral drift comparison', () => {
  it('excludes the migration ledger by default', () => {
    const ledger = table('_zmdb_migrations', [{ name: 'version', type: 'integer', nullable: false, primaryKey: true }]);

    expect(detectDrift(snapshot([ledger]), snapshot(), { dialect: postgresDialect })).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });

  it('accepts a caller-owned exclusion list', () => {
    const shadow = table('audit_shadow', [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }]);

    expect(
      detectDrift(snapshot([shadow]), snapshot(), {
        dialect: postgresDialect,
        exclude: ['_zmdb_migrations', 'audit_*'],
      }),
    ).toEqual({
      onlyInDatabase: [],
      onlyInDeclarations: [],
      clean: true,
    });
  });

  it('reports changes in both directions through the selected migration object', () => {
    const id: CatalogColumn = { name: 'id', type: 'integer', nullable: false, primaryKey: true };
    const databaseOnly: CatalogColumn = {
      name: 'database_only',
      type: 'text',
      nullable: false,
      primaryKey: false,
    };
    const declarationOnly: CatalogColumn = {
      name: 'declaration_only',
      type: 'text',
      nullable: false,
      primaryKey: false,
    };

    const report = detectDrift(
      snapshot([table('users', [databaseOnly, id])]),
      snapshot([table('users', [declarationOnly, id])]),
      { dialect: postgresDialect },
    );

    expect(report.clean).toBe(false);
    expect(report.onlyInDatabase).toContainEqual({
      kind: 'add_column',
      table: 'users',
      column: databaseOnly,
    });
    expect(report.onlyInDeclarations).toContainEqual({
      kind: 'add_column',
      table: 'users',
      column: declarationOnly,
    });
  });

  it('normalizes catalog spellings and defaults without vendor selection', () => {
    const live = snapshot([
      table('events', [
        {
          name: 'created_at',
          type: 'timestamp',
          catalogType: 'timestamp with time zone',
          nullable: false,
          primaryKey: false,
          default: "'now()'",
        },
      ]),
    ]);
    const declared = snapshot([
      table('events', [
        {
          name: 'created_at',
          type: 'timestamp',
          catalogType: 'timestamptz',
          nullable: false,
          primaryKey: false,
          default: 'now()',
        },
      ]),
    ]);

    expect(normalizeDriftSnapshot(live, 'live').tables[0]?.columns[0]).toEqual({
      name: 'created_at',
      type: 'timestamp',
      nullable: false,
      primaryKey: false,
    });
    expect(detectDrift(live, declared, { dialect: postgresDialect }).clean).toBe(true);
  });

  it('lets a database-owned introspector remove its own catalog noise', () => {
    const foreignKey = {
      name: 'posts_account_id_fkey',
      columns: ['account_id'],
      targetTable: 'accounts',
      targetColumns: ['id'],
      onDelete: 'cascade' as const,
      onUpdate: 'no action' as const,
    };
    const accountId: CatalogColumn = {
      name: 'account_id',
      type: 'integer',
      nullable: false,
      primaryKey: false,
    };
    const generatedIndex = {
      name: 'posts_account_id_fkey_idx',
      columns: ['account_id'],
      unique: false,
    };
    const explicitIndex = {
      name: 'posts_recent_idx',
      columns: ['account_id'],
      unique: false,
    };
    const live = snapshot([
      {
        ...table('posts', [accountId]),
        foreignKeys: [foreignKey],
        indexes: [generatedIndex, explicitIndex],
      },
    ]);
    const declared = snapshot([
      {
        ...table('posts', [accountId]),
        foreignKeys: [foreignKey],
        indexes: [explicitIndex],
      },
    ]);

    const normalizedLive = mysqlDialect.introspector.normalizeForDrift(live, 'live');
    const normalizedDeclared = mysqlDialect.introspector.normalizeForDrift(declared, 'declared');
    expect((normalizedLive.tables[0] as CatalogTable | undefined)?.indexes).toEqual([explicitIndex]);
    expect(detectDrift(normalizedLive, normalizedDeclared, { dialect: mysqlDialect }).clean).toBe(true);
  });
});
