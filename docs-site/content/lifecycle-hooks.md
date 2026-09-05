Lifecycle hooks let you react to entity events — `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`. `EventBus` is a small pub/sub that gives you the seam;
**the repository does not emit on its own**, which is the design decision this page is really about.

## What is built

```ts
import { EventBus, type LifecycleEvent, type Subscriber } from '@zmdb/repository/entity-modeling';
```

```ts
export type LifecycleEvent = 'beforeCreate' | 'afterCreate' | 'beforeUpdate' | 'afterUpdate' | 'beforeDelete' | 'afterDelete';

export interface Subscriber {
  on: LifecycleEvent;
  run: (ctx: unknown) => void | Promise<void>;
}

class EventBus {
  subscribe(s: Subscriber): () => void; // returns an unsubscribe
  emit(event: LifecycleEvent, ctx: unknown): Promise<void>;
}
```

That is the whole surface. Note the sub-path import — `EventBus` is not re-exported from the `@zmdb/repository` root.

```ts
const bus = new EventBus();

const unsub = bus.subscribe({
  on: 'beforeCreate',
  run: ctx => {
    console.log('about to create', ctx);
  },
});

unsub(); // no longer called
```

`emit` walks subscribers in **registration order** and `await`s each one in turn — not `Promise.all`, so one slow subscriber delays the rest and delays the write.

This is intentionally not the application-event API. A lifecycle subscriber may veto a repository write by throwing, so `EventBus.emit` stops and rejects. For application facts whose handlers must be
isolated, use `createEvents` from [`@zmdb/app/events`](./web-events.html): those handlers run concurrently, one failure is reported without stopping its siblings, and durable emission crosses through
the transactional outbox.

## Nothing emits for you

There is no `@BeforeCreate` decorator and no implicit dispatch. Emitting is an override you write:

```ts
import { BaseRepository, type UpdatePatch } from '@zmdb/repository';
import { EventBus } from '@zmdb/repository/entity-modeling';
import type { CreateDTO, Entity, PrimaryKeyOf } from '@zmdb/schema-core';

const bus = new EventBus();

class UserRepository extends BaseRepository<User> {
  static override readonly schema = UserSchema;

  override async create(dto: CreateDTO<User>): Promise<Entity<User>> {
    await bus.emit('beforeCreate', dto);
    const created = await super.create(dto);
    await bus.emit('afterCreate', created);
    return created;
  }

  override async update(id: PrimaryKeyOf<User>, patch: UpdatePatch<User>): Promise<Entity<User> | undefined> {
    await bus.emit('beforeUpdate', { id, patch });
    const updated = await super.update(id, patch);
    await bus.emit('afterUpdate', updated);
    return updated;
  }

  override async delete(id: unknown): Promise<boolean> {
    await bus.emit('beforeDelete', { id });
    const deleted = await super.delete(id);
    await bus.emit('afterDelete', { id, deleted });
    return deleted;
  }
}
```

