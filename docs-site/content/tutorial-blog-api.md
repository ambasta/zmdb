Build a small blog API with the same `@zmdb/core` installation used in the [quick start](./quick-start.html). One table declaration supplies repository types, migration input and request validation.
The application serves that repository through HTTP; the [generated-client workflow](./generated-client.html) then gives callers a public contract.

This tutorial uses the included SQLite provider and caller-owned database connection. The
[complete installed server example](https://github.com/ambasta/zmdb/blob/main/fixtures/consumer-server-core/src/documented-server.ts) demonstrates the same schema, repository, HTTP and shutdown
boundaries with a real Node listener and an optional worker.

## 1. Create the project

```bash
yarn dlx -p @zmdb/cli@1.0.0-beta.2 zmdb new project blog
cd blog
yarn install
```

The CLI supplies the strict TypeScript configuration, AOT build and application scripts. Keep that build configuration: `schemaOf<T>()` and `assert<T>()` require the transform. See
[AOT setup](./aot-setup.html) for an existing project.

## 2. Declare the post once

Replace `src/schema.ts` with the table declaration:

```ts {"mode":"compile","id":"schema","group":"blog-app","file":"src/schema.ts","environment":"node"}
import type { MinLength, PrimaryKey, Serial, Sql, Table } from '@zmdb/core';

export interface BlogPost extends Table<'posts'> {
  readonly id: number & Sql<'integer'> & Serial & PrimaryKey;
  readonly title: string & Sql<'text'> & MinLength<1>;
  readonly body: string & Sql<'text'>;
}
```

`CreateDTO<BlogPost>` excludes the generated identifier and requires the title and body. `Entity<BlogPost>` describes the stored row. Changing the declaration updates these types and the AOT
validator; [type derivation](./type-derivation.html) explains the other request and query shapes.

## 3. Generate and apply the migration

Use the public configuration in `zmdb.config.ts`. Both the CLI and application below open `blog.sqlite` from the project directory.

```ts {"mode":"compile","id":"configuration","group":"blog-app","file":"zmdb.config.ts","environment":"node"}
import { DatabaseSync } from 'node:sqlite';
import { defineConfig } from '@zmdb/core/config';
import { sqlite, sqliteDriver } from '@zmdb/core/sqlite';

export default defineConfig({
  schema: './src/schema.ts',
  dialect: sqlite,
  project: './tsconfig.json',
  out: './migrations',
  driver: () => {
    const database = new DatabaseSync('blog.sqlite');
    return Object.assign(sqliteDriver(database), {
      [Symbol.dispose]: () => database.close(),
    });
  },
});
```

```bash
yarn zmdb codegen
yarn zmdb generate --name create_posts
yarn zmdb migrate
```

Review and commit the generated migration and snapshot. Subsequent schema changes use the same generation and ledger workflow. The [migration guide](./migrations.html) covers reviewing plans and
[database selection](./drivers.html) covers choosing another complete provider.

## 4. Bind validation, persistence and HTTP

Replace `src/main.ts` with this program. The repository uses the same schema and SQLite dialect as the migration. The controller validates the incoming create DTO before persistence.

```ts {"mode":"compile","id":"application","group":"blog-app","file":"src/main.ts","environment":"node"}
import { DatabaseSync } from 'node:sqlite';
import { Controller, Get, Module, Post, assert, createApp, defineRepository, schemaOf, type CreateDTO, type Ctx } from '@zmdb/core';
import { sqlite, sqliteDriver } from '@zmdb/core/sqlite';

import type { BlogPost } from './schema.js';

const database = new DatabaseSync('blog.sqlite');
const posts = defineRepository(schemaOf<BlogPost>(), sqliteDriver(database), { dialect: sqlite });

@Controller('/posts')
class PostsController {
  @Get()
  list() {
    return posts.find({});
  }

  @Post()
  create(ctx: Ctx<Record<never, string>, CreateDTO<BlogPost>>) {
    return posts.create(assert<CreateDTO<BlogPost>>(ctx.body));
  }
}

@Module({ controllers: [PostsController] })
class BlogModule {}

const app = createApp(BlogModule);
try {
  await app.init();
  const created = await app.fetch(
    new Request('http://blog.local/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'First post', body: 'Hello from zmdb.' }),
    }),
  );
  console.log(created.status, await created.json());

  const listed = await app.fetch(new Request('http://blog.local/posts'));
  console.log(listed.status, await listed.json());
} finally {
  try {
    await app[Symbol.asyncDispose]();
  } finally {
    database.close();
  }
}
```

```bash
yarn check
yarn build
yarn start
```

The example dispatches standard HTTP `Request` objects through the application, prints the responses and exits after closing its resources. To serve requests over a Node listener, follow the
[server journey](./web-overview.html), which includes body/header forwarding and listener cleanup. [Application lifecycle](./web-app.html) explains initialization and shutdown ownership.

The generated validator rejects an empty title. Repository writes remain explicit, and returned rows are plain data. Extend the same repository with [filters](./filters.html),
[pagination](./pagination.html) and [relations](./relations.html) as the application needs them.

## 5. Share the HTTP contract with callers

Follow [Generated HTTP client](./generated-client.html) to declare the operations with `defineHttpContract` and `httpOperation`, bind that declaration to routing, and configure the sibling OpenAPI and
client outputs in `zmdb.config.ts`. Use the post entity and create DTO as the application's response and request types.

```bash
yarn zmdb client generate
yarn zmdb client generate --check
```

Run these commands after adding the HTTP contract and output configuration. The same compiled operation model supplies runtime registration, OpenAPI and client generation. The generated client accepts
the caller's base URL, authentication and cancellation; it does not invent a second data model.

Continue to [client applications](./framework-integrations.html) for the selected UI framework. Add [background jobs](./web-queues.html), [authentication](./web-authentication.html) or other
integrations at their existing application boundaries.

## Check the application at its public boundaries

The [HTTP testing guide](./web-testing.html) shows request/response tests and provider overrides. Keep a real selected-database integration check for persistence and migrations. The
[installed server example](./web-overview.html#serve-and-close-owned-resources) exercises a real HTTP listener, invalid and valid requests, database persistence and shutdown through the public
packages.

The next steps stay on the same product path: [schema](./schema-declaration.html) → [repository](./repository.html) → [validation](./validators-validate.html) → [HTTP](./web-overview.html) →
[generated client](./generated-client.html) → [integrations](./package-reference.html).
