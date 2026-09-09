// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type DialectTarget, type Introspector } from '@zmdb/sql';

export function configuredDialect(dialect: DialectTarget): DialectTarget {
  return dialect;
}

export function configuredIntrospector(dialect: DialectTarget): Introspector {
  return dialect.introspector;
}
