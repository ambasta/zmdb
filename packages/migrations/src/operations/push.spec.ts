import { describe, expect, it } from 'vitest';

import type { ChangeOp } from '../index.js';
import type { MigrationConnection } from '../runner.js';
import { sqliteDialect } from '../testing/official-dialects.fixture.js';
import { applyPush, isDestructive, type PushPlan } from './push.js';

const column = { name: 'value', type: 'text', nullable: true, primaryKey: false } as const;
const foreignKey = {
  name: 'events_user_id_fkey',
  columns: ['user_id'],
  targetTable: 'users',
  targetColumns: ['id'],
  onDelete: 'no action',
  onUpdate: 'no action',
} as const;

describe('push destructive-operation classification', () => {
  it.each([
    { kind: 'create_extension', name: 'vector' },
    { kind: 'create_table', table: 'events', columns: [column], primaryKey: [], foreignKeys: [] },
    { kind: 'add_column', table: 'events', column },
    { kind: 'alter_primary_key', table: 'events', from: [], to: ['id'] },
    { kind: 'add_foreign_key', table: 'events', fk: foreignKey },
    { kind: 'drop_foreign_key', table: 'events', name: foreignKey.name },
  ] satisfies readonly ChangeOp[])('permits non-destructive $kind operations', operation => {
    expect(isDestructive(operation)).toBe(false);
  });

  it.each([
    { kind: 'drop_table', table: 'events' },
    { kind: 'drop_column', table: 'events', column: 'legacy' },
    { kind: 'alter_column_type', table: 'events', column: 'value', from: 'text', to: 'varchar' },
    { kind: 'alter_column_type', table: 'events', column: 'value', from: 'bigint', to: 'integer' },
    { kind: 'alter_column_type', table: 'events', column: 'value', from: 'numeric', to: 'integer' },
    { kind: 'alter_column_type', table: 'events', column: 'value', from: 'timestamp', to: 'date' },
    { kind: 'alter_column_type', table: 'events', column: 'value', from: 'json', to: 'text' },
  ] satisfies readonly ChangeOp[])('gates destructive or unclassified $kind operations', operation => {
    expect(isDestructive(operation)).toBe(true);
  });

  it.each([
    ['integer', 'bigint'],
    ['integer', 'numeric'],
    ['bigint', 'numeric'],
    ['varchar', 'text'],
    ['date', 'timestamp'],
  ] as const)('permits the known widening %s -> %s', (from, to) => {
    expect(isDestructive({ kind: 'alter_column_type', table: 'events', column: 'value', from, to })).toBe(false);
  });

  it('gates extension type changes because dimensions and provider rules are not generally widening', () => {
    expect(
      isDestructive({
        kind: 'alter_column_type',
        table: 'items',
        column: 'embedding',
        from: { extension: 'vector', name: 'vector', args: [1536] },
        to: { extension: 'vector', name: 'vector', args: [3072] },
      }),
    ).toBe(true);
  });

  it('executes every statement through the transaction-bound connection', async () => {
    const rootStatements: string[] = [];
    const transactionStatements: string[] = [];
    const transactionConnection: MigrationConnection = {
      exec: sql => {
        transactionStatements.push(sql);
      },
      appliedVersions: () => [],
      recordApplied: () => undefined,
      recordReverted: () => undefined,
    };
    const connection: MigrationConnection = {
      exec: sql => {
        rootStatements.push(sql);
      },
      appliedVersions: () => [],
      recordApplied: () => undefined,
      recordReverted: () => undefined,
      transaction: run => run(transactionConnection),
    };
    const plan: PushPlan = {
      ops: [],
      statements: ['CREATE TABLE first (id INTEGER)', 'CREATE TABLE second (id INTEGER)'],
      destructive: [],
      driver: {
        dialect: sqliteDialect,
        async execute() {
          return [];
        },
      },
      connection,
    };

    await expect(applyPush(plan, () => undefined)).resolves.toMatchObject({ applied: true });
    expect(rootStatements).toEqual([]);
    expect(transactionStatements).toEqual(plan.statements);
  });
});
