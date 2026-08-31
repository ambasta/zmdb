A complete blog API — schema, migrations, repository, HTTP, validation, OpenAPI, tests — with nothing declared twice. Roughly 200 lines end to end.

## 1. Install and configure the transformer

```bash
yarn add @zmdb/zmdb
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import zmdb from '@zmdb/zmdb/unplugin';

export default defineConfig({ plugins: [zmdb.vite()] });
```

See [AOT Setup](./aot-setup.html) for tsc, tsup, esbuild and webpack.

## 2. The schema

Two tables and one relation. This file is the only place the shape of a post exists.

```ts
// src/schema.ts
import { defineSchema, serial, integer, text, varchar, timestamp, boolean, references } from '@zmdb/schema-core';
import { oneToMany, manyToOne } from '@zmdb/schema-core/relations';

export const authors = defineSchema('authors', {
  id: serial().primaryKey(),
  email: text().notNull().unique().validate({ kind: 'pattern', value: '^[^@]+@[^@]+\\.[^@]+$' }),
  name: varchar(80).notNull(),
});

export const posts = defineSchema('posts', {
  id: serial().primaryKey(),
  authorId: references(integer(), authors, 'id').notNull(),
  title: varchar(200).notNull(),
  body: text().notNull(),
  published: boolean().notNull().defaultTo(false),
  createdAt: timestamp().notNull().defaultTo('now()'),
});

export const authorRelations = { posts: oneToMany(posts, 'authorId') };
export const postRelations = { author: manyToOne(authors, 'authorId') };
```

The derived types come for free:

```ts
import type { Entity, CreateDTO } from '@zmdb/schema-core';

type Post = Entity<typeof posts>;
// { id: number; authorId: number; title: string; body: string; published: boolean; createdAt: Date }

type NewPost = CreateDTO<typeof posts>;
// { authorId: number; title: string; body: string; published?: boolean; createdAt?: Date }
```

`id` is gone because it is `serial`; `published` and `createdAt` are optional because they have defaults. Nothing said so — it was derived.

## 3. Migrations

```ts
// scripts/generate.ts
import { snapshot, diff, emitUp } from '@zmdb/query-compiler/migrations';
import { authors, posts } from '../src/schema.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const prev = JSON.parse(readFileSync('migrations/snapshot.json', 'utf8'));
const next = snapshot([authors, posts]);

const sql = diff(prev, next).map(op => emitUp(op, 'postgres'));
writeFileSync(`migrations/${Date.now()}_auto.sql`, sql.join(';\n') + ';\n');
writeFileSync('migrations/snapshot.json', JSON.stringify(next, null, 2));
```

Run it, commit both files, and apply with the [runner](./migrations-cli.html). Full workflow in [Migrations](./migrations.html).

## 4. Repositories

```ts
// src/repositories.ts
import { defineRepository } from '@zmdb/repository';
import { authors, posts, authorRelations, postRelations } from './schema.ts';
import { driver } from './driver.ts';

export const authorRepo = defineRepository(authors, driver, { relations: authorRelations });
export const postRepo = defineRepository(posts, driver, { relations: postRelations });

export type PostRepo = typeof postRepo;
```

`defineRepository(schema, driver, options?)` returns a **repository instance**, not a
class — it builds an anonymous `BaseRepository` subclass with the schema bound as a
static and constructs it. `findById`, `find`, `findOne`, `list`, `create`, `update`,
`delete`, `aggregate` and the populate/join methods are all typed against the schema
you passed. Exporting `typeof postRepo` as a named type is what lets a controller
annotate its injected field.

## 5. A driver

```ts
// src/driver.ts
import { Pool } from 'pg';
import type { Driver, CompiledQuery } from '@zmdb/repository';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const driver: Driver = {
  async execute(query: CompiledQuery) {
    const res = await pool.query(query.text, [...query.parameters]);
    return res.rows;
  },
};
```

That is the entire database integration. See [Writing a Driver](./custom-driver.html).

## 6. The HTTP layer

