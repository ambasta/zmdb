Relations describe how tables relate through foreign keys. They are declared once, as a tag on the interface, and everything reads them from there: the derived types, the JSON Schema `$ref`s, and the queries `populate` batches.

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

> [!NOTE]
> There used to be a second spelling: `oneToMany('posts', 'userId')` and its three siblings
> returned a `RelationMeta`, and a map of those went to `defineRepository` so `populate` could
> learn what the tag had already said. The builders, the map, `RelationMeta`, `RelationDef` and
> `RelationsMap` are gone. If you have one, delete it — the tag above is the whole declaration.

## Populating them

```ts
const user = await users.findById(1, { populate: ['posts'] });
// user.posts: readonly Entity<Post>[]
```

`populate` accepts the relation keys of `User` and nothing else, so a typo is a compile error. Nothing is attached for a relation you did not ask for — an unpopulated relation is **absent** from the row, not present and empty.

The result type is `Populated<User, 'posts'>`:

```ts
import type { Entity, Populated } from 'zmdb/derive';

type UserWithPosts = Populated<User, 'posts'>;
// { id: number; email: string; posts: readonly Entity<Post>[] }

type PostWithAuthor = Populated<Post, 'author'>;
// { id: number; userId: number; title: string; author: Entity<User> | null }
```

A to-many is an array — empty where nothing matched. A to-one is nullable, because a foreign key that matches no row is a row the database can hold. The populated child is an `Entity<>`: a fetched row, with its own relations dropped, exactly like the parent. `PopulatedEntity` is the same type under a longer name.

## Which side holds the key

Resolution reads the tables, not the tag:

- `ManyToOne<'users', 'userId'>` on `posts` is the **owning** side: `posts.userId` is the column, and `References<'users.id'>` on it names what the join matches. A foreign key without a `References` is assumed to point at `id`.
- `OneToMany<'posts', 'userId'>` on `users` is the **inverse** side: the join runs from `users`' primary key against `posts.userId`.
- `OneToOne` is symmetric and cannot say which half stores the key, so the answer is whichever table has the column. `profile?: Profile & OneToOne<'profiles', 'userId'>` on a `users` with no `userId` is the inverse side.

`resolveRelation` is exported if you need the answer yourself:

```ts
import { resolveRelation } from '@zmdb/schema-core/relations';

resolveRelation(PostSchema.ir, 'author');
// { name: 'author', targetTable: 'users', parentKey: 'userId', targetKey: 'id', toMany: false }
```

An unknown name throws and lists the relations the type does declare.

## Compiling population queries

`compilePopulate` generates the SQL: a to-one is a JOIN, a to-many a batched `IN ()` select.

```ts
import { compilePopulate } from '@zmdb/schema-core/relations';

const query = compilePopulate(UserSchema.ir, 'posts', 'postgres', [1, 2, 3]);
// query.kind: 'batched'
// query.sql: SELECT * FROM "posts" WHERE "userId" IN ($1, $2, $3)

const query2 = compilePopulate(PostSchema.ir, 'author', 'postgres');
// query2.kind: 'join'
// query2.sql: SELECT * FROM "posts" INNER JOIN "users" ON "posts"."userId" = "users"."id"
```

Duplicate and nullish parent keys are dropped, and no parent keys compiles to `WHERE 1 = 0` rather than to every row.

> [!WARNING]
> `ManyToMany` throws here and in `populate`. `ManyToMany<'roles', 'user_roles'>` names a join
> table rather than a column, and guessing its two foreign keys from the tables either side is
> how a wrong query gets built quietly. Join the three tables yourself — see [Joins](./joins.html).

## Attaching populated relations

`attachPopulated` merges related entities into the parent result. Non-mutating.

```ts
import { attachPopulated } from '@zmdb/schema-core/relations';

const user = { id: 1, email: 'user@example.com' };
const posts = [{ id: 1, userId: 1, title: 'First Post' }];
const userWithPosts = attachPopulated(user, 'posts', posts);
// { id: 1, email: 'user@example.com', posts: [...] }
```

> [!TIP]
> Use `attachPopulated` when manually composing results. For automatic population, use the repository's `populate` option.

## Join result types

`JoinRow` types handle inner vs left joins:

```ts
import type { JoinRow } from '@zmdb/schema-core/relations';

type UserPostInner = JoinRow<Entity<User>, Entity<Post>, 'inner'>;
// All columns present

type UserPostLeft = JoinRow<Entity<User>, Entity<Post>, 'left'>;
// Joined columns are Partial<>
```

`zmdb/derive` exports a `JoinRow<T, K, Kind>` that names the joined side by relation key instead of by type — `JoinRow<User, 'posts', 'inner'>`. Same asymmetry, different argument.

## Related

- [Schema Declaration](./schema-declaration.html) — defining tables with foreign keys
- [Typed populate & join results](./populate-results.html) — the result types in detail
- [Repository](./repository.html) — CRUD with relation support
- [Indexes & Constraints](./indexes-constraints.html) — indexing FK columns
