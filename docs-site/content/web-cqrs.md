`@zmdb/web/cqrs` ships one deliberately narrow CQRS primitive: a typed command boundary. It does not ship a query bus, event sourcing, handler decorators or sagas; those are explicit decisions rather
than unfinished arms of the API.

## What the command boundary earns

A command bus is useful here only when the application routes each command through one fixed pipeline: validate, optional authorisation, optional transaction, handler, outcome observation. A
string-keyed `dispatch(name, unknown)` API would give up the input and result types that justify the indirection, so the caller gets one method per command.

```ts
import { createTransactionalDb } from '@zmdb/repository/transactions';
import { createCommandBus, type CommandBus, type CommandHandlers } from '@zmdb/web/cqrs';
import { createToken } from '@zmdb/web/di';

type Commands = {
  publishPost: {
    input: { id: number };
    result: { url: string };
  };
  cancelOrder: {
    input: { id: number; reason: string };
    result: void;
  };
};

const db = createTransactionalDb(connection);

const handlers: CommandHandlers<Commands> = {
  publishPost: async ({ id }, { tx }) => {
    if (tx === undefined) throw new Error('publishPost requires a transaction');
    const post = await posts.withTransaction(tx).update(id, { published: true });
    if (post === undefined) throw new Error(`post ${id} not found`);
    return { url: `/posts/${post.id}` };
  },
  cancelOrder: async ({ id, reason }, { tx }) => {
    if (tx === undefined) throw new Error('cancelOrder requires a transaction');
    await orders.withTransaction(tx).update(id, { status: 'cancelled', reason });
  },
};

const bus = createCommandBus<Commands>(handlers, {
  validate: {
    publishPost: validatePublishPost,
    cancelOrder: validateCancelOrder,
  },
  authorise: (command, input) => policy.authorise(command, input),
  transaction: fn => db.transaction(fn),
  onCommand: outcome => audit.record(outcome),
});

export const BUS = createToken<CommandBus<Commands>>('BUS');
```

`validate` is required and total: adding a command without adding its validator or handler is a compile error. The validator's return value, not the raw argument, reaches authorisation and the
handler. Handler results are checked against the same map, so `bus.publishPost({ id: 1 })` resolves as `{ url: string }` and a misspelled command is not a property.

Validation and authorisation run before the optional transaction opens. A handler receives the exact `TransactionContext` supplied by the wrapper and can bind repositories or call
`events.emitInTransaction` with it. The wrapper cannot force a handler to use that context: writing through an unbound repository escapes the transaction, so transactional handlers must use
`repo.withTransaction(tx)`. Failures are re-thrown unchanged after `onCommand` observes the outcome, and an observer failure cannot replace either the result or the original error.

## Reads stay in repositories

`BaseRepository` already separates `create/update/delete` from `find*/list/aggregate`, and the [replica helper](./read-replicas.html) routes reads and writes to different connections:

```ts
import { withReplicas } from '@zmdb/repository/replicas';

const driver = withReplicas({ primary, replicas: [replicaA, replicaB] });
```

That is command/query separation at the level that matters here. A query bus would add symmetry without centralising a transaction, and row-scoped read authorisation belongs in the query predicate.

## Register it in the container

```ts
@Module({
  providers: [{ token: BUS, useValue: bus }],
})
export class CqrsModule {}
```

The bus is an ordinary app-owned value, not a container-owned singleton. Build one per application and register it like any other provider.

## Events

[`@zmdb/web/events`](./web-events.html) ships a typed, app-owned in-process emitter. It isolates handler failures and makes waiting explicit with `emit` versus `emitAndWait`; it deliberately does not
turn application events into a CQRS command bus:

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

For anything that must survive a crash, cross through the shipped [transactional outbox](./transactional-outbox.html):

```ts
import { outboxWriter } from '@zmdb/repository/outbox';

await db.transaction(async tx => {
  await repo.withTransaction(tx).update(id, { published: true });
  await outboxWriter(tx).write('post.published', JSON.stringify({ id }));
});
```

The state change and the event commit together or not at all. In-process emission cannot give you that, which is why durable work crosses through the outbox instead.

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

Nothing in the declaration cares that no transaction writes to this table — it is a table with a repository, and the read side gets a shape built for its queries. A
[materialized view](./materialized-views.html) is the lower-effort version when the projection is a query.

## The shipped scope

`CommandBus<M>` is `{ [K in keyof M]: (input: M[K]['input']) => Promise<M[K]['result']> }` over the supplied handler object. A missing handler is a missing property and a handler for an undeclared
command is an excess one.

The module earns its place by making validation, authorisation, the transaction and an audit hook one boundary instead of conventions repeated at every handler.

Three things it refuses, so they are decisions rather than omissions:

- **No query bus.** Reads already have a home, and `withReplicas` above already does the read/write split that CQRS is named for. A query bus adds a dispatch hop whose only property is symmetry — and
  the choke-point argument does not transfer, because a read has no transaction to centralise and its authorisation is [row-scoped filtering](./entity-filters.html), which belongs in the query.
- **No event sourcing.** It replaces the repository rather than layering on it, which makes it a different persistence model.
- **No sagas — yet.** A saga's easy part is calling three steps in order; its hard part is the terminal state of a failure that cannot be compensated, which needs durable per-step state. Built on an
  in-process emitter that state is lost on restart, which is usually the thing that interrupted the saga. The [outbox](./transactional-outbox.html) and queue worker now provide durable delivery and
  retries; a saga still needs an explicit state row and compensation contract rather than being smuggled into the command bus.

Commands also stay **types**, not classes — a `type` alias specifically, since only those satisfy the map's index signature. A `@CommandHandler(SomeCommand)` decorator needs a constructor to point at,
which would make commands the one place in this project where a runtime class is mandatory — and it would buy a lookup key that a string literal in the map already provides.

---

See also: [Transactional Outbox](./transactional-outbox.html) · [Read Replicas](./read-replicas.html) · [Events](./web-events.html)
