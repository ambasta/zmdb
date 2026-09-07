# @zmdb/cli

The `zmdb` executable owns schema, migration, scaffolding, application inspection, REPL, Studio and HTTP client commands. Install `@zmdb/cli` with TypeScript, or install `zmdb` for the complete
product facade.

```sh
npm install @zmdb/cli typescript
npx zmdb --help
npx zmdb codegen --project tsconfig.json
```

`@zmdb/cli` exposes `runCli`, migration generation, embedding, schema export, declaration pulling and HTTP artifact helpers. `zmdb/cli` exports the same function identities. Application inspection and
REPL require `@zmdb/app`, `@zmdb/web` and `esbuild`; Studio and HTTP generation use `@zmdb/web`. Drivers are declared by the application's config and installed by the application.
