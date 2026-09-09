Build one server with `zmdb`: a TypeScript schema supplies validation and repository types, the CLI generates its SQLite migration, and `createApp` serves the HTTP controllers. Add background jobs
explicitly when a request needs asynchronous work. The same application owns the selected worker's startup and shutdown.

Requires Node.js 26+, TypeScript 7+, ESM and Stage-3 decorators. Set `experimentalDecorators` to `false`; no `reflect-metadata` setup is needed.

## Start with the product

```bash
yarn add @zmdb/core@1.0.0-beta.2
yarn add --dev typescript@7.0.2 @types/node@26.4.1 esbuild@0.28.2
```

SQLite is included. Use `@zmdb/core` for the common vocabulary and focused concerns such as `@zmdb/core/app`, `@zmdb/core/web`, `@zmdb/core/orm` and `@zmdb/core/sqlite` when needed. The
[quick start](./quick-start.html) introduces schema types; [AOT setup](./aot-setup.html) explains the required compiler transform.

The [complete runnable server](https://github.com/ambasta/zmdb/blob/main/fixtures/consumer-server-core/src/documented-server.ts) uses the tested
[Order schema](https://github.com/ambasta/zmdb/blob/main/fixtures/consumer-product/src/schema.ts), [configuration](https://github.com/ambasta/zmdb/blob/main/fixtures/consumer-product/zmdb.config.ts)
and [public AOT build](https://github.com/ambasta/zmdb/blob/main/fixtures/consumer-product/build.mjs). The snippets below are excerpts from that complete program.

Generate the migration from the schema before starting the application:

```bash
yarn zmdb codegen
yarn zmdb generate --name create_orders
yarn zmdb migrate
```

The example configuration takes its database filename from `ZMDB_PRODUCT_DATABASE`. The CLI and application must receive the same filename. Migration generation supplies the SQL; the application does
not handwrite its own table definition.

## Validate before persistence

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies Order, orders, queue; this excerpt does not repeat those declarations."}
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

`Order`, its repository and the selected queue are declared in the complete program. The AOT build compiles `schemaOf<Order>()` and the validator. An empty name returns HTTP 400 before either
inserting an order or enqueueing a job. A valid request persists the entity and enqueues its typed job before returning the response. See [data integration](./web-data-integration.html) for the
repository boundary.

## Add a selected worker to the same application

```bash
yarn add @zmdb/jobs@1.0.0-beta.2 @zmdb/jobs-sqlite@1.0.0-beta.2
```

The core jobs package supplies queues, workers, schedules and provider ports. `@zmdb/jobs-sqlite` supplies both durable SQLite storage and the memory store used by this runnable example. Jobs are
absent from a default product install; there is no `@zmdb/core/jobs` facade.

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies ServerModule, worker; this excerpt does not repeat those declarations."}
import { jobsExtension } from '@zmdb/jobs';
import { createApp } from '@zmdb/core';

const app = createApp(ServerModule, {
  graceMs: 1000,
  extensions: [jobsExtension({ workers: [worker] })],
});
await app.init();
```

The example's worker validates the `order.created` payload and records the actual processed order identifier. `app.init()` starts it through the extension: there is no separate manual worker start or
second application. The [queues guide](./web-queues.html) covers retry, dead letters, durable providers and idempotency. Delivery remains at-least-once. Inserting an order and enqueueing in the
separate memory store are not one atomic transaction; use the provider's transactional enqueue API when an application requires that guarantee.

## Serve and close owned resources

The complete program bridges a real Node HTTP listener to `app.fetch`, sends its invalid and valid requests over loopback TCP, and observes the worker's completed job. Its `finally` blocks close the
listener, await `app[Symbol.asyncDispose]()` to drain the worker, then close the caller-owned store and order database. The lifecycle is shared; resource ownership is explicit.

From a repository checkout, run the exact installed example:

```bash
node fixtures/consumer-server-core/verify-installed.mjs --documented
```

This command builds and packs the selected packages, performs a real npm installation outside the workspace, typechecks the complete example, invokes the installed CLI/AOT build, and prints the
measured HTTP/job/cleanup result. It exits after the demonstration and removes its consumer. It is also the executable source for these excerpts.

## Advanced package boundaries

| Need                          | Public choice                                    | Owner and dependency direction                                  |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Cohesive server               | `@zmdb/core`, `@zmdb/core/app`, `@zmdb/core/web` | Product concerns delegate to their canonical owners             |
| Application kernel alone      | `@zmdb/app`                                      | DI, modules, lifecycle, commands and protocol-neutral ports     |
| HTTP alone                    | `@zmdb/web`                                      | Depends on app; owns routes, request contexts and HTTP adapters |
| Selected jobs                 | `@zmdb/jobs`                                     | Depends on app; owns queues, workers and scheduling             |
| Selected SQLite job store     | `@zmdb/jobs-sqlite`                              | Depends on the jobs protocol and SQLite owner                   |
| Selected PostgreSQL job store | `@zmdb/jobs-postgres` with `pg`                  | Borrows a caller-owned PostgreSQL pool/client                   |

See [application lifecycle](./web-app.html), [installation](./installation.html) and [package reference](./package-reference.html). Select broker transports and other integrations separately; they are
not prerequisites for this server journey.
