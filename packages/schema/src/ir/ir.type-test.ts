// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// Naming strategy physical-name type contract.
//
// Physical names are build artifacts. They must never replace the property keys
// that Entity<T> derives from the declaration. This file is compile-only and is
// run by `node scripts/typecheck.mjs`.

import { type Equal, type Expect } from '@zmdb/schema';
import { type Entity } from '@zmdb/schema/derive';
import { type Physical, type PrimaryKey, type Sql, type Table } from '@zmdb/schema/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'> & Physical<'created_at'>;
}

export type _NamingStrategyPreservesPropertyNames = Expect<Equal<keyof Entity<User>, 'id' | 'createdAt'>>;