```ts
// src/posts.controller.ts
import { Controller, Get, Post as HttpPost } from '@zmdb/web/routing';
import { Inject } from '@zmdb/web/di';
import type { Ctx } from '@zmdb/web/context';
import { assert } from '@zmdb/aot-validator/utilities';
import type { PostRepo } from './repositories.ts';
import { postRepoToken } from './tokens.ts';
import type { CreateDTO } from '@zmdb/schema-core';
import type { posts } from './schema.ts';

@Controller('/posts')
export class PostsController {
  @Inject(postRepoToken) private readonly repo!: PostRepo;

  @Get('/')
  async list() {
    return this.repo.list({
      where: { published: { eq: true } },
      orderBy: [{ column: 'createdAt', dir: 'desc' }],
      page: { limit: 20 },
    });
  }

  @Get('/:id')
  async byId(ctx: Ctx<{ id: string }>) {
    const post = await this.repo.findById(Number(ctx.params.id), { populate: ['author'] });
    if (post === undefined) throw new ValidationError('post not found', []);
    return post; // post.author is typed, because you asked for it
  }

  @HttpPost('/')
  async create(ctx: Ctx<Record<never, string>, unknown>) {
    const dto = assert<CreateDTO<typeof posts>>(ctx.body); // validator generated from the type
    return this.repo.create(dto);
  }
}
```

`assert<CreateDTO<typeof posts>>` is a validator the transformer derived from the schema, so adding a required column breaks this call site — not the request, at runtime, in production.

> [!TIP]
> `Ctx<Params, Body, Query>` is generic over the three request parts. `PathParams<'/posts/:id'>` derives `{ id: string }` from the path literal if you would rather not restate it. See [Typed Request Context](./web-context.html).

## 7. Wire it up

```ts
// src/app.ts
import { createServer } from 'node:http';
import { Module } from '@zmdb/web/modules';
import { createApp } from '@zmdb/web/app';
import { toNodeHandler, createRouter } from '@zmdb/web/pipeline';
import { PostsController } from './posts.controller.ts';
import { postRepo } from './repositories.ts';
import { postRepoToken } from './tokens.ts';

@Module({
  controllers: [PostsController],
  providers: [{ token: postRepoToken, useValue: postRepo }],
})
export class AppModule {}

await using app = createApp(AppModule);
await app.init(); // runs onModuleInit / onApplicationBootstrap

createServer((req, res) => {
  app
    .handle({ method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers as Record<string, string> })
    .then(r => {
      res.writeHead(r.status, r.headers);
      res.end(r.body);
    });
}).listen(3000);
```

`app.fetch(request)` is the same application behind a `Request`/`Response` pair, which is what you want on Workers, Deno and Bun. See [Application Bootstrap](./web-app.html).

## 8. OpenAPI, derived

```ts
import { toOpenApiComponents } from '@zmdb/schema-core/openapi';
import { toOpenApi } from '@zmdb/web/openapi';
import { authors, posts } from './schema.ts';
import { PostsController } from './posts.controller.ts';

const { schemas } = toOpenApiComponents([authors, posts]);
const doc = toOpenApi([PostsController], { info: { title: 'Blog', version: '1.0.0' }, schemas });
```

The response schema for `GET /posts` is the `list` variant of `posts`, generated from the same object that produced the table. See [OpenAPI Generation](./web-openapi.html).

## 9. Tests

```ts
import { createTestApp } from '@zmdb/web/testing';
import { expect, it } from 'vitest';

it('rejects a post with no title', async () => {
  await using app = createTestApp(AppModule);
  const res = await app.request({ method: 'POST', path: '/posts', body: { authorId: 1, body: 'x' } });
  expect(res.status).toBe(400);
});
```

No database needed for the validation path — swap `driver` for a fake in `overrides` to test the query path against asserted SQL text. See [Testing](./web-testing.html).

## What you did not have to write

- a second schema for validation
- a DTO class per request shape
- `@ApiProperty()` annotations
- a `params` interface
- a metadata plugin to recover types the decorators could not see

---

See also: [Quick Start](./quick-start.html) · [Schema Declaration](./schema-declaration.html) · [Building an API with zmdb](./web-data-integration.html) · [Migrations](./migrations.html)
