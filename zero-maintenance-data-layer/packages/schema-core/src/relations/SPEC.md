# Entity Relations — Frozen Spec (Issue #30)

> Status: **FROZEN** for TDD. Implementation (#31–#34) must satisfy this spec.
> Relation DSL lives in `@zmdb/schema-core`. No identity map, no proxies, no lazy loading.

## 1. Relation builders

```ts
manyToOne(target: string, fk: string): RelationMeta
oneToMany(target: string, mappedBy: string): RelationMeta
oneToOne(target: string, fk: string): RelationMeta
manyToMany(target: string, through: string): RelationMeta
```

### RelationMeta shape (frozen)

```ts
interface RelationMeta {
  readonly cardinality: 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';
  readonly target: string;                 // target table
  readonly fk?: string;                     // owning-side FK column
  readonly mappedBy?: string;               // inverse side field
  readonly through?: string;                // join table (m:n)
  readonly owning: boolean;                 // true where the FK is stored
}
```

## 2. populate semantics

- `populate(['posts'])` marks relations for eager, explicit loading.
- Related types attach to the result type **only** when populated
  (`PopulatedEntity<S, K>` augments `Entity<S>` with the relation field).
- To-one → JOIN; to-many → batched `IN (…)` select. Strategy is deterministic.

## 3. Golden metadata fixtures

```
manyToOne('users', 'userId')
=> { cardinality:'many-to-one', target:'users', fk:'userId', owning:true }

oneToMany('orders', 'userId')
=> { cardinality:'one-to-many', target:'orders', mappedBy:'userId', owning:false }

manyToMany('tags', 'post_tags')
=> { cardinality:'many-to-many', target:'tags', through:'post_tags', owning:true }
```

## 4. Non-goals (rejected)

- Identity map / shared references. Proxy lazy getters. Automatic cascade via tracking.
