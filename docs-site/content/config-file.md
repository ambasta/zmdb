`zmdb.config.ts` is the build-tool and database-command configuration file. The loader is published from `zmdb/config`; it discovers one file, executes it with Node, validates its data fields, and
returns absolute paths.

It does not initialise an application. Repositories still receive an explicit driver, and importing `zmdb` does not read the filesystem.

## A minimal config

```ts
// zmdb.config.ts
import { defineConfig } from 'zmdb/config';

export default defineConfig({
  schema: ['src/**/*.schema.ts'],
  dialect: 'postgres',
});
```

`defineConfig` is an identity function for type inference and completion. Validation happens in `loadConfig`, including for a module that exports a plain object without calling `defineConfig`. The
identity and author-facing types live in a dependency-light contract module; discovery, execution, validation, defaults, path resolution and caching live only in the loader behind this same public
entry.

```ts
import { loadConfig } from 'zmdb/config';

const config = await loadConfig();

config.configPath; // absolute selected config file
config.project; // absolute tsconfig path
config.schemaFiles; // absolute files, expanded eagerly
config.outDir; // absolute migration output directory
```

The shipped `generate`, `embed`, `migrate`, `rollback`, `status`, `push`, `check`, `upgrade`, `export`, `pull`, `client generate`, and `studio` commands consume this loader. `zmdb-codegen` and
`zmdb/unplugin` use the same resolved project and naming strategy. `zmdb new project` emits this public import and a build adapter that delegates discovery to `zmdb/unplugin`; the generated runtime
entry never imports the loader. `up` is deliberately refused because it is ambiguous between migration application and snapshot upgrade.

## The resolved path is observable

Commands print the absolute selected config before human-readable database work. This transcript came from the SQLite fixture; only its temporary directory was shortened to `/workspace/shop`:

```text
$ npx zmdb check
/workspace/shop/zmdb.config.ts
check passed
```

Under `--json`, the same path is the top-level `config` value. An explicit `--config` path and a discovered path therefore have the same observable result after resolution.

## Fields

| Field               | Type                                  | Default            | Resolution                            |
| ------------------- | ------------------------------------- | ------------------ | ------------------------------------- |
| `schema`            | `string \| readonly string[]`         | required           | globs relative to the config file     |
| `dialect`           | `Dialect`                             | required           | six current SQL dialects              |
| `project`           | `string`                              | `./tsconfig.json`  | relative to the config file           |
| `out`               | `string`                              | `./migrations`     | relative to the config file           |
| `naming`            | `'snake_case' \| 'snake_case_plural'` | absent             | resolved once for reflection          |
| `namingStrategy`    | `NamingStrategy`                      | absent             | custom strategy; wins over `naming`   |
| `driver`            | `() => Driver \| Promise<Driver>`     | absent             | callable boundary, checked separately |
| `migrations.table`  | `string`                              | `_zmdb_migrations` | —                                     |
| `migrations.schema` | `string`                              | dialect default    | PostgreSQL family only                |
| `introspect`        | `{ schemas?, include?, exclude? }`    | command-specific   | names/globs, not filesystem paths     |
| `http.contracts`    | `string \| readonly string[]`         | absent             | `<path>#<export>` from the project    |
| `http.openApi.out`  | `string`                              | required with HTTP | generated `.json`, relative to config |
| `http.client.out`   | `string`                              | required with HTTP | generated `.ts`, relative to config   |

`loadConfig` also returns `resolvedNaming`: the selected built-in singleton, the custom `namingStrategy` by identity, or an empty identity strategy. Every database command passes that object into
schema reflection. `zmdb-codegen` and `zmdb/unplugin` discover the same config and pass the same value to the lower-level AOT APIs; the committed consumer fixtures exercise both routes against
byte-identical config files.

Every glob must match at least one file, and every matched file must belong to the configured TypeScript project. A match outside the project is an error rather than a silently omitted table.

```ts
export default defineConfig({
  schema: ['src/accounts.schema.ts', 'src/billing/**/*.schema.ts'],
  dialect: 'postgres',
  project: './tsconfig.build.json',
  out: './database/migrations',
  migrations: {
    table: '_app_migrations',
    schema: 'app',
  },
  introspect: {
    schemas: ['public', 'app'],
    exclude: ['audit_*'],
  },
});
```

