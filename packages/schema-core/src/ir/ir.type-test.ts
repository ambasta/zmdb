// Naming strategy type freeze (#417).
//
// Physical names are build artifacts. They must never replace the property keys
// that Entity<T> derives from the declaration. This file is compile-only and is
// run by `node scripts/typecheck.mjs`.

import type { Entity } from '../derive/index.js';
import type { Equal, Expect } from '../index.js';
import type { PrimaryKey, Sql, Table } from '../tags/index.js';

// FROZEN SURFACE: the public `Physical<Name>` tag lands in #418. A real local
// symbol, not `declare const`, pins that adding the tag cannot add a data key.
const zmdbPhysical = Symbol('zmdbPhysical');
type Physical<Name extends string> = { readonly [zmdbPhysical]?: Name };

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & PrimaryKey;
  createdAt: Date & Sql<'timestamp'> & Physical<'created_at'>;
}

export type _NamingStrategyPreservesPropertyNames = Expect<Equal<keyof Entity<User>, 'id' | 'createdAt'>>;
