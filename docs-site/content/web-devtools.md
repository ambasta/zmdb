> **ToDo / feature gap.** There is no devtools — no graph visualiser, no
> `@nestjs/devtools-integration` equivalent, no runtime inspector UI.

## What you can inspect today

More than you might expect, because the module system is deliberately small and everything it produces is a plain object.

**The compiled container and controllers:**

```ts
const compiled = compileModule(AppModule);
console.log(compiled.controllers.map(c => c.constructor.name));
```

`CompiledModule` is `{ container, controllers }`. One flat container, no hierarchy to explore — which is why a graph visualiser has less to show here than in a framework with nested injectors.

**Every route, from metadata:**

```ts
import { getRoutes } from '@zmdb/web/routing';

for (const C of CONTROLLERS) {
  for (const r of getRoutes(C)) console.log(`${r.method.padEnd(6)} ${r.path.padEnd(30)} ${C.name}.${r.handlerName}`);
}
```

That printout is the single most useful diagnostic in the framework. It shows registration order, which is what determines [first-match routing](./web-performance.html) — so a route being shadowed is visible right there.

**Whether a token resolves:**

```ts
console.log(compiled.container.has(POSTS));
```

`has(token)` without resolving. Useful in a startup assertion.

## A startup diagnostic worth having

```ts
export function describeApp(controllers: readonly ControllerClass[]): string {
  const rows = controllers.flatMap(C =>
    getRoutes(C).map(r => ({ method: r.method, path: r.path, handler: `${C.name}.${r.handlerName}` })),
  );
  const duplicates = rows.filter((a, i) => rows.findIndex(b => b.method === a.method && b.path === a.path) !== i);
  return JSON.stringify({ routes: rows.length, duplicates }, undefined, 2);
}
```

Turn the duplicate check into a test rather than a log line — a shadowed route is a bug that a printout only reveals if someone reads it:

```ts
it('no two routes share a method and path', () => {
  expect(duplicatesOf(CONTROLLERS)).toEqual([]);
});
```

## Debugging the module graph

Cycles throw with a clear message:

```
@zmdb/web: import cycle detected in the module graph
```

The message does not name the modules involved, which is the main rough edge. Bisect by commenting out `imports` entries, or wrap `compileModule` in your own traversal that logs each module as it is entered.

Unresolved tokens throw `UnresolvedTokenError` naming the token's description — which is why `createToken<T>('POSTS_REPOSITORY')` with a meaningful description pays for itself the first time something is missing. A token described as `'token'` produces a useless error.

## Debugging queries

The most useful "devtool" in the project, and it exists: `compile()` returns the SQL and parameters without executing anything.

```ts
const { text, parameters } = compiler.selectFrom('posts').select(['id']).where('id', '=', 1).compile();
console.log(text, parameters);
```

No connection needed, so it works in a unit test. See [Debugging Queries](./logging.html) and the [logging driver wrapper](./logging.html).

## The Node inspector

```bash
node --inspect-brk dist/main.js
```

Then `chrome://inspect` or your editor's debugger. Breakpoints work in handlers, and because the framework does no reflection per request the stack from the adapter to your handler is short and readable — three or four frames, not thirty.

Source maps come from `tsup` if you enable them:

```ts
export default defineConfig({ sourcemap: true });
```

Without them a stack trace points into bundled output and the debugging experience gets much worse. Enable them everywhere, including production — they cost nothing at runtime and make an incident report legible.

## What it would take

A devtools UI needs data the framework does not currently expose: provider dependency edges (there are none to record — [`@Inject` is a field decorator](./web-injection-scopes.html) read at `build` time, and nothing keeps the graph), a per-request timeline (no observation hook), and a way to serve a UI (blocked on the [string response body](./web-static-files.html)).

The honest assessment: a graph visualiser is most valuable in a framework whose graph is hard to understand. Here the graph is one flat container and a list of routes, both printable in five lines. The route table and the duplicate test above cover the real need.

---

See also: [Debugging Queries](./logging.html) · [Discovery](./web-discovery.html) · [Testing Applications](./web-testing.html)
