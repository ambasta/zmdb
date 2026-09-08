Package manifests declare workspace dependencies and public entries. The [product catalog](../../scripts/product/catalog.mjs) identifies official packages; release groups come from
[release policy](../../scripts/release/policy.mjs). Build and documentation tooling read these records directly.

The [runtime foundation guide](./runtime-foundation.md) explains the standalone packages and their inward dependencies. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the normal lint, typecheck,
test and build workflow.

## Package changes

Add a package manifest, product catalog entry and release record together. Declare runtime, optional and peer dependencies in the manifest. The build follows those dependency edges. Use the normal
lint, typecheck, functional tests and packaging checks described in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Current executable release workflow

Choose `core` for the eight-package cohesive train or one independent integration/tooling catalog id:

```bash
RELEASE_ID=core
RELEASE_VERSION=1.0.0-alpha.5
RELEASE_TAG="$RELEASE_ID-v$RELEASE_VERSION"

node scripts/release/bump.mjs "$RELEASE_ID" "$RELEASE_VERSION"
yarn verify:package-metadata
node scripts/release/plan.mjs --release "$RELEASE_ID" --version "$RELEASE_VERSION" --publish-tsv
```

The bump moves the selected unit's non-empty `Unreleased` notes into the dated version section, updates its manifest or the eight core manifests, refreshes the lockfile, and rolls all touched files
back if validation fails. Manual workflow dispatch is dry-run only. After the normal checks is green, commit the whole train and create the exact tag:

```bash
git tag "$RELEASE_ID-v$RELEASE_VERSION"
git push origin "$RELEASE_ID-v$RELEASE_VERSION"
```

CI verifies the tag, changelog, selected version, membership, and manifest dependency order before build or packaging. It publishes all eight core packages for a core tag or exactly one selected
independent package for an integration/tooling tag. An interrupted retry skips an existing version only when its registry integrity is byte-identical.

## Package ownership

Package descriptions, versions, exports, peer ranges, install commands, facade exposure, and external proof are rendered from the catalog and manifests in the
[package reference](./package-reference.html). Keeping that inventory there prevents this architecture page from becoming a second package list.

## The two boundaries that matter

### 1. The compiler never executes

`@zmdb/sql` produces a `CompiledQuery`:

```ts {"mode":"compile","id":"example-001"}
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

### 2. The driver carries one dialect and one execution method

```ts {"mode":"illustrative","id":"example-002","reason":"The surrounding example supplies CompiledQuery, ExecuteOptions, SqlDialect; this excerpt does not repeat those declarations."}
export interface Driver<Name extends string = string> {
  readonly dialect: SqlDialect<Name>;
  execute(query: CompiledQuery, opts?: ExecuteOptions): Promise<readonly Record<string, unknown>[]>;
  stream?(query: CompiledQuery, opts?: ExecuteOptions): AsyncIterable<Record<string, unknown>>;
}
```

Everything database-specific lives on your side of that line — pooling, retries, TLS, serverless HTTP transports. That is why [connecting](./drivers.html) to Neon, D1, Turso or PlanetScale is a page
of documentation rather than a package: they are all "implement `execute`" against an imported database dialect. The repository derives compilation and capabilities from that same required object.

## No runtime code generation

There is no `new Function` and no `eval` anywhere in `packages/*/src`. Validators are emitted as source by the transformer during your build, so what runs in production is code that `tsc` type-checked
and that you can read in the output bundle. CI checks the parsed call sites, the public `refine`/`transform` signatures, and reachability from both emitter paths rather than trusting a text grep.

## No runtime reflection

There is no `reflect-metadata`, no `design:type`, and no metadata provider. The decorators in `@zmdb/app` (`@Module`) and `@zmdb/web` (`@Controller`, `@Get`) record only the declarations they own —
they never ask the runtime what type a parameter has, because at runtime that information is gone. Types are read by the transformer, at compile time, from the real checker.

> [!NOTE] The consequence: neither `@zmdb/app` nor `@zmdb/web` starts with a metadata scan. See [AOT vs JIT](./jit-vs-aot.html) for the measured difference and [Benchmarks](./benchmarks.html) for the
> numbers.

## Provider-neutral dependency boundary

`@zmdb/ai` has one runtime workspace dependency, `@zmdb/schema`, and no external dependency or peer. `@zmdb/ai-anthropic`, `@zmdb/ai-langchain`, and `@zmdb/ai-vercel` are separate opt-in packages with
one optional SDK/framework peer each. Importing the provider-neutral root, chat, HTTP, compiler, or tool-runtime entry does not install or resolve any of those peers.

`@langchain/core` is absent from both schema-core and the provider-neutral AI manifest.

The Vercel adapter's supported and tested floor is AI SDK `7.0.93`. Its package-owned test builds and packs `@zmdb/sql`, `@zmdb/schema`, `@zmdb/ai`, and `@zmdb/ai-vercel`, installs those tarballs with
exact `ai@7.0.93` outside the repository, typechecks representative tool and `streamText` usage with the documented `skipLibCheck: true`, resolves every zmdb package from the temporary consumer's
`node_modules`, and executes the real `description`, `execute`, and `inputSchema` fields.

`@zmdb/mcp` has one runtime workspace dependency, `@zmdb/ai`, and no external dependency or peer. Importing its root does not install an MCP or provider SDK.

## Assertion discipline

The public surface is assertion-free: no `any`, no `as T`, no non-null `!` in framework code. Where an assertion is genuinely irreducible — a primary-key name read from schema metadata cannot be
related to `Col<S>` by control flow — it carries a `// boundary:` comment stating the invariant that makes it sound. Reviews reject the label without the argument.

---

See also: [Why zmdb](./why-zmdb.html) · [AOT Setup](./aot-setup.html) · [Writing a Driver](./custom-driver.html) · [Anti-patterns](./anti-patterns.html)

## Continue the product journey

Return to the [quick start](./quick-start.html) or [blog API tutorial](./tutorial-blog-api.html). Select integrations from the [generated package reference](./package-reference.html); use
[runtime foundation](./runtime-foundation.html) and [tooling boundaries](./tooling-boundaries.html) when choosing standalone owners.
