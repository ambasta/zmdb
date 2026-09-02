# SPEC — Typed populate ergonomics

Epic #215. Turns the stringly-typed `findAllWithMany("orders","orders","userId")` into an
ergonomic, typed `findById(id, { populate: ["orders"] })` that returns a parent typed with its
nested relation(s). No proxies — populate is an explicit, batched extra query.

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

- `populate` accepts `RelationKeys<User>`, so a misspelling is a compile error rather than a
  runtime throw.
- The columns the batched select matches on come from `resolveRelation(schema.ir, name)` in
  `@zmdb/schema-core`. `OneToMany<'orders', 'userId'>` names the target table and the foreign
  key; `References<'users.id'>` on `orders.userId` names the column it points at.

This is a rewrite of what the epic originally froze. A `CoreSchema` used to carry columns only,
so relations came in as a typed static map beside `static schema`:

```ts
static readonly relations = {
  orders: { rel: oneToMany('orders', 'userId'), entity: OrderSchema, childFk: 'userId', parentKey: 'id' },
} as const;
```

Every fact in that entry is in the declaration above it — twice over, since the `RelationMeta`
and the `childFk`/`parentKey` pair both name the key — and the two could disagree. They did:
`attachRelations` read `childTable`/`childFk`/`parentKey` and `resolveRelationJoin` read
`fk`/`mappedBy` with different fallbacks, so the batched select and the join could build
different queries from one map entry. `BaseRepository` no longer takes a second type parameter
for the map, and `defineRepository` no longer takes a `relations` option.

## API

```ts
findById<K extends RelationKeys<T> & string>(id, opts?: { populate?: readonly K[] })
  : Promise<Populated<T, K> | undefined>;
find<K extends RelationKeys<T> & string>(where: WhereDTO<T>, opts?: { populate?: readonly K[] })
  : Promise<readonly Populated<T, K>[]>;
```

## Behaviour

- With no `populate`, the result is a plain `Entity<T>` and **nothing** is attached — an
  unpopulated relation is absent from the row, not present and empty.
- With `populate: ["orders"]`, the repository fetches the parents, then runs ONE batched
  `IN (...)` query per relation and attaches results via `attachPopulated` (to-many →
  `readonly Entity<Order>[]`, to-one → `Entity<User> | null`). The result type is
  `Populated<T, "orders">`.
- A `ManyToMany` relation throws rather than compiling a query: `via` is a join table, and
  guessing its two foreign keys is how a wrong query gets built quietly.
- Children are plain objects on plain parents — no identity map, no proxies.
- The old `findAllWithMany` is **deprecated** (kept working) in favour of this.

## Acceptance

- Type-level: `findById(1, { populate: ['orders'] })` has `orders: readonly Entity<Order>[]`;
  without populate it is a plain `Entity<User>`, and `'orders'` is not a key of it.
- Runtime: a fake recording driver shows the parents query plus one batched child `IN`/OR
  query, with children attached under the relation key (in-memory sqlite E2E).
