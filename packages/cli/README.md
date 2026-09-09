# @zmdb/cli

`@zmdb/cli` owns the single `zmdb` executable for schema, migration, code generation, scaffolding, application inspection, REPL, Studio and HTTP client commands. Install it with TypeScript for
standalone tooling, or install `@zmdb/core@1.0.0-beta.1` for the complete product facade and the same executable.

```sh
yarn add --dev @zmdb/cli@1.0.0-beta.1 typescript@^7.0.2
yarn zmdb --help
yarn zmdb codegen --project tsconfig.json
```

Requires Node.js 26 or later. The CLI delegates reflection and AOT emission to `@zmdb/compiler`, and schema plans, files and ledger execution to `@zmdb/migrations`. Those packages remain usable
independently. Project configuration is loaded by `@zmdb/compiler/config`; `zmdb.config.ts` can use the `defineConfig` helper from `@zmdb/compiler/config/contract` or `@zmdb/core/config`.

`@zmdb/cli` exposes `runCli`, migration generation, embedding, schema export, declaration pulling and HTTP artifact helpers. `@zmdb/core/cli` exports the same function identities. Command
implementations load when selected, so application imports do not need to load reflection, esbuild or a REPL.

Application inspection and REPL require the optional peers `@zmdb/app`, `@zmdb/web` and `esbuild`; Studio and HTTP generation use `@zmdb/web`. Install the selected optional peers with versions
matching this package's peer ranges. Database commands obtain their driver from the application's config; install the database package that owns that driver.
