The server uses one `Order` declaration for validation, repository types and generated migrations. Start from the [complete HTTP and selected-jobs journey](./web-overview.html), whose runnable program
uses only public product concerns plus explicitly selected jobs packages.

## Bind the declared schema to SQLite

These excerpts share the complete program's `Order` declaration and database filename:

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies Order, databasePath; this excerpt does not repeat those declarations."}
import { DatabaseSync } from 'node:sqlite';
import { defineRepository, schemaOf } from '@zmdb/core';
import { sqlite, sqliteDriver } from '@zmdb/core/sqlite';

const database = new DatabaseSync(databasePath);
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(database), { dialect: sqlite });
```

SQLite is included in `yarn add @zmdb/core@1.0.0-beta.1`. `schemaOf<Order>()` is compiled by the public AOT plugin, and `@zmdb/core generate` / `@zmdb/core migrate` supply and apply the table
definition before startup. The caller owns the database handle. A repository's returned rows are plain objects; changing a property does not persist it.

## Validate the HTTP input before writing

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies Order, orders, queue; this excerpt does not repeat those declarations."}
import { Controller, Post, assert, type CreateDTO, type Ctx } from '@zmdb/core';

@Controller('/orders')
class OrdersController {
  @Post()
  async create(ctx: Ctx<Record<never, string>, CreateDTO<Order>>) {
    const order = await orders.create(assert<CreateDTO<Order>>(ctx.body));
    await queue.enqueue('order.created', { orderId: order.id, name: order.name });
    return order;
  }
}
```

The complete example declares the queue explicitly and attaches its real worker through `jobsExtension` on the same `createApp` call. Invalid input returns 400 before creating either an order or a
job. A valid response contains the persisted entity; the worker consumes its typed payload. The order write and this separate memory queue are not transactionally atomic.

For dependency injection, bind the same repository through `repositoryToken` from `@zmdb/core/app/data`; [dependency injection](./web-di.html) describes provider lifetimes. For a PostgreSQL database
or durable job storage, select the corresponding provider and keep its connection ownership explicit.

## Cleanup

Close the caller's HTTP listener first. Await application disposal to drain extensions and run shutdown hooks, then close caller-owned stores and database connections. The runnable installed example
checks the closed handles and rebinds its released port.

See [repositories](./repository.html), [request pipeline](./web-pipeline.html), [application lifecycle](./web-app.html) and [queues](./web-queues.html).
