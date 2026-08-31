This is where `@zmdb/web` meets the [data layer](./repository.html). A controller
**injects a repository** via [DI](./web-di.html), validates the request body
against your **schema-derived DTO**, and returns typed entities — all on the same
zero-overhead path as the rest of zmdb.

## Define once, wire it up

```ts
import { DatabaseSync } from 'node:sqlite';
import { defineSchema, serial, integer, numeric } from '@zmdb/schema-core';
import { defineRepository, type BaseRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { Container, Inject, Controller, Get, Post, createRouter, repositoryToken, validateWith } from '@zmdb/web';
import type { Ctx } from '@zmdb/web';

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: numeric().notNull(),
});

// A typed DI token for the repository over this schema.
const OrderRepo = repositoryToken<typeof OrderSchema>('OrderRepo');
```

## The controller injects the repository

```ts
@Controller('/orders')
class OrdersController {
  @Inject(OrderRepo)
  repo!: BaseRepository<typeof OrderSchema>; // fully typed — no 'as'

  @Post()
  create(ctx: Ctx<Record<never, string>, { userId: number; total: number }>) {
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
container.register(OrderRepo, defineRepository(OrderSchema, sqliteDriver(db), { dialect: 'sqlite' }));

const controller = container.build(OrdersController); // @Inject satisfied here
const router = createRouter();
router.register(controller, {
  // validateWith adapts any validator — e.g. the AOT assert<CreateDTO<S>> — into
  // the pipeline's validate-before-handler hook. No runtime parser is embedded.
  create: { validateBody: validateWith(raw => assertCreateOrder(raw)) },
});

await router.handle({ method: 'POST', path: '/orders', headers: {}, rawBody: { userId: 1, total: 42 } });
// 200 → the persisted, typed order
```

> [!IMPORTANT]
> The body is validated **before** `create` runs — an invalid payload never
> reaches the repository (→ 400). Use `@zmdb/aot-validator`'s `assert` for
> zero-runtime-parser validation bound to the schema DTO.

## Design notes

- **No `as`** — the repository token carries the schema, so the injected field is
  `BaseRepository<OrderSchema>`.
- The repository is a plain [zmdb repository](./repository.html): no proxies, no
  identity map, [inert rows](./inert-rows.html).
- First-class validation/serialization _pipes_ (the `@nestjs/swagger`/
  `ClassSerializerInterceptor` analogues) build on this — coming with the
  middleware layer.

## Cross-links

- [Repository](./repository.html) · [Dependency injection](./web-di.html) · [Request pipeline](./web-pipeline.html)
