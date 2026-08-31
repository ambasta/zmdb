> **ToDo / feature gap.** There is no CQRS module — no `CommandBus`, `QueryBus`,
> `EventBus`, no `@CommandHandler` or `@Saga`. There is also no [event
> emitter](./web-events.html) to build one on.

## What you have to build with

More than it sounds: a typed container, a module graph, and a data layer whose write and read paths are already separable.

`BaseRepository` is not a CQRS obstacle — `create/update/delete` and `find*/list/aggregate` are distinct methods over the same driver, and the [replica helper](./read-replicas.html) already routes reads and writes to different connections:

```ts
import { withReplicas } from '@zmdb/repository/replicas';

const driver = withReplicas({ primary, replicas: [replicaA, replicaB] });
```

That is command/query _separation_ at the level that usually matters. The rest of CQRS — a bus, handlers resolved by message type, sagas — is application structure.

## A command bus in twenty lines

```ts
interface Command {
  readonly kind: string;
}
interface Handler<C extends Command, R> {
  execute(command: C): Promise<R>;
}

export class CommandBus {
  readonly #handlers = new Map<string, Handler<Command, unknown>>();

  register<C extends Command, R>(kind: C['kind'], handler: Handler<C, R>): void {
    if (this.#handlers.has(kind)) throw new Error(`duplicate handler for ${kind}`);
    this.#handlers.set(kind, handler as Handler<Command, unknown>);
  }

  async execute<R>(command: Command): Promise<R> {
    const handler = this.#handlers.get(command.kind);
    if (handler === undefined) throw new Error(`no handler for ${command.kind}`);
    return (await handler.execute(command)) as R;
  }
}
```

Two casts, and they are the reason this is not in the framework: a heterogeneous `kind → handler` map cannot prove its value types structurally, so a bus either carries assertions or gives up the typing that made it worth having. The project's own [assertion policy](./anti-patterns.html) is why a half-typed bus has not shipped.

The typed alternative — no map, no casts:

```ts
export interface Commands {
  publishPost: { id: number };
  cancelOrder: { id: number; reason: string };
}

export type Bus = { [K in keyof Commands]: (input: Commands[K]) => Promise<void> };
```

Now `bus.publishPost({ id: 1 })` is checked, a typo is a compile error, and there is no dispatch table at all. This is a plain service object, and for most applications it is strictly better than a bus.

## Register it in the container

```ts
export const BUS = createToken<Bus>('BUS');

@Module({
  providers: [
    {
      token: BUS,
      useFactory: c => ({
        publishPost: input => c.resolve(PUBLISH).execute(input),
        cancelOrder: input => c.resolve(CANCEL).execute(input),
      }),
    },
  ],
})
export class CqrsModule {}
```

## Events

There is no event bus, and [`web-events`](./web-events.html) is also a gap. For in-process events, an array of listeners is enough; for anything that must survive a crash, use the [transactional outbox](./transactional-outbox.html) — which _is_ built, and is the right pattern for domain events that trigger work elsewhere:

```ts
await db.transaction(async tx => {
  await repo.withTransaction(tx).update(id, { published: true });
  await outbox.withTransaction(tx).create({ type: 'post.published', payload: { id }, at: new Date() });
});
```

The state change and the event commit together or not at all. An in-memory emitter cannot give you that, which is why an outbox beats an `EventBus` for anything that matters.

## Read models

A separate projection table, updated from the outbox, queried through its own schema:

```ts
export const postSummaries = defineSchema('post_summaries', {
  postId: integer().primaryKey(),
  title: text().notNull(),
  commentCount: integer().notNull(),
});
```

`defineSchema` does not care that nothing writes to this table transactionally — it is a table with a repository, and the read side gets a shape built for its queries. A [materialized view](./materialized-views.html) is the lower-effort version when the projection is a query.

## What it would take

A CQRS module is mostly a typed dispatch mechanism, and the typed-map problem above is the whole design question. A plausible shape: a builder that accumulates `(kind, handler)` pairs into a type-level record, so `execute` is checked without a runtime lookup by string. That is a real piece of type-level work rather than a missing class, and it would want the [event emitter](./web-events.html) built first so sagas have something to subscribe to.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Read Replicas](./read-replicas.html) · [Events](./web-events.html)
