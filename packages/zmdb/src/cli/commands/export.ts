import { schemasFromFiles } from '@zmdb/aot-validator/testing';
import { diff, emitUp, snapshot, type ChangeOp, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';

import type { ResolvedConfig } from '../../config/index.js';

const EMPTY_SNAPSHOT: SchemaSnapshot = { version: 1, tables: [], extensions: [] };

export interface ExportResult {
  readonly ops: readonly ChangeOp[];
  readonly statements: readonly string[];
}

/** Reflect declarations and hand the resulting plan directly to the DDL emitter. */
export function exportSchema(config: ResolvedConfig): ExportResult {
  const schemas = schemasFromFiles(config.schemaFiles, { project: config.project });
  const ops = diff(EMPTY_SNAPSHOT, snapshot(schemas), { dialect: config.dialect });
  return {
    ops,
    statements: ops.map(operation => emitUp(operation, config.dialect)),
  };
}