`migrations.schema` is available to the Postgres family and is refused for the MySQL family, SQLite and SQL Server. It is never ignored.

## HTTP artifact generation

HTTP generation is explicit and inert:

```ts
export default defineConfig({
  schema: './src/schema.ts',
  dialect: 'postgres',
  project: './tsconfig.json',
  http: {
    contracts: ['./src/accounts.contract.ts#ACCOUNTS_HTTP_CONTRACT', './src/billing.contract.ts#BILLING_HTTP_CONTRACT'],
    openApi: { out: './generated/openapi.json' },
    client: { out: './generated/http-client.generated.ts' },
  },
});
```

Every contract spec requires an export name. Contract files must belong to `project`; duplicate path/export pairs are rejected. The OpenAPI and client outputs must have `.json` and `.ts` extensions,
respectively, and must resolve to different files. Loading this config does not boot the application, and the config has no base URL, credential, authentication, timeout, retry, or deployment field.

`loadConfig` resolves the contract files and both outputs to absolute paths. `zmdb client generate` then loads the configured exports once and emits OpenAPI and the client as sibling artifacts; it
does not read OpenAPI back as generation input. Use `--check` in CI and `--watch` for dependency-aware regeneration. The complete flow is in [Generated HTTP Client](./generated-client.html).

## Discovery

An explicit path wins:

```ts
await loadConfig({ cwd: '/workspace/orders', path: './config/database.ts' });
```

Without `path`, discovery checks this order in the starting directory and then walks upward:

1. `zmdb.config.ts`
2. `zmdb.config.mjs`
3. `zmdb.config.js`

The walk stops at the first directory containing `package.json`. A command run inside one monorepo package therefore cannot silently select a config above that package boundary. There is no cascade or
merge: the first selected file is the whole configuration.

`path` resolves against `cwd`. Paths written inside the selected module resolve against that module's directory, so running the same command from a nested directory does not change its schema,
project, or migration output.

## Loading TypeScript

The loader uses Node 26's native type stripping:

```ts
await import(pathToFileURL(configPath));
```

That keeps a second bundler out of config loading, with three deliberate limits:

- tsconfig `paths` aliases are not resolved by Node;
- `./module.js` is not remapped to a source file named `module.ts`;
- non-erasable TypeScript syntax such as `enum`, `namespace`, and parameter properties is not transformed.

If a project needs custom resolution, use a Node loader hook through `NODE_OPTIONS=--import ...`. A failed import reports the absolute config path, the original error and its cause; missing-module
errors also explain the `.js`-specifier case.

## Validation

Plain data is checked by a generated `@zmdb/aot-validator` validator. Errors name the field, including nested paths such as `introspect.include`.

Functions cannot be validated as data. The loader therefore separates the two callable fields and checks their boundary explicitly:

- `driver` must be a function;
- each present `namingStrategy.column`, `.table`, and `.index` member must be a function.

The following example demonstrates callable-boundary validation and the custom strategy path:

```ts
export default defineConfig({
  schema: 'src/**/*.schema.ts',
  dialect: 'postgres',
  driver: () => import('./src/database.ts').then(module => module.driver),
  namingStrategy: {
    table: declared => declared.toLowerCase(),
    column: (property, { table }) => `${table}_${property}`.toLowerCase(),
  },
});
```

When both `naming` and `namingStrategy` are present, the custom object wins. That choice is made while loading the config, not once per table or query.

The driver is a thunk so the CLI can avoid opening a database for commands that only inspect declarations. `check` opens it only for the live-drift check; with no driver configured, that check is
reported as skipped.

## Process-local cache

`loadConfig` caches by absolute config path for the lifetime of the process. Repeated callers share one module evaluation and one resolved result. Two packages with two config paths receive separate
entries; there is no cross-package ambient config.

## Application configuration remains explicit

The application does not automatically read this file. Construct the driver you want and pass it to repositories or the DI container. The config thunk can delegate to that same application module,
keeping one source of connection truth without introducing an implicit initialisation step.

Repository verification rejects another exported `defineConfig`, `loadConfig`, `ResolvedConfig`, or related project-config declaration outside the canonical owner and its approved facade. It also
rejects runtime imports from the dependency-light authoring module.

---

See also: [Generated HTTP Client](./generated-client.html) · [CLI Overview](./cli-overview.html) · [Configuration](./configuration.html) · [Writing a Driver](./custom-driver.html)
