import { schemasFromFiles } from '@zmdb/aot-validator/testing';
import { isSqlDialect } from '@zmdb/query-compiler';
import { diff, emitUp, snapshot, type ChangeOp, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';

import type { ResolvedConfig } from '../../config/index.js';
import { configuredDialect } from '../database.js';

const EMPTY_SNAPSHOT: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

export interface ExportResult {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
}

/** Reflect declarations and hand the resulting plan directly to the DDL emitter. */
export function exportSchema(config: ResolvedConfig): ExportResult {
  const schemas = schemasFromFiles(config.schemaFiles, {
    project: config.project,
    naming: config.resolvedNaming,
  });
  const ops = diff(EMPTY_SNAPSHOT, snapshot(schemas), { dialect: config.dialect });
  const dialect = configuredDialect(config.dialect);
  return {
    ops,
    statements: ops.map(operation =>
      isSqlDialect(dialect) ? emitUp(dialect.migrations, operation) : emitUp(operation, dialect),
    ),
  };
}
