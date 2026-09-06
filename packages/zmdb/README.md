# zmdb

The `zmdb` package presents schema declaration, AOT validation, typed ORM access, SQL, migrations, and the HTTP application framework as one cohesive product.

The default `zmdb` import is intentionally small and lazy: it covers the normal application journey without loading compiler tooling, migration machinery, jobs, or optional integrations. Focused
concern subpaths expose the larger APIs without requiring package-first imports.

## Install

```bash
npm add zmdb@alpha
```

> **Prerelease** (`1.0.0-alpha.4`, published under the `alpha` dist-tag). Requires **Node.js 26+** and is **ESM-only**. Ships built ESM `.js` + `.d.ts` under `./dist`.

## Entry points

- Application defaults: `zmdb`
- Product concerns: `zmdb/schema`, `zmdb/sql`, `zmdb/validator`, `zmdb/orm`, `zmdb/web`
- Build and operational concerns: `zmdb/compiler`, `zmdb/migrations`, `zmdb/testing`, `zmdb/config`, `zmdb/cli`
- Database drivers: `zmdb/drivers/sqlite`, `zmdb/drivers/pg`, `zmdb/drivers/mssql`
- Application kernel: `zmdb/app` and `zmdb/app/{commands,cqrs,data,di,events,health,lifecycle,messaging,modules,observability,state}`
- HTTP: `zmdb/web`, `zmdb/web/contract`, `zmdb/web/contract/compiler`, and the focused `zmdb/web/*` HTTP concern entries
- Compatibility subpaths: `zmdb/tags`, `zmdb/ir`, `zmdb/derive`, `zmdb/dto`, `zmdb/relations`, `zmdb/unplugin`, `zmdb/web/contract`, `zmdb/web/contract/compiler`

`zmdb/web` composes the application kernel and HTTP package by identity for the common server import. The direct `@zmdb/web` package remains HTTP-only.

Background jobs are a first-party selected capability:

```bash
npm add @zmdb/jobs@alpha
```

Import queues, workers, schedules, and `jobsExtension` from `@zmdb/jobs`. The default product neither installs jobs nor exposes a `zmdb/jobs` facade; the selected package still composes through the
same `@zmdb/app` lifecycle.

Every facade entry delegates to its owning implementation package by identity and contains no mutable state or implementation logic. AI providers, frontend bindings, observability, and transports are
separate opt-in packages and are not reachable from the default root.

`zmdb/drivers/pg` is a compatibility facade over the optional `@zmdb/postgres` peer. Install `@zmdb/postgres` and `pg` in applications that select PostgreSQL; neither is pulled into the default
product dependency closure.

## Generate HTTP artifacts

Configure exported HTTP contracts and both output files in `zmdb.config.ts`, then run:

```bash
npx zmdb client generate
npx zmdb client generate --check
```

One contract load feeds the OpenAPI document and generated typed client as sibling outputs. `--check` writes nothing and fails when either committed output is stale; `--watch` regenerates when a
compiled contract input changes. Client generation never parses the OpenAPI file.

## Documentation

Generated-client journey: **https://ambasta.github.io/zmdb/docs/generated-client.html**

Full docs: **https://ambasta.github.io/zmdb/**

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later) — see [LICENSE](./LICENSE).
