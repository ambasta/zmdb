A complete blog API — schema, migrations, repository, HTTP, validation, OpenAPI, tests — with nothing declared twice. Roughly 200 lines end to end.

## 1. Install and configure the transformer

```bash
yarn add zmdb
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { zmdbAot } from 'zmdb/compiler';

export default defineConfig({ plugins: [await zmdbAot()] });
```

See [AOT Setup](./aot-setup.html) for tsc, tsup, esbuild and webpack.

## 2. The schema

Two tables and one relation. This file is the only place the shape of a post exists.

```ts
// src/schema.ts
import type { HasDefault, Length, ManyToOne, OneToMany, Pattern, PrimaryKey, References, Serial, Sql, Table, Unique } from 'zmdb/schema';

export interface Author extends Table<'authors'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'> & Unique & Pattern<'^[^@]+@[^@]+\\.[^@]+$'>;
  name: string & Sql<'varchar'> & Length<80>;
  posts?: Post[] & OneToMany<'posts', 'authorId'>;
}

export interface Post extends Table<'posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  authorId: number & Sql<'integer'> & References<'authors.id'>;
  title: string & Sql<'varchar'> & Length<200>;
  body: string & Sql<'text'>;
  published: boolean & HasDefault;
  createdAt: Date & Sql<'timestamp'> & HasDefault;
  author?: Author & ManyToOne<'authors', 'authorId'>;
}
```

The derived types come for free:

```ts
import type { CreateDTO, Entity } from 'zmdb';

type Row = Entity<Post>;
// { id: number; authorId: number; title: string; body: string; published: boolean; createdAt: Date }

type NewPost = CreateDTO<Post>;
// { authorId: number; title: string; body: string; published?: boolean; createdAt?: Date }
```

`id` is gone because it is `Serial`; `published` and `createdAt` are optional because they say `HasDefault`. The relations are gone too — a join target is not something to `INSERT`. Nothing restated
any of that; it was read off the declaration.

## 3. Migrations

```ts
// scripts/generate.ts
import { diff, emitUp, snapshot } from 'zmdb/migrations';
import { schemaOf } from 'zmdb';
import type { Author, Post } from '../src/schema.js';
import { readFileSync, writeFileSync } from 'node:fs';

const prev = JSON.parse(readFileSync('migrations/snapshot.json', 'utf8'));
const next = snapshot([schemaOf<Author>(), schemaOf<Post>()]);

const sql = diff(prev, next).map(op => emitUp(op, 'postgres'));
writeFileSync(`migrations/${Date.now()}_auto.sql`, sql.join(';\n') + ';\n');
writeFileSync('migrations/snapshot.json', JSON.stringify(next, null, 2));
```

Run it, commit both files, and apply with the [runner](./migrations-cli.html). Full workflow in [Migrations](./migrations.html).

## 4. Repositories

```ts
// src/repositories.ts
import { defineRepository, schemaOf } from 'zmdb';
import type { Author, Post } from './schema.js';
import { driver } from './driver.js';

export const authorRepo = defineRepository(schemaOf<Author>(), driver);
export const postRepo = defineRepository(schemaOf<Post>(), driver);

export type PostRepo = typeof postRepo;
```

`defineRepository(schema, driver, options?)` returns a **repository instance**, not a class — it builds an anonymous `BaseRepository` subclass with the schema bound as a static and constructs it.
`findById`, `find`, `findOne`, `list`, `create`, `update`, `delete`, `aggregate` and the populate/join methods are all typed against the schema you passed. Exporting `typeof postRepo` as a named type
is what lets a controller annotate its injected field.

Relations need no wiring here. `OneToMany<'posts', 'authorId'>` on the interface in step 2 is the whole declaration: `authorRepo.findAll({ populate: ['posts'] })` type-checks the key against it and
batches the child query from the same tag. There used to be a `relations` option on this call that restated the target and the foreign key.

## 5. A driver

```ts
// src/driver.ts
import { Pool } from 'pg';
import type { Driver } from 'zmdb';
import type { CompiledQuery } from 'zmdb/sql';

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
import { Controller, Get, Post as HttpPost, ValidationError, assert, type CreateDTO, type Ctx } from 'zmdb';
import { Inject } from 'zmdb/web';
import type { PostRepo } from './repositories.js';
import type { Post } from './schema.js';
import { postRepoToken } from './tokens.js';

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
    const dto = assert<CreateDTO<Post>>(ctx.body); // validator generated from the type
    return this.repo.create(dto);
  }
}
```

`assert<CreateDTO<Post>>` is a validator the transformer derived from the declaration, so adding a required column breaks this call site — not the request, at runtime, in production.

> [!TIP] `Ctx<Params, Body, Query>` is generic over the three request parts. `PathParams<'/posts/:id'>` derives `{ id: string }` from the path literal if you would rather not restate it. See
> [Typed Request Context](./web-context.html).

## 7. Wire it up

```ts
// src/app.ts
import { createServer } from 'node:http';
import { Module, createApp } from 'zmdb';
import { bodyText } from 'zmdb/web';
import { PostsController } from './posts.controller.js';
import { postRepo } from './repositories.js';
import { postRepoToken } from './tokens.js';

@Module({
  controllers: [PostsController],
  providers: [{ token: postRepoToken, useValue: postRepo }],
})
export class AppModule {}

await using app = createApp(AppModule);
await app.init(); // runs onModuleInit / onApplicationBootstrap

createServer((req, res) => {
  app.handle({ method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers as Record<string, string> }).then(async r => {
    res.writeHead(r.status, r.headers);
    res.end(await bodyText(r));
  });
}).listen(3000);
```

`app.fetch(request)` is the same application behind a `Request`/`Response` pair, which is what you want on Workers, Deno and Bun. See [Application Bootstrap](./web-app.html). The module-level Node
snippet buffers a streamed response; use `toNodeHandler(router)` when the route surface is registered directly on a router and must stream with backpressure.

## 8. OpenAPI, derived

```ts
import { toOpenApi } from 'zmdb/web';
import { compileHttpContracts } from 'zmdb/web/contract/compiler';

import { HTTP_CONTRACT } from './http-contract.js';

const compiled = compileHttpContracts([{ file: new URL('./http-contract.ts', import.meta.url), exportName: 'HTTP_CONTRACT', contract: HTTP_CONTRACT }], { session });
const doc = toOpenApi(compiled.ir, { info: { title: 'Blog', version: '1.0.0' } });
```

The contract's `GET /posts` response schema is reflected once during compilation, then shared by routing, OpenAPI, and generated clients. `session` is the build's caller-owned `ReflectSession`. See
[OpenAPI Generation](./web-openapi.html).

## 9. Tests

```ts
import { createTestApp } from 'zmdb/testing';
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
