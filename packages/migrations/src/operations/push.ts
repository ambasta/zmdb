import { diff, emitUp, snapshot, type ChangeOp, type ExtensionType, type SchemaSnapshot } from '../index.js';
import { detectDrift } from '../introspect/index.js';
import { migrationTarget, requiredDriver, requiredIntrospector, type MigrationProject } from '../project.js';
import { driverMigrationConnection, type MigrationConnection, type MigrationDriver } from '../runner.js';

export interface PushPlan {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
  readonly destructive: readonly string[];
  readonly driver: MigrationDriver;
  readonly connection: MigrationConnection;
}

export interface PushResult {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
  readonly applied: boolean;
}

export async function planPush(project: MigrationProject): Promise<PushPlan> {
  const driver = requiredDriver(project);
  const declared = declaredSnapshot(project);
  const introspector = requiredIntrospector(project);
  const live = introspector.normalizeForDrift(await introspector.snapshot(driver, project.introspect), 'live');
  const normalizedDeclared = introspector.normalizeForDrift(declared, 'declared');
  const target = migrationTarget(project);
  const drift = detectDrift(live, normalizedDeclared, { dialect: project.dialect });
  const ops = diff(live, normalizedDeclared, { dialect: target });
  target.migrations.validatePlan({ before: live, after: normalizedDeclared, operations: ops });
  const statements = ops.map(operation => emitUp(operation, target));
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
    connection: driverMigrationConnection(driver, target),
  };
}

export async function applyPush(plan: PushPlan, warning: (message: string) => void): Promise<PushResult> {
  if (plan.statements.length === 0) return { ops: plan.ops, statements: plan.statements, applied: false };
  if (plan.connection.transactionalDdl === false) {
    const target = plan.connection.dialect;
    const name = typeof target === 'string' ? target : (target?.name ?? 'database');
    warning(
      `${name} does not support transactional DDL; a failed push may leave only part of the printed plan applied`,
    );
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

function declaredSnapshot(project: MigrationProject): SchemaSnapshot {
  return snapshot(project.schemas);
}
