import type { DialectSqlType, SqlDialect } from '@zmdb/query-compiler';
import type { Equal, Expect, SqlType } from '@zmdb/schema-core';

import type { Driver } from './index.js';

// Issue #507: the compiler stays dependency-free, while this package already
// depends on both sides and can prove their type vocabularies remain identical.
export type _DialectTypeMappingsStayExhaustive = Expect<Equal<DialectSqlType, SqlType>>;
export type _ExternalDialectFlowsThroughRepositoryDriver = Expect<
  SqlDialect<'third-party'> extends NonNullable<Driver<'third-party'>['dialect']> ? true : false
>;
