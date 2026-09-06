import { createIntrospector } from '@zmdb/migrations/introspect';
import { createQueryCompiler, inc, proposed, UnsupportedFeatureError } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

import { MSSQL_TYPES, mssql, mssqlVertical } from './index.js';

describe('@zmdb/mssql dialect contract (#672)', () => {
  it('publishes one frozen SQL Server vertical with complete capability metadata', () => {
    expect(mssqlVertical.dialect).toBe(mssql);
    expect(mssql.name).toBe('mssql');
    expect(mssql.family).toBe('mssql');
    expect(mssql.traits).toMatchObject({
      placeholder: 'named',
      quote: ['[', ']'],
      rowValueIn: false,
      returning: {
        insert: 'output',
        upsert: 'output',
        update: 'output',
        delete: 'output',
      },
      upsert: 'merge',
      fts: 'none',
      concat: 'function',
      booleanNot: 'bitwise',
      types: MSSQL_TYPES,
      paramLimit: 2000,
      retryableCodes: ['1205'],
      functions: false,
      procedures: false,
      tableFunctions: false,
      vectorDistance: false,
      spatialPredicates: false,
    });
    expect(mssql.capabilities).toEqual({
      returning: {
        insert: true,
        upsert: true,
        update: true,
        delete: true,
      },
      transactionalDdl: true,
      schemas: true,
      sequences: true,
      generatedColumns: true,
      partialIndexes: true,
      foreignKeys: true,
      rowLevelSecurity: false,
      streaming: false,
      cancellation: false,
    });
    expect(Object.isFrozen(mssql)).toBe(true);
    expect(Object.isFrozen(mssql.traits)).toBe(true);
    expect(Object.isFrozen(mssql.capabilities)).toBe(true);
    expect(createIntrospector(mssql)).toBe(mssql.introspector);
  });

  it('places OUTPUT against the correct pseudo-table', () => {
    const compiler = createQueryCompiler(mssql);
    const aliased = [{ column: 'created_at', alias: 'createdAt' }] as const;

    expect(compiler.insertInto('users').values({ email: 'a@b.com' }).returning(['id']).compile()).toEqual({
      text: 'INSERT INTO [users] ([email]) OUTPUT INSERTED.[id] VALUES (@p1)',
      parameters: ['a@b.com'],
    });
    expect(
      compiler.updateTable('users').set({ email: 'b@c.com' }).where('id', '=', 1).returning(['*']).compile(),
    ).toEqual({
      text: 'UPDATE [users] SET [email] = @p1 OUTPUT INSERTED.* WHERE [id] = @p2',
      parameters: ['b@c.com', 1],
    });
    expect(compiler.deleteFrom('users').where('id', '=', 1).returning(['id']).compile()).toEqual({
      text: 'DELETE FROM [users] OUTPUT DELETED.[id] WHERE [id] = @p1',
      parameters: [1],
    });
    expect(compiler.deleteFrom('users').where('id', '=', 1).returning(aliased).compile()).toEqual({
      text: 'DELETE FROM [users] OUTPUT DELETED.[created_at] AS [createdAt] WHERE [id] = @p1',
      parameters: [1],
    });
  });

  it('emits HOLDLOCK MERGE with its required terminator', () => {
    const query = createQueryCompiler(mssql)
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
    });
  });

  it('emits a locked insert-only MERGE for doNothing', () => {
    const query = createQueryCompiler(mssql)
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

  it('refuses an upsert without an explicit conflict target', () => {
    expect(() =>
      createQueryCompiler(mssql).insertInto('users').values({ email: 'a@b.com' }).onConflict().doUpdate().compile(),
    ).toThrow(
      new UnsupportedFeatureError(
        'upsert without a conflict target',
        'mssql',
        'MERGE needs an explicit join predicate; pass the conflicting column(s) to onConflict(...).',
      ),
    );
  });

  it('refuses pagination without ORDER BY', () => {
    expect(() => createQueryCompiler(mssql).selectFrom('users').limit(10).compile()).toThrow(
      new UnsupportedFeatureError(
        'pagination without ORDER BY',
        'mssql',
        'Dialect "mssql" spells LIMIT as OFFSET … FETCH NEXT, which SQL Server allows only after an ORDER BY. ' +
          'Add .orderBy(...) — an unordered page is not reproducible on any dialect.',
      ),
    );
  });

  it('quotes every qualified-name segment and uses p1 through pn placeholders', () => {
    expect(
      createQueryCompiler(mssql)
        .selectFrom('audit]schema.user]events')
        .where('tenant]id', '=', 7)
        .andWhere('active', '=', true)
        .compile(),
    ).toEqual({
      text: 'SELECT * FROM [audit]]schema].[user]]events] WHERE [tenant]]id] = @p1 AND [active] = @p2',
      parameters: [7, true],
    });
  });

  it('publishes all SQL type mappings including SQL Server temporal, bit and Unicode storage', () => {
    expect(MSSQL_TYPES).toEqual({
      serial: 'INT IDENTITY(1,1)',
      integer: 'INT',
      bigint: 'BIGINT',
      numeric: 'DECIMAL',
      text: 'NVARCHAR(MAX)',
      varchar: 'NVARCHAR',
      boolean: 'BIT',
      timestamp: 'DATETIMEOFFSET(3)',
      json: 'NVARCHAR(MAX)',
      jsonEnum: 'NVARCHAR(MAX)',
      uuid: 'UNIQUEIDENTIFIER',
      date: 'DATE',
      time: 'TIME',
      decimal: 'DECIMAL',
      blob: 'VARBINARY(MAX)',
    });
  });

  it('turns every unsupported matrix cell into metadata or an explicit refusal', () => {
    expect(mssql.capabilities).toMatchObject({
      rowLevelSecurity: false,
      streaming: false,
      cancellation: false,
    });
    expect(() =>
      mssql.migrations.emitSchemaObject({
        kind: 'enable_rls',
        table: 'users',
      }),
    ).toThrow(/row-level security is not supported on dialect "mssql"/);
    expect(() => createQueryCompiler(mssql).callFunction('next_value', [])).toThrow(
      /stored routine "next_value" is not supported on dialect "mssql"/,
    );
    expect(() => createQueryCompiler(mssql).callProcedure('rebuild_users', [])).toThrow(
      /stored routine "rebuild_users" is not supported on dialect "mssql"/,
    );
    expect(() => createQueryCompiler(mssql).callTableFunction('recent_users', [])).toThrow(
      /stored routine "recent_users" is not supported on dialect "mssql"/,
    );
  });
});
