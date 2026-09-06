import {
  UnsupportedFeatureError,
  createQueryCompiler,
  extendSqlDialect,
  type MigrationDriver,
} from '@zmdb/query-compiler';
import { describe, expect, it, vi } from 'vitest';

import { mysql } from './dialect.js';
import { mysqlFamilyDriver } from './driver.js';
import { mysqlFamilyIntrospector } from './introspect.js';
import { createMysqlMigrations } from './migrations.js';

describe('MySQL compiler and capabilities', () => {
  it('compiles the measured MySQL SQL spellings through the injected dialect', () => {
    const compiler = createQueryCompiler(mysql);
    expect(compiler.selectFrom('users').select(['id']).where('email', '=', 'a@b.test').offset(5).compile()).toEqual({
      text: 'SELECT `id` FROM `users` WHERE `email` = ? LIMIT 18446744073709551615 OFFSET 5',
      parameters: ['a@b.test'],
      returnsRows: true,
      operation: 'select',
      isWrite: false,
    });
    expect(
      compiler.insertInto('users').values({ id: 1, email: 'a@b.test' }).onConflict('id').doUpdate(['email']).compile(),
    ).toEqual({
      text: 'INSERT INTO `users` (`id`, `email`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `email` = VALUES(`email`)',
      parameters: [1, 'a@b.test'],
      returnsRows: false,
      operation: 'insert',
      isWrite: true,
    });
  });

  it('refuses unsupported RETURNING before driver execution', async () => {
    const execute = vi.fn(async () => [[{ id: 1 }], []] as const);
    const driver = mysqlFamilyDriver(mysql, { execute });

    const dispatch = async (): Promise<readonly Record<string, unknown>[]> => {
      const query = createQueryCompiler(mysql)
        .insertInto('users')
        .values({ email: 'a@b.test' })
        .returning(['id'])
        .compile();
      return driver.execute(query);
    };

    await expect(dispatch()).rejects.toBeInstanceOf(UnsupportedFeatureError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not claim transactional DDL', async () => {
    const transaction = vi.fn();
    const migrationDriver: MigrationDriver<'mysql'> = {
      dialect: mysql,
      async execute() {
        return [];
      },
      transaction,
    };
    const connection = mysql.migrations.connection(migrationDriver);

    expect(mysql.capabilities.transactionalDdl).toBe(false);
    expect(connection.transactionalDdl).toBe(false);
    await expect(connection.transaction?.(async nested => nested?.transactionalDdl)).resolves.toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('executes package-generated foreign-key DDL as mysql2-safe single statements', async () => {
    const statements: string[] = [];
    const migrationDriver: MigrationDriver<'mysql'> = {
      dialect: mysql,
      async execute(query) {
        statements.push(query.text);
        return [];
      },
    };
    const connection = mysql.migrations.connection(migrationDriver);
    await connection.exec(
      mysql.migrations.emitUp({
        kind: 'add_foreign_key',
        table: 'posts',
        fk: {
          name: 'posts_account_fkey',
          columns: ['account_id'],
          targetTable: 'accounts',
          targetColumns: ['id'],
          onDelete: 'cascade',
          onUpdate: 'restrict',
        },
      }),
    );

    expect(statements).toEqual([
      'CREATE INDEX `posts_account_fkey_idx` ON `posts` (`account_id`)',
      'ALTER TABLE `posts` ADD CONSTRAINT `posts_account_fkey` FOREIGN KEY (`account_id`) ' +
        'REFERENCES `accounts` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT',
    ]);
  });

  it('owns MySQL DDL, supporting indexes, generated columns, and MODIFY forms', () => {
    expect(
      mysql.migrations.emitUp({
        kind: 'create_table',
        table: 'posts',
        columns: [
          { name: 'id', type: 'serial', nullable: false, primaryKey: true },
          { name: 'account_id', type: 'bigint', nullable: false, primaryKey: false },
        ],
        primaryKey: ['id'],
        foreignKeys: [
          {
            name: 'posts_account_fkey',
            columns: ['account_id'],
            targetTable: 'accounts',
            targetColumns: ['id'],
            onDelete: 'cascade',
            onUpdate: 'restrict',
          },
        ],
      }),
    ).toBe(
      'CREATE TABLE `posts` (`id` INT AUTO_INCREMENT PRIMARY KEY, `account_id` BIGINT NOT NULL, ' +
        'INDEX `posts_account_fkey_idx` (`account_id`), CONSTRAINT `posts_account_fkey` ' +
        'FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT)',
    );
    expect(
      mysql.migrations.emitUp({
        kind: 'alter_column_type',
        table: 'posts',
        column: 'account_id',
        from: 'integer',
        to: 'bigint',
        fromNullable: false,
        toNullable: false,
      }),
    ).toBe('ALTER TABLE `posts` MODIFY COLUMN `account_id` BIGINT NOT NULL');
    expect(
      mysql.migrations.emitSchemaObject({
        kind: 'generated_column',
        definition: { name: 'slug_key', type: 'VARCHAR(120)', expression: 'lower(`slug`)', stored: true },
      }),
    ).toEqual(['`slug_key` VARCHAR(120) GENERATED ALWAYS AS (lower(`slug`)) STORED']);
  });

  it('refuses unsupported MySQL schema objects during migration validation', () => {
    expect(() =>
      mysql.migrations.emitSchemaObject({
        kind: 'create_sequence',
        definition: { name: 'user_ids' },
      }),
    ).toThrow(UnsupportedFeatureError);
    expect(() =>
      mysql.migrations.emitSchemaObject({
        kind: 'create_index',
        definition: {
          name: 'active_users',
          table: 'users',
          columns: ['active'],
          where: 'active = 1',
        },
      }),
    ).toThrow(/partial index/i);
    expect(() =>
      mysql.migrations.emitSchemaObject({
        kind: 'enable_rls',
        table: 'users',
      }),
    ).toThrow(/row-level security/i);
    expect(() =>
      mysql.migrations.emitUp({
        kind: 'add_foreign_key',
        table: 'posts',
        fk: {
          name: 'posts_account_fkey',
          columns: ['account_id'],
          targetTable: 'accounts',
          targetColumns: ['id'],
          onDelete: 'set default',
          onUpdate: 'restrict',
        },
      }),
    ).toThrow(/SET DEFAULT.*posts_account_fkey.*not supported by MySQL/i);
  });

  it('provides immutable family extension points without mutating MySQL', () => {
    const child = extendSqlDialect(mysql, {
      name: 'mysql-child',
      migrations: createMysqlMigrations('mysql-child'),
      introspector: mysqlFamilyIntrospector('mysql-child'),
    });
    const driver = mysqlFamilyDriver(child, {
      async execute() {
        return [[], []];
      },
    });

    expect(Object.isFrozen(mysql)).toBe(true);
    expect(Object.isFrozen(child)).toBe(true);
    expect(child.family).toBe('mysql');
    expect(child.name).toBe('mysql-child');
    expect(driver.dialect).toBe(child);
    expect(mysql.name).toBe('mysql');
  });
});
