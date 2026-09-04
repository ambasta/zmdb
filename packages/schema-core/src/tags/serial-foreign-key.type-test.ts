// The line of ordinary relational code that decided how `serial` is spelled.
//
//   const user = await users.create({ email: 'a@b.c' });
//   await orders.create({ userId: user.id, total: 10 });
//
// A serial primary key is read out of one table and written into another table's integer
// foreign key. Nothing about it is clever, and it is in the quickstart.
//
// It did not compile while a serial column was `number & Sql<'serial'>`. Tag payloads sit
// in an invariant position — `{ [zmdbSqlType]?: 'serial' }` against `{ [zmdbSqlType]?:
// 'integer' }` — so the two column types were unrelated, and no amount of erasure helped:
// the tag is invisible to a *consumer* handing in a plain `number`, but these two values
// both come from tagged columns, so both tags are present and they disagree.
//
// The fix was to stop saying it twice. `serial` left the tag vocabulary
// (`ColumnSqlType`), a generated key became `number & Sql<'integer'> & Serial`, and the
// reflection maps `integer` + `Serial` back to `sql: 'serial'` in the IR so every dialect
// and the equivalence corpus are untouched. `Serial` and `PrimaryKey` then drop on the way
// into an `integer` for the same reason every other tag drops: an optional unique-symbol
// slot is not something the target has to have.
//
// A compilation gate. `_Fk1` is the assertion; the assignments below it are the failure
// this file exists to prevent, written the way a consumer writes them.

import type { CreateDTO, Entity } from '../derive/index.js';
import type { Equal, Expect, Mutual } from '../index.js';
import type { PrimaryKey, Serial, Sql, Table } from './index.js';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
}

interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'>;
  total: number & Sql<'integer'>;
}

// The claim, stated as a type: a key you read is a foreign key you can write. Assignability
// in this direction is the whole point, so `Mutual` would be too weak *and* too strong —
// too weak because it also passes when both sides are the same type, too strong because
// `Sql<'integer'>` alone is genuinely not usable as a primary key.
type AssignableToFk = Entity<User>['id'] extends Entity<Order>['userId'] ? true : false;
export type _Fk1 = Expect<Equal<AssignableToFk, true>>;

// And the same claim as the code that motivated it. `CreateDTO` omits `Order['id']`, so this
// is the real insert, not a reduced version of it.
declare const user: Entity<User>;
export const insert: CreateDTO<Order> = { userId: user.id, total: 10 };

// The residue, recorded rather than hidden: two columns whose SQL types genuinely differ
// still do not interchange. `varchar` and `text` are both `string` to TypeScript but not to
// the database, and a declaration that means to move a value between them says so.
interface Handle extends Table<'handles'> {
  slug: string & Sql<'varchar'> & PrimaryKey;
}
interface Mention extends Table<'mentions'> {
  handle: string & Sql<'text'>;
}
type VarcharIntoText = Entity<Handle>['slug'] extends Entity<Mention>['handle'] ? true : false;
export type _Fk2 = Expect<Equal<VarcharIntoText, false>>;

// Both are still ordinary strings to anything that does not care which — a consumer reading
// one, a `startsWith`, a template literal. Only column-to-column assignment is refused.
export type _Fk3 = Expect<Mutual<Entity<Handle>['slug'], string>>;
