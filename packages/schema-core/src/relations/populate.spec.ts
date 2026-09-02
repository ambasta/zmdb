import { describe, it, expect } from 'vitest';

import { PostSchema, UserSchema } from './fixtures.ts';
import { compilePopulate, resolveRelation } from './index.ts';

// Resolution and SQL for populate. Both read the relation off the declaration — the fixtures
// declare `posts`, `profile`, `author` and `tags` as tags on the interface, and there is no
// relation map anywhere in this file to disagree with them.

describe('resolveRelation', () => {
  it('resolves the owning side from the foreign key and what it references', () => {
    // `author?: User & ManyToOne<'users', 'userId'>` on `posts`, whose `userId` carries
    // `References<'users.id'>`. Both columns are written down; neither is guessed.
    expect(resolveRelation(PostSchema.ir, 'author')).toEqual({
      name: 'author',
      targetTable: 'users',
      parentKey: 'userId',
      targetKey: 'id',
      toMany: false,
    });
  });

  it('resolves the inverse side from the primary key', () => {
    expect(resolveRelation(UserSchema.ir, 'posts')).toEqual({
      name: 'posts',
      targetTable: 'posts',
      parentKey: 'id',
      targetKey: 'userId',
      toMany: true,
    });
  });

  it('puts a one-to-one on whichever table has the column', () => {
    // `OneToOne` is symmetric and says nothing about which side stores the key. `users` has
    // no `userId`, so this is the inverse side: joined from the primary key like a to-many,
    // but it cannot match twice, so `toMany` stays false.
    expect(resolveRelation(UserSchema.ir, 'profile')).toEqual({
      name: 'profile',
      targetTable: 'profiles',
      parentKey: 'id',
      targetKey: 'userId',
      toMany: false,
    });
  });

  it('names the relations the type does declare when given one it does not', () => {
    expect(() => resolveRelation(UserSchema.ir, 'ordres')).toThrow(/unknown relation "ordres" on users/);
    expect(() => resolveRelation(UserSchema.ir, 'ordres')).toThrow(/posts, profile, tags/);
  });

  it('refuses many-to-many rather than guessing the join table keys', () => {
    expect(() => resolveRelation(UserSchema.ir, 'tags')).toThrow(/many-to-many through "user_tags"/);
  });
});

describe('compilePopulate', () => {
  it('compiles a to-one as an INNER JOIN on the resolved pair of columns', () => {
    const q = compilePopulate(PostSchema.ir, 'author', 'postgres');
    expect(q.kind).toBe('join');
    expect(q.sql).toBe('SELECT * FROM "posts" INNER JOIN "users" ON "posts"."userId" = "users"."id"');
  });

  it('joins an inverse one-to-one from the primary key', () => {
    // The old signature took a `RelationMeta`, which named a target and an `fk` and left the
    // join to assume `target.id` — so this relation compiled to `users.userId = profiles.id`,
    // against a column `users` does not have.
    const q = compilePopulate(UserSchema.ir, 'profile', 'postgres');
    expect(q.sql).toBe('SELECT * FROM "users" INNER JOIN "profiles" ON "users"."id" = "profiles"."userId"');
  });

  it('compiles a to-many as a batched IN() select', () => {
    const q = compilePopulate(UserSchema.ir, 'posts', 'postgres', [1, 2, 3]);
    expect(q.kind).toBe('batched');
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE "userId" IN ($1, $2, $3)');
    expect(q.parameters).toEqual([1, 2, 3]);
  });

  it('matches nothing for no parent keys, rather than every row', () => {
    const q = compilePopulate(UserSchema.ir, 'posts', 'postgres', []);
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE 1 = 0');
    expect(q.parameters).toEqual([]);
  });

  it('drops duplicate and nullish parent keys', () => {
    const q = compilePopulate(UserSchema.ir, 'posts', 'sqlite', [1, 1, null, 2, undefined]);
    expect(q.sql).toBe('SELECT * FROM "posts" WHERE "userId" IN (?, ?)');
    expect(q.parameters).toEqual([1, 2]);
  });
});
