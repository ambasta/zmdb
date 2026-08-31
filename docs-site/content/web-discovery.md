There is no discovery API. Nothing scans the filesystem, nothing reads decorator metadata at runtime to find providers, and there is no `DiscoveryService` — you list your controllers and providers in `@Module`, and the framework builds exactly those.

## What that means in practice

```ts
@Module({
  controllers: [PostsController, UsersController],
  providers: [{ token: POSTS, useFactory: c => makeRepo(c) }],
  imports: [DataModule],
})
export class AppModule {}
```

The module graph is the manifest. `compileModule` visits imports depth-first, registers each module's providers, builds each module's controllers, and throws on an import cycle. That is the entire wiring step, and it happens once at startup.

There is no glob, no `autoLoadEntities`, no `require.context`, no `reflect-metadata` scan. The cost is that adding a controller means adding a line; the benefit is that a missing registration is a compile error at the module, not a route that silently does not exist.

## Finding your own routes

`getRoutes` reads the metadata the routing decorators wrote:

```ts
import { getRoutes } from '@zmdb/web/routing';

for (const route of getRoutes(PostsController)) {
  console.log(route.method, route.path, route.handlerName);
}
// GET /posts/ list
// GET /posts/:id byId
```

`ResolvedRoute` is `{ method, path, handlerName }` — enough to print a route table at startup, which is the most common legitimate use of discovery:

```ts
const CONTROLLERS = [PostsController, UsersController] as const;

for (const C of CONTROLLERS) {
  for (const r of getRoutes(C)) console.log(`${r.method.padEnd(6)} ${r.path}`);
}
```

Note you supply the list. `App` does not expose its controllers — `createApp` keeps them internal — so keep the array in a module and use it for both `@Module({ controllers })` and the table.

This is also how [OpenAPI generation](./openapi.html) works: `toOpenApi(controllers, options)` takes the same list and reads routes from it.

## Finding registered schemas

The schema side does have a registry, because `defineSchema` records into one:

```ts
import { registeredSchemas, getRegisteredSchema } from '@zmdb/schema-core';

for (const schema of registeredSchemas()) console.log(schema.table);
const users = getRegisteredSchema('users');
```

Genuinely useful, and used by real code in these docs:

```ts
// truncate everything between tests
const tables = registeredSchemas()
  .map(s => `"${s.table}"`)
  .join(', ');
await driver.execute({ text: `TRUNCATE ${tables} RESTART IDENTITY CASCADE`, parameters: [] });
```

```ts
// generate the whole schema
for (const op of diff({ tables: {} }, snapshot(registeredSchemas()))) await exec(emitUp(op, 'postgres'));
```

> [!NOTE]
> `registeredSchemas()` only knows about schemas whose module has been
> **imported**. A schema file nothing imports is not registered, so a
> `TRUNCATE`-everything helper can silently miss a table. Import your schemas from
> one barrel module and use that.

## Finding providers

```ts
if (app.container.has(CACHE)) {
  /* optional dependency */
}
```

`has` and `resolve` are keyed by token identity — there is no way to enumerate what is registered, because the container's map is private. If you need a list of the providers of some kind, keep the list:

```ts
export const HEALTH_CHECKS = [DB_CHECK, CACHE_CHECK, QUEUE_CHECK] as const;

const results = await Promise.all(
  HEALTH_CHECKS.filter(t => app.container.has(t)).map(t => app.container.resolve(t).check()),
);
```

An explicit array is what a discovery-based plugin system gives you anyway, minus the runtime scan and the ordering surprises.

## Why no discovery

Three reasons, and they are the same reasons the rest of the framework has no reflection:

- **Startup cost.** A filesystem scan plus metadata reflection is paid on every cold start. There is nothing to scan here, which is most of why [serverless cold starts](./perf-serverless.html) are cheap.
- **Bundling.** A dynamic `require` of a glob defeats every bundler and every tree-shaker. An explicit import list bundles correctly with no configuration.
- **Failure mode.** A typo'd filename in a glob produces a missing route with no error. A missing import produces a compile error.

## What it would take

An opt-in `discover(controllers)` helper that walks a supplied array and returns routes plus tokens would be a thin wrapper over `getRoutes` and add little. Filesystem-based discovery would be a genuine change of philosophy and is not planned — see [Anti-Patterns](./anti-patterns.html).

---

See also: [Modules](./web-modules.html) · [OpenAPI Generation](./openapi.html) · [Anti-Patterns](./anti-patterns.html)
