// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
  const next = snapshot(project.schemas);
  const ops = diff(EMPTY_SNAPSHOT, next, { dialect: target });
  target.migrations.validatePlan({ before: EMPTY_SNAPSHOT, after: next, operations: ops });
  return {
    ops,
    statements: ops.map(operation => emitUp(operation, target)),
  };
}
