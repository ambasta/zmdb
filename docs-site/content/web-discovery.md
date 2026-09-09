There is no discovery API. Nothing scans the filesystem, nothing reads decorator metadata at runtime to find providers, and there is no `DiscoveryService` — you list your controllers and providers in
`@Module`, and the framework builds exactly those.

## What that means in practice

```ts {"mode":"illustrative","id":"example-001","reason":"The surrounding example supplies DataModule, Module, POSTS, PostsController, UsersController, makeRepo; this excerpt does not repeat those declarations."}
@Module({
  controllers: [PostsController, UsersController],
  providers: [{ token: POSTS, useFactory: c => makeRepo(c) }],
  imports: [DataModule],
})
export class AppModule {}
```

The module graph is the manifest. `compileModule` validates eager and lazy imports, registers eager providers, builds eager controllers, and throws on an import cycle with its path. Lazy-controller
routes are still known and registered at startup; only their instances are deferred.

There is no glob, no `autoLoadEntities`, no `require.context`, no `reflect-metadata` scan. The cost is that adding a controller means adding a line; the benefit is that a missing registration is a
compile error at the module, not a route that silently does not exist.

## Finding your own routes

`getRoutes` reads the metadata the routing decorators wrote:

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies PostsController; this excerpt does not repeat those declarations."}
import { getRoutes } from '@zmdb/web/routing';

for (const route of getRoutes(PostsController)) {
  console.log(route.method, route.path, route.handlerName);
}
// GET /posts/ list
// GET /posts/:id byId
```

`ResolvedRoute` is `{ method, path, handlerName }` — enough to print a route table at startup, which is the most common legitimate use of discovery:

```ts {"mode":"illustrative","id":"example-003","reason":"The surrounding example supplies PostsController, UsersController, getRoutes; this excerpt does not repeat those declarations."}
const CONTROLLERS = [PostsController, UsersController] as const;

for (const C of CONTROLLERS) {
  for (const r of getRoutes(C)) console.log(`${r.method.padEnd(6)} ${r.path}`);
}
```

Note you supply the list. `WebApplication` does not expose its controllers — `createApp` keeps them internal — so keep the array in a module and use it for both `@Module({ controllers })` and the
table.

OpenAPI deliberately does **not** use this discovery list. Define an explicit HTTP contract, compile it once, and pass its serialisable IR to `toOpenApi(compiled.ir, options)`. Routing checks the
compiled controller binding; the renderer never reads controller metadata.

## Finding your schemas

Nothing enumerates your tables either. A schema comes from a type — `schemaOf<User>()` — and a type is not a value that can register itself, so there is nowhere for a registry to record into. Keep the
array:

```ts {"mode":"illustrative","id":"example-004","reason":"The application supplies the local modules ./domain/index.ts; this fence is an excerpt of that project."}
import { schemaOf } from '@zmdb/schema';
import type { Post, User } from './domain/index.ts';

export const ALL_TABLES = [schemaOf<User>(), schemaOf<Post>()] as const;
```

That array is what the tools that used to read a registry take directly:

```ts {"mode":"illustrative","id":"example-005","reason":"The surrounding example supplies ALL_TABLES, driver; this excerpt does not repeat those declarations."}
// truncate everything between tests
const tables = ALL_TABLES.map(s => `"${s.table}"`).join(', ');
await driver.execute({ effects: { operation: 'DDL', requiresPrimary: true, returnsRows: false }, text: `TRUNCATE ${tables} RESTART IDENTITY CASCADE`, parameters: [] });
```

```ts {"mode":"illustrative","id":"example-006","reason":"The surrounding example supplies ALL_TABLES, diff, emitUp, exec, snapshot; this excerpt does not repeat those declarations."}
// generate the whole schema
for (const op of diff({ tables: {} }, snapshot([...ALL_TABLES]))) await exec(emitUp(op, 'postgres'));
```

`snapshot` takes an explicit array by design, for the same reason `@Module` takes an explicit `controllers` list.

> [!NOTE] The old failure mode was an import-order one: a registry only knew about schemas whose module had been imported, so a `TRUNCATE`-everything helper could silently miss a table. The array has
> the same hazard in a more visible place — a table missing from `ALL_TABLES` is a line you can grep for. If it matters, pin it with a test that walks the source for `extends Table<'…'>` and compares
> the two sets; [Monorepo layout](./web-cli-monorepo.html) has one.

## Finding providers

```ts {"mode":"illustrative","id":"example-007","reason":"The surrounding example supplies CACHE, app; this excerpt does not repeat those declarations."}
if (app.container.has(CACHE)) {
  /* optional dependency */
}
```

`has` and `resolve` are keyed by token identity — there is no way to enumerate what is registered, because the container's map is private. If you need a list of the providers of some kind, keep the
list:

```ts {"mode":"illustrative","id":"example-008","reason":"The surrounding example supplies CACHE_CHECK, DB_CHECK, QUEUE_CHECK, app; this excerpt does not repeat those declarations."}
export const HEALTH_CHECKS = [DB_CHECK, CACHE_CHECK, QUEUE_CHECK] as const;

const results = await Promise.all(HEALTH_CHECKS.filter(t => app.container.has(t)).map(t => app.container.resolve(t).check()));
```

An explicit array is what a discovery-based plugin system gives you anyway, minus the runtime scan and the ordering surprises.

## Why no discovery

Three reasons, and they are the same reasons the rest of the framework has no reflection:

- **Startup cost.** A filesystem scan plus metadata reflection is paid on every cold start. There is nothing to scan here, which is most of why [serverless cold starts](./perf-serverless.html) are
  cheap.
- **Bundling.** A dynamic `require` of a glob defeats every bundler and every tree-shaker. An explicit import list bundles correctly with no configuration.
- **Failure mode.** A typo'd filename in a glob produces a missing route with no error. A missing import produces a compile error.

## What it would take

An opt-in `discover(controllers)` helper that walks a supplied array and returns routes plus tokens would be a thin wrapper over `getRoutes` and add little. Filesystem-based discovery would be a
genuine change of philosophy and is not planned — see [Anti-Patterns](./anti-patterns.html).

---

See also: [Modules](./web-modules.html) · [OpenAPI Generation](./openapi.html) · [Anti-Patterns](./anti-patterns.html)
