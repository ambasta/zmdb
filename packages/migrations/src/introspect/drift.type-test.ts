// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Equal, type Expect } from '@zmdb/schema';
import { type DialectTarget } from '@zmdb/sql';

import type { ChangeOp, SchemaSnapshot } from '../index.js';
import { mysqlDialect } from '../testing/official-dialects.fixture.js';
import { detectDrift, type DriftOptions, type DriftReport } from './index.js';

export type _DatabaseFindingsAreChangeOps = Expect<Equal<DriftReport['onlyInDatabase'], readonly ChangeOp[]>>;
export type _DeclarationFindingsAreChangeOps = Expect<Equal<DriftReport['onlyInDeclarations'], readonly ChangeOp[]>>;
export type _DetectDriftReturnsTheReport = Expect<Equal<ReturnType<typeof detectDrift>, DriftReport>>;
export type _ExcludeIsAReadonlyList = Expect<Equal<DriftOptions['exclude'], readonly string[] | undefined>>;
export type _DialectSelectsMigrationRules = Expect<Equal<DriftOptions['dialect'], DialectTarget>>;

const empty: SchemaSnapshot = { version: 1, tables: [], extensions: [] };
export const _typedReport: DriftReport = detectDrift(empty, empty, {
  exclude: ['_zmdb_migrations', 'audit_*'],
  dialect: mysqlDialect,
});
