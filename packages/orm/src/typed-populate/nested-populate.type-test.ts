import { BaseRepository, createLoaderScope } from '@zmdb/orm';
import { type Entity, type Equal, type Expect } from '@zmdb/schema';
import { type Populated } from '@zmdb/schema/derive';

import { NestedUserSchema, type NestedComment, type NestedUser } from './nested.fixtures.js';

class Users extends BaseRepository<NestedUser> {
  static override readonly schema = NestedUserSchema;
}
declare const users: Users;
declare const user: Entity<NestedUser>;
declare const rows: readonly Entity<NestedUser>[];

const populated = users.findAll({ populate: ['posts.comments.author', 'profile.user.posts'] });
type Result = Awaited<typeof populated>[number];
export type NestedMany = Expect<
  Equal<Result['posts'][number]['comments'][number]['author'], Entity<NestedUser> | null>
>;
export type NestedSingle = Expect<Equal<NonNullable<Result['profile']>['user'], Populated<NestedUser, 'posts'> | null>>;
const one = users.populate(user, ['posts.comments']);
const many = users.populate(rows, ['posts.comments']);
export type DeferredOne = Expect<
  Equal<Awaited<typeof one>['posts'][number]['comments'], readonly Entity<NestedComment>[]>
>;
export type DeferredMany = Expect<Equal<Awaited<typeof many>[number], Awaited<typeof one>>>;
const scope = createLoaderScope();
const scoped = scope.populate(users, user, ['posts.comments']);
export type Scoped = Expect<Equal<Awaited<typeof scoped>, Awaited<typeof one>>>;
// @ts-expect-error — the declared nested relation is comments, not missing.
users.findAll({ populate: ['posts.missing'] });
// @ts-expect-error — scalar columns cannot be population paths.
users.populate(user, ['posts.title']);
// @ts-expect-error — the scope uses the same declared paths.
scope.populate(users, rows, ['profile.nope']);
// @ts-expect-error — unrelated branches remain absent.
export const unrequested = one.then(value => value.profile);
// @ts-expect-error — grandchildren not requested on this path remain absent.
export const unrequestedGrandchild = one.then(value => value.posts[0]?.comments[0]?.author);
