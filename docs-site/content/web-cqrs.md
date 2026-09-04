> **ToDo / feature gap.** There is no CQRS module — no `CommandBus`, `QueryBus`,
> CQRS `EventBus`, `@CommandHandler` or `@Saga`. Typed [application
> events](./web-events.html) do ship separately; they are not a command bus.
>
> `packages/web/src/cqrs/SPEC.md` freezes a **command** bus and refuses the query
> bus, event sourcing and sagas outright. The reasons are in "What it would take".

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
export type Commands = {
  publishPost: { input: { id: number }; result: { url: string } };
  cancelOrder: { input: { id: number; reason: string }; result: void };
};

export type Bus = { [K in keyof Commands]: (input: Commands[K]['input']) => Promise<Commands[K]['result']> };
```

Two details are not decoration. Each entry carries `input` **and** `result`, so `await bus.publishPost(…)` is typed from the map rather than from whatever the handler happened to return — a bus whose entries are just payloads types every call as `Promise<void>`. And `Commands` is a `type`, not an `interface`: only object-literal aliases get an implicit index signature, so an interface fails the frozen `M extends CommandMap` constraint with TS2344, "Index signature for type 'string' is missing".

Now `bus.publishPost({ id: 1 })` is checked against the map by name, its `{ url: string }` result is checked at the call site, a typo is a compile error, and there is no dispatch table at all. This is a plain service object, and for most applications it is strictly better than a bus.

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

[`@zmdb/web/events`](./web-events.html) ships a typed, app-owned in-process
emitter. It isolates handler failures and makes waiting explicit with `emit`
versus `emitAndWait`; it deliberately does not turn application events into a
CQRS command bus:

```ts
import { createEvents } from '@zmdb/web/events';

type AppEvents = {
  'post.published': { id: number };
};

const events = createEvents<AppEvents>({
  onError: failure => process.stderr.write(`${failure.event}: ${String(failure.error)}\n`),
});

events.emit('post.published', { id });
```

For anything that must survive a crash, cross through the shipped
[transactional outbox](./transactional-outbox.html):

```ts
import { outboxWriter } from '@zmdb/repository/outbox';

await db.transaction(async tx => {
  await repo.withTransaction(tx).update(id, { published: true });
  await outboxWriter(tx).write('post.published', JSON.stringify({ id }));
});
```

The state change and the event commit together or not at all. In-process
emission cannot give you that, which is why durable work crosses through the
outbox instead.

## Read models

A separate projection table, updated from the outbox, queried through its own schema:

```ts
import type { PrimaryKey, Sql, Table } from 'zmdb/tags';

export interface PostSummary extends Table<'post_summaries'> {
  postId: number & Sql<'integer'> & PrimaryKey;
  title: string & Sql<'text'>;
  commentCount: number & Sql<'integer'>;
}
```

Nothing in the declaration cares that no transaction writes to this table — it is a table with a repository, and the read side gets a shape built for its queries. A [materialized view](./materialized-views.html) is the lower-effort version when the projection is a query.

## What it would take

Less than a builder that accumulates `(kind, handler)` pairs into a type-level record, which is what this section used to propose. The mapped type above already _is_ that record, and it needs no type-level work at all: `CommandBus<M>` is `{ [K in keyof M]: (input: M[K]['input']) => Promise<M[K]['result']> }` over an object literal of handlers, so a missing handler is a missing property and a handler for an undeclared command is an excess one.

Which leaves the honest question: **a typed bus with no runtime lookup is a plain object, so what is the module for?** One thing, and it is worth the indirection on its own — it is the single place every write passes through, so validation, authorisation, the transaction and an audit hook are applied once instead of remembered at N call sites. A concern applied N times has N chances to be missing, and the missing one still compiles and still returns the right value for the inputs the test used. That is the whole of `packages/web/src/cqrs/SPEC.md`.

Three things it refuses, so they are decisions rather than omissions:

- **No query bus.** Reads already have a home, and `withReplicas` above already does the read/write split that CQRS is named for. A query bus adds a dispatch hop whose only property is symmetry — and the choke-point argument does not transfer, because a read has no transaction to centralise and its authorisation is [row-scoped filtering](./entity-filters.html), which belongs in the query.
- **No event sourcing.** It replaces the repository rather than layering on it, which makes it a different persistence model.
- **No sagas — yet.** A saga's easy part is calling three steps in order; its hard part is the terminal state of a failure that cannot be compensated, which needs durable per-step state. Built on an in-process emitter that state is lost on restart, which is usually the thing that interrupted the saga. The [outbox](./transactional-outbox.html) and queue worker now provide durable delivery and retries; a saga still needs an explicit state row and compensation contract rather than being smuggled into the command bus.

Commands also stay **types**, not classes — a `type` alias specifically, since only those satisfy the map's index signature. A `@CommandHandler(SomeCommand)` decorator needs a constructor to point at, which would make commands the one place in this project where a runtime class is mandatory — and it would buy a lookup key that a string literal in the map already provides.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Read Replicas](./read-replicas.html) · [Events](./web-events.html)
