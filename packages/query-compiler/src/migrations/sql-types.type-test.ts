import type { Equal, Expect, SqlType } from '@zmdb/schema-core';

import type { CHANGE_PHASES, ChangeOp, DdlSqlType } from './index.js';

// Adding a SqlType without adding its DDL spelling must fail the compilation gate.
export type _DdlTypesExhaustive = Expect<Equal<DdlSqlType, SqlType>>;

// Likewise, adding a change operation without placing it in the explicit phase list is
// a compile error rather than an operation that inherits an incidental iteration order.
export type _ChangePhasesExhaustive = Expect<Equal<(typeof CHANGE_PHASES)[number][number], ChangeOp['kind']>>;
