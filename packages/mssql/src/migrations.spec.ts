import type { MigrationDriver } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { mssql } from './index.js';

describe('@zmdb/mssql migrations (#672)', () => {
  it('emits SQL Server column, key, sequence, computed-column and filtered-index DDL', () => {
    expect(
      mssql.migrations.emitUp({
        kind: 'create_table',
        table: 'events',
        columns: [
          { name: 'id', type: 'serial', nullable: false, primaryKey: true },
          { name: 'tenant_id', type: 'integer', nullable: false, primaryKey: false },
          { name: 'label', type: 'varchar', length: 36, nullable: false, primaryKey: false },
          { name: 'at', type: 'timestamp', nullable: false, primaryKey: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [
          {
            name: 'events_tenant_fkey',
            columns: ['tenant_id'],
            targetTable: 'tenants',
            targetColumns: ['id'],
            onDelete: 'restrict',
            onUpdate: 'cascade',
          },
        ],
      }),
    ).toBe(
      'CREATE TABLE [events] (' +
        '[id] INT IDENTITY(1,1) PRIMARY KEY, ' +
        '[tenant_id] INT NOT NULL, ' +
        '[label] NVARCHAR(36) NOT NULL, ' +
        '[at] DATETIMEOFFSET(3) NOT NULL)',
    );
    expect(
      mssql.migrations.emitUp({
        kind: 'add_foreign_key',
        table: 'events',
        fk: {
          name: 'events_tenant_fkey',
          columns: ['tenant_id'],
          targetTable: 'tenants',
          targetColumns: ['id'],
          onDelete: 'restrict',
          onUpdate: 'cascade',
        },
      }),
    ).toBe(
      'ALTER TABLE [events] ADD CONSTRAINT [events_tenant_fkey] ' +
        'FOREIGN KEY ([tenant_id]) REFERENCES [tenants] ([id]) ON DELETE NO ACTION ON UPDATE CASCADE',
    );
    expect(
      mssql.migrations.emitUp({
        kind: 'drop_foreign_key',
        table: 'events',
        name: 'events_tenant_fkey',
      }),
    ).toBe('ALTER TABLE [events] DROP CONSTRAINT [events_tenant_fkey]');
    expect(
      mssql.migrations.emitSchemaObject({
        kind: 'create_sequence',
        definition: { name: 'event_seq', start: 10, increment: 5 },
      }),
    ).toEqual(['CREATE SEQUENCE [event_seq] START WITH 10 INCREMENT BY 5']);
    expect(
      mssql.migrations.emitSchemaObject({
        kind: 'generated_column',
        definition: {
          name: 'total',
          type: 'integer',
          expression: '[price] * [quantity]',
          stored: true,
        },
      }),
    ).toEqual(['[total] AS ([price] * [quantity]) PERSISTED']);
    expect(
      mssql.migrations.emitSchemaObject({
        kind: 'create_index',
        definition: {
          name: 'users_active_email',
          table: 'users',
          columns: ['email'],
          method: 'btree',
          where: '[active] = 1',
        },
      }),
    ).toEqual(['CREATE INDEX [users_active_email] ON [users] ([email]) WHERE [active] = 1']);
  });

  it('validates SQL Server ALTER COLUMN nullability before dispatch', () => {
    expect(() =>
      mssql.migrations.emitUp({
        kind: 'alter_column_type',
        table: 'events',
        column: 'at',
        from: 'text',
        to: 'timestamp',
      }),
    ).toThrow('mssql ALTER COLUMN must restate NULL or NOT NULL');
    expect(
      mssql.migrations.emitUp({
        kind: 'alter_column_type',
        table: 'events',
        column: 'at',
        from: 'text',
        to: 'timestamp',
        fromNullable: true,
        toNullable: false,
      }),
    ).toBe('ALTER TABLE [events] ALTER COLUMN [at] DATETIMEOFFSET(3) NOT NULL');
    expect(
      mssql.migrations.emitDown({
        kind: 'alter_column_type',
        table: 'events',
        column: 'at',
        from: 'text',
        to: 'timestamp',
        fromNullable: true,
        toNullable: false,
      }),
    ).toBe('ALTER TABLE [events] ALTER COLUMN [at] NVARCHAR(MAX) NULL');
    expect(() =>
      mssql.migrations.emitDown({
        kind: 'drop_table',
        table: 'events',
      }),
    ).toThrow('mssql cannot recreate dropped table "events"');
    expect(() =>
      mssql.migrations.emitUp({
        kind: 'alter_primary_key',
        table: 'events',
        from: ['id'],
        to: ['tenant_id', 'id'],
      }),
    ).toThrow('snapshot does not carry the existing SQL Server constraint name');
  });

  it('pins migration DDL and its ledger write to the transaction driver', async () => {
    const rootQueries: string[] = [];
    const transactionQueries: { readonly text: string; readonly parameters: readonly unknown[] }[] = [];
    const driver: MigrationDriver<'mssql'> = {
      dialect: mssql,
      execute: query => {
        rootQueries.push(query.text);
        return Promise.resolve([]);
      },
      transaction: async run =>
        run({
          dialect: mssql,
          execute: query => {
            transactionQueries.push(query);
            return Promise.resolve([]);
          },
        }),
    };
    const connection = mssql.migrations.connection(driver, {
      schema: 'audit',
      table: 'migrations',
    });

    await connection.transaction?.(async transaction => {
      if (transaction === undefined) throw new Error('mssql migration transaction supplied no connection');
      await transaction.exec('CREATE TABLE [audit].[events] ([id] INT)');
      await transaction.recordApplied(2026090501, 'create events', 'sha256:abc');
    });

    expect(rootQueries).toEqual([]);
    expect(transactionQueries).toEqual([
      {
        text: 'CREATE TABLE [audit].[events] ([id] INT)',
        parameters: [],
      },
      {
        text:
          'INSERT INTO [audit].[migrations] ' +
          '([version], [name], [applied_at], [checksum]) VALUES (@p1, @p2, @p3, @p4)',
        parameters: [2026090501, 'create events', expect.any(Number), 'sha256:abc'],
      },
    ]);
  });

  it('refuses migration transactions when the driver cannot pin a transaction', async () => {
    const connection = mssql.migrations.connection({
      dialect: mssql,
      execute: async () => [],
    });

    await expect(connection.transaction?.(async () => undefined)).rejects.toThrow(
      'mssql migrations require a transactional driver',
    );
  });

  it('creates and upgrades a schema-qualified SQL Server migration ledger', async () => {
    const queries: string[] = [];
    const connection = mssql.migrations.connection(
      {
        dialect: mssql,
        execute: query => {
          queries.push(query.text);
          if (query.text.startsWith('SELECT [checksum]')) return Promise.reject(new Error('missing checksum'));
          return Promise.resolve([]);
        },
      },
      {
        schema: 'audit',
        table: 'migrations',
      },
    );

    await connection.ensureVersionTable();

    expect(queries).toEqual([
      "IF OBJECT_ID(N'audit.migrations', N'U') IS NULL CREATE TABLE [audit].[migrations] (" +
        '[version] BIGINT PRIMARY KEY, [name] NVARCHAR(MAX) NOT NULL, ' +
        '[applied_at] BIGINT NOT NULL, [checksum] NVARCHAR(MAX))',
      'SELECT [checksum] FROM [audit].[migrations] WHERE 1 = 0',
      'ALTER TABLE [audit].[migrations] ADD [checksum] NVARCHAR(MAX)',
    ]);
  });

  it('computes a stable SHA-256 migration checksum', async () => {
    const connection = mssql.migrations.connection({
      dialect: mssql,
      execute: async () => [],
    });

    await expect(connection.checksum?.('SELECT 1')).resolves.toBe(
      'sha256:e004ebd5b5532a4b85984a62f8ad48a81aa3460c1ca07701f386135d72cdecf5',
    );
  });
});
