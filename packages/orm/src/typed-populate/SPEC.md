# SPEC — Typed populate ergonomics

Epic #215. Turns the stringly-typed `findAllWithMany("orders","orders","userId")` into an ergonomic, typed `findById(id, { populate: ["orders"] })` that returns a parent typed with its nested
relation(s). No proxies — populate is an explicit, batched extra query.

## How relations attach

They are declared on the type, with a tag, and the repository reads them off the schema:

```ts
interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  orders?: Order[] & OneToMany<'orders', 'userId'>;
}

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;
}
```

- `populate` accepts declared relation paths, including dotted paths such as `posts.comments`. `RelationPath<T, Path>` validates each supplied segment without imposing a fixed nesting depth.
- The columns the batched select matches on come from `resolveRelation(schema.ir, name)` in `@zmdb/schema`. `OneToMany<'orders', 'userId'>` names the target table and the foreign key;
  `References<'users.id'>` on `orders.userId` names the column it points at.

This is a rewrite of what the epic originally froze. A `CoreSchema` used to carry columns only, so relations came in as a typed static map beside `static schema`:

```ts
static readonly relations = {
  orders: { rel: oneToMany('orders', 'userId'), entity: OrderSchema, childFk: 'userId', parentKey: 'id' },
} as const;
```

Every fact in that entry is in the declaration above it — twice over, since the `RelationMeta` and the `childFk`/`parentKey` pair both name the key — and the two could disagree. They did:
`attachRelations` read `childTable`/`childFk`/`parentKey` and `resolveRelationJoin` read `fk`/`mappedBy` with different fallbacks, so the batched select and the join could build different queries from
one map entry. `BaseRepository` no longer takes a second type parameter for the map, and `defineRepository` no longer takes a `relations` option.

## API

The canonical overloads are in [BaseRepository](../index.ts): `findById`, `findOne`, `find`, `findAll` and `list` accept population paths in their read options.
`repository.populate(rowOrRows, paths, options?)` attaches relations to existing records without fetching those roots again. A single input returns one copied record; a readonly array returns a
readonly array of copied records.

[LoaderScope.populate](../loaders/index.ts) accepts the repository followed by the same inputs. Concurrent calls with the same repository, canonical path set and read-options object share a microtask
batch. It keeps no result cache for later population calls. Transaction-bound repositories and different read-options objects remain separate batches.

## Behaviour

- With no `populate`, the result is a plain `Entity<T>` and **nothing** is attached — an unpopulated relation is absent from the row, not present and empty.
- With `populate: ["orders"]`, the repository fetches the parents, then runs parameter-bounded batched queries per relation and attaches copied results (to-many → `readonly Entity<Order>[]`, to-one →
  `Entity<User> | null`). A one-column key uses `IN (...)`; a composite key uses ordered `OR`-of-`AND` groups so every supported driver gets valid SQL. The result type is `Populated<T, "orders">`.
- Nested paths use the same traversal, with one batch per shared path prefix. Related schemas come from `RepositoryOptions.schemas`; every target on a nested path must be registered. One-level
  population retains its existing behavior when the target schema is unregistered. Invalid paths, missing nested schemas and invalid target filters fail before SQL.
- Requested descendants appear in the derived result type. Missing to-one relations remain `null`, and missing to-many relations remain empty arrays at every depth. Finite paths through cyclic
  declarations are supported; population does not traverse unrequested relations.
- A `ManyToMany` relation throws rather than compiling a query: `via` is a join table, and guessing its two foreign keys is how a wrong query gets built quietly.
- Children are plain objects on plain parents — no identity map, no proxies.
- The old `findAllWithMany` is **deprecated** (kept working) in favour of this.

## Acceptance

- Type-level: `findById(1, { populate: ['orders'] })` has `orders: readonly Entity<Order>[]`; without populate it is a plain `Entity<User>`, and `'orders'` is not a key of it.
- Runtime: a fake recording driver shows the parents query plus one batched child `IN`/OR query, with children attached under the relation key (in-memory sqlite E2E).
- [Nested/deferred runtime cases](nested-populate.spec.ts) use real in-memory SQLite; [type cases](nested-populate.type-test.ts) check descendant types and invalid paths against the same declared
  fixtures.
