zmdb ships one product through focused package firebreaks. Official membership and npm identity come only from `scripts/product/catalog.mjs`; dependency direction, rings, and public-entry reachability
come only from `scripts/architecture/policy.mjs`. The [frozen target release contract](https://github.com/ambasta/zmdb/blob/main/scripts/release/SPEC.md) owns release groups, version movement, and
compatibility ranges. The checked-in release scripts still implement the earlier all-package lockstep train until the follow-up implementation issues land. The generated view below is the complete
current dependency graph, not a simplified diagram maintained beside it.

## Executable package graph and rings

Zones move outward from foundation through runtime, application, integration, tooling, and the facade. Every direct workspace dependency must be present in both the consumer manifest and its policy
row, point to an equal-or-inward zone, and have a strictly lower canonical ring. Type-only production imports count as ownership edges. The complete graph must remain acyclic.

<!-- generated: architecture policy-graph -->

Measured from `scripts/product/catalog.mjs`, `scripts/architecture/policy.mjs`, and the admitted manifests: **37 catalog packages**, **73 direct workspace edges**, and canonical rings **0–7**.

| Ring | Zone        | Package                    | Direct workspace dependencies                                                                                                                                                                           |
| ---- | ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | integration | `@zmdb/angular`            | none                                                                                                                                                                                                    |
| 0    | foundation  | `@zmdb/client`             | none                                                                                                                                                                                                    |
| 0    | foundation  | `@zmdb/protobuf`           | none                                                                                                                                                                                                    |
| 0    | foundation  | `@zmdb/query-compiler`     | none                                                                                                                                                                                                    |
| 1    | foundation  | `@zmdb/migrations`         | `@zmdb/query-compiler`                                                                                                                                                                                  |
| 1    | integration | `@zmdb/react`              | `@zmdb/client`                                                                                                                                                                                          |
| 1    | foundation  | `@zmdb/schema-core`        | `@zmdb/query-compiler`                                                                                                                                                                                  |
| 1    | integration | `@zmdb/solid`              | `@zmdb/client`                                                                                                                                                                                          |
| 1    | integration | `@zmdb/svelte`             | `@zmdb/client`                                                                                                                                                                                          |
| 1    | integration | `@zmdb/vue`                | `@zmdb/client`                                                                                                                                                                                          |
| 2    | runtime     | `@zmdb/ai`                 | `@zmdb/schema-core`                                                                                                                                                                                     |
| 2    | integration | `@zmdb/next`               | `@zmdb/client`<br>`@zmdb/react`                                                                                                                                                                         |
| 2    | integration | `@zmdb/nuxt`               | `@zmdb/client`<br>`@zmdb/vue`                                                                                                                                                                           |
| 2    | integration | `@zmdb/react-native`       | `@zmdb/client`<br>`@zmdb/react`                                                                                                                                                                         |
| 2    | integration | `@zmdb/sveltekit`          | `@zmdb/client`<br>`@zmdb/svelte`                                                                                                                                                                        |
| 3    | integration | `@zmdb/ai-anthropic`       | `@zmdb/ai`                                                                                                                                                                                              |
| 3    | integration | `@zmdb/ai-langchain`       | `@zmdb/ai`                                                                                                                                                                                              |
| 3    | integration | `@zmdb/ai-vercel`          | `@zmdb/ai`                                                                                                                                                                                              |
| 3    | runtime     | `@zmdb/aot-validator`      | `@zmdb/ai`<br>`@zmdb/schema-core`                                                                                                                                                                       |
| 3    | integration | `@zmdb/mcp`                | `@zmdb/ai`                                                                                                                                                                                              |
| 4    | runtime     | `@zmdb/repository`         | `@zmdb/aot-validator`<br>`@zmdb/query-compiler`<br>`@zmdb/schema-core`                                                                                                                                  |
| 5    | application | `@zmdb/app`                | `@zmdb/aot-validator`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`<br>`@zmdb/schema-core`                                                                                                            |
| 5    | integration | `@zmdb/mssql`              | `@zmdb/migrations`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`                                                                                                                                      |
| 5    | integration | `@zmdb/mysql`              | `@zmdb/migrations`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`                                                                                                                                      |
| 5    | runtime     | `@zmdb/postgres`           | `@zmdb/migrations`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`                                                                                                                                      |
| 5    | runtime     | `@zmdb/sqlite`             | `@zmdb/migrations`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`                                                                                                                                      |
| 6    | runtime     | `@zmdb/cockroach`          | `@zmdb/migrations`<br>`@zmdb/postgres`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`                                                                                                                  |
| 6    | application | `@zmdb/jobs`               | `@zmdb/app`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`<br>`@zmdb/sqlite`                                                                                                                           |
| 6    | integration | `@zmdb/otel`               | `@zmdb/app`                                                                                                                                                                                             |
| 6    | integration | `@zmdb/singlestore`        | `@zmdb/migrations`<br>`@zmdb/mysql`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`                                                                                                                     |
| 6    | integration | `@zmdb/transport-grpc`     | `@zmdb/app`<br>`@zmdb/protobuf`                                                                                                                                                                         |
| 6    | integration | `@zmdb/transport-nats`     | `@zmdb/app`                                                                                                                                                                                             |
| 6    | integration | `@zmdb/transport-rabbitmq` | `@zmdb/app`                                                                                                                                                                                             |
| 6    | integration | `@zmdb/transport-redis`    | `@zmdb/app`                                                                                                                                                                                             |
| 6    | application | `@zmdb/web`                | `@zmdb/app`<br>`@zmdb/aot-validator`<br>`@zmdb/schema-core`                                                                                                                                             |
| 7    | integration | `@zmdb/jobs-postgres`      | `@zmdb/jobs`<br>`@zmdb/postgres`                                                                                                                                                                        |
| 7    | facade      | `zmdb`                     | `@zmdb/app`<br>`@zmdb/aot-validator`<br>`@zmdb/migrations`<br>`@zmdb/mssql`<br>`@zmdb/postgres`<br>`@zmdb/query-compiler`<br>`@zmdb/repository`<br>`@zmdb/schema-core`<br>`@zmdb/sqlite`<br>`@zmdb/web` |

Entry-specific runtime, tooling, and optional-peer reachability assignments:

| Package               | Reachability class          | Allowed target                             | Entry selector(s)                                                                                                                                     |
| --------------------- | --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@zmdb/client`        | tooling boundary            | tooling-only code                          | `./testing`                                                                                                                                           |
| `@zmdb/migrations`    | tooling boundary            | tooling-only code                          | `./declarations`<br>`./files`<br>`./testing`                                                                                                          |
| `@zmdb/ai`            | tooling boundary            | tooling-only code                          | `./compiler`                                                                                                                                          |
| `@zmdb/next`          | ordinary runtime dependency | `server-only`                              | ordinary runtime entries                                                                                                                              |
| `@zmdb/ai-anthropic`  | optional peer               | `@anthropic-ai/sdk@0.124.0`                | `.`                                                                                                                                                   |
| `@zmdb/ai-langchain`  | optional peer               | `@langchain/core@^1.2.9`                   | `.`                                                                                                                                                   |
| `@zmdb/ai-vercel`     | optional peer               | `ai@^7.0.93`                               | `.`                                                                                                                                                   |
| `@zmdb/aot-validator` | tooling boundary            | tooling-only code                          | `./codegen`<br>`./emit`<br>`./lint`<br>`./metro`<br>`./plugin`<br>`./reflect`<br>`./testing`<br>`./transformer`<br>`./unplugin`<br>`bin:zmdb-codegen` |
| `@zmdb/aot-validator` | optional peer               | `metro@>=0.87.0 <0.88.0`                   | `./metro`                                                                                                                                             |
| `@zmdb/aot-validator` | optional peer               | `metro-babel-transformer@>=0.87.0 <0.88.0` | `./metro`                                                                                                                                             |
| `@zmdb/aot-validator` | optional peer               | `oxlint@>=1.81.0 <1.82.0`                  | `./lint`                                                                                                                                              |
| `@zmdb/aot-validator` | optional peer               | `typescript@>=7.0.0`                       | `./codegen`<br>`./metro`<br>`./plugin`<br>`./reflect`<br>`./testing`<br>`./transformer`<br>`./unplugin`<br>`bin:zmdb-codegen`                         |
| `@zmdb/mssql`         | optional peer               | `mssql@^12.7.0`                            | `.`                                                                                                                                                   |
| `@zmdb/mysql`         | optional peer               | `mysql2@^3.24.3`                           | `.`                                                                                                                                                   |
| `@zmdb/postgres`      | optional peer               | `pg@^8.23.0`                               | `.`                                                                                                                                                   |
| `@zmdb/singlestore`   | optional peer               | `mysql2@^3.24.3`                           | `.`                                                                                                                                                   |
| `@zmdb/web`           | tooling boundary            | tooling-only code                          | `./contract/compiler`<br>`./devtools`<br>`./testing`                                                                                                  |
| `@zmdb/web`           | optional peer               | `typescript@>=7.0.0`                       | `./contract/compiler`                                                                                                                                 |
| `zmdb`                | tooling boundary            | tooling-only code                          | `./cli`<br>`./config`<br>`./migrations`<br>`./unplugin`<br>`./web/contract/compiler`<br>`./web/devtools`<br>`./web/testing`<br>`bin:zmdb`             |
| `zmdb`                | optional peer               | `@zmdb/mssql@workspace:^`                  | `./cli`<br>`./drivers/mssql`<br>`bin:zmdb`                                                                                                            |
| `zmdb`                | optional peer               | `@zmdb/postgres@workspace:^`               | `./drivers/pg`                                                                                                                                        |

The tables are regenerated by `node docs-site/generated.mjs` and checked without writing by `yarn verify:docs-generated`.

<!-- /generated: architecture policy-graph -->

The generated `ai@^7.0.93` row is the implemented Vercel AI SDK support promise. Exact `7.0.93` is also the development fixture and the version installed by the package-owned external-consumer proof.
The target release classification covers every public row above exactly once: eight cohesive core packages, 28 independently versioned integrations, and one independently versioned tooling package.

## Admit a package atomically

A public package joins the product, dependency graph, and release policy in one reviewable change:

1. Add its publishable manifest, public exports, package documentation, license, and external-consumer evidence.
2. Add exactly one row to `scripts/product/catalog.mjs` and one same-id row to `scripts/architecture/policy.mjs`. Do not add the package to a workflow loop or another inventory.
3. Add exactly one same-id row to the release policy introduced by issue #749. Classify it as core, integration, or tooling, and record every cross-unit internal range and third-party peer floor.
4. Use `workspace:^` only for same-core edges. Use the explicit release-policy range for every cross-unit edge, and test the packed consumer at each promised floor.
5. Classify tooling exports and each optional peer by exact export/bin selector. Required peers remain confined to technology-selected integration or provider packages.
6. Add a root `CHANGELOG.md` bullet owned by the catalog id, then regenerate and verify the executable documentation.

```bash
node docs-site/generated.mjs
yarn verify:product-catalog
yarn verify:architecture-zones
yarn verify:runtime-reachability
yarn verify:package-metadata
yarn verify:release-governance
yarn verify:docs-generated
yarn build:docs
```

An admitted package missing any authority fails. A policy-only dependency, a manifest-only dependency, an unclassified public package, an unmeasured compatibility floor, an unused allowance, a private
source import, an inflated ring, or a stale selector also fails rather than being inferred away. Until issue #749 lands, `yarn verify:release-governance` checks only the current lockstep
implementation; it is not evidence that the target release-group policy has been implemented.

## Reachability is per public entry

The generated assignment table above shows the live exceptions. Ordinary exports cannot reach tooling code. A tooling selector such as `zmdb/cli` may do so without giving the `zmdb` root the same
permission. Likewise, an optional peer assignment permits only the listed selector: the validator lint entry can reach Oxlint, while unrelated validator exports cannot inherit that access.
`yarn verify:runtime-reachability` walks every export and executable independently and rejects tooling leaks, optional-peer leaks, undeclared dependencies, and stale exceptions.

## Current executable release workflow

The commands below describe the checked-in pre-#746 tooling. They still require one reviewed root changelog and one version for all 37 public packages:

```bash
RELEASE_VERSION=1.0.0-alpha.5
node scripts/release/bump.mjs "$RELEASE_VERSION"
yarn verify:architecture-zones
yarn verify:runtime-reachability
yarn verify:package-metadata
yarn verify:release-governance
node scripts/release/plan.mjs --publish-tsv
```

The bump moves non-empty `Unreleased` notes into the dated version section, updates every catalog manifest, refreshes the lockfile, and rolls all touched files back if validation fails. Manual
workflow dispatch is dry-run only. After the complete ordinary gate is green, commit the whole train and create the exact tag:

```bash
git tag "v$RELEASE_VERSION"
git push origin "v$RELEASE_VERSION"
```

CI verifies the tag, changelog, common version, membership, and policy-derived order before build or packaging. It then packs or publishes each planned package in dependency-first order. An
interrupted retry skips an existing version only when its registry integrity is byte-identical.

Do not use those commands to approximate a partial release. The frozen target keeps eight core packages lockstep, gives each of the 28 integrations and `@zmdb/migrations` an independent version, uses
`core-v<version>` for the core and `<catalog-id>-v<version>` for independent units, and derives internal ranges plus third-party peer floors from one release policy. Issues #747–#750 must implement
and qualify that behavior before it is executable.

## Package ownership

Package descriptions, versions, exports, peer ranges, install commands, facade exposure, and external proof are rendered from the catalog and manifests in the
[package reference](./package-reference.html). Keeping that inventory there prevents this architecture page from becoming a second package list.

## The two boundaries that matter

### 1. The compiler never executes

`@zmdb/query-compiler` produces a `CompiledQuery`:

```ts
export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly telemetry?: {
    readonly system: 'postgresql' | 'mysql' | 'sqlite' | 'mssql';
    readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
    readonly collection: string;
  };
}
```

That is the whole handoff. The default compiler still returns exactly `text` and `parameters`, so existing snapshots keep their shape; telemetry appears only when a driver wrapper opts the compiler
into it. Every query can still be asserted without a database, and the compiler still has no I/O to mock.

### 2. The driver has one required method

```ts
export interface Driver<Name extends string = string> {
  readonly dialect?: SqlDialect<Name> | Dialect;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

Everything database-specific lives on your side of that line — pooling, retries, TLS, serverless HTTP transports. That is why [connecting](./drivers.html) to Neon, D1, Turso or PlanetScale is a page
of documentation rather than a package: they are all "implement `execute`". A driver that supplies a dialect lets the repository derive compilation and capabilities from that same value.

## No runtime code generation

There is no `new Function` and no `eval` anywhere in `packages/*/src`. Validators are emitted as source by the transformer during your build, so what runs in production is code that `tsc` type-checked
and that you can read in the output bundle. CI checks the parsed call sites, the public `refine`/`transform` signatures, and reachability from both emitter paths rather than trusting a text grep.

## No runtime reflection

There is no `reflect-metadata`, no `design:type`, and no metadata provider. The decorators in `@zmdb/app` (`@Module`) and `@zmdb/web` (`@Controller`, `@Get`) record only the declarations they own —
they never ask the runtime what type a parameter has, because at runtime that information is gone. Types are read by the transformer, at compile time, from the real checker.

> [!NOTE] The consequence: neither `@zmdb/app` nor `@zmdb/web` starts with a metadata scan. See [AOT vs JIT](./jit-vs-aot.html) for the measured difference and [Benchmarks](./benchmarks.html) for the
> numbers.

## Provider-neutral dependency boundary

`@zmdb/ai` has one runtime workspace dependency, `@zmdb/schema-core`, and no external dependency or peer. `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, and `@zmdb/ai-vercel` are separate opt-in packages
with one optional SDK/framework peer each. Importing the provider-neutral root, chat, HTTP, compiler, or tool-runtime entry does not install or resolve any of those peers.

`@langchain/core` is absent from both schema-core and the provider-neutral AI manifest.

The Vercel adapter's supported and tested floor is AI SDK `7.0.93`. Its package-owned test builds and packs `@zmdb/query-compiler`, `@zmdb/schema-core`, `@zmdb/ai`, and `@zmdb/ai-vercel`, installs
those tarballs with exact `ai@7.0.93` outside the repository, typechecks representative tool and `streamText` usage with the documented `skipLibCheck: true`, resolves every zmdb package from the
temporary consumer's `node_modules`, and executes the real `description`, `execute`, and `inputSchema` fields.

`@zmdb/mcp` has one runtime workspace dependency, `@zmdb/ai`, and no external dependency or peer. Importing its root does not install an MCP or provider SDK.

## Assertion discipline

The public surface is assertion-free: no `any`, no `as T`, no non-null `!` in framework code. Where an assertion is genuinely irreducible — a primary-key name read from schema metadata cannot be
related to `Col<S>` by control flow — it carries a `// boundary:` comment stating the invariant that makes it sound. Reviews reject the label without the argument.

---

See also: [Why zmdb](./why-zmdb.html) · [AOT Setup](./aot-setup.html) · [Writing a Driver](./custom-driver.html) · [Anti-patterns](./anti-patterns.html)
