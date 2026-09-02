Relations describe how tables relate through foreign keys. They are declared twice today — once as a tag on the interface, which is what shapes the types, and once as a runtime map, which is what `populate` batches its queries from.

> [!IMPORTANT]
> Relations are metadata-only. They do not create FK constraints — `References<'users.id'>` on the column does that. Neither creates an index; see [Indexes & Constraints](./indexes-constraints.html).

## Declaring relations on the type

```ts
import type { ManyToOne, OneToMany, PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  posts?: Post[] & OneToMany<'posts', 'userId'>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  title: string & Sql<'text'>;
  author?: User & ManyToOne<'users', 'userId'>;
}
```

Each tag names the **target table** and the **column that carries the join**. Cardinality is not in the tag: `User & ManyToOne<…>` is to-one and `Post[] & OneToMany<…>` is to-many because the declared type says so, which is one fewer thing that can disagree with itself. `ManyToMany<Target, Through>` names the join table instead of a column.

Relation properties are excluded from `Entity<T>`, `CreateDTO<T>` and the DDL — a join target is not a column to `INSERT`. Declare them optional, because a row only carries one when you asked for it.

## The runtime map

```ts
import { manyToOne, oneToMany, oneToOne, manyToMany } from '@zmdb/schema-core/relations';

export const userRelations = { posts: oneToMany('posts', 'userId') };
export const postRelations = { author: manyToOne('users', 'userId') };

const userToProfile = oneToOne('profiles', 'userId');
const userToRoles = manyToMany('roles', 'user_roles');
```

Each builder returns a frozen `RelationMeta`. The arguments are the same two strings as the tag.

> [!WARNING]
> Writing it twice is a gap, not a design. The tag reaches the derived types and documents;
> the repository's `populate` reads the map. Keep them in step until the reflector emits the
> map from the tags.

## Type-Safe Population

Use `PopulatedEntity` for type-safe results. The type system knows to expect an array (to-many) or single entity (to-one).

```ts
import type { Entity } from 'zmdb/derive';
import { PopulatedEntity, RelationDef, RelationsMap } from '@zmdb/schema-core/relations';

type UserRelations = RelationsMap & {
  posts: RelationDef & { meta: ReturnType<typeof oneToMany>; entity: Entity<Post> };
};

type UserWithPosts = PopulatedEntity<Entity<User>, UserRelations, 'posts'>;
// user.posts[0].title is typed as string
```

`PopulatedEntity` predates the relation tags and takes the relation description as a type argument, which is why the `RelationDef` above restates what `OneToMany<'posts', 'userId'>` already said. Where the relation is declared on the interface, `User['posts']` is the shorter route to the same type.

## Compiling Population Queries

`compilePopulate` generates SQL for loading relations. It handles both join (to-one) and batched IN() queries (to-many).

```ts
import { compilePopulate } from '@zmdb/schema-core/relations';

const query = compilePopulate('users', 'posts', oneToMany('posts', 'userId'), 'postgres', [1, 2, 3]);
// query.kind: 'batched'
// query.sql: SELECT * FROM "posts" WHERE "userId" IN ($1, $2, $3)
```

For to-one, it generates a JOIN:

```ts
const query2 = compilePopulate('posts', 'author', manyToOne('users', 'userId'), 'postgres', []);
// query2.kind: 'join'
// query2.sql: SELECT * FROM "posts" INNER JOIN "users" ON "posts"."userId" = "users"."id"
```

## Attaching Populated Relations

`attachPopulated` merges related entities into the parent result. Non-mutating.

```ts
import { attachPopulated } from '@zmdb/schema-core/relations';

const user = { id: 1, email: 'user@example.com' };
const posts = [{ id: 1, userId: 1, title: 'First Post' }];
const userWithPosts = attachPopulated(user, 'posts', posts);
// { id: 1, email: 'user@example.com', posts: [...] }
```

> [!TIP]
> Use `attachPopulated` when manually composing results. For automatic population, use the repository's `populate` method.

## Join Result Types

`JoinRow` types handle inner vs left joins:

```ts
import { JoinRow } from '@zmdb/schema-core/relations';

type UserPostInner = JoinRow<Entity<User>, Entity<Post>, 'inner'>;
// All columns present

type UserPostLeft = JoinRow<Entity<User>, Entity<Post>, 'left'>;
// Joined columns are Partial<>
```

## Related

- [Schema Declaration](./schema-declaration.html) — defining tables with foreign keys
- [Repository](./repository.html) — CRUD with relation support
- [Indexes & Constraints](./indexes-constraints.html) — indexing FK columns
