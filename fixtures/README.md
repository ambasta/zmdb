# Consumer fixtures

Consumer projects exercise compiler integrations, framework adapters and installed packages.

`consumer-cli/` and `consumer-plugin/` contain the **same program**, declared the same way, and reach the compiled validator by the two supported routes:

|                   | `consumer-cli/`                                        | `consumer-plugin/`                      |
| ----------------- | ------------------------------------------------------ | --------------------------------------- |
| build step        | config-aware project compilation                       | a bundler with config-aware `zmdbAot()` |
| what is committed | the generated `.js`/`.d.ts`/witness, beside the source | nothing generated                       |
| what runs it      | `node src/probe.ts`, no tooling at all                 | the bundle esbuild wrote                |

Both routes discover their byte-identical `zmdb.config.ts`, resolve `snake_case_plural` once and hand that same strategy shape to reflection. The fixture declares `Table<'order'>` with a `shipTo`
property and observes the physical `orders.ship_to` schema from both routes.

The split is the point. A bundler plugin can rewrite a module on its way into a bundle, and that is the fastest route when there is a bundler; a library, a `tsc` build or a `node --strip-types` script
has nowhere to put that step, and REQ-AV-3 says the compiled path may not be a reward for choosing a particular toolchain. So one fixture proves the plugin route and the other proves there is a route
without one.

`consumer-metro/` builds an app through the Metro transformer, checks the generated schema and validator, and preserves a configured Babel transformer. Its bundle test runs in the integration suite.

`llm-adapters/` is compile-only and independent of that pair. It pins the real `@langchain/core` and `ai` packages, then checks the frozen plain-object adapter shapes against their constructors. The
framework dependencies belong to that private consumer fixture. LangChain is an optional peer only of `@zmdb/ai-langchain`; neither framework reaches the provider-neutral `@zmdb/ai` manifest.

`consumer-compiler/` and `consumer-migrations/` freeze the standalone package contracts selected by #626. Their manifests use versioned dependencies, their configs have no `paths` map or
`skipLibCheck`, and #627 typechecks them against tarballs under the target package names. The compiler fixture compiles one real `is<T>()` call from the packed package, materialises its four changed
paths, reruns check mode to zero stale paths, and executes good/bad values; migrations remains an expected failure until its extraction issue lands.

`database-mysql/` packs the complete MySQL vertical and its transitive workspace closure, installs those tarballs with the real `mysql2` peer in a temporary project, typechecks only the published
declarations, then runs migrations, transactions, binding, bigint, strict `utf8mb4`, generated-column, index, foreign-key, and catalog-introspection acceptance against the configured MySQL server.

`app-custom-transport.ts` exercises a custom messaging strategy through the public app interfaces.

`client-adapters/` contains the shared fixtures used by package-local framework tests for rendering, cancellation, retries and request isolation.

`next-app-router/` is copied into an external tarball consumer by `packages/next/src/packed-consumer.spec.ts`. It uses a real Next 16.3 App Router build, server component, route handler and client
component; runs two authenticated production requests; proves memoization is request-local; and scans emitted browser chunks for the absence of the server credential and server package graph. #700
still owns cross-adapter installed-framework and bundle checks beyond the package-local slices.

## Working on them

`consumer-plugin/` is the one to edit. `consumer-cli/` is derived:

```sh
node --import ./scripts/ts-specifier-hook.mjs scripts/compiler-codegen.mjs \
  --config fixtures/consumer-cli/zmdb.config.ts
```

Copy source changes into `consumer-cli/src/` before regenerating its output. Run the relevant compiler or CLI behavior tests for the changed route.
