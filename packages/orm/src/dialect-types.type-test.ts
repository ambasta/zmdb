// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type Driver } from '@zmdb/orm';
import { type Equal, type Expect, type SqlType } from '@zmdb/schema';
import { type DialectSqlType, type SqlDialect } from '@zmdb/sql';

// Issue #507: the compiler stays dependency-free, while this package already
// depends on both sides and can prove their type vocabularies remain identical.
export type _DialectTypeMappingsStayExhaustive = Expect<Equal<DialectSqlType, SqlType>>;
export type _ExternalDialectFlowsThroughRepositoryDriver = Expect<
  SqlDialect<'third-party'> extends NonNullable<Driver<'third-party'>['dialect']> ? true : false
>;
