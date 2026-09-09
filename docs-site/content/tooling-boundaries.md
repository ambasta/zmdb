The tooling has three public owners and one executable. Select the library you need, or use `zmdb` from `@zmdb/cli` to run the same compiler and migration operations with project configuration, files,
output and process cleanup handled for you.

## Choose an entry point

| Task                                                   | Public owner                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Run developer commands                                 | `@zmdb/cli` supplies the `zmdb` executable and `runCli`         |
| Compile a project without a bundler                    | `compileProject` and `writeCompileResult` from `@zmdb/compiler` |
| Create a plugin with config discovery                  | async `zmdbAot` from `@zmdb/compiler`                           |
| Supply project and naming options directly to a plugin | synchronous `zmdbAot` from `@zmdb/compiler/unplugin`            |
| Configure Metro or Oxlint                              | `@zmdb/compiler/metro` or `@zmdb/compiler/lint`                 |
| Author and load project config                         | `@zmdb/compiler/config/contract` and `@zmdb/compiler/config`    |
| Compare schemas and plan migrations                    | `@zmdb/migrations`                                              |
| Apply a migration ledger through a connection          | `@zmdb/migrations/runner`                                       |
| Apply bundle-resident SQLite migrations                | `@zmdb/migrations/embedded`                                     |

The product facade offers curated APIs through `@zmdb/core/compiler`, `@zmdb/core/config`, `@zmdb/core/migrations` and `@zmdb/core/cli`. The direct packages are also independently installable. Only
`@zmdb/cli` declares a binary; installing `@zmdb/core@1.0.0-beta.2` includes that same executable.

## Install the selected tooling

For the command workflow:

```bash
yarn add --dev @zmdb/cli@1.0.0-beta.2 typescript@^7.0.2
yarn zmdb --help
yarn zmdb codegen --project tsconfig.json
yarn zmdb codegen --project tsconfig.json --check
```

For a compiler integration that owns its build process:

```bash
yarn add --dev @zmdb/compiler@1.0.0-beta.2 typescript@^7.0.2
```

For a migration library using SQLite:

```bash
yarn add @zmdb/migrations@1.0.0-beta.2 @zmdb/sqlite@1.0.0-beta.2
```

The packages require Node.js 26 or later. TypeScript is a required peer of the compiler and CLI. Metro, Metro's Babel transformer and Oxlint are selected compiler peers; `@zmdb/app`, `@zmdb/web` and
esbuild are selected CLI peers. Their exact supported ranges are declared by the installed package and listed in the [package reference](./package-reference.html).

Select both Metro packages for a Metro build. Its CommonJS configuration can load `withZmdb` using `require('@zmdb/compiler/metro')` on Node.js 26; the published module remains ESM. The compiler root
does not eagerly load these optional integrations. See [AOT Setup](./aot-setup.html) for plugin and Metro configuration.

## The dependency graph

These are the required workspace edges declared by the tooling manifests. Optional application and integration peers are selected by the entries described above.

| Package            | Required workspace dependencies and peers                                      |
| ------------------ | ------------------------------------------------------------------------------ |
| `@zmdb/cli`        | `@zmdb/compiler`, `@zmdb/migrations`, `@zmdb/schema`, `@zmdb/sql`, `@zmdb/orm` |
| `@zmdb/compiler`   | `@zmdb/ai`, `@zmdb/schema`, `@zmdb/sql`, `@zmdb/validator`                     |
| `@zmdb/migrations` | `@zmdb/schema`, `@zmdb/sql`                                                    |

The migrations library consumes schema data and dialect operations. It does not depend on the CLI, compiler or TypeScript. The compiler owns reflection and emission; the CLI selects command
implementations lazily. Application inspection and REPL load their application, HTTP-devtools and esbuild peers when those commands are selected.

The generated [architecture view](./architecture.html) derives the full graph and release units from the package catalog, architecture policy and manifests. The table here explains the tooling portion
of that graph.

## Configuration and generated runtime code

`defineConfig` and the structural authoring types live in `@zmdb/compiler/config/contract`. `loadConfig` in `@zmdb/compiler/config` discovers and executes one config, validates it and resolves its
paths. `@zmdb/core/config` exposes the product-facing entry. Loading config does not start an application or open its database driver.

The CLI and configured root plugin pass the resolved project and naming strategy into the compiler. A direct `compileProject` or synchronous unplugin caller supplies those options itself. See
[Config File](./config-file.html) for discovery boundaries and [Code Generation](./cli-codegen.html) for writing and checking project artifacts.

Generated application code never imports `@zmdb/compiler` or `@zmdb/cli`. When a generated check needs a runtime helper, it imports the public runtime owner, such as `@zmdb/validator/errors`; protobuf
artifacts use `@zmdb/protobuf/wire`. Install the runtime owners used by the application as runtime dependencies. Build-time reflection is not part of their execution path.

Embedded migrations are a separate runtime use case. `zmdb embed` produces migration data during the build; the application imports `runEmbedded` from `@zmdb/migrations/embedded` and supplies a SQLite
connection implementing `exec`, `run` and `rows`. That entry does not import a filesystem API, a database driver or the compiler. See [Web and Mobile Migrations](./migrations-web-mobile.html).

## Verification

Package-local integration tests cover the tooling behavior described above. `yarn verify:publish` checks the installable package archives, their public exports and emitted declarations;
`packages/cli/src/packed-cli.spec.ts` covers the installed CLI executable. Publication rules are described in [PUBLISHING.md](https://github.com/ambasta/zmdb/blob/main/PUBLISHING.md).

---

See also: [CLI Overview](./cli-overview.html) · [Migrations](./migrations.html) · [Installation](./installation.html)
