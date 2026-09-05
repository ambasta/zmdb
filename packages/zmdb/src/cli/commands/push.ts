import { schemasFromFiles } from '@zmdb/aot-validator/testing';
import { detectDrift, createIntrospector } from '@zmdb/query-compiler/introspect';
import {
  diff,
  emitUp,
  snapshot,
  type ChangeOp,
  type ExtensionType,
  type SchemaSnapshot,
} from '@zmdb/query-compiler/migrations';
import { driverMigrationConnection, type MigrationConnection } from '@zmdb/query-compiler/migrations/runner';
import type { Driver } from '@zmdb/repository';

import type { ResolvedConfig } from '../../config/index.js';
import { configuredDriver } from './migrate.js';

export interface PushPlan {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
  readonly destructive: readonly string[];
  readonly driver: Driver;
  readonly connection: MigrationConnection;
}

export interface PushResult {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
  readonly applied: boolean;
}

export async function planPush(config: ResolvedConfig): Promise<PushPlan> {
  const driver = await configuredDriver(config);
  const declared = declaredSnapshot(config);
  const live = await createIntrospector(config.dialect).snapshot(driver, config.introspect);
  const drift = detectDrift(live, declared, { dialect: config.dialect });
  const ops = diff(live, declared, { dialect: config.dialect });
  const statements = ops.map(operation => emitUp(operation, config.dialect));
  const destructive = ops
    .map((operation, index) => (isDestructive(operation) ? statements[index] : undefined))
    .filter(statement => statement !== undefined);
  if (drift.clean !== (ops.length === 0)) {
    throw new Error('push planning disagreed with the drift detector');
  }
  return {
    ops,
    statements,
    destructive,
    driver,
    connection: driverMigrationConnection(driver, config.dialect),
  };
}

export async function applyPush(plan: PushPlan, warning: (message: string) => void): Promise<PushResult> {
  if (plan.statements.length === 0) return { ops: plan.ops, statements: plan.statements, applied: false };
  if (plan.connection.transactionalDdl === false) {
    warning('mysql does not support transactional DDL; a failed push may leave only part of the printed plan applied');
  }

  const run = async (connection: MigrationConnection = plan.connection): Promise<void> => {
    for (const statement of plan.statements) await connection.exec(statement);
  };
  if (plan.connection.transaction === undefined) await run();
  else await plan.connection.transaction(transaction => run(transaction ?? plan.connection));
  return { ops: plan.ops, statements: plan.statements, applied: true };
}

/** Classify every current ChangeOp. New union members make this switch fail typechecking. */
export function isDestructive(operation: ChangeOp): boolean {
  switch (operation.kind) {
    case 'create_extension':
    case 'create_table':
    case 'add_column':
    case 'alter_primary_key':
    case 'add_foreign_key':
    case 'drop_foreign_key':
      return false;
    case 'drop_table':
    case 'drop_column':
      return true;
    case 'alter_column_type':
      return narrowsType(operation.from, operation.to);
  }
}

function narrowsType(from: string | ExtensionType, to: string | ExtensionType): boolean {
  if (typeof from !== 'string' || typeof to !== 'string') return true;
  if (from === to) return false;
  return !KNOWN_WIDENINGS.has(`${from}->${to}`);
}

const KNOWN_WIDENINGS = new Set([
  'integer->bigint',
  'integer->numeric',
  'bigint->numeric',
  'varchar->text',
  'date->timestamp',
]);

function declaredSnapshot(config: ResolvedConfig): SchemaSnapshot {
  return snapshot(
    schemasFromFiles(config.schemaFiles, {
      project: config.project,
      naming: config.resolvedNaming,
    }),
  );
}
