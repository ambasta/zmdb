> **Module graph inspector available.** `@zmdb/web/devtools` describes application
> declarations on demand, and `zmdb modules` renders the same graph as text, JSON
> or Graphviz DOT. There is deliberately no runtime inspector route or web UI.

## Describe a graph without booting it

```ts
import { describeGraph, renderTree } from '@zmdb/web/devtools';

import { AppModule } from './app.module.js';

const graph = describeGraph(AppModule);
console.log(renderTree(graph));
```

`describeGraph` takes the root module class, not an `App` or a `Container`. It
reads the metadata already written by `@Module`, `@Controller`, the route
decorators and `@Inject`; it does not construct a provider, call a lifecycle hook
or retain an inspector index on the running application.

The returned `GraphDescription` contains:

- modules, their imports and whether each declaration is lazy;
- value and factory providers, their owning module and factory scope;
- controllers, routes and `@Inject` dependency edges;
- findings for cycles, unresolved tokens, eager-to-lazy dependencies, duplicate
  providers, shadowed routes, duplicate token descriptions and anonymous
  classes.

Factory bodies remain opaque. A factory receives the whole container and may
resolve anything conditionally, so its `dependencies` field is `null`, not an
invented list. `dependentsOf(graph, providerId)` returns every known direct
consumer and adds `<factory dependencies unknown>` when opaque factories mean the
reverse query cannot be complete.

## Use the CLI

Name the root as `<path>#<export>`:

```bash
zmdb modules ./src/app.module.ts#AppModule
```

The default human form is a text tree. Application TypeScript is loaded through
the same Stage-3 decorator transform used by the test runner; Node 26 can strip
types, but it cannot parse standard decorator syntax by itself.

Machine-readable output is one JSON document:

```bash
zmdb modules ./src/app.module.ts#AppModule --json | jq '.result.findings'
```

The `result` value is the programmatic `GraphDescription`, unchanged. Exit 0
means there are no error-severity findings, exit 1 means the graph has an error
finding, and exit 2 means the invocation or module spec is invalid. Warnings such
as duplicate token descriptions do not fail the command.

For a diagram:

```bash
zmdb modules ./src/app.module.ts#AppModule --format dot > modules.dot
dot -Tsvg modules.dot > modules.svg
```

DOT is used because route paths and token descriptions routinely contain `/`,
`:`, spaces and `#`; every identifier and label is quoted.

## Filter realistic graphs

The default diagram includes modules and import edges only. Add declarations
with `--providers`, then keep the result useful with one of the graph filters:

```bash
zmdb modules ./src/app.module.ts#AppModule --providers --module UsersModule
zmdb modules ./src/app.module.ts#AppModule --providers --token USERS_REPOSITORY
zmdb modules ./src/app.module.ts#AppModule --providers --module UsersModule --depth 1
```

`--module` follows that module's transitive imports. `--token` follows known
dependency and reverse-dependency edges. `--depth` bounds either closure and
defaults to 2. An unfiltered provider view above 50 provider nodes is refused
with the count and module names to filter by instead of emitting a hairball.

## Read findings before startup

A cyclic graph is still described completely:

```text
ERROR cycle: Import cycle: module:AppModule -> module:BillingModule -> module:AppModule
```

`compileModule` continues to reject the same graph. The asymmetry is intentional:
the inspector must work on the broken declaration that prevents an application
from booting.

Shadowed routes are findings too. They compare the registered method and path
from controller metadata, so the diagnostic uses the graph the application
declared rather than a hand-maintained controller list.

## The production boundary

The inspector is available only from `@zmdb/web/devtools`; it is not re-exported
from `@zmdb/web`, `zmdb/web` or the application entry points. The `zmdb/cli`
subpath is separately classified as build-time-only.

`yarn verify:devtools-boundary` walks every production `@zmdb/web` and `zmdb`
export transitively. It fails if one reaches the devtools directory or
`node:repl`, and CI runs the gate. That structural rule is why the project does
not offer a `/__graph` endpoint: a route exposing every route pattern, token and
module would be an application oracle.

## Other useful debugging surfaces

The query compiler still gives the most direct database diagnostic without a
connection:

```ts
const { text, parameters } = compiler.selectFrom('posts').select(['id']).where('id', '=', 1).compile();
console.log(text, parameters);
```

For ordinary code debugging, run built output under the Node inspector:

```bash
node --inspect-brk dist/main.js
```

The package build emits source maps alongside JavaScript and declarations, so an
editor or `chrome://inspect` can map framework frames back to TypeScript.

---

See also: [Modules](./web-modules.html) · [Lazy Modules](./web-lazy-modules.html) ·
[Debugging Queries](./logging.html) · [Testing Applications](./web-testing.html)
