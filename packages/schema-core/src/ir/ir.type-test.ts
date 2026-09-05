// Naming strategy physical-name type contract.
//
// Physical names are build artifacts. They must never replace the property keys
// that Entity<T> derives from the declaration. This file is compile-only and is
// run by `node scripts/typecheck.mjs`.

import type { Entity } from '../derive/index.js';
import type { Equal, Expect } from '../index.js';
import type { Physical, PrimaryKey, Sql, Table } from '../tags/index.js';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'> & Physical<'created_at'>;
}

export type _NamingStrategyPreservesPropertyNames = Expect<Equal<keyof Entity<User>, 'id' | 'createdAt'>>;
