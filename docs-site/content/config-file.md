`zmdb.config.ts` is the build-tool and database-command configuration file. The
loader is published from `zmdb/config`; it discovers one file, executes it with
Node, validates its data fields, and returns absolute paths.

It does not initialise an application. Repositories still receive an explicit
driver, and importing `zmdb` does not read the filesystem.

## A minimal config

```ts
// zmdb.config.ts
import { defineConfig } from 'zmdb/config';

export default defineConfig({
  schema: ['src/**/*.schema.ts'],
  dialect: 'postgres',
});
```

`defineConfig` is an identity function for type inference and completion.
Validation happens in `loadConfig`, including for a module that exports a plain
object without calling `defineConfig`.

```ts
import { loadConfig } from 'zmdb/config';

const config = await loadConfig();

config.configPath; // absolute selected config file
config.project; // absolute tsconfig path
config.schemaFiles; // absolute files, expanded eagerly
config.outDir; // absolute migration output directory
```

The shipped `generate`, `embed`, `migrate`, `rollback`, `status`, `push`, `check`,
`upgrade`, `export`, and `pull` commands consume this loader. `up` is deliberately
refused because it is ambiguous between migration application and snapshot upgrade.

## The resolved path is observable

Commands print the absolute selected config before human-readable database
work. This transcript came from the SQLite fixture; only its temporary
directory was shortened to `/workspace/shop`:

```text
$ npx zmdb check
/workspace/shop/zmdb.config.ts
check passed
```

Under `--json`, the same path is the top-level `config` value. An explicit
`--config` path and a discovered path therefore have the same observable
result after resolution.

## Fields

| Field               | Type                                  | Default            | Resolution                            |
| ------------------- | ------------------------------------- | ------------------ | ------------------------------------- |
| `schema`            | `string \| readonly string[]`         | required           | globs relative to the config file     |
| `dialect`           | `Dialect`                             | required           | six current SQL dialects              |
| `project`           | `string`                              | `./tsconfig.json`  | relative to the config file           |
| `out`               | `string`                              | `./migrations`     | relative to the config file           |
| `naming`            | `'snake_case' \| 'snake_case_plural'` | absent             | —                                     |
| `namingStrategy`    | `NamingStrategy`                      | absent             | callable boundary, checked separately |
| `driver`            | `() => Driver \| Promise<Driver>`     | absent             | callable boundary, checked separately |
| `migrations.table`  | `string`                              | `_zmdb_migrations` | —                                     |
| `migrations.schema` | `string`                              | dialect default    | PostgreSQL family only                |
| `introspect`        | `{ schemas?, include?, exclude? }`    | command-specific   | names/globs, not filesystem paths     |

> **Naming status.** `loadConfig` validates and returns `naming` and
> `namingStrategy`, but the CLI schema-reflection calls do not pass either field
> to the reflector yet. Commands therefore continue to produce identity names.
> A config that loads successfully is not evidence that DDL, snapshots or
> repository SQL have adopted the configured strategy.

Every glob must match at least one file, and every matched file must belong to
the configured TypeScript project. A match outside the project is an error
rather than a silently omitted table.

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

`migrations.schema` is available to the Postgres family and is refused for the
MySQL family, SQLite and SQL Server. It is never ignored.

## Discovery

An explicit path wins:

```ts
await loadConfig({ cwd: '/workspace/orders', path: './config/database.ts' });
```

Without `path`, discovery checks this order in the starting directory and then
walks upward:

1. `zmdb.config.ts`
2. `zmdb.config.mjs`
3. `zmdb.config.js`

The walk stops at the first directory containing `package.json`. A command run
inside one monorepo package therefore cannot silently select a config above that
package boundary. There is no cascade or merge: the first selected file is the
whole configuration.

`path` resolves against `cwd`. Paths written inside the selected module resolve
against that module's directory, so running the same command from a nested
directory does not change its schema, project, or migration output.

## Loading TypeScript

The loader uses Node 26's native type stripping:

```ts
await import(pathToFileURL(configPath));
```

That keeps a second bundler out of config loading, with three deliberate limits:

- tsconfig `paths` aliases are not resolved by Node;
- `./module.js` is not remapped to a source file named `module.ts`;
- non-erasable TypeScript syntax such as `enum`, `namespace`, and parameter
  properties is not transformed.

If a project needs custom resolution, use a Node loader hook through
`NODE_OPTIONS=--import ...`. A failed import reports the absolute config path,
the original error and its cause; missing-module errors also explain the
`.js`-specifier case.

## Validation

Plain data is checked by a generated `@zmdb/aot-validator` validator. Errors
name the field, including nested paths such as `introspect.include`.

Functions cannot be validated as data. The loader therefore separates the two
callable fields and checks their boundary explicitly:

- `driver` must be a function;
- each present `namingStrategy.column`, `.table`, and `.index` member must be a
  function.

The following example demonstrates that callable-boundary validation. The
strategy is preserved in the loaded config, but is not yet applied by CLI
reflection:

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

The driver is a thunk so the CLI can avoid opening a database for commands that
only inspect declarations. `check` opens it only for the live-drift check; with
no driver configured, that check is reported as skipped.

## Process-local cache

`loadConfig` caches by absolute config path for the lifetime of the process.
Repeated callers share one module evaluation and one resolved result. Two
packages with two config paths receive separate entries; there is no
cross-package ambient config.

## Application configuration remains explicit

The application does not automatically read this file. Construct the driver
you want and pass it to repositories or the DI container. The config thunk can
delegate to that same application module, keeping one source of connection
truth without introducing an implicit initialisation step.

---

See also: [CLI Overview](./cli-overview.html) · [Configuration](./configuration.html) · [Writing a Driver](./custom-driver.html)
