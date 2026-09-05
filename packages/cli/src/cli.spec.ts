import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { SnapshotableSchema } from '@zmdb/query-compiler/migrations';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { main } from './cli.js';
import { generateMigration, loadMigrations } from './generator.js';

const testDir = join(process.cwd(), '.tmp-cli-test-migrations');

beforeEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

describe('@zmdb/cli generator and commands', () => {
  it('generateMigration creates migration file and snapshot for initial schema', () => {
    const userSchema: SnapshotableSchema = {
      table: 'users',
      primaryKey: ['id'],
      columns: {
        id: { type: 'serial', flags: { nullable: false, primaryKey: true } },
        email: { type: 'text', flags: { nullable: false, unique: true } },
      },
    };

    const res = generateMigration({
      dir: testDir,
      name: 'create_users',
      dialect: 'sqlite',
      schemas: [userSchema],
    });

    expect(res.generated).toBe(true);
    expect(res.file).toBeDefined();
    expect(existsSync(join(testDir, 'snapshot.json'))).toBe(true);
    expect(res.upSql).toContain('CREATE TABLE "users"');
    expect(res.upSql).toContain('UNIQUE');

    const loaded = loadMigrations(testDir);
    expect(loaded.length).toBe(1);
    expect(loaded[0]?.name).toBe('create_users');
  });

  it('generateMigration produces no file when schema has not changed', () => {
    const userSchema: SnapshotableSchema = {
      table: 'users',
      primaryKey: ['id'],
      columns: {
        id: { type: 'serial', flags: { nullable: false, primaryKey: true } },
        email: { type: 'text', flags: { nullable: false } },
      },
    };

    generateMigration({
      dir: testDir,
      name: 'v1',
      dialect: 'sqlite',
      schemas: [userSchema],
    });

    const secondRes = generateMigration({
      dir: testDir,
      name: 'v2',
      dialect: 'sqlite',
      schemas: [userSchema],
    });

    expect(secondRes.generated).toBe(false);
    expect(secondRes.message).toBe('No schema changes detected.');
  });

  it('cli main generate -> up -> status -> down E2E workflow', async () => {
    const dbPath = join(testDir, 'test.db');
    const productSchema: SnapshotableSchema = {
      table: 'products',
      primaryKey: ['id'],
      columns: {
        id: { type: 'serial', flags: { nullable: false, primaryKey: true } },
        name: { type: 'text', flags: { nullable: false } },
        price: { type: 'integer', flags: { nullable: false, hasDefault: true }, default: 100 },
      },
    };

    // 1. Generate migration
    const genOutput = await main(['generate', '--dir', testDir, '--name', 'init_products', '--dialect', 'sqlite'], {
      schemas: [productSchema],
    });
    expect(genOutput).toContain('Generated migration');

    // 2. Status before up
    const statusBefore = await main(['status', '--dir', testDir, '--db', dbPath, '--dialect', 'sqlite']);
    expect(statusBefore).toContain('[ ]');
    expect(statusBefore).toContain('init_products');

    // 3. Up
    const upOutput = await main(['up', '--dir', testDir, '--db', dbPath, '--dialect', 'sqlite']);
    expect(upOutput).toContain('applied:');

    // 4. Status after up
    const statusAfter = await main(['status', '--dir', testDir, '--db', dbPath, '--dialect', 'sqlite']);
    expect(statusAfter).toContain('[x]');

    // 5. Down
    const downOutput = await main(['down', '--dir', testDir, '--db', dbPath, '--dialect', 'sqlite']);
    expect(downOutput).toContain('reverted:');
  });
});
