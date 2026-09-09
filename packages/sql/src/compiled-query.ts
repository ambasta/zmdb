// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import type { QueryEffects } from '@zmdb/schema/dto';

export type { QueryEffects } from '@zmdb/schema/dto';

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly effects: QueryEffects;
  readonly telemetry?: QueryTelemetry;
}

export const READ_EFFECTS: QueryEffects = Object.freeze({
  operation: 'SELECT',
  requiresPrimary: false,
  returnsRows: true,
});
export const PRIMARY_READ_EFFECTS: QueryEffects = Object.freeze({
  operation: 'SELECT',
  requiresPrimary: true,
  returnsRows: true,
});
export const UNKNOWN_ROW_EFFECTS: QueryEffects = Object.freeze({
  operation: 'UNKNOWN',
  requiresPrimary: true,
  returnsRows: true,
});
export const UNKNOWN_WRITE_EFFECTS: QueryEffects = Object.freeze({
  operation: 'UNKNOWN',
  requiresPrimary: true,
  returnsRows: false,
});

const writes = Object.freeze({
  INSERT: Object.freeze([
    Object.freeze({ operation: 'INSERT', requiresPrimary: true, returnsRows: false }),
    Object.freeze({ operation: 'INSERT', requiresPrimary: true, returnsRows: true }),
  ] as const),
  UPDATE: Object.freeze([
    Object.freeze({ operation: 'UPDATE', requiresPrimary: true, returnsRows: false }),
    Object.freeze({ operation: 'UPDATE', requiresPrimary: true, returnsRows: true }),
  ] as const),
  DELETE: Object.freeze([
    Object.freeze({ operation: 'DELETE', requiresPrimary: true, returnsRows: false }),
    Object.freeze({ operation: 'DELETE', requiresPrimary: true, returnsRows: true }),
  ] as const),
});

/** Reuse immutable metadata rather than allocating it for each compiled write. */
export function writeEffects(operation: keyof typeof writes, returnsRows: boolean): QueryEffects {
  return writes[operation][returnsRows ? 1 : 0];
}

/** Compile-time database attributes consumed by tracing and metrics. */
export interface QueryTelemetry {
  readonly system: string;
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}
