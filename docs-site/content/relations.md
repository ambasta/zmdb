Relations define how tables relate through foreign keys. zmdb provides a typed relation DSL with compile-time type derivation for populated entities.

> [!IMPORTANT]
> Relations in zmdb are metadata-only — they describe structure but don't create FK constraints. Use migration DDL to add constraints.

## Defining Relations

zmdb provides relation builders: `manyToOne`, `oneToMany`, `oneToOne`, `manyToMany`. Each returns a frozen `RelationMeta`.

```ts
import { manyToOne, oneToMany, oneToOne, manyToMany } from '@zmdb/schema-core/relations';

const postToUser = manyToOne('users', 'user_id');
const userToPosts = oneToMany('posts', 'user_id');
const userToProfile = oneToOne('profiles', 'user_id');
const userToRoles = manyToMany('roles', 'user_roles');
```

## Type-Safe Population

Use `PopulatedEntity` for type-safe results. The type system knows to expect an array (to-many) or single entity (to-one).

```ts
import { Entity, defineSchema } from '@zmdb/schema-core';
import { PopulatedEntity, RelationDef, RelationsMap } from '@zmdb/schema-core/relations';

const UserSchema = defineSchema('users', {
  id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  email: { type: 'text', flags: { nullable: false } },
});

const PostSchema = defineSchema('posts', {
  id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
  user_id: { type: 'serial', flags: { nullable: false }, references: { target: 'users' } },
  title: { type: 'text', flags: { nullable: false } },
});

type UserRelations = RelationsMap & {
  posts: RelationDef & { meta: ReturnType<typeof oneToMany>; entity: Entity<typeof PostSchema> };
};

type UserWithPosts = PopulatedEntity<Entity<typeof UserSchema>, UserRelations, 'posts'>;
// user.posts[0].title is typed as string
```

## Compiling Population Queries

`compilePopulate` generates SQL for loading relations. It handles both join (to-one) and batched IN() queries (to-many).

```ts
import { compilePopulate } from '@zmdb/schema-core/relations';

const query = compilePopulate('users', 'posts', oneToMany('posts', 'user_id'), 'postgres', [1, 2, 3]);
// query.kind: 'batched'
// query.sql: SELECT * FROM "posts" WHERE "user_id" IN ($1, $2, $3)
```

For to-one, it generates a JOIN:

```ts
const query2 = compilePopulate('posts', 'author', manyToOne('users', 'user_id'), 'postgres', []);
// query2.kind: 'join'
// query2.sql: SELECT * FROM "posts" INNER JOIN "users" ON "posts"."user_id" = "users"."id"
```

## Attaching Populated Relations

`attachPopulated` merges related entities into the parent result. Non-mutating.

```ts
import { attachPopulated } from '@zmdb/schema-core/relations';

const user = { id: 1, email: 'user@example.com' };
const posts = [{ id: 1, user_id: 1, title: 'First Post' }];
const userWithPosts = attachPopulated(user, 'posts', posts);
// { id: 1, email: 'user@example.com', posts: [...] }
```

> [!TIP]
> Use `attachPopulated` when manually composing results. For automatic population, use the repository's `populate` method.

## Join Result Types

`JoinRow` types handle inner vs left joins:

```ts
import { JoinRow, Entity } from '@zmdb/schema-core/relations';

type UserPostInner = JoinRow<Entity<typeof UserSchema>, Entity<typeof PostSchema>, 'inner'>;
// All columns present

type UserPostLeft = JoinRow<Entity<typeof UserSchema>, Entity<typeof PostSchema>, 'left'>;
// Joined columns are Partial<>
```

## Related

- [Schema Declaration](./schema-declaration.html) — defining tables with foreign keys
- [Repository](./repository.html) — CRUD with relation support
- [Indexes & Constraints](./indexes-constraints.html) — indexing FK columns
