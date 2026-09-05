This is where `@zmdb/web` meets the [data layer](./repository.html). A controller **injects a repository** via [DI](./web-di.html), validates the request body against your **schema-derived DTO**, and
returns typed entities — all on the same zero-overhead path as the rest of zmdb.

## Define once, wire it up

```ts
import { DatabaseSync } from 'node:sqlite';
import { schemaOf } from '@zmdb/schema-core';
import { assert } from '@zmdb/aot-validator/utilities';
import { defineRepository, type BaseRepository } from '@zmdb/repository';
import type { CreateDTO } from 'zmdb/derive';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { Container, Inject, Controller, Get, Post, createRouter, repositoryToken, validateWith } from '@zmdb/web';
import type { Ctx } from '@zmdb/web';
import type { PrimaryKey, References, Serial, Sql, Table } from 'zmdb/tags';

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'> & References<'users.id'>;
  total: number & Sql<'numeric'>;
}

const orderSchema = schemaOf<Order>();

// A typed DI token for the repository over this schema.
const OrderRepo = repositoryToken<Order>('OrderRepo');
```

`schemaOf<Order>()` is the one call that crosses from the type to a value, and it is compile-time only — the transformer replaces it with the reflected schema object. Everything downstream, including
the DI token, is parameterised on `Order` itself: the value is what the query compiler needs, the type is what your code is written in.

## The controller injects the repository

```ts
@Controller('/orders')
class OrdersController {
  @Inject(OrderRepo)
  repo!: BaseRepository<Order>; // fully typed — no 'as'

  @Post()
  create(ctx: Ctx<Record<never, string>, CreateDTO<Order>>) {
    return this.repo.create(ctx.body); // validated CreateDTO → persisted
  }

  @Get('/:id')
  get(ctx: Ctx<{ id: string }>) {
    return this.repo.findById(Number(ctx.params.id));
  }
}
```

## Bind, validate, serve

```ts
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total NUMERIC NOT NULL)');

const container = new Container();
container.register(OrderRepo, defineRepository(orderSchema, sqliteDriver(db), { dialect: 'sqlite' }));

const controller = container.build(OrdersController); // @Inject satisfied here
const router = createRouter();
router.register(controller, {
  // validateWith adapts any validator into the pipeline's validate-before-handler
  // hook. `assert<CreateDTO<Order>>` is inlined at build time — no runtime parser
  // is embedded.
  create: { validateBody: validateWith(raw => assert<CreateDTO<Order>>(raw)) },
});

await router.handle({ method: 'POST', path: '/orders', headers: {}, rawBody: { userId: 1, total: 42 } });
// 200 → the persisted, typed order
```

> [!IMPORTANT] The body is validated **before** `create` runs — an invalid payload never reaches the repository (→ 400). `assert<CreateDTO<Order>>` is bound to the declaration by its type argument, so
> a column added to `Order` is checked here with nothing else to update.

## Design notes

- **No `as`** — the repository token carries the schema, so the injected field is `BaseRepository<Order>`.
- **One source of truth** — `Order` is the interface; the DDL, the DTOs, the validator and the OpenAPI document are all derived from it. See [Schema Declaration](./schema-declaration.html).
- The repository is a plain [zmdb repository](./repository.html): no proxies, no identity map, [inert rows](./inert-rows.html).
- First-class validation/serialization _pipes_ (the `@nestjs/swagger`/ `ClassSerializerInterceptor` analogues) build on this — coming with the middleware layer.

## Cross-links

- [Repository](./repository.html) · [Dependency injection](./web-di.html) · [Request pipeline](./web-pipeline.html)
