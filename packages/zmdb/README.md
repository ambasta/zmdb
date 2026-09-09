# zmdb

The `@zmdb/core` package presents schema declaration, AOT validation, typed ORM access, SQL, migrations, and the HTTP application framework as one cohesive product.

The default `@zmdb/core` import is intentionally small and lazy: it covers the normal application journey without loading compiler tooling, migration machinery, jobs, or optional integrations. Focused
concern subpaths expose the larger APIs without requiring package-first imports.

## Install

```bash
yarn add @zmdb/core@1.0.0-beta.2
```

> **Prerelease** (`1.0.0-beta.2`). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Build a SQLite HTTP application

Start with the [product quick start](https://ambasta.github.io/zmdb/docs/quick-start.html) and the [complete server journey](https://ambasta.github.io/zmdb/docs/web-overview.html). SQLite is included
in the default install. Declare a schema type, derive its validator and repository access, generate its migration, then serve the controller through one application.

The [complete product example](https://github.com/ambasta/zmdb/tree/main/fixtures/consumer-product) contains the schema, HTTP program, TypeScript configuration, `zmdb.config.ts`, and `build.mjs`. Its
application imports only `@zmdb/core` and public `@zmdb/core/*` concerns. Use those files in an ESM project with TypeScript 7, Node.js 26 types and esbuild as development tools. From that project
directory:

```bash
export ZMDB_PRODUCT_DATABASE="$PWD/product.sqlite"
yarn zmdb codegen
yarn zmdb generate --name create_orders
yarn zmdb migrate
yarn zmdb check
node build.mjs src/main.ts dist/main.mjs
node dist/main.mjs
```

The CLI and the public `@zmdb/core/compiler` AOT build read the same `zmdb.config.ts`. The database filename must be the same for migration and application execution. The example sends real loopback
HTTP requests: invalid input returns 400 before a write, valid input is persisted, and the program closes its listener and database before exiting. Its installed consumer check already exercises these
commands against real package archives; this example is a complete demonstration rather than a permanently running development server.

Use the [same-app worker example](https://ambasta.github.io/zmdb/docs/web-overview.html#add-a-selected-worker-to-the-same-application) when the application needs background jobs. Jobs and their
provider are an explicit selection; they are not required for the default SQLite HTTP application.

## Advanced package boundaries

Use `@zmdb/core` for the common application vocabulary and a `@zmdb/core/*` subpath for a focused concern. The direct `@zmdb/*` packages are implementation owners with explicit dependency boundaries
for advanced consumers; they are not additional assembly steps for the default application. Each facade delegates by identity to its canonical owner.

The [generated package reference](https://ambasta.github.io/zmdb/docs/package-reference.html) contains the package-role, dependency and installation tables from the official catalog and manifests. The
[architecture reference](https://ambasta.github.io/zmdb/docs/architecture.html) explains the owner graph.

### Product entry points

- Application defaults: `@zmdb/core`
- Product concerns: `@zmdb/core/schema`, `@zmdb/core/sql`, `@zmdb/core/validator`, `@zmdb/core/orm`, `@zmdb/core/web`
- Build and operational concerns: `@zmdb/core/compiler`, `@zmdb/core/migrations`, `@zmdb/core/testing`, `@zmdb/core/config`, `@zmdb/core/cli`
- Database verticals: `@zmdb/core/sqlite`, `@zmdb/core/postgres`, `@zmdb/core/mysql`, `@zmdb/core/mssql`, `@zmdb/core/cockroach`, `@zmdb/core/singlestore`
- Application kernel: `@zmdb/core/app` and `@zmdb/core/app/{commands,cqrs,data,di,events,health,lifecycle,messaging,modules,observability,state}`
- HTTP: `@zmdb/core/web`, `@zmdb/core/web/contract`, `@zmdb/core/web/contract/compiler`, and the focused `@zmdb/core/web/*` HTTP concern entries
- Advanced runtime and contract subpaths: `@zmdb/core/tags`, `@zmdb/core/ir`, `@zmdb/core/derive`, `@zmdb/core/dto`, `@zmdb/core/relations`, `@zmdb/core/web/contract`,
  `@zmdb/core/web/contract/compiler`

`@zmdb/core/web` composes the application kernel and HTTP package by identity for the common server import. The direct `@zmdb/web` package remains HTTP-only.

Background jobs are a first-party selected capability:

```bash
yarn add @zmdb/jobs@1.0.0-beta.2
```

Import queues, workers, schedules, and `jobsExtension` from `@zmdb/jobs`. The default product neither installs jobs nor exposes a `@zmdb/core/jobs` facade; the selected package still composes through
the same `@zmdb/app` lifecycle.

Every facade entry delegates to its owning implementation package by identity and contains no mutable state or implementation logic. AI providers, frontend bindings, observability, transports, and
database verticals other than SQLite are separate opt-in packages. SQLite remains lazy behind its concern subpath.

`@zmdb/core/sqlite` is an identity facade over the SQLite implementation included in the default install. Other database subpaths resolve through their explicitly installed `@zmdb/*` peers. For
PostgreSQL, install `@zmdb/postgres` and `pg`; neither is pulled into the default product dependency closure.

## Generate HTTP artifacts

Configure exported HTTP contracts and both output files in `zmdb.config.ts`, then run:

```bash
yarn zmdb client generate
yarn zmdb client generate --check
```

One contract load feeds the OpenAPI document and generated typed client as sibling outputs. `--check` writes nothing and fails when either committed output is stale; `--watch` regenerates when a
compiled contract input changes. Client generation never parses the OpenAPI file.

## Documentation

Start with the [server journey](https://ambasta.github.io/zmdb/docs/web-overview.html): generated SQLite migration, validated HTTP, then an explicitly selected background worker under the same app
lifecycle.

Generated-client journey: **https://ambasta.github.io/zmdb/docs/generated-client.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

Mozilla Public License 2.0 (MPL-2.0) — see [LICENSE](./LICENSE).

Continue through the [quick start](../../docs-site/content/quick-start.md), [blog API tutorial](../../docs-site/content/tutorial-blog-api.md) and
[generated client](../../docs-site/content/generated-client.md). Select database and framework packages from the [generated package reference](../../docs-site/content/package-reference.md).