Verbose, and deliberately so — [the project's position](./why-zmdb.html) is that a write you can read top to bottom beats one whose side effects live in a registry somewhere else. The methods you did
not override emit nothing, which is visible in this file rather than being a surprise at runtime.

Match the base signatures exactly — `update(id: PrimaryKeyOf<T>, patch: UpdatePatch<T>)` returns `Entity<T> | undefined` (undefined when no row matched), and `delete(id: PrimaryKeyOf<T>)` returns a
`boolean`. Swallowing either in an override is how a hook starts lying about what happened.

The `beforeUpdate` event above receives the caller's `UpdatePatch` before repository validation, because the explicit `emit` precedes `super.update`. That is different from the built-in protected
`preUpdate` hook:

```ts
protected override preUpdate(patch: Record<string, unknown>): void {
  // validated; undefined keys removed; accepted keys rebuilt in schema order
  // branded expressions are the same objects supplied by the caller
}
```

`preUpdate` runs for `update`, `updateMany`, and `increment`. `upsert` runs `preInsert` for its create payload and does not also run `preUpdate` for its conflict-update object.

And note what the EventBus override does _not_ cover. `BaseRepository` also has `upsert`, `updateMany`, and `increment`; the `update` override above does not intercept them. In particular, `increment`
uses the repository's internal keyed update path, so it fires `preUpdate` but not this public `update` override. Anything that writes through the [query compiler](./insert.html), a raw
`driver.execute`, a migration, or another service also emits nothing. A hook is a convenience, never an invariant. Invariants belong in the database.

## `ctx` is `unknown` — narrow it

`Subscriber.run` takes `unknown`, so a handler typed `run: (ctx: { id: number }) => …` **does not compile**: `run` is a function-typed property, so its parameter is checked contravariantly. Narrow
inside instead:

```ts
import { assert } from '@zmdb/aot-validator/utilities';

bus.subscribe({
  on: 'afterCreate',
  run: async ctx => {
    const user = assert<{ id: number; email: string }>(ctx);
    await audit.create({ action: 'create', entity: 'user', subject: user.id, at: new Date() });
  },
});
```

`assert<T>` **returns** the narrowed value — it is not an `asserts input is T` predicate — so bind the result rather than calling it as a bare statement. It costs one generated validator call and buys
you a real error at the boundary instead of `undefined` reaching your audit table. The alternative — one bus per repository, so the type is known by construction — is often the better answer:

```ts
class TypedBus<T> {
  #subs: ((ctx: T) => void | Promise<void>)[] = [];
  on(fn: (ctx: T) => void | Promise<void>): () => void {
    /* … */
  }
  async emit(ctx: T): Promise<void> {
    for (const fn of this.#subs) await fn(ctx);
  }
}
```

Twelve lines, fully typed, no narrowing. `EventBus` earns its keep when subscribers are registered by code that does not know the entity — plugins, an audit module, a generic outbox writer.

## Ordering and failure

```ts
bus.subscribe({ on: 'beforeCreate', run: () => console.log('first') });
bus.subscribe({ on: 'beforeCreate', run: () => console.log('second') });
```

Registration order, sequentially awaited.

> [!IMPORTANT] `emit` does not catch. A throwing subscriber aborts the remaining subscribers **and** propagates out of `emit`:
>
> - In a `before*` hook that runs before `super`, the write never happens — which is how you veto one.
> - In an `after*` hook, the write has **already committed**. The caller sees an exception for an operation that succeeded, and nothing rolls back. Wrap `after*` work in its own `try`/`catch`, or move
>   it into the same transaction.

That second case is the bug worth designing against. If the follow-on work must be atomic with the write, it belongs in a [transaction](./transactions.html) beside it — or in the
[transactional outbox](./transactional-outbox.html), which survives the process dying between the two.

## Soft deletes: not a hook

The tempting shape is a `beforeDelete` subscriber that updates `deletedAt` and throws to cancel the delete. Do not do that: it makes `delete()` throw on success, and every caller has to know which
exception means "actually fine".

A soft delete is a column and a predicate:

```ts
import type { PrimaryKey, Serial, SoftDelete, Sql, Table } from 'zmdb/tags';

export interface User extends Table<'users'>, SoftDelete<'deletedAt'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  deletedAt: (Date & Sql<'timestamp'>) | null;
}

const userSchema = schemaOf<User>();
```

The tags go **inside** the parentheses. `(Date & Sql<'timestamp'>) | null` is a nullable timestamp column. The other order is the trap: `(Date | null) & Unique` distributes to
`(Date & Unique) | (null & Unique)`, and `null & Unique` is `never`, so the column stops being nullable. See [Tag Reference](./tags-reference.html).

The tag makes `deletedAt` framework-managed: it remains visible on returned entities but is absent from create and update DTOs. `delete(id)` sets it to a Node `Date`; reads add `deletedAt IS NULL`;
`restore(id)` clears it; and `hardDelete(id)` is the deliberate physical-delete spelling.

The protected hook still follows the caller's operation rather than the emitted SQL:

```ts
class UserRepository extends BaseRepository<User> {
  static override readonly schema = userSchema;

  protected override preDelete(id: number): void {
    audit('delete', id);
  }

  protected override preUpdate(): void {
    // Not called by soft delete.
  }
}
```

Both `delete` and `hardDelete` invoke `preDelete` once. A soft delete emits an `UPDATE`, but does not invoke `preUpdate`.

## Timestamps: prefer a default

`beforeCreate` setting `createdAt` is a hook that only fires when the write goes through your override. A column default fires always, including for migrations, bulk loads and anything writing outside
your process:

```ts
createdAt: Date & Sql<'timestamp'> & HasDefault;
```

```sql
ALTER TABLE "users" ALTER COLUMN "created_at" SET DEFAULT now();
```

`HasDefault` makes the column optional in `CreateDTO<User>`; the value itself lives in the migration, because a default is a runtime value and no type holds one. See
[Timestamp defaults](./guide-timestamp-defaults.html).

Reach for a hook when the value cannot come from the database — a slug derived from a title, an embedding, a call to another service.

## Performance

Every subscriber is awaited inside the write path, so a database call in a hook adds its latency to every affected operation, and a network call adds its failure modes too. For anything that is not
required to be atomic with the write, record an outbox row and let a consumer do the work.

---

See also: [Repository](./repository.html) · [Transactional Outbox](./transactional-outbox.html) · [Embeddables](./embeddables.html) · [Transactions](./transactions.html)
