> **ToDo / feature gap.** There is no REPL helper — no `repl()` entry point, no
> `$(Controller)` or `methods()` helpers, no interactive shell that boots the
> module graph.

## What replaces it, and why it is nearly as good

Node's REPL plus a module graph that works standalone. `compileModule` gives you
`{ container, controllers, lazy }` with no lifecycle owner, and `createApp`
wraps it in an `App` whose startup step is `init()` — no server, no listener,
no adapter. Six lines get you every eager service:

```bash
node --experimental-strip-types
```

```ts
> const { createApp } = await import('@zmdb/web');
> const { AppModule } = await import('./src/app.module.ts');
> const app = createApp(AppModule);
> await app.init();
> const posts = app.container.resolve(POSTS);
> await posts.list({ page: { limit: 5 } });
```

`app.container` is public and `resolve` takes a token, so anything your modules register is reachable. That is the substance of what a REPL command provides.

For a declared lazy subtree, load its per-app handle before resolving one of its
tokens:

```ts
> await app.lazy.find(handle => handle.name === 'AdminModule')?.load()
```

## A small script that does the setup

```ts
// scripts/repl.ts
import repl from 'node:repl';
import { createApp } from '@zmdb/web';
import { AppModule } from '../src/app.module.ts';
import { POSTS, USERS, DRIVER } from '../src/tokens.ts';

const app = createApp(AppModule);
await app.init();
const server = repl.start('zmdb> ');

Object.assign(server.context, {
  app,
  posts: app.container.resolve(POSTS),
  users: app.container.resolve(USERS),
  driver: app.container.resolve(DRIVER),
  sql: (text: string, parameters: readonly unknown[] = []) =>
    app.container.resolve(DRIVER).execute({ text, parameters }),
});

server.on('exit', () => {
  void app[Symbol.asyncDispose]().then(() => process.exit(0));
});
```

```bash
node --experimental-strip-types scripts/repl.ts
```

```
zmdb> await posts.findById(1)
zmdb> await sql('SELECT count(*) FROM posts')
```

The `exit` handler is what stops the process hanging on an open pool.

## Calling a handler rather than a service

`createTestApp` drives the full request path — routing, params, body parsing — which is often what you actually want to poke at:

```ts
> const { createTestApp } = await import('@zmdb/web/testing');
> const t = createTestApp(AppModule);
> await t.request({ method: 'GET', path: '/posts/1', headers: {} });
{ status: 200, body: '{"id":1,...}', headers: { 'content-type': 'application/json' } }
```

No socket, no port. This is the closest thing to `$(PostsController).byId(1)` and it exercises more of the stack.

## Inspecting a query without running it

The most useful REPL trick in the project:

```ts
> compiler.selectFrom('posts').select(['id', 'title']).where('published', '=', true).compile()
{ text: 'SELECT "id", "title" FROM "posts" WHERE "published" = $1', parameters: [true] }
```

No connection needed. Iterating on a query shape in the REPL and reading the SQL beats guessing. See [Debugging Queries](./logging.html).

## Do not point it at production

> [!WARNING]
> A REPL against a production database is a shell with full write access, no audit
> trail and no undo. A mistyped `delete` has no confirmation step. If you must use
> one for an incident, connect with a read-only role — and get the query reviewed
> before running a write.

The AOT transformer also does not run under type stripping, so `assert<T>()` in a REPL session does not validate — it throws `runtime type witness required in test/fallback mode`. It fails loudly rather than accepting anything, which is the right direction, but it does mean a REPL is not where you find out whether validation works. Use a test. See [JIT vs AOT](./jit-vs-aot.html).

## What it would take

Small: a `@zmdb/web/repl` entry point that boots a module, populates the context from a token map, and disposes on exit — essentially the script above, generalised. The only real design question is how to discover the tokens to expose, since [there is no discovery mechanism](./web-discovery.html), so it would take an explicit map either way.

Given that, the twenty-line script is close to the whole feature, and committing it to your own repository lets you tailor the context.

---

See also: [Standalone Applications](./web-standalone.html) · [Debugging Queries](./logging.html) · [Testing Applications](./web-testing.html)
