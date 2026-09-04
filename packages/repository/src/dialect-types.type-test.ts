import type { DialectSqlType } from '@zmdb/query-compiler';
import type { Equal, Expect, SqlType } from '@zmdb/schema-core';

// Issue #507: the compiler stays dependency-free, while this package already
// depends on both sides and can prove their type vocabularies remain identical.
export type _DialectTypeMappingsStayExhaustive = Expect<Equal<DialectSqlType, SqlType>>;
