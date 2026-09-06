# Consumer fixtures

Consumer projects use zmdb the way somebody who installed it would, kept here so that CI builds or explicitly freezes them rather than trusting that they still work.

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

`consumer-metro/` is the third supported route. It runs a real Metro 0.87 bundle, preserves a pre-existing Babel transformer, checks the package and project-fingerprint cache key, and has a separate
unconfigured control that reaches the current runtime refusal. The same fixture proves bare React Native and Expo use the same `withZmdb` config shape.

`packages/compiler/src/codegen/consumer-fixtures.spec.ts` is what holds that pair together, and what stops two directories from quietly becoming two different programs. It builds the plugin fixture
into a temp directory, runs `--check` over the committed one, and then asserts that the non-generated sources are byte-identical, that the committed witness makes the same calls the plugin fixture's
source still makes, that both print the same bytes, and that both compile to the same check — measuring each, since by then they are known to be the same code.

`llm-adapters/` is compile-only and independent of that pair. It pins the real `@langchain/core` and `ai` packages, then checks the frozen plain-object adapter shapes against their constructors. The
framework dependencies belong to that private consumer fixture. LangChain is an optional peer only of `@zmdb/ai-langchain`; neither framework reaches the provider-neutral `@zmdb/ai` manifest.

`consumer-compiler/` and `consumer-migrations/` freeze the standalone package contracts selected by #626. Their manifests use versioned dependencies, their configs have no `paths` map or
`skipLibCheck`, and #627 typechecks them against tarballs under the target package names. The compiler fixture compiles one real `is<T>()` call from the packed package, materialises its four changed
paths, reruns check mode to zero stale paths, and executes good/bad values; migrations remains an expected failure until its extraction issue lands. `consumer-cli/tsconfig.installed.json` does the
same for the future installed `@zmdb/cli` boundary while the existing files in that directory continue to prove today's no-bundler compiler route.

`database-mysql/` packs the complete MySQL vertical and its transitive workspace closure, installs those tarballs with the real `mysql2` peer in a temporary project, typechecks only the published
declarations, then runs migrations, transactions, binding, bigint, strict `utf8mb4`, generated-column, index, foreign-key, and catalog-introspection acceptance against the configured MySQL server.

`app-custom-transport.ts` is a single external consumer rather than a project. The app suite executes it, and `verify:publish` copies it beside the packed packages and compiles it there. Its imports
are limited to `@zmdb/app/messaging` and `@zmdb/app/observability`, so the custom strategy contract is checked from the same side of the package boundary as an installed application.

`consumer-http-client/` commits OpenAPI and typed-client output generated from one exported HTTP contract. Its verifier checks the committed bytes, builds a real `@zmdb/web` loopback service, and then
compiles and runs the same generated client as separate browser and Node bundles with only a packed `@zmdb/client` installed. Both consumers cover the ordinary success response, an alternate success
status, invalid-success-body rejection, and per-request bearer authentication injection.

The generated-client documentation page is itself executable fixture source: every TypeScript fence names a safe project-relative file. `verify:publish` extracts those exact fence bytes into the
`consumer-http-client/docs/` project outside the repository and compiles them against declarations from all packed packages, with no `paths` map or skipped library checks.

`client-adapters/` is the private conformance workspace for #689 and #690. One generated client and a settlement-ledger transport drive reusable lifecycle, cancellation, stale-completion, error, retry
and SSR-isolation assertions for every proposed adapter. `@zmdb/react`, `@zmdb/angular`, `@zmdb/vue`, `@zmdb/svelte`, and the browser half of `@zmdb/next` now run those cases through their native
bindings; the other missing adapter packages remain intentional `it.fails` retirement triggers. Reusable manifest/import rules and packed-project orchestration live beside them.

`next-app-router/` is copied into an external tarball consumer by `packages/next/src/packed-consumer.spec.ts`. It uses a real Next 16.3 App Router build, server component, route handler and client
component; runs two authenticated production requests; proves memoization is request-local; and scans emitted browser chunks for the absence of the server credential and server package graph. #700
still owns cross-adapter installed-framework and bundle checks beyond the package-local slices.

## Working on them

`consumer-plugin/` is the one to edit. `consumer-cli/` is derived:

```sh
node --import ./scripts/ts-specifier-hook.mjs scripts/compiler-codegen.mjs \
  --config fixtures/consumer-cli/zmdb.config.ts
```

Copy the source change into `consumer-cli/src/` first, then run that. CI runs the same command with `--check`, which writes nothing and fails if the committed output is stale.

Regenerate the HTTP artifacts with:

```sh
node --import ./scripts/ts-specifier-hook.mjs packages/zmdb/src/cli/bin.ts \
  client generate --config fixtures/consumer-http-client/zmdb.config.ts
```

The publish verifier passes its already packed client tarball to `consumer-http-client/verify-installed.mjs`; running that verifier directly builds a temporary tarball itself.
