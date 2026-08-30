# SPEC — Entity modeling (frozen)

Explicit lifecycle events, embeddables, and inheritance mapping. No
change-tracking-driven implicit events (that is an anti-pattern here). Epic #141.

## 1. Lifecycle events & subscribers (#142/#143/#144) — `@zmdb/repository`

```ts
type LifecycleEvent = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' | 'beforeDelete' | 'afterDelete';
interface Subscriber {
  on: LifecycleEvent;
  run: (ctx: unknown) => void | Promise<void>;
}
class EventBus {
  subscribe(s: Subscriber): () => void; // returns unsubscribe
  emit(event: LifecycleEvent, ctx: unknown): Promise<void>;
}
```

- Explicit: events fire only from the repository's explicit write methods, never
  from mutating a fetched object.
- `emit` runs matching subscribers in subscription order; async awaited in order.
- Frozen: unsubscribe removes exactly that subscriber; unknown events no-op.

## 2. Embeddables (#145/#146/#147) — `@zmdb/schema-core`

```ts
interface Embeddable {
  prefix: string;
  fields: readonly string[];
}
function flattenEmbeddable(prefix, value): Record<string, unknown>; // {street}⇒{address_street}
function liftEmbeddable(prefix, row): Record<string, unknown>; // {address_street}⇒{street}
```

- A value object spans multiple columns of one table via a column prefix.
- Round-trip: `liftEmbeddable(p, flattenEmbeddable(p, v))` deep-equals `v`.

## 3. Inheritance mapping (#148/#149/#150) — `@zmdb/schema-core`

```ts
interface SingleTableInheritance {
  discriminator: string;
  map: Record<string, readonly string[]>;
}
function discriminatorFor(sti, type): string; // the discriminator value
function rowToSubtype(sti, row): { type: string; data: Record<string, unknown> };
```

- Single-table inheritance: one table, a discriminator column selects the subtype;
  subtype-specific columns listed per type.
- `rowToSubtype` reads the discriminator and returns the subtype tag + its columns.

<!-- §2 embeddables frozen: flatten/lift by column prefix, round-trip law. -->

<!-- §3 inheritance frozen: single-table discriminator + rowToSubtype. -->
