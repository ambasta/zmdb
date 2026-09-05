import { describe, expect, it } from 'vitest';

import { createQueryCompiler, inc, proposed, UnsupportedFeatureError } from '../index.js';
import { emitDown, emitUp, type ForeignKeySnapshot } from '../migrations/index.js';
import { createIndexDdl, createSequenceDdl, generatedColumnDdl, type IndexDef } from '../schema-objects/index.js';
import { TRAITS } from './index.js';

describe('SQL Server dialect (#508)', () => {
  it('places OUTPUT against the correct pseudo-table for insert, update and delete', () => {
    const compiler = createQueryCompiler('mssql');

    expect(compiler.insertInto('users').values({ email: 'a@b.com' }).returning(['id']).compile()).toEqual({
      text: 'INSERT INTO [users] ([email]) OUTPUT INSERTED.[id] VALUES (@p1)',
      parameters: ['a@b.com'],
      operation: 'insert',
      isWrite: true,
      returnsRows: true,
    });
    expect(
      compiler.updateTable('users').set({ email: 'b@c.com' }).where('id', '=', 1).returning(['*']).compile(),
    ).toEqual({
      text: 'UPDATE [users] SET [email] = @p1 OUTPUT INSERTED.* WHERE [id] = @p2',
      parameters: ['b@c.com', 1],
      operation: 'update',
      isWrite: true,
      returnsRows: true,
    });
    expect(compiler.deleteFrom('users').where('id', '=', 1).returning(['id']).compile()).toEqual({
      text: 'DELETE FROM [users] OUTPUT DELETED.[id] WHERE [id] = @p1',
      parameters: [1],
      operation: 'delete',
      isWrite: true,
      returnsRows: true,
    });
  });

  it('emits HOLDLOCK MERGE expressions, OUTPUT and the required terminator on mssql', () => {
    const query = createQueryCompiler('mssql')
      .insertInto('users')
      .values({ email: 'a@b.com', role: 'user', visits: 1 })
      .onConflict('email')
      .doUpdate({ role: proposed(), visits: inc(1) })
      .returning(['*'])
      .compile();

    expect(query).toEqual({
      text:
        'MERGE [users] WITH (HOLDLOCK) AS tgt ' +
        'USING (VALUES (@p1, @p2, @p3)) AS src ([email], [role], [visits]) ' +
        'ON tgt.[email] = src.[email] ' +
        'WHEN MATCHED THEN UPDATE SET [role] = src.[role], [visits] = tgt.[visits] + @p4 ' +
        'WHEN NOT MATCHED THEN INSERT ([email], [role], [visits]) ' +
        'VALUES (src.[email], src.[role], src.[visits]) OUTPUT INSERTED.*;',
      parameters: ['a@b.com', 'user', 1, 1],
      operation: 'insert',
      isWrite: true,
      returnsRows: true,
    });
  });

  it('emits a locked insert-only MERGE for doNothing on mssql', () => {
    const query = createQueryCompiler('mssql')
      .insertInto('users')
      .values({ email: 'a@b.com', role: 'user' })
      .onConflict('email')
      .doNothing()
      .compile();

    expect(query.text).toBe(
      'MERGE [users] WITH (HOLDLOCK) AS tgt ' +
        'USING (VALUES (@p1, @p2)) AS src ([email], [role]) ON tgt.[email] = src.[email] ' +
        'WHEN NOT MATCHED THEN INSERT ([email], [role]) VALUES (src.[email], src.[role]);',
    );
  });

  it('refuses an mssql upsert without an explicit conflict target', () => {
    expect(() =>
      createQueryCompiler('mssql').insertInto('users').values({ email: 'a@b.com' }).onConflict().doUpdate().compile(),
    ).toThrow(
      new UnsupportedFeatureError(
        'upsert without a conflict target',
        'mssql',
        'MERGE needs an explicit join predicate; pass the conflicting column(s) to onConflict(...).',
      ),
    );
  });

  it('uses SQL Server DDL spellings, preserves nullability and refuses migrations it cannot reconstruct', () => {
    expect(
      emitUp(
        {
          kind: 'add_column',
          table: 'events',
          column: { name: 'label', type: 'varchar', length: 36, nullable: false, primaryKey: false },
        },
        'mssql',
      ),
    ).toBe('ALTER TABLE [events] ADD [label] NVARCHAR(36) NOT NULL');
    const alter = {
      kind: 'alter_column_type' as const,
      table: 'events',
      column: 'at',
      from: 'text',
      to: 'timestamp',
      fromNullable: true,
      toNullable: false,
    };
    expect(emitUp(alter, 'mssql')).toBe('ALTER TABLE [events] ALTER COLUMN [at] DATETIMEOFFSET(3) NOT NULL');
    expect(emitDown(alter, 'mssql')).toBe('ALTER TABLE [events] ALTER COLUMN [at] NVARCHAR(MAX) NULL');
    expect(() =>
      emitUp(
        {
          kind: 'alter_column_type',
          table: 'events',
          column: 'at',
          from: 'text',
          to: 'timestamp',
        },
        'mssql',
      ),
    ).toThrow('mssql ALTER COLUMN must restate NULL or NOT NULL');
    expect(() => emitDown({ kind: 'drop_table', table: 'events' }, 'mssql')).toThrow(
      'mssql cannot recreate dropped table "events"',
    );
    expect(() =>
      emitUp({ kind: 'alter_primary_key', table: 'events', from: ['id'], to: ['tenantId', 'id'] }, 'mssql'),
    ).toThrow('snapshot does not carry the existing SQL Server constraint name');
  });

  it('emits SQL Server foreign-key actions and drops the named constraint', () => {
    const foreignKey: ForeignKeySnapshot = {
      name: 'posts_author_fkey',
      columns: ['authorId'],
      targetTable: 'users',
      targetColumns: ['id'],
      onDelete: 'restrict',
      onUpdate: 'cascade',
    };

    expect(emitUp({ kind: 'add_foreign_key', table: 'posts', fk: foreignKey }, 'mssql')).toBe(
      'ALTER TABLE [posts] ADD CONSTRAINT [posts_author_fkey] ' +
        'FOREIGN KEY ([authorId]) REFERENCES [users] ([id]) ON DELETE NO ACTION ON UPDATE CASCADE',
    );
    expect(emitUp({ kind: 'drop_foreign_key', table: 'posts', name: foreignKey.name }, 'mssql')).toBe(
      'ALTER TABLE [posts] DROP CONSTRAINT [posts_author_fkey]',
    );
  });

  it('emits SQL Server sequences, persisted computed columns and filtered indexes', () => {
    expect(createSequenceDdl({ name: 'event_seq', start: 10, increment: 5 }, 'mssql')).toBe(
      'CREATE SEQUENCE [event_seq] START WITH 10 INCREMENT BY 5',
    );
    expect(
      generatedColumnDdl({ name: 'total', type: 'integer', expression: '[price] * [quantity]', stored: true }, 'mssql'),
    ).toBe('[total] AS ([price] * [quantity]) PERSISTED');

    const index: IndexDef = {
      name: 'users_active_email',
      table: 'users',
      columns: ['email'],
      method: 'btree',
      where: '[active] = 1',
    };
    expect(createIndexDdl(index, 'mssql')).toBe(
      'CREATE INDEX [users_active_email] ON [users] ([email]) WHERE [active] = 1',
    );
  });

  it('publishes the measured SQL Server parameter ceiling and deadlock code', () => {
    expect(TRAITS.mssql.paramLimit).toBe(2000);
    expect(TRAITS.mssql.retryableCodes).toEqual(['1205']);
  });
});
