# SPEC — Typed populate ergonomics (frozen)

Epic #215. Turns the stringly-typed `findAllWithMany("orders","orders","userId")`
into an ergonomic, typed `findById(id, { populate: ["orders"] })` that returns a
parent typed with its nested relation(s), reusing the existing
`PopulatedEntity`/`attachPopulated` from `@zmdb/schema-core` (epic #188). No
proxies — populate is an explicit, batched extra query.

## How relations attach (frozen)

`CoreSchema` intentionally does **not** carry relations (columns only). A
repository declares its relations as a typed static map — the same
"declare-once" pattern as `static schema`:

```ts
import { manyToOne, oneToMany } from '@zmdb/schema-core';

class UserRepository extends BaseRepository<typeof UserSchema> {
  static readonly schema = UserSchema;
  static readonly relations = {
    orders: { rel: oneToMany('orders', 'userId'), entity: OrderSchema, childFk: 'userId', parentKey: 'id' },
  } as const;
}
```

- Each entry names a relation and pins: the `RelationMeta` (cardinality/target),
  the related schema (for `Entity` derivation), and the FK/parent-key columns.
- `RelationKeys<R>` = `keyof typeof Repo.relations`.

## API

```ts
interface PopulateOption<R> { populate?: readonly (keyof R)[] }

findById<K extends keyof R>(id, opts?: { populate?: readonly K[] })
  : Promise<Populated<Entity<S>, R, K> | undefined>;
find<K extends keyof R>(where: WhereDTO<S>, opts?: { populate?: readonly K[] })
  : Promise<readonly Populated<Entity<S>, R, K>[]>;
```

## Frozen behaviour

- With no `populate`, behaviour + types are exactly as epic A (plain `Entity<S>`).
- With `populate: ["orders"]`, the repository fetches the parents, then runs ONE
  batched `IN (...)` query per relation and attaches results via `attachPopulated`
  (to-many → `Entity<Child>[]`, to-one → `Entity<Child> | null`). Result type is
  `Populated<Entity<S>, R, "orders">`.
- Children are plain objects on plain parents — no identity map, no proxies.
- The old `findAllWithMany` is **deprecated** (kept working) in favour of this.

## Acceptance

- Type-level: `findById(1, { populate: ['orders'] })` result has
  `orders: Entity<Order>[]`; without populate it's plain `Entity<S>`.
- Runtime: a fake recording driver shows parents query + one batched child
  `IN`/OR query; children attached under the relation key (in-memory sqlite E2E).
