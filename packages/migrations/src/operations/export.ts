import { isSqlDialect } from '@zmdb/query-compiler';

import { diff, emitUp, snapshot, type ChangeOp, type SchemaSnapshot } from '../index.js';
import { migrationTarget, type MigrationProject } from '../project.js';

const EMPTY_SNAPSHOT: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

export interface ExportResult {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
}

/** Reflect declarations and hand the resulting plan directly to the DDL emitter. */
export function exportSchema(project: MigrationProject): ExportResult {
  const target = migrationTarget(project);
  const ops = diff(EMPTY_SNAPSHOT, snapshot(project.schemas), { dialect: target });
  return {
    ops,
    statements: ops.map(operation =>
      isSqlDialect(target) ? emitUp(target.migrations, operation) : emitUp(operation, target),
    ),
  };
}
